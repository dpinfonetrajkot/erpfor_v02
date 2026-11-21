import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { isValidPermission, WILDCARD_PERMISSION, type RoleInput } from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';

const roleInclude = {
  permissions: { select: { permission: true } },
  _count: { select: { users: true } },
} as const;

type RoleRow = {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { permission: string }[];
  _count: { users: number };
};

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const roles = await this.prisma.role.findMany({ include: roleInclude, orderBy: { name: 'asc' } });
    return roles.map(toDto);
  }

  async get(id: number) {
    return toDto(await this.prisma.role.findUniqueOrThrow({ where: { id }, include: roleInclude }));
  }

  async create(input: RoleInput, actor: Actor) {
    const permissions = validPermissions(input.permissions);
    const role = await this.prisma.role.create({
      data: {
        name: input.name,
        description: normalize({ d: input.description }).d,
        permissions: { create: permissions.map((permission) => ({ permission })) },
      },
      include: roleInclude,
    });
    await this.audit.log(actor, {
      action: AuditAction.CREATE,
      entity: 'role',
      entityId: role.id,
      summary: `Created role ${role.name} with ${permissions.length} permissions`,
    });
    return toDto(role);
  }

  async update(id: number, input: RoleInput, actor: Actor) {
    const before = await this.get(id);
    if (before.isSystem && input.name !== before.name) {
      throw new BadRequestException('The Admin role cannot be renamed');
    }
    // The Admin role always keeps full access.
    const permissions = before.isSystem ? [WILDCARD_PERMISSION] : validPermissions(input.permissions);

    const role = await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      return tx.role.update({
        where: { id },
        data: {
          name: input.name,
          description: normalize({ d: input.description }).d,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
        include: roleInclude,
      });
    });

    const added = permissions.filter((p) => !before.permissions.includes(p));
    const removed = before.permissions.filter((p) => !permissions.includes(p));
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'role',
      entityId: id,
      summary: `Updated role ${role.name}`,
      changes: { added, removed, ...(before.name !== role.name ? { name: [before.name, role.name] } : {}) },
    });
    return toDto(role);
  }

  async remove(id: number, actor: Actor) {
    const role = await this.get(id);
    if (role.isSystem) throw new BadRequestException('The Admin role cannot be deleted');
    if (role.userCount > 0) {
      throw new ConflictException(`${role.userCount} user(s) still have this role. Move them to another role first.`);
    }
    await this.prisma.role.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'role',
      entityId: id,
      summary: `Deleted role ${role.name}`,
      changes: role,
    });
  }
}

function validPermissions(list: string[]): string[] {
  const unique = [...new Set(list)];
  const invalid = unique.filter((p) => !isValidPermission(p) || p === WILDCARD_PERMISSION);
  if (invalid.length) throw new BadRequestException(`Unknown permissions: ${invalid.join(', ')}`);
  return unique;
}

function toDto(role: RoleRow) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions.map((p) => p.permission),
    userCount: role._count.users,
  };
}
