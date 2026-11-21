import { WORK_LISTS, workListText } from '@bht/shared';
import { PaymentDirection } from '../../generated/prisma/client';
import { fmtDay, has } from '../language';
import { firstName, timeGreeting } from '../persona';
import { plural, R, rupees, table, type Ask, type Reply, type Topic } from '../kit';

type Fact = NonNullable<Reply['facts']>[number];

/** Work lists with something waiting for this user, biggest first (urgent ones on top). */
export async function waitingWork(ask: Ask) {
  const tasks = await ask.deps.dashboard.tasks(ask.user);
  return WORK_LISTS.map((w) => ({ ...workListText(w, tasks.payrollLastMonth), n: tasks[w.key] ?? 0, urgent: 'urgent' in w && w.urgent }))
    .filter((w) => w.n > 0)
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.n - a.n);
}

/** Percent change, "+12%" / "−8%", or null when there is nothing to compare with. */
export function change(now: number, before: number): string | null {
  if (before <= 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`;
}

/**
 * Today at a glance, for this user's role: money, orders, production, stock, people and their own waiting work.
 * Every part is only read when the user may see that screen.
 */
export async function briefing(ask: Ask, title?: string, intro?: string): Promise<Reply> {
  const facts: Fact[] = [];
  const notes: string[] = [];
  const today = ask.today;
  const dayStart = new Date(`${today}T00:00:00Z`);

  const [money, salesToday, receivable, work, openOrders, waitingApproval, runningCards, lowStock, dispatchedToday, attendance] = await Promise.all([
    ask.can('business_reports.view') ? ask.deps.business.dashboard() : null,
    ask.can('business_reports.view') ? ask.deps.business.sales({ from: today, to: today, view: 'customer' }) : null,
    ask.can('payments.view') ? ask.deps.payments.outstanding(PaymentDirection.RECEIPT) : null,
    waitingWork(ask),
    ask.can('sales_orders.view') ? ask.prisma.salesOrder.count({ where: { status: { in: ['APPROVED', 'IN_PRODUCTION', 'PARTIALLY_DISPATCHED'] } } }) : null,
    ask.can('sales_orders.view') ? ask.prisma.salesOrder.count({ where: { status: 'PENDING_APPROVAL' } }) : null,
    ask.can('route_cards.view') ? ask.prisma.routeCard.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }) : null,
    ask.can('stock.view')
      ? ask.prisma.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*) AS n FROM (
            SELECT rm.id FROM raw_materials rm
            LEFT JOIN stock_balances sb ON sb.raw_material_id = rm.id AND sb.location = 'RM_STORE'
            WHERE rm.is_active = 1 AND rm.reorder_level > 0
            GROUP BY rm.id, rm.reorder_level
            HAVING COALESCE(SUM(sb.quantity), 0) < rm.reorder_level) x`.then((r) => Number(r[0]?.n ?? 0))
      : null,
    ask.can('dispatches.view') ? ask.prisma.dispatch.count({ where: { dispatchDate: dayStart, cancelledAt: null } }) : null,
    ask.can('attendance.view') ? ask.deps.attendance.day(today, {}) : null,
  ]);

  if (money && salesToday?.view === 'customer') {
    const t = salesToday.totals;
    facts.push({ label: 'Sales today', value: t.invoices ? rupees(t.total) : '₹0' });
    facts.push({ label: 'Sales this month', value: rupees(money.sales.thisMonth) });
    facts.push({ label: 'Received this month', value: rupees(money.receivedThisMonth), tone: 'good' });
  }
  if (receivable) {
    const inr = (r: (typeof receivable)[number]) => r.balance * (r.exchangeRate || 1);
    const overdue = receivable.filter((r) => r.overdueDays > 0);
    const overdueAmt = overdue.reduce((s, r) => s + inr(r), 0);
    facts.push({ label: 'Overdue from customers', value: rupees(overdueAmt), ...(overdueAmt > 0 ? { tone: 'bad' as const } : {}) });
    const oldest = overdue.sort((a, b) => b.overdueDays - a.overdueDays)[0];
    if (oldest && oldest.overdueDays > 30) notes.push(`${oldest.party.name} is ${plural(oldest.overdueDays, 'day')} late on ${oldest.number} (${rupees(inr(oldest))}).`);
  }
  if (openOrders !== null) facts.push({ label: 'Open sales orders', value: String(openOrders) });
  if (waitingApproval) notes.push(`${plural(waitingApproval, 'sales order is', 'sales orders are')} waiting for approval.`);
  if (runningCards !== null) facts.push({ label: 'Route cards running', value: String(runningCards) });
  if (dispatchedToday !== null) facts.push({ label: 'Dispatched today', value: String(dispatchedToday) });
  if (attendance) {
    const present = attendance.rows.filter((r) => r.punches.length).length;
    facts.push({ label: 'Present today', value: `${present} of ${attendance.rows.length}` });
  }
  if (lowStock) notes.push(`${plural(lowStock, 'raw material is', 'raw materials are')} below the reorder level.`);

  const name = firstName(ask.user.name);
  const waitingTotal = work.reduce((s, w) => s + w.n, 0);
  const text =
    (intro ?? `Here is an overview of today, ${name}.`) +
    (work.length ? ` You have ${plural(waitingTotal, 'item')} waiting in ${plural(work.length, 'work list')}${work[0] ? ` - start with "${work[0].label}"` : ''}.` : ' Nothing is waiting for you right now.');
  return {
    understood: title ?? `${timeGreeting()}, ${name} · ${fmtDay(today)}`,
    text,
    ...(facts.length ? { facts } : {}),
    ...(work.length ? { table: table(['Waiting for you', R('Count')], work.map((w) => [w.label, String(w.n)]), 8) } : {}),
    ...(notes.length ? { insight: notes.join(' ') } : {}),
    links: [{ label: 'Dashboard', href: '/dashboard' }, ...work.slice(0, 2).map((w) => ({ label: w.label, href: w.href }))],
    suggestions: [
      ...(ask.can('payments.view') ? ['Who owes us money?'] : []),
      ...(ask.can('reports.view') ? ['Pending orders'] : []),
      ...(ask.can('business_reports.view') ? ['Sales this month'] : []),
      ...(ask.can('attendance.view') ? ['Who is absent today?'] : []),
      ...(ask.can('stock.view') ? ['Which raw material is below reorder level?'] : []),
    ].slice(0, 4),
  };
}

const BRIEFING_WORDS = ['summary', 'briefing', 'brief', 'overview', 'highlights', 'at a glance', 'whats happening', 'what is happening', 'what happened', 'how is business', 'how are things', 'update', 'updates', 'today status', 'status today', 'report card', 'daily report', 'aaj nu', 'situation'];
const SPECIFIC = ['sales', 'sale', 'stock', 'rm', 'fg', 'attendance', 'absent', 'present', 'salary', 'leave', 'production', 'invoice', 'invoices', 'order', 'orders', 'so', 'po', 'payment', 'payments', 'outstanding', 'dispatch'];
const MY_WORK_WORDS = ['my work', 'my task', 'my tasks', 'to do', 'todo', 'to-do', 'pending for me', 'pending work', 'my pending', 'waiting for me', 'work waiting', 'what should i do', 'what to do', 'what do i do', 'my job', 'my jobs', 'kaam', 'mara kaam', 'mera kaam', 'tasks', 'task'];

export const briefingTopics: Topic[] = [
  {
    id: 'briefing',
    area: 'General',
    label: 'the daily summary',
    permissions: ['assistant.view'],
    examples: ["Today's summary"],
    score: (p) => (has(p, ...BRIEFING_WORDS) && !has(p, ...SPECIFIC) ? 7 : 0),
    answer: (ask) => briefing(ask),
  },
  {
    id: 'my_work',
    area: 'General',
    label: 'your work lists',
    permissions: ['assistant.view'],
    examples: ['What is pending for me?'],
    score: (p) => (has(p, ...MY_WORK_WORDS) ? 8 : 0),
    async answer(ask) {
      const work = await waitingWork(ask);
      const name = firstName(ask.user.name);
      if (!work.length) {
        return {
          understood: 'Your work lists',
          text: `Nothing is waiting for you right now, ${name}.`,
          links: [{ label: 'Dashboard', href: '/dashboard' }],
        };
      }
      const total = work.reduce((s, w) => s + w.n, 0);
      const urgent = work.filter((w) => w.urgent);
      return {
        understood: 'Your work lists',
        text: `${name}, you have ${plural(total, 'item')} waiting in ${plural(work.length, 'work list')}. Most urgent first:`,
        table: table(['Work list', R('Waiting')], work.map((w) => [w.label, String(w.n)]), 12),
        ...(urgent.length ? { insight: `Needs attention first: ${urgent.map((u) => `${u.label.toLowerCase()} (${u.n})`).join(', ')}.` } : {}),
        links: work.slice(0, 3).map((w) => ({ label: w.label, href: w.href })),
      };
    },
  },
];
