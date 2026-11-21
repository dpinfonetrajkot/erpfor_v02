import { Injectable, NotFoundException } from '@nestjs/common';
import { END_CONNECTION_LABELS } from '@bht/shared';
import { Prisma, StockKind, StockLocation, StockRefType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const sum = <T>(rows: T[], f: (r: T) => number) => r3(rows.reduce((s, r) => s + f(r), 0));

/** Files a trace lists (MTC, test reports); anyone allowed to trace may open them. */
export const TRACE_FILE_ENTITIES = ['heat', 'goods_receipt', 'route_card_operation', 'job_work_receipt'];

const itemSelect = { id: true, code: true, name: true } as const;
const orderSelect = { id: true, soNo: true, soDate: true, status: true, customerPoNo: true, customer: { select: { id: true, name: true } } } as const;
const heatSelect = {
  id: true,
  heatNo: true,
  millHeatNo: true,
  rawMaterial: { select: { code: true, size: true, grade: { select: { name: true } } } },
  supplier: { select: { name: true } },
} as const;

type HeatRow = Prisma.HeatGetPayload<{ select: typeof heatSelect }>;
const heatInfo = (h: HeatRow) => ({ id: h.id, heatNo: h.heatNo, millHeatNo: h.millHeatNo, grade: h.rawMaterial.grade.name, size: h.rawMaterial.size, supplier: h.supplier?.name ?? null });

/**
 * Heat traceability: forward from a bar heat to the parts, packings, invoices and customers,
 * and backward from an order to the heats (mill heat, supplier, gate entry) of every part.
 */
@Injectable()
export class TraceabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** One box for everything: heat / mill heat, SO, customer PO, invoice or dispatch number. */
  async search(q: string) {
    const term = q.trim();
    if (term.length < 2) return { heats: [], orders: [] };
    const [heats, orders, invoices, dispatches] = await Promise.all([
      this.prisma.heat.findMany({
        where: { OR: [{ heatNo: { contains: term } }, { millHeatNo: { contains: term } }] },
        orderBy: { heatNo: 'asc' },
        take: 10,
        select: { ...heatSelect, receivedDate: true },
      }),
      this.prisma.salesOrder.findMany({ where: { OR: [{ soNo: { contains: term } }, { customerPoNo: { contains: term } }] }, orderBy: { id: 'desc' }, take: 10, select: orderSelect }),
      this.prisma.invoice.findMany({ where: { invoiceNo: { contains: term }, salesOrderId: { not: null } }, orderBy: { id: 'desc' }, take: 10, select: { invoiceNo: true, salesOrder: { select: orderSelect } } }),
      this.prisma.dispatch.findMany({ where: { dispatchNo: { contains: term } }, orderBy: { id: 'desc' }, take: 10, select: { dispatchNo: true, salesOrder: { select: orderSelect } } }),
    ]);
    const found = new Map<number, (typeof orders)[number] & { matched: string }>();
    for (const so of orders) found.set(so.id, { ...so, matched: so.soNo.toLowerCase().includes(term.toLowerCase()) ? so.soNo : `Customer PO ${so.customerPoNo}` });
    for (const inv of invoices) if (inv.salesOrder && !found.has(inv.salesOrder.id)) found.set(inv.salesOrder.id, { ...inv.salesOrder, matched: `Invoice ${inv.invoiceNo}` });
    for (const d of dispatches) if (!found.has(d.salesOrder.id)) found.set(d.salesOrder.id, { ...d.salesOrder, matched: `Dispatch ${d.dispatchNo}` });
    return {
      heats: heats.map((h) => ({ ...heatInfo(h), receivedDate: h.receivedDate })),
      orders: [...found.values()].slice(0, 10),
    };
  }

  // ------------------------------------------------------------------ heat

  async heat(id: number) {
    const heat = await this.prisma.heat.findUnique({ where: { id }, select: { ...heatSelect, status: true, receivedDate: true, remarks: true, rawMaterial: { select: { id: true, code: true, size: true, grade: { select: { name: true } } } } } });
    if (!heat) throw new NotFoundException('Heat not found');

    const [grnLines, issues, jwLines, consumptions, balances, ledger] = await Promise.all([
      this.prisma.goodsReceiptLine.findMany({
        where: { heatId: id },
        orderBy: { id: 'asc' },
        select: {
          receivedQty: true,
          acceptedQty: true,
          rejectedQty: true,
          qcStatus: true,
          qcRemarks: true,
          goodsReceipt: { select: { id: true, grnNo: true, grnDate: true, supplierInvoice: true, supplier: { select: { name: true } }, purchaseOrder: { select: { id: true, poNo: true } } } },
        },
      }),
      this.prisma.materialIssue.findMany({
        where: { heatId: id },
        orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
        select: {
          quantity: true,
          routeCard: {
            select: {
              id: true, rcNo: true, rcDate: true, status: true, plannedQty: true, extraQty: true, completedQty: true, rejectedQty: true,
              item: { select: itemSelect },
              salesOrderLine: { select: { salesOrder: { select: orderSelect } } },
              operations: { select: { id: true, stage: { select: { name: true } } } },
            },
          },
          jobWorkMaterial: { select: { jobWorkOrder: { select: { id: true, jwoNo: true, jwoDate: true, status: true, supplier: { select: { name: true } } } } } },
        },
      }),
      this.prisma.jobWorkReceiptLine.findMany({
        where: { heatId: id },
        select: { receivedQty: true, acceptedQty: true, rejectedQty: true, item: { select: itemSelect }, jobWorkReceipt: { select: { id: true, receiptNo: true, receiptDate: true, jobWorkOrderId: true } } },
      }),
      this.prisma.assemblyConsumption.findMany({
        where: { heatId: id, assembly: { status: { not: 'CANCELLED' } } },
        orderBy: { assemblyId: 'asc' },
        select: {
          quantity: true,
          item: { select: itemSelect },
          assembly: {
            select: {
              id: true, assemblyNo: true, assemblyDate: true, status: true,
              salesOrder: { select: orderSelect },
              invoices: {
                where: { status: { not: 'CANCELLED' } },
                select: { id: true, invoiceNo: true, invoiceDate: true, status: true, dispatches: { where: { cancelledAt: null }, select: { id: true, dispatchNo: true, dispatchDate: true, transporter: true, lrNo: true, vehicleNo: true } } },
              },
            },
          },
        },
      }),
      this.prisma.stockBalance.findMany({ where: { heatId: id, quantity: { not: 0 } }, select: { kind: true, location: true, quantity: true, itemId: true, item: { select: itemSelect } } }),
      this.prisma.stockLedger.findMany({
        where: { heatId: id, kind: StockKind.RAW_MATERIAL },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        select: { id: true, date: true, location: true, qtyIn: true, qtyOut: true, refType: true, refNo: true, remarks: true },
      }),
    ]);

    // Route cards and job work orders that got bar of this heat (net of returns).
    const cards = new Map<number, { card: NonNullable<(typeof issues)[number]['routeCard']>; kg: number }>();
    const jobs = new Map<number, { jwo: NonNullable<(typeof issues)[number]['jobWorkMaterial']>['jobWorkOrder']; kg: number }>();
    for (const i of issues) {
      if (i.routeCard) {
        const row = cards.get(i.routeCard.id) ?? { card: i.routeCard, kg: 0 };
        row.kg = r3(row.kg + n(i.quantity));
        cards.set(i.routeCard.id, row);
      } else if (i.jobWorkMaterial) {
        const jwo = i.jobWorkMaterial.jobWorkOrder;
        const row = jobs.get(jwo.id) ?? { jwo, kg: 0 };
        row.kg = r3(row.kg + n(i.quantity));
        jobs.set(jwo.id, row);
      }
    }
    const opIds = [...cards.values()].flatMap((c) => c.card.operations.map((o) => o.id));
    const stageOf = new Map([...cards.values()].flatMap((c) => c.card.operations.map((o) => [o.id, { rcId: c.card.id, stage: o.stage.name }] as const)));
    const grnIds = [...new Set(grnLines.map((l) => l.goodsReceipt.id))];
    const [files, sources] = await Promise.all([
      this.prisma.attachment.findMany({
        where: {
          OR: [
            { entity: 'heat', entityId: id },
            ...(grnIds.length ? [{ entity: 'goods_receipt', entityId: { in: grnIds } }] : []),
            ...(opIds.length ? [{ entity: 'route_card_operation', entityId: { in: opIds } }] : []),
          ],
        },
        orderBy: { id: 'asc' },
        select: { id: true, entity: true, entityId: true, originalName: true },
      }),
      this.sourcesOf([id]),
    ]);
    const grnNo = new Map(grnLines.map((l) => [l.goodsReceipt.id, l.goodsReceipt.grnNo]));

    // Finished parts of this heat, per item.
    const parts = new Map<number, { item: { id: number; code: string; name: string }; made: number; packed: number; inStore: number; madeOn: string[] }>();
    const part = (item: { id: number; code: string; name: string }) => {
      if (!parts.has(item.id)) parts.set(item.id, { item, made: 0, packed: 0, inStore: 0, madeOn: [] });
      return parts.get(item.id)!;
    };
    for (const src of sources.values()) {
      const p = part(src.item);
      p.made = r3(p.made + src.quantity);
      p.madeOn = [...new Set([...p.madeOn, ...src.from])];
    }
    for (const c of consumptions) part(c.item).packed = r3(part(c.item).packed + n(c.quantity));
    for (const b of balances) if (b.kind === StockKind.FINISHED_GOOD && b.item && b.location === StockLocation.FG_STORE) part(b.item).inStore = r3(part(b.item).inStore + n(b.quantity));

    // Packings with parts of this heat, newest last, with their invoice and dispatch.
    const deliveries = new Map<number, { assembly: (typeof consumptions)[number]['assembly']; parts: { item: { id: number; code: string; name: string }; quantity: number }[] }>();
    for (const c of consumptions) {
      const d = deliveries.get(c.assembly.id) ?? { assembly: c.assembly, parts: [] };
      d.parts.push({ item: c.item, quantity: n(c.quantity) });
      deliveries.set(c.assembly.id, d);
    }
    const customers = [...new Set(consumptions.map((c) => c.assembly.salesOrder.customer.name))];
    const rmIn = (types: StockRefType[]) => sum(ledger.filter((l) => types.includes(l.refType) && l.location === StockLocation.RM_STORE), (l) => n(l.qtyIn));

    return {
      heat: {
        id: heat.id,
        heatNo: heat.heatNo,
        millHeatNo: heat.millHeatNo,
        status: heat.status,
        receivedDate: heat.receivedDate,
        remarks: heat.remarks,
        material: { id: heat.rawMaterial.id, code: heat.rawMaterial.code, grade: heat.rawMaterial.grade.name, size: heat.rawMaterial.size },
        supplier: heat.supplier?.name ?? null,
      },
      summary: {
        receivedKg: rmIn([StockRefType.GRN, StockRefType.OPENING]),
        toProductionKg: sum([...cards.values()], (c) => c.kg),
        toJobWorkKg: sum([...jobs.values()], (j) => j.kg),
        inStoreKg: sum(balances.filter((b) => b.kind === StockKind.RAW_MATERIAL && b.location === StockLocation.RM_STORE), (b) => n(b.quantity)),
        partsMade: sum([...parts.values()], (p) => p.made),
        partsPacked: sum([...parts.values()], (p) => p.packed),
        partsInStore: sum([...parts.values()], (p) => p.inStore),
        customers,
      },
      receipts: grnLines.map((l) => ({
        grnId: l.goodsReceipt.id,
        grnNo: l.goodsReceipt.grnNo,
        grnDate: l.goodsReceipt.grnDate,
        supplier: l.goodsReceipt.supplier.name,
        supplierInvoice: l.goodsReceipt.supplierInvoice,
        po: l.goodsReceipt.purchaseOrder,
        receivedQty: n(l.receivedQty),
        acceptedQty: n(l.acceptedQty),
        rejectedQty: n(l.rejectedQty),
        qcStatus: l.qcStatus,
        qcRemarks: l.qcRemarks,
      })),
      movements: ledger.map((l) => ({ id: l.id, date: l.date, type: l.refType, refNo: l.refNo, location: l.location, in: n(l.qtyIn), out: n(l.qtyOut), remarks: l.remarks })),
      routeCards: [...cards.values()].map(({ card, kg }) => ({
        id: card.id,
        rcNo: card.rcNo,
        rcDate: card.rcDate,
        status: card.status,
        item: card.item,
        kg,
        plannedQty: n(card.plannedQty),
        extraQty: n(card.extraQty),
        completedQty: n(card.completedQty),
        rejectedQty: n(card.rejectedQty),
        order: card.salesOrderLine?.salesOrder ?? null,
        reports: files.filter((f) => f.entity === 'route_card_operation' && stageOf.get(f.entityId)?.rcId === card.id).map((f) => ({ id: f.id, name: f.originalName, stage: stageOf.get(f.entityId)!.stage })),
      })),
      jobWork: [...jobs.values()].map(({ jwo, kg }) => ({
        ...jwo,
        supplier: jwo.supplier.name,
        kg,
        received: jwLines
          .filter((l) => l.jobWorkReceipt.jobWorkOrderId === jwo.id)
          .map((l) => ({ item: l.item, receiptNo: l.jobWorkReceipt.receiptNo, receiptDate: l.jobWorkReceipt.receiptDate, receivedQty: n(l.receivedQty), acceptedQty: n(l.acceptedQty), rejectedQty: n(l.rejectedQty) })),
      })),
      parts: [...parts.values()].sort((a, b) => a.item.name.localeCompare(b.item.name)),
      deliveries: [...deliveries.values()].map(({ assembly: a, parts: ps }) => ({
        assembly: { id: a.id, assemblyNo: a.assemblyNo, assemblyDate: a.assemblyDate, status: a.status },
        order: { id: a.salesOrder.id, soNo: a.salesOrder.soNo, customerPoNo: a.salesOrder.customerPoNo },
        customer: a.salesOrder.customer,
        parts: ps,
        invoices: a.invoices.map(({ dispatches: _d, ...inv }) => inv),
        dispatches: a.invoices.flatMap((i) => i.dispatches),
      })),
      documents: files
        .filter((f) => f.entity !== 'route_card_operation')
        .map((f) => ({ id: f.id, name: f.originalName, on: f.entity === 'heat' ? 'Heat' : `Gate entry ${grnNo.get(f.entityId) ?? ''}`.trim() })),
    };
  }

  // ------------------------------------------------------------------ order

  async order(id: number) {
    const so = await this.prisma.salesOrder.findUnique({
      where: { id },
      select: {
        ...orderSelect,
        customerPoDate: true,
        expectedDelivery: true,
        lines: {
          orderBy: { lineNo: 'asc' },
          select: { id: true, quantity: true, dispatchedQty: true, decision: true, endConnection: true, service: true, schedule: true, product: { select: { id: true, name: true } }, materialGrade: { select: { name: true } } },
        },
      },
    });
    if (!so) throw new NotFoundException('Sales order not found');

    const [routeCards, jobWork, assemblies, invoices, dispatches] = await Promise.all([
      this.prisma.routeCard.findMany({
        where: { salesOrderLine: { salesOrderId: id } },
        orderBy: { id: 'asc' },
        select: {
          id: true, rcNo: true, rcDate: true, status: true, plannedQty: true, extraQty: true, completedQty: true, rejectedQty: true,
          item: { select: itemSelect },
          materialIssues: { select: { quantity: true, heat: { select: heatSelect } } },
          operations: {
            orderBy: { sequence: 'asc' },
            select: {
              id: true, status: true, okQty: true, rejectedQty: true, rejectionReason: true, remarks: true, completedAt: true,
              stage: { select: { name: true, type: true, isMaterialCheck: true } },
              updatedBy: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.jobWorkOrder.findMany({
        where: { salesOrderId: id },
        orderBy: { id: 'asc' },
        select: {
          id: true, jwoNo: true, jwoDate: true, status: true, supplier: { select: { name: true } },
          materials: { select: { issues: { select: { quantity: true, heat: { select: heatSelect } } } } },
          receipts: {
            orderBy: { id: 'asc' },
            select: { id: true, receiptNo: true, receiptDate: true, lines: { select: { receivedQty: true, acceptedQty: true, rejectedQty: true, item: { select: itemSelect }, heat: { select: { heatNo: true } } } } },
          },
        },
      }),
      this.prisma.assembly.findMany({
        where: { salesOrderId: id },
        orderBy: { id: 'asc' },
        select: {
          id: true, assemblyNo: true, assemblyDate: true, status: true,
          lines: { select: { quantity: true, salesOrderLineId: true, salesOrderLine: { select: { product: { select: { name: true } } } } } },
          consumptions: { select: { quantity: true, item: { select: itemSelect }, heat: { select: heatSelect } } },
          invoices: { select: { id: true, invoiceNo: true } },
        },
      }),
      this.prisma.invoice.findMany({ where: { salesOrderId: id }, orderBy: { id: 'asc' }, select: { id: true, invoiceNo: true, invoiceDate: true, status: true, currency: true, grandTotal: true } }),
      this.prisma.dispatch.findMany({
        where: { salesOrderId: id },
        orderBy: { id: 'asc' },
        select: { id: true, dispatchNo: true, dispatchDate: true, transporter: true, lrNo: true, vehicleNo: true, cancelledAt: true, invoice: { select: { invoiceNo: true } } },
      }),
    ]);

    const packed = assemblies.filter((a) => a.status !== 'CANCELLED');
    const heatIds = [...new Set(packed.flatMap((a) => a.consumptions.map((c) => c.heat?.id).filter((h): h is number => !!h)))];
    const opIds = routeCards.flatMap((rc) => rc.operations.map((o) => o.id));
    const receiptIds = jobWork.flatMap((j) => j.receipts.map((r) => r.id));
    const [sources, grnLines, files] = await Promise.all([
      this.sourcesOf(heatIds),
      heatIds.length
        ? this.prisma.goodsReceiptLine.findMany({
            where: { heatId: { in: heatIds } },
            orderBy: { id: 'asc' },
            select: { heatId: true, qcStatus: true, goodsReceipt: { select: { id: true, grnNo: true, grnDate: true, purchaseOrder: { select: { id: true, poNo: true } } } } },
          })
        : [],
      this.prisma.attachment.findMany({
        where: {
          OR: [
            ...(heatIds.length ? [{ entity: 'heat', entityId: { in: heatIds } }] : []),
            ...(opIds.length ? [{ entity: 'route_card_operation', entityId: { in: opIds } }] : []),
            ...(receiptIds.length ? [{ entity: 'job_work_receipt', entityId: { in: receiptIds } }] : []),
          ],
        },
        orderBy: { id: 'asc' },
        select: { id: true, entity: true, entityId: true, originalName: true },
      }),
    ]);
    // MTC uploaded on the gate entry of a heat counts as that heat's document too.
    const grnIds = [...new Set(grnLines.map((g) => g.goodsReceipt.id))];
    const grnFiles = grnIds.length
      ? await this.prisma.attachment.findMany({ where: { entity: 'goods_receipt', entityId: { in: grnIds } }, select: { id: true, entityId: true, originalName: true } })
      : [];

    // Every heat that went into the packed sets: the material certificate table.
    const heats = new Map<number, { heat: ReturnType<typeof heatInfo>; parts: Map<number, { item: { id: number; code: string; name: string }; quantity: number }> }>();
    for (const a of packed) {
      for (const c of a.consumptions) {
        if (!c.heat) continue;
        const h = heats.get(c.heat.id) ?? { heat: heatInfo(c.heat), parts: new Map() };
        const p = h.parts.get(c.item.id) ?? { item: c.item, quantity: 0 };
        p.quantity = r3(p.quantity + n(c.quantity));
        h.parts.set(c.item.id, p);
        heats.set(c.heat.id, h);
      }
    }
    const packedOf = (lineId: number) => sum(packed.flatMap((a) => a.lines.filter((l) => l.salesOrderLineId === lineId)), (l) => n(l.quantity));

    return {
      order: {
        id: so.id, soNo: so.soNo, soDate: so.soDate, status: so.status, customerPoNo: so.customerPoNo, customerPoDate: so.customerPoDate,
        expectedDelivery: so.expectedDelivery, customer: so.customer,
      },
      lines: so.lines.map((l) => ({
        id: l.id,
        product: l.product.name,
        spec: [l.endConnection !== 'NONE' && END_CONNECTION_LABELS[l.endConnection], l.service === 'SOUR' ? 'Sour (NACE)' : null, l.schedule && `Sch. ${l.schedule}`, l.materialGrade?.name].filter(Boolean).join(' · '),
        quantity: n(l.quantity),
        decision: l.decision,
        packed: packedOf(l.id),
        dispatched: n(l.dispatchedQty),
      })),
      heats: [...heats.values()].map(({ heat, parts }) => {
        const grn = grnLines.find((g) => g.heatId === heat.id);
        return {
          ...heat,
          grn: grn ? { id: grn.goodsReceipt.id, grnNo: grn.goodsReceipt.grnNo, grnDate: grn.goodsReceipt.grnDate } : null,
          po: grn?.goodsReceipt.purchaseOrder ?? null,
          qcStatus: grn?.qcStatus ?? null,
          parts: [...parts.values()],
          documents: [
            ...files.filter((f) => f.entity === 'heat' && f.entityId === heat.id),
            ...grnFiles.filter((f) => grnLines.some((g) => g.heatId === heat.id && g.goodsReceipt.id === f.entityId)),
          ].map((f) => ({ id: f.id, name: f.originalName })),
        };
      }),
      packing: assemblies.map((a) => ({
        id: a.id,
        assemblyNo: a.assemblyNo,
        assemblyDate: a.assemblyDate,
        status: a.status,
        sets: a.lines.map((l) => ({ product: l.salesOrderLine.product.name, quantity: n(l.quantity) })),
        parts: a.consumptions.map((c) => ({
          item: c.item,
          heatNo: c.heat?.heatNo ?? null,
          millHeatNo: c.heat?.millHeatNo ?? null,
          quantity: n(c.quantity),
          madeOn: c.heat ? (sources.get(`${c.item.id}:${c.heat.id}`)?.from ?? []) : [],
        })),
        invoices: a.invoices,
      })),
      routeCards: routeCards.map((rc) => {
        const byHeat = new Map<string, { heatNo: string; millHeatNo: string | null; kg: number }>();
        for (const i of rc.materialIssues) {
          const h = byHeat.get(i.heat.heatNo) ?? { heatNo: i.heat.heatNo, millHeatNo: i.heat.millHeatNo, kg: 0 };
          h.kg = r3(h.kg + n(i.quantity));
          byHeat.set(i.heat.heatNo, h);
        }
        return {
          id: rc.id, rcNo: rc.rcNo, rcDate: rc.rcDate, status: rc.status, item: rc.item,
          plannedQty: n(rc.plannedQty), extraQty: n(rc.extraQty), completedQty: n(rc.completedQty), rejectedQty: n(rc.rejectedQty),
          heats: [...byHeat.values()].filter((h) => h.kg > 0),
          stages: rc.operations.map((o) => ({
            name: o.stage.name,
            type: o.stage.type,
            status: o.status,
            okQty: o.stage.isMaterialCheck ? null : o.okQty == null ? null : n(o.okQty),
            rejectedQty: o.stage.isMaterialCheck ? null : o.rejectedQty == null ? null : n(o.rejectedQty),
            reason: o.rejectionReason,
            remarks: o.remarks,
            completedAt: o.completedAt,
            by: o.updatedBy?.name ?? null,
            reports: files.filter((f) => f.entity === 'route_card_operation' && f.entityId === o.id).map((f) => ({ id: f.id, name: f.originalName })),
          })),
        };
      }),
      jobWork: jobWork.map((j) => {
        const sent = new Map<string, { heatNo: string; millHeatNo: string | null; kg: number }>();
        for (const i of j.materials.flatMap((m) => m.issues)) {
          const h = sent.get(i.heat.heatNo) ?? { heatNo: i.heat.heatNo, millHeatNo: i.heat.millHeatNo, kg: 0 };
          h.kg = r3(h.kg + n(i.quantity));
          sent.set(i.heat.heatNo, h);
        }
        return {
          id: j.id, jwoNo: j.jwoNo, jwoDate: j.jwoDate, status: j.status, supplier: j.supplier.name,
          materials: [...sent.values()].filter((h) => h.kg > 0),
          received: j.receipts.flatMap((r) =>
            r.lines.map((l) => ({ receiptNo: r.receiptNo, receiptDate: r.receiptDate, item: l.item, heatNo: l.heat?.heatNo ?? null, receivedQty: n(l.receivedQty), acceptedQty: n(l.acceptedQty), rejectedQty: n(l.rejectedQty) })),
          ),
          reports: files.filter((f) => f.entity === 'job_work_receipt' && j.receipts.some((r) => r.id === f.entityId)).map((f) => ({ id: f.id, name: f.originalName })),
        };
      }),
      invoices: invoices.map((i) => ({ ...i, grandTotal: n(i.grandTotal) })),
      dispatches: dispatches.map(({ invoice, cancelledAt, ...d }) => ({ ...d, invoiceNo: invoice?.invoiceNo ?? null, cancelled: !!cancelledAt })),
    };
  }

  /**
   * Where finished parts of these heats came from, per item + heat:
   * route cards (moved to FG store), job work receipts, or opening stock / adjustments.
   */
  private async sourcesOf(heatIds: number[]) {
    const out = new Map<string, { item: { id: number; code: string; name: string }; quantity: number; from: string[] }>();
    if (!heatIds.length) return out;
    const [completions, receipts, opening] = await Promise.all([
      this.prisma.rcCompletionHeat.findMany({
        where: { heatId: { in: heatIds }, completion: { status: 'MOVED_TO_STOCK' } },
        select: { heatId: true, quantity: true, completion: { select: { routeCard: { select: { rcNo: true, item: { select: itemSelect } } } } } },
      }),
      this.prisma.jobWorkReceiptLine.findMany({
        where: { heatId: { in: heatIds }, acceptedQty: { gt: 0 } },
        select: { heatId: true, acceptedQty: true, item: { select: itemSelect }, jobWorkReceipt: { select: { jobWorkOrder: { select: { jwoNo: true } } } } },
      }),
      this.prisma.stockLedger.findMany({
        where: { heatId: { in: heatIds }, kind: StockKind.FINISHED_GOOD, refType: { in: [StockRefType.OPENING, StockRefType.ADJUSTMENT] }, qtyIn: { gt: 0 } },
        select: { heatId: true, qtyIn: true, refType: true, item: { select: itemSelect } },
      }),
    ]);
    const add = (heatId: number | null, item: { id: number; code: string; name: string } | null, qty: number, from: string) => {
      if (!heatId || !item) return;
      const key = `${item.id}:${heatId}`;
      const row = out.get(key) ?? { item, quantity: 0, from: [] };
      row.quantity = r3(row.quantity + qty);
      if (!row.from.includes(from)) row.from.push(from);
      out.set(key, row);
    };
    for (const c of completions) add(c.heatId, c.completion.routeCard.item, n(c.quantity), c.completion.routeCard.rcNo);
    for (const r of receipts) add(r.heatId, r.item, n(r.acceptedQty), r.jobWorkReceipt.jobWorkOrder.jwoNo);
    for (const o of opening) add(o.heatId, o.item, n(o.qtyIn), o.refType === StockRefType.OPENING ? 'Opening stock' : 'Stock adjustment');
    return out;
  }
}
