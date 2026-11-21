import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  JWO_STATUSES,
  jobWorkOrderSchema,
  jobWorkReceiptSchema,
  listQuerySchema,
  materialIssueSchema,
  materialReturnSchema,
  MR_STATUSES,
  reasonSchema,
  type JobWorkOrderInput,
  type JobWorkReceiptInput,
  type MaterialIssueInput,
  type MaterialReturnInput,
  type ReasonInput,
} from '@bht/shared';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { OrdersService } from '../purchase/orders.service';
import { JobWorkService } from './job-work.service';

const JWO_READERS = ['job_work_orders.view', 'job_work_receipts.view', 'material_issues.view'];

const jwoQuerySchema = listQuerySchema.extend({
  status: z.enum([...JWO_STATUSES, 'RUNNING']).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  salesOrderId: z.coerce.number().int().positive().optional(),
});
const receiptQuerySchema = listQuerySchema.extend({ jobWorkOrderId: z.coerce.number().int().positive().optional() });
const materialQuerySchema = listQuerySchema.extend({ status: z.enum([...MR_STATUSES, 'OPEN']).optional() });
const defaultsSchema = z.object({ salesOrderId: z.coerce.number().int().positive() });

@Controller('job-work-orders')
export class JobWorkOrdersController {
  constructor(
    private readonly jobWork: JobWorkService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  @RequirePermission(...JWO_READERS)
  list(@Query(new ZodValidationPipe(jwoQuerySchema)) query: z.infer<typeof jwoQuerySchema>) {
    return this.jobWork.list(query, query);
  }

  @Get('defaults')
  @RequirePermission('job_work_orders.create')
  defaults(@Query(new ZodValidationPipe(defaultsSchema)) q: z.infer<typeof defaultsSchema>) {
    return this.jobWork.defaults(q.salesOrderId);
  }

  @Get(':id')
  @RequirePermission(...JWO_READERS)
  get(@Param('id', ParseIntPipe) id: number) {
    return this.jobWork.get(id);
  }

  @Get(':id/pdf')
  @RequirePermission(...JWO_READERS)
  async pdf(@Param('id', ParseIntPipe) id: number, @Query('download') download: string | undefined, @Res() res: Response) {
    const { fileName, buffer } = await this.jobWork.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(buffer);
  }

  @Post()
  @RequirePermission('job_work_orders.create')
  create(@Body(new ZodValidationPipe(jobWorkOrderSchema)) body: JobWorkOrderInput, @CurrentActor() actor: Actor) {
    return this.jobWork.create(body, actor);
  }

  @Put(':id')
  @HttpCode(204)
  @RequirePermission('job_work_orders.update')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(jobWorkOrderSchema)) body: JobWorkOrderInput, @CurrentActor() actor: Actor) {
    return this.jobWork.update(id, body, actor);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  @RequirePermission('job_work_orders.update', 'job_work_orders.delete')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    return this.jobWork.cancel(id, body.reason, actor);
  }

  @Post(':id/close')
  @HttpCode(204)
  @RequirePermission('job_work_orders.update')
  close(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    return this.jobWork.close(id, body.reason, actor);
  }

  /** Draft job-work PO (charges) for Accounts to approve and send. */
  @Post(':id/purchase-order')
  @RequirePermission('purchase_orders.create')
  purchaseOrder(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.orders.createForJobWork(id, actor);
  }

  @Post(':id/material-returns')
  @HttpCode(204)
  @RequirePermission('material_issues.issue')
  returnMaterial(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(materialReturnSchema)) body: MaterialReturnInput, @CurrentActor() actor: Actor) {
    return this.jobWork.returnMaterial(id, body, actor);
  }

  @Post(':id/receipts')
  @RequirePermission('job_work_receipts.create')
  receive(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(jobWorkReceiptSchema)) body: JobWorkReceiptInput, @CurrentActor() actor: Actor) {
    return this.jobWork.receive(id, body, actor);
  }
}

@Controller('job-work-receipts')
export class JobWorkReceiptsController {
  constructor(private readonly jobWork: JobWorkService) {}

  @Get()
  @RequirePermission('job_work_receipts.view', 'job_work_orders.view')
  list(@Query(new ZodValidationPipe(receiptQuerySchema)) query: z.infer<typeof receiptQuerySchema>) {
    return this.jobWork.receipts(query, query.jobWorkOrderId);
  }
}

/** Material the store sends to job-work vendors (shown on the Material issue screen). */
@Controller('job-work-materials')
export class JobWorkMaterialsController {
  constructor(private readonly jobWork: JobWorkService) {}

  @Get()
  @RequirePermission('material_issues.view', 'job_work_orders.view')
  list(@Query(new ZodValidationPipe(materialQuerySchema)) query: z.infer<typeof materialQuerySchema>) {
    return this.jobWork.materialList(query, query.status);
  }

  @Get(':id/heats')
  @RequirePermission('material_issues.issue')
  heats(@Param('id', ParseIntPipe) id: number) {
    return this.jobWork.materialHeats(id);
  }

  @Post(':id/issue')
  @HttpCode(204)
  @RequirePermission('material_issues.issue')
  issue(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(materialIssueSchema)) body: MaterialIssueInput, @CurrentActor() actor: Actor) {
    return this.jobWork.issueMaterial(id, body, actor);
  }
}
