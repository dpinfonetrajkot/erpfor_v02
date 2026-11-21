import { BadRequestException, Injectable } from '@nestjs/common';
import type { ListQuery, MaterialIssueInput, MaterialRequestInput, MaterialReturnInput, MrPurchaseInput } from '@bht/shared';
import {
  AuditAction,
  HeatStatus,
  Prisma,
  PurchaseRequisitionSource,
  RequisitionStatus,
  RouteCardStatus,
  StockKind,
  StockLocation,
  StockRefType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { NotificationsService } from '../core/notifications.service';
import { StockService } from '../core/stock.service';
import { listArgs, paginated } from '../common/list';
import type { Actor } from '../common/auth-user';
import { issuedByHeat, num, round3, today } from './route-cards.service';

const mrInclude = {
  routeCard: {
    select: {
      id: true,
      rcNo: true,
      status: true,
      plannedQty: true,
      extraQty: true,
      item: { select: { id: true, code: true, name: true } },
    },
  },
  rawMaterial: { select: { id: true, code: true, size: true, uom: true, grade: { select: { name: true } } } },
  createdBy: { select: { id: true, name: true } },
  issues: { orderBy: { id: 'asc' }, include: { heat: { select: { id: true, heatNo: true } }, issuedBy: { select: { name: true } } } },
  purchaseRequisitions: { select: { id: true, prNo: true, quantity: true, status: true } },
} as const satisfies Prisma.MaterialRequisitionInclude;

const OPEN: RequisitionStatus[] = [RequisitionStatus.PENDING, RequisitionStatus.PARTIAL];

/** Heats of a raw material with stock in the RM store, oldest received first. */
export async function heatsInStore(prisma: PrismaService, rawMaterialId: number) {
  const balances = await prisma.stockBalance.findMany({
    where: { kind: StockKind.RAW_MATERIAL, location: StockLocation.RM_STORE, rawMaterialId, quantity: { gt: 0 }, heatId: { not: null } },
    include: { heat: { select: { id: true, heatNo: true, millHeatNo: true, receivedDate: true, status: true, supplier: { select: { name: true } } } } },
    orderBy: [{ heat: { receivedDate: 'asc' } }, { heatId: 'asc' }],
  });
  return balances.map((b) => ({ ...b.heat!, quantity: num(b.quantity) }));
}

/** Production asks the store for bar stock; the store issues it heat by heat. */
@Injectable()
export class MaterialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListQuery, filters: { status?: RequisitionStatus | 'OPEN'; routeCardId?: number }) {
    const args = listArgs(
      query,
      {
        searchFields: ['mrNo', 'routeCard.rcNo', 'routeCard.item.name', 'rawMaterial.size', 'rawMaterial.grade.name'],
        sortable: ['mrNo', 'mrDate', 'requestedQty', 'status'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      {
        ...(filters.status === 'OPEN' ? { status: { in: OPEN } } : filters.status ? { status: filters.status } : {}),
        ...(filters.routeCardId ? { routeCardId: filters.routeCardId } : {}),
      },
    );
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.materialRequisition.findMany({ ...args, include: mrInclude }),
      this.prisma.materialRequisition.count({ where: args.where }),
    ]);
    // Store sees at once whether the request can be filled.
    const inStore = await this.prisma.stockBalance.groupBy({
      by: ['rawMaterialId'],
      where: { kind: StockKind.RAW_MATERIAL, location: StockLocation.RM_STORE, rawMaterialId: { in: [...new Set(rows.map((r) => r.rawMaterialId))] } },
      _sum: { quantity: true },
    });
    const stockOf = new Map(inStore.map((s) => [s.rawMaterialId, num(s._sum.quantity)]));
    const data = rows.map((r) => ({ ...r, inStoreKg: stockOf.get(r.rawMaterialId) ?? 0 }));
    return paginated(data, total, query);
  }

  /** Heats of the requested material in the RM store, oldest first (issue those first). */
  async heats(id: number) {
    const mr = await this.prisma.materialRequisition.findUniqueOrThrow({ where: { id }, include: mrInclude });
    return { request: mr, heats: await heatsInStore(this.prisma, mr.rawMaterialId) };
  }

  async request(routeCardId: number, input: MaterialRequestInput, actor: Actor) {
    const created = await this.prisma.$transaction(async (tx) => {
      const rc = await tx.routeCard.findUniqueOrThrow({ where: { id: routeCardId }, include: { rawMaterial: { include: { grade: true } } } });
      if (rc.status === RouteCardStatus.CANCELLED || rc.status === RouteCardStatus.CLOSED) {
        throw new BadRequestException(`${rc.rcNo} is ${rc.status.toLowerCase()}`);
      }
      if (!rc.rawMaterialId || !rc.rawMaterial) throw new BadRequestException(`Set the raw material on ${rc.rcNo} first`);
      const mr = await tx.materialRequisition.create({
        data: {
          mrNo: await this.numbering.next('MATERIAL_REQUISITION', { tx }),
          mrDate: today(),
          routeCardId,
          rawMaterialId: rc.rawMaterialId,
          requestedQty: input.quantity,
          remarks: input.remarks || null,
          createdById: actor.userId,
        },
      });
      await this.audit.log(
        actor,
        {
          action: AuditAction.CREATE,
          entity: 'material_requisition',
          entityId: mr.id,
          summary: `${mr.mrNo} for ${rc.rcNo}: ${input.quantity} kg ${rc.rawMaterial.grade.name} ${rc.rawMaterial.size}`,
        },
        tx,
      );
      return { id: mr.id, mrNo: mr.mrNo, text: `${input.quantity} kg ${rc.rawMaterial.grade.name} ${rc.rawMaterial.size} for ${rc.rcNo}` };
    });
    await this.notifications.toPermission('material_issues.issue', { title: `${created.mrNo}: material to issue`, body: created.text, link: '/store/material-issue' }, actor.userId);
    return { id: created.id, mrNo: created.mrNo };
  }

  async cancel(id: number, actor: Actor) {
    const mr = await this.prisma.materialRequisition.findUniqueOrThrow({ where: { id } });
    if (!OPEN.includes(mr.status)) throw new BadRequestException(`${mr.mrNo} is ${mr.status.toLowerCase()}`);
    await this.prisma.materialRequisition.update({ where: { id }, data: { status: RequisitionStatus.CANCELLED } });
    await this.audit.log(actor, {
      action: AuditAction.STATUS_CHANGE,
      entity: 'material_requisition',
      entityId: id,
      summary: num(mr.issuedQty) ? `Closed ${mr.mrNo} after ${num(mr.issuedQty)} kg issued` : `Cancelled ${mr.mrNo}`,
    });
  }

  async issue(id: number, input: MaterialIssueInput, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const mr = await tx.materialRequisition.findUniqueOrThrow({ where: { id }, include: { routeCard: true } });
      if (!OPEN.includes(mr.status)) throw new BadRequestException(`${mr.mrNo} is ${mr.status.toLowerCase()}`);
      if (mr.routeCard.status === RouteCardStatus.CANCELLED) throw new BadRequestException(`${mr.routeCard.rcNo} is cancelled`);
      const heatIds = input.lines.map((l) => l.heatId);
      if (new Set(heatIds).size !== heatIds.length) throw new BadRequestException('Each heat only once, please');
      const total = round3(input.lines.reduce((s, l) => s + l.quantity, 0));
      const remaining = round3(num(mr.requestedQty) - num(mr.issuedQty));
      if (total > remaining + 0.0005) {
        throw new BadRequestException(`Only ${remaining} kg is still requested on ${mr.mrNo}; you entered ${total} kg`);
      }
      const heats = await tx.heat.findMany({ where: { id: { in: heatIds } } });
      const date = new Date(`${input.issueDate}T00:00:00Z`);
      for (const line of input.lines) {
        const heat = heats.find((h) => h.id === line.heatId);
        if (!heat || heat.rawMaterialId !== mr.rawMaterialId) throw new BadRequestException('A chosen heat is of a different material');
        if (heat.status === HeatStatus.BLOCKED) throw new BadRequestException(`Heat ${heat.heatNo} is blocked and cannot be issued`);
        // Fails with "Not enough stock" when the heat does not have it.
        await this.stock.post(tx, {
          kind: StockKind.RAW_MATERIAL,
          rawMaterialId: mr.rawMaterialId,
          heatId: heat.id,
          location: StockLocation.RM_STORE,
          quantity: -line.quantity,
          refType: StockRefType.MATERIAL_ISSUE,
          refId: mr.id,
          refNo: mr.mrNo,
          date,
          remarks: `Issued to ${mr.routeCard.rcNo}${input.remarks ? ` - ${input.remarks}` : ''}`,
          userId: actor.userId,
        });
        await tx.materialIssue.create({
          data: {
            issueDate: date,
            materialRequisitionId: mr.id,
            routeCardId: mr.routeCardId,
            rawMaterialId: mr.rawMaterialId,
            heatId: heat.id,
            quantity: line.quantity,
            remarks: input.remarks || null,
            issuedById: actor.userId,
          },
        });
      }
      const issued = round3(num(mr.issuedQty) + total);
      await tx.materialRequisition.update({
        where: { id },
        data: { issuedQty: issued, status: issued + 0.0005 >= num(mr.requestedQty) ? RequisitionStatus.ISSUED : RequisitionStatus.PARTIAL },
      });
      const heatList = input.lines.map((l) => `${heats.find((h) => h.id === l.heatId)!.heatNo}: ${l.quantity} kg`).join(', ');
      await this.audit.log(
        actor,
        { action: AuditAction.UPDATE, entity: 'material_requisition', entityId: id, summary: `Issued ${total} kg for ${mr.mrNo} / ${mr.routeCard.rcNo} (${heatList})` },
        tx,
      );
    });
  }

  /** Unused bar back to the RM store, from the heat it was issued from. */
  async returnToStore(routeCardId: number, input: MaterialReturnInput, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const rc = await tx.routeCard.findUniqueOrThrow({
        where: { id: routeCardId },
        include: { materialIssues: { include: { heat: { select: { id: true, heatNo: true, millHeatNo: true } } } } },
      });
      const onCard = issuedByHeat(rc.materialIssues).find((h) => h.heatId === input.heatId);
      if (!onCard || onCard.quantity <= 0) throw new BadRequestException('This heat was not issued to the route card');
      if (input.quantity > onCard.quantity + 0.0005) {
        throw new BadRequestException({ message: `Only ${onCard.quantity} kg of heat ${onCard.heatNo} is on ${rc.rcNo}`, errors: { quantity: `Max ${onCard.quantity}` } });
      }
      await this.stock.post(tx, {
        kind: StockKind.RAW_MATERIAL,
        rawMaterialId: rc.rawMaterialId,
        heatId: input.heatId,
        location: StockLocation.RM_STORE,
        quantity: input.quantity,
        refType: StockRefType.ISSUE_RETURN,
        refId: rc.id,
        refNo: rc.rcNo,
        remarks: `Returned from ${rc.rcNo}${input.remarks ? ` - ${input.remarks}` : ''}`,
        userId: actor.userId,
      });
      await tx.materialIssue.create({
        data: {
          issueDate: today(),
          routeCardId: rc.id,
          rawMaterialId: rc.rawMaterialId!,
          heatId: input.heatId,
          quantity: -input.quantity,
          remarks: `Returned to store${input.remarks ? `: ${input.remarks}` : ''}`,
          issuedById: actor.userId,
        },
      });
      await this.audit.log(
        actor,
        { action: AuditAction.UPDATE, entity: 'route_card', entityId: rc.id, summary: `${input.quantity} kg of heat ${onCard.heatNo} returned to store from ${rc.rcNo}` },
        tx,
      );
    });
  }

  /** Store cannot fill the request: raise a purchase requisition for the shortage. */
  async askPurchase(id: number, input: MrPurchaseInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const mr = await tx.materialRequisition.findUniqueOrThrow({ where: { id }, include: { routeCard: true, rawMaterial: { include: { grade: true } } } });
      if (!OPEN.includes(mr.status)) throw new BadRequestException(`${mr.mrNo} is ${mr.status.toLowerCase()}`);
      const prDate = today();
      const pr = await tx.purchaseRequisition.create({
        data: {
          prNo: await this.numbering.next('PURCHASE_REQUISITION', { tx, date: prDate }),
          prDate,
          rawMaterialId: mr.rawMaterialId,
          quantity: input.quantity,
          requiredBy: input.requiredBy ? new Date(`${input.requiredBy}T00:00:00Z`) : null,
          source: PurchaseRequisitionSource.MATERIAL_REQUISITION,
          materialRequisitionId: mr.id,
          remarks: `For ${mr.mrNo} / ${mr.routeCard.rcNo}`,
          createdById: actor.userId,
        },
      });
      await this.audit.log(
        actor,
        {
          action: AuditAction.CREATE,
          entity: 'purchase_requisition',
          entityId: pr.id,
          summary: `Raised ${pr.prNo} for ${mr.mrNo}: ${input.quantity} kg ${mr.rawMaterial.grade.name} ${mr.rawMaterial.size}`,
        },
        tx,
      );
      return { id: pr.id, prNo: pr.prNo };
    });
  }
}
