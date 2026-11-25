import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DEFAULT_TALLY_SETTINGS,
  INDIAN_STATES,
  TALLY_LEDGERS,
  TALLY_VOUCHER_TYPES,
  tallySettingsSchema,
  type TallyExportQuery,
  type TallyLastExport,
  type TallyLedgerKey,
  type TallyPreview,
  type TallyPreviewRow,
  type TallySettings,
  type TallyVoucherKind,
} from '@bht/shared';
import { AuditAction, InvoiceStatus, PaymentDirection, PaymentMode, Prisma, PurchaseOrderStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import type { Actor, AuthUser } from '../common/auth-user';
import { PAYABLE_PO } from '../billing/payments.service';
import { envelope, ledgerXml, voucherXml, type TallyEntry, type TallyLedger, type TallyVoucher } from './tally-xml';

const LEDGER_KEY = 'tally.ledger.';
const VOUCHER_KEY = 'tally.voucher.';
const LAST_EXPORT_KEY = 'tally.lastExport';
const KIND_ORDER: Record<TallyVoucherKind, number> = { Purchase: 0, Sales: 1, Receipt: 2, Payment: 3 };
const PREVIEW_ROWS = 500;

type Num = Prisma.Decimal | number | null | undefined;
/** Rupees (in the document currency) × exchange rate -> whole paise. */
const paise = (v: Num, rate = 1) => Math.round(Number(v ?? 0) * rate * 100);
const day = (d: Date) => d.toISOString().slice(0, 10);
const rateText = (r: Num) => String(Number(r ?? 0));
const rupees = (p: number) => p / 100;
const listNames = (names: string[]) => (names.length <= 5 ? names.join(', ') : `${names.slice(0, 5).join(', ')} and ${names.length - 5} more`);
const qtyText = (q: Num) => String(Number(q ?? 0));

interface Party {
  key: string;
  ledger: string;
  record: {
    name: string;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    gstin: string | null;
    pan: string | null;
    address: string | null;
    city: string | null;
    stateCode: string | null;
    pincode: string | null;
    country: string;
  };
  group: 'Sundry Debtors' | 'Sundry Creditors';
}

interface Built {
  kind: TallyVoucherKind;
  voucher: TallyVoucher;
  row: TallyPreviewRow;
}

/**
 * Turns issued invoices, purchase orders (once goods arrived), money received and money paid
 * of one company and period into Tally vouchers, plus the ledgers they use.
 */
@Injectable()
export class TallyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ settings

  async settings(): Promise<TallySettings> {
    const rows = await this.prisma.appSetting.findMany({ where: { key: { startsWith: 'tally.' } } });
    const saved = new Map(rows.map((r) => [r.key, r.value]));
    const ledgers = { ...DEFAULT_TALLY_SETTINGS.ledgers };
    for (const l of TALLY_LEDGERS) {
      const v = saved.get(LEDGER_KEY + l.key);
      if (v !== undefined) ledgers[l.key] = v;
    }
    const voucherTypes = { ...DEFAULT_TALLY_SETTINGS.voucherTypes };
    for (const t of TALLY_VOUCHER_TYPES) {
      const v = saved.get(VOUCHER_KEY + t.key);
      if (v) voucherTypes[t.key] = v;
    }
    const parsed = tallySettingsSchema.safeParse({ ledgers, voucherTypes });
    return parsed.success ? parsed.data : DEFAULT_TALLY_SETTINGS;
  }

  async saveSettings(input: TallySettings, actor: Actor): Promise<TallySettings> {
    const before = await this.settings();
    const rows = [
      ...TALLY_LEDGERS.map((l) => ({ key: LEDGER_KEY + l.key, value: input.ledgers[l.key], label: l.label, old: before.ledgers[l.key] })),
      ...TALLY_VOUCHER_TYPES.map((t) => ({ key: VOUCHER_KEY + t.key, value: input.voucherTypes[t.key], label: `${t.label} voucher type`, old: before.voucherTypes[t.key] })),
    ];
    const changed = rows.filter((r) => r.value !== r.old);
    await this.prisma.$transaction(rows.map((r) => this.prisma.appSetting.upsert({ where: { key: r.key }, create: { key: r.key, value: r.value }, update: { value: r.value } })));
    if (changed.length) {
      await this.audit.log(actor, {
        action: AuditAction.UPDATE,
        entity: 'tally',
        summary: `Tally names: ${changed.map((c) => `${c.label} "${c.old}" → "${c.value}"`).join(', ')}`,
        changes: Object.fromEntries(changed.map((c) => [c.key, [c.old, c.value]])),
      });
    }
    return this.settings();
  }

  // ------------------------------------------------------------------ preview and files

  async preview(q: TallyExportQuery): Promise<TallyPreview> {
    const { company, built, ledgers, warnings } = await this.build(q);
    const counts: Record<TallyVoucherKind, number> = { Sales: 0, Purchase: 0, Receipt: 0, Payment: 0 };
    const totals: Record<TallyVoucherKind, number> = { Sales: 0, Purchase: 0, Receipt: 0, Payment: 0 };
    for (const b of built) {
      counts[b.kind]++;
      totals[b.kind] += b.row.amount;
    }
    for (const k of Object.keys(totals) as TallyVoucherKind[]) totals[k] = Math.round(totals[k] * 100) / 100;
    return {
      company,
      from: q.from,
      to: q.to,
      counts,
      totals,
      ledgers: ledgers.length,
      rows: built.slice(0, PREVIEW_ROWS).map((b) => b.row),
      moreRows: Math.max(0, built.length - PREVIEW_ROWS),
      warnings,
      lastExport: await this.lastExport(),
    };
  }

  /** The XML file and its name. `part`: the ledgers (import first) or the vouchers. */
  async file(part: 'ledgers' | 'vouchers', q: TallyExportQuery, user: AuthUser, actor: Actor): Promise<{ name: string; xml: string }> {
    const { company, built, ledgers } = await this.build(q);
    if (!built.length) throw new BadRequestException('There is nothing to export for this company and period');
    const code = company.code.replace(/[^\w-]+/g, '');
    const name = `tally-${part}-${code}-${q.from}-to-${q.to}.xml`;
    const words: Record<TallyVoucherKind, string> = { Sales: 'sales invoice', Purchase: 'purchase', Receipt: 'receipt', Payment: 'payment' };
    const kinds = (['Sales', 'Purchase', 'Receipt', 'Payment'] as const)
      .map((k) => [k, built.filter((b) => b.kind === k).length] as const)
      .filter(([, n]) => n)
      .map(([k, n]) => `${n} ${words[k]}${n === 1 ? '' : 's'}`)
      .join(', ');
    if (part === 'ledgers') {
      await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'tally', summary: `Downloaded the Tally ledgers file (${company.code}, ${q.from} to ${q.to}): ${ledgers.length} ledgers` });
      return { name, xml: envelope('All Masters', ledgers.map(ledgerXml)) };
    }
    const xml = envelope('Vouchers', built.map((b) => voucherXml(b.voucher)));
    const last: TallyLastExport = { at: new Date().toISOString(), by: user.name, company: company.code, from: q.from, to: q.to, vouchers: built.length };
    const value = JSON.stringify(last);
    await this.prisma.appSetting.upsert({ where: { key: LAST_EXPORT_KEY }, create: { key: LAST_EXPORT_KEY, value }, update: { value } });
    await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'tally', summary: `Exported to Tally (${company.code}, ${q.from} to ${q.to}): ${kinds}` });
    return { name, xml };
  }

  private async lastExport(): Promise<TallyLastExport | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: LAST_EXPORT_KEY } });
    try {
      return row ? (JSON.parse(row.value) as TallyLastExport) : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ building the vouchers

  private async build(q: TallyExportQuery) {
    const settings = await this.settings();
    const L = settings.ledgers;
    const VT = settings.voucherTypes;
    const company = await this.prisma.company.findUnique({ where: { id: q.companyId }, select: { id: true, code: true, name: true } });
    if (!company) throw new BadRequestException('Company not found');
    const from = new Date(`${q.from}T00:00:00Z`);
    const to = new Date(`${q.to}T00:00:00Z`);
    const inPeriod = { gte: from, lte: to };
    const warnings: string[] = [];
    const built: Built[] = [];
    const names = await this.partyNames();
    const usedCustomers = new Set<number>();
    const usedSuppliers = new Set<number>();
    /** Account ledgers used, by lower-case name (Tally ignores case): the name and the setting it came from. */
    const accounts = new Map<string, { name: string; key: TallyLedgerKey }>();
    const account = (key: TallyLedgerKey, rate?: Num) => {
      const name = L[key].replace(/\{rate\}/gi, rateText(rate));
      if (!accounts.has(name.toLowerCase())) accounts.set(name.toLowerCase(), { name, key });
      return name;
    };
    const money = (mode: PaymentMode) => account(mode === PaymentMode.CASH ? 'cash' : 'bank');

    // -------------------------------------------------------------- sales invoices
    if (q.sales) {
      const invoices = await this.prisma.invoice.findMany({
        where: { companyId: company.id, invoiceDate: inPeriod, type: { in: ['TAX_INVOICE', 'EXPORT_INVOICE'] } },
        orderBy: [{ invoiceDate: 'asc' }, { id: 'asc' }],
        include: { lines: { orderBy: { lineNo: 'asc' }, select: { description: true, quantity: true, uom: true } } },
      });
      const drafts = invoices.filter((i) => i.status === InvoiceStatus.DRAFT).map((i) => i.invoiceNo);
      const cancelled = invoices.filter((i) => i.status === InvoiceStatus.CANCELLED).map((i) => i.invoiceNo);
      if (drafts.length) warnings.push(`${drafts.length} draft invoice${drafts.length === 1 ? ' is' : 's are'} not exported (issue them first): ${listNames(drafts)}.`);
      if (cancelled.length) warnings.push(`${cancelled.length} cancelled invoice${cancelled.length === 1 ? ' is' : 's are'} left out: ${listNames(cancelled)}.`);
      for (const inv of invoices.filter((i) => i.status === InvoiceStatus.ISSUED)) {
        const fx = inv.currency === 'INR' ? 1 : Number(inv.exchangeRate) || 1;
        const total = paise(inv.grandTotal, fx);
        const cgst = paise(inv.cgstAmount, fx);
        const sgst = paise(inv.sgstAmount, fx);
        const igst = paise(inv.igstAmount, fx);
        const freight = L.salesFreight ? paise(inv.freight, fx) : 0;
        const roundOff = paise(inv.roundOff, fx);
        const taxed = inv.gstType === 'INTRA_STATE' || inv.gstType === 'INTER_STATE';
        const exportSale = inv.type === 'EXPORT_INVOICE' || inv.gstType === 'EXPORT';
        // the sales line is what is left, so the voucher always balances (also after currency rounding)
        const sales = total - cgst - sgst - igst - freight - roundOff;
        const expected = paise(inv.taxableAmount, fx) - freight;
        if (Math.abs(sales - expected) > 100) warnings.push(`Invoice ${inv.invoiceNo}: its total and its lines differ by ₹${rupees(Math.abs(sales - expected)).toFixed(2)}. Check it in Tally.`);
        const party = names.customer(inv.customerId);
        usedCustomers.add(inv.customerId);
        const entries: TallyEntry[] = [
          { ledger: party, amount: -total, isParty: true, bill: { name: inv.invoiceNo, type: 'New Ref' } },
          { ledger: exportSale ? account('exportSales') : account('sales', taxed ? inv.taxRate : 0), amount: sales },
          ...(freight ? [{ ledger: account('salesFreight'), amount: freight }] : []),
          ...(cgst ? [{ ledger: account('outputCgst'), amount: cgst }] : []),
          ...(sgst ? [{ ledger: account('outputSgst'), amount: sgst }] : []),
          ...(igst ? [{ ledger: account('outputIgst'), amount: igst }] : []),
          ...(roundOff ? [{ ledger: account('roundOff'), amount: roundOff }] : []),
        ];
        const items = inv.lines.slice(0, 3).map((l) => `${qtyText(l.quantity)} ${l.uom} ${l.description}`);
        const narration = [
          `Invoice ${inv.invoiceNo}`,
          inv.customerPoNo ? `Customer PO ${inv.customerPoNo}` : '',
          fx !== 1 ? `${inv.currency} ${Number(inv.grandTotal).toFixed(2)} @ ${fx}` : '',
          items.join('; ') + (inv.lines.length > 3 ? `; +${inv.lines.length - 3} more` : ''),
        ].filter(Boolean).join(' | ');
        built.push({
          kind: 'Sales',
          voucher: { voucherType: VT.sales, date: day(inv.invoiceDate), number: inv.invoiceNo, reference: inv.customerPoNo, party, narration: narration.slice(0, 1000), entries },
          row: { date: day(inv.invoiceDate), kind: 'Sales', number: inv.invoiceNo, party, amount: rupees(total), reference: inv.customerPoNo },
        });
      }
    }

    // -------------------------------------------------------------- purchases (one per purchase order, when goods arrived)
    const receiptsOf = {
      goodsReceipts: { orderBy: { grnDate: 'asc' as const }, select: { grnNo: true, grnDate: true, supplierInvoice: true } },
      jobWorkOrder: { select: { jwoNo: true, receipts: { orderBy: { receiptDate: 'asc' as const }, select: { receiptNo: true, receiptDate: true, vendorChallan: true } } } },
    };
    /** The day the purchase is booked: when goods first arrived; a PO marked received without receipts uses its own date. */
    const purchaseDate = (po: { status: PurchaseOrderStatus; poDate: Date; goodsReceipts: { grnDate: Date }[]; jobWorkOrder: { receipts: { receiptDate: Date }[] } | null }) => {
      const dates = [...po.goodsReceipts.map((g) => g.grnDate), ...(po.jobWorkOrder?.receipts.map((r) => r.receiptDate) ?? [])].sort((a, b) => a.getTime() - b.getTime());
      if (dates.length) return dates[0];
      return po.status === PurchaseOrderStatus.RECEIVED ? po.poDate : null;
    };

    if (q.purchases) {
      const pos = await this.prisma.purchaseOrder.findMany({
        where: {
          companyId: company.id,
          status: { in: PAYABLE_PO },
          poDate: { lte: to },
          OR: [{ poDate: { gte: from } }, { goodsReceipts: { some: { grnDate: { gte: from } } } }, { jobWorkOrder: { receipts: { some: { receiptDate: { gte: from } } } } }],
        },
        orderBy: [{ poDate: 'asc' }, { id: 'asc' }],
        include: receiptsOf,
      });
      const foreign: string[] = [];
      const waiting: string[] = [];
      for (const po of pos) {
        const date = purchaseDate(po);
        if (!date) {
          if (po.poDate >= from) waiting.push(po.poNo);
          continue;
        }
        if (date < from || date > to) continue;
        if (po.currency !== 'INR') {
          foreign.push(po.poNo);
          continue;
        }
        const total = paise(po.grandTotal);
        const tax = paise(po.taxAmount);
        const taxed = po.gstType === 'INTRA_STATE' || po.gstType === 'INTER_STATE';
        const cgst = taxed && po.gstType === 'INTRA_STATE' ? paise(Math.round((Number(po.taxAmount) / 2) * 100) / 100) : 0;
        const sgst = taxed && po.gstType === 'INTRA_STATE' ? tax - cgst : 0;
        const igst = taxed && po.gstType === 'INTER_STATE' ? tax : 0;
        const freight = L.purchaseFreight ? paise(po.freight) : 0;
        const roundOff = paise(po.roundOff);
        const goods = total - cgst - sgst - igst - freight - roundOff;
        const party = names.supplier(po.supplierId);
        usedSuppliers.add(po.supplierId);
        const bills = [...po.goodsReceipts.map((g) => g.supplierInvoice), ...(po.jobWorkOrder?.receipts.map((r) => r.vendorChallan) ?? [])].filter((b): b is string => !!b?.trim());
        const reference = [...new Set(bills)].join(', ').slice(0, 60) || null;
        const entries: TallyEntry[] = [
          { ledger: party, amount: total, isParty: true, bill: { name: po.poNo, type: 'New Ref' } },
          { ledger: po.type === 'JOB_WORK' ? account('jobWork', taxed ? po.taxRate : 0) : account('purchase', taxed ? po.taxRate : 0), amount: -goods },
          ...(freight ? [{ ledger: account('purchaseFreight'), amount: -freight }] : []),
          ...(cgst ? [{ ledger: account('inputCgst'), amount: -cgst }] : []),
          ...(sgst ? [{ ledger: account('inputSgst'), amount: -sgst }] : []),
          ...(igst ? [{ ledger: account('inputIgst'), amount: -igst }] : []),
          ...(roundOff ? [{ ledger: account('roundOff'), amount: -roundOff }] : []),
        ];
        const arrived = [...po.goodsReceipts.map((g) => g.grnNo), ...(po.jobWorkOrder?.receipts.map((r) => r.receiptNo) ?? [])];
        const narration = [
          `PO ${po.poNo} of ${day(po.poDate)}`,
          bills.length ? `Supplier bill ${[...new Set(bills)].join(', ')}` : '',
          arrived.length ? `Received ${arrived.join(', ')}` : '',
          po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED ? 'Not all goods received yet (full PO value)' : '',
        ].filter(Boolean).join(' | ');
        built.push({
          kind: 'Purchase',
          voucher: { voucherType: VT.purchase, date: day(date), number: po.poNo, reference, party, narration: narration.slice(0, 1000), entries },
          row: { date: day(date), kind: 'Purchase', number: po.poNo, party, amount: rupees(total), reference },
        });
      }
      if (waiting.length) warnings.push(`${waiting.length} purchase order${waiting.length === 1 ? ' has' : 's have'} no goods received yet, so ${waiting.length === 1 ? 'it is' : 'they are'} not a purchase yet: ${listNames(waiting)}.`);
      if (foreign.length) warnings.push(`Purchase orders in a foreign currency are left out (enter them in Tally by hand): ${listNames(foreign)}.`);
    }

    // -------------------------------------------------------------- money received
    if (q.receipts) {
      const rows = await this.prisma.payment.findMany({
        where: { direction: PaymentDirection.RECEIPT, paymentDate: inPeriod, invoice: { companyId: company.id } },
        orderBy: [{ paymentDate: 'asc' }, { id: 'asc' }],
        include: { invoice: { select: { invoiceNo: true, currency: true, exchangeRate: true, customerId: true } } },
      });
      const cancelled = rows.filter((p) => p.cancelledAt).length;
      if (cancelled) warnings.push(`${cancelled} cancelled receipt${cancelled === 1 ? ' is' : 's are'} left out.`);
      for (const p of rows.filter((r) => !r.cancelledAt && r.invoice)) {
        const inv = p.invoice!;
        const fx = inv.currency === 'INR' ? 1 : Number(inv.exchangeRate) || 1;
        const amount = paise(p.amount, fx);
        const customerId = p.customerId ?? inv.customerId;
        const party = names.customer(customerId);
        usedCustomers.add(customerId);
        const narration = [`Receipt ${p.paymentNo}`, `Invoice ${inv.invoiceNo}`, modeText(p.mode, p.reference), fx !== 1 ? `${inv.currency} ${Number(p.amount).toFixed(2)} @ ${fx}` : '', p.remarks ?? ''].filter(Boolean).join(' | ');
        built.push({
          kind: 'Receipt',
          voucher: {
            voucherType: VT.receipt,
            date: day(p.paymentDate),
            number: p.paymentNo,
            reference: p.reference,
            party,
            narration: narration.slice(0, 1000),
            entries: [
              { ledger: money(p.mode), amount: -amount },
              { ledger: party, amount, isParty: true, bill: { name: inv.invoiceNo, type: 'Agst Ref' } },
            ],
          },
          row: { date: day(p.paymentDate), kind: 'Receipt', number: p.paymentNo, party, amount: rupees(amount), reference: inv.invoiceNo },
        });
      }
    }

    // -------------------------------------------------------------- money paid
    if (q.payments) {
      const rows = await this.prisma.payment.findMany({
        where: { direction: PaymentDirection.PAYMENT, paymentDate: inPeriod, purchaseOrder: { companyId: company.id } },
        orderBy: [{ paymentDate: 'asc' }, { id: 'asc' }],
        include: { purchaseOrder: { select: { poNo: true, poDate: true, status: true, currency: true, supplierId: true, ...receiptsOf } } },
      });
      const cancelled = rows.filter((p) => p.cancelledAt).length;
      if (cancelled) warnings.push(`${cancelled} cancelled payment${cancelled === 1 ? ' is' : 's are'} left out.`);
      const foreign: string[] = [];
      for (const p of rows.filter((r) => !r.cancelledAt && r.purchaseOrder)) {
        const po = p.purchaseOrder!;
        if (po.currency !== 'INR') {
          foreign.push(p.paymentNo);
          continue;
        }
        const amount = paise(p.amount);
        const supplierId = p.supplierId ?? po.supplierId;
        const party = names.supplier(supplierId);
        usedSuppliers.add(supplierId);
        const booked = purchaseDate(po);
        // paid before the purchase is booked = an advance against that PO
        const billType = booked && day(booked) <= day(p.paymentDate) ? 'Agst Ref' : 'Advance';
        const narration = [`Payment ${p.paymentNo}`, `PO ${po.poNo}`, billType === 'Advance' ? 'Advance' : '', modeText(p.mode, p.reference), p.remarks ?? ''].filter(Boolean).join(' | ');
        built.push({
          kind: 'Payment',
          voucher: {
            voucherType: VT.payment,
            date: day(p.paymentDate),
            number: p.paymentNo,
            reference: p.reference,
            party,
            narration: narration.slice(0, 1000),
            entries: [
              { ledger: party, amount: -amount, isParty: true, bill: { name: po.poNo, type: billType } },
              { ledger: money(p.mode), amount },
            ],
          },
          row: { date: day(p.paymentDate), kind: 'Payment', number: p.paymentNo, party, amount: rupees(amount), reference: po.poNo },
        });
      }
      if (foreign.length) warnings.push(`Payments on foreign-currency purchase orders are left out: ${listNames(foreign)}.`);
    }

    built.sort((a, b) => a.voucher.date.localeCompare(b.voucher.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.voucher.number.localeCompare(b.voucher.number));

    // -------------------------------------------------------------- ledgers used
    const parties = await this.parties(usedCustomers, usedSuppliers, names);
    const noState = parties.filter((p) => isIndia(p.record.country) && !stateOf(p.record.stateCode, p.record.gstin)).map((p) => p.ledger);
    if (noState.length) warnings.push(`No state is set for ${listNames(noState)}. Add it in the customer / supplier master so Tally gets GST right.`);
    const byKey = new Map<string, (typeof TALLY_LEDGERS)[number]>(TALLY_LEDGERS.map((l) => [l.key, l]));
    const accountLedgers = [...accounts.values()]
      .map(({ name, key }): TallyLedger => {
        const def = byKey.get(key)!;
        return { name, parent: def.group, ...('dutyHead' in def ? { gstDutyHead: def.dutyHead } : {}) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const ledgers: TallyLedger[] = [...accountLedgers, ...parties.map(partyLedger)];
    return { company, built, ledgers, warnings };
  }

  // ------------------------------------------------------------------ party ledgers

  /**
   * Tally ledger names must be unique (and ignore upper / lower case). A name used by two customers
   * gets the customer code added; a supplier with a customer's name gets " (Supplier)".
   * Worked out over all parties, so a party always gets the same name in every export.
   */
  private async partyNames() {
    const [customers, suppliers] = await Promise.all([
      this.prisma.customer.findMany({ select: { id: true, code: true, name: true } }),
      this.prisma.supplier.findMany({ select: { id: true, code: true, name: true } }),
    ]);
    const key = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    const count = (rows: { name: string }[]) => rows.reduce((m, r) => m.set(key(r.name), (m.get(key(r.name)) ?? 0) + 1), new Map<string, number>());
    const customerCount = count(customers);
    const supplierCount = count(suppliers);
    const customerName = new Map(customers.map((c) => [c.id, customerCount.get(key(c.name))! > 1 ? `${c.name.trim()} (${c.code})` : c.name.trim()]));
    const supplierName = new Map(
      suppliers.map((s) => {
        let name = s.name.trim();
        if (supplierCount.get(key(s.name))! > 1) name = `${name} (${s.code})`;
        if (customerCount.has(key(s.name))) name = `${name} (Supplier)`;
        return [s.id, name];
      }),
    );
    return {
      customer: (id: number) => customerName.get(id) ?? `Customer ${id}`,
      supplier: (id: number) => supplierName.get(id) ?? `Supplier ${id}`,
    };
  }

  private async parties(customerIds: Set<number>, supplierIds: Set<number>, names: Awaited<ReturnType<TallyService['partyNames']>>): Promise<Party[]> {
    const select = { id: true, name: true, contactPerson: true, phone: true, email: true, gstin: true, pan: true, address: true, city: true, stateCode: true, pincode: true, country: true };
    const [customers, suppliers] = await Promise.all([
      customerIds.size ? this.prisma.customer.findMany({ where: { id: { in: [...customerIds] } }, select }) : [],
      supplierIds.size ? this.prisma.supplier.findMany({ where: { id: { in: [...supplierIds] } }, select }) : [],
    ]);
    return [
      ...customers.map((c): Party => ({ key: `c${c.id}`, ledger: names.customer(c.id), record: c, group: 'Sundry Debtors' })),
      ...suppliers.map((s): Party => ({ key: `s${s.id}`, ledger: names.supplier(s.id), record: s, group: 'Sundry Creditors' })),
    ].sort((a, b) => a.ledger.localeCompare(b.ledger));
  }
}

const isIndia = (country: string | null) => !country || /^\s*india\s*$/i.test(country);
const stateOf = (code: string | null, gstin: string | null) => INDIAN_STATES.find((s) => s.code === (code || gstin?.slice(0, 2)))?.name ?? null;

function partyLedger(p: Party): TallyLedger {
  const r = p.record;
  const india = isIndia(r.country);
  const address = (r.address ?? '')
    .split(/\r?\n/)
    .map((a) => a.trim())
    .filter(Boolean);
  if (r.city && !address.some((a) => a.toLowerCase().includes(r.city!.toLowerCase()))) address.push(r.city);
  return {
    name: p.ledger,
    parent: p.group,
    billWise: true,
    mailingName: r.name,
    address,
    state: india ? stateOf(r.stateCode, r.gstin) : 'Not Applicable',
    country: india ? 'India' : r.country,
    pincode: r.pincode,
    gstRegistrationType: india ? (r.gstin ? 'Regular' : 'Unregistered') : null,
    gstin: r.gstin,
    pan: r.pan,
    email: r.email,
    phone: r.phone,
    contact: r.contactPerson,
  };
}

function modeText(mode: PaymentMode, reference: string | null) {
  const label = { CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', UPI: 'UPI', CHEQUE: 'Cheque', OTHER: 'Other' }[mode];
  return reference ? `${label} ${reference}` : label;
}
