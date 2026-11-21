import { Injectable } from '@nestjs/common';
import type { ItemInput, ListQuery } from '@bht/shared';
import { AuditAction, EndConnection, StockKind, StockLocation } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { listArgs, paginated } from '../common/list';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';
import { itemName } from './item-name';

const itemInclude = {
  product: { select: { id: true, name: true } },
  partType: { select: { id: true, name: true } },
  materialGrade: { select: { id: true, name: true } },
  rawMaterial: { select: { id: true, code: true, size: true, grade: { select: { name: true } } } },
} as const;

export interface ItemFilters {
  productId?: number;
  partTypeId?: number;
}

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(query: ListQuery, filters: ItemFilters) {
    const args = listArgs(
      query,
      {
        searchFields: ['code', 'name', 'drawingNo', 'product.name', 'partType.name'],
        sortable: ['code', 'name', 'endConnection', 'createdAt'],
        defaultSort: { field: 'name', dir: 'asc' },
        activeField: 'isActive',
      },
      {
        ...(filters.productId ? { productId: filters.productId } : {}),
        ...(filters.partTypeId ? { partTypeId: filters.partTypeId } : {}),
      },
    );
    const [items, total] = await this.prisma.$transaction([
      this.prisma.item.findMany({ ...args, include: itemInclude }),
      this.prisma.item.count({ where: args.where }),
    ]);

    // Finished-goods stock in the FG store, all heats together.
    const stock = await this.prisma.stockBalance.groupBy({
      by: ['itemId'],
      where: {
        kind: StockKind.FINISHED_GOOD,
        location: StockLocation.FG_STORE,
        itemId: { in: items.map((i) => i.id) },
      },
      _sum: { quantity: true },
    });
    const qty = new Map(stock.map((s) => [s.itemId, s._sum.quantity?.toNumber() ?? 0]));
    return paginated(
      items.map((i) => ({ ...i, stockQty: qty.get(i.id) ?? 0 })),
      total,
      query,
    );
  }

  get(id: number) {
    return this.prisma.item.findUniqueOrThrow({ where: { id }, include: itemInclude });
  }

  create(input: ItemInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const data = await this.prepare(input);
      const code = input.code || (await this.numbering.next('ITEM', { tx }));
      const item = await tx.item.create({ data: { ...data, code }, include: itemInclude });
      await this.audit.log(
        actor,
        { action: AuditAction.CREATE, entity: 'item', entityId: item.id, summary: `Created item ${item.name}` },
        tx,
      );
      return item;
    });
  }

  async update(id: number, input: ItemInput, actor: Actor) {
    const before = await this.get(id);
    const data = await this.prepare(input);
    const item = await this.prisma.item.update({
      where: { id },
      data: { ...data, code: input.code || before.code },
      include: itemInclude,
    });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'item',
      entityId: id,
      summary: `Updated item ${item.name}`,
      changes: diff(before, item),
    });
    return item;
  }

  async remove(id: number, actor: Actor) {
    const item = await this.get(id);
    await this.prisma.item.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'item',
      entityId: id,
      summary: `Deleted item ${item.name}`,
      changes: item,
    });
  }

  /** Builds the stored name and clears the end connection for parts that have none (NUT). */
  private async prepare(input: ItemInput) {
    const [product, partType] = await Promise.all([
      this.prisma.product.findUniqueOrThrow({ where: { id: input.productId } }),
      this.prisma.partType.findUniqueOrThrow({ where: { id: input.partTypeId } }),
    ]);
    const endConnection = partType.hasEndConnection ? input.endConnection : EndConnection.NONE;
    const { code: _code, ...rest } = normalize(input);
    return { ...rest, endConnection, name: itemName(product.name, partType.name, endConnection) };
  }
}
