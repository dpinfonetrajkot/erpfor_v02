import { BadRequestException, Injectable } from '@nestjs/common';
import type { CompletionMoveInput, ListQuery } from '@bht/shared';
import {
  AuditAction,
  CompletionStatus,
  Prisma,
  ProductionRequestStatus,
  RouteCardStatus,
  StockKind,
  StockLocation,
  StockRefType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { StockService } from '../core/stock.service';
import { listArgs, paginated } from '../common/list';
import type { Actor } from '../common/auth-user';
import { issuedByHeat, num } from './route-cards.service';

const include = {
  routeCard: {
    select: {
      id: true,
      rcNo: true,
      plannedQty: true,
      extraQty: true,
      item: { select: { id: true, code: true, name: true } },
      productionRequest: { select: { requestNo: true, type: true } },
      salesOrderLine: { select: { salesOrder: { select: { id: true, soNo: true, customer: { select: { name: true } } } } } },
      materialIssues: { select: { heatId: true, quantity: true, heat: { select: { id: true, heatNo: true, millHeatNo: true } } } },
    },
  },
  heats: { include: { heat: { select: { id: true, heatNo: true } } } },
  movedBy: { select: { id: true, name: true } },
} as const satisfies Prisma.RcCompletionInclude;

/** Final OK pieces of a route card, waiting for the store to put them in the FG store. */
@Injectable()
export class CompletionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async list(query: ListQuery, filters: { status?: CompletionStatus }) {
    const args = listArgs(
      query,
      {
        searchFields: ['slipNo', 'routeCard.rcNo', 'routeCard.item.name', 'routeCard.item.code'],
        sortable: ['slipNo', 'okQty', 'status', 'createdAt'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      filters.status ? { status: filters.status } : {},
    );
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.rcCompletion.findMany({ ...args, include }),
      this.prisma.rcCompletion.count({ where: args.where }),
    ]);
    // Heats the pieces can come from = heats issued to the card (minus returns).
    const data = rows.map(({ routeCard: { materialIssues, ...rc }, ...c }) => ({
      ...c,
      routeCard: rc,
      issuedHeats: issuedByHeat(materialIssues).filter((h) => h.quantity > 0),
    }));
    return paginated(data, total, query);
  }

  async move(id: number, input: CompletionMoveInput, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.rcCompletion.findUniqueOrThrow({ where: { id }, include });
      if (c.status !== CompletionStatus.PENDING) throw new BadRequestException(`${c.slipNo} is already in FG stock`);
      const lines = input.heats.filter((h) => h.quantity > 0);
      const total = lines.reduce((s, h) => s + h.quantity, 0);
      if (total !== num(c.okQty)) {
        throw new BadRequestException({ message: `The heats must add up to the ${num(c.okQty)} OK pieces (now ${total})`, errors: { heats: 'Total does not match' } });
      }
      if (new Set(lines.map((l) => l.heatId)).size !== lines.length) throw new BadRequestException('Each heat only once, please');
      const issued = issuedByHeat(c.routeCard.materialIssues);
      for (const line of lines) {
        if (!issued.some((h) => h.heatId === line.heatId)) throw new BadRequestException('Pieces can only come from heats issued to this route card');
      }
      for (const line of lines) {
        await this.stock.post(tx, {
          kind: StockKind.FINISHED_GOOD,
          itemId: c.routeCard.item.id,
          heatId: line.heatId,
          location: StockLocation.FG_STORE,
          quantity: line.quantity,
          refType: StockRefType.RC_COMPLETION,
          refId: c.id,
          refNo: c.slipNo,
          remarks: `Made on ${c.routeCard.rcNo}`,
          userId: actor.userId,
        });
      }
      await tx.rcCompletion.update({
        where: { id },
        data: {
          status: CompletionStatus.MOVED_TO_STOCK,
          movedAt: new Date(),
          movedById: actor.userId,
          heats: { create: lines.map((l) => ({ heatId: l.heatId, quantity: l.quantity })) },
        },
      });
      const rc = await tx.routeCard.update({
        where: { id: c.routeCardId },
        data: { completedQty: { increment: total }, status: RouteCardStatus.CLOSED, currentStageId: null },
      });
      if (rc.productionRequestId) {
        await tx.productionRequest.update({ where: { id: rc.productionRequestId }, data: { status: ProductionRequestStatus.COMPLETED } });
      }
      const heatList = lines.map((l) => `${issued.find((h) => h.heatId === l.heatId)!.heatNo}: ${l.quantity}`).join(', ');
      await this.audit.log(
        actor,
        {
          action: AuditAction.STATUS_CHANGE,
          entity: 'route_card',
          entityId: c.routeCardId,
          summary: `${c.slipNo}: ${total} x ${c.routeCard.item.name} into FG store from ${c.routeCard.rcNo} (${heatList})`,
        },
        tx,
      );
    });
  }
}
