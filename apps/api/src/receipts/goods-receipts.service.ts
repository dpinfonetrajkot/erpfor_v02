import { BadRequestException, Injectable } from '@nestjs/common';
import type { GoodsReceiptInput, ListQuery, QcInput } from '@bht/shared';
import {
  AuditAction,
  GoodsReceiptStatus,
  Prisma,
  PurchaseOrderStatus,
  QcStatus,
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
import { OPEN_PO_STATUSES } from '../purchase/orders.service';

const rawMaterialSelect = {
  select: { id: true, code: true, size: true, uom: true, grade: { select: { id: true, name: true, heatCode: true } } },
} as const;

export const grnInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  purchaseOrder: { select: { id: true, poNo: true, status: true } },
  lines: {
    orderBy: { id: 'asc' },
    include: {
      rawMaterial: rawMaterialSelect,
      purchaseOrderLine: { select: { id: true, lineNo: true, quantity: true, receivedQty: true } },
      heat: { select: { id: true, heatNo: true } },
    },
  },
} as const satisfies Prisma.GoodsReceiptInclude;

const listInclude = {
  supplier: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, poNo: true } },
  lines: { select: { receivedQty: true, qcStatus: true, rawMaterial: { select: { size: true, grade: { select: { name: true } } } } } },
} as const;

export interface GrnFilters {
  status?: GoodsReceiptStatus;
  supplierId?: number;
  purchaseOrderId?: number;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;

@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListQuery, filters: GrnFilters) {
    const args = listArgs(
      query,
      {
        searchFields: ['grnNo', 'supplierChallan', 'supplierInvoice', 'vehicleNo', 'supplier.name', 'purchaseOrder.poNo'],
        sortable: ['grnNo', 'grnDate', 'status'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
        ...(filters.purchaseOrderId ? { purchaseOrderId: filters.purchaseOrderId } : {}),
      },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.goodsReceipt.findMany({ ...args, include: listInclude }),
      this.prisma.goodsReceipt.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  get(id: number) {
    return this.prisma.goodsReceipt.findUniqueOrThrow({ where: { id }, include: grnInclude });
  }

  /**
   * Open POs of a supplier with what is still to come per line
   * (ordered - accepted - waiting for QC), for the gate entry form.
   */
  async poOptions(supplierId: number) {
    const pos = await this.prisma.purchaseOrder.findMany({
      where: { supplierId, type: 'MATERIAL', status: { in: OPEN_PO_STATUSES } },
      orderBy: { poDate: 'asc' },
      include: {
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            rawMaterial: rawMaterialSelect,
            goodsReceiptLines: { where: { qcStatus: QcStatus.PENDING }, select: { receivedQty: true } },
          },
        },
      },
    });
    return pos.map((po) => ({
      id: po.id,
      poNo: po.poNo,
      poDate: po.poDate,
      lines: po.lines.filter((l) => l.rawMaterial && l.rawMaterialId).map((l) => {
        const awaitingQc = l.goodsReceiptLines.reduce((sum, g) => sum + Number(g.receivedQty), 0);
        return {
          id: l.id,
          lineNo: l.lineNo,
          rawMaterialId: l.rawMaterialId!,
          label: `${l.rawMaterial!.grade.name} · ${l.rawMaterial!.size}`,
          uom: l.uom,
          ordered: Number(l.quantity),
          accepted: Number(l.receivedQty),
          awaitingQc,
          pending: Math.max(0, Number(l.quantity) - Number(l.receivedQty) - awaitingQc),
        };
      }),
    }));
  }

  async create(input: GoodsReceiptInput, actor: Actor) {
    const created = await this.prisma.$transaction(async (tx) => {
      await this.validate(tx, input);
      const { lines, ...header } = input;
      const data = normalize(header);
      const grn = await tx.goodsReceipt.create({
        data: {
          ...data,
          grnNo: await this.numbering.next('GOODS_RECEIPT', { tx, date: data.grnDate }),
          createdById: actor.userId,
          lines: { create: lines.map((l) => normalize(l)) },
        },
        include: grnInclude,
      });
      await this.audit.log(
        actor,
        {
          action: AuditAction.CREATE,
          entity: 'goods_receipt',
          entityId: grn.id,
          summary: `Gate entry ${grn.grnNo} from ${grn.supplier.name}${grn.purchaseOrder ? ` against ${grn.purchaseOrder.poNo}` : ''}`,
        },
        tx,
      );
      return grn;
    });
    await this.notifications.toPermission('incoming_qc.update', { title: `${created.grnNo} waits for incoming QC`, body: created.supplier.name, link: '/quality/incoming-qc' }, actor.userId);
    return created;
  }

  async update(id: number, input: GoodsReceiptInput, actor: Actor) {
    const before = await this.get(id);
    this.assertEditable(before);
    const grn = await this.prisma.$transaction(async (tx) => {
      await this.validate(tx, input);
      const { lines, ...header } = input;
      await tx.goodsReceiptLine.deleteMany({ where: { goodsReceiptId: id } });
      return tx.goodsReceipt.update({
        where: { id },
        data: { ...normalize(header), lines: { create: lines.map((l) => normalize(l)) } },
        include: grnInclude,
      });
    });
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'goods_receipt', entityId: id, summary: `Updated gate entry ${grn.grnNo}` });
    return grn;
  }

  async remove(id: number, actor: Actor) {
    const grn = await this.get(id);
    this.assertEditable(grn);
    await this.prisma.goodsReceipt.delete({ where: { id } });
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'goods_receipt', entityId: id, summary: `Deleted gate entry ${grn.grnNo}`, changes: grn });
  }

  /**
   * Incoming QC. For every accepted quantity: find or create the heat,
   * put the material into the RM store and update the purchase order.
   */
  async qc(id: number, input: QcInput, actor: Actor) {
    const result = await this.prisma.$transaction(async (tx) => {
      const grn = await tx.goodsReceipt.findUniqueOrThrow({ where: { id }, include: grnInclude });
      const summary: string[] = [];

      for (const q of input.lines) {
        const line = grn.lines.find((l) => l.id === q.lineId);
        if (!line) throw new BadRequestException('This line does not belong to the gate entry');
        const label = `${line.rawMaterial.grade.name} ${line.rawMaterial.size}`;
        if (line.qcStatus !== QcStatus.PENDING) throw new BadRequestException(`${label} is already inspected`);
        const received = Number(line.receivedQty);
        if (!near(q.acceptedQty + q.rejectedQty, received)) {
          throw new BadRequestException({
            message: `${label}: accepted + rejected must equal the received ${received}`,
            errors: { [`lines.${input.lines.indexOf(q)}.acceptedQty`]: `Accepted + rejected must be ${received}` },
          });
        }

        const millHeatNo = q.millHeatNo?.trim() || line.millHeatNo || null;
        let heatId: number | null = null;
        if (q.acceptedQty > 0) {
          const heat = await this.findOrCreateHeat(tx, {
            wanted: q.heatNo?.trim().toUpperCase() || null,
            rawMaterialId: line.rawMaterialId,
            grade: line.rawMaterial.grade,
            millHeatNo,
            supplierId: grn.supplierId,
            date: grn.grnDate,
            grnNo: grn.grnNo,
            label,
          });
          heatId = heat.id;
          await this.stock.post(tx, {
            kind: StockKind.RAW_MATERIAL,
            rawMaterialId: line.rawMaterialId,
            heatId: heat.id,
            location: StockLocation.RM_STORE,
            quantity: q.acceptedQty,
            refType: StockRefType.GRN,
            refId: grn.id,
            refNo: grn.grnNo,
            date: grn.grnDate,
            remarks: 'Accepted at incoming QC',
            userId: actor.userId,
          });
          if (line.purchaseOrderLineId) {
            await tx.purchaseOrderLine.update({
              where: { id: line.purchaseOrderLineId },
              data: { receivedQty: { increment: q.acceptedQty } },
            });
          }
          summary.push(`${label}: ${q.acceptedQty} accepted as heat ${heat.heatNo}`);
        }
        if (q.rejectedQty > 0) summary.push(`${label}: ${q.rejectedQty} rejected (${q.qcRemarks})`);

        await tx.goodsReceiptLine.update({
          where: { id: line.id },
          data: {
            acceptedQty: q.acceptedQty,
            rejectedQty: q.rejectedQty,
            qcStatus: q.acceptedQty === 0 ? QcStatus.REJECTED : q.rejectedQty === 0 ? QcStatus.ACCEPTED : QcStatus.PARTIAL,
            qcRemarks: q.qcRemarks || null,
            millHeatNo,
            heatId,
            inspectedById: actor.userId,
            inspectedAt: new Date(),
          },
        });
      }

      const stillPending = await tx.goodsReceiptLine.count({ where: { goodsReceiptId: id, qcStatus: QcStatus.PENDING } });
      if (!stillPending) await tx.goodsReceipt.update({ where: { id }, data: { status: GoodsReceiptStatus.COMPLETED } });
      if (grn.purchaseOrderId) await this.refreshPoStatus(tx, grn.purchaseOrderId);

      await this.audit.log(
        actor,
        { action: AuditAction.UPDATE, entity: 'goods_receipt', entityId: id, summary: `Incoming QC of ${grn.grnNo}`, changes: { result: summary } },
        tx,
      );
      return grn.id;
    });
    return this.get(result);
  }

  // ------------------------------------------------------------------ helpers

  private async validate(tx: Tx, input: GoodsReceiptInput) {
    const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });
    if (!input.purchaseOrderId) {
      if (input.lines.some((l) => l.purchaseOrderLineId)) throw new BadRequestException('Choose the purchase order for these lines');
      return;
    }
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: input.purchaseOrderId }, include: { lines: true } });
    if (po.supplierId !== supplier.id) throw new BadRequestException(`${po.poNo} is not a purchase order of ${supplier.name}`);
    if (po.type !== 'MATERIAL') throw new BadRequestException(`${po.poNo} is a job-work PO - receive those parts under Job Work`);
    if (!OPEN_PO_STATUSES.includes(po.status)) {
      throw new BadRequestException(`${po.poNo} is ${po.status.toLowerCase().replace('_', ' ')} - material cannot be received against it`);
    }
    input.lines.forEach((l, i) => {
      const poLine = po.lines.find((pl) => pl.id === l.purchaseOrderLineId);
      if (!poLine) throw new BadRequestException(`Line ${i + 1}: choose a line of ${po.poNo}`);
      if (poLine.rawMaterialId !== l.rawMaterialId) throw new BadRequestException(`Line ${i + 1}: material does not match ${po.poNo}`);
    });
  }

  private async findOrCreateHeat(
    tx: Tx,
    p: {
      wanted: string | null;
      rawMaterialId: number;
      grade: { name: string; heatCode: string | null };
      millHeatNo: string | null;
      supplierId: number;
      date: Date;
      grnNo: string;
      label: string;
    },
  ) {
    if (p.wanted) {
      const existing = await tx.heat.findUnique({ where: { heatNo: p.wanted } });
      if (existing) {
        if (existing.rawMaterialId !== p.rawMaterialId) {
          throw new BadRequestException(`Heat ${p.wanted} already belongs to a different raw material - give another number`);
        }
        return existing; // the same heat delivered again: add to it
      }
    }
    return tx.heat.create({
      data: {
        heatNo:
          p.wanted ??
          (await this.numbering.next('HEAT', { tx, date: p.date, vars: { GRADE: p.grade.heatCode ?? p.grade.name.charAt(0) } })),
        millHeatNo: p.millHeatNo,
        rawMaterialId: p.rawMaterialId,
        supplierId: p.supplierId,
        receivedDate: p.date,
        remarks: `Received on ${p.grnNo}`,
      },
    });
  }

  /** ISSUED -> PARTIALLY_RECEIVED -> RECEIVED, from the accepted quantities. */
  private async refreshPoStatus(tx: Tx, poId: number) {
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    if (!OPEN_PO_STATUSES.includes(po.status)) return;
    const all = po.lines.every((l) => Number(l.receivedQty) >= Number(l.quantity) - 0.0005);
    const any = po.lines.some((l) => Number(l.receivedQty) > 0);
    const status = all ? PurchaseOrderStatus.RECEIVED : any ? PurchaseOrderStatus.PARTIALLY_RECEIVED : PurchaseOrderStatus.ISSUED;
    if (status !== po.status) await tx.purchaseOrder.update({ where: { id: poId }, data: { status } });
  }

  private assertEditable(grn: { grnNo: string; status: GoodsReceiptStatus; lines: { qcStatus: QcStatus }[] }) {
    if (grn.status !== GoodsReceiptStatus.PENDING_QC || grn.lines.some((l) => l.qcStatus !== QcStatus.PENDING)) {
      throw new BadRequestException(`${grn.grnNo} is already inspected by QC and cannot be changed`);
    }
  }
}
