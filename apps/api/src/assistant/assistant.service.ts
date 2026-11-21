import { Injectable, Logger } from '@nestjs/common';
import { hasPermission, type AssistantAnswer, type AssistantExamples, type AssistantFeedback, type AssistantQuestion } from '@bht/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TraceabilityService } from '../reports/traceability.service';
import { ReportsService } from '../reports/reports.service';
import { BusinessReportsService } from '../reports/business-reports.service';
import { PaymentsService } from '../billing/payments.service';
import { AttendanceService, todayIst } from '../hr/attendance.service';
import type { AuthUser } from '../common/auth-user';
import { AssistantCatalog, type Found } from './catalog';
import { parseQuestion, type Parsed } from './language';
import { Ask, type Deps, type Params, type Topic } from './kit';
import { generalTopics } from './topics/general';
import { stockTopics } from './topics/stock';
import { orderTopics } from './topics/orders';
import { moneyTopics } from './topics/money';
import { peopleTopics } from './topics/people';
import { briefing, briefingTopics } from './topics/briefing';
import { partyTopics } from './topics/parties';
import { billingTopics } from './topics/billing';
import { howtoTopics } from './topics/howto';
import { recordSearch, toolTopics } from './topics/tools';
import { SearchService } from '../dashboard/search.service';
import { NumberingService } from '../core/numbering.service';
import { firstName, smallTalk, smallTalkText, timeGreeting, type SmallTalk } from './persona';
import { DashboardService } from '../dashboard/dashboard.service';
import { brand } from '../config/brand';
import { financialYear, fmtDay } from './language';

/** A topic needs at least this score to answer. */
const MIN_SCORE = 4;

/**
 * "Ask ERP": reads the question, finds what it mentions, picks the topic that fits best and
 * answers from the ERP data with the user's own permissions. All rules are in this code - no outside service.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger('Assistant');
  // order matters only for a tie: data topics first, the "how to" guides last
  private readonly topics: Topic[] = [...generalTopics, ...briefingTopics, ...toolTopics, ...stockTopics, ...orderTopics, ...moneyTopics, ...billingTopics, ...partyTopics, ...peopleTopics, ...howtoTopics];
  private readonly deps: Deps;

  constructor(
    prisma: PrismaService,
    private readonly catalog: AssistantCatalog,
    trace: TraceabilityService,
    reports: ReportsService,
    business: BusinessReportsService,
    payments: PaymentsService,
    attendance: AttendanceService,
    dashboard: DashboardService,
    search: SearchService,
    numbering: NumberingService,
  ) {
    this.deps = { prisma, trace, reports, business, payments, attendance, dashboard, search, numbering };
  }

  private allowed(user: AuthUser) {
    return this.topics.filter((t) => t.permissions.some((p) => hasPermission(user.permissions, p)));
  }

  private examplesOf(t: Topic, user: AuthUser) {
    return t.examples.flatMap((e) => (typeof e === 'string' ? [e] : hasPermission(user.permissions, e.permission) ? [e.q] : []));
  }

  /** Example questions for the topics this user may ask, grouped by area. */
  examples(user: AuthUser): AssistantExamples {
    const areas = new Map<string, string[]>();
    for (const t of this.allowed(user)) areas.set(t.area, [...(areas.get(t.area) ?? []), ...this.examplesOf(t, user)]);
    return { areas: [...areas.entries()].filter(([, examples]) => examples.length).map(([area, examples]) => ({ area, examples })) };
  }

  /** The answer, with each suggested question listed once (and never the question just asked). */
  async ask(input: AssistantQuestion, user: AuthUser): Promise<AssistantAnswer> {
    const a = await this.answer(input, user);
    if (!a.suggestions) return a;
    const asked = input.question.trim().toLowerCase();
    const seen = new Set<string>([asked]);
    const suggestions = a.suggestions.filter((s) => {
      const k = s.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { ...a, suggestions };
  }

  private async answer(input: AssistantQuestion, user: AuthUser): Promise<AssistantAnswer> {
    const today = todayIst();
    const p = parseQuestion(input.question, today, await this.catalog.nameWords());
    const talk = smallTalk(input.question);
    if (talk) return this.chat(talk, p, user, today);
    const note = p.corrections.length ? `Read ${p.corrections.map((c) => `“${c.from}” as “${c.to}”`).join(', ')}.` : undefined;

    const found = await this.catalog.find(p);
    const ranked = this.topics.map((t) => ({ t, score: t.score(p, found) })).sort((a, b) => b.score - a.score);
    let topic = ranked[0].score >= MIN_SCORE ? ranked[0].t : null;
    let prev: Params = {};
    // a follow-up such as "and last month?" or "what about 102?": the previous topic with the new period / name
    if (!topic && input.context && (p.period || p.docs.length || p.shortDocs.length || mentionsSomething(found))) {
      topic = this.topics.find((t) => t.id === input.context!.topic) ?? null;
      prev = input.context.params;
    }
    if (!topic) return this.notUnderstood(input.question, p, found, user, today);
    if (!topic.permissions.some((perm) => hasPermission(user.permissions, perm))) {
      return {
        topic: null,
        understood: 'Not in your access',
        text: `Sorry, ${firstName(user.name)} - your role does not include ${topic.label}, so I cannot show it. If you need it for your work, please ask the administrator to give your role access.`,
        suggestions: this.someExamples(user, 4),
      };
    }

    try {
      const { params, ...reply } = await topic.answer(new Ask(p, found, user, today, this.deps, prev));
      const suggestions = reply.suggestions?.length ? reply.suggestions : this.related(topic, user, input.question);
      return { topic: topic.id, ...reply, suggestions, ...(note ? { note } : {}), context: { topic: topic.id, params: params ?? {} } };
    } catch (err) {
      this.logger.error(`"${input.question}" (${topic.id}): ${err instanceof Error ? err.stack : String(err)}`);
      return { topic: topic.id, understood: 'Something went wrong', text: 'Sorry, I could not read that data just now. Please try again in a moment - or open the screen from the menu.' };
    }
  }

  /** A few other questions of the same area, to carry on with. */
  private related(topic: Topic, user: AuthUser, asked: string) {
    const same = this.allowed(user).filter((t) => t.area === topic.area);
    const q = asked.trim().toLowerCase();
    return [...same.filter((t) => t !== topic), topic]
      .flatMap((t) => this.examplesOf(t, user))
      .filter((e) => e.toLowerCase() !== q)
      .slice(0, 3);
  }

  /** One example per topic the user may ask. */
  private someExamples(user: AuthUser, n: number) {
    return this.allowed(user)
      .map((t) => this.examplesOf(t, user)[0])
      .filter((e): e is string => !!e)
      .slice(0, n);
  }

  private help(user: AuthUser): AssistantAnswer {
    const examples = this.someExamples(user, 8);
    const areas = [...new Set(this.allowed(user).map((t) => t.area).filter((a) => a !== 'General' && a !== 'Help'))].map((a) => (a === 'HR' ? 'HR' : a.toLowerCase()));
    const areaText = areas.length > 1 ? `${areas.slice(0, -1).join(', ')} and ${areas[areas.length - 1]}` : (areas[0] ?? 'the ERP');
    return {
      topic: null,
      understood: `How I can help, ${firstName(user.name)}`,
      text: areas.length
        ? `You can ask me about ${areaText}. I answer from live ERP data and link to the related screen. I can also provide today's overview, your pending work, and step-by-step guidance, for example "How to make an invoice". Some questions to start with:`
        : 'Your role does not include any data area yet. I can still guide you through ERP processes, for example "How to make an invoice".',
      suggestions: ["Today's summary", 'What is pending for me?', ...examples.filter((e) => e !== "Today's summary" && e !== 'What is pending for me?')].slice(0, 8),
    };
  }

  /** Greetings, thanks, "who are you" ...: a friendly reply, with today's summary where it fits. */
  private async chat(kind: SmallTalk, p: Parsed, user: AuthUser, today: string): Promise<AssistantAnswer> {
    if (kind === 'help') return this.help(user);
    if (kind === 'date') {
      const fy = financialYear(today);
      const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
      return { topic: null, understood: 'Today', text: `Today is ${weekday}, ${fmtDay(today)}. We are in financial year ${fy.label}.`, suggestions: ["Today's summary"] };
    }
    if (kind === 'greeting' || kind === 'how_are_you') {
      const ask = new Ask(p, await this.catalog.find(p), user, today, this.deps);
      const t = kind === 'how_are_you' ? smallTalkText(kind, user.name, brand().name) : null;
      const { params: _params, ...reply } = await briefing(ask, t?.title ?? `${timeGreeting()}, ${firstName(user.name)}`, t?.text ?? 'Here is an overview of today.');
      return { topic: 'briefing', ...reply, context: { topic: 'briefing', params: {} } };
    }
    const t = smallTalkText(kind, user.name, brand().name);
    return {
      topic: null,
      understood: t.title,
      text: t.text,
      suggestions: kind === 'bye' ? [] : ["Today's summary", 'What is pending for me?', ...this.someExamples(user, 2)].slice(0, 4),
    };
  }

  /** "Was this helpful?" - written to the API log, so wrong or missing answers can be added to the topics. */
  feedback(input: AssistantFeedback, user: AuthUser) {
    this.logger.log(`Feedback ${input.helpful ? 'helpful' : 'NOT helpful'} (${input.topic ?? 'not understood'}) from ${user.username}: "${input.question}"`);
    return { ok: true };
  }

  /**
   * Not understood: first look for records with that text (a customer, an order number, a heat …);
   * else suggest questions about what was named, else general examples.
   */
  private async notUnderstood(question: string, p: Parsed, found: Found, user: AuthUser, today: string): Promise<AssistantAnswer> {
    this.logger.log(`Not understood: "${question}"`);
    try {
      const hit = await recordSearch(new Ask(p, found, user, today, this.deps));
      if (hit) {
        const { params: _params, ...reply } = hit;
        return { topic: 'find', ...reply, text: `I did not find a question in that, but these records match. ${reply.text}` };
      }
    } catch (err) {
      this.logger.error(`Search fallback for "${question}": ${err instanceof Error ? err.message : String(err)}`);
    }
    const can = (perm: string) => hasPermission(user.permissions, perm);
    const ideas: string[] = [];
    const c = found.customers[0];
    if (c) {
      ideas.push(`About ${c.name}`);
      if (can('sales_orders.view')) ideas.push(`Open orders of ${c.name}`);
      if (can('payments.view')) ideas.push(`Outstanding of ${c.name}`);
      if (can('business_reports.view')) ideas.push(`Sales of ${c.name} this year`);
    }
    const e = found.employees[0];
    if (e) {
      if (can('employees.view')) ideas.push(`Details of ${e.code}`);
      if (can('attendance.view')) ideas.push(`Attendance of ${e.code} this month`);
      if (can('leaves.view')) ideas.push(`Leave balance of ${e.code}`);
    }
    if (found.materials.length && can('stock.view')) ideas.push(`Stock of ${found.materials[0].grade} ${found.materials[0].size.toLowerCase()}`);
    if (p.codes.length && can('traceability.view')) ideas.push(`Trace ${p.codes[0].toUpperCase()}`);
    return {
      topic: null,
      understood: 'Not sure what you mean',
      text: ideas.length
        ? `I found ${c?.name ?? e?.name ?? 'a name'} in your question, but not what you would like to know. Did you mean one of these?`
        : 'Sorry, I could not understand the question. Please try a short question such as "Stock of 4130 90 round", "Sales this month" or "How to make an invoice", or choose one of these:',
      suggestions: ideas.length ? ideas.slice(0, 5) : ["Today's summary", ...this.someExamples(user, 5)],
    };
  }
}

const mentionsSomething = (f: Found) =>
  f.customers.length + f.suppliers.length + f.employees.length + f.departments.length + f.materials.length + f.items.length + f.products.length > 0;
