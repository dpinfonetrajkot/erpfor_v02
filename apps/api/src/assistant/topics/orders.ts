import { PO_STATUS_LABELS, RC_STATUS_LABELS, SO_STATUS_LABELS } from '@bht/shared';
import { SalesOrderStatus } from '../../generated/prisma/client';
import { has, monthPeriod } from '../language';
import { cap, day, docKind, docNumbers, dueIn, endsWithNumber, list, num, periodParams, plural, qty, R, rupees, table, whichOne, type Ask, type Topic } from '../kit';

const CLOSED_ORDER: SalesOrderStatus[] = [SalesOrderStatus.CLOSED, SalesOrderStatus.CANCELLED, SalesOrderStatus.DISPATCHED];
const APPROVAL_NAMES = { feasibilityStatus: 'feasibility', designStatus: 'design', productionStatus: 'production' } as const;
/** A heat number: grade letter(s) + month + year + running no., e.g. A102602. */
const HEAT_CODE = /^[a-z]{1,3}\d{5,6}$/;

const soNumbers = (ask: Ask) =>
  docNumbers(ask, 'SO', async (n) => endsWithNumber(n)((await ask.prisma.salesOrder.findMany({ where: { soNo: { endsWith: String(n) } }, orderBy: { id: 'desc' }, take: 50, select: { soNo: true } })).map((x) => x.soNo)));

export const orderTopics: Topic[] = [
  {
    id: 'so_status',
    area: 'Sales',
    label: 'sales orders',
    permissions: ['sales_orders.view'],
    examples: ['Status of SO/26-27/0003', 'Where is so 3?'],
    score: (p) => (p.docs.some((d) => docKind(d) === 'SO') || p.shortDocs.some((s) => s.kind === 'SO') ? (has(p, 'trace', 'traceability', 'heat', 'heats', 'mtc') ? 5 : 9) : 0),
    async answer(ask) {
      const numbers = await soNumbers(ask);
      if (!numbers.length) return { text: 'I could not find that sales order number.', suggestions: ['Pending orders'] };
      const so = await ask.prisma.salesOrder.findUnique({
        where: { soNo: numbers[0] },
        select: {
          id: true, soNo: true, soDate: true, status: true, customerPoNo: true, expectedDelivery: true, totalAmount: true, currency: true,
          feasibilityStatus: true, designStatus: true, productionStatus: true,
          customer: { select: { name: true } },
          lines: { orderBy: { lineNo: 'asc' }, select: { quantity: true, dispatchedQty: true, product: { select: { name: true } }, assemblyLines: { where: { assembly: { status: { not: 'CANCELLED' } } }, select: { quantity: true } } } },
        },
      });
      if (!so) return { text: `There is no sales order ${numbers[0]}.` };
      const ordered = so.lines.reduce((s, l) => s + num(l.quantity), 0);
      const dispatched = so.lines.reduce((s, l) => s + num(l.dispatchedQty), 0);
      const waiting = so.status === 'PENDING_APPROVAL' ? (Object.keys(APPROVAL_NAMES) as (keyof typeof APPROVAL_NAMES)[]).filter((k) => so[k] === 'PENDING').map((k) => APPROVAL_NAMES[k]) : [];
      const open = !CLOSED_ORDER.includes(so.status);
      return {
        understood: `Sales order ${so.soNo}`,
        text:
          `${so.soNo} of ${day(so.soDate)} for ${so.customer.name}${so.customerPoNo ? ` (customer PO ${so.customerPoNo})` : ''}: ${SO_STATUS_LABELS[so.status]}` +
          (waiting.length ? `, waiting for ${list(waiting)} approval` : '') +
          (open && so.expectedDelivery ? `. Delivery due ${day(so.expectedDelivery)} (${dueIn(so.expectedDelivery, ask.today)}).` : '.'),
        facts: [
          { label: 'Sets ordered', value: qty(ordered) },
          { label: 'Dispatched', value: qty(dispatched) },
          { label: 'Still to send', value: qty(ordered - dispatched), ...(open && ordered > dispatched && so.expectedDelivery && dueIn(so.expectedDelivery, ask.today).endsWith('late') ? { tone: 'bad' as const } : {}) },
          { label: 'Order value', value: so.currency === 'INR' ? rupees(num(so.totalAmount)) : `${so.currency} ${qty(num(so.totalAmount))}` },
        ],
        table: table(['Product', R('Ordered'), R('Packed'), R('Dispatched')], so.lines.map((l) => [l.product.name, qty(num(l.quantity)), qty(l.assemblyLines.reduce((s, a) => s + num(a.quantity), 0)), qty(num(l.dispatchedQty))])),
        links: [
          { label: `Open ${so.soNo}`, href: `/sales/orders/${so.id}` },
          ...(ask.can('traceability.view') ? [{ label: 'Traceability', href: `/reports/traceability/order/${so.id}` }] : []),
        ],
      };
    },
  },

  {
    id: 'customer_orders',
    area: 'Sales',
    label: 'sales orders',
    permissions: ['sales_orders.view'],
    examples: ['Open orders of Alpha'],
    score: (p, f) => (f.customers.length && has(p, 'order', 'orders', 'so', 'po', 'purchase') && !has(p, 'pending', 'late', 'overdue', 'delayed') ? 7 : 0),
    async answer(ask) {
      const ids = ask.ids(ask.found.customers, 'customerId');
      if (ids.length > 1) return whichOne('customer', ask.found.customers.map((c) => c.name), (n) => `Open orders of ${n}`);
      const customer = await ask.prisma.customer.findUnique({ where: { id: ids[0] }, select: { id: true, name: true } });
      if (!customer) return { text: 'Which customer? For example: "open orders of Alpha".' };
      const orders = await ask.prisma.salesOrder.findMany({
        where: { customerId: customer.id, status: { notIn: CLOSED_ORDER } },
        orderBy: { soDate: 'desc' },
        select: { id: true, soNo: true, soDate: true, status: true, expectedDelivery: true, totalAmount: true, currency: true },
      });
      return {
        understood: `Open sales orders · ${customer.name}`,
        text: orders.length ? `${customer.name} has ${plural(orders.length, 'open order')}:` : `${customer.name} has no open sales order.`,
        ...(orders.length
          ? { table: table(['Order', 'Date', 'Status', 'Delivery', R('Value')], orders.map((o) => [o.soNo, day(o.soDate), SO_STATUS_LABELS[o.status], o.expectedDelivery ? `${day(o.expectedDelivery)} (${dueIn(o.expectedDelivery, ask.today)})` : '—', o.currency === 'INR' ? rupees(num(o.totalAmount)) : `${o.currency} ${qty(num(o.totalAmount))}`])) }
          : {}),
        links: [{ label: 'Sales orders', href: `/sales/orders?search=${encodeURIComponent(customer.name)}` }],
        suggestions: [`Pending orders of ${customer.name}`],
        params: { customerId: customer.id },
      };
    },
  },

  {
    id: 'pending_orders',
    area: 'Sales',
    label: 'pending orders report',
    permissions: ['reports.view'],
    examples: ['Pending orders', 'Which orders are late?'],
    score: (p) =>
      has(p, 'pending', 'late', 'overdue', 'delayed', 'not dispatched', 'to dispatch', 'backlog', 'due') && has(p, 'order', 'orders', 'so', 'dispatch', 'delivery', 'deliveries', 'supply') ? 7 : 0,
    async answer(ask) {
      const customerIds = ask.ids(ask.found.customers, 'customerId');
      const lateOnly = has(ask.p, 'late', 'overdue', 'delayed');
      const r = await ask.deps.reports.pendingOrders({ customerId: customerIds.length === 1 ? customerIds[0] : undefined, overdue: lateOnly ? 'true' : undefined });
      const who = customerIds.length === 1 ? (await ask.prisma.customer.findUnique({ where: { id: customerIds[0] }, select: { name: true } }))?.name : null;
      const s = r.summary;
      return {
        understood: `${lateOnly ? 'Late' : 'Pending'} orders${who ? ` · ${who}` : ''}`,
        text: s.lines
          ? `${plural(s.orders, 'order')} with ${qty(s.pendingSets)} sets still to dispatch (${rupees(s.valueInr)})${s.overdueLines && !lateOnly ? `; ${plural(s.overdueLines, 'line')} late` : ''}. Earliest due first:`
          : lateOnly ? 'No order is late.' : 'Nothing is pending - every approved order is dispatched.',
        ...(s.lines
          ? { table: table(['Order', 'Customer', 'Product', R('Pending'), 'Due'], r.rows.map((x) => [x.order.soNo, x.customer.name, x.product, qty(x.pending), x.dueDate ? `${day(x.dueDate)}${x.overdueDays ? ` (${plural(x.overdueDays, 'day')} late)` : ''}` : '—'])) }
          : {}),
        links: [{ label: 'Pending orders report', href: `/reports/pending-orders${customerIds.length === 1 ? `?customerId=${customerIds[0]}` : ''}` }],
        params: customerIds.length === 1 ? { customerId: customerIds[0] } : {},
      };
    },
  },

  {
    id: 'rc_status',
    area: 'Production',
    label: 'route cards',
    permissions: ['route_cards.view'],
    examples: ['Status of rc 2', 'Route cards in progress', 'Route cards at forging'],
    score: (p) =>
      p.docs.some((d) => docKind(d) === 'RC') || p.shortDocs.some((s) => s.kind === 'RC') ? 9 : has(p, 'rc') && (has(p, 'status', 'where', 'stage', 'stages', 'progress', 'running', 'open', 'pending', 'how many', 'at', 'list') || p.words.size <= 3) ? 6 : 0,
    async answer(ask) {
      const numbers = await docNumbers(ask, 'RC', async (n) => endsWithNumber(n)((await ask.prisma.routeCard.findMany({ where: { rcNo: { endsWith: String(n) } }, orderBy: { id: 'desc' }, take: 50, select: { rcNo: true } })).map((x) => x.rcNo)));
      if (numbers.length) {
        const rc = await ask.prisma.routeCard.findUnique({
          where: { rcNo: numbers[0] },
          select: {
            id: true, rcNo: true, rcDate: true, status: true, plannedQty: true, extraQty: true, completedQty: true, rejectedQty: true, expectedDelivery: true,
            item: { select: { name: true } }, currentStage: { select: { name: true } }, salesOrderLine: { select: { salesOrder: { select: { soNo: true } } } },
          },
        });
        if (!rc) return { text: `There is no route card ${numbers[0]}.` };
        return {
          understood: `Route card ${rc.rcNo}`,
          text:
            `${rc.rcNo} of ${day(rc.rcDate)}: ${num(rc.plannedQty) + num(rc.extraQty)} × ${rc.item.name}` +
            `${rc.salesOrderLine ? ` for ${rc.salesOrderLine.salesOrder.soNo}` : ' for stock'} - ${RC_STATUS_LABELS[rc.status]}` +
            `${rc.status === 'IN_PROGRESS' && rc.currentStage ? `, now at ${rc.currentStage.name}` : ''}.`,
          facts: [
            { label: 'Planned', value: qty(num(rc.plannedQty) + num(rc.extraQty)) },
            { label: 'Finished OK', value: qty(num(rc.completedQty)) },
            { label: 'Rejected', value: qty(num(rc.rejectedQty)), ...(num(rc.rejectedQty) ? { tone: 'bad' as const } : {}) },
            ...(rc.expectedDelivery ? [{ label: 'Needed by', value: day(rc.expectedDelivery) }] : []),
          ],
          links: [{ label: `Open ${rc.rcNo}`, href: `/production/route-cards/${rc.id}` }],
        };
      }
      const stages = await ask.prisma.processStage.findMany({ select: { id: true, name: true } });
      const stage = stages.find((s) => s.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).some((w) => ask.p.words.has(w)));
      const cards = await ask.prisma.routeCard.findMany({
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, ...(stage ? { currentStageId: stage.id, status: 'IN_PROGRESS' } : {}) },
        orderBy: { rcDate: 'asc' },
        select: { rcNo: true, rcDate: true, status: true, plannedQty: true, extraQty: true, item: { select: { name: true } }, currentStage: { select: { name: true } } },
      });
      if (stage) {
        return {
          understood: `Route cards at ${stage.name}`,
          text: cards.length ? `${plural(cards.length, 'route card is', 'route cards are')} at ${stage.name}:` : `No route card is at ${stage.name} now.`,
          ...(cards.length ? { table: table(['Route card', 'Date', 'Part', R('Qty')], cards.map((c) => [c.rcNo, day(c.rcDate), c.item.name, qty(num(c.plannedQty) + num(c.extraQty))])) } : {}),
          links: [{ label: 'Route cards', href: '/production/route-cards?status=IN_PROGRESS' }],
        };
      }
      const byStage = new Map<string, number>();
      for (const c of cards.filter((x) => x.status === 'IN_PROGRESS')) byStage.set(c.currentStage?.name ?? '—', (byStage.get(c.currentStage?.name ?? '—') ?? 0) + 1);
      const notStarted = cards.filter((c) => c.status === 'OPEN').length;
      return {
        understood: 'Route cards in the shop',
        text: `${plural(cards.length - notStarted, 'route card')} in progress and ${plural(notStarted, 'card')} not started yet.`,
        ...(byStage.size ? { table: table(['Now at stage', R('Cards')], [...byStage.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => [s, String(n)]), 16) } : {}),
        links: [{ label: 'Route cards', href: '/production/route-cards?status=IN_PROGRESS' }],
      };
    },
  },

  {
    id: 'po_status',
    area: 'Purchase',
    label: 'purchase orders',
    permissions: ['purchase_orders.view'],
    examples: ['Status of po 2', 'Open purchase orders'],
    score: (p, f) =>
      p.docs.some((d) => docKind(d) === 'PO') || p.shortDocs.some((s) => s.kind === 'PO')
        ? 9
        : has(p, 'po') && (f.suppliers.length || has(p, 'open', 'pending', 'status', 'to receive', 'not received', 'list')) && !has(p, 'payment', 'pay', 'owe', 'paid')
          ? 6
          : 0,
    async answer(ask) {
      const numbers = await docNumbers(ask, 'PO', async (n) => endsWithNumber(n)((await ask.prisma.purchaseOrder.findMany({ where: { poNo: { endsWith: String(n) } }, orderBy: { id: 'desc' }, take: 50, select: { poNo: true } })).map((x) => x.poNo)));
      if (numbers.length) {
        const po = await ask.prisma.purchaseOrder.findUnique({
          where: { poNo: numbers[0] },
          select: {
            id: true, poNo: true, poDate: true, status: true, type: true, expectedDelivery: true, grandTotal: true, paidAmount: true, currency: true,
            supplier: { select: { name: true } },
            lines: { orderBy: { lineNo: 'asc' }, select: { quantity: true, receivedQty: true, uom: true, description: true, rawMaterial: { select: { size: true, grade: { select: { name: true } } } }, item: { select: { name: true } } } },
          },
        });
        if (!po) return { text: `There is no purchase order ${numbers[0]}.` };
        return {
          understood: `Purchase order ${po.poNo}`,
          text: `${po.poNo} of ${day(po.poDate)} to ${po.supplier.name}${po.type === 'JOB_WORK' ? ' (job work)' : ''}: ${PO_STATUS_LABELS[po.status]}${po.expectedDelivery && ['ISSUED', 'PARTIALLY_RECEIVED'].includes(po.status) ? `, expected ${day(po.expectedDelivery)} (${dueIn(po.expectedDelivery, ask.today)})` : ''}.`,
          facts: [
            { label: 'PO value', value: po.currency === 'INR' ? rupees(num(po.grandTotal)) : `${po.currency} ${qty(num(po.grandTotal))}` },
            ...(ask.can('payments.view') ? [{ label: 'Paid', value: rupees(num(po.paidAmount)) }] : []),
          ],
          table: table(['Material', R('Ordered'), R('Received')], po.lines.map((l) => [l.rawMaterial ? `${l.rawMaterial.grade.name} ${l.rawMaterial.size}` : (l.item?.name ?? l.description ?? '—'), qty(num(l.quantity), l.uom.toLowerCase()), qty(num(l.receivedQty), l.uom.toLowerCase())])),
          links: [{ label: `Open ${po.poNo}`, href: `/purchase/orders/${po.id}` }],
        };
      }
      const supplierIds = ask.ids(ask.found.suppliers, 'supplierId');
      const pos = await ask.prisma.purchaseOrder.findMany({
        where: { status: { in: ['ISSUED', 'PARTIALLY_RECEIVED'] }, ...(supplierIds.length ? { supplierId: { in: supplierIds } } : {}) },
        orderBy: { poDate: 'asc' },
        select: { poNo: true, poDate: true, status: true, expectedDelivery: true, grandTotal: true, supplier: { select: { name: true } } },
      });
      return {
        understood: `Open purchase orders${supplierIds.length ? ` · ${ask.found.suppliers.map((s) => s.name).join(', ')}` : ''}`,
        text: pos.length ? `${plural(pos.length, 'purchase order')} still to receive:` : 'No purchase order is waiting for material.',
        ...(pos.length ? { table: table(['PO', 'Supplier', 'Status', 'Expected', R('Value')], pos.map((x) => [x.poNo, x.supplier.name, PO_STATUS_LABELS[x.status], x.expectedDelivery ? `${day(x.expectedDelivery)} (${dueIn(x.expectedDelivery, ask.today)})` : '—', rupees(num(x.grandTotal))])) } : {}),
        links: [{ label: 'Purchase orders', href: '/purchase/orders?status=ISSUED' }],
        ...(supplierIds.length === 1 ? { params: { supplierId: supplierIds[0] } } : {}),
      };
    },
  },

  {
    id: 'trace',
    area: 'Quality',
    label: 'traceability',
    permissions: ['traceability.view'],
    examples: ['Trace heat A102602', 'Which heats went into SO/26-27/0003?'],
    score: (p) => {
      const heatCode = p.codes.some((c) => HEAT_CODE.test(c));
      const asked = has(p, 'trace', 'traceability', 'mill heat', 'mtc', 'heat', 'heats', 'where did', 'which customer');
      return (heatCode ? 6 : 0) + (asked ? 4 : 0) + (asked && (p.docs.length || p.codes.length) ? 1 : 0);
    },
    async answer(ask) {
      const terms = [...ask.p.docs, ...ask.p.codes.filter((c) => HEAT_CODE.test(c)), ...ask.p.codes, ...ask.p.numbers.filter((n) => n.length >= 3)];
      if (!terms.length) return { text: 'Give a heat no., mill heat no., sales order, invoice or dispatch number to trace. For example: "trace heat A102602".', links: [{ label: 'Traceability', href: '/reports/traceability' }] };
      const term = terms[0].toUpperCase();
      const r = await ask.deps.trace.search(term);
      if (!r.heats.length && !r.orders.length) return { understood: `Trace ${term}`, text: `Nothing found for ${term}.`, links: [{ label: 'Traceability', href: `/reports/traceability?search=${encodeURIComponent(term)}` }] };
      return {
        understood: `Trace ${term}`,
        text: [r.heats.length ? `${plural(r.heats.length, 'heat')} found` : '', r.orders.length ? `${plural(r.orders.length, 'order')} found` : ''].filter(Boolean).join(' and ') + '. Open one to see where it went:',
        ...(r.heats.length ? { table: table(['Heat', 'Mill heat', 'Material', 'Received'], r.heats.map((h) => [h.heatNo, h.millHeatNo ?? '—', `${h.grade} ${h.size}`, day(h.receivedDate)])) } : {}),
        links: [
          ...r.heats.slice(0, 4).map((h) => ({ label: `Heat ${h.heatNo}`, href: `/reports/traceability/heat/${h.id}` })),
          ...r.orders.slice(0, 4).map((o) => ({ label: `${o.soNo} · ${o.customer.name}`, href: `/reports/traceability/order/${o.id}` })),
        ],
      };
    },
  },

  {
    id: 'production',
    area: 'Production',
    label: 'production report',
    permissions: ['reports.view'],
    examples: ['Rejections this month', 'Production last month'],
    score: (p) => (has(p, 'rejection', 'rejections', 'rejected', 'reject', 'scrap', 'production', 'produced', 'output', 'manufactured') ? 6 + (p.period ? 1 : 0) : 0),
    async answer(ask) {
      const period = ask.period(monthPeriod(ask.today.slice(0, 7), ask.today));
      const r = await ask.deps.reports.production({ from: period.from, to: period.to });
      const s = r.summary;
      return {
        understood: `Production · ${period.label}`,
        text: `${cap(period.label)}: ${qty(s.finishedOk)} pieces finished OK and ${qty(s.rejected)} rejected (${s.rejectionRate}% rejection).`,
        facts: [
          { label: 'Cards started', value: qty(s.cardsStarted) },
          { label: 'Cards finished', value: qty(s.cardsFinished) },
          { label: 'Rejection rate', value: `${s.rejectionRate}%`, ...(s.rejectionRate > 2 ? { tone: 'bad' as const } : {}) },
          { label: 'Job work accepted', value: qty(s.jobWorkAccepted) },
        ],
        ...(r.byReason.length ? { table: table(['Rejection reason', R('Pcs')], r.byReason.map((x) => [x.reason, qty(x.rejected)]), 8) } : {}),
        links: [{ label: 'Production report', href: `/reports/production?from=${period.from}&to=${period.to}` }],
        params: periodParams(period),
      };
    },
  },
];
