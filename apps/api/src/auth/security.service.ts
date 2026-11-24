import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isAdminUser,
  TWO_FACTOR_POLICIES,
  type SecurityPolicy,
  type TwoFactorPolicy,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from '@bht/shared';
import { AuditAction, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { brand } from '../config/brand';
import type { Env } from '../config/env';
import type { Actor } from '../common/auth-user';
import { verifyPassword } from './password';
import { hashBackupCode, newBackupCodes, newTotpSecret, openSecret, otpauthUrl, sealSecret, verifyTotp } from './totp';

/** Wrong passwords or codes in a row before the account is locked, and for how long. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const POLICY_KEY = 'security.twoFactor';
const POLICY_CACHE_MS = 30_000;

/**
 * Login safety: the company 2-step rule, the authenticator secret and backup codes,
 * and the lock after too many wrong tries.
 */
@Injectable()
export class SecurityService {
  private policyCache: { value: TwoFactorPolicy; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ company rule

  /** Who must use 2-step login (cached for 30 seconds; it is read on every request). */
  async policy(): Promise<TwoFactorPolicy> {
    if (this.policyCache && Date.now() - this.policyCache.at < POLICY_CACHE_MS) return this.policyCache.value;
    const row = await this.prisma.appSetting.findUnique({ where: { key: POLICY_KEY } });
    const value = (TWO_FACTOR_POLICIES as readonly string[]).includes(row?.value ?? '') ? (row!.value as TwoFactorPolicy) : 'off';
    this.policyCache = { value, at: Date.now() };
    return value;
  }

  async setPolicy(input: SecurityPolicy, actor: Actor): Promise<SecurityPolicy> {
    const before = await this.policy();
    await this.prisma.appSetting.upsert({ where: { key: POLICY_KEY }, create: { key: POLICY_KEY, value: input.twoFactor }, update: { value: input.twoFactor } });
    this.policyCache = null;
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'settings', summary: `2-step login required for: ${before} → ${input.twoFactor}` });
    return { twoFactor: await this.policy() };
  }

  /** Does the company rule ask this user (by their permissions) to use 2-step login? */
  requiredFor(policy: TwoFactorPolicy, permissions: readonly string[]): boolean {
    return policy === 'everyone' || (policy === 'admins' && isAdminUser(permissions));
  }

  // ------------------------------------------------------------------ lock after wrong tries

  /** Throws when the account is locked right now. */
  assertNotLocked(user: { lockedUntil: Date | null }) {
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
      throw new ForbiddenException(
        `This account is locked after ${MAX_FAILED_LOGINS} wrong tries. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an admin to unlock it.`,
      );
    }
  }

  /** Counts a wrong password or code; the fifth in a row locks the account. Returns true when it just got locked. */
  async recordFailure(user: { id: number; username: string; failedLogins: number }, ip: string | null): Promise<boolean> {
    const failed = user.failedLogins + 1;
    if (failed >= MAX_FAILED_LOGINS) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } });
      await this.audit.log({ userId: user.id, ip }, {
        action: AuditAction.STATUS_CHANGE,
        entity: 'user',
        entityId: user.id,
        summary: `${user.username} locked for ${LOCK_MINUTES} minutes after ${MAX_FAILED_LOGINS} wrong tries`,
      });
      return true;
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: failed } });
    return false;
  }

  async clearFailures(userId: number) {
    await this.prisma.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: null } });
  }

  // ------------------------------------------------------------------ the user's own 2-step login

  async status(userId: number, permissions: readonly string[]): Promise<TwoFactorStatus> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { twoFactorEnabledAt: true, twoFactorRecovery: true } });
    return {
      enabled: !!user.twoFactorEnabledAt,
      enabledAt: user.twoFactorEnabledAt?.toISOString() ?? null,
      backupCodesLeft: codesOf(user.twoFactorRecovery).length,
      required: this.requiredFor(await this.policy(), permissions),
    };
  }

  /** Step 1 of turning it on: a new secret for the app (kept but not active until a code is confirmed). */
  async startSetup(userId: number): Promise<TwoFactorSetup> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true, twoFactorEnabledAt: true } });
    if (user.twoFactorEnabledAt) throw new BadRequestException('2-step login is already on.');
    const secret = newTotpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: sealSecret(secret, this.key()) } });
    return { secret, otpauthUrl: otpauthUrl(secret, user.username, `${brand().name} ERP`) };
  }

  /** Step 2: the first code from the app proves it works; turns it on and returns the backup codes (shown once). */
  async enable(userId: number, code: string, actor: Actor): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true, twoFactorSecret: true, twoFactorEnabledAt: true } });
    if (user.twoFactorEnabledAt) throw new BadRequestException('2-step login is already on.');
    const secret = user.twoFactorSecret ? openSecret(user.twoFactorSecret, this.key()) : null;
    if (!secret) throw new BadRequestException('Start the setup again: scan the new QR code.');
    if (!verifyTotp(secret, code)) throw new BadRequestException({ message: 'That code is not right. Check the time on your phone and try the newest code.', errors: { code: 'Wrong code' } });
    const backupCodes = newBackupCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabledAt: new Date(), twoFactorRecovery: backupCodes.map(hashBackupCode) },
    });
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'user', entityId: userId, summary: `${user.username} turned on 2-step login` });
    return { backupCodes };
  }

  /** New backup codes (the old ones stop working); needs a current code. */
  async newBackupCodes(userId: number, code: string, actor: Actor): Promise<{ backupCodes: string[] }> {
    const user = await this.activeTwoFactor(userId);
    if (!this.checkCode(user, code, false).ok) throw new BadRequestException({ message: 'That code is not right.', errors: { code: 'Wrong code' } });
    const backupCodes = newBackupCodes();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorRecovery: backupCodes.map(hashBackupCode) } });
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'user', entityId: userId, summary: `${user.username} made new 2-step backup codes` });
    return { backupCodes };
  }

  /** Turns it off (password + a current code); not allowed when the company rule needs it. */
  async disable(userId: number, permissions: readonly string[], password: string, code: string, actor: Actor) {
    if (this.requiredFor(await this.policy(), permissions)) {
      throw new ForbiddenException('Your company requires 2-step login for your account, so it cannot be turned off.');
    }
    const user = await this.activeTwoFactor(userId);
    const full = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (!(await verifyPassword(password, full.passwordHash))) {
      throw new BadRequestException({ message: 'Password is wrong.', errors: { password: 'Password is wrong' } });
    }
    if (!this.checkCode(user, code, false).ok) throw new BadRequestException({ message: 'That code is not right.', errors: { code: 'Wrong code' } });
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: null, twoFactorEnabledAt: null, twoFactorRecovery: Prisma.DbNull } });
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'user', entityId: userId, summary: `${user.username} turned off 2-step login` });
  }

  /**
   * Checks a sign-in code: a 6-digit app code, or a backup code (used up when it matches).
   * Returns which kind matched, so the caller can save the used-up backup code.
   */
  checkCode(
    user: { twoFactorSecret: string | null; twoFactorRecovery: unknown },
    code: string,
    allowBackup = true,
  ): { ok: boolean; backupLeft?: string[] } {
    const secret = user.twoFactorSecret ? openSecret(user.twoFactorSecret, this.key()) : null;
    if (secret && verifyTotp(secret, code)) return { ok: true };
    if (!allowBackup) return { ok: false };
    const hashes = codesOf(user.twoFactorRecovery);
    const hash = hashBackupCode(code);
    if (hashes.includes(hash)) return { ok: true, backupLeft: hashes.filter((h) => h !== hash) };
    return { ok: false };
  }

  private async activeTwoFactor(userId: number) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true, twoFactorSecret: true, twoFactorEnabledAt: true, twoFactorRecovery: true },
    });
    if (!user.twoFactorEnabledAt) throw new BadRequestException('2-step login is not on.');
    return user;
  }

  private key(): string {
    return this.config.get('TWO_FACTOR_KEY', { infer: true }) ?? this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }
}

/** The stored backup-code hashes (a JSON array). */
function codesOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}
