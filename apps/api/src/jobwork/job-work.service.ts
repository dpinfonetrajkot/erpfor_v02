import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { JobWorkOrderInput, JobWorkReceiptInput, ListQuery, MaterialIssueInput, MaterialReturnInput } from '@bht/shared';
import {
  AuditAction,
  HeatStatus,
  JobWorkStatus,
  Prisma,
  ProductionDecision,
  ProductionRequestStatus,
  PurchaseOrderStatus,
  RequisitionStatus,
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
import { SalesOrdersService } from '../sales/sales-orders.service';
import { heatsInStore } from '../production/material.service';
import { issuedByHeat, num, round3, today } from '../production/route-cards.service';
import { renderJobWorkPdf } from './jwo-pdf';

const rmSelect = { id: true, code: true, size: true, uom: true, grade: { select: { name: true } } } as const;

export const jwoInclude = {
  supplier: {
    select: { id: true, code: true, name: true, type: true, gstin: true, address: true, city: true, stateCode: true, pincode: true, contactPerson: true, phone: true, email: true },
  },
  salesOrder: { select: { id: true, soNo: true, customerPoNo: true, expectedDelivery: true, customer: { select: { id: true, name: true } } } },
  createdBy: { select: { id: true, name: true } },
  lines: {
    orderBy: { id: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true, drawingNo: true } },
      salesOrderLine: { select: { id: true, lineNo: true } },
    },
  },
  materials: {
    orderBy: { id: 'asc' },
    include: {
      rawMaterial: { select: rmSelect },
      issues: {
        orderBy: { id: 'asc' },
        include: { heat: { select: { id: true, heatNo: true, millHeatNo: true } }, issuedBy: { select: { id: true, name: true } } },
      },
    },
  },
  receipts: {
    orderBy: { id: 'asc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      lines: { include: { item: { select: { id: true, code: true, name: true } }, heat: { select: { id: true, heatNo: true } } } },
    },
  },
  purchaseOrders: { select: { id: true, poNo: true, status: true, grandTotal: true }, orderBy: { id: 'desc' } },
} as const satisfies Prisma.JobWorkOrderInclude;

export type JobWorkOrderFull = Prisma.JobWorkOrderGetPayload<{ include: typeof jwoInclude }>;

const listInclude = {
  supplier: { select: { id: true, name: true } },
  salesOrder: { select: { id: true, soNo: true, customer: { select: { name: true } } } },
  lines: { select: { quantity: true, receivedQty: true, item: { select: { name: true } } }, orderBy: { id: 'asc' } },
  materials: { select: { quantity: true, issuedQty: true, status: true } },
  purchaseOrders: { select: { id: true, poNo: true, status: true }, orderBy: { id: 'desc' } },
} as const satisfies Prisma.JobWorkOrderInclude;

/** Orders where the vendor is still working. */
export const RUNNING: JobWorkStatus[] = [JobWorkStatus.OPEN, JobWorkStatus.MATERIAL_ISSUED, JobWorkStatus.PARTIALLY_RECEIVED];
const OPEN_MATERIAL: RequisitionStatus[] = [RequisitionStatus.PENDING, RequisitionStatus.PARTIAL];

export interface JwoFilters {
  status?: JobWorkStatus | 'RUNNING';
  supplierId?: number;
  salesOrderId?: number;
}

type MaterialWithIssues = { issues: { heatId: number; quantity: Prisma.Decimal | number; heat: { id: number; heatNo: string; millHeatNo: string | null } }[] };

/** Material lying with the vendor for this order, per heat (sent minus returned). */
function atVendor(materials: MaterialWithIssues[]) {
  return issuedByHeat(materials.flatMap((m) => m.issues)).filter((h) => h.quantity > 0);
}

@Injectable()
export class JobWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
    private readonly salesOrders: SalesOrdersService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListQuery, filters: JwoFilters) {
    const args = listArgs(
      query,
      {
        searchFields: ['jwoNo', 'challanNo', 'supplier.name', 'salesOrder.soNo', 'remarks'],
        sortable: ['jwoNo', 'jwoDate', 'expectedDate', 'status'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      {
        ...(filters.status === 'RUNNING' ? { status: { in: RUNNING } } : filters.status ? { status: filters.status } : {}),
        ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
        ...(filters.salesOrderId ? { salesOrderId: filters.salesOrderId } : {}),
      },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.jobWorkOrder.findMany({ ...args, include: listInclude }),
      this.prisma.jobWorkOrder.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  async get(id: number) {
    const jwo = await this.prisma.jobWorkOrder.findUnique({ where: { id }, include: jwoInclude });
    if (!jwo) throw new NotFoundException('Job work order not found');
    const done = jwo.status === JobWorkStatus.COMPLETED;
    const heats = atVendor(jwo.materials);
    return {
      ...jwo,
      charges: Math.round(jwo.lines.reduce((s, l) => s + num(l.quantity) * num(l.rate), 0) * 100) / 100,
      /** While running: with the vendor. After completion: used by the vendor. */
      heatsAtVendor: done ? [] : heats,
      heatsUsed: done ? heats : [],
      /** Heats the finished parts can be booked under. */
      heatsIssued: issuedByHeat(jwo.materials.flatMap((m) => m.issues)),
    };
  }

  /** Suggested parts + material for the outsourced lines of a sales order (shortage after stock and earlier job work). */
  async defaults(salesOrderId: number) {
    const check = await this.salesOrders.stockCheck(salesOrderId);
    const so = await this.prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: { id: true, soNo: true, status: true, expectedDelivery: true, customer: { select: { name: true } } },
    });
    const parts = check.lines
      .filter((l) => l.decision === ProductionDecision.OUTSOURCE)
      .flatMap((l) => l.parts.filter((p) => p.item).map((p) => ({ salesOrderLineId: l.lineId, product: l.product.name, itemId: p.item!.id, item: p.item!, quantity: p.shortage })));
    const items = await this.prisma.item.findMany({
      where: { id: { in: parts.map((p) => p.itemId) } },
      select: { id: true, rawMaterialId: true, inputWeightKg: true },
    });
    const material = new Map<number, number>();
    for (const p of parts) {
      const it = items.find((i) => i.id === p.itemId);
      if (it?.rawMaterialId && it.inputWeightKg && p.quantity > 0) {
        material.set(it.rawMaterialId, round3((material.get(it.rawMaterialId) ?? 0) + p.quantity * num(it.inputWeightKg)));
      }
    }
    return {
      salesOrder: so,
      lines: parts,
      materials: [...material.entries()].map(([rawMaterialId, quantity]) => ({ rawMaterialId, quantity })),
    };
  }

  async create(input: JobWorkOrderInput, actor: Actor) {
    const jwo = await this.prisma.$transaction(async (tx) => {
      await this.validate(tx, input);
      const f = normalize({ challanNo: input.challanNo, remarks: input.remarks, expectedDate: input.expectedDate });
      const jwoDate = new Date(`${input.jwoDate}T00:00:00Z`);
      const created = await tx.jobWorkOrder.create({
        data: {
          jwoNo: await this.numbering.next('JOB_WORK_ORDER', { tx, date: jwoDate }),
          jwoDate,
          supplierId: input.supplierId,
          salesOrderId: input.salesOrderId ?? null,
          challanNo: f.challanNo,
          expectedDate: f.expectedDate,
          remarks: f.remarks,
          createdById: actor.userId,
          lines: { create: this.lineData(input) },
          materials: { create: input.materials.map((m) => ({ rawMaterialId: m.rawMaterialId, quantity: m.quantity })) },
        },
        include: { supplier: true },
      });
      if (input.salesOrderId) {
        await tx.salesOrder.updateMany({ where: { id: input.salesOrderId, status: SalesOrderStatus.APPROVED }, data: { status: SalesOrderStatus.IN_PRODUCTION } });
      }
      await this.audit.log(
        actor,
        {
          action: AuditAction.CREATE,
          entity: 'job_work_order',
          entityId: created.id,
          summary: `Job work order ${created.jwoNo} to ${created.supplier.name}: ${input.lines.map((l) => l.quantity).reduce((a, b) => a + b, 0)} pcs`,
        },
        tx,
      );
      return created;
    });
    await this.notifications.toPermission('material_issues.issue', { title: `${jwo.jwoNo}: material to send to ${jwo.supplier.name}`, link: '/store/material-issue?for=jw' }, actor.userId);
    return { id: jwo.id, jwoNo: jwo.jwoNo };
  }

  /** Change an order before anything was sent, received or put on a PO. */
  async update(id: number, input: JobWorkOrderInput, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const jwo = await tx.jobWorkOrder.findUniqueOrThrow({ where: { id }, include: { materials: { include: { issues: true } }, receipts: true, purchaseOrders: true } });
      if (jwo.status !== JobWorkStatus.OPEN || jwo.receipts.length || jwo.materials.some((m) => m.issues.length)) {
        throw new BadRequestException(`${jwo.jwoNo} is already started and cannot be changed`);
      }
      const po = jwo.purchaseOrders.find((p) => p.status !== PurchaseOrderStatus.CANCELLED);
      if (po) throw new BadRequestException(`${po.poNo} is made from this order - cancel or delete it first`);
      await this.validate(tx, input);
      const f = normalize({ challanNo: input.challanNo, remarks: input.remarks, expectedDate: input.expectedDate });
      await tx.jobWorkOrderLine.deleteMany({ where: { jobWorkOrderId: id } });
      await tx.jobWorkMaterial.deleteMany({ where: { jobWorkOrderId: id } });
      await tx.jobWorkOrder.update({
        where: { id },
        data: {
          jwoDate: new Date(`${input.jwoDate}T00:00:00Z`),
          supplierId: input.supplierId,
          salesOrderId: input.salesOrderId ?? null,
          challanNo: f.challanNo,
          expectedDate: f.expectedDate,
          remarks: f.remarks,
          lines: { create: this.lineData(input) },
          materials: { create: input.materials.map((m) => ({ rawMaterialId: m.rawMaterialId, quantity: m.quantity })) },
        },
      });
      await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'job_work_order', entityId: id, summary: `Updated ${jwo.jwoNo}` }, tx);
    });
  }

  /** Nothing received yet and all material back from the vendor. */
  async cancel(id: number, reason: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const jwo = await tx.jobWorkOrder.findUniqueOrThrow({ where: { id }, include: jwoInclude });
      if (!RUNNING.includes(jwo.status)) throw new BadRequestException(`${jwo.jwoNo} is ${jwo.status.toLowerCase()}`);
      if (jwo.receipts.length) throw new BadRequestException(`Parts were already received on ${jwo.jwoNo} - close it instead`);
      const left = atVendor(jwo.materials);
      if (left.length) {
        throw new BadRequestException(`Get the material back from the vendor first (${left.map((h) => `${h.heatNo}: ${h.quantity} kg`).join(', ')})`);
      }
      const po = jwo.purchaseOrders.find((p) => p.status !== PurchaseOrderStatus.CANCELLED);
      if (po) throw new BadRequestException(`Cancel ${po.poNo} first`);
      await tx.jobWorkMaterial.updateMany({ where: { jobWorkOrderId: id, status: { in: OPEN_MATERIAL } }, data: { status: RequisitionStatus.CANCELLED } });
      await tx.jobWorkOrder.update({ where: { id }, data: { status: JobWorkStatus.CANCELLED, cancelReason: reason, closedAt: new Date() } });
      await this.releaseSalesOrder(tx, jwo.salesOrderId);
      await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'job_work_order', entityId: id, summary: `Cancelled ${jwo.jwoNo}: ${reason}` }, tx);
    });
  }

  /** The rest will not come: material still with the vendor is booked as used. */
  async close(id: number, reason: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const jwo = await tx.jobWorkOrder.findUniqueOrThrow({ where: { id }, include: jwoInclude });
      if (!RUNNING.includes(jwo.status)) throw new BadRequestException(`${jwo.jwoNo} is ${jwo.status.toLowerCase()}`);
      await this.complete(tx, jwo, actor, reason);
      await this.releaseSalesOrder(tx, jwo.salesOrderId);
      await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'job_work_order', entityId: id, summary: `Closed ${jwo.jwoNo}: ${reason}` }, tx);
    });
  }

  // ------------------------------------------------------------- material to the vendor

  /** Material the store still has to send to vendors. */
  async materialList(query: ListQuery, status?: 'OPEN' | RequisitionStatus) {
    const args = listArgs(
      query,
      {
        searchFields: ['jobWorkOrder.jwoNo', 'jobWorkOrder.supplier.name', 'rawMaterial.size', 'rawMaterial.grade.name'],
        sortable: ['quantity', 'status'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      {
        ...(status === 'OPEN' ? { status: { in: OPEN_MATERIAL }, jobWorkOrder: { status: { in: RUNNING } } } : status ? { status } : {}),
      },
    );
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.jobWorkMaterial.findMany({
        ...args,
        include: {
          rawMaterial: { select: rmSelect },
          jobWorkOrder: { select: { id: true, jwoNo: true, jwoDate: true, status: true, supplier: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.jobWorkMaterial.count({ where: args.where }),
    ]);
    const inStore = await this.prisma.stockBalance.groupBy({
      by: ['rawMaterialId'],
      where: { kind: StockKind.RAW_MATERIAL, location: StockLocation.RM_STORE, rawMaterialId: { in: [...new Set(rows.map((r) => r.rawMaterialId))] } },
      _sum: { quantity: true },
    });
    const stockOf = new Map(inStore.map((s) => [s.rawMaterialId, num(s._sum.quantity)]));
    return paginated(rows.map((r) => ({ ...r, inStoreKg: stockOf.get(r.rawMaterialId) ?? 0 })), total, query);
  }

  async materialHeats(materialId: number) {
    const m = await this.prisma.jobWorkMaterial.findUniqueOrThrow({ where: { id: materialId } });
    return { heats: await heatsInStore(this.prisma, m.rawMaterialId) };
  }

  /** Store sends material to the vendor, heat by heat: RM store -> "at job work". */
  async issueMaterial(materialId: number, input: MaterialIssueInput, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const m = await tx.jobWorkMaterial.findUniqueOrThrow({ where: { id: materialId }, include: { jobWorkOrder: { include: { supplier: true } } } });
      const jwo = m.jobWorkOrder;
      if (!RUNNING.includes(jwo.status)) throw new BadRequestException(`${jwo.jwoNo} is ${jwo.status.toLowerCase()}`);
      if (!OPEN_MATERIAL.includes(m.status)) throw new BadRequestException(`This material of ${jwo.jwoNo} is already ${m.status.toLowerCase()}`);
      const heatIds = input.lines.map((l) => l.heatId);
      if (new Set(heatIds).size !== heatIds.length) throw new BadRequestException('Each heat only once, please');
      const total = round3(input.lines.reduce((s, l) => s + l.quantity, 0));
      const remaining = round3(num(m.quantity) - num(m.issuedQty));
      if (total > remaining + 0.0005) throw new BadRequestException(`Only ${remaining} kg is still to send on ${jwo.jwoNo}; you entered ${total} kg`);
      const heats = await tx.heat.findMany({ where: { id: { in: heatIds } } });
      const date = new Date(`${input.issueDate}T00:00:00Z`);
      for (const line of input.lines) {
        const heat = heats.find((h) => h.id === line.heatId);
        if (!heat || heat.rawMaterialId !== m.rawMaterialId) throw new BadRequestException('A chosen heat is of a different material');
        if (heat.status === HeatStatus.BLOCKED) throw new BadRequestException(`Heat ${heat.heatNo} is blocked and cannot be issued`);
        const move = { kind: StockKind.RAW_MATERIAL, rawMaterialId: m.rawMaterialId, heatId: heat.id, refType: StockRefType.JOB_WORK_ISSUE, refId: jwo.id, refNo: jwo.jwoNo, date, userId: actor.userId };
        await this.stock.post(tx, { ...move, location: StockLocation.RM_STORE, quantity: -line.quantity, remarks: `Sent to ${jwo.supplier.name} for job work` });
        await this.stock.post(tx, { ...move, location: StockLocation.JOB_WORK, quantity: line.quantity, remarks: `At ${jwo.supplier.name}` });
        await tx.materialIssue.create({
          data: { issueDate: date, jobWorkMaterialId: m.id, rawMaterialId: m.rawMaterialId, heatId: heat.id, quantity: line.quantity, remarks: input.remarks || null, issuedById: actor.userId },
        });
      }
      const issued = round3(num(m.issuedQty) + total);
      await tx.jobWorkMaterial.update({
        where: { id: m.id },
        data: { issuedQty: issued, status: issued + 0.0005 >= num(m.quantity) ? RequisitionStatus.ISSUED : RequisitionStatus.PARTIAL },
      });
      await this.refreshStatus(tx, jwo.id);
      const heatList = input.lines.map((l) => `${heats.find((h) => h.id === l.heatId)!.heatNo}: ${l.quantity} kg`).join(', ');
      await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'job_work_order', entityId: jwo.id, summary: `Sent ${total} kg to ${jwo.supplier.name} for ${jwo.jwoNo} (${heatList})` }, tx);
    });
  }

  /** Unused material back from the vendor into the RM store, same heat. */
  async returnMaterial(id: number, input: MaterialReturnInput, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const jwo = await tx.jobWorkOrder.findUniqueOrThrow({ where: { id }, include: jwoInclude });
      if (!RUNNING.includes(jwo.status)) throw new BadRequestException(`${jwo.jwoNo} is ${jwo.status.toLowerCase()}`);
      const heat = atVendor(jwo.materials).find((h) => h.heatId === input.heatId);
      if (!heat) throw new BadRequestException('This heat is not with the vendor for this order');
      if (input.quantity > heat.quantity + 0.0005) {
        throw new BadRequestException({ message: `Only ${heat.quantity} kg of heat ${heat.heatNo} is with the vendor`, errors: { quantity: `Max ${heat.quantity}` } });
      }
      const material = jwo.materials.find((m) => m.issues.some((i) => i.heatId === input.heatId))!;
      const move = { kind: StockKind.RAW_MATERIAL, rawMaterialId: material.rawMaterialId, heatId: input.heatId, refType: StockRefType.ISSUE_RETURN, refId: jwo.id, refNo: jwo.jwoNo, userId: actor.userId };
      await this.stock.post(tx, { ...move, location: StockLocation.JOB_WORK, quantity: -input.quantity, remarks: `Back from ${jwo.supplier.name}` });
      await this.stock.post(tx, { ...move, location: StockLocation.RM_STORE, quantity: input.quantity, remarks: `Returned by ${jwo.supplier.name}${input.remarks ? ` - ${input.remarks}` : ''}` });
      await tx.materialIssue.create({
        data: {
          issueDate: today(),
          jobWorkMaterialId: material.id,
          rawMaterialId: material.rawMaterialId,
          heatId: input.heatId,
          quantity: -input.quantity,
          remarks: `Returned by vendor${input.remarks ? `: ${input.remarks}` : ''}`,
          issuedById: actor.userId,
        },
      });
      await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'job_work_order', entityId: id, summary: `${input.quantity} kg of heat ${heat.heatNo} back from ${jwo.supplier.name} (${jwo.jwoNo})` }, tx);
    });
  }

  // ------------------------------------------------------------- parts back + QC

  async receive(id: number, input: JobWorkReceiptInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const jwo = await tx.jobWorkOrder.findUniqueOrThrow({ where: { id }, include: jwoInclude });
      if (!RUNNING.includes(jwo.status)) throw new BadRequestException(`${jwo.jwoNo} is ${jwo.status.toLowerCase()}`);
      const lines = input.lines.filter((l) => l.receivedQty > 0);
      if (!lines.length) throw new BadRequestException({ message: 'Enter the pieces received for at least one part', errors: { lines: 'Nothing received' } });
      const issuedHeats = issuedByHeat(jwo.materials.flatMap((m) => m.issues));
      const errors: Record<string, string> = {};
      lines.forEach((l) => {
        const i = input.lines.indexOf(l);
        const line = jwo.lines.find((x) => x.id === l.jobWorkOrderLineId);
        if (!line) throw new BadRequestException('A line does not belong to this order');
        const pending = num(line.quantity) - num(line.receivedQty);
        if (l.acceptedQty > l.receivedQty) errors[`lines.${i}.acceptedQty`] = 'More than received';
        else if (l.acceptedQty > pending) errors[`lines.${i}.acceptedQty`] = `Only ${pending} pending`;
        if (l.receivedQty > l.acceptedQty && !l.remarks) errors[`lines.${i}.remarks`] = 'Reason for rejection';
        if (issuedHeats.length) {
          if (!l.heatId) errors[`lines.${i}.heatId`] = 'Choose the heat';
          else if (!issuedHeats.some((h) => h.heatId === l.heatId)) errors[`lines.${i}.heatId`] = 'Not a heat sent on this order';
        }
      });
      if (Object.keys(errors).length) throw new BadRequestException({ message: Object.values(errors)[0], errors });

      const receiptDate = new Date(`${input.receiptDate}T00:00:00Z`);
      const receipt = await tx.jobWorkReceipt.create({
        data: {
          receiptNo: await this.numbering.next('JOB_WORK_RECEIPT', { tx, date: receiptDate }),
          receiptDate,
          jobWorkOrderId: id,
          vendorChallan: input.vendorChallan || null,
          inspectorName: input.inspectorName || null,
          remarks: input.remarks || null,
          createdById: actor.userId,
          lines: {
            create: lines.map((l) => ({
              jobWorkOrderLineId: l.jobWorkOrderLineId,
              itemId: jwo.lines.find((x) => x.id === l.jobWorkOrderLineId)!.itemId,
              heatId: l.heatId ?? null,
              receivedQty: l.receivedQty,
              acceptedQty: l.acceptedQty,
              rejectedQty: l.receivedQty - l.acceptedQty,
              remarks: l.remarks || null,
            })),
          },
        },
      });
      const po = jwo.purchaseOrders.find((p) => p.status === PurchaseOrderStatus.ISSUED || p.status === PurchaseOrderStatus.PARTIALLY_RECEIVED);
      for (const l of lines) {
        const line = jwo.lines.find((x) => x.id === l.jobWorkOrderLineId)!;
        if (l.acceptedQty > 0) {
          await this.stock.post(tx, {
            kind: StockKind.FINISHED_GOOD,
            itemId: line.itemId,
            heatId: l.heatId ?? null,
            location: StockLocation.FG_STORE,
            quantity: l.acceptedQty,
            refType: StockRefType.JOB_WORK_RECEIPT,
            refId: receipt.id,
            refNo: receipt.receiptNo,
            date: receiptDate,
            remarks: `Job work from ${jwo.supplier.name} (${jwo.jwoNo})`,
            userId: actor.userId,
          });
          if (po) await tx.purchaseOrderLine.updateMany({ where: { purchaseOrderId: po.id, itemId: line.itemId }, data: { receivedQty: { increment: l.acceptedQty } } });
        }
        await tx.jobWorkOrderLine.update({
          where: { id: line.id },
          data: { receivedQty: { increment: l.acceptedQty }, rejectedQty: { increment: l.receivedQty - l.acceptedQty } },
        });
      }
      if (po) await this.refreshPo(tx, po.id);

      const after = await tx.jobWorkOrder.findUniqueOrThrow({ where: { id }, include: jwoInclude });
      if (after.lines.every((l) => num(l.receivedQty) >= num(l.quantity))) {
        await this.complete(tx, after, actor);
        await this.releaseSalesOrder(tx, after.salesOrderId);
      } else {
        await this.refreshStatus(tx, id);
      }
      const accepted = lines.reduce((s, l) => s + l.acceptedQty, 0);
      const rejected = lines.reduce((s, l) => s + l.receivedQty - l.acceptedQty, 0);
      await this.audit.log(
        actor,
        { action: AuditAction.CREATE, entity: 'job_work_receipt', entityId: receipt.id, summary: `${receipt.receiptNo} for ${jwo.jwoNo}: ${accepted} accepted${rejected ? `, ${rejected} rejected` : ''}` },
        tx,
      );
      return { id: receipt.id, receiptNo: receipt.receiptNo };
    });
  }

  async receipts(query: ListQuery, jobWorkOrderId?: number) {
    const args = listArgs(
      query,
      { searchFields: ['receiptNo', 'vendorChallan', 'jobWorkOrder.jwoNo', 'jobWorkOrder.supplier.name'], sortable: ['receiptNo', 'receiptDate'], defaultSort: { field: 'id', dir: 'desc' } },
      jobWorkOrderId ? { jobWorkOrderId } : {},
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.jobWorkReceipt.findMany({
        ...args,
        include: {
          jobWorkOrder: { select: { id: true, jwoNo: true, supplier: { select: { name: true } } } },
          createdBy: { select: { id: true, name: true } },
          lines: { include: { item: { select: { id: true, code: true, name: true } }, heat: { select: { id: true, heatNo: true } } } },
        },
      }),
      this.prisma.jobWorkReceipt.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  async pdf(id: number) {
    const jwo = await this.prisma.jobWorkOrder.findUnique({ where: { id }, include: jwoInclude });
    if (!jwo) throw new NotFoundException('Job work order not found');
    const company = await this.prisma.company.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] });
    const buffer = await renderJobWorkPdf(jwo, company);
    return { fileName: `${jwo.jwoNo.replace(/[^\w-]+/g, '-')}.pdf`, buffer };
  }

  // ------------------------------------------------------------- helpers

  private async validate(tx: Tx, input: JobWorkOrderInput) {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier?.isActive) throw new BadRequestException({ message: 'Choose an active vendor', errors: { supplierId: 'Inactive or unknown' } });
    const items = await tx.item.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } });
    input.lines.forEach((l, i) => {
      const item = items.find((it) => it.id === l.itemId);
      if (!item?.isActive) throw new BadRequestException({ message: `Line ${i + 1}: choose an active part`, errors: { [`lines.${i}.itemId`]: 'Inactive or unknown' } });
    });
    const soLineIds = input.lines.map((l) => l.salesOrderLineId).filter((v): v is number => !!v);
    if (soLineIds.length && !input.salesOrderId) throw new BadRequestException('Choose the sales order for these lines');
    if (input.salesOrderId) {
      const so = await tx.salesOrder.findUnique({ where: { id: input.salesOrderId }, include: { lines: true } });
      if (!so) throw new BadRequestException({ message: 'Sales order not found', errors: { salesOrderId: 'Not found' } });
      const ok: SalesOrderStatus[] = [SalesOrderStatus.APPROVED, SalesOrderStatus.IN_PRODUCTION, SalesOrderStatus.PARTIALLY_DISPATCHED];
      if (!ok.includes(so.status)) throw new BadRequestException({ message: `${so.soNo} is not approved for production`, errors: { salesOrderId: 'Not approved' } });
      input.lines.forEach((l, i) => {
        if (!l.salesOrderLineId) return;
        const soLine = so.lines.find((x) => x.id === l.salesOrderLineId);
        const item = items.find((it) => it.id === l.itemId)!;
        if (!soLine) throw new BadRequestException(`Line ${i + 1}: not a line of ${so.soNo}`);
        if (soLine.decision !== ProductionDecision.OUTSOURCE) throw new BadRequestException(`Line ${i + 1}: that product is made in-house on ${so.soNo}`);
        if (soLine.productId !== item.productId) throw new BadRequestException(`Line ${i + 1}: ${item.name} is not a part of that product`);
      });
    }
    const rmIds = input.materials.map((m) => m.rawMaterialId);
    if (new Set(rmIds).size !== rmIds.length) throw new BadRequestException('The same raw material is on two lines - add the quantities together');
    const rms = await tx.rawMaterial.findMany({ where: { id: { in: rmIds } } });
    input.materials.forEach((m, i) => {
      if (!rms.find((r) => r.id === m.rawMaterialId)?.isActive) {
        throw new BadRequestException({ message: `Material ${i + 1}: choose an active raw material`, errors: { [`materials.${i}.rawMaterialId`]: 'Inactive or unknown' } });
      }
    });
  }

  private lineData(input: JobWorkOrderInput) {
    return input.lines.map((l) => ({
      itemId: l.itemId,
      salesOrderLineId: l.salesOrderLineId ?? null,
      quantity: l.quantity,
      rate: l.rate,
      remarks: l.remarks || null,
    }));
  }

  /** Open -> material sent -> part received, from what has happened on the order. */
  private async refreshStatus(tx: Tx, id: number) {
    const jwo = await tx.jobWorkOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, materials: true } });
    if (!RUNNING.includes(jwo.status)) return;
    const received = jwo.lines.some((l) => num(l.receivedQty) > 0 || num(l.rejectedQty) > 0);
    const allSent = jwo.materials.length > 0 && jwo.materials.every((m) => m.status === RequisitionStatus.ISSUED || m.status === RequisitionStatus.CANCELLED);
    const status = received ? JobWorkStatus.PARTIALLY_RECEIVED : allSent ? JobWorkStatus.MATERIAL_ISSUED : JobWorkStatus.OPEN;
    if (status !== jwo.status) await tx.jobWorkOrder.update({ where: { id }, data: { status } });
  }

  /** Completed or closed short: what is left with the vendor counts as used; nothing more is sent. */
  private async complete(tx: Tx, jwo: JobWorkOrderFull, actor: Actor, reason?: string) {
    for (const m of jwo.materials) {
      for (const h of issuedByHeat(m.issues).filter((x) => x.quantity > 0)) {
        await this.stock.post(tx, {
          kind: StockKind.RAW_MATERIAL,
          rawMaterialId: m.rawMaterialId,
          heatId: h.heatId,
          location: StockLocation.JOB_WORK,
          quantity: -h.quantity,
          refType: StockRefType.JOB_WORK_RECEIPT,
          refId: jwo.id,
          refNo: jwo.jwoNo,
          remarks: `Used by ${jwo.supplier.name} on ${jwo.jwoNo}`,
          userId: actor.userId,
        });
      }
    }
    await tx.jobWorkMaterial.updateMany({ where: { jobWorkOrderId: jwo.id, status: { in: OPEN_MATERIAL } }, data: { status: RequisitionStatus.CANCELLED } });
    await tx.jobWorkOrder.update({ where: { id: jwo.id }, data: { status: JobWorkStatus.COMPLETED, closedAt: new Date(), cancelReason: reason ?? null } });
  }

  /** Job-work PO follows what QC accepted. */
  private async refreshPo(tx: Tx, poId: number) {
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    const all = po.lines.every((l) => num(l.receivedQty) >= num(l.quantity));
    const status = all ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED;
    if (status !== po.status) await tx.purchaseOrder.update({ where: { id: poId }, data: { status } });
  }

  /** Sales order back to "approved" when neither production nor a vendor has work for it. */
  private async releaseSalesOrder(tx: Tx, salesOrderId: number | null) {
    if (!salesOrderId) return;
    const [requests, jobWork] = await Promise.all([
      tx.productionRequest.count({
        where: { salesOrderLine: { salesOrderId }, status: { in: [ProductionRequestStatus.REQUESTED, ProductionRequestStatus.ACCEPTED, ProductionRequestStatus.COMPLETED] } },
      }),
      tx.jobWorkOrder.count({ where: { salesOrderId, status: { not: JobWorkStatus.CANCELLED } } }),
    ]);
    if (!requests && !jobWork) {
      await tx.salesOrder.updateMany({ where: { id: salesOrderId, status: SalesOrderStatus.IN_PRODUCTION }, data: { status: SalesOrderStatus.APPROVED } });
    }
  }
}
