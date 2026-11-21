import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DispatchInput, ListQuery } from '@bht/shared';
import { AssemblyStatus, AuditAction, InvoiceStatus, JobWorkStatus, Prisma, ProductionRequestStatus, SalesOrderStatus } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { listArgs, paginated } from '../common/list';
import { normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';
import { renderPackingListPdf } from './packing-list-pdf';

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

/** Goods cannot leave before the invoice that covers them (GST: invoice at or before removal). */
function notBeforeInvoice(dispatchDate: Date, invoiceDate: Date) {
  if (dispatchDate.getTime() < invoiceDate.getTime()) {
    const d = invoiceDate.toISOString().slice(0, 10).split('-').reverse().join('-');
    throw new BadRequestException(`Dispatch date cannot be before the invoice date (${d})`);
  }
}

export const dispatchInclude = {
  salesOrder: { select: { id: true, soNo: true, customerPoNo: true, customerPoDate: true, customer: { select: { id: true, name: true } } } },
  invoice: {
    select: {
      id: true,
      invoiceNo: true,
      invoiceDate: true,
      status: true,
      shippingName: true,
      shippingAddress: true,
      billingName: true,
      billingAddress: true,
      company: true,
      assembly: {
        select: {
          id: true,
          assemblyNo: true,
          packingType: true,
          packedBy: true,
          consumptions: { include: { item: { select: { id: true, code: true, name: true, productId: true, partType: { select: { name: true, sortOrder: true } } } }, heat: { select: { heatNo: true, millHeatNo: true } } } },
        },
      },
    },
  },
  createdBy: { select: { id: true, name: true } },
  lines: { include: { salesOrderLine: { select: { id: true, lineNo: true, endConnection: true, product: { select: { id: true, name: true } } } } } },
} as const satisfies Prisma.DispatchInclude;

export type DispatchFull = Prisma.DispatchGetPayload<{ include: typeof dispatchInclude }>;

@Injectable()
export class DispatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(query: ListQuery, filters: { salesOrderId?: number }) {
    const args = listArgs(
      query,
      {
        searchFields: ['dispatchNo', 'challanNo', 'lrNo', 'vehicleNo', 'transporter', 'salesOrder.soNo', 'salesOrder.customer.name', 'invoice.invoiceNo'],
        sortable: ['dispatchNo', 'dispatchDate'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      { ...(filters.salesOrderId ? { salesOrderId: filters.salesOrderId } : {}) },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.dispatch.findMany({
        ...args,
        include: {
          salesOrder: { select: { id: true, soNo: true, customer: { select: { name: true } } } },
          invoice: { select: { id: true, invoiceNo: true } },
          lines: { select: { quantity: true, salesOrderLine: { select: { product: { select: { name: true } } } } } },
        },
      }),
      this.prisma.dispatch.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  async get(id: number): Promise<DispatchFull> {
    const d = await this.prisma.dispatch.findUnique({ where: { id }, include: dispatchInclude });
    if (!d) throw new NotFoundException('Dispatch not found');
    return d;
  }

  /** The sets on an issued invoice leave the factory. */
  async create(invoiceId: number, input: DispatchInput, actor: Actor) {
    const d = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true, dispatches: true, salesOrder: true } });
      if (inv.status !== InvoiceStatus.ISSUED) throw new BadRequestException('Only an issued invoice can be dispatched');
      if (!inv.salesOrderId || !inv.salesOrder) throw new BadRequestException('This invoice is not for a sales order');
      const active = inv.dispatches.find((x) => !x.cancelledAt);
      if (active) throw new BadRequestException(`Already dispatched as ${active.dispatchNo}`);
      const lines = inv.lines.filter((l) => l.salesOrderLineId);
      const dispatchDate = new Date(`${input.dispatchDate}T00:00:00Z`);
      notBeforeInvoice(dispatchDate, inv.invoiceDate);
      const created = await tx.dispatch.create({
        data: {
          ...normalize({ ...input, dispatchDate: undefined }),
          dispatchNo: await this.numbering.next('DISPATCH', { tx, date: dispatchDate }),
          dispatchDate,
          packages: input.packages ?? null,
          grossWeightKg: input.grossWeightKg ?? null,
          salesOrderId: inv.salesOrderId,
          invoiceId: inv.id,
          createdById: actor.userId,
          lines: { create: lines.map((l) => ({ salesOrderLineId: l.salesOrderLineId!, quantity: l.quantity })) },
        },
      });
      for (const l of lines) {
        await tx.salesOrderLine.update({ where: { id: l.salesOrderLineId! }, data: { dispatchedQty: { increment: l.quantity } } });
      }
      if (inv.assemblyId) await tx.assembly.update({ where: { id: inv.assemblyId }, data: { status: AssemblyStatus.DISPATCHED } });
      // The invoice keeps the transport details too (printed on it).
      await tx.invoice.update({ where: { id: inv.id }, data: { transporter: input.transporter || inv.transporter, vehicleNo: input.vehicleNo || inv.vehicleNo } });
      await refreshOrderStatus(tx, inv.salesOrderId);
      await this.audit.log(
        actor,
        { action: AuditAction.CREATE, entity: 'dispatch', entityId: created.id, summary: `Dispatched ${inv.invoiceNo} (${inv.salesOrder.soNo}) as ${created.dispatchNo}${input.vehicleNo ? `, vehicle ${input.vehicleNo}` : ''}` },
        tx,
      );
      return created;
    });
    return { id: d.id, dispatchNo: d.dispatchNo };
  }

  /** Correct transport details after dispatch (quantities stay). */
  async update(id: number, input: DispatchInput, actor: Actor) {
    const d = await this.get(id);
    if (d.cancelledAt) throw new BadRequestException(`${d.dispatchNo} is cancelled`);
    if (d.invoice) notBeforeInvoice(new Date(`${input.dispatchDate}T00:00:00Z`), d.invoice.invoiceDate);
    await this.prisma.dispatch.update({
      where: { id },
      data: { ...normalize(input), packages: input.packages ?? null, grossWeightKg: input.grossWeightKg ?? null },
    });
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'dispatch', entityId: id, summary: `Updated transport details of ${d.dispatchNo}` });
    return this.get(id);
  }

  /** Goods did not leave / came back: the order quantities are open again. */
  async cancel(id: number, reason: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispatch.findUniqueOrThrow({ where: { id }, include: { lines: true, invoice: true } });
      if (d.cancelledAt) throw new BadRequestException(`${d.dispatchNo} is already cancelled`);
      await tx.dispatch.update({ where: { id }, data: { cancelledAt: new Date(), cancelReason: reason } });
      for (const l of d.lines) {
        await tx.salesOrderLine.update({ where: { id: l.salesOrderLineId }, data: { dispatchedQty: { decrement: l.quantity } } });
      }
      if (d.invoice?.assemblyId) await tx.assembly.update({ where: { id: d.invoice.assemblyId }, data: { status: AssemblyStatus.INVOICED } });
      await refreshOrderStatus(tx, d.salesOrderId);
      await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'dispatch', entityId: id, summary: `Cancelled dispatch ${d.dispatchNo}: ${reason}` }, tx);
    });
  }

  async pdf(id: number) {
    const d = await this.get(id);
    return { fileName: `${d.dispatchNo.replace(/[^\w-]+/g, '-')}-packing-list.pdf`, buffer: await renderPackingListPdf(d) };
  }
}

/** Dispatched / part dispatched from the line quantities; back to in production / approved when nothing left. */
export async function refreshOrderStatus(tx: Tx, salesOrderId: number) {
  const so = await tx.salesOrder.findUniqueOrThrow({
    where: { id: salesOrderId },
    include: {
      lines: { include: { productionRequests: { select: { status: true } }, jobWorkLines: { select: { jobWorkOrder: { select: { status: true } } } } } },
      assemblies: { select: { status: true } },
    },
  });
  if (so.status === SalesOrderStatus.CANCELLED || so.status === SalesOrderStatus.CLOSED) return;
  const all = so.lines.every((l) => num(l.dispatchedQty) >= num(l.quantity));
  const some = so.lines.some((l) => num(l.dispatchedQty) > 0);
  const working =
    so.lines.some((l) => l.productionRequests.some((r) => r.status !== ProductionRequestStatus.CANCELLED && r.status !== ProductionRequestStatus.REJECTED)) ||
    so.lines.some((l) => l.jobWorkLines.some((j) => j.jobWorkOrder.status !== JobWorkStatus.CANCELLED)) ||
    so.assemblies.some((a) => a.status !== AssemblyStatus.CANCELLED);
  const status = all ? SalesOrderStatus.DISPATCHED : some ? SalesOrderStatus.PARTIALLY_DISPATCHED : working ? SalesOrderStatus.IN_PRODUCTION : SalesOrderStatus.APPROVED;
  if (status !== so.status) await tx.salesOrder.update({ where: { id: salesOrderId }, data: { status } });
}
