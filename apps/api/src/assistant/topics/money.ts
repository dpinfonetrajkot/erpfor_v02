import { INVOICE_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@bht/shared';
import { PaymentDirection } from '../../generated/prisma/client';
import { addDays, has, monthLabel, monthPeriod, type Period } from '../language';
import { change } from './briefing';
import { day, docKind, docNumbers, dueIn, during, endsWithNumber, num, periodParams, plural, R, rupees, table, type Ask, type Reply, type Topic } from '../kit';
import { brand } from '../../config/brand';

const TO_SUPPLIERS = ['we owe', 'payable', 'payables', 'to pay', 'pay to', 'supplier payment', 'vendor payment', 'pay suppliers', 'pay vendors'];

/** Money still owed, by party or for one party (invoices / POs with days late). */
async function owed(ask: Ask, direction: PaymentDirection): Promise<Reply> {
  const toUs = direction === PaymentDirection.RECEIPT;
  const parties = toUs ? ask.found.customers : ask.found.suppliers;
  const partyIds = ask.ids(parties, toUs ? 'customerId' : 'supplierId');
  const all = await ask.deps.payments.outstanding(direction);
  const rows = partyIds.length ? all.filter((r) => partyIds.includes(r.party.id)) : all;
  const inr = (r: (typeof rows)[number]) => r.balance * (r.exchangeRate || 1);
  const total = rows.reduce((s, r) => s + inr(r), 0);
  const overdue = rows.filter((r) => r.overdueDays > 0).reduce((s, r) => s + inr(r), 0);
  const link = { label: toUs ? 'Customers owe us' : 'We owe suppliers', href: `/billing/payments?tab=${toUs ? 'owed' : 'owe'}` };
  const params = partyIds.length === 1 ? { [toUs ? 'customerId' : 'supplierId']: partyIds[0] } : {};
  if (partyIds.length === 1) {
    const where = { where: { id: partyIds[0] }, select: { name: true } };
    const name = rows[0]?.party.name ?? parties[0]?.name ?? (await (toUs ? ask.prisma.customer.findUnique(where) : ask.prisma.supplier.findUnique(where)))?.name;
    if (!rows.length) return { understood: `${toUs ? 'To receive from' : 'To pay'} ${name}`, text: toUs ? `${name} owes us nothing - every issued invoice is paid.` : `We owe ${name} nothing.`, links: [link], params };
    return {
      understood: `${toUs ? 'To receive from' : 'To pay'} ${name}`,
      text: toUs
        ? `${name} owes us ${rupees(total)} on ${plural(rows.length, 'invoice')}${overdue ? `, ${rupees(overdue)} of it overdue` : ''}.`
        : `We owe ${name} ${rupees(total)} on ${plural(rows.length, 'purchase order')}${overdue ? `, ${rupees(overdue)} of it past the payment terms` : ''}.`,
      table: table([toUs ? 'Invoice' : 'PO', 'Date', 'Due', R('Balance')], rows.map((r) => [r.number, day(r.date), r.dueDate ? `${day(r.dueDate)}${r.overdueDays ? ` (${plural(r.overdueDays, 'day')} late)` : ''}` : '—', rupees(inr(r))])),
      links: [link],
      params,
    };
  }
  const byParty = new Map<string, { docs: number; balance: number; overdue: number }>();
  for (const r of rows) {
    const x = byParty.get(r.party.name) ?? { docs: 0, balance: 0, overdue: 0 };
    x.docs++;
    x.balance += inr(r);
    if (r.overdueDays > 0) x.overdue += inr(r);
    byParty.set(r.party.name, x);
  }
  return {
    understood: toUs ? 'Money customers owe us' : 'Money we owe suppliers',
    text: rows.length
      ? `${toUs ? 'Customers owe us' : 'We owe suppliers'} ${rupees(total)} on ${plural(rows.length, toUs ? 'invoice' : 'purchase order')}; ${overdue ? `${rupees(overdue)} is overdue` : 'none is overdue'}. Biggest first:`
      : toUs ? 'Nothing is outstanding - every issued invoice is paid.' : 'Nothing is outstanding to suppliers.',
    ...(rows.length
      ? {
          table: table([toUs ? 'Customer' : 'Supplier', R(toUs ? 'Invoices' : 'POs'), R('Balance'), R('Overdue')], [...byParty.entries()].sort((a, b) => b[1].balance - a[1].balance).map(([n, x]) => [n, String(x.docs), rupees(x.balance), x.overdue ? rupees(x.overdue) : '—'])),
          ...(byParty.size > 1
            ? {
                chart: {
                  kind: 'bars' as const,
                  title: toUs ? 'Balance by customer' : 'Balance by supplier',
                  unit: 'money' as const,
                  series: ['Balance'],
                  points: [...byParty.entries()].sort((a, b) => b[1].balance - a[1].balance).slice(0, 6).map(([n, x]) => ({ label: n, values: [Math.round(x.balance)] })),
                },
              }
            : {}),
        }
      : {}),
    links: [link, ...(ask.can('business_reports.view') ? [{ label: 'Ageing report', href: `/reports/ageing${toUs ? '' : '?direction=PAYMENT'}` }] : [])],
  };
}

/** The same length of time just before: last month (to the same day when this month is not over), the day before, ... */
function previousPeriod(p: Period): { from: string; to: string; label: string } {
  if (p.month) {
    const [y, m] = p.month.split('-').map(Number);
    const pm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const full = monthPeriod(pm, '9999-12-31');
    const cut = Number(p.to.slice(8, 10));
    const monthEnd = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (cut < monthEnd) {
      const lastOfPrev = Number(full.to.slice(8, 10));
      return { from: full.from, to: `${pm}-${String(Math.min(cut, lastOfPrev)).padStart(2, '0')}`, label: `in the same days of ${monthLabel(pm)}` };
    }
    return { from: full.from, to: full.to, label: `in ${monthLabel(pm)}` };
  }
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
  const to = addDays(p.from, -1);
  return { from: addDays(to, -(days - 1)), to, label: days === 1 ? 'the day before' : `in the ${days} days before` };
}

export const moneyTopics: Topic[] = [
  {
    id: 'sales_total',
    area: 'Money',
    label: 'sales reports',
    permissions: ['business_reports.view'],
    examples: ['Sales this month', 'Sales of Alpha this year', 'Sales in September'],
    score: (p, f) => (has(p, 'sales', 'sale', 'sold', 'turnover', 'revenue', 'billing', 'billed', 'invoiced', 'business done') && !has(p, 'so') ? 6 + (p.period ? 1 : 0) + (f.customers.length ? 1 : 0) : 0),
    async answer(ask) {
      const period = ask.period(monthPeriod(ask.today.slice(0, 7), ask.today));
      const customerIds = ask.ids(ask.found.customers, 'customerId');
      const customerId = customerIds.length === 1 ? customerIds[0] : undefined;
      const r = await ask.deps.business.sales({ from: period.from, to: period.to, customerId, view: 'customer' });
      if (r.view !== 'customer') throw new Error('unexpected sales view');
      const t = r.totals;
      const who = customerId ? (r.rows[0]?.customer.name ?? (await ask.prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } }))?.name) : null;
      // the same stretch of time just before, for "12% more than last month"
      const prev = previousPeriod(period);
      const before = await ask.deps.business.sales({ from: prev.from, to: prev.to, customerId, view: 'customer' });
      const prevTotal = before.view === 'customer' ? before.totals.total : 0;
      const pct = change(t.total, prevTotal);
      const insight = t.invoices || prevTotal
        ? pct
          ? pct === '+0%'
            ? `About the same as ${prev.label} (${rupees(prevTotal)}).`
            : `That is ${pct.startsWith('+') ? `${pct.slice(1)} more` : `${pct.slice(1)} less`} than ${prev.label} (${rupees(prevTotal)}).`
          : prevTotal === 0 ? `There were no sales ${prev.label}, so there is nothing to compare with.` : undefined
        : undefined;
      // a chart: month by month when the period covers more than one month, else by customer
      let chart: Reply['chart'];
      if (period.from.slice(0, 7) !== period.to.slice(0, 7)) {
        const m = await ask.deps.business.sales({ from: period.from, to: period.to, customerId, view: 'month' });
        if (m.view === 'month' && m.rows.some((x) => x.total || x.received))
          chart = { kind: 'columns', title: `Sales and money received per month${who ? ` · ${who}` : ''}`, unit: 'money', series: ['Sales', 'Received'], points: m.rows.map((x) => ({ label: monthLabel(x.month), values: [x.total, x.received] })) };
      } else if (!who && r.rows.length > 1) {
        chart = { kind: 'bars', title: `Sales by customer · ${period.label}`, unit: 'money', series: ['Sales'], points: r.rows.slice(0, 6).map((x) => ({ label: x.customer.name, values: [x.total] })) };
      }
      return {
        ...(insight ? { insight } : {}),
        ...(chart ? { chart } : {}),
        understood: `Sales · ${period.label}${who ? ` · ${who}` : ''}`,
        text: t.invoices
          ? `Sales ${who ? `to ${who} ` : ''}${during(period)}: ${rupees(t.total)} on ${plural(t.invoices, 'invoice')} (${rupees(t.taxable)} before GST).`
          : `No invoice ${who ? `to ${who} ` : ''}was issued ${during(period)}.`,
        ...(t.invoices
          ? {
              facts: [
                { label: 'Taxable value', value: rupees(t.taxable) },
                { label: 'GST', value: rupees(t.gst) },
                { label: 'Invoice total', value: rupees(t.total) },
                { label: 'Received so far', value: rupees(t.paid) },
              ],
              ...(!who && r.rows.length > 1 ? { table: table(['Customer', R('Invoices'), R('Total')], r.rows.map((x) => [x.customer.name, String(x.invoices), rupees(x.total)]), 8) } : {}),
            }
          : {}),
        links: [{ label: 'Sales report', href: `/reports/sales?from=${period.from}&to=${period.to}${customerId ? `&customerId=${customerId}` : ''}` }],
        params: { ...periodParams(period), ...(customerId ? { customerId } : {}) },
      };
    },
  },

  {
    id: 'receivable',
    area: 'Money',
    label: 'payments',
    permissions: ['payments.view'],
    examples: ['Who owes us money?', 'Overdue invoices', 'Outstanding of Alpha'],
    score: (p, f) =>
      has(p, ...TO_SUPPLIERS, 'loan', 'loans', 'advance', 'emi', 'salary') || (f.suppliers.length && !f.customers.length)
        ? 0
        : has(p, 'owe us', 'owes us', 'owe', 'outstanding', 'receivable', 'receivables', 'to receive', 'to collect', 'collection', 'due from', 'overdue invoice', 'overdue invoices', 'unpaid', 'not paid', 'payment pending', 'pending payment', 'balance due', 'dues')
          ? 7 + (f.customers.length ? 1 : 0)
          : 0,
    answer: (ask) => owed(ask, PaymentDirection.RECEIPT),
  },

  {
    id: 'payable',
    area: 'Money',
    label: 'payments',
    permissions: ['payments.view'],
    examples: ['How much do we owe suppliers?'],
    score: (p, f) =>
      has(p, ...TO_SUPPLIERS) || (f.suppliers.length && has(p, 'owe', 'due', 'outstanding', 'pending payment', 'payment', 'unpaid', 'balance')) ? 7 + (f.suppliers.length ? 1 : 0) : 0,
    answer: (ask) => owed(ask, PaymentDirection.PAYMENT),
  },

  {
    id: 'invoice_status',
    area: 'Money',
    label: 'invoices',
    permissions: ['invoices.view'],
    examples: [`Status of invoice ${brand().short}/26-27/001`, 'Is invoice 1 paid?'],
    score: (p) => (p.docs.some((d) => docKind(d) === 'INVOICE') || p.shortDocs.some((s) => s.kind === 'INVOICE') ? (has(p, 'trace', 'heat', 'heats') ? 5 : 9) : 0),
    async answer(ask) {
      const numbers = await docNumbers(ask, 'INVOICE', async (n) =>
        endsWithNumber(n)((await ask.prisma.invoice.findMany({ where: { invoiceNo: { endsWith: String(n) }, status: { not: 'DRAFT' } }, orderBy: { id: 'desc' }, take: 50, select: { invoiceNo: true } })).map((x) => x.invoiceNo)),
      );
      const inv = numbers.length
        ? await ask.prisma.invoice.findFirst({
            where: { invoiceNo: { in: numbers } },
            select: {
              id: true, invoiceNo: true, invoiceDate: true, dueDate: true, status: true, paymentStatus: true, currency: true, grandTotal: true, amountPaid: true,
              customer: { select: { name: true } }, dispatches: { where: { cancelledAt: null }, select: { dispatchNo: true, dispatchDate: true } },
            },
          })
        : null;
      if (!inv) return { text: 'I could not find that invoice number.', links: [{ label: 'Invoices', href: '/billing/invoices' }] };
      const money = (v: number) => (inv.currency === 'INR' ? rupees(v) : `${inv.currency} ${v.toFixed(2)}`);
      const balance = num(inv.grandTotal) - num(inv.amountPaid);
      return {
        understood: `Invoice ${inv.invoiceNo}`,
        text:
          `${inv.invoiceNo} of ${day(inv.invoiceDate)} to ${inv.customer.name}: ${INVOICE_STATUS_LABELS[inv.status]}, ${PAYMENT_STATUS_LABELS[inv.paymentStatus].toLowerCase()}` +
          `${inv.status === 'ISSUED' && balance > 0 && inv.dueDate ? `, payment due ${day(inv.dueDate)} (${dueIn(inv.dueDate, ask.today)})` : ''}.` +
          (inv.dispatches.length ? ` Dispatched on ${inv.dispatches.map((d) => `${day(d.dispatchDate)} (${d.dispatchNo})`).join(', ')}.` : inv.status === 'ISSUED' ? ' Not dispatched yet.' : ''),
        facts: [
          { label: 'Invoice total', value: money(num(inv.grandTotal)) },
          { label: 'Received', value: money(num(inv.amountPaid)) },
          { label: 'Balance', value: money(balance), ...(balance > 0 && inv.dueDate && dueIn(inv.dueDate, ask.today).endsWith('late') ? { tone: 'bad' as const } : {}) },
        ],
        links: [{ label: `Open ${inv.invoiceNo}`, href: `/billing/invoices/${inv.id}` }],
      };
    },
  },
];
