import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  emailDocumentSchema,
  listQuerySchema,
  PO_STATUSES,
  PR_STATUSES,
  purchaseOrderSchema,
  purchaseRequisitionSchema,
  reasonSchema,
  type EmailDocumentInput,
  type PurchaseOrderInput,
  type PurchaseRequisitionInput,
  type ReasonInput,
} from '@bht/shared';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { OrdersService } from './orders.service';
import { RequisitionsService } from './requisitions.service';

const prQuerySchema = listQuerySchema.extend({
  status: z.enum(PR_STATUSES).optional(),
  rawMaterialId: z.coerce.number().int().positive().optional(),
});
const reorderSchema = z.object({
  items: z
    .array(z.object({ rawMaterialId: z.coerce.number().int().positive(), quantity: z.coerce.number().positive() }))
    .min(1, 'Choose at least one material'),
});
const poQuerySchema = listQuerySchema.extend({
  status: z.enum([...PO_STATUSES, 'OPEN']).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  type: z.enum(['MATERIAL', 'JOB_WORK']).optional(),
});

@Controller('purchase-requisitions')
export class PurchaseRequisitionsController {
  constructor(private readonly prs: RequisitionsService) {}

  @Get()
  @RequirePermission('purchase_requisitions.view', 'purchase_orders.create')
  list(@Query(new ZodValidationPipe(prQuerySchema)) query: z.infer<typeof prQuerySchema>) {
    return this.prs.list(query, query);
  }

  @Get('reorder-suggestions')
  @RequirePermission('purchase_requisitions.create')
  reorderSuggestions() {
    return this.prs.reorderSuggestions();
  }

  @Post('from-reorder')
  @RequirePermission('purchase_requisitions.create')
  fromReorder(@Body(new ZodValidationPipe(reorderSchema)) body: z.infer<typeof reorderSchema>, @CurrentActor() actor: Actor) {
    return this.prs.createFromReorder(body.items, actor);
  }

  @Get(':id')
  @RequirePermission('purchase_requisitions.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.prs.get(id);
  }

  @Post()
  @RequirePermission('purchase_requisitions.create')
  create(@Body(new ZodValidationPipe(purchaseRequisitionSchema)) body: PurchaseRequisitionInput, @CurrentActor() actor: Actor) {
    return this.prs.create(body, actor);
  }

  @Put(':id')
  @RequirePermission('purchase_requisitions.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(purchaseRequisitionSchema)) body: PurchaseRequisitionInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.prs.update(id, body, actor);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  @RequirePermission('purchase_requisitions.update')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    return this.prs.cancel(id, body.reason, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('purchase_requisitions.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.prs.remove(id, actor);
  }
}

@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermission('purchase_orders.view')
  list(@Query(new ZodValidationPipe(poQuerySchema)) query: z.infer<typeof poQuerySchema>) {
    return this.orders.list(query, query);
  }

  @Get('defaults')
  @RequirePermission('purchase_orders.create', 'purchase_orders.update')
  defaults() {
    return this.orders.defaults();
  }

  @Get(':id')
  @RequirePermission('purchase_orders.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.orders.get(id);
  }

  @Get(':id/pdf')
  @RequirePermission('purchase_orders.view')
  async pdf(@Param('id', ParseIntPipe) id: number, @Query('download') download: string | undefined, @Res() res: Response) {
    const { fileName, buffer } = await this.orders.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(buffer);
  }

  @Post()
  @RequirePermission('purchase_orders.create')
  create(@Body(new ZodValidationPipe(purchaseOrderSchema)) body: PurchaseOrderInput, @CurrentActor() actor: Actor) {
    return this.orders.create(body, actor);
  }

  @Put(':id')
  @RequirePermission('purchase_orders.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(purchaseOrderSchema)) body: PurchaseOrderInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.orders.update(id, body, actor);
  }

  @Post(':id/approve')
  @RequirePermission('purchase_orders.approve')
  approve(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.orders.approve(id, actor);
  }

  @Post(':id/cancel')
  @RequirePermission('purchase_orders.update')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    return this.orders.cancel(id, body.reason, actor);
  }

  @Post(':id/close')
  @RequirePermission('purchase_orders.update')
  close(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    return this.orders.close(id, body.reason, actor);
  }

  @Post(':id/email')
  @RequirePermission('purchase_orders.update')
  email(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(emailDocumentSchema)) body: EmailDocumentInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.orders.email(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('purchase_orders.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.orders.remove(id, actor);
  }
}
