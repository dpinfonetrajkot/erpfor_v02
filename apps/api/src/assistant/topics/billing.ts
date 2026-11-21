import { INVOICE_STATUS_LABELS, PAYMENT_MODE_LABELS, PAYMENT_STATUS_LABELS } from '@bht/shared';
import type { Prisma } from '../../generated/prisma/client';
import { financialYear, has, monthPeriod } from '../language';
import { day, during, num, periodParams, plural, R, rupees, table, type Topic } from '../kit';

const dateOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const NOT_LIST = ['overdue', 'unpaid', 'outstanding', 'due', 'owe', 'owes', 'not paid', 'pending payment', 'trace'];
const LIST_WORDS = ['list', 'show', 'all', 'draft', 'drafts', 'last', 'latest', 'recent', 'biggest', 'largest', 'highest', 'made', 'issued', 'raised', 'which', 'how many'];

export const billingTopics: Topic[] = [
  {
    id: 'invoice_list',
    area: 'Money',
    label: 'invoices',
    permissions: ['invoices.view'],
    examples: ['Invoices this month', 'Draft invoices', 'Biggest invoices this year'],
    score: (p, f) =>
      has(p, 'invoice', 'invoices', 'bills') && !p.docs.length && !p.shortDocs.length && !has(p, ...NOT_LIST) && (p.period || f.customers.length || has(p, ...LIST_WORDS)) ? 7 : 0,
    async answer(ask) {
      const drafts = has(ask.p, 'draft', 'drafts');
      const biggest = has(ask.p, 'biggest', 'largest', 'highest', 'top');
      const latest = !ask.p.period && has(ask.p, 'last', 'latest', 'recent');
      const period = ask.period(biggest ? (() => { const fy = financialYear(ask.today); return { from: fy.from, to: ask.today, label: `FY ${fy.label} so far` }; })() : monthPeriod(ask.today.slice(0, 7), ask.today));
      const customerIds = ask.ids(ask.found.customers, 'customerId');
      const where: Prisma.InvoiceWhereInput = {
        ...(drafts ? { status: 'DRAFT' } : { status: { not: 'DRAFT' } }),
        ...(latest || drafts ? {} : { invoiceDate: { gte: dateOf(period.from), lte: dateOf(period.to) } }),
        ...(customerIds.length ? { customerId: { in: customerIds } } : {}),
      };
      const rows = await ask.prisma.invoice.findMany({
        where,
        orderBy: biggest ? { grandTotal: 'desc' } : [{ invoiceDate: 'desc' }, { id: 'desc' }],
        take: latest ? 10 : 200,
        select: { id: true, invoiceNo: true, invoiceDate: true, status: true, paymentStatus: true, grandTotal: true, exchangeRate: true, currency: true, billingName: true },
      });
      const live = rows.filter((r) => r.status !== 'CANCELLED');
      const inr = (r: (typeof rows)[number]) => num(r.grandTotal) * (num(r.exchangeRate) || 1);
      const total = live.reduce((s, r) => s + inr(r), 0);
      const unpaid = live.filter((r) => r.status === 'ISSUED' && r.paymentStatus !== 'PAID').length;
      const who = customerIds.length === 1 ? ask.found.customers[0]?.name : null;
      const what = drafts ? 'draft invoice' : 'invoice';
      const when = latest || drafts ? '' : ` ${during(period)}`;
      return {
        understood: `${drafts ? 'Draft invoices' : biggest ? 'Biggest invoices' : latest ? 'Latest invoices' : 'Invoices'}${who ? ` · ${who}` : ''}${when ? ` · ${period.label}` : ''}`,
        text: rows.length
          ? `${plural(live.length, what)}${who ? ` to ${who}` : ''}${when}, worth ${rupees(total)}${!drafts && unpaid ? `; ${plural(unpaid, 'is', 'are')} not fully paid yet` : ''}.`
          : `No ${what}${who ? ` to ${who}` : ''}${when}.`,
        ...(rows.length
          ? {
              table: table(
                ['Invoice', 'Date', 'Customer', R('Total'), 'Status'],
                rows.map((r) => [
                  r.status === 'DRAFT' ? 'Draft' : r.invoiceNo,
                  day(r.invoiceDate),
                  r.billingName,
                  r.currency === 'INR' ? rupees(num(r.grandTotal)) : `${r.currency} ${num(r.grandTotal).toFixed(2)}`,
                  r.status === 'ISSUED' ? PAYMENT_STATUS_LABELS[r.paymentStatus] : INVOICE_STATUS_LABELS[r.status],
                ]),
                10,
              ),
            }
          : {}),
        links: [{ label: drafts ? 'Draft invoices' : 'Invoices', href: `/billing/invoices${drafts ? '?status=DRAFT' : ''}` }],
        ...(drafts && rows.length ? { insight: 'Drafts get their invoice number only when they are issued.' } : {}),
        params: { ...periodParams(period), ...(customerIds.length === 1 ? { customerId: customerIds[0] } : {}) },
      };
    },
  },

  {
    id: 'payments_list',
    area: 'Money',
    label: 'payments',
    permissions: ['payments.view'],
    examples: ['Payments received this month', 'Payments made to suppliers this month'],
    score: (p) =>
      has(p, 'received', 'receipt', 'receipts', 'who paid', 'paid us', 'came in', 'collected', 'payment came', 'money came', 'payments made', 'payment made', 'we paid', 'paid to', 'paid suppliers', 'paid supplier') &&
      !has(p, 'owe', 'outstanding', 'pending', 'unpaid', 'not paid', 'due', 'invoice', 'grn', 'material', 'goods')
        ? 7
        : 0,
    async answer(ask) {
      const out = has(ask.p, 'payments made', 'payment made', 'we paid', 'paid to', 'paid suppliers', 'paid supplier', 'supplier', 'suppliers', 'vendor', 'vendors');
      const period = ask.period(monthPeriod(ask.today.slice(0, 7), ask.today));
      const partyIds = ask.ids(out ? ask.found.suppliers : ask.found.customers, out ? 'supplierId' : 'customerId');
      const rows = await ask.prisma.payment.findMany({
        where: {
          direction: out ? 'PAYMENT' : 'RECEIPT',
          cancelledAt: null,
          paymentDate: { gte: dateOf(period.from), lte: dateOf(period.to) },
          ...(partyIds.length ? (out ? { supplierId: { in: partyIds } } : { customerId: { in: partyIds } }) : {}),
        },
        orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
        select: {
          paymentNo: true, paymentDate: true, amount: true, mode: true, reference: true,
          customer: { select: { name: true } }, supplier: { select: { name: true } },
          invoice: { select: { invoiceNo: true, exchangeRate: true } }, purchaseOrder: { select: { poNo: true } },
        },
      });
      const inr = (r: (typeof rows)[number]) => num(r.amount) * (num(r.invoice?.exchangeRate) || 1);
      const total = rows.reduce((s, r) => s + inr(r), 0);
      const byParty = new Map<string, number>();
      for (const r of rows) {
        const name = (out ? r.supplier?.name : r.customer?.name) ?? '—';
        byParty.set(name, (byParty.get(name) ?? 0) + inr(r));
      }
      const top = [...byParty.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        understood: `${out ? 'Payments made' : 'Payments received'} · ${period.label}`,
        text: rows.length
          ? `${out ? 'We paid' : 'We received'} ${rupees(total)} ${during(period)} in ${plural(rows.length, 'payment')}.`
          : `No payment was ${out ? 'made' : 'received'} ${during(period)}.`,
        ...(rows.length
          ? {
              table: table(
                ['Date', out ? 'Supplier' : 'Customer', out ? 'PO' : 'Invoice', 'Mode', R('Amount')],
                rows.map((r) => [day(r.paymentDate), (out ? r.supplier?.name : r.customer?.name) ?? '—', (out ? r.purchaseOrder?.poNo : r.invoice?.invoiceNo) ?? '—', PAYMENT_MODE_LABELS[r.mode], rupees(inr(r))]),
                10,
              ),
            }
          : {}),
        ...(top && byParty.size > 1 ? { insight: `Biggest: ${top[0]} (${rupees(top[1])}).` } : {}),
        links: [{ label: 'Payments', href: `/billing/payments${out ? '?tab=owe' : ''}` }],
        params: periodParams(period),
      };
    },
  },

  {
    id: 'dispatch_list',
    area: 'Sales',
    label: 'dispatches',
    permissions: ['dispatches.view'],
    examples: ['What was dispatched today?', 'Dispatches this week'],
    score: (p) =>
      has(p, 'dispatch', 'dispatched', 'dispatches', 'shipped', 'shipment', 'shipments', 'sent out', 'truck', 'trucks', 'lr') &&
      !p.docs.length &&
      !has(p, 'pending', 'to dispatch', 'not dispatched', 'late', 'how to', 'how do i', 'backlog', 'overdue')
        ? 7
        : 0,
    async answer(ask) {
      const period = ask.period({ from: ask.today, to: ask.today, label: 'today' });
      const customerIds = ask.ids(ask.found.customers, 'customerId');
      const rows = await ask.prisma.dispatch.findMany({
        where: {
          cancelledAt: null,
          dispatchDate: { gte: dateOf(period.from), lte: dateOf(period.to) },
          ...(customerIds.length ? { salesOrder: { customerId: { in: customerIds } } } : {}),
        },
        orderBy: [{ dispatchDate: 'desc' }, { id: 'desc' }],
        select: { dispatchNo: true, dispatchDate: true, transporter: true, lrNo: true, vehicleNo: true, salesOrder: { select: { soNo: true, customer: { select: { name: true } } } }, invoice: { select: { invoiceNo: true } } },
      });
      let insight: string | undefined;
      if (!rows.length) {
        const last = await ask.prisma.dispatch.findFirst({ where: { cancelledAt: null }, orderBy: [{ dispatchDate: 'desc' }, { id: 'desc' }], select: { dispatchNo: true, dispatchDate: true, salesOrder: { select: { customer: { select: { name: true } } } } } });
        if (last) insight = `The last dispatch was ${last.dispatchNo} on ${day(last.dispatchDate)} to ${last.salesOrder.customer.name}.`;
      }
      return {
        understood: `Dispatches · ${period.label}`,
        text: rows.length ? `${plural(rows.length, 'dispatch', 'dispatches')} ${during(period)}:` : `Nothing was dispatched ${during(period)}.`,
        ...(rows.length
          ? { table: table(['Dispatch', 'Date', 'Customer', 'Invoice', 'Transport'], rows.map((r) => [r.dispatchNo, day(r.dispatchDate), r.salesOrder.customer.name, r.invoice?.invoiceNo ?? '—', [r.transporter, r.lrNo && `LR ${r.lrNo}`, r.vehicleNo].filter(Boolean).join(' · ') || '—'])) }
          : {}),
        ...(insight ? { insight } : {}),
        links: [{ label: 'Dispatches', href: '/dispatch/dispatches' }],
        suggestions: ask.can('reports.view') ? ['Pending orders', 'Which orders are late?'] : [],
        params: periodParams(period),
      };
    },
  },

  {
    id: 'top',
    area: 'Money',
    label: 'sales reports',
    permissions: ['business_reports.view'],
    examples: ['Top customers this year', 'Best selling products this year', 'Top suppliers this year'],
    score: (p) =>
      has(p, 'top', 'best', 'biggest', 'highest', 'most', 'largest', 'leading', 'major', 'main') &&
      has(p, 'customer', 'customers', 'client', 'clients', 'buyer', 'buyers', 'product', 'products', 'item', 'items', 'selling', 'sold', 'supplier', 'suppliers', 'vendor', 'vendors')
        ? 8
        : 0,
    async answer(ask) {
      const fy = financialYear(ask.today);
      const period = ask.period({ from: fy.from, to: ask.today, label: `FY ${fy.label} so far` });
      const n = Math.min(15, Number(ask.p.numbers.find((x) => Number(x) > 0 && Number(x) <= 50) ?? 5));
      if (has(ask.p, 'supplier', 'suppliers', 'vendor', 'vendors')) {
        const r = await ask.deps.business.purchases({ from: period.from, to: period.to, view: 'supplier' });
        const rows = r.view === 'supplier' ? r.rows : [];
        return {
          understood: `Top suppliers · ${period.label}`,
          text: rows.length ? `Our biggest suppliers ${during(period)} by purchase order value:` : `No purchase order ${during(period)}.`,
          ...(rows.length
            ? {
                table: table(['Supplier', R('POs'), R('Value')], rows.slice(0, n).map((x) => [x.supplier.name, String(x.orders), rupees(x.total)]), n),
                chart: { kind: 'bars' as const, title: `Top suppliers · ${period.label}`, unit: 'money' as const, series: ['Purchases'], points: rows.slice(0, Math.min(n, 8)).map((x) => ({ label: x.supplier.name, values: [x.total] })) },
              }
            : {}),
          links: [{ label: 'Purchases report', href: `/reports/purchases?from=${period.from}&to=${period.to}&view=supplier` }],
          params: periodParams(period),
        };
      }
      if (has(ask.p, 'product', 'products', 'item', 'items', 'selling', 'sold')) {
        const r = await ask.deps.business.sales({ from: period.from, to: period.to, view: 'product' });
        const rows = r.view === 'product' ? r.rows : [];
        const total = rows.reduce((s, x) => s + x.value, 0);
        return {
          understood: `Best selling · ${period.label}`,
          text: rows.length ? `Best selling ${during(period)} by value (before GST):` : `Nothing was sold ${during(period)}.`,
          ...(rows.length
            ? {
                table: table(['Product', R('Qty'), R('Value'), R('Share')], rows.slice(0, n).map((x) => [x.product, `${x.quantity} ${x.uom === 'SET' ? 'sets' : x.uom.toLowerCase()}`, rupees(x.value), total ? `${Math.round((x.value / total) * 100)}%` : '—']), n),
                insight: `${rows[0].product} alone is ${total ? Math.round((rows[0].value / total) * 100) : 0}% of sales ${during(period)}.`,
                chart: { kind: 'bars' as const, title: `Best selling · ${period.label}`, unit: 'money' as const, series: ['Value'], points: rows.slice(0, Math.min(n, 8)).map((x) => ({ label: x.product, values: [x.value] })) },
              }
            : {}),
          links: [{ label: 'Sales report', href: `/reports/sales?from=${period.from}&to=${period.to}&view=product` }],
          params: periodParams(period),
        };
      }
      const r = await ask.deps.business.sales({ from: period.from, to: period.to, view: 'customer' });
      const rows = r.view === 'customer' ? r.rows : [];
      const total = r.view === 'customer' ? r.totals.total : 0;
      const topShare = rows[0] && total ? Math.round((rows[0].total / total) * 100) : 0;
      return {
        understood: `Top customers · ${period.label}`,
        text: rows.length ? `Our biggest customers ${during(period)} (invoice totals with GST):` : `No sales ${during(period)}.`,
        ...(rows.length
          ? {
              table: table(['Customer', R('Invoices'), R('Total'), R('Share')], rows.slice(0, n).map((x) => [x.customer.name, String(x.invoices), rupees(x.total), total ? `${Math.round((x.total / total) * 100)}%` : '—']), n),
              chart: { kind: 'bars' as const, title: `Top customers · ${period.label}`, unit: 'money' as const, series: ['Sales'], points: rows.slice(0, Math.min(n, 8)).map((x) => ({ label: x.customer.name, values: [x.total] })) },
              ...(topShare >= 40 ? { insight: `${rows[0].customer.name} is ${topShare}% of sales, a high dependence on a single customer.` } : {}),
            }
          : {}),
        links: [{ label: 'Sales report', href: `/reports/sales?from=${period.from}&to=${period.to}&view=customer` }],
        params: periodParams(period),
      };
    },
  },
];

