import { BadRequestException, Injectable } from '@nestjs/common';
import type { ListQuery, PurchaseRequisitionInput } from '@bht/shared';
import {
  AuditAction,
  PurchaseRequisitionSource,
  PurchaseRequisitionStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { NotificationsService } from '../core/notifications.service';
import { listArgs, paginated } from '../common/list';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';

export const prInclude = {
  rawMaterial: { select: { id: true, code: true, size: true, uom: true, grade: { select: { name: true } } } },
  purchaseOrderLines: { select: { purchaseOrder: { select: { id: true, poNo: true, status: true } } } },
} as const;

export interface PrFilters {
  status?: PurchaseRequisitionStatus;
  rawMaterialId?: number;
}

@Injectable()
export class RequisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListQuery, filters: PrFilters) {
    const args = listArgs(
      query,
      {
        searchFields: ['prNo', 'remarks', 'rawMaterial.size', 'rawMaterial.grade.name'],
        sortable: ['prNo', 'prDate', 'requiredBy', 'quantity', 'status'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.rawMaterialId ? { rawMaterialId: filters.rawMaterialId } : {}),
      },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.purchaseRequisition.findMany({ ...args, include: prInclude }),
      this.prisma.purchaseRequisition.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  get(id: number) {
    return this.prisma.purchaseRequisition.findUniqueOrThrow({ where: { id }, include: prInclude });
  }

  async create(input: PurchaseRequisitionInput, actor: Actor, source: PurchaseRequisitionSource = PurchaseRequisitionSource.MANUAL) {
    const created = await this.prisma.$transaction(async (tx) => {
      const data = normalize(input, ['requiredBy']);
      const pr = await tx.purchaseRequisition.create({
        data: {
          ...data,
          prNo: await this.numbering.next('PURCHASE_REQUISITION', { tx, date: data.prDate }),
          source,
          createdById: actor.userId,
        },
        include: prInclude,
      });
      await this.audit.log(
        actor,
        {
          action: AuditAction.CREATE,
          entity: 'purchase_requisition',
          entityId: pr.id,
          summary: `Raised ${pr.prNo}: ${pr.quantity.toString()} ${pr.rawMaterial.uom} ${pr.rawMaterial.grade.name} ${pr.rawMaterial.size}`,
        },
        tx,
      );
      return pr;
    });
    // one notice for several requisitions raised together
    await this.notifications.toPermission('purchase_orders.create', { title: 'Purchase requisitions to order', body: `${created.prNo}: ${created.rawMaterial.grade.name} ${created.rawMaterial.size}`, link: '/purchase/requisitions?status=PENDING' }, actor.userId);
    return created;
  }

  async update(id: number, input: PurchaseRequisitionInput, actor: Actor) {
    const before = await this.get(id);
    this.assertPending(before.status, before.prNo);
    const pr = await this.prisma.purchaseRequisition.update({ where: { id }, data: normalize(input, ['requiredBy']), include: prInclude });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'purchase_requisition',
      entityId: id,
      summary: `Updated ${pr.prNo}`,
      changes: diff(before, pr),
    });
    return pr;
  }

  async cancel(id: number, reason: string, actor: Actor) {
    const pr = await this.get(id);
    this.assertPending(pr.status, pr.prNo);
    await this.prisma.purchaseRequisition.update({
      where: { id },
      data: { status: PurchaseRequisitionStatus.CANCELLED, remarks: [pr.remarks, `Cancelled: ${reason}`].filter(Boolean).join(' · ') },
    });
    await this.audit.log(actor, {
      action: AuditAction.STATUS_CHANGE,
      entity: 'purchase_requisition',
      entityId: id,
      summary: `Cancelled ${pr.prNo}: ${reason}`,
    });
  }

  async remove(id: number, actor: Actor) {
    const pr = await this.get(id);
    this.assertPending(pr.status, pr.prNo);
    await this.prisma.purchaseRequisition.delete({ where: { id } });
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'purchase_requisition', entityId: id, summary: `Deleted ${pr.prNo}`, changes: pr });
  }

  /** Raw materials below their reorder level that have no open requisition yet. */
  async reorderSuggestions() {
    const rows = await this.prisma.$queryRaw<
      { id: number; code: string; grade: string; size: string; stock: number; reorderLevel: number }[]
    >`
      SELECT rm.id, rm.code, g.name AS grade, rm.size,
             COALESCE(SUM(sb.quantity), 0) AS stock, rm.reorder_level AS reorderLevel
      FROM raw_materials rm
      JOIN material_grades g ON g.id = rm.grade_id
      LEFT JOIN stock_balances sb ON sb.raw_material_id = rm.id AND sb.location = 'RM_STORE'
      WHERE rm.is_active = 1 AND rm.reorder_level > 0
        AND NOT EXISTS (SELECT 1 FROM purchase_requisitions pr WHERE pr.raw_material_id = rm.id AND pr.status = 'PENDING')
      GROUP BY rm.id, rm.code, g.name, rm.size, rm.reorder_level
      HAVING stock < rm.reorder_level
      ORDER BY g.name, rm.size`;
    return rows.map((r) => {
      const stock = Number(r.stock);
      const reorderLevel = Number(r.reorderLevel);
      return { rawMaterialId: r.id, code: r.code, grade: r.grade, size: r.size, stock, reorderLevel, shortfall: Math.ceil(reorderLevel - stock) };
    });
  }

  async createFromReorder(items: { rawMaterialId: number; quantity: number }[], actor: Actor) {
    const today = new Date().toISOString().slice(0, 10);
    const created = [];
    for (const item of items) {
      created.push(
        await this.create(
          { prDate: today, rawMaterialId: item.rawMaterialId, quantity: item.quantity, remarks: 'Below reorder level' },
          actor,
          PurchaseRequisitionSource.REORDER,
        ),
      );
    }
    return created;
  }

  private assertPending(status: PurchaseRequisitionStatus, prNo: string) {
    if (status !== PurchaseRequisitionStatus.PENDING) {
      throw new BadRequestException(`${prNo} is ${status.toLowerCase()} and can no longer be changed`);
    }
  }
}
