import { Injectable } from '@nestjs/common';
import type { ListQuery, SupplierInput } from '@bht/shared';
import { AuditAction, SupplierType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { listArgs, paginated } from '../common/list';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(query: ListQuery, type?: SupplierType) {
    const args = listArgs(
      query,
      {
        searchFields: ['code', 'name', 'contactPerson', 'phone', 'email', 'gstin', 'city'],
        sortable: ['code', 'name', 'type', 'city', 'createdAt'],
        defaultSort: { field: 'name', dir: 'asc' },
        activeField: 'isActive',
      },
      type ? { type } : {},
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany(args),
      this.prisma.supplier.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  get(id: number) {
    return this.prisma.supplier.findUniqueOrThrow({ where: { id } });
  }

  create(input: SupplierInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const code = input.code || (await this.numbering.next('SUPPLIER', { tx }));
      const supplier = await tx.supplier.create({
        data: { ...normalize(input), code, createdById: actor.userId },
      });
      await this.audit.log(
        actor,
        { action: AuditAction.CREATE, entity: 'supplier', entityId: supplier.id, summary: `Created supplier ${supplier.name}` },
        tx,
      );
      return supplier;
    });
  }

  async update(id: number, input: SupplierInput, actor: Actor) {
    const before = await this.get(id);
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: { ...normalize(input), code: input.code || before.code },
    });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'supplier',
      entityId: id,
      summary: `Updated supplier ${supplier.name}`,
      changes: diff(before, supplier),
    });
    return supplier;
  }

  async remove(id: number, actor: Actor) {
    const supplier = await this.get(id);
    await this.prisma.supplier.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'supplier',
      entityId: id,
      summary: `Deleted supplier ${supplier.name}`,
      changes: supplier,
    });
  }
}
