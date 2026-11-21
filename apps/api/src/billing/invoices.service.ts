import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  computeTotals,
  DEFAULT_INVOICE_TERMS,
  defaultGstType,
  EXPORT_LUT_NOTE,
  INDIAN_STATES,
  type DirectInvoiceInput,
  type EmailDocumentInput,
  type InvoiceInput,
  type ListQuery,
} from '@bht/shared';
import {
  AssemblyStatus,
  AuditAction,
  EndConnection,
  GstType,
  InvoiceStatus,
  InvoiceType,
  PaymentStatus,
  Prisma,
  ServiceType,
  Unit,
} from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { MailService } from '../core/mail.service';
import { NumberingService } from '../core/numbering.service';
import { NotificationsService } from '../core/notifications.service';
import { listArgs, paginated } from '../common/list';
import { normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';
import { renderInvoicePdf } from './invoice-pdf';

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

export const invoiceInclude = {
  company: true,
  customer: { select: { id: true, code: true, name: true, email: true, contactPerson: true, phone: true, country: true } },
  salesOrder: { select: { id: true, soNo: true } },
  assembly: { select: { id: true, assemblyNo: true, status: true, packages: true, grossWeightKg: true } },
  createdBy: { select: { id: true, name: true } },
  lines: { orderBy: { lineNo: 'asc' } },
  dispatches: { orderBy: { id: 'desc' }, select: { id: true, dispatchNo: true, dispatchDate: true, transporter: true, lrNo: true, vehicleNo: true, cancelledAt: true } },
  payments: { orderBy: { id: 'desc' }, include: { createdBy: { select: { name: true } } } },
} as const satisfies Prisma.InvoiceInclude;

export type InvoiceFull = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

const stateName = (code: string | null) => INDIAN_STATES.find((s) => s.code === code)?.name;
const typeFor = (gst: GstType) => (gst === GstType.EXPORT ? InvoiceType.EXPORT_INVOICE : InvoiceType.TAX_INVOICE);
const todayDate = () => new Date(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10) + 'T00:00:00Z');

type CustomerParty = Prisma.CustomerGetPayload<object>;

/** Bill-to / ship-to details of a customer, as printed on the invoice. */
function partyOf(c: CustomerParty) {
  return {
    billingName: c.name,
    billingAddress: [c.address, c.city, stateName(c.stateCode), c.pincode, c.country !== 'India' ? c.country : null].filter(Boolean).join(', ') || null,
    billingGstin: c.gstin,
    shippingName: c.name,
    shippingAddress: c.shippingAddress,
    shippingGstin: c.gstin,
    placeOfSupply: c.stateCode,
  };
}

export interface InvoiceFilters {
  status?: InvoiceStatus;
  customerId?: number;
  paymentStatus?: PaymentStatus | 'DUE';
  salesOrderId?: number;
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListQuery, filters: InvoiceFilters) {
    const due = filters.paymentStatus === 'DUE';
    const args = listArgs(
      query,
      {
        searchFields: ['invoiceNo', 'billingName', 'customerPoNo', 'salesOrder.soNo'],
        sortable: ['invoiceNo', 'invoiceDate', 'dueDate', 'grandTotal', 'status'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.salesOrderId ? { salesOrderId: filters.salesOrderId } : {}),
        ...(due ? { status: InvoiceStatus.ISSUED, paymentStatus: { not: PaymentStatus.PAID } } : filters.paymentStatus ? { paymentStatus: filters.paymentStatus } : {}),
      },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        ...args,
        include: {
          customer: { select: { id: true, name: true } },
          company: { select: { id: true, code: true } },
          salesOrder: { select: { id: true, soNo: true } },
          dispatches: { where: { cancelledAt: null }, select: { id: true, dispatchNo: true } },
        },
      }),
      this.prisma.invoice.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  async get(id: number): Promise<InvoiceFull> {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  /** Draft invoice for packed sets: customer, prices and currency from the sales order. */
  async createFromAssembly(assemblyId: number, actor: Actor) {
    const inv = await this.prisma.$transaction(async (tx) => {
      const a = await tx.assembly.findUniqueOrThrow({
        where: { id: assemblyId },
        include: {
          invoices: true,
          lines: { include: { salesOrderLine: { include: { product: true, materialGrade: true } } }, orderBy: { id: 'asc' } },
          salesOrder: { include: { customer: true } },
        },
      });
      if (a.status !== AssemblyStatus.PACKED) throw new BadRequestException(`${a.assemblyNo} is ${a.status.toLowerCase()}`);
      const live = a.invoices.find((i) => i.status !== InvoiceStatus.CANCELLED);
      if (live) throw new BadRequestException(`${a.assemblyNo} already has invoice ${live.invoiceNo}`);
      const company =
        (await tx.company.findFirst({ where: { isActive: true, isDefault: true } })) ?? (await tx.company.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } }));
      if (!company) throw new BadRequestException('Add our company first (Admin → Companies)');
      const so = a.salesOrder;
      const c = so.customer;
      const gstType = defaultGstType(company.stateCode, c.stateCode, c.country) as GstType;
      const invoiceDate = todayDate();
      const lines = a.lines.map((l, i) => {
        const sl = l.salesOrderLine;
        const description = [
          sl.product.name,
          sl.endConnection !== EndConnection.NONE ? sl.endConnection : null,
          sl.service === ServiceType.SOUR ? 'Sour service (NACE)' : null,
          sl.schedule ? `Sch. ${sl.schedule}` : null,
          sl.materialGrade ? sl.materialGrade.name : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return { lineNo: i + 1, salesOrderLineId: sl.id, description, hsnCode: sl.product.hsnCode, quantity: num(l.quantity), uom: Unit.SET, rate: num(sl.rate), taxRate: 18 };
      });
      const totals = computeTotals({ lines, taxRate: 18, gstType, currency: so.currency });
      const created = await tx.invoice.create({
        data: {
          invoiceNo: `DRAFT-${randomBytes(5).toString('hex')}`,
          type: typeFor(gstType),
          invoiceDate,
          dueDate: c.paymentTermsDays ? new Date(invoiceDate.getTime() + c.paymentTermsDays * 86_400_000) : null,
          companyId: company.id,
          customerId: c.id,
          salesOrderId: so.id,
          assemblyId: a.id,
          currency: so.currency,
          exchangeRate: so.exchangeRate,
          customerPoNo: so.customerPoNo,
          customerPoDate: so.customerPoDate,
          ...partyOf(c),
          gstType,
          taxRate: 18,
          subTotal: totals.subTotal,
          discountAmount: totals.discountAmount,
          taxableAmount: totals.taxableAmount,
          cgstAmount: totals.cgst,
          sgstAmount: totals.sgst,
          igstAmount: totals.igst,
          roundOff: totals.roundOff,
          grandTotal: totals.grandTotal,
          terms: company.invoiceTerms || DEFAULT_INVOICE_TERMS,
          notes: gstType === GstType.EXPORT ? EXPORT_LUT_NOTE : null,
          createdById: actor.userId,
          lines: { create: lines.map((l, i) => ({ ...l, amount: totals.lineAmounts[i] })) },
        },
      });
      await this.audit.log(actor, { action: AuditAction.CREATE, entity: 'invoice', entityId: created.id, summary: `Draft invoice for ${a.assemblyNo} (${so.soNo}, ${c.name})` }, tx);
      return created;
    });
    return { id: inv.id };
  }

  /** What a new direct invoice for this customer starts with: party details, GST type, currency, due date, terms. */
  /** The number an invoice of this company and GST type will get when issued on this date (nothing is used up). */
  async nextNumber(companyId: number, gstType: GstType, date?: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { code: true } });
    if (!company) throw new NotFoundException('Company not found');
    const on = date ? new Date(`${date}T00:00:00Z`) : new Date();
    const invoiceNo = await this.numbering.preview(gstType === GstType.EXPORT ? 'EXPORT_INVOICE' : 'INVOICE', on, company.code);
    return { invoiceNo };
  }

  /** This month's billing, money still to come (and how much of it is late) and drafts waiting - in rupees. */
  async summary() {
    const now = new Date(Date.now() + 330 * 60_000); // India time
    const today = new Date(now.toISOString().slice(0, 10));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const [recent, open, drafts] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { status: 'ISSUED', invoiceDate: { gte: lastMonthStart } },
        select: { invoiceDate: true, grandTotal: true, exchangeRate: true },
      }),
      this.prisma.invoice.findMany({
        where: { status: 'ISSUED', paymentStatus: { not: 'PAID' } },
        select: { grandTotal: true, amountPaid: true, exchangeRate: true, dueDate: true },
      }),
      this.prisma.invoice.count({ where: { status: 'DRAFT' } }),
    ]);
    const rupees = (v: number) => Math.round(v * 100) / 100;
    let thisMonth = 0;
    let thisMonthCount = 0;
    let lastMonth = 0;
    for (const i of recent) {
      const v = Number(i.grandTotal) * (Number(i.exchangeRate) || 1);
      if (i.invoiceDate >= monthStart) {
        thisMonth += v;
        thisMonthCount++;
      } else lastMonth += v;
    }
    let receivable = 0;
    let overdue = 0;
    let overdueBills = 0;
    for (const i of open) {
      const v = (Number(i.grandTotal) - Number(i.amountPaid)) * (Number(i.exchangeRate) || 1);
      receivable += v;
      if (i.dueDate && i.dueDate < today) {
        overdue += v;
        overdueBills++;
      }
    }
    return {
      thisMonth: { total: rupees(thisMonth), count: thisMonthCount },
      lastMonth: rupees(lastMonth),
      receivable: { total: rupees(receivable), bills: open.length },
      overdue: { total: rupees(overdue), bills: overdueBills },
      drafts,
    };
  }

  async partyDefaults(customerId: number, companyId?: number) {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!c) throw new NotFoundException('Customer not found');
    const company = companyId
      ? await this.prisma.company.findUnique({ where: { id: companyId } })
      : ((await this.prisma.company.findFirst({ where: { isActive: true, isDefault: true } })) ?? (await this.prisma.company.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } })));
    const gstType = defaultGstType(company?.stateCode, c.stateCode, c.country) as GstType;

    // What the customer still owes (issued, not fully paid), in rupees, and how much of it is past due.
    const open = await this.prisma.invoice.findMany({
      where: { customerId, status: 'ISSUED', paymentStatus: { not: 'PAID' } },
      select: { grandTotal: true, amountPaid: true, exchangeRate: true, dueDate: true },
    });
    const today = new Date(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
    let owed = 0;
    let overdue = 0;
    for (const i of open) {
      const due = (Number(i.grandTotal) - Number(i.amountPaid)) * (Number(i.exchangeRate) || 1);
      owed += due;
      if (i.dueDate && i.dueDate < today) overdue += due;
    }

    // The latest rate billed to this customer for each item / service (newest first, one per description).
    const recent = await this.prisma.invoiceLine.findMany({
      where: { invoice: { customerId, status: 'ISSUED' } },
      orderBy: [{ invoice: { invoiceDate: 'desc' } }, { id: 'desc' }],
      take: 300,
      select: { description: true, hsnCode: true, uom: true, rate: true, invoice: { select: { invoiceNo: true, invoiceDate: true, currency: true } } },
    });
    const seen = new Set<string>();
    const lastRates = [];
    for (const l of recent) {
      const key = l.description.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lastRates.push({
        description: l.description,
        hsnCode: l.hsnCode,
        uom: l.uom,
        rate: Number(l.rate),
        currency: l.invoice.currency,
        invoiceNo: l.invoice.invoiceNo,
        invoiceDate: l.invoice.invoiceDate,
      });
      if (lastRates.length >= 50) break;
    }

    return {
      ...partyOf(c),
      gstType,
      currency: c.currency,
      paymentTermsDays: c.paymentTermsDays,
      email: c.email,
      terms: company?.invoiceTerms || DEFAULT_INVOICE_TERMS,
      notes: gstType === GstType.EXPORT ? EXPORT_LUT_NOTE : null,
      outstanding: { total: Math.round(owed * 100) / 100, overdue: Math.round(overdue * 100) / 100, bills: open.length },
      lastRates,
    };
  }

  /** Direct invoice typed in by hand (no sales order or packing): a draft, issued later like any other. Stock is not touched. */
  async createDirect(input: DirectInvoiceInput, actor: Actor) {
    const inv = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { id: input.companyId } });
      if (!company?.isActive) throw new BadRequestException({ message: 'Choose an active company', errors: { companyId: 'Inactive' } });
      const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer?.isActive) throw new BadRequestException({ message: 'Choose an active customer', errors: { customerId: 'Inactive' } });
      const totals = computeTotals({
        lines: input.lines,
        discountPercent: input.discountPercent,
        freight: input.freight,
        taxRate: input.taxRate,
        gstType: input.gstType,
        currency: input.currency,
      });
      const { lines, customerId, companyId, currency, exchangeRate, ...fields } = input;
      const created = await tx.invoice.create({
        data: {
          ...normalize(fields, ['customerPoDate']),
          invoiceNo: `DRAFT-${randomBytes(5).toString('hex')}`,
          type: typeFor(input.gstType as GstType),
          companyId,
          customerId,
          currency,
          exchangeRate: currency === 'INR' ? 1 : exchangeRate,
          subTotal: totals.subTotal,
          discountAmount: totals.discountAmount,
          taxableAmount: totals.taxableAmount,
          cgstAmount: totals.cgst,
          sgstAmount: totals.sgst,
          igstAmount: totals.igst,
          roundOff: totals.roundOff,
          grandTotal: totals.grandTotal,
          createdById: actor.userId,
          lines: { create: lines.map((l, i) => this.lineData(l, i, input.taxRate, totals.lineAmounts[i])) },
        },
      });
      await this.audit.log(actor, { action: AuditAction.CREATE, entity: 'invoice', entityId: created.id, summary: `Draft invoice (direct) for ${input.billingName}` }, tx);
      return created;
    });
    return { id: inv.id };
  }

  private lineData(l: InvoiceInput['lines'][number], i: number, taxRate: number, amount: number) {
    return { lineNo: i + 1, description: l.description, hsnCode: l.hsnCode || null, quantity: l.quantity, uom: l.uom as Unit, rate: l.rate, taxRate, amount };
  }

  async update(id: number, input: InvoiceInput, actor: Actor) {
    const before = await this.get(id);
    if (before.status !== InvoiceStatus.DRAFT) throw new BadRequestException('Only a draft invoice can be changed');
    if (!before.assemblyId) return this.updateDirect(before, input, actor);
    await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { id: input.companyId } });
      if (!company?.isActive) throw new BadRequestException({ message: 'Choose an active company', errors: { companyId: 'Inactive' } });
      if (input.lines.length !== before.lines.length || input.lines.some((l) => !before.lines.some((b) => b.id === l.id))) {
        throw new BadRequestException('Invoice lines do not match - reload the page');
      }
      // quantities and units stay those of the packed sets
      const lines = before.lines.map((b) => ({ ...b, ...input.lines.find((l) => l.id === b.id)!, quantity: b.quantity, uom: b.uom }));
      const totals = computeTotals({
        lines: lines.map((l) => ({ quantity: num(l.quantity), rate: l.rate as number })),
        discountPercent: input.discountPercent,
        freight: input.freight,
        taxRate: input.taxRate,
        gstType: input.gstType,
        currency: before.currency,
      });
      const { lines: _lines, ...fields } = input;
      await tx.invoice.update({
        where: { id },
        data: {
          ...normalize(fields, ['customerPoDate']),
          type: typeFor(input.gstType as GstType),
          subTotal: totals.subTotal,
          discountAmount: totals.discountAmount,
          taxableAmount: totals.taxableAmount,
          cgstAmount: totals.cgst,
          sgstAmount: totals.sgst,
          igstAmount: totals.igst,
          roundOff: totals.roundOff,
          grandTotal: totals.grandTotal,
        },
      });
      for (const [i, l] of lines.entries()) {
        await tx.invoiceLine.update({
          where: { id: l.id },
          data: { description: l.description, hsnCode: l.hsnCode || null, rate: l.rate, taxRate: input.taxRate, amount: totals.lineAmounts[i] },
        });
      }
      await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'invoice', entityId: id, summary: `Updated draft invoice for ${before.billingName}` }, tx);
    });
    return this.get(id);
  }

  /** A direct draft: every line can be changed, added or removed. */
  private async updateDirect(before: InvoiceFull, input: InvoiceInput, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { id: input.companyId } });
      if (!company?.isActive) throw new BadRequestException({ message: 'Choose an active company', errors: { companyId: 'Inactive' } });
      const totals = computeTotals({
        lines: input.lines,
        discountPercent: input.discountPercent,
        freight: input.freight,
        taxRate: input.taxRate,
        gstType: input.gstType,
        currency: before.currency,
      });
      const { lines, ...fields } = input;
      await tx.invoiceLine.deleteMany({ where: { invoiceId: before.id } });
      await tx.invoice.update({
        where: { id: before.id },
        data: {
          ...normalize(fields, ['customerPoDate']),
          type: typeFor(input.gstType as GstType),
          subTotal: totals.subTotal,
          discountAmount: totals.discountAmount,
          taxableAmount: totals.taxableAmount,
          cgstAmount: totals.cgst,
          sgstAmount: totals.sgst,
          igstAmount: totals.igst,
          roundOff: totals.roundOff,
          grandTotal: totals.grandTotal,
          lines: { create: lines.map((l, i) => this.lineData(l, i, input.taxRate, totals.lineAmounts[i])) },
        },
      });
      await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'invoice', entityId: before.id, summary: `Updated draft invoice for ${input.billingName}` }, tx);
    });
    return this.get(before.id);
  }

  /** Draft -> issued: gets its number from the company's own series (GST needs one unbroken series per GSTIN). */
  async issue(id: number, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { company: true, assembly: true } });
      if (inv.status !== InvoiceStatus.DRAFT) throw new BadRequestException('This invoice is already issued');
      if (inv.gstType !== GstType.EXPORT && !inv.company.gstin) throw new BadRequestException(`Add the GSTIN of ${inv.company.name} first (Admin → Companies)`);
      const invoiceNo = await this.numbering.next(inv.type === InvoiceType.EXPORT_INVOICE ? 'EXPORT_INVOICE' : 'INVOICE', {
        tx,
        date: inv.invoiceDate,
        vars: { CO: inv.company.code },
      });
      await tx.invoice.update({ where: { id }, data: { invoiceNo, status: InvoiceStatus.ISSUED, issuedAt: new Date() } });
      if (inv.assemblyId) await tx.assembly.update({ where: { id: inv.assemblyId }, data: { status: AssemblyStatus.INVOICED } });
      await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'invoice', entityId: id, summary: `Issued invoice ${invoiceNo} to ${inv.billingName} (${inv.grandTotal.toString()} ${inv.currency})` }, tx);
    });
    const issued = await this.get(id);
    if (issued.salesOrderId) await this.notifications.toPermission('dispatches.create', { title: `${issued.invoiceNo} issued - to dispatch`, body: issued.billingName, link: `/billing/invoices/${id}` }, actor.userId);
    return issued;
  }

  /** An issued invoice keeps its number; cancelled only when nothing is dispatched or paid against it. */
  async cancel(id: number, reason: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { dispatches: true, payments: true } });
      if (inv.status !== InvoiceStatus.ISSUED) throw new BadRequestException('Only an issued invoice can be cancelled - delete a draft instead');
      if (inv.dispatches.some((d) => !d.cancelledAt)) throw new BadRequestException('The goods are dispatched on this invoice - cancel the dispatch first');
      if (inv.payments.some((p) => !p.cancelledAt)) throw new BadRequestException('Payments are recorded on this invoice - cancel them first');
      await tx.invoice.update({ where: { id }, data: { status: InvoiceStatus.CANCELLED, cancelReason: reason } });
      if (inv.assemblyId) await tx.assembly.update({ where: { id: inv.assemblyId }, data: { status: AssemblyStatus.PACKED } });
      await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'invoice', entityId: id, summary: `Cancelled invoice ${inv.invoiceNo}: ${reason}` }, tx);
    });
    return this.get(id);
  }

  async remove(id: number, actor: Actor) {
    const inv = await this.get(id);
    if (inv.status !== InvoiceStatus.DRAFT) throw new BadRequestException('Only a draft can be deleted - cancel an issued invoice');
    await this.prisma.invoice.delete({ where: { id } });
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'invoice', entityId: id, summary: `Deleted draft invoice for ${inv.billingName}` });
  }

  async pdf(id: number) {
    const inv = await this.get(id);
    const consumptions = inv.assemblyId
      ? await this.prisma.assemblyConsumption.findMany({ where: { assemblyId: inv.assemblyId }, include: { heat: { select: { heatNo: true } } } })
      : [];
    const heats = [...new Set(consumptions.map((c) => c.heat?.heatNo).filter((h): h is string => !!h))];
    return { fileName: `${inv.invoiceNo.replace(/[^\w-]+/g, '-')}.pdf`, buffer: await renderInvoicePdf(inv, heats) };
  }

  async email(id: number, input: EmailDocumentInput, actor: Actor) {
    const inv = await this.get(id);
    if (inv.status !== InvoiceStatus.ISSUED) throw new BadRequestException('Issue the invoice before sending it');
    const { fileName, buffer } = await this.pdf(id);
    await this.mail.send({
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      text: input.message || `Please find attached invoice ${inv.invoiceNo}.`,
      attachments: [{ filename: fileName, content: buffer, contentType: 'application/pdf' }],
    });
    await this.prisma.invoice.update({ where: { id }, data: { emailedAt: new Date() } });
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'invoice', entityId: id, summary: `E-mailed invoice ${inv.invoiceNo} to ${input.to}` });
    return { sentTo: input.to };
  }

  /** Amount paid and status from the payments that are not cancelled. */
  static async refreshPaid(tx: Tx, invoiceId: number) {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: { where: { cancelledAt: null } } } });
    const paid = Math.round(inv.payments.reduce((s, p) => s + num(p.amount), 0) * 100) / 100;
    const status = paid <= 0 ? PaymentStatus.UNPAID : paid + 0.005 >= num(inv.grandTotal) ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
    await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: paid, paymentStatus: status } });
  }
}
