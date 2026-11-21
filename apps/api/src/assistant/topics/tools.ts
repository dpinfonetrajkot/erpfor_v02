import { amountInWords, DOCUMENT_SERIES } from '@bht/shared';
import { PaymentDirection } from '../../generated/prisma/client';
import { COMMON_WORDS, financialYear, has, type Parsed } from '../language';
import { day, during, num, periodParams, plural, R, rupees, table, type Ask, type Reply, type Topic } from '../kit';

// ------------------------------------------------------------------ screens and "new …" buttons

const SCREENS: { label: string; href: string; permission: string; words: string[] }[] = [
  { label: 'Dashboard', href: '/dashboard', permission: 'dashboard.view', words: ['dashboard', 'home'] },
  { label: 'Sales orders', href: '/sales/orders', permission: 'sales_orders.view', words: ['so', 'sales order', 'sales orders'] },
  { label: 'Production requests', href: '/production/requests', permission: 'stock_check.view', words: ['production request', 'production requests'] },
  { label: 'Route cards', href: '/production/route-cards', permission: 'route_cards.view', words: ['route card', 'route cards', 'job card', 'job cards'] },
  { label: 'Job work orders', href: '/job-work/orders', permission: 'job_work_orders.view', words: ['job work', 'job work order', 'job work orders', 'outsource'] },
  { label: 'Job work receipts', href: '/job-work/receipts', permission: 'job_work_receipts.view', words: ['job work receipt', 'job work receipts'] },
  { label: 'Packing', href: '/dispatch/packing', permission: 'assemblies.view', words: ['packing', 'assembly', 'assemblies'] },
  { label: 'Invoices', href: '/billing/invoices', permission: 'invoices.view', words: ['invoice', 'invoices', 'bills', 'billing'] },
  { label: 'Dispatches', href: '/dispatch/dispatches', permission: 'dispatches.view', words: ['dispatch', 'dispatches', 'challan', 'challans'] },
  { label: 'Payments', href: '/billing/payments', permission: 'payments.view', words: ['payment', 'payments', 'receipts'] },
  { label: 'Purchase requisitions', href: '/purchase/requisitions', permission: 'purchase_requisitions.view', words: ['requisition', 'requisitions', 'indent', 'indents'] },
  { label: 'Purchase orders', href: '/purchase/orders', permission: 'purchase_orders.view', words: ['po', 'purchase order', 'purchase orders'] },
  { label: 'Gate entry', href: '/store/gate-entry', permission: 'goods_receipts.view', words: ['gate entry', 'gate entries', 'grn', 'inward'] },
  { label: 'Material issue', href: '/store/material-issue', permission: 'material_issues.view', words: ['material issue', 'issue material'] },
  { label: 'Finished parts in', href: '/store/rc-completion', permission: 'rc_completions.view', words: ['finished parts', 'completion', 'completions'] },
  { label: 'Stock & ledger', href: '/store/stock', permission: 'stock.view', words: ['stock', 'inventory', 'ledger', 'store'] },
  { label: 'Incoming QC', href: '/quality/incoming-qc', permission: 'incoming_qc.view', words: ['incoming qc', 'qc', 'quality'] },
  { label: 'Traceability', href: '/reports/traceability', permission: 'traceability.view', words: ['traceability'] },
  { label: 'Stock movement report', href: '/reports/stock', permission: 'reports.view', words: ['stock movement', 'stock report'] },
  { label: 'Production & rejections report', href: '/reports/production', permission: 'reports.view', words: ['production report', 'rejection report', 'rejections'] },
  { label: 'Pending orders report', href: '/reports/pending-orders', permission: 'reports.view', words: ['pending orders', 'order book'] },
  { label: 'Sales & GST report', href: '/reports/sales', permission: 'business_reports.view', words: ['sales report', 'gst report', 'sales register', 'gstr'] },
  { label: 'Purchases report', href: '/reports/purchases', permission: 'business_reports.view', words: ['purchase report', 'purchases report', 'purchase register'] },
  { label: 'Ageing report', href: '/reports/ageing', permission: 'business_reports.view', words: ['ageing', 'aging'] },
  { label: 'Employees', href: '/hr/employees', permission: 'employees.view', words: ['employee', 'employees', 'staff'] },
  { label: 'Attendance', href: '/hr/attendance', permission: 'attendance.view', words: ['attendance', 'punches'] },
  { label: 'Leaves', href: '/hr/leaves', permission: 'leaves.view', words: ['leave', 'leaves'] },
  { label: 'Loans & advances', href: '/hr/loans', permission: 'loans.view', words: ['loan', 'loans', 'advances'] },
  { label: 'Payroll', href: '/hr/payroll', permission: 'payroll.view', words: ['payroll', 'payslip', 'payslips', 'salaries'] },
  { label: 'Assets & safety', href: '/hr/assets', permission: 'assets.view', words: ['assets', 'safety'] },
  { label: 'Customers', href: '/masters/customers', permission: 'customers.view', words: ['customer', 'customers', 'clients'] },
  { label: 'Suppliers & vendors', href: '/masters/suppliers', permission: 'suppliers.view', words: ['supplier', 'suppliers', 'vendor', 'vendors'] },
  { label: 'Products & BOM', href: '/masters/products', permission: 'products.view', words: ['product', 'products', 'bom'] },
  { label: 'Items (parts)', href: '/masters/items', permission: 'items.view', words: ['items', 'parts'] },
  { label: 'Raw materials', href: '/masters/raw-materials', permission: 'raw_materials.view', words: ['raw material', 'raw materials'] },
  { label: 'Heat numbers', href: '/masters/heats', permission: 'heats.view', words: ['heat numbers', 'heats'] },
  { label: 'Users', href: '/admin/users', permission: 'users.view', words: ['users', 'logins'] },
  { label: 'Roles & permissions', href: '/admin/roles', permission: 'roles.view', words: ['roles', 'permissions'] },
  { label: 'Companies', href: '/admin/companies', permission: 'settings.view', words: ['company settings', 'companies', 'bank details'] },
  { label: 'Number series', href: '/admin/number-series', permission: 'settings.view', words: ['number series', 'numbering'] },
  { label: 'Chat', href: '/chat', permission: 'chat.view', words: ['chat', 'messages'] },
];

const CREATE: { label: string; href: string; permission: string; words: string[]; forCustomer?: boolean }[] = [
  { label: 'New invoice', href: '/billing/invoices/new', permission: 'invoices.create', words: ['invoice', 'bill', 'tax invoice'], forCustomer: true },
  { label: 'New sales order', href: '/sales/orders/new', permission: 'sales_orders.create', words: ['sales order', 'so'] },
  { label: 'New purchase order', href: '/purchase/orders/new', permission: 'purchase_orders.create', words: ['po', 'purchase order'] },
  { label: 'New gate entry', href: '/store/gate-entry/new', permission: 'goods_receipts.create', words: ['gate entry', 'grn'] },
  { label: 'New job work order', href: '/job-work/orders/new', permission: 'job_work_orders.create', words: ['job work order', 'job work'] },
];

const OPEN_RE = /^\s*(please\s+)?(open|go to|goto|show me the|take me to|navigate to|show the)\b/i;
const CREATE_RE = /^\s*(please\s+)?(create|make|new|add|raise|prepare|generate|start)\b/i;

/** The longest screen word found in the question, so "sales report" beats "sales". */
function bestMatch<T extends { words: string[] }>(p: Parsed, list: T[]): T | null {
  let best: { t: T; len: number } | null = null;
  for (const t of list) for (const w of t.words) if (p.padded.includes(` ${w} `) && (!best || w.length > best.len)) best = { t, len: w.length };
  return best?.t ?? null;
}

// ------------------------------------------------------------------ record search (also the "not understood" fallback)

const VERBS = /^\s*(please\s+)?(find|search( for)?|look ?up|lookup|where is|show)\s+/i;

/** Records matching the question (orders, invoices, parties, heats, parts, employees), only those the user may open. */
export async function recordSearch(ask: Ask, text?: string): Promise<Reply | null> {
  const q = (text ?? ask.p.raw).replace(VERBS, '').replace(/[?!.]+$/g, '').trim();
  if (q.length < 2) return null;
  let hits = await ask.deps.search.search(ask.user, q);
  let used = q;
  if (!hits.length) {
    // one meaningful word at a time, longest first ("alpha", "b102601" …)
    const words = [...new Set(q.split(/[\s,]+/).filter((w) => w.length >= 3 && !COMMON_WORDS.has(w.toLowerCase())))].sort((a, b) => b.length - a.length);
    for (const w of words) {
      hits = await ask.deps.search.search(ask.user, w);
      if (hits.length) {
        used = w;
        break;
      }
    }
  }
  if (!hits.length) return null;
  const ideas: string[] = [];
  for (const h of hits.slice(0, 4)) {
    if (h.type === 'Sales order') ideas.push(`Status of ${h.title}`);
    if (h.type === 'Invoice') ideas.push(`Status of invoice ${h.title}`);
    if (h.type === 'Purchase order') ideas.push(`Status of ${h.title}`);
    if (h.type === 'Route card') ideas.push(`Status of ${h.title}`);
    if (h.type === 'Heat' && ask.can('traceability.view')) ideas.push(`Trace ${h.title}`);
    if (h.type === 'Customer') ideas.push(`About ${h.title}`, ...(ask.can('payments.view') ? [`Statement of ${h.title}`] : []));
    if (h.type === 'Supplier') ideas.push(`About ${h.title}`);
    if (h.type === 'Employee') ideas.push(`Details of ${h.subtitle.replace(/^Code (\S+).*$/, '$1')}`);
  }
  return {
    understood: `Records matching “${used}”`,
    text: `${plural(hits.length, 'record')} match “${used}”${hits.length > 8 ? ' (the closest first)' : ''}:`,
    table: table(['Type', 'Record', 'Details'], hits.map((h) => [h.type, h.title, h.subtitle]), 8),
    links: hits.slice(0, 4).map((h) => ({ label: `Open ${h.title.length > 28 ? `${h.title.slice(0, 26)}…` : h.title}`, href: h.href })),
    suggestions: [...new Set(ideas)].slice(0, 5),
  };
}

// ------------------------------------------------------------------ GST calculator

const MULT: Record<string, number> = { k: 1e3, thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 };

/** Amount and rate typed in a question: "18% gst on 1,50,000", "gst 5 on 2.5 lakh", "reverse gst 118000". */
function amountAndRate(raw: string): { amount: number; rate: number } | null {
  const text = raw.toLowerCase();
  let rate: number | null = null;
  const pct = text.match(/(\d+(?:\.\d+)?)\s*(%|percent)/);
  if (pct) rate = Number(pct[1]);
  else {
    const after = text.match(/\bgst\s*@?\s*(\d{1,2}(?:\.\d+)?)\b(?!\s*(k|lakh|lakhs|lac|lacs|cr|crore|crores|thousand|,\d))/);
    if (after && [0, 0.25, 3, 5, 12, 18, 28].includes(Number(after[1]))) rate = Number(after[1]);
  }
  const amounts: number[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|cr|crores?)?(?![\d%])/g)) {
    const value = Number(m[1].replace(/,/g, '')) * (m[2] ? MULT[m[2]] : 1);
    if (!Number.isFinite(value)) continue;
    if (rate !== null && value === rate && !m[2]) continue;
    amounts.push(value);
  }
  const amount = Math.max(0, ...amounts);
  if (!amount) return null;
  return { amount, rate: rate ?? 18 };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const paise = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ------------------------------------------------------------------ the topics

export const toolTopics: Topic[] = [
  {
    id: 'open_screen',
    area: 'Shortcuts',
    label: 'that screen',
    permissions: ['dashboard.view', 'assistant.view'],
    examples: ['Open stock', 'Create invoice for Alpha', 'New purchase order'],
    score: (p, f) => {
      // "how to make an invoice" is a guide, "new invoices this month" / "open orders of Alpha" are data questions
      if (has(p, 'how', 'why', 'kem', 'kaise') || p.period || p.docs.length) return 0;
      // a clear "new …" / "create …" at the start is an action, ahead of the how-to guide for the same document
      if (CREATE_RE.test(p.raw) && bestMatch(p, CREATE)) return 20;
      const named = f.customers.length + f.suppliers.length + f.employees.length + f.materials.length + f.items.length + f.products.length;
      if (OPEN_RE.test(p.raw) && !named && bestMatch(p, SCREENS)) return 10;
      return 0;
    },
    async answer(ask) {
      if (CREATE_RE.test(ask.p.raw)) {
        const c = bestMatch(ask.p, CREATE)!;
        if (!ask.can(c.permission)) return { understood: c.label, text: `Your role cannot make this (${c.label.toLowerCase()}). Ask the administrator if you need it.` };
        const customer = c.forCustomer && ask.found.customers.length === 1 ? ask.found.customers[0] : null;
        return {
          understood: customer ? `${c.label} for ${customer.name}` : c.label,
          text: customer
            ? `Here you go: a new invoice for ${customer.name}, with the address, GSTIN, GST type and payment terms filled in. Add the lines and save.`
            : `Here you go - the button opens a blank ${c.label.toLowerCase().replace('new ', '')} form.`,
          actions: [{ label: customer ? `New invoice for ${customer.name}` : c.label, href: customer ? `${c.href}?customerId=${customer.id}` : c.href }],
          ...(customer && ask.can('payments.view') ? { suggestions: [`Outstanding of ${customer.name}`, `Statement of ${customer.name}`] } : {}),
        };
      }
      const s = bestMatch(ask.p, SCREENS)!;
      if (!ask.can(s.permission)) return { understood: s.label, text: `${s.label} is not in your role's menu. Ask the administrator if you need it.` };
      return { understood: `Open ${s.label}`, text: `${s.label} is one click away.`, actions: [{ label: `Open ${s.label}`, href: s.href }] };
    },
  },

  {
    id: 'statement',
    area: 'Money',
    label: 'payments',
    permissions: ['payments.view'],
    examples: ['Statement of Alpha', 'Ledger of Delta this year'],
    score: (p, f) => (has(p, 'statement', 'ledger', 'account statement', 'soa', 'khata', 'hisab', 'account of') ? (f.customers.length ? 10 : 6) : 0),
    async answer(ask) {
      const ids = ask.ids(ask.found.customers, 'customerId');
      if (ids.length !== 1) {
        const names = ask.found.customers.map((c) => c.name);
        return names.length > 1
          ? { text: 'More than one customer matches. Which one do you mean?', suggestions: names.slice(0, 6).map((n) => `Statement of ${n}`) }
          : { understood: 'Customer statement', text: 'Statement of which customer? Type the name, for example "Statement of Alpha".' };
      }
      const customerId = ids[0];
      const customer = await ask.prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } });
      const fy = financialYear(ask.today);
      const period = ask.period({ from: fy.from, to: ask.today, label: `FY ${fy.label} so far` });
      const [invoices, payments] = await Promise.all([
        ask.prisma.invoice.findMany({
          where: { customerId, status: 'ISSUED', invoiceDate: { lte: new Date(`${period.to}T00:00:00Z`) } },
          select: { id: true, invoiceNo: true, invoiceDate: true, dueDate: true, grandTotal: true, exchangeRate: true },
        }),
        ask.prisma.payment.findMany({
          where: { direction: PaymentDirection.RECEIPT, cancelledAt: null, OR: [{ customerId }, { invoice: { customerId } }], paymentDate: { lte: new Date(`${period.to}T00:00:00Z`) } },
          select: { paymentNo: true, paymentDate: true, amount: true, mode: true, reference: true, invoice: { select: { invoiceNo: true, exchangeRate: true } } },
        }),
      ]);
      const from = new Date(`${period.from}T00:00:00Z`);
      type Entry = { date: Date; doc: string; detail: string; debit: number; credit: number };
      const entries: Entry[] = [
        ...invoices.map((i) => ({ date: i.invoiceDate, doc: i.invoiceNo, detail: i.dueDate ? `Invoice, due ${day(i.dueDate)}` : 'Invoice', debit: num(i.grandTotal) * (num(i.exchangeRate) || 1), credit: 0 })),
        ...payments.map((p) => ({
          date: p.paymentDate,
          doc: p.paymentNo,
          detail: `Received${p.invoice ? ` for ${p.invoice.invoiceNo}` : ''}${p.reference ? ` · ${p.reference}` : ''}`,
          debit: 0,
          credit: num(p.amount) * (num(p.invoice?.exchangeRate) || 1),
        })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime() || b.debit - a.debit);
      const before = entries.filter((e) => e.date < from);
      const opening = before.reduce((s, e) => s + e.debit - e.credit, 0);
      const inPeriod = entries.filter((e) => e.date >= from);
      let balance = opening;
      const rows = inPeriod.map((e) => {
        balance += e.debit - e.credit;
        return [day(e.date), e.doc, e.detail, e.debit ? rupees(e.debit) : '—', e.credit ? rupees(e.credit) : '—', rupees(balance)];
      });
      const invoiced = inPeriod.reduce((s, e) => s + e.debit, 0);
      const received = inPeriod.reduce((s, e) => s + e.credit, 0);
      const name = customer?.name ?? 'the customer';
      return {
        understood: `Statement · ${name} · ${period.label}`,
        text: inPeriod.length
          ? `${name}: opening ${rupees(opening)}, invoiced ${rupees(invoiced)}, received ${rupees(received)} - closing balance ${rupees(balance)}${balance > 0 ? ' to receive' : ''}.`
          : `No invoice or payment for ${name} ${during(period)}. Balance ${rupees(opening)}.`,
        facts: [
          { label: 'Opening', value: rupees(opening) },
          { label: 'Invoiced', value: rupees(invoiced) },
          { label: 'Received', value: rupees(received), ...(received > 0 ? { tone: 'good' as const } : {}) },
          { label: 'Closing balance', value: rupees(balance), ...(balance > 0 ? { tone: 'bad' as const } : {}) },
        ],
        ...(rows.length ? { table: table(['Date', 'Document', 'Details', R('Debit'), R('Credit'), R('Balance')], rows, 15) } : {}),
        links: [
          { label: 'Customers owe us', href: '/billing/payments?tab=owed' },
          ...(ask.can('business_reports.view') ? [{ label: 'Sales report', href: `/reports/sales?from=${period.from}&to=${period.to}&customerId=${customerId}` }] : []),
        ],
        ...(ask.can('invoices.create') ? { actions: [{ label: `New invoice for ${name}`, href: `/billing/invoices/new?customerId=${customerId}` }] } : {}),
        suggestions: [`Outstanding of ${name}`, `Sales of ${name} this year`, `About ${name}`],
        params: { ...periodParams(period), customerId },
      };
    },
  },

  {
    id: 'next_number',
    area: 'Shortcuts',
    label: 'number series',
    permissions: ['dashboard.view', 'assistant.view'],
    examples: ['Next invoice number', 'Next PO number'],
    score: (p) => (has(p, 'next') && has(p, 'number', 'numbers', 'no', 'nos', 'num', 'series', 'serial') ? 10 : 0),
    async answer(ask) {
      const SERIES: { code: keyof typeof DOCUMENT_SERIES; words: string[] }[] = [
        { code: 'EXPORT_INVOICE', words: ['export invoice', 'export'] },
        { code: 'INVOICE', words: ['invoice', 'bill', 'tax invoice'] },
        { code: 'SALES_ORDER', words: ['sales order', 'so'] },
        { code: 'PURCHASE_ORDER', words: ['purchase order', 'po'] },
        { code: 'ROUTE_CARD', words: ['route card', 'rc'] },
        { code: 'GOODS_RECEIPT', words: ['gate entry', 'grn'] },
        { code: 'DISPATCH', words: ['dispatch', 'challan'] },
        { code: 'PAYMENT', words: ['payment', 'receipt'] },
        { code: 'JOB_WORK_ORDER', words: ['job work', 'jwo'] },
        { code: 'CUSTOMER', words: ['customer', 'customer code'] },
        { code: 'HEAT', words: ['heat'] },
      ];
      const asked = SERIES.find((s) => s.words.some((w) => ask.p.padded.includes(` ${w} `)));
      const codes = asked ? [asked.code] : (['INVOICE', 'EXPORT_INVOICE', 'SALES_ORDER', 'PURCHASE_ORDER', 'ROUTE_CARD', 'GOODS_RECEIPT', 'DISPATCH'] as const);
      const rows = await Promise.all(
        codes.map(async (code) => {
          try {
            return [DOCUMENT_SERIES[code], await ask.deps.numbering.preview(code)];
          } catch {
            return [DOCUMENT_SERIES[code], 'not set up'];
          }
        }),
      );
      return {
        understood: asked ? `Next ${DOCUMENT_SERIES[asked.code].toLowerCase()} number` : 'Next document numbers',
        text: asked
          ? `The next ${DOCUMENT_SERIES[asked.code].toLowerCase()} will be ${rows[0][1]}. The number is only used when the document is saved${asked.code.includes('INVOICE') ? ' (invoices: when issued)' : ''}.`
          : 'The next numbers of the main documents (used only when each document is saved; invoices when issued):',
        ...(asked ? {} : { table: table(['Document', 'Next number'], rows as string[][]) }),
        ...(ask.can('settings.view') ? { links: [{ label: 'Number series', href: '/admin/number-series' }] } : {}),
      };
    },
  },

  {
    id: 'gst_calc',
    area: 'Shortcuts',
    label: 'GST calculator',
    permissions: ['dashboard.view', 'assistant.view'],
    examples: ['18% GST on 50000', 'Reverse GST of 1,18,000', 'GST 5 on 2.5 lakh'],
    score: (p) => {
      if (p.period || p.docs.length || has(p, 'sales', 'report', 'register', 'paid', 'received', 'collected')) return 0;
      const gst = has(p, 'gst', 'igst', 'cgst', 'sgst', 'tax') || /%/.test(p.raw);
      return gst && amountAndRate(p.raw) ? 9 : 0;
    },
    async answer(ask) {
      const { amount, rate } = amountAndRate(ask.p.raw)!;
      const inclusive = has(ask.p, 'inclusive', 'incl', 'including', 'included', 'with gst', 'reverse', 'from total', 'total of', 'back calculate', 'excluding gst from');
      const igst = has(ask.p, 'igst', 'inter state', 'interstate', 'other state', 'outside state', 'out of state');
      const taxable = round2(inclusive ? amount / (1 + rate / 100) : amount);
      const gst = round2(inclusive ? amount - taxable : (amount * rate) / 100);
      const total = round2(taxable + gst);
      const half = round2(gst / 2);
      return {
        understood: `GST ${rate}% ${inclusive ? 'inside' : 'on'} ${paise(amount)}`,
        text: inclusive
          ? `${paise(amount)} including ${rate}% GST is ${paise(taxable)} + ${paise(gst)} GST.`
          : `${rate}% GST on ${paise(amount)} is ${paise(gst)}, so the total is ${paise(total)}.`,
        facts: [
          { label: 'Taxable value', value: paise(taxable) },
          ...(igst ? [{ label: `IGST ${rate}%`, value: paise(gst) }] : [{ label: `CGST ${rate / 2}%`, value: paise(half) }, { label: `SGST ${rate / 2}%`, value: paise(round2(gst - half)) }]),
          { label: 'Total', value: paise(total) },
        ],
        insight: `In words: ${amountInWords(total)}.`,
        suggestions: [
          inclusive ? `${rate}% GST on ${amount}` : `Reverse GST of ${amount}`,
          igst ? `${rate}% GST on ${amount}` : `${rate}% IGST on ${amount}`,
          ...[5, 12, 18, 28].filter((r) => r !== rate).slice(0, 2).map((r) => `${r}% GST on ${amount}`),
        ],
      };
    },
  },

  {
    id: 'find',
    area: 'Shortcuts',
    label: 'search',
    permissions: ['dashboard.view', 'assistant.view'],
    examples: ['Find alpha', 'Search B102601'],
    score: (p) => (/^\s*(please\s+)?(find|search|look ?up|lookup)\b/i.test(p.raw) ? 6 : 0),
    async answer(ask) {
      return (await recordSearch(ask)) ?? { understood: 'Search', text: `Nothing matches “${ask.p.raw.replace(VERBS, '').trim()}” in the records you can open.` };
    },
  },
];
