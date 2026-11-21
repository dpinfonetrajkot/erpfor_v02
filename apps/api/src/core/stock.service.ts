import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StockKind, StockLocation, StockRefType } from '../generated/prisma/client';
import type { Tx } from '../prisma/prisma.service';

export interface StockMovement {
  kind: StockKind;
  rawMaterialId?: number | null;
  itemId?: number | null;
  heatId?: number | null;
  location: StockLocation;
  /** Positive = stock in, negative = stock out. */
  quantity: number;
  refType: StockRefType;
  refId?: number | null;
  refNo?: string | null;
  date?: Date;
  remarks?: string | null;
  userId?: number | null;
}

/**
 * The only place where stock changes. Every movement is written to stock_ledger
 * and the matching stock_balances row is updated in the same transaction.
 * Stock can never go below zero.
 */
@Injectable()
export class StockService {
  async post(tx: Tx, m: StockMovement): Promise<void> {
    if (m.quantity === 0) return;
    const isRm = m.kind === StockKind.RAW_MATERIAL;
    const subjectId = isRm ? m.rawMaterialId : m.itemId;
    if (!subjectId) {
      throw new BadRequestException(isRm ? 'Raw material is required' : 'Item is required');
    }

    const qty = new Prisma.Decimal(m.quantity);
    const balanceKey = `${isRm ? 'RM' : 'FG'}:${subjectId}:${m.heatId ?? 0}:${m.location}`;

    await tx.stockLedger.create({
      data: {
        date: m.date ?? new Date(),
        kind: m.kind,
        rawMaterialId: isRm ? subjectId : null,
        itemId: isRm ? null : subjectId,
        heatId: m.heatId ?? null,
        location: m.location,
        qtyIn: qty.isPositive() ? qty : 0,
        qtyOut: qty.isNegative() ? qty.abs() : 0,
        refType: m.refType,
        refId: m.refId ?? null,
        refNo: m.refNo ?? null,
        remarks: m.remarks ?? null,
        createdById: m.userId ?? null,
      },
    });

    if (qty.isPositive()) {
      await tx.stockBalance.upsert({
        where: { balanceKey },
        create: {
          balanceKey,
          kind: m.kind,
          rawMaterialId: isRm ? subjectId : null,
          itemId: isRm ? null : subjectId,
          heatId: m.heatId ?? null,
          location: m.location,
          quantity: qty,
        },
        update: { quantity: { increment: qty } },
      });
      return;
    }

    // Stock out: only succeeds when enough quantity is available (checked by MySQL, race-free).
    const out = qty.abs();
    const updated = await tx.stockBalance.updateMany({
      where: { balanceKey, quantity: { gte: out } },
      data: { quantity: { decrement: out } },
    });
    if (updated.count === 0) {
      const current = await tx.stockBalance.findUnique({ where: { balanceKey } });
      throw new BadRequestException(
        `Not enough stock: available ${current?.quantity.toString() ?? '0'}, required ${out.toString()}`,
      );
    }
  }
}
