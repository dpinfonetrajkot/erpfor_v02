import { INDIAN_STATES } from '@bht/shared';
import { PaymentDirection } from '../../generated/prisma/client';
import { financialYear, has, type Parsed } from '../language';
import type { Found } from '../catalog';
import { RUNNING } from '../../jobwork/job-work.service';
import { day, num, plural, rupees, whichOne, type Ask, type Reply, type Topic } from '../kit';

type Fact = NonNullable<Reply['facts']>[number];

const PROFILE_WORDS = ['about', 'details', 'detail', 'profile', 'info', 'information', 'contact', 'phone', 'mobile', 'email', 'mail', 'gstin', 'gst no', 'gst number', 'address', 'who is', 'tell me', 'summary', 'overview', 'account', 'everything', 'full', 'party', 'status of'];
const stateName = (code: string | null) => INDIAN_STATES.find((s) => s.code === code)?.name;
const joinAnd = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);

/** Words of the question that are not part of the party's name (a bare name = "tell me about"). */
function otherWords(p: Parsed, nameTokens: string[]) {
  return [...p.words].filter((w) => !nameTokens.includes(w)).length;
}

function score(p: Parsed, parties: Found['customers']) {
  if (!parties.length) return 0;
  if (has(p, ...PROFILE_WORDS)) return 8;
  return otherWords(p, parties[0].tokens) === 0 ? 6 : 0;
}

export const partyTopics: Topic[] = [
  {
    id: 'customer_profile',
    area: 'Sales',
    label: 'customers',
    permissions: ['customers.view', 'sales_orders.view', 'payments.view', 'business_reports.view'],
    examples: ['Tell me about Alpha'],
    score: (p, f) => (f.suppliers.length && !f.customers.length ? 0 : score(p, f.customers)),
    async answer(ask) {
      const ids = ask.ids(ask.found.customers, 'customerId');
      if (ids.length > 1) return whichOne('customer', ask.found.customers.map((c) => c.name), (n) => `About ${n}`);
      const c = ids[0] ? await ask.prisma.customer.findUnique({ where: { id: ids[0] } }) : null;
      if (!c) return { text: 'Which customer? For example: "tell me about Alpha".' };
      const fy = financialYear(ask.today);
      const [orders, owed, sales, lastInvoice] = await Promise.all([
        ask.can('sales_orders.view')
          ? ask.prisma.salesOrder.findMany({ where: { customerId: c.id, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PRODUCTION', 'PARTIALLY_DISPATCHED'] } }, select: { totalAmount: true, exchangeRate: true } })
          : null,
        ask.can('payments.view') ? ask.deps.payments.outstanding(PaymentDirection.RECEIPT).then((rows) => rows.filter((r) => r.party.id === c.id)) : null,
        ask.can('business_reports.view') ? ask.deps.business.sales({ from: fy.from, to: ask.today, customerId: c.id, view: 'customer' }) : null,
        ask.can('invoices.view') ? ask.prisma.invoice.findFirst({ where: { customerId: c.id, status: 'ISSUED' }, orderBy: { invoiceDate: 'desc' }, select: { id: true, invoiceNo: true, invoiceDate: true, grandTotal: true } }) : null,
      ]);
      const facts: Fact[] = [];
      const parts: string[] = [];
      if (ask.can('customers.view')) {
        facts.push({ label: 'Code', value: c.code });
        if (c.contactPerson || c.phone) facts.push({ label: 'Contact', value: [c.contactPerson, c.phone].filter(Boolean).join(' · ') });
        if (c.gstin) facts.push({ label: 'GSTIN', value: c.gstin });
        facts.push({ label: 'Place', value: [c.city, stateName(c.stateCode) ?? (c.country !== 'India' ? c.country : null)].filter(Boolean).join(', ') || '—' });
        if (c.paymentTermsDays) facts.push({ label: 'Payment terms', value: `${c.paymentTermsDays} days` });
      }
      if (orders) {
        const value = orders.reduce((s, o) => s + num(o.totalAmount) * (num(o.exchangeRate) || 1), 0);
        facts.push({ label: 'Open orders', value: orders.length ? `${orders.length} · ${rupees(value)}` : 'None' });
        parts.push(orders.length ? `has ${plural(orders.length, 'open order')} worth ${rupees(value)}` : 'has no open order');
      }
      let insight: string | undefined;
      if (owed) {
        const inr = (r: (typeof owed)[number]) => r.balance * (r.exchangeRate || 1);
        const total = owed.reduce((s, r) => s + inr(r), 0);
        const late = owed.filter((r) => r.overdueDays > 0);
        const overdue = late.reduce((s, r) => s + inr(r), 0);
        facts.push({ label: 'To receive', value: rupees(total), ...(overdue > 0 ? { tone: 'bad' as const } : {}) });
        parts.push(total ? `owes us ${rupees(total)}${overdue ? ` (${rupees(overdue)} overdue)` : ''}` : 'owes us nothing');
        const oldest = late.sort((a, b) => b.overdueDays - a.overdueDays)[0];
        if (oldest) insight = `Oldest unpaid: ${oldest.number}, ${plural(oldest.overdueDays, 'day')} late (${rupees(inr(oldest))}). A payment follow-up is recommended.`;
      }
      if (sales?.view === 'customer') {
        facts.push({ label: `Sales FY ${fy.label}`, value: rupees(sales.totals.total) });
        parts.push(sales.totals.invoices ? `bought ${rupees(sales.totals.total)} this financial year on ${plural(sales.totals.invoices, 'invoice')}` : 'has not bought anything this financial year');
      }
      if (lastInvoice) facts.push({ label: 'Last invoice', value: `${lastInvoice.invoiceNo} · ${day(lastInvoice.invoiceDate)}` });
      return {
        understood: `Customer · ${c.name}`,
        text: `${c.name}${c.isActive ? '' : ' (inactive)'} ${parts.length ? joinAnd(parts) : 'is in the customer list'}.`,
        facts,
        ...(insight ? { insight } : {}),
        links: [
          ...(ask.can('sales_orders.view') ? [{ label: 'Orders', href: `/sales/orders?search=${encodeURIComponent(c.name)}` }] : []),
          ...(ask.can('invoices.view') ? [{ label: 'Invoices', href: `/billing/invoices?customerId=${c.id}` }] : []),
          ...(ask.can('customers.view') ? [{ label: 'Customer master', href: `/masters/customers?search=${encodeURIComponent(c.name)}` }] : []),
        ],
        suggestions: [
          ...(ask.can('sales_orders.view') ? [`Open orders of ${c.name}`] : []),
          ...(ask.can('payments.view') ? [`Outstanding of ${c.name}`] : []),
          ...(ask.can('invoices.view') ? [`Invoices of ${c.name} this year`] : []),
        ],
        params: { customerId: c.id },
      };
    },
  },

  {
    id: 'supplier_profile',
    area: 'Purchase',
    label: 'suppliers',
    permissions: ['suppliers.view', 'purchase_orders.view', 'payments.view'],
    examples: [],
    score: (p, f) => (f.customers.length && !f.suppliers.length ? 0 : score(p, f.suppliers)),
    async answer(ask) {
      const ids = ask.ids(ask.found.suppliers, 'supplierId');
      if (ids.length > 1) return whichOne('supplier', ask.found.suppliers.map((s) => s.name), (n) => `About ${n}`);
      const s = ids[0] ? await ask.prisma.supplier.findUnique({ where: { id: ids[0] } }) : null;
      if (!s) return { text: 'Which supplier? For example: "tell me about Shree Steel".' };
      const [pos, owe, lastGrn, jobWork] = await Promise.all([
        ask.can('purchase_orders.view')
          ? ask.prisma.purchaseOrder.findMany({ where: { supplierId: s.id, status: { in: ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'] } }, select: { grandTotal: true } })
          : null,
        ask.can('payments.view') ? ask.deps.payments.outstanding(PaymentDirection.PAYMENT).then((rows) => rows.filter((r) => r.party.id === s.id)) : null,
        ask.can('goods_receipts.view') ? ask.prisma.goodsReceipt.findFirst({ where: { supplierId: s.id }, orderBy: { id: 'desc' }, select: { grnNo: true, grnDate: true } }) : null,
        ask.can('job_work_orders.view') ? ask.prisma.jobWorkOrder.count({ where: { supplierId: s.id, status: { in: RUNNING } } }) : null,
      ]);
      const facts: Fact[] = [];
      const parts: string[] = [];
      if (ask.can('suppliers.view')) {
        facts.push({ label: 'Code', value: s.code });
        facts.push({ label: 'Type', value: ({ MATERIAL: 'Material supplier', JOB_WORK: 'Job work vendor', SERVICE: 'Service provider', OTHER: 'Other' } as const)[s.type] });
        if (s.contactPerson || s.phone) facts.push({ label: 'Contact', value: [s.contactPerson, s.phone].filter(Boolean).join(' · ') });
        if (s.gstin) facts.push({ label: 'GSTIN', value: s.gstin });
        if (s.city) facts.push({ label: 'City', value: s.city });
      }
      if (pos) {
        const value = pos.reduce((t, o) => t + num(o.grandTotal), 0);
        facts.push({ label: 'Open POs', value: pos.length ? `${pos.length} · ${rupees(value)}` : 'None' });
        parts.push(pos.length ? `has ${plural(pos.length, 'open purchase order')} (${rupees(value)})` : 'has no open purchase order');
      }
      if (owe) {
        const total = owe.reduce((t, r) => t + r.balance * (r.exchangeRate || 1), 0);
        facts.push({ label: 'We owe', value: rupees(total) });
        parts.push(total ? `is owed ${rupees(total)} by us` : 'is owed nothing');
      }
      if (jobWork) facts.push({ label: 'Job work running', value: String(jobWork) });
      if (lastGrn) facts.push({ label: 'Last receipt', value: `${lastGrn.grnNo} · ${day(lastGrn.grnDate)}` });
      return {
        understood: `Supplier · ${s.name}`,
        text: `${s.name}${s.isActive ? '' : ' (inactive)'} ${parts.length ? joinAnd(parts) : 'is in the supplier list'}.`,
        facts,
        links: [
          ...(ask.can('purchase_orders.view') ? [{ label: 'Purchase orders', href: `/purchase/orders?search=${encodeURIComponent(s.name)}` }] : []),
          ...(ask.can('suppliers.view') ? [{ label: 'Supplier master', href: `/masters/suppliers?search=${encodeURIComponent(s.name)}` }] : []),
        ],
        suggestions: ask.can('payments.view') ? [`How much do we owe ${s.name}?`] : [],
        params: { supplierId: s.id },
      };
    },
  },
];
