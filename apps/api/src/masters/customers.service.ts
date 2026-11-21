import { Injectable } from '@nestjs/common';
import type { CustomerInput, ListQuery } from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { listArgs, paginated } from '../common/list';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(query: ListQuery) {
    const args = listArgs(query, {
      searchFields: ['code', 'name', 'contactPerson', 'phone', 'email', 'gstin', 'city'],
      sortable: ['code', 'name', 'city', 'country', 'createdAt'],
      defaultSort: { field: 'name', dir: 'asc' },
      activeField: 'isActive',
    });
    const [data, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany(args),
      this.prisma.customer.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  get(id: number) {
    return this.prisma.customer.findUniqueOrThrow({ where: { id } });
  }

  create(input: CustomerInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const code = input.code || (await this.numbering.next('CUSTOMER', { tx }));
      const customer = await tx.customer.create({
        data: { ...normalize(input), code, createdById: actor.userId },
      });
      await this.audit.log(
        actor,
        { action: AuditAction.CREATE, entity: 'customer', entityId: customer.id, summary: `Created customer ${customer.name}` },
        tx,
      );
      return customer;
    });
  }

  async update(id: number, input: CustomerInput, actor: Actor) {
    const before = await this.get(id);
    const customer = await this.prisma.customer.update({
      where: { id },
      data: { ...normalize(input), code: input.code || before.code },
    });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'customer',
      entityId: id,
      summary: `Updated customer ${customer.name}`,
      changes: diff(before, customer),
    });
    return customer;
  }

  async remove(id: number, actor: Actor) {
    const customer = await this.get(id);
    await this.prisma.customer.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'customer',
      entityId: id,
      summary: `Deleted customer ${customer.name}`,
      changes: customer,
    });
  }
}
