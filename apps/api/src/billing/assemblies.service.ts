import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AssemblyInput, ListQuery } from '@bht/shared';
import {
  AssemblyStatus,
  AuditAction,
  EndConnection,
  InvoiceStatus,
  Prisma,
  SalesOrderStatus,
  StockKind,
  StockLocation,
  StockRefType,
} from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { NotificationsService } from '../core/notifications.service';
import { StockService } from '../core/stock.service';
import { listArgs, paginated } from '../common/list';
import { normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

/** Orders whose sets can be packed. */
export const PACKABLE: SalesOrderStatus[] = [SalesOrderStatus.APPROVED, SalesOrderStatus.IN_PRODUCTION, SalesOrderStatus.PARTIALLY_DISPATCHED];

export const assemblyInclude = {
  salesOrder: { select: { id: true, soNo: true, status: true, customerPoNo: true, customer: { select: { id: true, name: true } } } },
  createdBy: { select: { id: true, name: true } },
  lines: {
    orderBy: { id: 'asc' },
    include: {
      salesOrderLine: {
        select: { id: true, lineNo: true, quantity: true, rate: true, endConnection: true, service: true, schedule: true, product: { select: { id: true, name: true, hsnCode: true } } },
      },
    },
  },
  consumptions: {
    orderBy: { id: 'asc' },
    include: { item: { select: { id: true, code: true, name: true, productId: true, partType: { select: { name: true } } } }, heat: { select: { id: true, heatNo: true, millHeatNo: true } } },
  },
  invoices: { select: { id: true, invoiceNo: true, status: true, dispatches: { select: { id: true, dispatchNo: true, cancelledAt: true } } }, orderBy: { id: 'desc' } },
} as const satisfies Prisma.AssemblyInclude;

/** What each line of a sales order has gone through: ordered, packed, invoiced, dispatched (sets). */
export async function orderProgress(db: PrismaService | Tx, salesOrderId: number) {
  const so = await db.salesOrder.findUniqueOrThrow({
    where: { id: salesOrderId },
    include: {
      lines: {
        orderBy: { lineNo: 'asc' },
        include: {
          product: { select: { id: true, name: true } },
          assemblyLines: { where: { assembly: { status: { not: AssemblyStatus.CANCELLED } } }, select: { quantity: true } },
          invoiceLines: { where: { invoice: { status: InvoiceStatus.ISSUED } }, select: { quantity: true } },
        },
      },
    },
  });
  return so.lines.map((l) => ({
    lineId: l.id,
    lineNo: l.lineNo,
    product: l.product,
    endConnection: l.endConnection,
    ordered: num(l.quantity),
    packed: l.assemblyLines.reduce((s, a) => s + num(a.quantity), 0),
    invoiced: l.invoiceLines.reduce((s, i) => s + num(i.quantity), 0),
    dispatched: num(l.dispatchedQty),
  }));
}

@Injectable()
export class AssembliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListQuery, filters: { status?: AssemblyStatus; salesOrderId?: number }) {
    const args = listArgs(
      query,
      {
        searchFields: ['assemblyNo', 'salesOrder.soNo', 'salesOrder.customer.name', 'salesOrder.customerPoNo'],
        sortable: ['assemblyNo', 'assemblyDate', 'status'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      { ...(filters.status ? { status: filters.status } : {}), ...(filters.salesOrderId ? { salesOrderId: filters.salesOrderId } : {}) },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.assembly.findMany({
        ...args,
        include: {
          salesOrder: { select: { id: true, soNo: true, customer: { select: { name: true } } } },
          lines: { select: { quantity: true, salesOrderLine: { select: { product: { select: { name: true } } } } } },
          invoices: { where: { status: { not: InvoiceStatus.CANCELLED } }, select: { id: true, invoiceNo: true, status: true } },
        },
      }),
      this.prisma.assembly.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  async get(id: number) {
    const a = await this.prisma.assembly.findUnique({ where: { id }, include: assemblyInclude });
    if (!a) throw new NotFoundException('Packing not found');
    return a;
  }

  /**
   * For the "pack sets" screen: per order line the sets still to pack and, per part,
   * the heats in the FG store (oldest first) to take them from.
   */
  async plan(salesOrderId: number) {
    const so = await this.prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      include: {
        customer: { select: { name: true } },
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            product: { select: { id: true, name: true, components: { include: { partType: true }, orderBy: { partType: { sortOrder: 'asc' } } } } },
          },
        },
      },
    });
    const progress = await orderProgress(this.prisma, salesOrderId);
    const items = await this.prisma.item.findMany({ where: { productId: { in: so.lines.map((l) => l.productId) } } });
    const balances = await this.prisma.stockBalance.findMany({
      where: { kind: StockKind.FINISHED_GOOD, location: StockLocation.FG_STORE, itemId: { in: items.map((i) => i.id) }, quantity: { gt: 0 } },
      include: { heat: { select: { id: true, heatNo: true, receivedDate: true } } },
      orderBy: [{ heat: { receivedDate: 'asc' } }, { id: 'asc' }],
    });
    return {
      salesOrder: { id: so.id, soNo: so.soNo, status: so.status, customerPoNo: so.customerPoNo, customer: so.customer },
      lines: so.lines.map((l) => {
        const p = progress.find((x) => x.lineId === l.id)!;
        const parts = l.product.components.map((c) => {
          const end = c.partType.hasEndConnection ? l.endConnection : EndConnection.NONE;
          const item = items.find((i) => i.partTypeId === c.partTypeId && i.productId === l.productId && i.endConnection === end);
          const heats = item
            ? balances.filter((b) => b.itemId === item.id).map((b) => ({ heatId: b.heatId, heatNo: b.heat?.heatNo ?? null, quantity: num(b.quantity) }))
            : [];
          return {
            partName: c.partType.name,
            perSet: num(c.quantity),
            item: item ? { id: item.id, code: item.code, name: item.name } : null,
            inStock: heats.reduce((s, h) => s + h.quantity, 0),
            heats,
          };
        });
        const remaining = Math.max(0, p.ordered - p.packed);
        const canMake = parts.length ? Math.min(...parts.map((pt) => Math.floor(pt.inStock / (pt.perSet || 1)))) : 0;
        return {
          lineId: l.id,
          lineNo: l.lineNo,
          product: { id: l.product.id, name: l.product.name },
          endConnection: l.endConnection,
          ordered: p.ordered,
          packed: p.packed,
          remaining,
          /** Sets that can be packed now from FG stock. */
          canPack: Math.min(remaining, canMake),
          parts,
        };
      }),
    };
  }

  async create(input: AssemblyInput, actor: Actor) {
    const result = await this.prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findUniqueOrThrow({
        where: { id: input.salesOrderId },
        include: { lines: { include: { product: { include: { components: { include: { partType: true } } } } } } },
      });
      if (!PACKABLE.includes(so.status)) throw new BadRequestException(`${so.soNo} is ${so.status.toLowerCase().replace('_', ' ')} - nothing to pack`);
      const progress = await orderProgress(tx, so.id);
      const lineIds = input.lines.map((l) => l.salesOrderLineId);
      if (new Set(lineIds).size !== lineIds.length) throw new BadRequestException('Each order line only once, please');
      const items = await tx.item.findMany({ where: { productId: { in: so.lines.map((l) => l.productId) } } });

      const assemblyDate = new Date(`${input.assemblyDate}T00:00:00Z`);
      const assemblyNo = await this.numbering.next('ASSEMBLY', { tx, date: assemblyDate });
      const f = normalize({ packingType: input.packingType, packedBy: input.packedBy, remarks: input.remarks });
      const created = await tx.assembly.create({
        data: {
          assemblyNo,
          assemblyDate,
          salesOrderId: so.id,
          packingType: f.packingType,
          packedBy: f.packedBy,
          packages: input.packages ?? null,
          grossWeightKg: input.grossWeightKg ?? null,
          remarks: f.remarks,
          createdById: actor.userId,
        },
      });

      for (const [i, line] of input.lines.entries()) {
        const soLine = so.lines.find((l) => l.id === line.salesOrderLineId);
        if (!soLine) throw new BadRequestException(`Line ${i + 1} is not on ${so.soNo}`);
        const p = progress.find((x) => x.lineId === soLine.id)!;
        const remaining = p.ordered - p.packed;
        if (line.quantity > remaining) {
          throw new BadRequestException({ message: `${soLine.product.name}: only ${remaining} set(s) left to pack`, errors: { [`lines.${i}.quantity`]: `Max ${remaining}` } });
        }
        await tx.assemblyLine.create({ data: { assemblyId: created.id, salesOrderLineId: soLine.id, quantity: line.quantity } });
        // Every part of the set must be taken, in the right number, from the heats given.
        for (const c of soLine.product.components) {
          const end = c.partType.hasEndConnection ? soLine.endConnection : EndConnection.NONE;
          const item = items.find((it) => it.partTypeId === c.partTypeId && it.productId === soLine.productId && it.endConnection === end);
          if (!item) throw new BadRequestException(`${soLine.product.name}: the ${c.partType.name} item is missing - generate the items first`);
          const part = line.parts.find((pt) => pt.itemId === item.id);
          const needed = line.quantity * num(c.quantity);
          const given = part?.heats.reduce((s, h) => s + h.quantity, 0) ?? 0;
          if (given !== needed) {
            throw new BadRequestException(`${soLine.product.name}: ${needed} × ${c.partType.name} needed for ${line.quantity} set(s), ${given} chosen`);
          }
          for (const h of part!.heats) {
            await this.stock.post(tx, {
              kind: StockKind.FINISHED_GOOD,
              itemId: item.id,
              heatId: h.heatId ?? null,
              location: StockLocation.FG_STORE,
              quantity: -h.quantity,
              refType: StockRefType.ASSEMBLY,
              refId: created.id,
              refNo: assemblyNo,
              date: assemblyDate,
              remarks: `Packed for ${so.soNo}`,
              userId: actor.userId,
            });
            await tx.assemblyConsumption.create({ data: { assemblyId: created.id, itemId: item.id, heatId: h.heatId ?? null, quantity: h.quantity } });
          }
        }
        if (line.parts.some((pt) => !items.some((it) => it.id === pt.itemId && it.productId === soLine.productId))) {
          throw new BadRequestException(`${soLine.product.name}: a chosen part does not belong to this product`);
        }
      }
      const sets = input.lines.reduce((s, l) => s + l.quantity, 0);
      await this.audit.log(actor, { action: AuditAction.CREATE, entity: 'assembly', entityId: created.id, summary: `Packed ${sets} set(s) for ${so.soNo} (${assemblyNo})` }, tx);
      return created;
    });
    await this.notifications.toPermission('invoices.create', { title: `${result.assemblyNo} packed - make the invoice`, link: `/dispatch/packing/${result.id}` }, actor.userId);
    return { id: result.id, assemblyNo: result.assemblyNo };
  }

  /** Unpack: the parts go back into the FG store under their heats. Only before it is invoiced. */
  async cancel(id: number, reason: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const a = await tx.assembly.findUniqueOrThrow({ where: { id }, include: { consumptions: true, invoices: true, salesOrder: true } });
      if (a.status !== AssemblyStatus.PACKED) throw new BadRequestException(`${a.assemblyNo} is ${a.status.toLowerCase()} - cancel its invoice first`);
      if (a.invoices.some((i) => i.status !== InvoiceStatus.CANCELLED)) throw new BadRequestException(`An invoice is made for ${a.assemblyNo} - delete or cancel it first`);
      for (const c of a.consumptions) {
        await this.stock.post(tx, {
          kind: StockKind.FINISHED_GOOD,
          itemId: c.itemId,
          heatId: c.heatId,
          location: StockLocation.FG_STORE,
          quantity: num(c.quantity),
          refType: StockRefType.ASSEMBLY,
          refId: a.id,
          refNo: a.assemblyNo,
          remarks: `Unpacked: ${reason}`,
          userId: actor.userId,
        });
      }
      await tx.assembly.update({ where: { id }, data: { status: AssemblyStatus.CANCELLED, cancelReason: reason } });
      await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'assembly', entityId: id, summary: `Cancelled ${a.assemblyNo} (${a.salesOrder.soNo}): ${reason}` }, tx);
    });
  }
}
