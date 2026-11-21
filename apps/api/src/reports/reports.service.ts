import { Injectable } from '@nestjs/common';
import { END_CONNECTION_LABELS, type PendingOrdersQuery, type ProductionReportQuery, type StockMovementQuery } from '@bht/shared';
import { Prisma, SalesOrderStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const n = (v: Prisma.Decimal | number | string | null | undefined) => (v == null ? 0 : Number(v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A date-only column (stored at UTC midnight). */
export const dateOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
/** Start / end of a day in India, for date-time columns (stage done at, slip created at ...). */
export const dayStartIst = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);
export const dayEndIst = (ymd: string) => new Date(`${ymd}T23:59:59.999+05:30`);
/** "2026-10" of a date-time, in India. */
export const monthIst = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 7);
export const todayYmd = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** Orders whose sets are still to be dispatched. */
const OPEN_ORDER: SalesOrderStatus[] = [SalesOrderStatus.APPROVED, SalesOrderStatus.IN_PRODUCTION, SalesOrderStatus.PARTIALLY_DISPATCHED];

/** Stock, production and order-book reports (operations; no money except order values). */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------- stock movement

  /** Opening, in, out and closing per raw material (kg) or item (pcs) for a period; optionally per heat. */
  async stockMovement(q: StockMovementQuery) {
    const rm = q.kind === 'RAW_MATERIAL';
    const byHeat = q.byHeat === 'true';
    const from = dateOf(q.from);
    const conditions = [Prisma.sql`l.kind = ${q.kind}`, Prisma.sql`l.date <= ${dateOf(q.to)}`];
    if (q.location) conditions.push(Prisma.sql`l.location = ${q.location}`);
    if (rm && q.rawMaterialId) conditions.push(Prisma.sql`l.raw_material_id = ${q.rawMaterialId}`);
    if (rm && q.gradeId) conditions.push(Prisma.sql`l.raw_material_id IN (SELECT id FROM raw_materials WHERE grade_id = ${q.gradeId})`);
    if (!rm && q.itemId) conditions.push(Prisma.sql`l.item_id = ${q.itemId}`);
    if (!rm && q.productId) conditions.push(Prisma.sql`l.item_id IN (SELECT id FROM items WHERE product_id = ${q.productId})`);

    const rows = await this.prisma.$queryRaw<{ subjectId: number; heatId: number | null; opening: unknown; qtyIn: unknown; qtyOut: unknown }[]>`
      SELECT ${Prisma.raw(rm ? 'l.raw_material_id' : 'l.item_id')} AS subjectId,
             ${Prisma.raw(byHeat ? 'l.heat_id' : 'NULL')} AS heatId,
             SUM(CASE WHEN l.date < ${from} THEN l.qty_in - l.qty_out ELSE 0 END) AS opening,
             SUM(CASE WHEN l.date >= ${from} THEN l.qty_in ELSE 0 END) AS qtyIn,
             SUM(CASE WHEN l.date >= ${from} THEN l.qty_out ELSE 0 END) AS qtyOut
      FROM stock_ledger l
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY subjectId, heatId`;

    const ids = [...new Set(rows.map((r) => Number(r.subjectId)))];
    const heatIds = [...new Set(rows.map((r) => r.heatId).filter((h): h is number => h != null).map(Number))];
    const [subjects, heats] = await Promise.all([
      rm
        ? this.prisma.rawMaterial.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, size: true, uom: true, grade: { select: { name: true } } } }).then((list) =>
            list.map((s) => ({ id: s.id, code: s.code, name: `${s.grade.name} ${s.size}`, uom: s.uom })),
          )
        : this.prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, uom: true } }),
      heatIds.length ? this.prisma.heat.findMany({ where: { id: { in: heatIds } }, select: { id: true, heatNo: true, millHeatNo: true } }) : [],
    ]);
    const subjectOf = new Map(subjects.map((s) => [s.id, s]));
    const heatOf = new Map(heats.map((h) => [h.id, h]));

    const data = rows
      .map((r) => {
        const opening = r3(n(r.opening as string));
        const qtyIn = r3(n(r.qtyIn as string));
        const qtyOut = r3(n(r.qtyOut as string));
        const s = subjectOf.get(Number(r.subjectId))!;
        return {
          id: s.id,
          code: s.code,
          name: s.name,
          uom: s.uom,
          heat: r.heatId != null ? (heatOf.get(Number(r.heatId)) ?? null) : null,
          opening,
          in: qtyIn,
          out: qtyOut,
          closing: r3(opening + qtyIn - qtyOut),
        };
      })
      .filter((r) => q.hideEmpty === 'false' || r.opening !== 0 || r.in !== 0 || r.out !== 0)
      .sort((a, b) => a.code.localeCompare(b.code) || (a.heat?.heatNo ?? '').localeCompare(b.heat?.heatNo ?? ''));

    const total = (f: (r: (typeof data)[number]) => number) => r3(data.reduce((s, r) => s + f(r), 0));
    return {
      from: q.from,
      to: q.to,
      kind: q.kind,
      location: q.location ?? null,
      rows: data,
      totals: { opening: total((r) => r.opening), in: total((r) => r.in), out: total((r) => r.out), closing: total((r) => r.closing) },
    };
  }

  // ---------------------------------------------------------- production

  /** Output and rejections of route cards (stages done in the period) and job work received. */
  async production(q: ProductionReportQuery) {
    const start = dayStartIst(q.from);
    const end = dayEndIst(q.to);
    const itemFilter = q.productId ? { item: { productId: q.productId } } : {};

    const [ops, completions, started, receipts] = await Promise.all([
      this.prisma.routeCardOperation.findMany({
        where: { status: 'DONE', completedAt: { gte: start, lte: end }, stage: { isMaterialCheck: false }, routeCard: { status: { not: 'CANCELLED' }, ...itemFilter } },
        orderBy: { completedAt: 'asc' },
        select: {
          okQty: true,
          rejectedQty: true,
          rejectionReason: true,
          completedAt: true,
          stage: { select: { id: true, name: true, sequence: true } },
          updatedBy: { select: { name: true } },
          routeCard: { select: { id: true, rcNo: true, item: { select: { id: true, code: true, name: true } } } },
        },
      }),
      this.prisma.rcCompletion.findMany({
        where: { createdAt: { gte: start, lte: end }, routeCard: itemFilter },
        select: { okQty: true, createdAt: true, routeCard: { select: { item: { select: { id: true, code: true, name: true } } } } },
      }),
      this.prisma.routeCard.count({ where: { rcDate: { gte: dateOf(q.from), lte: dateOf(q.to) }, status: { not: 'CANCELLED' }, ...itemFilter } }),
      this.prisma.jobWorkReceiptLine.findMany({
        where: { jobWorkReceipt: { receiptDate: { gte: dateOf(q.from), lte: dateOf(q.to) } }, ...(q.productId ? { item: { productId: q.productId } } : {}) },
        select: { receivedQty: true, acceptedQty: true, rejectedQty: true, jobWorkReceipt: { select: { receiptDate: true, jobWorkOrder: { select: { supplier: { select: { id: true, name: true } } } } } } },
      }),
    ]);

    const finishedOk = r3(completions.reduce((s, c) => s + n(c.okQty), 0));
    const rejected = r3(ops.reduce((s, o) => s + n(o.rejectedQty), 0));

    const byStage = new Map<number, { stage: string; sequence: number; received: number; ok: number; rejected: number }>();
    const byReason = new Map<string, { reason: string; rejected: number; cards: Set<string> }>();
    const byItem = new Map<number, { item: { id: number; code: string; name: string }; finishedOk: number; rejected: number }>();
    const months = new Map<string, { month: string; finishedOk: number; rejected: number; jobWorkAccepted: number }>();
    const month = (key: string) => {
      if (!months.has(key)) months.set(key, { month: key, finishedOk: 0, rejected: 0, jobWorkAccepted: 0 });
      return months.get(key)!;
    };
    const item = (it: { id: number; code: string; name: string }) => {
      if (!byItem.has(it.id)) byItem.set(it.id, { item: it, finishedOk: 0, rejected: 0 });
      return byItem.get(it.id)!;
    };
    for (const o of ops) {
      const ok = n(o.okQty);
      const rej = n(o.rejectedQty);
      const st = byStage.get(o.stage.id) ?? { stage: o.stage.name, sequence: o.stage.sequence, received: 0, ok: 0, rejected: 0 };
      st.received = r3(st.received + ok + rej);
      st.ok = r3(st.ok + ok);
      st.rejected = r3(st.rejected + rej);
      byStage.set(o.stage.id, st);
      if (rej > 0) {
        const reason = o.rejectionReason?.trim() || 'No reason given';
        const key = reason.toLowerCase();
        const rr = byReason.get(key) ?? { reason, rejected: 0, cards: new Set<string>() };
        rr.rejected = r3(rr.rejected + rej);
        rr.cards.add(o.routeCard.rcNo);
        byReason.set(key, rr);
        item(o.routeCard.item).rejected = r3(item(o.routeCard.item).rejected + rej);
        month(monthIst(o.completedAt!)).rejected = r3(month(monthIst(o.completedAt!)).rejected + rej);
      }
    }
    for (const c of completions) {
      item(c.routeCard.item).finishedOk = r3(item(c.routeCard.item).finishedOk + n(c.okQty));
      month(monthIst(c.createdAt)).finishedOk = r3(month(monthIst(c.createdAt)).finishedOk + n(c.okQty));
    }
    const vendors = new Map<number, { vendor: string; received: number; accepted: number; rejected: number }>();
    for (const l of receipts) {
      const s = l.jobWorkReceipt.jobWorkOrder.supplier;
      const v = vendors.get(s.id) ?? { vendor: s.name, received: 0, accepted: 0, rejected: 0 };
      v.received = r3(v.received + n(l.receivedQty));
      v.accepted = r3(v.accepted + n(l.acceptedQty));
      v.rejected = r3(v.rejected + n(l.rejectedQty));
      vendors.set(s.id, v);
      const m = month(l.jobWorkReceipt.receiptDate.toISOString().slice(0, 7));
      m.jobWorkAccepted = r3(m.jobWorkAccepted + n(l.acceptedQty));
    }
    const rate = (rej: number, total: number) => (total > 0 ? r2((rej / total) * 100) : 0);

    return {
      from: q.from,
      to: q.to,
      summary: {
        cardsStarted: started,
        cardsFinished: completions.length,
        finishedOk,
        rejected,
        rejectionRate: rate(rejected, finishedOk + rejected),
        jobWorkAccepted: r3([...vendors.values()].reduce((s, v) => s + v.accepted, 0)),
      },
      byStage: [...byStage.values()].sort((a, b) => a.sequence - b.sequence).map(({ sequence: _s, ...s }) => ({ ...s, rate: rate(s.rejected, s.received) })),
      byReason: [...byReason.values()].sort((a, b) => b.rejected - a.rejected).map((r) => ({ reason: r.reason, rejected: r.rejected, cards: [...r.cards] })),
      byItem: [...byItem.values()].sort((a, b) => b.finishedOk + b.rejected - (a.finishedOk + a.rejected)).map((r) => ({ ...r, rate: rate(r.rejected, r.finishedOk + r.rejected) })),
      jobWork: [...vendors.values()].sort((a, b) => b.received - a.received).map((v) => ({ ...v, rate: rate(v.rejected, v.received) })),
      months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
      rejections: ops
        .filter((o) => n(o.rejectedQty) > 0)
        .map((o) => ({
          date: o.completedAt,
          rcId: o.routeCard.id,
          rcNo: o.routeCard.rcNo,
          item: o.routeCard.item,
          stage: o.stage.name,
          received: r3(n(o.okQty) + n(o.rejectedQty)),
          rejected: n(o.rejectedQty),
          reason: o.rejectionReason,
          by: o.updatedBy?.name ?? null,
        })),
    };
  }

  // ---------------------------------------------------------- order book

  /** Sales order lines with sets still to dispatch, oldest due date first. */
  async pendingOrders(q: PendingOrdersQuery) {
    const today = dateOf(todayYmd());
    const lines = await this.prisma.salesOrderLine.findMany({
      where: {
        salesOrder: { status: { in: OPEN_ORDER }, ...(q.customerId ? { customerId: q.customerId } : {}) },
        ...(q.productId ? { productId: q.productId } : {}),
      },
      orderBy: [{ salesOrder: { expectedDelivery: 'asc' } }, { salesOrder: { soDate: 'asc' } }, { lineNo: 'asc' }],
      select: {
        id: true,
        quantity: true,
        dispatchedQty: true,
        rate: true,
        decision: true,
        endConnection: true,
        service: true,
        product: { select: { id: true, name: true } },
        assemblyLines: { where: { assembly: { status: { not: 'CANCELLED' } } }, select: { quantity: true } },
        salesOrder: {
          select: { id: true, soNo: true, soDate: true, status: true, customerPoNo: true, currency: true, exchangeRate: true, expectedDelivery: true, customer: { select: { id: true, name: true } } },
        },
      },
    });
    const rows = lines
      .map((l) => {
        const so = l.salesOrder;
        const ordered = n(l.quantity);
        const dispatched = n(l.dispatchedQty);
        const pending = r3(ordered - dispatched);
        const due = so.expectedDelivery;
        const overdueDays = due && due.getTime() < today.getTime() ? Math.round((today.getTime() - due.getTime()) / 86_400_000) : 0;
        const value = r2(pending * n(l.rate));
        return {
          lineId: l.id,
          order: { id: so.id, soNo: so.soNo, soDate: so.soDate, status: so.status, customerPoNo: so.customerPoNo },
          customer: so.customer,
          product: l.product.name,
          spec: [l.endConnection !== 'NONE' && END_CONNECTION_LABELS[l.endConnection], l.service === 'SOUR' ? 'Sour' : null].filter(Boolean).join(' · '),
          decision: l.decision,
          ordered,
          packed: r3(l.assemblyLines.reduce((s, a) => s + n(a.quantity), 0)),
          dispatched,
          pending,
          dueDate: due,
          overdueDays,
          currency: so.currency,
          value,
          valueInr: r2(value * n(so.exchangeRate)),
        };
      })
      .filter((r) => r.pending > 0 && (q.overdue !== 'true' || r.overdueDays > 0));

    return {
      rows,
      summary: {
        orders: new Set(rows.map((r) => r.order.id)).size,
        lines: rows.length,
        pendingSets: r3(rows.reduce((s, r) => s + r.pending, 0)),
        valueInr: r2(rows.reduce((s, r) => s + r.valueInr, 0)),
        overdueLines: rows.filter((r) => r.overdueDays > 0).length,
        overdueValueInr: r2(rows.filter((r) => r.overdueDays > 0).reduce((s, r) => s + r.valueInr, 0)),
      },
    };
  }
}
