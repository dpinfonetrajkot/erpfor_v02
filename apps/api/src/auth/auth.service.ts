import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import {
  companyAppearanceSchema,
  DEFAULT_APPEARANCE,
  isAdminUser,
  passwordProblems,
  userPreferencesSchema,
  type ChangePasswordInput,
  type CompanyAppearance,
  type SessionUser,
  type TwoFactorChallenge,
  type TwoFactorPolicy,
  type UserPreferences,
} from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import type { Env } from '../config/env';
import type { Actor } from '../common/auth-user';
import { hashPassword, verifyPassword } from './password';
import { LOCK_MINUTES, SecurityService } from './security.service';

/** What the 2-step sign-in pass (ticket) carries; never accepted as a session token. */
interface TicketPayload {
  sub: number;
  purpose?: string;
}
const TICKET_SECONDS = 300;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
}

interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

/** A refresh token used again within this window is treated as a harmless double request. */
const REUSE_GRACE_MS = 30_000;

const userWithRole = {
  role: { include: { permissions: { select: { permission: true } } } },
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
    private readonly security: SecurityService,
  ) {}

  /**
   * Step 1 of sign-in. With 2-step login on, the password only earns a short pass (ticket) for
   * POST /auth/login/verify; otherwise the session starts here.
   */
  async login(
    username: string,
    password: string,
    client: ClientInfo,
  ): Promise<{ tokens: IssuedTokens; user: SessionUser } | { challenge: TwoFactorChallenge }> {
    const user = await this.prisma.user.findUnique({ where: { username }, include: userWithRole });
    if (user) this.security.assertNotLocked(user);
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;

    if (!user || !ok) {
      await this.audit.log(user ? { userId: user.id, ip: client.ip } : null, {
        action: AuditAction.LOGIN_FAILED,
        entity: 'user',
        entityId: user?.id,
        summary: `Failed login for "${username}"`,
      });
      if (user && (await this.security.recordFailure(user, client.ip))) {
        throw new ForbiddenException(`Too many wrong tries. This account is now locked for ${LOCK_MINUTES} minutes, or until an admin unlocks it.`);
      }
      throw new UnauthorizedException('Wrong username or password');
    }
    if (!user.isActive) throw new ForbiddenException('Your account is disabled. Contact the admin.');

    if (user.twoFactorEnabledAt) {
      const ticket = await this.jwt.signAsync({ sub: user.id, purpose: '2fa' } satisfies TicketPayload, { expiresIn: TICKET_SECONDS });
      return { challenge: { twoFactor: true, ticket } };
    }
    return this.startSession(user, client, `${user.username} logged in`);
  }

  /** Step 2 of sign-in: the code from the authenticator app, or a backup code. */
  async verifyLogin(ticket: string, code: string, client: ClientInfo) {
    let payload: TicketPayload;
    try {
      payload = await this.jwt.verifyAsync<TicketPayload>(ticket);
    } catch {
      throw new UnauthorizedException('The sign-in took too long. Please enter your password again.');
    }
    if (payload.purpose !== '2fa') throw new UnauthorizedException('Please enter your password again.');
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: userWithRole });
    if (!user || !user.isActive || !user.twoFactorEnabledAt) throw new UnauthorizedException('Please enter your password again.');
    this.security.assertNotLocked(user);

    const check = this.security.checkCode(user, code);
    if (!check.ok) {
      await this.audit.log({ userId: user.id, ip: client.ip }, {
        action: AuditAction.LOGIN_FAILED,
        entity: 'user',
        entityId: user.id,
        summary: `Wrong 2-step code for "${user.username}"`,
      });
      if (await this.security.recordFailure(user, client.ip)) {
        throw new ForbiddenException(`Too many wrong tries. This account is now locked for ${LOCK_MINUTES} minutes, or until an admin unlocks it.`);
      }
      throw new BadRequestException({ message: 'That code is not right. Use the newest code from the app, or a backup code.', errors: { code: 'Wrong code' } });
    }
    if (check.backupLeft) await this.prisma.user.update({ where: { id: user.id }, data: { twoFactorRecovery: check.backupLeft } });
    const how = check.backupLeft ? `with a backup code (${check.backupLeft.length} left)` : 'with 2-step login';
    return this.startSession(user, client, `${user.username} logged in ${how}`);
  }

  private async startSession(user: UserWithRole, client: ClientInfo, summary: string) {
    const tokens = await this.createSession(user.id, user.roleId, client);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await this.audit.log({ userId: user.id, ip: client.ip }, { action: AuditAction.LOGIN, entity: 'user', entityId: user.id, summary });
    return { tokens, user: toSessionUser(user, await this.appearance(), await this.security.policy()) };
  }

  /** Swaps a valid refresh token for a new pair (rotation). */
  async refresh(refreshToken: string | undefined, client: ClientInfo): Promise<IssuedTokens> {
    if (!refreshToken) throw new UnauthorizedException('Session expired');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!session) throw new UnauthorizedException('Session expired');

    if (session.revokedAt) {
      // An old token came back after rotation: possible theft, so end every session of this user.
      if (Date.now() - session.revokedAt.getTime() > REUSE_GRACE_MS) {
        await this.prisma.session.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Session expired');
    }
    if (session.expiresAt < new Date() || !session.user.isActive) {
      throw new UnauthorizedException('Session expired');
    }

    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.createSession(session.userId, session.user.roleId, client);
  }

  async logout(sessionId: number, actor: Actor) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.log(actor, { action: AuditAction.LOGOUT, entity: 'user', entityId: actor.userId });
  }

  async me(userId: number): Promise<SessionUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: userWithRole });
    return toSessionUser(user, await this.appearance(), await this.security.policy());
  }

  /** The company's default font and colour (Settings → Company look), or the built-in ones. */
  async appearance(): Promise<CompanyAppearance> {
    const rows = await this.prisma.appSetting.findMany({ where: { key: { in: ['ui.font', 'ui.accent'] } } });
    const v = Object.fromEntries(rows.map((r) => [r.key.slice(3), r.value]));
    const parsed = companyAppearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, ...v });
    return parsed.success ? parsed.data : DEFAULT_APPEARANCE;
  }

  /** Saves the user's own settings (the whole set, as shown on the Settings screen). */
  async updatePreferences(userId: number, preferences: UserPreferences): Promise<SessionUser> {
    await this.prisma.user.update({ where: { id: userId }, data: { preferences } });
    return this.me(userId);
  }

  /** Sets or removes the profile photo; the picture style follows (photo / back to initials). */
  async updateAvatar(userId: number, photo: string | null): Promise<SessionUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { preferences: true } });
    const prefs = readPreferences(user.preferences);
    const color = prefs.avatar?.color ?? 'blue';
    const avatar = photo ? { kind: 'photo' as const, color } : prefs.avatar?.kind === 'photo' ? { kind: 'initials' as const, color } : prefs.avatar;
    await this.prisma.user.update({ where: { id: userId }, data: { avatar: photo, preferences: { ...prefs, ...(avatar ? { avatar } : {}) } } });
    return this.me(userId);
  }

  async changePassword(userId: number, sessionId: number, input: ChangePasswordInput, actor: Actor) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException({
        message: 'Current password is wrong',
        errors: { currentPassword: 'Current password is wrong' },
      });
    }
    const problem = passwordProblems(input.newPassword, { username: user.username })[0];
    if (problem) throw new BadRequestException({ message: `Password needs: ${problem.label}`, errors: { newPassword: `Password needs: ${problem.label}` } });
    if (await verifyPassword(input.newPassword, user.passwordHash)) {
      const msg = 'Choose a password different from the current one';
      throw new BadRequestException({ message: msg, errors: { newPassword: msg } });
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, passwordChangedAt: new Date(), failedLogins: 0 },
      }),
      // Sign out every other device.
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null, NOT: { id: sessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.log(actor, { action: AuditAction.PASSWORD_CHANGE, entity: 'user', entityId: userId });
  }

  private async createSession(userId: number, roleId: number, client: ClientInfo): Promise<IssuedTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshMaxAgeMs = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000;
    const accessMaxAgeMs = this.config.get('ACCESS_TOKEN_TTL_MINUTES', { infer: true }) * 60_000;

    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        ip: client.ip,
        userAgent: client.userAgent?.slice(0, 255) ?? null,
        expiresAt: new Date(Date.now() + refreshMaxAgeMs),
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: userId, sid: session.id, rid: roleId },
      { expiresIn: Math.floor(accessMaxAgeMs / 1000) },
    );
    return { accessToken, refreshToken, accessMaxAgeMs, refreshMaxAgeMs };
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Stored settings, dropping anything no longer valid (e.g. a font that was removed). */
function readPreferences(raw: unknown): UserPreferences {
  const parsed = userPreferencesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

interface UserWithRole {
  id: number;
  username: string;
  name: string;
  email: string | null;
  roleId: number;
  preferences: unknown;
  avatar: string | null;
  mustChangePassword: boolean;
  twoFactorEnabledAt: Date | null;
  role: { id: number; name: string; permissions: { permission: string }[] };
}

function toSessionUser(user: UserWithRole, appearance: CompanyAppearance, policy: TwoFactorPolicy): SessionUser {
  const permissions = user.role.permissions.map((p) => p.permission);
  const required = policy === 'everyone' || (policy === 'admins' && isAdminUser(permissions));
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: { id: user.role.id, name: user.role.name },
    permissions,
    preferences: readPreferences(user.preferences),
    avatar: user.avatar,
    appearance,
    security: {
      twoFactorEnabled: !!user.twoFactorEnabledAt,
      mustChangePassword: user.mustChangePassword,
      twoFactorSetupRequired: required && !user.twoFactorEnabledAt,
    },
  };
}
