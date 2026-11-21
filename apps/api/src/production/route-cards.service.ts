import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  WILDCARD_PERMISSION,
  type ListQuery,
  type OperationRecordInput,
  type RouteCardFieldsInput,
  type RouteCardInput,
} from '@bht/shared';
import {
  AuditAction,
  CompletionStatus,
  OperationStatus,
  Prisma,
  ProductionRequestStatus,
  RequisitionStatus,
  RouteCardStatus,
} from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { NotificationsService } from '../core/notifications.service';
import { listArgs, paginated } from '../common/list';
import { normalize } from '../common/normalize';
import type { Actor, AuthUser } from '../common/auth-user';
import { renderRouteCardPdf } from './rc-pdf';
import { brand } from '../config/brand';

const stageSelect = {
  id: true,
  code: true,
  name: true,
  type: true,
  captureWeights: true,
  requiresReport: true,
  isMaterialCheck: true,
  roles: { select: { role: { select: { id: true, name: true } } } },
} as const satisfies Prisma.ProcessStageSelect;

export const rcInclude = {
  item: {
    select: {
      id: true,
      code: true,
      name: true,
      endConnection: true,
      drawingNo: true,
      partType: { select: { name: true } },
      product: { select: { id: true, name: true } },
    },
  },
  rawMaterial: { select: { id: true, code: true, size: true, uom: true, grade: { select: { name: true } } } },
  productionRequest: { select: { id: true, requestNo: true, type: true, quantity: true, status: true, requiredBy: true, remarks: true } },
  salesOrderLine: {
    select: {
      id: true,
      lineNo: true,
      service: true,
      schedule: true,
      salesOrder: { select: { id: true, soNo: true, customerPoNo: true, customer: { select: { id: true, name: true } } } },
    },
  },
  currentStage: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  operations: {
    orderBy: { sequence: 'asc' },
    include: { stage: { select: stageSelect }, updatedBy: { select: { id: true, name: true } } },
  },
  materialRequisitions: { orderBy: { id: 'asc' }, include: { createdBy: { select: { id: true, name: true } } } },
  materialIssues: {
    orderBy: { id: 'asc' },
    include: {
      heat: { select: { id: true, heatNo: true, millHeatNo: true } },
      issuedBy: { select: { id: true, name: true } },
      materialRequisition: { select: { id: true, mrNo: true } },
    },
  },
  completions: {
    orderBy: { id: 'asc' },
    include: { heats: { include: { heat: { select: { id: true, heatNo: true } } } }, movedBy: { select: { id: true, name: true } } },
  },
} as const satisfies Prisma.RouteCardInclude;

export type RouteCardFull = Prisma.RouteCardGetPayload<{ include: typeof rcInclude }>;
type Operation = RouteCardFull['operations'][number];
type Stage = Operation['stage'];

const listInclude = {
  item: { select: { id: true, code: true, name: true } },
  currentStage: { select: { id: true, name: true } },
  productionRequest: { select: { id: true, requestNo: true, type: true } },
  salesOrderLine: { select: { salesOrder: { select: { id: true, soNo: true, customer: { select: { name: true } } } } } },
  operations: { select: { status: true, okQty: true }, orderBy: { sequence: 'asc' } },
  _count: { select: { materialIssues: true } },
} as const satisfies Prisma.RouteCardInclude;

const ACTIVE: RouteCardStatus[] = [RouteCardStatus.OPEN, RouteCardStatus.IN_PROGRESS];

export interface RcFilters {
  status?: RouteCardStatus | 'ACTIVE';
  stageId?: number;
  itemId?: number;
  /** Route cards waiting at a stage the user's role records. */
  mine?: boolean;
}

/** Route cards waiting at a stage this user may record. Admin: all running cards. */
export function waitingForWhere(user: Pick<AuthUser, 'roleId' | 'permissions'>): Prisma.RouteCardWhereInput {
  return {
    status: { in: ACTIVE },
    ...(user.permissions.includes(WILDCARD_PERMISSION) ? {} : { currentStage: { roles: { some: { roleId: user.roleId } } } }),
  };
}

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

/** Material issued to the card and still there (issues minus returns), per heat. */
export function issuedByHeat(issues: { heatId: number; quantity: Prisma.Decimal | number; heat: { id: number; heatNo: string; millHeatNo: string | null } }[]) {
  const map = new Map<number, { heatId: number; heatNo: string; millHeatNo: string | null; quantity: number }>();
  for (const i of issues) {
    const row = map.get(i.heatId) ?? { heatId: i.heatId, heatNo: i.heat.heatNo, millHeatNo: i.heat.millHeatNo, quantity: 0 };
    row.quantity = round3(row.quantity + n(i.quantity));
    map.set(i.heatId, row);
  }
  return [...map.values()];
}

@Injectable()
export class RouteCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListQuery, filters: RcFilters, user: AuthUser) {
    const where: Prisma.RouteCardWhereInput = {
      ...(filters.status === 'ACTIVE' ? { status: { in: ACTIVE } } : filters.status ? { status: filters.status } : {}),
      ...(filters.stageId ? { currentStageId: filters.stageId, status: { in: ACTIVE } } : {}),
      ...(filters.itemId ? { itemId: filters.itemId } : {}),
      ...(filters.mine ? waitingForWhere(user) : {}),
    };
    const args = listArgs(
      query,
      {
        searchFields: ['rcNo', 'item.name', 'item.code', 'salesOrderLine.salesOrder.soNo', 'productionRequest.requestNo'],
        sortable: ['rcNo', 'rcDate', 'expectedDelivery', 'plannedQty', 'status'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      where,
    );
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.routeCard.findMany({ ...args, include: listInclude }),
      this.prisma.routeCard.count({ where: args.where }),
    ]);
    const data = rows.map(({ operations, _count, ...rc }) => ({
      ...rc,
      stagesTotal: operations.length,
      stagesDone: operations.filter((o) => o.status === OperationStatus.DONE).length,
      finalOkQty: operations.at(-1)?.status === OperationStatus.DONE ? n(operations.at(-1)!.okQty) : null,
      materialIssued: _count.materialIssues > 0,
    }));
    return paginated(data, total, query);
  }

  /** Full card plus what the screen needs: material summary, heats, which stages this user may record. */
  async get(id: number, user: AuthUser) {
    const rc = await this.prisma.routeCard.findUnique({ where: { id }, include: rcInclude });
    if (!rc) throw new NotFoundException('Route card not found');
    const reports = await this.prisma.attachment.groupBy({
      by: ['entityId'],
      where: { entity: 'route_card_operation', entityId: { in: rc.operations.map((o) => o.id) } },
      _count: { _all: true },
    });
    const reportCount = new Map(reports.map((r) => [r.entityId, r._count._all]));
    const heats = issuedByHeat(rc.materialIssues);
    const totalPcs = n(rc.plannedQty) + n(rc.extraQty);
    const requested = rc.materialRequisitions.reduce(
      (s, mr) => s + (mr.status === RequisitionStatus.CANCELLED ? n(mr.issuedQty) : n(mr.requestedQty)),
      0,
    );
    return {
      ...rc,
      material: {
        neededKg: rc.inputWeightKg ? round3(totalPcs * n(rc.inputWeightKg)) : null,
        requestedKg: round3(requested),
        issuedKg: round3(heats.reduce((s, h) => s + h.quantity, 0)),
      },
      heats,
      operations: rc.operations.map((op, i) => ({
        ...op,
        reports: reportCount.get(op.id) ?? 0,
        canRecord: canRecordStage(user, op.stage) && this.openForEdit(rc, i) === null,
        lockedReason: this.openForEdit(rc, i),
      })),
    };
  }

  async pdf(id: number) {
    const rc = await this.prisma.routeCard.findUnique({ where: { id }, include: rcInclude });
    if (!rc) throw new NotFoundException('Route card not found');
    const company = await this.prisma.company.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] });
    const buffer = await renderRouteCardPdf(rc, company?.name ?? brand().name);
    return { fileName: `${rc.rcNo.replace(/[^\w-]+/g, '-')}.pdf`, buffer };
  }

  /** Values for the "new route card" form, from a production request. */
  async defaults(requestId: number) {
    const request = await this.prisma.productionRequest.findUnique({
      where: { id: requestId },
      include: {
        item: { select: { id: true, code: true, name: true, rawMaterialId: true, inputWeightKg: true } },
        salesOrderLine: { select: { salesOrder: { select: { id: true, soNo: true, customer: { select: { name: true } } } } } },
      },
    });
    if (!request) throw new NotFoundException('Production request not found');
    const stages = await this.prisma.processStage.findMany({ where: { isActive: true }, orderBy: { sequence: 'asc' }, select: stageSelect });
    // Same part made before: start from the stages it went through then.
    const last = await this.prisma.routeCard.findFirst({
      where: { itemId: request.itemId, status: { not: RouteCardStatus.CANCELLED } },
      orderBy: { id: 'desc' },
      select: { rcNo: true, rawMaterialId: true, inputWeightKg: true, operations: { select: { stageId: true } } },
    });
    const activeIds = new Set(stages.map((s) => s.id));
    const lastStages = last?.operations.map((o) => o.stageId).filter((sid) => activeIds.has(sid));
    return {
      request,
      stages,
      stageIds: lastStages?.length ? lastStages : stages.map((s) => s.id),
      stagesFrom: lastStages?.length ? last!.rcNo : null,
      rawMaterialId: request.item.rawMaterialId ?? last?.rawMaterialId ?? null,
      inputWeightKg: request.item.inputWeightKg ?? last?.inputWeightKg ?? null,
    };
  }

  async create(input: RouteCardInput, actor: Actor) {
    const rc = await this.prisma.$transaction(async (tx) => {
      const request = await tx.productionRequest.findUnique({ where: { id: input.productionRequestId }, include: { item: true } });
      if (!request) throw new BadRequestException({ message: 'Production request not found', errors: { productionRequestId: 'Not found' } });
      if (request.status !== ProductionRequestStatus.REQUESTED) {
        throw new BadRequestException({
          message: `${request.requestNo} is ${request.status.toLowerCase()} - it already has a route card or is closed`,
          errors: { productionRequestId: 'Already planned' },
        });
      }
      const stages = await this.checkStages(tx, input.stageIds);
      await this.checkRawMaterial(tx, input.rawMaterialId);
      const f = normalize(fieldsOf(input), ['expectedDelivery']);
      const created = await tx.routeCard.create({
        data: {
          rcNo: await this.numbering.next('ROUTE_CARD', { tx, date: f.rcDate }),
          rcDate: f.rcDate,
          productionRequestId: request.id,
          salesOrderLineId: request.salesOrderLineId,
          itemId: request.itemId,
          rawMaterialId: input.rawMaterialId,
          inputWeightKg: f.inputWeightKg,
          plannedQty: request.quantity,
          extraQty: input.extraQty,
          expectedDelivery: f.expectedDelivery ?? request.requiredBy,
          remarks: f.remarks,
          createdById: actor.userId,
          currentStageId: stages[0].id,
          operations: { create: stages.map((s, i) => ({ stageId: s.id, sequence: i + 1 })) },
        },
      });
      await tx.productionRequest.update({ where: { id: request.id }, data: { status: ProductionRequestStatus.ACCEPTED } });
      // First route card of a part fills in its material / bar weight on the item master.
      if (!request.item.rawMaterialId || (!request.item.inputWeightKg && f.inputWeightKg)) {
        await tx.item.update({
          where: { id: request.itemId },
          data: {
            ...(!request.item.rawMaterialId ? { rawMaterialId: input.rawMaterialId } : {}),
            ...(!request.item.inputWeightKg && f.inputWeightKg ? { inputWeightKg: f.inputWeightKg } : {}),
          },
        });
      }
      await this.audit.log(
        actor,
        {
          action: AuditAction.CREATE,
          entity: 'route_card',
          entityId: created.id,
          summary: `Route card ${created.rcNo} for ${request.requestNo}: ${n(request.quantity) + input.extraQty} x ${request.item.name}`,
        },
        tx,
      );
      return created;
    });
    return { id: rc.id, rcNo: rc.rcNo };
  }

  /** Change the plan while no stage is recorded yet. */
  async update(id: number, input: RouteCardFieldsInput, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const rc = await tx.routeCard.findUniqueOrThrow({
        where: { id },
        include: { operations: true, materialRequisitions: { where: { status: { not: RequisitionStatus.CANCELLED } } }, _count: { select: { materialIssues: true } } },
      });
      if (rc.status !== RouteCardStatus.OPEN || rc.operations.some((o) => o.status !== OperationStatus.PENDING)) {
        throw new BadRequestException(`${rc.rcNo} is already started and cannot be changed`);
      }
      if (input.rawMaterialId !== rc.rawMaterialId && (rc._count.materialIssues || rc.materialRequisitions.length)) {
        throw new BadRequestException({
          message: 'Material is already requested for this card - cancel the request first to change the material',
          errors: { rawMaterialId: 'Material already requested' },
        });
      }
      const stages = await this.checkStages(tx, input.stageIds);
      await this.checkRawMaterial(tx, input.rawMaterialId);
      const f = normalize(fieldsOf(input), ['expectedDelivery']);
      const sameStages = stages.map((s) => s.id).join() === rc.operations.sort((a, b) => a.sequence - b.sequence).map((o) => o.stageId).join();
      if (!sameStages) {
        await tx.routeCardOperation.deleteMany({ where: { routeCardId: id } });
        await tx.routeCardOperation.createMany({ data: stages.map((s, i) => ({ routeCardId: id, stageId: s.id, sequence: i + 1 })) });
      }
      await tx.routeCard.update({
        where: { id },
        data: {
          rcDate: f.rcDate,
          rawMaterialId: input.rawMaterialId,
          inputWeightKg: f.inputWeightKg,
          extraQty: input.extraQty,
          expectedDelivery: f.expectedDelivery,
          remarks: f.remarks,
          currentStageId: stages[0].id,
        },
      });
      await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'route_card', entityId: id, summary: `Updated route card ${rc.rcNo}` }, tx);
    });
  }

  /** Only a card with nothing recorded and no material left on it; the request can be planned again. */
  async cancel(id: number, reason: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const rc = await tx.routeCard.findUniqueOrThrow({ where: { id }, include: { operations: true, materialIssues: { include: { heat: true } } } });
      if (!ACTIVE.includes(rc.status)) throw new BadRequestException(`${rc.rcNo} is ${rc.status.toLowerCase()} and cannot be cancelled`);
      if (rc.operations.some((o) => o.status !== OperationStatus.PENDING)) {
        throw new BadRequestException(`Stages are already recorded on ${rc.rcNo}; it cannot be cancelled`);
      }
      const left = issuedByHeat(rc.materialIssues).filter((h) => h.quantity > 0);
      if (left.length) {
        throw new BadRequestException(`Return the issued material to the store first (${left.map((h) => `${h.heatNo}: ${h.quantity} kg`).join(', ')})`);
      }
      await tx.materialRequisition.updateMany({
        where: { routeCardId: id, status: { in: [RequisitionStatus.PENDING, RequisitionStatus.PARTIAL] } },
        data: { status: RequisitionStatus.CANCELLED },
      });
      await tx.routeCard.update({ where: { id }, data: { status: RouteCardStatus.CANCELLED, cancelReason: reason, currentStageId: null } });
      if (rc.productionRequestId) {
        await tx.productionRequest.update({ where: { id: rc.productionRequestId }, data: { status: ProductionRequestStatus.REQUESTED } });
      }
      await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'route_card', entityId: id, summary: `Cancelled ${rc.rcNo}: ${reason}` }, tx);
    });
  }

  // ------------------------------------------------------------- stages

  async recordOperation(id: number, opId: number, input: OperationRecordInput, user: AuthUser, actor: Actor) {
    const before = await this.prisma.routeCard.findUnique({ where: { id }, select: { currentStageId: true, status: true } });
    await this.prisma.$transaction(async (tx) => {
      const rc = await this.loadForStage(tx, id);
      const idx = rc.operations.findIndex((o) => o.id === opId);
      if (idx < 0) throw new NotFoundException('Stage not found on this route card');
      const op = rc.operations[idx];
      this.assertCanRecord(user, op.stage);
      const locked = this.openForEdit(rc, idx);
      if (locked) throw new BadRequestException(locked);

      const stage = op.stage;
      const now = new Date();
      const base = {
        operatorName: input.operatorName || null,
        machine: input.machine || null,
        remarks: input.remarks || null,
        updatedById: actor.userId,
        startedAt: op.startedAt ?? now,
        completedAt: now,
      };
      let data: Prisma.RouteCardOperationUncheckedUpdateInput;

      if (stage.isMaterialCheck) {
        if (!input.result) throw new BadRequestException({ message: 'Choose OK or Not OK', errors: { result: 'Required' } });
        if (input.result === 'NOT_OK' && !input.reason) {
          throw new BadRequestException({ message: 'Write why the material is not OK', errors: { reason: 'Required' } });
        }
        data = {
          ...base,
          status: input.result === 'OK' ? OperationStatus.DONE : OperationStatus.IN_PROGRESS,
          readings: { result: input.result },
          rejectionReason: input.result === 'NOT_OK' ? input.reason! : null,
          receivedQty: null,
          okQty: null,
          rejectedQty: null,
        };
      } else {
        const prevPiece = rc.operations.slice(0, idx).reverse().find((o) => !o.stage.isMaterialCheck);
        let ok = input.okQty;
        let rejected = input.rejectedQty;
        let received: number;
        if (!prevPiece) {
          // First piece stage (normally cutting): pieces come from the bar, enter what was made.
          if (ok === undefined) throw new BadRequestException({ message: 'Enter the OK pieces', errors: { okQty: 'Required' } });
          rejected ??= 0;
          received = ok + rejected;
        } else {
          received = n(prevPiece.okQty);
          if (ok === undefined && rejected === undefined) {
            throw new BadRequestException({ message: 'Enter the OK pieces', errors: { okQty: 'Required' } });
          }
          ok ??= received - rejected!;
          rejected ??= received - ok;
          if (ok < 0 || rejected < 0 || ok + rejected !== received) {
            throw new BadRequestException({
              message: `OK + rejected must be the ${received} pieces received from ${prevPiece.stage.name}`,
              errors: { okQty: `OK + rejected = ${received}` },
            });
          }
        }
        if (received === 0) throw new BadRequestException({ message: 'No pieces to record', errors: { okQty: 'Enter the pieces' } });
        if (rejected > 0 && !input.reason) {
          throw new BadRequestException({ message: 'Write the reason for the rejected pieces', errors: { reason: 'Required' } });
        }
        data = {
          ...base,
          status: OperationStatus.DONE,
          receivedQty: received,
          okQty: ok,
          rejectedQty: rejected,
          rejectionReason: rejected > 0 ? input.reason! : null,
          readings: Prisma.DbNull,
        };
        if (stage.captureWeights) {
          if (!input.outputWeightKg) {
            throw new BadRequestException({ message: 'Enter the weight of one piece', errors: { outputWeightKg: 'Required' } });
          }
          const prevWeight = rc.operations.slice(0, idx).reverse().find((o) => o.stage.captureWeights && o.outputWeightKg != null);
          const inputWeight = prevWeight ? n(prevWeight.outputWeightKg) : null;
          data.inputWeightKg = inputWeight;
          data.outputWeightKg = input.outputWeightKg;
          data.scrapWeightKg = inputWeight != null ? round3(Math.max(0, inputWeight - input.outputWeightKg)) : (input.scrapWeightKg ?? null);
        } else {
          data.inputWeightKg = null;
          data.outputWeightKg = null;
          data.scrapWeightKg = null;
        }
      }

      if (stage.requiresReport && data.status === OperationStatus.DONE) {
        const reports = await tx.attachment.count({ where: { entity: 'route_card_operation', entityId: op.id } });
        if (!reports) throw new BadRequestException(`Attach the ${stage.name.toLowerCase()} report first`);
      }

      await tx.routeCardOperation.update({ where: { id: op.id }, data });
      await this.refresh(tx, id, actor);
      const summary = stage.isMaterialCheck
        ? `${rc.rcNo} ${stage.name}: ${input.result === 'OK' ? 'OK' : `not OK - ${input.reason}`}`
        : `${rc.rcNo} ${stage.name}: ${data.okQty} OK${n(data.rejectedQty as number) ? `, ${data.rejectedQty} rejected (${input.reason})` : ''}`;
      await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'route_card', entityId: id, summary }, tx);
    });
    await this.notifyNextStage(id, before, actor);
  }

  /** The department of the stage the card has moved to is told; a finished card goes to the store. */
  private async notifyNextStage(id: number, before: { currentStageId: number | null; status: string } | null, actor: Actor) {
    const rc = await this.prisma.routeCard.findUnique({
      where: { id },
      select: { rcNo: true, status: true, currentStageId: true, item: { select: { name: true } }, currentStage: { select: { name: true, roles: { select: { roleId: true } } } } },
    });
    if (!rc) return;
    const link = `/production/route-cards/${id}`;
    if (rc.status === 'COMPLETED' && before?.status !== 'COMPLETED') {
      await this.notifications.toPermission('rc_completions.create', { title: `${rc.rcNo} finished - put the parts in the FG store`, body: rc.item.name, link: '/store/rc-completion' }, actor.userId);
      return;
    }
    if (!rc.currentStage || rc.currentStageId === before?.currentStageId) return;
    const users = await this.prisma.user.findMany({ where: { isActive: true, roleId: { in: rc.currentStage.roles.map((r) => r.roleId) } }, select: { id: true } });
    await this.notifications
      .toUsers(users.map((u) => u.id).filter((u) => u !== actor.userId), { title: `${rc.rcNo} is at your stage: ${rc.currentStage.name}`, body: rc.item.name, link }, { kind: 'TASK' })
      .catch(() => 0);
  }

  /** Undo a stage entry made by mistake (only while the next stage is still empty). */
  async clearOperation(id: number, opId: number, user: AuthUser, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const rc = await this.loadForStage(tx, id);
      const idx = rc.operations.findIndex((o) => o.id === opId);
      if (idx < 0) throw new NotFoundException('Stage not found on this route card');
      const op = rc.operations[idx];
      this.assertCanRecord(user, op.stage);
      const locked = this.openForEdit(rc, idx);
      if (locked) throw new BadRequestException(locked);
      if (op.status === OperationStatus.PENDING) return;
      await tx.routeCardOperation.update({
        where: { id: op.id },
        data: {
          status: OperationStatus.PENDING,
          receivedQty: null,
          okQty: null,
          rejectedQty: null,
          rejectionReason: null,
          inputWeightKg: null,
          outputWeightKg: null,
          scrapWeightKg: null,
          readings: Prisma.DbNull,
          operatorName: null,
          machine: null,
          remarks: null,
          startedAt: null,
          completedAt: null,
          updatedById: actor.userId,
        },
      });
      await this.refresh(tx, id, actor);
      await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'route_card', entityId: id, summary: `${rc.rcNo}: cleared ${op.stage.name}` }, tx);
    });
  }

  /**
   * Why stage `idx` cannot be recorded / changed now, or null when it can.
   * Stages go in order; a stage is fixed once the next one has an entry.
   */
  private openForEdit(
    rc: {
      status: RouteCardStatus;
      operations: { status: OperationStatus; stage: { name: string } }[];
      completions: { status: CompletionStatus }[];
      materialIssues: { quantity: Prisma.Decimal | number }[];
    },
    idx: number,
  ): string | null {
    if (rc.status === RouteCardStatus.CANCELLED) return 'This route card is cancelled';
    if (rc.completions.some((c) => c.status === CompletionStatus.MOVED_TO_STOCK)) return 'The parts are already in FG stock';
    const ops = rc.operations;
    if (rc.materialIssues.reduce((s, i) => s + n(i.quantity), 0) <= 0) return 'Waiting for material from the store';
    const prev = ops[idx - 1];
    if (prev && prev.status !== OperationStatus.DONE) return `Waiting for ${prev.stage.name}`;
    const next = ops[idx + 1];
    if (next && next.status !== OperationStatus.PENDING) return `${next.stage.name} is already recorded`;
    return null;
  }

  private assertCanRecord(user: AuthUser, stage: Stage) {
    if (!canRecordStage(user, stage)) {
      throw new ForbiddenException(`Only ${stage.roles.map((r) => r.role.name).join(' / ') || 'the admin'} can record ${stage.name}`);
    }
  }

  private loadForStage(tx: Tx, id: number) {
    return tx.routeCard.findUniqueOrThrow({
      where: { id },
      include: {
        operations: { orderBy: { sequence: 'asc' }, include: { stage: { select: stageSelect } } },
        completions: true,
        materialIssues: { select: { quantity: true } },
      },
    });
  }

  /** Re-work status, current stage, rejected total and the completion slip after a stage changes. */
  private async refresh(tx: Tx, id: number, actor: Actor) {
    const rc = await tx.routeCard.findUniqueOrThrow({
      where: { id },
      include: { operations: { orderBy: { sequence: 'asc' } }, completions: true, item: { select: { name: true } } },
    });
    const ops = rc.operations;
    const waiting = ops.find((o) => o.status !== OperationStatus.DONE);
    const anyRecorded = ops.some((o) => o.status !== OperationStatus.PENDING);
    const last = ops.at(-1)!;
    const finalOk = last.status === OperationStatus.DONE ? n(last.okQty) : null;
    const pending = rc.completions.find((c) => c.status === CompletionStatus.PENDING);

    let status: RouteCardStatus = waiting ? (anyRecorded ? RouteCardStatus.IN_PROGRESS : RouteCardStatus.OPEN) : RouteCardStatus.COMPLETED;
    if (finalOk !== null && finalOk > 0) {
      if (rc.status === RouteCardStatus.CLOSED && rc.productionRequestId) {
        // Was closed with nothing passed; a corrected entry links the request again.
        await tx.productionRequest.updateMany({
          where: { id: rc.productionRequestId, status: ProductionRequestStatus.REQUESTED },
          data: { status: ProductionRequestStatus.ACCEPTED },
        });
      }
      if (pending) {
        await tx.rcCompletion.update({ where: { id: pending.id }, data: { okQty: finalOk } });
      } else {
        await tx.rcCompletion.create({
          data: { slipNo: await this.numbering.next('RC_COMPLETION', { tx }), routeCardId: id, okQty: finalOk },
        });
      }
    } else if (pending) {
      await tx.rcCompletion.delete({ where: { id: pending.id } });
    }
    if (finalOk === 0) {
      // Everything rejected at the last stage: nothing goes to stock; the request needs a new card.
      status = RouteCardStatus.CLOSED;
      if (rc.productionRequestId && rc.status !== RouteCardStatus.CLOSED) {
        await tx.productionRequest.update({ where: { id: rc.productionRequestId }, data: { status: ProductionRequestStatus.REQUESTED } });
      }
      await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'route_card', entityId: id, summary: `${rc.rcNo} closed: no piece passed the last stage` }, tx);
    }

    await tx.routeCard.update({
      where: { id },
      data: {
        status,
        currentStageId: waiting?.stageId ?? null,
        rejectedQty: ops.reduce((s, o) => s + n(o.rejectedQty), 0),
      },
    });
  }

  private async checkStages(tx: Tx, stageIds: number[]) {
    const ids = [...new Set(stageIds)];
    const stages = await tx.processStage.findMany({ where: { id: { in: ids }, isActive: true }, orderBy: { sequence: 'asc' } });
    if (stages.length !== ids.length) throw new BadRequestException({ message: 'A chosen stage is unknown or inactive', errors: { stageIds: 'Check the stages' } });
    if (stages.every((s) => s.isMaterialCheck)) {
      throw new BadRequestException({ message: 'Tick at least one stage that makes or checks pieces (cutting, forging …)', errors: { stageIds: 'No piece stage' } });
    }
    if (stages.at(-1)!.isMaterialCheck) {
      throw new BadRequestException({ message: 'The last stage must count the finished pieces', errors: { stageIds: 'Last stage is a material check' } });
    }
    return stages;
  }

  private async checkRawMaterial(tx: Tx, rawMaterialId: number) {
    const rm = await tx.rawMaterial.findUnique({ where: { id: rawMaterialId } });
    if (!rm || !rm.isActive) throw new BadRequestException({ message: 'Choose an active raw material', errors: { rawMaterialId: 'Inactive or unknown' } });
  }
}

/** Stage roles decide who records a stage; a stage without roles is for the admin only (as the stage master says). */
export function canRecordStage(user: Pick<AuthUser, 'roleId' | 'permissions'>, stage: Pick<Stage, 'roles'>): boolean {
  if (user.permissions.includes(WILDCARD_PERMISSION)) return true;
  if (!user.permissions.includes('route_card_operations.update')) return false;
  return stage.roles.some((r) => r.role.id === user.roleId);
}

function fieldsOf(input: RouteCardFieldsInput) {
  return {
    rcDate: input.rcDate,
    inputWeightKg: input.inputWeightKg,
    expectedDelivery: input.expectedDelivery,
    remarks: input.remarks,
  };
}

export { today, round3, n as num };
