import { BadRequestException, Injectable } from '@nestjs/common';
import {
  computeTotals,
  DEFAULT_JOB_WORK_PO_TERMS,
  DEFAULT_PO_PAYMENT_TERMS,
  defaultGstType,
  type EmailDocumentInput,
  type ListQuery,
  type PurchaseOrderInput,
} from '@bht/shared';
import {
  AuditAction,
  PurchaseOrderStatus,
  PurchaseOrderType,
  PurchaseRequisitionStatus,
} from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { MailService } from '../core/mail.service';
import { NumberingService } from '../core/numbering.service';
import { NotificationsService } from '../core/notifications.service';
import { listArgs, paginated } from '../common/list';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';
import { renderPurchaseOrderPdf } from './po-pdf';
import { poInclude, poLineLabel, type PurchaseOrderFull } from './po-shape';

const listInclude = {
  supplier: { select: { id: true, name: true } },
  company: { select: { id: true, code: true } },
  jobWorkOrder: { select: { id: true, jwoNo: true } },
  _count: { select: { lines: true, goodsReceipts: true } },
} as const;

/** Statuses in which material can still arrive against the PO. */
export const OPEN_PO_STATUSES: PurchaseOrderStatus[] = [PurchaseOrderStatus.ISSUED, PurchaseOrderStatus.PARTIALLY_RECEIVED];

export interface PoFilters {
  status?: PurchaseOrderStatus | 'OPEN';
  supplierId?: number;
  type?: PurchaseOrderType;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListQuery, filters: PoFilters) {
    const status =
      filters.status === 'OPEN' ? { status: { in: OPEN_PO_STATUSES } } : filters.status ? { status: filters.status } : {};
    const args = listArgs(
      query,
      {
        searchFields: ['poNo', 'supplier.name', 'quotationRef', 'notes'],
        sortable: ['poNo', 'poDate', 'expectedDelivery', 'grandTotal', 'status'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      { ...(filters.type ? { type: filters.type } : {}), ...status, ...(filters.supplierId ? { supplierId: filters.supplierId } : {}) },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({ ...args, include: listInclude }),
      this.prisma.purchaseOrder.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  get(id: number): Promise<PurchaseOrderFull> {
    return this.prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: poInclude });
  }

  async create(input: PurchaseOrderInput, actor: Actor) {
    const created = await this.prisma.$transaction(async (tx) => {
      const header = await this.header(tx, input);
      const po = await tx.purchaseOrder.create({
        data: {
          ...header,
          poNo: await this.numbering.next('PURCHASE_ORDER', { tx, date: header.poDate }),
          type: PurchaseOrderType.MATERIAL,
          status: PurchaseOrderStatus.DRAFT,
          createdById: actor.userId,
          lines: { create: await this.lines(tx, input, null, PurchaseOrderType.MATERIAL) },
        },
        include: poInclude,
      });
      await this.syncRequisitions(tx, po.id);
      await this.audit.log(
        actor,
        {
          action: AuditAction.CREATE,
          entity: 'purchase_order',
          entityId: po.id,
          summary: `Created ${po.poNo} for ${po.supplier.name} (${po.grandTotal.toString()} ${po.currency})`,
        },
        tx,
      );
      return po;
    });
    await this.notifications.toPermission('purchase_orders.approve', { title: `${created.poNo} waits for approval`, body: created.supplier.name, link: `/purchase/orders/${created.id}` }, actor.userId);
    return created;
  }

  async update(id: number, input: PurchaseOrderInput, actor: Actor) {
    const before = await this.get(id);
    this.assertStatus(before, [PurchaseOrderStatus.DRAFT], 'edited');
    const po = await this.prisma.$transaction(async (tx) => {
      const header = await this.header(tx, input);
      // Validate the new lines while the old ones still exist (they show which requisitions are on this PO).
      const lines = await this.lines(tx, input, id, before.type);
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { ...header, lines: { create: lines } },
        include: poInclude,
      });
      await this.syncRequisitions(tx, id, before.lines.map((l) => l.purchaseRequisitionId));
      return updated;
    });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'purchase_order',
      entityId: id,
      summary: `Updated ${po.poNo}`,
      changes: diff(
        { ...before, lines: summarizeLines(before) },
        { ...po, lines: summarizeLines(po) },
      ),
    });
    return po;
  }

  /** Draft -> Issued. After this the PO can be sent and material received against it. */
  async approve(id: number, actor: Actor) {
    const po = await this.get(id);
    this.assertStatus(po, [PurchaseOrderStatus.DRAFT], 'approved');
    await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.ISSUED, approvedById: actor.userId, approvedAt: new Date() },
    });
    await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'purchase_order', entityId: id, summary: `Approved and issued ${po.poNo}` });
    return this.get(id);
  }

  async cancel(id: number, reason: string, actor: Actor) {
    const po = await this.get(id);
    this.assertStatus(po, [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.ISSUED], 'cancelled');
    if (po.goodsReceipts.length) throw new BadRequestException(`${po.poNo} already has gate entries - close it instead`);
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data: { status: PurchaseOrderStatus.CANCELLED, cancelReason: reason } });
      await this.syncRequisitions(tx, id);
    });
    await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'purchase_order', entityId: id, summary: `Cancelled ${po.poNo}: ${reason}` });
    return this.get(id);
  }

  /** Short-close: the rest of the quantity will not come. */
  async close(id: number, reason: string, actor: Actor) {
    const po = await this.get(id);
    this.assertStatus(po, OPEN_PO_STATUSES, 'closed');
    await this.prisma.purchaseOrder.update({ where: { id }, data: { status: PurchaseOrderStatus.CLOSED, cancelReason: reason } });
    await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'purchase_order', entityId: id, summary: `Closed ${po.poNo}: ${reason}` });
    return this.get(id);
  }

  async remove(id: number, actor: Actor) {
    const po = await this.get(id);
    this.assertStatus(po, [PurchaseOrderStatus.DRAFT], 'deleted');
    await this.prisma.$transaction(async (tx) => {
      const prIds = po.lines.map((l) => l.purchaseRequisitionId);
      await tx.purchaseOrder.delete({ where: { id } });
      await this.releaseRequisitions(tx, prIds);
    });
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'purchase_order', entityId: id, summary: `Deleted draft ${po.poNo}` });
  }

  async pdf(id: number) {
    const po = await this.get(id);
    return { fileName: `${po.poNo.replace(/[^\w-]+/g, '-')}.pdf`, buffer: await renderPurchaseOrderPdf(po) };
  }

  async email(id: number, input: EmailDocumentInput, actor: Actor) {
    const po = await this.get(id);
    if (po.status === PurchaseOrderStatus.DRAFT) throw new BadRequestException('Approve the PO before sending it to the supplier');
    if (po.status === PurchaseOrderStatus.CANCELLED) throw new BadRequestException('A cancelled PO cannot be sent');
    const { fileName, buffer } = await this.pdf(id);
    await this.mail.send({
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      text: input.message || `Please find attached purchase order ${po.poNo}.`,
      attachments: [{ filename: fileName, content: buffer, contentType: 'application/pdf' }],
    });
    await this.prisma.purchaseOrder.update({ where: { id }, data: { emailedAt: new Date() } });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'purchase_order',
      entityId: id,
      summary: `E-mailed ${po.poNo} to ${input.to}`,
    });
    return { sentTo: input.to };
  }

  /** Draft PO for the job-work charges of a job work order (one live PO per order). */
  async createForJobWork(jobWorkOrderId: number, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const jwo = await tx.jobWorkOrder.findUniqueOrThrow({
        where: { id: jobWorkOrderId },
        include: { supplier: true, lines: { include: { item: true }, orderBy: { id: 'asc' } }, purchaseOrders: true },
      });
      if (jwo.status === 'CANCELLED') throw new BadRequestException(`${jwo.jwoNo} is cancelled`);
      const live = jwo.purchaseOrders.find((p) => p.status !== PurchaseOrderStatus.CANCELLED);
      if (live) throw new BadRequestException(`${jwo.jwoNo} already has ${live.poNo}`);
      const company =
        (await tx.company.findFirst({ where: { isActive: true, isDefault: true } })) ??
        (await tx.company.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } }));
      if (!company) throw new BadRequestException('Add our company first (Admin → Companies)');
      const input: PurchaseOrderInput = {
        poDate: new Date().toISOString().slice(0, 10),
        companyId: company.id,
        supplierId: jwo.supplierId,
        currency: 'INR',
        gstType: defaultGstType(company.stateCode, jwo.supplier.stateCode, jwo.supplier.country),
        discountPercent: 0,
        taxRate: 18,
        freight: 0,
        paymentTerms: jwo.supplier.paymentTermsDays ? `Payment after ${jwo.supplier.paymentTermsDays} days` : DEFAULT_PO_PAYMENT_TERMS,
        expectedDelivery: jwo.expectedDate?.toISOString().slice(0, 10) ?? '',
        deliveryAddress: [company.name, company.address, company.city].filter(Boolean).join(', '),
        terms: DEFAULT_JOB_WORK_PO_TERMS,
        notes: `Job work order ${jwo.jwoNo}`,
        lines: jwo.lines.map((l) => ({
          itemId: l.itemId,
          description: l.remarks ?? '',
          quantity: Number(l.quantity),
          uom: 'PCS' as const,
          rate: Number(l.rate),
        })),
      };
      const header = await this.header(tx, input);
      const po = await tx.purchaseOrder.create({
        data: {
          ...header,
          poNo: await this.numbering.next('PURCHASE_ORDER', { tx, date: header.poDate }),
          type: PurchaseOrderType.JOB_WORK,
          jobWorkOrderId: jwo.id,
          status: PurchaseOrderStatus.DRAFT,
          createdById: actor.userId,
          lines: { create: await this.lines(tx, input, null, PurchaseOrderType.JOB_WORK) },
        },
      });
      await this.audit.log(
        actor,
        { action: AuditAction.CREATE, entity: 'purchase_order', entityId: po.id, summary: `Created job-work ${po.poNo} for ${jwo.jwoNo} (${jwo.supplier.name})` },
        tx,
      );
      return { id: po.id, poNo: po.poNo };
    });
  }

  /** Values for a new PO screen: default company, delivery address, terms. */
  async defaults() {
    const company =
      (await this.prisma.company.findFirst({ where: { isActive: true, isDefault: true } })) ??
      (await this.prisma.company.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } }));
    return { company, mailEnabled: this.mail.enabled };
  }

  // ------------------------------------------------------------------ helpers

  private async header(tx: Tx, input: PurchaseOrderInput) {
    const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });
    if (!supplier.isActive) throw new BadRequestException(`${supplier.name} is inactive`);
    const totals = computeTotals({ ...input, currency: input.currency });
    const { lines: _lines, ...fields } = input;
    return {
      ...normalize(fields, ['expectedDelivery']),
      subTotal: totals.subTotal,
      discountAmount: totals.discountAmount,
      taxableAmount: totals.taxableAmount,
      taxAmount: totals.taxAmount,
      roundOff: totals.roundOff,
      grandTotal: totals.grandTotal,
    };
  }

  /**
   * Validates lines and adds amounts. Material POs: raw material lines, requisition open and for the same material.
   * Job-work POs: the part (item) the vendor makes.
   */
  private async lines(tx: Tx, input: PurchaseOrderInput, poId: number | null, type: PurchaseOrderType) {
    const totals = computeTotals(input);
    const prIds = input.lines.map((l) => l.purchaseRequisitionId).filter((v): v is number => !!v);
    if (new Set(prIds).size !== prIds.length) throw new BadRequestException('The same requisition is used on two lines');
    const prs = await tx.purchaseRequisition.findMany({
      where: { id: { in: prIds } },
      include: { purchaseOrderLines: { select: { purchaseOrderId: true } } },
    });

    return input.lines.map((line, i) => {
      if (type === PurchaseOrderType.JOB_WORK) {
        if (!line.itemId) throw new BadRequestException({ message: `Line ${i + 1}: choose the part`, errors: { [`lines.${i}.rawMaterialId`]: 'Required' } });
        return {
          lineNo: i + 1,
          rawMaterialId: null,
          itemId: line.itemId,
          purchaseRequisitionId: null,
          description: line.description || null,
          quantity: line.quantity,
          uom: line.uom,
          rate: line.rate,
          amount: totals.lineAmounts[i],
        };
      }
      if (!line.rawMaterialId) throw new BadRequestException({ message: `Line ${i + 1}: choose the material`, errors: { [`lines.${i}.rawMaterialId`]: 'Required' } });
      if (line.purchaseRequisitionId) {
        const pr = prs.find((p) => p.id === line.purchaseRequisitionId);
        if (!pr) throw new BadRequestException(`Line ${i + 1}: requisition not found`);
        if (pr.rawMaterialId !== line.rawMaterialId) throw new BadRequestException(`Line ${i + 1}: ${pr.prNo} is for a different material`);
        const onThisPo = poId !== null && pr.purchaseOrderLines.some((l) => l.purchaseOrderId === poId);
        if (pr.status !== PurchaseRequisitionStatus.PENDING && !onThisPo) {
          throw new BadRequestException(`Line ${i + 1}: ${pr.prNo} is already ${pr.status.toLowerCase()}`);
        }
      }
      return {
        lineNo: i + 1,
        rawMaterialId: line.rawMaterialId,
        itemId: null,
        purchaseRequisitionId: line.purchaseRequisitionId ?? null,
        description: line.description || null,
        quantity: line.quantity,
        uom: line.uom,
        rate: line.rate,
        amount: totals.lineAmounts[i],
      };
    });
  }

  /** Requisitions on a live PO are ORDERED; ones removed from it (or on a cancelled PO) go back to PENDING. */
  private async syncRequisitions(tx: Tx, poId: number, previousPrIds: (number | null)[] = []) {
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    const current = po.lines.map((l) => l.purchaseRequisitionId).filter((v): v is number => !!v);
    if (po.status === PurchaseOrderStatus.CANCELLED) {
      await this.releaseRequisitions(tx, current);
      return;
    }
    if (current.length) {
      await tx.purchaseRequisition.updateMany({ where: { id: { in: current } }, data: { status: PurchaseRequisitionStatus.ORDERED } });
    }
    await this.releaseRequisitions(tx, previousPrIds.filter((id) => id && !current.includes(id)));
  }

  private async releaseRequisitions(tx: Tx, ids: (number | null)[]) {
    const list = ids.filter((v): v is number => !!v);
    if (!list.length) return;
    await tx.purchaseRequisition.updateMany({
      where: { id: { in: list }, status: PurchaseRequisitionStatus.ORDERED },
      data: { status: PurchaseRequisitionStatus.PENDING },
    });
  }

  private assertStatus(po: { poNo: string; status: PurchaseOrderStatus }, allowed: PurchaseOrderStatus[], verb: string) {
    if (!allowed.includes(po.status)) {
      throw new BadRequestException(`${po.poNo} is ${po.status.toLowerCase().replace('_', ' ')} and cannot be ${verb}`);
    }
  }
}

function summarizeLines(po: PurchaseOrderFull) {
  return po.lines.map((l) => `${poLineLabel(l).title}: ${l.quantity.toString()} @ ${l.rate.toString()}`).join('; ');
}
