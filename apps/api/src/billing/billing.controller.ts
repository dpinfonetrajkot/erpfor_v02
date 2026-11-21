import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  ASSEMBLY_STATUSES,
  assemblySchema,
  directInvoiceSchema,
  dispatchSchema,
  emailDocumentSchema,
  GST_TYPES,
  INVOICE_STATUSES,
  invoiceSchema,
  listQuerySchema,
  PAYMENT_STATUSES,
  paymentSchema,
  reasonSchema,
  type AssemblyInput,
  type DirectInvoiceInput,
  type DispatchInput,
  type EmailDocumentInput,
  type InvoiceInput,
  type PaymentInput,
  type ReasonInput,
} from '@bht/shared';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { AssembliesService, orderProgress } from './assemblies.service';
import { DispatchesService } from './dispatches.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';

const BILLING_READERS = ['assemblies.view', 'invoices.view', 'dispatches.view', 'payments.view'];
const soIdSchema = z.object({ salesOrderId: z.coerce.number().int().positive() });
const assemblyQuerySchema = listQuerySchema.extend({
  status: z.enum(ASSEMBLY_STATUSES).optional(),
  salesOrderId: z.coerce.number().int().positive().optional(),
});
const invoiceQuerySchema = listQuerySchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  salesOrderId: z.coerce.number().int().positive().optional(),
  paymentStatus: z.enum([...PAYMENT_STATUSES, 'DUE']).optional(),
});
const partyDefaultsQuerySchema = z.object({
  customerId: z.coerce.number().int().positive(),
  companyId: z.coerce.number().int().positive().optional(),
});
const nextNumberQuerySchema = z.object({
  companyId: z.coerce.number().int().positive(),
  gstType: z.enum(GST_TYPES).default('INTRA_STATE'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const dispatchQuerySchema = listQuerySchema.extend({ salesOrderId: z.coerce.number().int().positive().optional() });
const paymentQuerySchema = listQuerySchema.extend({
  direction: z.enum(['RECEIPT', 'PAYMENT']).optional(),
  invoiceId: z.coerce.number().int().positive().optional(),
  purchaseOrderId: z.coerce.number().int().positive().optional(),
});
const directionSchema = z.object({ direction: z.enum(['RECEIPT', 'PAYMENT']) });

function sendPdf(res: Response, file: { fileName: string; buffer: Buffer }, download?: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${file.fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(file.buffer);
}

@Controller('assemblies')
export class AssembliesController {
  constructor(
    private readonly assemblies: AssembliesService,
    private readonly invoices: InvoicesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermission(...BILLING_READERS)
  list(@Query(new ZodValidationPipe(assemblyQuerySchema)) query: z.infer<typeof assemblyQuerySchema>) {
    return this.assemblies.list(query, query);
  }

  /** Packed / invoiced / dispatched sets per order line, for the sales order screen. */
  @Get('progress')
  @RequirePermission('sales_orders.view', ...BILLING_READERS)
  progress(@Query(new ZodValidationPipe(soIdSchema)) q: z.infer<typeof soIdSchema>) {
    return orderProgress(this.prisma, q.salesOrderId);
  }

  @Get('plan')
  @RequirePermission('assemblies.create')
  plan(@Query(new ZodValidationPipe(soIdSchema)) q: z.infer<typeof soIdSchema>) {
    return this.assemblies.plan(q.salesOrderId);
  }

  @Get(':id')
  @RequirePermission(...BILLING_READERS)
  get(@Param('id', ParseIntPipe) id: number) {
    return this.assemblies.get(id);
  }

  @Post()
  @RequirePermission('assemblies.create')
  create(@Body(new ZodValidationPipe(assemblySchema)) body: AssemblyInput, @CurrentActor() actor: Actor) {
    return this.assemblies.create(body, actor);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  @RequirePermission('assemblies.update', 'assemblies.delete')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    return this.assemblies.cancel(id, body.reason, actor);
  }

  @Post(':id/invoice')
  @RequirePermission('invoices.create')
  invoice(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.invoices.createFromAssembly(id, actor);
  }
}

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly dispatches: DispatchesService,
  ) {}

  @Get()
  @RequirePermission(...BILLING_READERS)
  list(@Query(new ZodValidationPipe(invoiceQuerySchema)) query: z.infer<typeof invoiceQuerySchema>) {
    return this.invoices.list(query, query);
  }

  /** The number the invoice will get when issued, shown while it is typed (before the :id route). */
  @Get('next-number')
  @RequirePermission('invoices.create', 'invoices.update')
  nextNumber(@Query(new ZodValidationPipe(nextNumberQuerySchema)) q: z.infer<typeof nextNumberQuerySchema>) {
    return this.invoices.nextNumber(q.companyId, q.gstType as never, q.date);
  }

  /** Figures for the strip above the invoice list (before the :id route). */
  @Get('summary')
  @RequirePermission(...BILLING_READERS)
  summary() {
    return this.invoices.summary();
  }

  /** Customer details a new direct invoice starts with (before the :id route). */
  @Get('party-defaults')
  @RequirePermission('invoices.create')
  partyDefaults(@Query(new ZodValidationPipe(partyDefaultsQuerySchema)) q: z.infer<typeof partyDefaultsQuerySchema>) {
    return this.invoices.partyDefaults(q.customerId, q.companyId);
  }

  /** Direct invoice, typed in without a sales order or packing. */
  @Post()
  @RequirePermission('invoices.create')
  createDirect(@Body(new ZodValidationPipe(directInvoiceSchema)) body: DirectInvoiceInput, @CurrentActor() actor: Actor) {
    return this.invoices.createDirect(body, actor);
  }

  @Get(':id')
  @RequirePermission(...BILLING_READERS)
  get(@Param('id', ParseIntPipe) id: number) {
    return this.invoices.get(id);
  }

  @Get(':id/pdf')
  @RequirePermission(...BILLING_READERS)
  async pdf(@Param('id', ParseIntPipe) id: number, @Query('download') download: string | undefined, @Res() res: Response) {
    sendPdf(res, await this.invoices.pdf(id), download);
  }

  @Put(':id')
  @RequirePermission('invoices.update')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(invoiceSchema)) body: InvoiceInput, @CurrentActor() actor: Actor) {
    return this.invoices.update(id, body, actor);
  }

  @Post(':id/issue')
  @RequirePermission('invoices.approve')
  issue(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.invoices.issue(id, actor);
  }

  @Post(':id/cancel')
  @RequirePermission('invoices.update', 'invoices.delete')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    return this.invoices.cancel(id, body.reason, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('invoices.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.invoices.remove(id, actor);
  }

  @Post(':id/email')
  @RequirePermission('invoices.update', 'invoices.approve')
  email(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(emailDocumentSchema)) body: EmailDocumentInput, @CurrentActor() actor: Actor) {
    return this.invoices.email(id, body, actor);
  }

  @Post(':id/dispatch')
  @RequirePermission('dispatches.create')
  dispatch(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(dispatchSchema)) body: DispatchInput, @CurrentActor() actor: Actor) {
    return this.dispatches.create(id, body, actor);
  }
}

@Controller('dispatches')
export class DispatchesController {
  constructor(private readonly dispatches: DispatchesService) {}

  @Get()
  @RequirePermission(...BILLING_READERS)
  list(@Query(new ZodValidationPipe(dispatchQuerySchema)) query: z.infer<typeof dispatchQuerySchema>) {
    return this.dispatches.list(query, query);
  }

  @Get(':id')
  @RequirePermission(...BILLING_READERS)
  get(@Param('id', ParseIntPipe) id: number) {
    return this.dispatches.get(id);
  }

  @Get(':id/pdf')
  @RequirePermission(...BILLING_READERS)
  async pdf(@Param('id', ParseIntPipe) id: number, @Query('download') download: string | undefined, @Res() res: Response) {
    sendPdf(res, await this.dispatches.pdf(id), download);
  }

  @Put(':id')
  @RequirePermission('dispatches.update')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(dispatchSchema)) body: DispatchInput, @CurrentActor() actor: Actor) {
    return this.dispatches.update(id, body, actor);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  @RequirePermission('dispatches.update', 'dispatches.delete')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    return this.dispatches.cancel(id, body.reason, actor);
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermission('payments.view')
  list(@Query(new ZodValidationPipe(paymentQuerySchema)) query: z.infer<typeof paymentQuerySchema>) {
    return this.payments.list(query, query);
  }

  @Get('outstanding')
  @RequirePermission('payments.view')
  outstanding(@Query(new ZodValidationPipe(directionSchema)) q: z.infer<typeof directionSchema>) {
    return this.payments.outstanding(q.direction);
  }

  @Post()
  @RequirePermission('payments.create')
  create(@Body(new ZodValidationPipe(paymentSchema)) body: PaymentInput, @CurrentActor() actor: Actor) {
    return this.payments.create(body, actor);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  @RequirePermission('payments.update', 'payments.delete')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    return this.payments.cancel(id, body.reason, actor);
  }
}
