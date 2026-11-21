import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  round2,
  type ApprovalDecisionInput,
  type ListQuery,
  type SalesOrderInput,
  type SoProductionRequestInput,
} from '@bht/shared';
import {
  ApprovalStage,
  ApprovalStatus,
  AuditAction,
  EndConnection,
  JobWorkStatus,
  Prisma,
  ProductionDecision,
  ProductionRequestStatus,
  ProductionRequestType,
  SalesOrderStatus,
  StockKind,
  StockLocation,
} from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { NotificationsService } from '../core/notifications.service';
import { listArgs, paginated } from '../common/list';
import { normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';

export const soInclude = {
  customer: {
    select: { id: true, code: true, name: true, currency: true, gstin: true, city: true, country: true, contactPerson: true, phone: true, email: true },
  },
  salesPerson: { select: { id: true, name: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      product: {
        select: {
          id: true,
          code: true,
          name: true,
          components: {
            select: { partTypeId: true, quantity: true, partType: { select: { name: true, hasEndConnection: true } } },
            orderBy: { partType: { sortOrder: 'asc' } },
          },
        },
      },
      materialGrade: { select: { id: true, name: true } },
      productionRequests: { select: { id: true, requestNo: true, itemId: true, quantity: true, status: true }, orderBy: { id: 'asc' } },
      jobWorkLines: {
        select: { itemId: true, quantity: true, receivedQty: true, jobWorkOrder: { select: { id: true, jwoNo: true, status: true } } },
        orderBy: { id: 'asc' },
      },
    },
  },
  approvals: { orderBy: { id: 'desc' }, include: { user: { select: { id: true, name: true } } } },
} as const satisfies Prisma.SalesOrderInclude;

export type SalesOrderFull = Prisma.SalesOrderGetPayload<{ include: typeof soInclude }>;

const listInclude = {
  customer: { select: { id: true, name: true } },
  salesPerson: { select: { id: true, name: true } },
  lines: { select: { quantity: true, product: { select: { name: true } } }, orderBy: { lineNo: 'asc' } },
} as const;

/** Production requests that still count (not rejected / cancelled). */
const ACTIVE_REQUEST: ProductionRequestStatus[] = [ProductionRequestStatus.REQUESTED, ProductionRequestStatus.ACCEPTED];

/** Job work orders where the vendor still works. */
const RUNNING_JOB_WORK: JobWorkStatus[] = [JobWorkStatus.OPEN, JobWorkStatus.MATERIAL_ISSUED, JobWorkStatus.PARTIALLY_RECEIVED];

const STAGE_FIELD = {
  FEASIBILITY: 'feasibilityStatus',
  DESIGN: 'designStatus',
  PRODUCTION: 'productionStatus',
} as const;

export interface SoFilters {
  status?: SalesOrderStatus | 'OPEN';
  customerId?: number;
  /** Orders waiting for this approval stage (stage pending, order submitted). */
  awaiting?: ApprovalStage;
}

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListQuery, filters: SoFilters) {
    const where: Prisma.SalesOrderWhereInput = {
      ...(filters.status === 'OPEN'
        ? { status: { in: [SalesOrderStatus.APPROVED, SalesOrderStatus.IN_PRODUCTION, SalesOrderStatus.PARTIALLY_DISPATCHED] } }
        : filters.status
          ? { status: filters.status }
          : {}),
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(filters.awaiting ? awaitingWhere(filters.awaiting) : {}),
    };
    const args = listArgs(
      query,
      {
        searchFields: ['soNo', 'customerPoNo', 'customer.name', 'additionalRequirement'],
        sortable: ['soNo', 'soDate', 'expectedDelivery', 'totalAmount', 'status'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      where,
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.salesOrder.findMany({ ...args, include: listInclude }),
      this.prisma.salesOrder.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  get(id: number): Promise<SalesOrderFull> {
    return this.prisma.salesOrder.findUniqueOrThrow({ where: { id }, include: soInclude });
  }

  /** Is this customer PO number already on another order? */
  async checkPo(customerId: number, poNo: string, excludeId?: number) {
    const found = await this.prisma.salesOrder.findFirst({
      where: { customerId, customerPoNo: poNo.trim(), ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true, soNo: true },
    });
    return { exists: !!found, soNo: found?.soNo ?? null, id: found?.id ?? null };
  }

  create(input: SalesOrderInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertPoFree(tx, input);
      const { header, lines, total } = await this.prepare(tx, input);
      const so = await tx.salesOrder.create({
        data: {
          ...header,
          salesPersonId: header.salesPersonId ?? actor.userId,
          soNo: await this.numbering.next('SALES_ORDER', { tx, date: header.soDate }),
          totalAmount: total,
          status: SalesOrderStatus.DRAFT,
          createdById: actor.userId,
          lines: { create: lines },
        },
        include: soInclude,
      });
      await this.audit.log(
        actor,
        {
          action: AuditAction.CREATE,
          entity: 'sales_order',
          entityId: so.id,
          summary: `Created ${so.soNo} for ${so.customer.name}${so.customerPoNo ? ` (PO ${so.customerPoNo})` : ''}`,
        },
        tx,
      );
      return so;
    });
  }

  /** Allowed before approval. Any change sends the order through all approvals again. */
  async update(id: number, input: SalesOrderInput, actor: Actor) {
    const before = await this.get(id);
    this.assertStatus(before, [SalesOrderStatus.DRAFT, SalesOrderStatus.PENDING_APPROVAL], 'edited');
    const so = await this.prisma.$transaction(async (tx) => {
      await this.assertPoFree(tx, input, id);
      const { header, lines, total } = await this.prepare(tx, input);
      await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
      return tx.salesOrder.update({
        where: { id },
        data: {
          ...header,
          totalAmount: total,
          feasibilityStatus: ApprovalStatus.PENDING,
          designStatus: ApprovalStatus.PENDING,
          productionStatus: ApprovalStatus.PENDING,
          lines: { create: lines },
        },
        include: soInclude,
      });
    });
    const hadApprovals = [before.feasibilityStatus, before.designStatus, before.productionStatus].some((s) => s !== ApprovalStatus.PENDING);
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'sales_order',
      entityId: id,
      summary: `Updated ${so.soNo}${hadApprovals ? ' - approvals reset' : ''}`,
    });
    return so;
  }

  async submit(id: number, actor: Actor) {
    const so = await this.get(id);
    this.assertStatus(so, [SalesOrderStatus.DRAFT], 'submitted');
    await this.prisma.salesOrder.update({
      where: { id },
      data: {
        status: SalesOrderStatus.PENDING_APPROVAL,
        submittedAt: new Date(),
        feasibilityStatus: ApprovalStatus.PENDING,
        designStatus: ApprovalStatus.PENDING,
        productionStatus: ApprovalStatus.PENDING,
      },
    });
    await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'sales_order', entityId: id, summary: `Submitted ${so.soNo} for approval` });
    await this.notifications.toPermission('so_feasibility.approve', { title: `${so.soNo} waits for feasibility`, body: so.customer.name, link: `/sales/orders/${id}` }, actor.userId);
    return this.get(id);
  }

  /**
   * One approval stage. Feasibility (with in-house / outsource per line) comes first;
   * design and production need feasibility. A rejection sends the order back to sales.
   */
  async decide(id: number, stage: ApprovalStage, input: ApprovalDecisionInput, actor: Actor) {
    const so = await this.get(id);
    if (so.status !== SalesOrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        so.status === SalesOrderStatus.DRAFT ? `${so.soNo} is not submitted for approval yet` : `${so.soNo} is already ${so.status.toLowerCase().replace('_', ' ')}`,
      );
    }
    if (stage !== ApprovalStage.FEASIBILITY && so.feasibilityStatus !== ApprovalStatus.APPROVED) {
      throw new BadRequestException('Feasibility must be approved first');
    }
    const approved = input.decision === 'APPROVED';

    await this.prisma.$transaction(async (tx) => {
      if (stage === ApprovalStage.FEASIBILITY && approved) {
        const decisions = new Map((input.lineDecisions ?? []).map((d) => [d.lineId, d.decision]));
        const missing = so.lines.filter((l) => !decisions.has(l.id));
        if (missing.length) {
          throw new BadRequestException(`Choose in-house or outsource for: ${missing.map((l) => l.product.name).join(', ')}`);
        }
        for (const line of so.lines) {
          await tx.salesOrderLine.update({ where: { id: line.id }, data: { decision: decisions.get(line.id) as ProductionDecision } });
        }
      }

      const data: Prisma.SalesOrderUpdateInput = { [STAGE_FIELD[stage]]: input.decision as ApprovalStatus };
      if (!approved) {
        data.status = SalesOrderStatus.DRAFT;
        if (stage === ApprovalStage.FEASIBILITY) {
          data.designStatus = ApprovalStatus.PENDING;
          data.productionStatus = ApprovalStatus.PENDING;
        }
      } else {
        const after = { ...so, [STAGE_FIELD[stage]]: ApprovalStatus.APPROVED };
        if ([after.feasibilityStatus, after.designStatus, after.productionStatus].every((s) => s === ApprovalStatus.APPROVED)) {
          data.status = SalesOrderStatus.APPROVED;
          data.approvedAt = new Date();
        }
      }
      await tx.salesOrder.update({ where: { id }, data });
      await tx.salesOrderApproval.create({
        data: { salesOrderId: id, stage, decision: input.decision as ApprovalStatus, remarks: input.remarks || null, userId: actor.userId },
      });
      await this.audit.log(
        actor,
        {
          action: AuditAction.STATUS_CHANGE,
          entity: 'sales_order',
          entityId: id,
          summary: `${stage.charAt(0)}${stage.slice(1).toLowerCase()} ${approved ? 'approved' : 'rejected'} for ${so.soNo}${input.remarks ? `: ${input.remarks}` : ''}`,
        },
        tx,
      );
    });
    await this.notifyDecision(so, stage, input, actor);
    return this.get(id);
  }

  /** Who has to act next after an approval decision. */
  private async notifyDecision(so: SalesOrderFull, stage: ApprovalStage, input: ApprovalDecisionInput, actor: Actor) {
    const link = `/sales/orders/${so.id}`;
    const stageName = stage.charAt(0) + stage.slice(1).toLowerCase();
    const sales = [so.salesPerson?.id, so.createdById].filter((u): u is number => !!u && u !== actor.userId);
    if (input.decision !== 'APPROVED') {
      await this.notifications.toUsers(sales, { title: `${so.soNo} rejected at ${stageName.toLowerCase()}`, body: input.remarks || so.customer.name, link }, { kind: 'TASK' }).catch(() => 0);
      return;
    }
    const now = await this.prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id }, select: { status: true, designStatus: true, productionStatus: true } });
    if (now.status === SalesOrderStatus.APPROVED) {
      await this.notifications.toPermission('stock_check.create', { title: `${so.soNo} approved - plan production`, body: so.customer.name, link }, actor.userId);
      await this.notifications.toUsers(sales, { title: `${so.soNo} is approved`, body: so.customer.name, link }, { kind: 'TASK' }).catch(() => 0);
    } else if (stage === ApprovalStage.FEASIBILITY) {
      if (now.designStatus === ApprovalStatus.PENDING) await this.notifications.toPermission('so_design.approve', { title: `${so.soNo} waits for design approval`, body: so.customer.name, link }, actor.userId);
      if (now.productionStatus === ApprovalStatus.PENDING) await this.notifications.toPermission('so_production.approve', { title: `${so.soNo} waits for production approval`, body: so.customer.name, link }, actor.userId);
    }
  }

  /** Approved order needs a change before production starts. */
  async reopen(id: number, actor: Actor) {
    const so = await this.get(id);
    this.assertStatus(so, [SalesOrderStatus.APPROVED], 'reopened');
    if (so.lines.some((l) => l.productionRequests.some((r) => ACTIVE_REQUEST.includes(r.status)))) {
      throw new BadRequestException('Production is already requested for this order - cancel those requests first');
    }
    await this.prisma.salesOrder.update({
      where: { id },
      data: {
        status: SalesOrderStatus.DRAFT,
        approvedAt: null,
        feasibilityStatus: ApprovalStatus.PENDING,
        designStatus: ApprovalStatus.PENDING,
        productionStatus: ApprovalStatus.PENDING,
      },
    });
    await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'sales_order', entityId: id, summary: `Reopened ${so.soNo} for changes` });
    return this.get(id);
  }

  async cancel(id: number, reason: string, actor: Actor) {
    const so = await this.get(id);
    this.assertStatus(
      so,
      [SalesOrderStatus.DRAFT, SalesOrderStatus.PENDING_APPROVAL, SalesOrderStatus.APPROVED, SalesOrderStatus.IN_PRODUCTION],
      'cancelled',
    );
    if (so.lines.some((l) => l.productionRequests.some((r) => r.status === ProductionRequestStatus.ACCEPTED))) {
      throw new BadRequestException('Production has already accepted work for this order - it cannot be cancelled here');
    }
    const jobWork = so.lines.flatMap((l) => l.jobWorkLines).find((j) => j.jobWorkOrder.status !== JobWorkStatus.CANCELLED);
    if (jobWork) throw new BadRequestException(`Job work order ${jobWork.jobWorkOrder.jwoNo} exists for this order - cancel or close it first`);
    await this.prisma.$transaction(async (tx) => {
      await tx.productionRequest.updateMany({
        where: { salesOrderLine: { salesOrderId: id }, status: ProductionRequestStatus.REQUESTED },
        data: { status: ProductionRequestStatus.CANCELLED, cancelReason: `Sales order cancelled: ${reason}` },
      });
      await tx.salesOrder.update({ where: { id }, data: { status: SalesOrderStatus.CANCELLED, cancelReason: reason } });
    });
    await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'sales_order', entityId: id, summary: `Cancelled ${so.soNo}: ${reason}` });
    return this.get(id);
  }

  async remove(id: number, actor: Actor) {
    const so = await this.get(id);
    this.assertStatus(so, [SalesOrderStatus.DRAFT], 'deleted');
    if (so.submittedAt) throw new BadRequestException(`${so.soNo} was already sent for approval - cancel it instead`);
    const files = await this.prisma.attachment.count({ where: { entity: 'sales_order', entityId: id } });
    if (files) throw new BadRequestException('Remove the attached drawings first');
    await this.prisma.salesOrder.delete({ where: { id } });
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'sales_order', entityId: id, summary: `Deleted draft ${so.soNo}` });
  }

  /**
   * For every line: the parts (BOM) needed, finished stock in the FG store,
   * what is already requested from production, and the shortage.
   */
  async stockCheck(id: number) {
    const so = await this.get(id);
    const items = await this.prisma.item.findMany({
      where: { productId: { in: so.lines.map((l) => l.productId) } },
      select: { id: true, code: true, name: true, productId: true, partTypeId: true, endConnection: true, isActive: true },
    });
    const balances = await this.prisma.stockBalance.groupBy({
      by: ['itemId'],
      where: { kind: StockKind.FINISHED_GOOD, location: StockLocation.FG_STORE, itemId: { in: items.map((i) => i.id) } },
      _sum: { quantity: true },
    });
    const stock = new Map(balances.map((b) => [b.itemId, b._sum.quantity?.toNumber() ?? 0]));

    const lines = so.lines.map((line) => {
      const qty = line.quantity.toNumber();
      const parts = line.product.components.map((c) => {
        const end = c.partType.hasEndConnection ? line.endConnection : EndConnection.NONE;
        const item = items.find((i) => i.productId === line.productId && i.partTypeId === c.partTypeId && i.endConnection === end);
        const perSet = c.quantity.toNumber();
        const needed = qty * perSet;
        const inStock = item ? (stock.get(item.id) ?? 0) : 0;
        const requested = item
          ? line.productionRequests.filter((r) => r.itemId === item.id && ACTIVE_REQUEST.includes(r.status)).reduce((s, r) => s + r.quantity.toNumber(), 0)
          : 0;
        // Still to come back from job-work vendors (ordered minus accepted) on running orders.
        const withVendor = item
          ? line.jobWorkLines
              .filter((j) => j.itemId === item.id && RUNNING_JOB_WORK.includes(j.jobWorkOrder.status))
              .reduce((s, j) => s + Math.max(0, j.quantity.toNumber() - j.receivedQty.toNumber()), 0)
          : 0;
        return {
          partTypeId: c.partTypeId,
          partName: c.partType.name,
          perSet,
          item: item ? { id: item.id, code: item.code, name: item.name } : null,
          needed,
          inStock,
          requested,
          withVendor,
          shortage: Math.max(0, round2(needed - inStock - requested - withVendor)),
        };
      });
      const setsFromStock = parts.length ? Math.min(qty, ...parts.map((p) => Math.floor(p.inStock / (p.perSet || 1)))) : 0;
      return {
        lineId: line.id,
        lineNo: line.lineNo,
        product: { id: line.product.id, name: line.product.name },
        endConnection: line.endConnection,
        service: line.service,
        quantity: qty,
        dispatchedQty: line.dispatchedQty.toNumber(),
        decision: line.decision,
        setsFromStock,
        parts,
      };
    });
    return { salesOrderId: so.id, soNo: so.soNo, status: so.status, lines };
  }

  /** Ask production to make the shortage (make-to-order). */
  async requestProduction(id: number, input: SoProductionRequestInput, actor: Actor) {
    const so = await this.get(id);
    this.assertStatus(so, [SalesOrderStatus.APPROVED, SalesOrderStatus.IN_PRODUCTION], 'sent to production');
    const check = await this.stockCheck(id);

    const created = await this.prisma.$transaction(async (tx) => {
      const out: string[] = [];
      for (const req of input.lines) {
        const line = check.lines.find((l) => l.lineId === req.salesOrderLineId);
        if (!line) throw new BadRequestException('This line does not belong to the order');
        if (line.decision !== ProductionDecision.INHOUSE) {
          throw new BadRequestException(`${line.product.name} is set to outsource - it goes to job work, not in-house production`);
        }
        const part = line.parts.find((p) => p.item?.id === req.itemId);
        if (!part) throw new BadRequestException(`That item is not a part of ${line.product.name}`);
        const pr = await tx.productionRequest.create({
          data: {
            requestNo: await this.numbering.next('PRODUCTION_REQUEST', { tx }),
            type: ProductionRequestType.MAKE_TO_ORDER,
            salesOrderLineId: line.lineId,
            itemId: req.itemId,
            quantity: req.quantity,
            requiredBy: input.requiredBy ? new Date(`${input.requiredBy}T00:00:00Z`) : (so.expectedDelivery ?? null),
            remarks: input.remarks || null,
            createdById: actor.userId,
          },
        });
        out.push(`${pr.requestNo}: ${req.quantity} x ${part.item!.name}`);
      }
      if (so.status === SalesOrderStatus.APPROVED) {
        await tx.salesOrder.update({ where: { id }, data: { status: SalesOrderStatus.IN_PRODUCTION } });
      }
      await this.audit.log(
        actor,
        { action: AuditAction.CREATE, entity: 'production_request', summary: `Production requested for ${so.soNo}`, changes: { requests: out } },
        tx,
      );
      return out;
    });
    await this.notifications.toPermission('route_cards.create', { title: `Production requested for ${so.soNo}`, body: created.join('; ').slice(0, 300), link: '/production/requests?status=REQUESTED' }, actor.userId);
    return { created };
  }

  // ------------------------------------------------------------------ helpers

  private async assertPoFree(tx: Tx, input: SalesOrderInput, excludeId?: number) {
    if (!input.customerPoNo?.trim()) return;
    const found = await tx.salesOrder.findFirst({
      where: { customerId: input.customerId, customerPoNo: input.customerPoNo.trim(), ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { soNo: true },
    });
    if (found) {
      throw new ConflictException({
        message: `This customer PO is already on ${found.soNo}`,
        errors: { customerPoNo: `Already used on ${found.soNo}` },
      });
    }
  }

  /** Checks the lines against the product BOM and works out amounts. */
  private async prepare(tx: Tx, input: SalesOrderInput) {
    const { lines, ...fields } = input;
    const products = await tx.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) } },
      include: { components: { include: { partType: true } } },
    });
    const prepared = lines.map((line, i) => {
      const product = products.find((p) => p.id === line.productId);
      if (!product) throw new BadRequestException(`Line ${i + 1}: product not found`);
      if (!product.isActive) throw new BadRequestException(`Line ${i + 1}: ${product.name} is inactive`);
      if (!product.components.length) throw new BadRequestException(`Line ${i + 1}: ${product.name} has no parts (BOM) yet`);
      const needsEnd = product.components.some((c) => c.partType.hasEndConnection);
      if (needsEnd && line.endConnection === 'NONE') {
        throw new BadRequestException({
          message: `Line ${i + 1}: choose BW or THD for ${product.name}`,
          errors: { [`lines.${i}.endConnection`]: 'Choose BW or THD' },
        });
      }
      return {
        lineNo: i + 1,
        productId: line.productId,
        endConnection: needsEnd ? line.endConnection : EndConnection.NONE,
        service: line.service,
        schedule: line.schedule || null,
        materialGradeId: line.materialGradeId ?? null,
        quantity: line.quantity,
        rate: line.rate,
        amount: round2(line.quantity * line.rate),
        remarks: line.remarks || null,
        decision: ProductionDecision.PENDING,
      };
    });
    const total = round2(prepared.reduce((s, l) => s + l.amount, 0));
    return { header: normalize(fields, ['expectedDelivery']), lines: prepared, total };
  }

  private assertStatus(so: { soNo: string; status: SalesOrderStatus }, allowed: SalesOrderStatus[], verb: string) {
    if (!allowed.includes(so.status)) {
      throw new BadRequestException(`${so.soNo} is ${so.status.toLowerCase().replace('_', ' ')} and cannot be ${verb}`);
    }
  }
}

/** Orders waiting for a stage decision. */
export function awaitingWhere(stage: ApprovalStage): Prisma.SalesOrderWhereInput {
  const base = { status: SalesOrderStatus.PENDING_APPROVAL };
  if (stage === ApprovalStage.FEASIBILITY) return { ...base, feasibilityStatus: ApprovalStatus.PENDING };
  return { ...base, feasibilityStatus: ApprovalStatus.APPROVED, [STAGE_FIELD[stage]]: ApprovalStatus.PENDING };
}
