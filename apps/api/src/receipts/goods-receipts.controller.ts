import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { goodsReceiptSchema, listQuerySchema, qcSchema, type GoodsReceiptInput, type QcInput } from '@bht/shared';
import { GoodsReceiptStatus } from '../generated/prisma/client';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { GoodsReceiptsService } from './goods-receipts.service';

const grnQuerySchema = listQuerySchema.extend({
  status: z.enum(GoodsReceiptStatus).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  purchaseOrderId: z.coerce.number().int().positive().optional(),
});

/** Gate entry (store) and incoming QC (quality) of material arriving at the factory. */
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(private readonly grns: GoodsReceiptsService) {}

  @Get()
  @RequirePermission('goods_receipts.view', 'incoming_qc.view')
  list(@Query(new ZodValidationPipe(grnQuerySchema)) query: z.infer<typeof grnQuerySchema>) {
    return this.grns.list(query, query);
  }

  @Get('po-options')
  @RequirePermission('goods_receipts.create', 'goods_receipts.update')
  poOptions(@Query('supplierId', ParseIntPipe) supplierId: number) {
    return this.grns.poOptions(supplierId);
  }

  @Get(':id')
  @RequirePermission('goods_receipts.view', 'incoming_qc.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.grns.get(id);
  }

  @Post()
  @RequirePermission('goods_receipts.create')
  create(@Body(new ZodValidationPipe(goodsReceiptSchema)) body: GoodsReceiptInput, @CurrentActor() actor: Actor) {
    return this.grns.create(body, actor);
  }

  @Put(':id')
  @RequirePermission('goods_receipts.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(goodsReceiptSchema)) body: GoodsReceiptInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.grns.update(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('goods_receipts.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.grns.remove(id, actor);
  }

  @Post(':id/qc')
  @RequirePermission('incoming_qc.update')
  qc(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(qcSchema)) body: QcInput, @CurrentActor() actor: Actor) {
    return this.grns.qc(id, body, actor);
  }
}
