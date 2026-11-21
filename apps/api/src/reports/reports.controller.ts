import { Controller, Get, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  AGEING_BUCKETS,
  ageingQuerySchema,
  pendingOrdersQuerySchema,
  productionReportQuerySchema,
  purchaseReportQuerySchema,
  salesReportQuerySchema,
  STOCK_LOCATION_LABELS,
  stockMovementQuerySchema,
  type AgeingQuery,
  type PendingOrdersQuery,
  type ProductionReportQuery,
  type PurchaseReportQuery,
  type SalesReportQuery,
  type StockMovementQuery,
} from '@bht/shared';
import { RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { sendCsv } from '../common/csv';
import { PrismaService } from '../prisma/prisma.service';
import { TraceabilityService } from './traceability.service';
import { ReportsService } from './reports.service';
import { BusinessReportsService } from './business-reports.service';
import { renderHeatTracePdf, renderOrderTracePdf } from './trace-pdf';

const searchSchema = z.object({ q: z.string().trim().max(100).default('') });
const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-');
const today = () => new Date().toISOString().slice(0, 10);

function sendPdf(res: Response, fileName: string, buffer: Buffer, download?: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(buffer);
}

@Controller('traceability')
export class TraceabilityController {
  constructor(
    private readonly trace: TraceabilityService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('search')
  @RequirePermission('traceability.view')
  search(@Query(new ZodValidationPipe(searchSchema)) q: z.infer<typeof searchSchema>) {
    return this.trace.search(q.q);
  }

  @Get('heats/:id')
  @RequirePermission('traceability.view')
  heat(@Param('id', ParseIntPipe) id: number) {
    return this.trace.heat(id);
  }

  @Get('heats/:id/pdf')
  @RequirePermission('traceability.export')
  async heatPdf(@Param('id', ParseIntPipe) id: number, @Query('download') download: string | undefined, @Res() res: Response) {
    const [t, company] = await Promise.all([this.trace.heat(id), this.prisma.company.findFirst({ where: { isDefault: true } })]);
    sendPdf(res, `Heat-${fileSafe(t.heat.heatNo)}.pdf`, await renderHeatTracePdf(t, company), download);
  }

  @Get('orders/:id')
  @RequirePermission('traceability.view')
  order(@Param('id', ParseIntPipe) id: number) {
    return this.trace.order(id);
  }

  @Get('orders/:id/pdf')
  @RequirePermission('traceability.export')
  async orderPdf(@Param('id', ParseIntPipe) id: number, @Query('download') download: string | undefined, @Res() res: Response) {
    const t = await this.trace.order(id);
    // the company that billed the order; else the default one
    const billed = await this.prisma.invoice.findFirst({ where: { salesOrderId: id, status: 'ISSUED' }, orderBy: { id: 'asc' }, select: { company: true } });
    const company = billed?.company ?? (await this.prisma.company.findFirst({ where: { isDefault: true } }));
    sendPdf(res, `Traceability-${fileSafe(t.order.soNo)}.pdf`, await renderOrderTracePdf(t, company), download);
  }
}

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly business: BusinessReportsService,
  ) {}

  // ------------------------------------------------------------ stock / production / orders

  @Get('stock-movement')
  @RequirePermission('reports.view')
  stockMovement(@Query(new ZodValidationPipe(stockMovementQuerySchema)) q: StockMovementQuery) {
    return this.reports.stockMovement(q);
  }

  @Get('stock-movement/export')
  @RequirePermission('reports.export')
  async stockMovementCsv(@Query(new ZodValidationPipe(stockMovementQuerySchema)) q: StockMovementQuery, @Res() res: Response) {
    const r = await this.reports.stockMovement(q);
    const rm = q.kind === 'RAW_MATERIAL';
    sendCsv(
      res,
      `stock-movement-${rm ? 'rm' : 'fg'}-${q.from}-to-${q.to}.csv`,
      ['Code', rm ? 'Raw material' : 'Item', 'Heat', 'Mill heat', 'Unit', 'Location', `Opening ${q.from}`, 'In', 'Out', `Closing ${q.to}`],
      [
        ...r.rows.map((x) => [x.code, x.name, x.heat?.heatNo, x.heat?.millHeatNo, x.uom, q.location ? STOCK_LOCATION_LABELS[q.location] : 'All', x.opening, x.in, x.out, x.closing]),
        ['', 'Total', '', '', '', '', r.totals.opening, r.totals.in, r.totals.out, r.totals.closing],
      ],
    );
  }

  @Get('production')
  @RequirePermission('reports.view')
  production(@Query(new ZodValidationPipe(productionReportQuerySchema)) q: ProductionReportQuery) {
    return this.reports.production(q);
  }

  /** The rejections of the period, one row per stage entry. */
  @Get('production/export')
  @RequirePermission('reports.export')
  async productionCsv(@Query(new ZodValidationPipe(productionReportQuerySchema)) q: ProductionReportQuery, @Res() res: Response) {
    const r = await this.reports.production(q);
    sendCsv(
      res,
      `rejections-${q.from}-to-${q.to}.csv`,
      ['Date', 'Route card', 'Item code', 'Part', 'Stage', 'Received', 'Rejected', 'Reason', 'Recorded by'],
      r.rejections.map((x) => [x.date ? new Date(x.date.getTime() + 330 * 60_000) : null, x.rcNo, x.item.code, x.item.name, x.stage, x.received, x.rejected, x.reason, x.by]),
    );
  }

  @Get('pending-orders')
  @RequirePermission('reports.view')
  pendingOrders(@Query(new ZodValidationPipe(pendingOrdersQuerySchema)) q: PendingOrdersQuery) {
    return this.reports.pendingOrders(q);
  }

  @Get('pending-orders/export')
  @RequirePermission('reports.export')
  async pendingOrdersCsv(@Query(new ZodValidationPipe(pendingOrdersQuerySchema)) q: PendingOrdersQuery, @Res() res: Response) {
    const r = await this.reports.pendingOrders(q);
    sendCsv(
      res,
      `pending-orders-${today()}.csv`,
      ['SO no', 'SO date', 'Customer', 'Customer PO', 'Product', 'Spec', 'Made', 'Ordered', 'Packed', 'Dispatched', 'Pending', 'Due date', 'Days late', 'Currency', 'Pending value', 'Pending value (INR)'],
      r.rows.map((x) => [x.order.soNo, x.order.soDate, x.customer.name, x.order.customerPoNo, x.product, x.spec, x.decision, x.ordered, x.packed, x.dispatched, x.pending, x.dueDate, x.overdueDays || '', x.currency, x.value, x.valueInr]),
    );
  }

  // ------------------------------------------------------------ money

  @Get('dashboard')
  @RequirePermission('business_reports.view')
  dashboard() {
    return this.business.dashboard();
  }

  @Get('sales')
  @RequirePermission('business_reports.view')
  sales(@Query(new ZodValidationPipe(salesReportQuerySchema)) q: SalesReportQuery) {
    return this.business.sales(q);
  }

  @Get('sales/export')
  @RequirePermission('business_reports.export')
  async salesCsv(@Query(new ZodValidationPipe(salesReportQuerySchema)) q: SalesReportQuery, @Res() res: Response) {
    const r = await this.business.sales(q);
    const name = `sales-${r.view}-${q.from}-to-${q.to}.csv`;
    if (r.view === 'register') {
      return sendCsv(
        res,
        name,
        ['Invoice no', 'Date', 'Status', 'Company', 'Customer', 'GSTIN', 'Place of supply', 'Currency', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST', 'Invoice total', 'Taxable (INR)', 'Total (INR)', 'Received (INR)'],
        r.rows.map((x) => [x.invoiceNo, x.invoiceDate, x.status, x.company, x.billingName, x.gstin, x.placeOfSupply, x.currency, x.exchangeRate, x.taxable, x.cgst, x.sgst, x.igst, x.total, x.inr.taxable, x.inr.total, x.inr.paid]),
      );
    }
    if (r.view === 'customer') {
      return sendCsv(res, name, ['Customer', 'Invoices', 'Taxable (INR)', 'GST (INR)', 'Total (INR)', 'Received (INR)', 'Balance (INR)'], r.rows.map((x) => [x.customer.name, x.invoices, x.taxable, x.gst, x.total, x.paid, x.balance]));
    }
    if (r.view === 'product') {
      return sendCsv(res, name, ['Product', 'Quantity', 'Unit', 'Invoices', 'Value after discount (INR)'], r.rows.map((x) => [x.product, x.quantity, x.uom, x.invoices, x.value]));
    }
    return sendCsv(res, name, ['Month', 'Invoices', 'Taxable (INR)', 'GST (INR)', 'Total (INR)', 'Received (INR)'], r.rows.map((x) => [x.month, x.invoices, x.taxable, x.gst, x.total, x.received]));
  }

  @Get('purchases')
  @RequirePermission('business_reports.view')
  purchases(@Query(new ZodValidationPipe(purchaseReportQuerySchema)) q: PurchaseReportQuery) {
    return this.business.purchases(q);
  }

  @Get('purchases/export')
  @RequirePermission('business_reports.export')
  async purchasesCsv(@Query(new ZodValidationPipe(purchaseReportQuerySchema)) q: PurchaseReportQuery, @Res() res: Response) {
    const r = await this.business.purchases(q);
    const name = `purchases-${r.view}-${q.from}-to-${q.to}.csv`;
    if (r.view === 'supplier') {
      return sendCsv(res, name, ['Supplier', 'Orders', 'Taxable', 'GST', 'Total', 'Paid', 'Balance'], r.rows.map((x) => [x.supplier.name, x.orders, x.taxable, x.tax, x.total, x.paid, x.balance]));
    }
    return sendCsv(
      res,
      name,
      ['PO no', 'Date', 'Type', 'Status', 'Company', 'Supplier', 'GSTIN', 'Currency', 'Taxable', 'GST', 'Total', 'Paid', 'Balance', 'Received %'],
      r.rows.map((x) => [x.poNo, x.poDate, x.type, x.status, x.company, x.supplier.name, x.gstin, x.currency, x.taxable, x.tax, x.total, x.paid, x.balance, x.receivedPercent]),
    );
  }

  @Get('ageing')
  @RequirePermission('business_reports.view')
  ageing(@Query(new ZodValidationPipe(ageingQuerySchema)) q: AgeingQuery) {
    return this.business.ageing(q);
  }

  /** One row per open invoice / PO with its bucket. */
  @Get('ageing/export')
  @RequirePermission('business_reports.export')
  async ageingCsv(@Query(new ZodValidationPipe(ageingQuerySchema)) q: AgeingQuery, @Res() res: Response) {
    const r = await this.business.ageing(q);
    const label = Object.fromEntries(AGEING_BUCKETS.map((b) => [b.key, b.label]));
    sendCsv(
      res,
      `${q.direction === 'RECEIPT' ? 'receivables' : 'payables'}-ageing-${today()}.csv`,
      [q.direction === 'RECEIPT' ? 'Customer' : 'Supplier', 'Document', 'Date', 'Due date', 'Days late', 'Ageing', 'Currency', 'Balance', 'Balance (INR)'],
      r.parties.flatMap((p) => p.documents.map((d) => [p.party.name, d.number, d.date, d.dueDate, d.overdueDays || '', label[d.bucket], d.currency, d.balance, d.balanceInr])),
    );
  }
}
