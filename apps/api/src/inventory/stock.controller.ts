import { BadRequestException, Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { listQuerySchema, STOCK_LOCATIONS, STOCK_REF_TYPES, stockAdjustmentSchema, type StockAdjustmentInput } from '@bht/shared';
import { AuditAction, Prisma, StockKind, StockLocation, StockRefType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { StockService } from '../core/stock.service';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { listArgs, paginated } from '../common/list';
import { csv } from '../common/csv';
import type { Actor } from '../common/auth-user';

const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

const balanceQuerySchema = listQuerySchema.extend({
  location: z.enum(STOCK_LOCATIONS).optional(),
  gradeId: z.coerce.number().int().positive().optional(),
  rawMaterialId: z.coerce.number().int().positive().optional(),
  productId: z.coerce.number().int().positive().optional(),
  itemId: z.coerce.number().int().positive().optional(),
  includeZero: z.enum(['true', 'false']).optional(),
});
type BalanceQuery = z.infer<typeof balanceQuerySchema>;

const ledgerQuerySchema = listQuerySchema.extend({
  kind: z.enum(StockKind).optional(),
  rawMaterialId: z.coerce.number().int().positive().optional(),
  itemId: z.coerce.number().int().positive().optional(),
  heatId: z.coerce.number().int().positive().optional(),
  refType: z.enum(STOCK_REF_TYPES).optional(),
  from: dateParam,
  to: dateParam,
});
type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

const balanceInclude = {
  rawMaterial: { select: { id: true, code: true, size: true, uom: true, grade: { select: { id: true, name: true } } } },
  item: { select: { id: true, code: true, name: true, uom: true } },
  heat: { select: { id: true, heatNo: true, millHeatNo: true, receivedDate: true, status: true, supplier: { select: { name: true } } } },
} as const;

const ledgerInclude = {
  rawMaterial: { select: { code: true, size: true, grade: { select: { name: true } } } },
  item: { select: { code: true, name: true } },
  heat: { select: { id: true, heatNo: true } },
} as const;

@Controller('stock')
export class StockController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  /** Raw material in stock, one row per material + heat + location. */
  @Get('raw-materials')
  @RequirePermission('stock.view', 'material_issues.issue')
  rawMaterials(@Query(new ZodValidationPipe(balanceQuerySchema)) q: BalanceQuery) {
    return this.balances(StockKind.RAW_MATERIAL, q, {
      ...(q.rawMaterialId ? { rawMaterialId: q.rawMaterialId } : {}),
      ...(q.gradeId ? { rawMaterial: { gradeId: q.gradeId } } : {}),
    }, ['heat.heatNo', 'heat.millHeatNo', 'rawMaterial.code', 'rawMaterial.size', 'rawMaterial.grade.name'], 'heat.receivedDate');
  }

  /** Finished parts in stock, one row per item + heat + location. */
  @Get('finished-goods')
  @RequirePermission('stock.view')
  finishedGoods(@Query(new ZodValidationPipe(balanceQuerySchema)) q: BalanceQuery) {
    return this.balances(StockKind.FINISHED_GOOD, q, {
      ...(q.itemId ? { itemId: q.itemId } : {}),
      ...(q.productId ? { item: { productId: q.productId } } : {}),
    }, ['item.code', 'item.name', 'heat.heatNo'], 'item.name');
  }

  @Get('ledger')
  @RequirePermission('stock.view')
  async ledger(@Query(new ZodValidationPipe(ledgerQuerySchema)) q: LedgerQuery) {
    const where = ledgerWhere(q);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.stockLedger.findMany({
        where,
        include: ledgerInclude,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.stockLedger.count({ where }),
    ]);
    return paginated(data, total, q);
  }

  /** Same filters as the ledger, as a CSV file for Excel. */
  @Get('ledger/export')
  @RequirePermission('stock.export')
  async exportLedger(@Query(new ZodValidationPipe(ledgerQuerySchema)) q: LedgerQuery, @Res() res: Response) {
    const rows = await this.prisma.stockLedger.findMany({
      where: ledgerWhere(q),
      include: ledgerInclude,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: 50_000,
    });
    const users = new Map(
      (await this.prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]),
    );
    const header = ['Date', 'Type', 'Ref no', 'Stock', 'Code', 'Material / item', 'Heat', 'Location', 'In', 'Out', 'Remarks', 'By'];
    const lines = rows.map((r) =>
      [
        r.date.toISOString().slice(0, 10),
        r.refType,
        r.refNo ?? '',
        r.kind === 'RAW_MATERIAL' ? 'RM' : 'FG',
        r.rawMaterial?.code ?? r.item?.code ?? '',
        r.rawMaterial ? `${r.rawMaterial.grade.name} ${r.rawMaterial.size}` : (r.item?.name ?? ''),
        r.heat?.heatNo ?? '',
        r.location,
        r.qtyIn.toString(),
        r.qtyOut.toString(),
        r.remarks ?? '',
        r.createdById ? (users.get(r.createdById) ?? '') : '',
      ]
        .map(csv)
        .join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="stock-ledger-${new Date().toISOString().slice(0, 10)}.csv"`);
    // BOM so Excel opens UTF-8 correctly
    res.end(`﻿${[header.join(','), ...lines].join('\r\n')}`);
  }

  /** Correct stock (count difference, damage, wrong entry). Always needs a reason. */
  @Post('adjustments')
  @RequirePermission('stock.create')
  async adjust(@Body(new ZodValidationPipe(stockAdjustmentSchema)) body: StockAdjustmentInput, @CurrentActor() actor: Actor) {
    const isRm = body.kind === 'RAW_MATERIAL';
    if (body.heatId) {
      const heat = await this.prisma.heat.findUniqueOrThrow({ where: { id: body.heatId } });
      if (isRm && heat.rawMaterialId !== body.rawMaterialId) throw new BadRequestException('This heat is of a different raw material');
    }
    const subject = isRm
      ? await this.prisma.rawMaterial.findUniqueOrThrow({ where: { id: body.rawMaterialId! }, include: { grade: true } })
      : await this.prisma.item.findUniqueOrThrow({ where: { id: body.itemId! } });
    const name = 'grade' in subject ? `${subject.grade.name} ${subject.size}` : subject.name;

    await this.prisma.$transaction(async (tx) => {
      await this.stock.post(tx, {
        kind: body.kind as StockKind,
        rawMaterialId: isRm ? body.rawMaterialId : null,
        itemId: isRm ? null : body.itemId,
        heatId: body.heatId ?? null,
        location: body.location as StockLocation,
        quantity: body.quantity,
        refType: StockRefType.ADJUSTMENT,
        refNo: 'ADJ',
        remarks: body.reason,
        userId: actor.userId,
      });
      await this.audit.log(
        actor,
        {
          action: AuditAction.UPDATE,
          entity: 'stock',
          summary: `Stock adjustment ${body.quantity > 0 ? '+' : ''}${body.quantity} of ${name}: ${body.reason}`,
          changes: body,
        },
        tx,
      );
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ helpers

  private async balances(
    kind: StockKind,
    q: BalanceQuery,
    filter: Prisma.StockBalanceWhereInput,
    searchFields: string[],
    defaultSortField: string,
  ) {
    const args = listArgs(
      q,
      {
        searchFields,
        sortable: ['quantity', 'heat.heatNo', 'heat.receivedDate', 'rawMaterial.code', 'item.name', 'item.code'],
        defaultSort: { field: defaultSortField, dir: 'asc' },
      },
      {
        kind,
        ...(q.location ? { location: q.location } : {}),
        ...(q.includeZero === 'true' ? {} : { quantity: { not: 0 } }),
        ...filter,
      },
    );
    const [data, total, sum] = await this.prisma.$transaction([
      this.prisma.stockBalance.findMany({ ...args, include: balanceInclude }),
      this.prisma.stockBalance.count({ where: args.where }),
      this.prisma.stockBalance.aggregate({ where: args.where, _sum: { quantity: true } }),
    ]);
    return { ...paginated(data, total, q), totalQuantity: sum._sum.quantity?.toNumber() ?? 0 };
  }
}

function ledgerWhere(q: LedgerQuery): Prisma.StockLedgerWhereInput {
  return {
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.rawMaterialId ? { rawMaterialId: q.rawMaterialId } : {}),
    ...(q.itemId ? { itemId: q.itemId } : {}),
    ...(q.heatId ? { heatId: q.heatId } : {}),
    ...(q.refType ? { refType: q.refType } : {}),
    ...(q.from || q.to
      ? { date: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T00:00:00Z`) } : {}) } }
      : {}),
    ...(q.search
      ? {
          OR: [
            { refNo: { contains: q.search } },
            { remarks: { contains: q.search } },
            { heat: { heatNo: { contains: q.search } } },
            { rawMaterial: { size: { contains: q.search } } },
            { item: { name: { contains: q.search } } },
          ],
        }
      : {}),
  };
}
