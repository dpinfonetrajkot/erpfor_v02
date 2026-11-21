import { BadRequestException, Injectable } from '@nestjs/common';
import type { ListQuery, MtsRequestInput } from '@bht/shared';
import {
  AuditAction,
  Prisma,
  ProductionRequestStatus,
  ProductionRequestType,
  SalesOrderStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { listArgs, paginated } from '../common/list';
import type { Actor } from '../common/auth-user';

const include = {
  item: { select: { id: true, code: true, name: true } },
  salesOrderLine: {
    select: {
      id: true,
      lineNo: true,
      salesOrder: { select: { id: true, soNo: true, expectedDelivery: true, customer: { select: { name: true } } } },
    },
  },
  routeCards: { where: { status: { not: 'CANCELLED' } }, select: { id: true, rcNo: true, status: true }, orderBy: { id: 'desc' } },
} as const satisfies Prisma.ProductionRequestInclude;

export interface RequestFilters {
  status?: ProductionRequestStatus;
  type?: ProductionRequestType;
  salesOrderId?: number;
}

/** What production is asked to make: shortages of sales orders, or parts for stock. */
@Injectable()
export class ProductionRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(query: ListQuery, filters: RequestFilters) {
    const args = listArgs(
      query,
      {
        searchFields: ['requestNo', 'remarks', 'item.name', 'item.code', 'salesOrderLine.salesOrder.soNo'],
        sortable: ['requestNo', 'requiredBy', 'quantity', 'status', 'createdAt'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.salesOrderId ? { salesOrderLine: { salesOrderId: filters.salesOrderId } } : {}),
      },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.productionRequest.findMany({ ...args, include }),
      this.prisma.productionRequest.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  /** Make-to-stock: parts for the FG store without a customer order. */
  createMts(input: MtsRequestInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.findUniqueOrThrow({ where: { id: input.itemId } });
      if (!item.isActive) throw new BadRequestException(`${item.name} is inactive`);
      const pr = await tx.productionRequest.create({
        data: {
          requestNo: await this.numbering.next('PRODUCTION_REQUEST', { tx }),
          type: ProductionRequestType.MAKE_TO_STOCK,
          itemId: input.itemId,
          quantity: input.quantity,
          requiredBy: input.requiredBy ? new Date(`${input.requiredBy}T00:00:00Z`) : null,
          remarks: input.remarks || null,
          createdById: actor.userId,
        },
        include,
      });
      await this.audit.log(
        actor,
        { action: AuditAction.CREATE, entity: 'production_request', entityId: pr.id, summary: `Make-to-stock ${pr.requestNo}: ${input.quantity} x ${item.name}` },
        tx,
      );
      return pr;
    });
  }

  async cancel(id: number, reason: string, actor: Actor) {
    const pr = await this.prisma.productionRequest.findUniqueOrThrow({ where: { id }, include });
    if (pr.status !== ProductionRequestStatus.REQUESTED) {
      throw new BadRequestException(`${pr.requestNo} is ${pr.status.toLowerCase()} and cannot be cancelled`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productionRequest.update({ where: { id }, data: { status: ProductionRequestStatus.CANCELLED, cancelReason: reason } });
      // Order goes back to "approved" when nothing is left with production.
      const so = pr.salesOrderLine?.salesOrder;
      if (so) {
        const stillActive = await tx.productionRequest.count({
          where: {
            salesOrderLine: { salesOrderId: so.id },
            status: { in: [ProductionRequestStatus.REQUESTED, ProductionRequestStatus.ACCEPTED] },
          },
        });
        const jobWork = await tx.jobWorkOrder.count({ where: { salesOrderId: so.id, status: { not: 'CANCELLED' } } });
        if (!stillActive && !jobWork) {
          await tx.salesOrder.updateMany({
            where: { id: so.id, status: SalesOrderStatus.IN_PRODUCTION },
            data: { status: SalesOrderStatus.APPROVED },
          });
        }
      }
    });
    await this.audit.log(actor, {
      action: AuditAction.STATUS_CHANGE,
      entity: 'production_request',
      entityId: id,
      summary: `Cancelled ${pr.requestNo}: ${reason}`,
    });
  }
}
