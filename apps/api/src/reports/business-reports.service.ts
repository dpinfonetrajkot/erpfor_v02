import { Injectable } from '@nestjs/common';
import { ageingBucket, AGEING_BUCKETS, financialYear, type AgeingBucket, type AgeingQuery, type PurchaseReportQuery, type SalesReportQuery } from '@bht/shared';
import { InvoiceStatus, PaymentDirection, Prisma, PurchaseOrderStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../billing/payments.service';
import { dateOf, todayYmd } from './reports.service';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Invoices that count as sales: issued (cancelled ones are listed in the register but not added up). */
const SOLD = [InvoiceStatus.ISSUED];
/** Purchase orders that count as bought: approved and later. */
const BOUGHT: PurchaseOrderStatus[] = [PurchaseOrderStatus.ISSUED, PurchaseOrderStatus.PARTIALLY_RECEIVED, PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.CLOSED];

const invoiceSelect = {
  id: true,
  invoiceNo: true,
  invoiceDate: true,
  type: true,
  status: true,
  currency: true,
  exchangeRate: true,
  billingName: true,
  billingGstin: true,
  placeOfSupply: true,
  gstType: true,
  taxableAmount: true,
  cgstAmount: true,
  sgstAmount: true,
  igstAmount: true,
  grandTotal: true,
  amountPaid: true,
  company: { select: { code: true } },
  customer: { select: { id: true, name: true } },
} as const;

type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

/** Amounts of one invoice in its currency and in rupees (USD × the invoice's exchange rate). */
function money(i: InvoiceRow) {
  const rate = n(i.exchangeRate) || 1;
  const gst = n(i.cgstAmount) + n(i.sgstAmount) + n(i.igstAmount);
  return {
    taxable: n(i.taxableAmount),
    cgst: n(i.cgstAmount),
    sgst: n(i.sgstAmount),
    igst: n(i.igstAmount),
    total: n(i.grandTotal),
    paid: n(i.amountPaid),
    inr: {
      taxable: r2(n(i.taxableAmount) * rate),
      gst: r2(gst * rate),
      total: r2(n(i.grandTotal) * rate),
      paid: r2(n(i.amountPaid) * rate),
    },
  };
}

/** "2026-04" .. "2027-03" between two dates (inclusive). */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Sales, purchases and money owed (amounts in rupees; USD converted at each invoice's rate). */
@Injectable()
export class BusinessReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  // ------------------------------------------------------------------ sales

  private invoices(q: { from: string; to: string; companyId?: number; customerId?: number }, statuses: InvoiceStatus[]) {
    return this.prisma.invoice.findMany({
      where: {
        status: { in: statuses },
        invoiceDate: { gte: dateOf(q.from), lte: dateOf(q.to) },
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
      },
      orderBy: [{ invoiceDate: 'asc' }, { invoiceNo: 'asc' }],
      select: invoiceSelect,
    });
  }

  async sales(q: SalesReportQuery) {
    if (q.view === 'customer') return this.salesByCustomer(q);
    if (q.view === 'product') return this.salesByProduct(q);
    if (q.view === 'month') return this.salesByMonth(q);
    return this.salesRegister(q);
  }

  /** GST sales register: one row per invoice; cancelled invoices are shown but not added up. */
  async salesRegister(q: SalesReportQuery) {
    const list = await this.invoices(q, [InvoiceStatus.ISSUED, InvoiceStatus.CANCELLED]);
    const rows = list.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      invoiceDate: i.invoiceDate,
      type: i.type,
      status: i.status,
      company: i.company.code,
      customer: i.customer,
      billingName: i.billingName,
      gstin: i.billingGstin,
      placeOfSupply: i.placeOfSupply,
      gstType: i.gstType,
      currency: i.currency,
      exchangeRate: n(i.exchangeRate),
      ...money(i),
    }));
    const live = rows.filter((r) => r.status === InvoiceStatus.ISSUED);
    const t = (f: (r: (typeof rows)[number]) => number) => r2(live.reduce((s, r) => s + f(r), 0));
    return {
      view: 'register' as const,
      rows,
      totals: {
        invoices: live.length,
        cancelled: rows.length - live.length,
        taxable: t((r) => r.inr.taxable),
        // GST is charged in rupees only (exports are under LUT), so these add up directly
        cgst: t((r) => (r.currency === 'INR' ? r.cgst : 0)),
        sgst: t((r) => (r.currency === 'INR' ? r.sgst : 0)),
        igst: t((r) => (r.currency === 'INR' ? r.igst : 0)),
        total: t((r) => r.inr.total),
        paid: t((r) => r.inr.paid),
      },
    };
  }

  private async salesByCustomer(q: SalesReportQuery) {
    const list = await this.invoices(q, SOLD);
    const map = new Map<number, { customer: { id: number; name: string }; invoices: number; taxable: number; gst: number; total: number; paid: number }>();
    for (const i of list) {
      const m = money(i);
      const row = map.get(i.customer.id) ?? { customer: i.customer, invoices: 0, taxable: 0, gst: 0, total: 0, paid: 0 };
      row.invoices++;
      row.taxable = r2(row.taxable + m.inr.taxable);
      row.gst = r2(row.gst + m.inr.gst);
      row.total = r2(row.total + m.inr.total);
      row.paid = r2(row.paid + m.inr.paid);
      map.set(i.customer.id, row);
    }
    const rows = [...map.values()].map((r) => ({ ...r, balance: r2(r.total - r.paid) })).sort((a, b) => b.total - a.total);
    const t = (f: (r: (typeof rows)[number]) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
    return {
      view: 'customer' as const,
      rows,
      totals: { invoices: rows.reduce((s, r) => s + r.invoices, 0), taxable: t((r) => r.taxable), gst: t((r) => r.gst), total: t((r) => r.total), paid: t((r) => r.paid), balance: t((r) => r.balance) },
    };
  }

  /** Sets sold per product; value = line amount after the invoice discount, before freight and GST. */
  private async salesByProduct(q: SalesReportQuery) {
    const lines = await this.prisma.invoiceLine.findMany({
      where: {
        invoice: {
          status: { in: SOLD },
          invoiceDate: { gte: dateOf(q.from), lte: dateOf(q.to) },
          ...(q.companyId ? { companyId: q.companyId } : {}),
          ...(q.customerId ? { customerId: q.customerId } : {}),
        },
      },
      select: {
        quantity: true,
        amount: true,
        description: true,
        uom: true,
        invoiceId: true,
        invoice: { select: { exchangeRate: true, discountPercent: true } },
        salesOrderLine: { select: { product: { select: { id: true, name: true } } } },
      },
    });
    const map = new Map<string, { product: string; productId: number | null; quantity: number; uom: string; value: number; invoices: Set<number> }>();
    for (const l of lines) {
      const product = l.salesOrderLine?.product;
      const key = product ? `p${product.id}` : `d${l.description}`;
      const row = map.get(key) ?? { product: product?.name ?? l.description, productId: product?.id ?? null, quantity: 0, uom: l.uom, value: 0, invoices: new Set<number>() };
      row.quantity = r3(row.quantity + n(l.quantity));
      row.value = r2(row.value + n(l.amount) * (1 - n(l.invoice.discountPercent) / 100) * (n(l.invoice.exchangeRate) || 1));
      row.invoices.add(l.invoiceId);
      map.set(key, row);
    }
    const rows = [...map.values()].map(({ invoices, ...r }) => ({ ...r, invoices: invoices.size })).sort((a, b) => b.value - a.value);
    return {
      view: 'product' as const,
      rows,
      totals: { quantity: r3(rows.reduce((s, r) => s + r.quantity, 0)), value: r2(rows.reduce((s, r) => s + r.value, 0)) },
    };
  }

  /** Per month: sales (by invoice date) and money received (by payment date). */
  private async salesByMonth(q: SalesReportQuery) {
    const [list, receipts] = await Promise.all([
      this.invoices(q, SOLD),
      this.prisma.payment.findMany({
        where: {
          direction: PaymentDirection.RECEIPT,
          cancelledAt: null,
          paymentDate: { gte: dateOf(q.from), lte: dateOf(q.to) },
          ...(q.customerId ? { customerId: q.customerId } : {}),
          ...(q.companyId ? { invoice: { companyId: q.companyId } } : {}),
        },
        select: { paymentDate: true, amount: true, invoice: { select: { exchangeRate: true } } },
      }),
    ]);
    const months = new Map(monthsBetween(q.from, q.to).map((m) => [m, { month: m, invoices: 0, taxable: 0, gst: 0, total: 0, received: 0 }]));
    for (const i of list) {
      const row = months.get(i.invoiceDate.toISOString().slice(0, 7));
      if (!row) continue;
      const m = money(i);
      row.invoices++;
      row.taxable = r2(row.taxable + m.inr.taxable);
      row.gst = r2(row.gst + m.inr.gst);
      row.total = r2(row.total + m.inr.total);
    }
    for (const p of receipts) {
      const row = months.get(p.paymentDate.toISOString().slice(0, 7));
      if (row) row.received = r2(row.received + n(p.amount) * (n(p.invoice?.exchangeRate) || 1));
    }
    const rows = [...months.values()];
    const t = (f: (r: (typeof rows)[number]) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
    return {
      view: 'month' as const,
      rows,
      totals: { invoices: rows.reduce((s, r) => s + r.invoices, 0), taxable: t((r) => r.taxable), gst: t((r) => r.gst), total: t((r) => r.total), received: t((r) => r.received) },
    };
  }

  // ------------------------------------------------------------------ purchases

  async purchases(q: PurchaseReportQuery) {
    const list = await this.prisma.purchaseOrder.findMany({
      where: {
        status: { in: BOUGHT },
        poDate: { gte: dateOf(q.from), lte: dateOf(q.to) },
        ...(q.supplierId ? { supplierId: q.supplierId } : {}),
        ...(q.type ? { type: q.type } : {}),
      },
      orderBy: [{ poDate: 'asc' }, { poNo: 'asc' }],
      select: {
        id: true, poNo: true, poDate: true, type: true, status: true, currency: true, gstType: true,
        taxableAmount: true, taxAmount: true, grandTotal: true, paidAmount: true, paymentStatus: true,
        company: { select: { code: true } },
        supplier: { select: { id: true, name: true, gstin: true } },
        lines: { select: { quantity: true, receivedQty: true } },
      },
    });
    const rows = list.map((p) => {
      const ordered = p.lines.reduce((s, l) => s + n(l.quantity), 0);
      const received = p.lines.reduce((s, l) => s + n(l.receivedQty), 0);
      return {
        id: p.id,
        poNo: p.poNo,
        poDate: p.poDate,
        type: p.type,
        status: p.status,
        company: p.company.code,
        supplier: { id: p.supplier.id, name: p.supplier.name },
        gstin: p.supplier.gstin,
        gstType: p.gstType,
        currency: p.currency,
        taxable: n(p.taxableAmount),
        tax: n(p.taxAmount),
        total: n(p.grandTotal),
        paid: n(p.paidAmount),
        balance: r2(n(p.grandTotal) - n(p.paidAmount)),
        paymentStatus: p.paymentStatus,
        receivedPercent: ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0,
      };
    });
    if (q.view === 'supplier') {
      const map = new Map<number, { supplier: { id: number; name: string }; orders: number; taxable: number; tax: number; total: number; paid: number; balance: number }>();
      for (const r of rows) {
        const s = map.get(r.supplier.id) ?? { supplier: r.supplier, orders: 0, taxable: 0, tax: 0, total: 0, paid: 0, balance: 0 };
        s.orders++;
        s.taxable = r2(s.taxable + r.taxable);
        s.tax = r2(s.tax + r.tax);
        s.total = r2(s.total + r.total);
        s.paid = r2(s.paid + r.paid);
        s.balance = r2(s.balance + r.balance);
        map.set(r.supplier.id, s);
      }
      const sup = [...map.values()].sort((a, b) => b.total - a.total);
      const t = (f: (r: (typeof sup)[number]) => number) => r2(sup.reduce((s, r) => s + f(r), 0));
      return { view: 'supplier' as const, rows: sup, totals: { orders: rows.length, taxable: t((r) => r.taxable), tax: t((r) => r.tax), total: t((r) => r.total), paid: t((r) => r.paid), balance: t((r) => r.balance) } };
    }
    const t = (f: (r: (typeof rows)[number]) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
    return { view: 'register' as const, rows, totals: { orders: rows.length, taxable: t((r) => r.taxable), tax: t((r) => r.tax), total: t((r) => r.total), paid: t((r) => r.paid), balance: t((r) => r.balance) } };
  }

  // ------------------------------------------------------------------ ageing

  /** Money owed per customer / supplier, split by how long it is overdue (rupees). */
  async ageing(q: AgeingQuery) {
    const docs = await this.payments.outstanding(q.direction === 'RECEIPT' ? PaymentDirection.RECEIPT : PaymentDirection.PAYMENT);
    const empty = () => Object.fromEntries(AGEING_BUCKETS.map((b) => [b.key, 0])) as Record<AgeingBucket, number>;
    const rows = docs.map((d) => ({
      kind: d.kind,
      id: d.id,
      number: d.number,
      date: d.date,
      dueDate: d.dueDate,
      currency: d.currency,
      balance: d.balance,
      balanceInr: r2(d.balance * (d.exchangeRate || 1)),
      overdueDays: d.overdueDays,
      bucket: ageingBucket(d.overdueDays),
      party: d.party,
    }));
    const parties = new Map<number, { party: { id: number; name: string }; buckets: Record<AgeingBucket, number>; total: number; maxOverdueDays: number; documents: (typeof rows)[number][] }>();
    for (const r of rows) {
      const p = parties.get(r.party.id) ?? { party: r.party, buckets: empty(), total: 0, maxOverdueDays: 0, documents: [] };
      p.buckets[r.bucket] = r2(p.buckets[r.bucket] + r.balanceInr);
      p.total = r2(p.total + r.balanceInr);
      p.maxOverdueDays = Math.max(p.maxOverdueDays, r.overdueDays);
      p.documents.push(r);
      parties.set(r.party.id, p);
    }
    const list = [...parties.values()].sort((a, b) => b.total - a.total);
    const totals = empty();
    for (const p of list) for (const b of AGEING_BUCKETS) totals[b.key] = r2(totals[b.key] + p.buckets[b.key]);
    return {
      direction: q.direction,
      parties: list,
      totals: { ...totals, total: r2(list.reduce((s, p) => s + p.total, 0)), documents: rows.length },
    };
  }

  // ------------------------------------------------------------------ dashboard

  /** Money tiles and the monthly chart on the dashboard (rupees). */
  async dashboard() {
    const today = todayYmd();
    const fy = financialYear(today);
    const thisMonth = today.slice(0, 7);
    const [ly, lm] = thisMonth.split('-').map(Number);
    const lastMonth = lm === 1 ? `${ly - 1}-12` : `${ly}-${String(lm - 1).padStart(2, '0')}`;
    // the chart shows the last 12 months, so it is never empty at the start of a year
    const [cy, cm] = thisMonth.split('-').map(Number);
    const chartFrom = `${cm === 12 ? cy : cy - 1}-${String((cm % 12) + 1).padStart(2, '0')}-01`;
    const from = chartFrom < fy.from ? chartFrom : fy.from;

    // the last 30 days, oldest first, for the daily sales bars
    const dayFrom = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    const [byMonth, receivable, payable, top, byDay] = await Promise.all([
      this.salesByMonth({ from, to: today, view: 'month' }),
      this.payments.outstanding(PaymentDirection.RECEIPT),
      this.payments.outstanding(PaymentDirection.PAYMENT),
      this.salesByCustomer({ from: fy.from, to: today, view: 'customer' }),
      this.salesByDay(dayFrom, today),
    ]);
    const monthRow = (m: string) => byMonth.rows.find((r) => r.month === m) ?? { total: 0, received: 0 };
    const owed = (rows: typeof receivable) => ({
      total: r2(rows.reduce((s, r) => s + r.balance * (r.exchangeRate || 1), 0)),
      overdue: r2(rows.filter((r) => r.overdueDays > 0).reduce((s, r) => s + r.balance * (r.exchangeRate || 1), 0)),
      documents: rows.length,
    });
    return {
      fy: fy.label,
      sales: {
        thisMonth: monthRow(thisMonth).total,
        lastMonth: monthRow(lastMonth).total,
        fyToDate: r2(byMonth.rows.filter((r) => r.month >= fy.from.slice(0, 7)).reduce((s, r) => s + r.total, 0)),
      },
      receivedThisMonth: monthRow(thisMonth).received,
      receivable: owed(receivable),
      payable: owed(payable),
      // money to receive, split by how long it is overdue
      receivableAgeing: AGEING_BUCKETS.map((b) => ({
        key: b.key,
        label: b.label,
        amount: r2(receivable.filter((r) => ageingBucket(r.overdueDays) === b.key).reduce((s, r) => s + r.balance * (r.exchangeRate || 1), 0)),
      })),
      months: byMonth.rows.filter((r) => r.month >= chartFrom.slice(0, 7)).map((r) => ({ month: r.month, sales: r.total, received: r.received })),
      topCustomers: top.rows.slice(0, 5).map((r) => ({ customer: r.customer, total: r.total })),
      days: byDay,
    };
  }

  /** Invoice totals (rupees, with GST) for every day from `from` to `to`, days without sales included as 0. */
  private async salesByDay(from: string, to: string) {
    const list = await this.invoices({ from, to }, SOLD);
    const days = new Map<string, number>();
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) days.set(new Date(t).toISOString().slice(0, 10), 0);
    for (const i of list) {
      const d = i.invoiceDate.toISOString().slice(0, 10);
      if (days.has(d)) days.set(d, r2(days.get(d)! + money(i).inr.total));
    }
    return [...days].map(([date, sales]) => ({ date, sales }));
  }
}
