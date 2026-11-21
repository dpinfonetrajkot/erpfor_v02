import { BadRequestException, Injectable } from '@nestjs/common';
import type { ListQuery, UserCreateInput, UserUpdateInput } from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
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
} as const;

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
    const { password, ...rest } = input;
    const user = await this.prisma.user.create({
      data: { ...normalize(rest), passwordHash: await hashPassword(password) },
      select: userSelect,
    });
    await this.audit.log(actor, {
      action: AuditAction.CREATE,
      entity: 'user',
      entityId: user.id,
      summary: `Created user ${user.username} (${user.role.name})`,
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

  async resetPassword(id: number, newPassword: string, actor: Actor) {
    const user = await this.get(id);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(newPassword) } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log(actor, {
      action: AuditAction.PASSWORD_CHANGE,
      entity: 'user',
      entityId: id,
      summary: `Reset password of ${user.username}`,
    });
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
