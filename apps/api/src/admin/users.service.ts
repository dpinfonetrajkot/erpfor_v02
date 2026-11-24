import { BadRequestException, Injectable } from '@nestjs/common';
import { passwordProblems, type ListQuery, type UserCreateInput, type UserUpdateInput } from '@bht/shared';
import { AuditAction, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { listArgs, paginated } from '../common/list';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';
import { hashPassword } from '../auth/password';

/** Never send password hashes to the browser. */
const userSelect = {
  id: true,
  username: true,
  name: true,
  email: true,
  phone: true,
  roleId: true,
  role: { select: { id: true, name: true } },
  isActive: true,
  lastLoginAt: true,
  lastSeenAt: true,
  createdAt: true,
  // login safety, shown as badges in Admin → Users (never the 2-step secret itself)
  mustChangePassword: true,
  lockedUntil: true,
  twoFactorEnabledAt: true,
} as const;

/** The company password rules, with this user's username; field error on `field`. */
function assertPasswordRules(password: string, username: string, field: string) {
  const problem = passwordProblems(password, { username })[0];
  if (problem) throw new BadRequestException({ message: `Password needs: ${problem.label}`, errors: { [field]: `Password needs: ${problem.label}` } });
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListQuery) {
    const args = listArgs(query, {
      searchFields: ['username', 'name', 'email', 'role.name'],
      sortable: ['username', 'name', 'lastSeenAt', 'createdAt'],
      defaultSort: { field: 'name', dir: 'asc' },
      activeField: 'isActive',
    });
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ ...args, select: userSelect }),
      this.prisma.user.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  get(id: number) {
    return this.prisma.user.findUniqueOrThrow({ where: { id }, select: userSelect });
  }

  async create(input: UserCreateInput, actor: Actor) {
    const { password, mustChangePassword, ...rest } = input;
    assertPasswordRules(password, rest.username, 'password');
    const user = await this.prisma.user.create({
      data: { ...normalize(rest), passwordHash: await hashPassword(password), mustChangePassword },
      select: userSelect,
    });
    await this.audit.log(actor, {
      action: AuditAction.CREATE,
      entity: 'user',
      entityId: user.id,
      summary: `Created user ${user.username} (${user.role.name})${mustChangePassword ? ', must choose own password' : ''}`,
    });
    return user;
  }

  async update(id: number, input: UserUpdateInput, actor: Actor) {
    if (id === actor.userId && !input.isActive) {
      throw new BadRequestException('You cannot disable your own account');
    }
    const before = await this.get(id);
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: normalize(input), select: userSelect });
      // A disabled user is signed out everywhere.
      if (!updated.isActive) {
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return updated;
    });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'user',
      entityId: id,
      summary: `Updated user ${user.username}`,
      changes: diff(before, user),
    });
    return user;
  }

  /** New password from the admin; also unlocks the account. */
  async resetPassword(id: number, newPassword: string, mustChangePassword: boolean, actor: Actor) {
    const user = await this.get(id);
    assertPasswordRules(newPassword, user.username, 'newPassword');
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(newPassword), mustChangePassword, failedLogins: 0, lockedUntil: null, passwordChangedAt: new Date() },
      }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log(actor, {
      action: AuditAction.PASSWORD_CHANGE,
      entity: 'user',
      entityId: id,
      summary: `Reset password of ${user.username}${mustChangePassword ? ' (must choose own password)' : ''}`,
    });
  }

  /** Unlocks an account locked after too many wrong passwords or codes. */
  async unlock(id: number, actor: Actor) {
    const user = await this.get(id);
    await this.prisma.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });
    await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'user', entityId: id, summary: `Unlocked ${user.username}` });
    return this.get(id);
  }

  /** Turns off 2-step login for someone who lost the phone; they sign in with the password and can set it up again. */
  async resetTwoFactor(id: number, actor: Actor) {
    const user = await this.get(id);
    if (id === actor.userId) throw new BadRequestException('Use Settings → Account & security to change your own 2-step login.');
    if (!user.twoFactorEnabledAt) throw new BadRequestException(`2-step login is not on for ${user.username}.`);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { twoFactorSecret: null, twoFactorEnabledAt: null, twoFactorRecovery: Prisma.DbNull } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'user', entityId: id, summary: `Turned off 2-step login of ${user.username}` });
    return this.get(id);
  }

  async remove(id: number, actor: Actor) {
    if (id === actor.userId) throw new BadRequestException('You cannot delete your own account');
    const user = await this.get(id);
    await this.prisma.user.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'user',
      entityId: id,
      summary: `Deleted user ${user.username}`,
      changes: user,
    });
  }
}
