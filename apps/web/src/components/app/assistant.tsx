'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Calculator,
  Check,
  Copy,
  Download,
  Hash,
  History,
  Lightbulb,
  ListTodo,
  Pin,
  PinOff,
  Plus,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Sun,
  ThumbsDown,
  ThumbsUp,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { AssistantAnswer, AssistantExamples } from '@bht/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useApiQuery } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { ColumnChart, compactInr } from '@/components/reports/column-chart';
import { BarList } from '@/components/reports/mini-charts';
import { useSession } from './session';

type Message =
  | { id: number; from: 'user'; text: string; at?: string }
  | { id: number; from: 'erp'; answer: AssistantAnswer; question?: string; at?: string }
  | { id: number; from: 'error'; text: string; at?: string };
interface Saved {
  messages: Message[];
  context?: AssistantAnswer['context'];
}

const KEEP = 40;
const RECENT_MAX = 20;
/** Other screens can open Ask ERP with a question: window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: 'stock of 4130' })) */
export const ASK_EVENT = 'erp:ask';

const SHORTCUTS: { label: string; ask: string; icon: LucideIcon }[] = [
  { label: "Today's summary", ask: "Today's summary", icon: Sun },
  { label: 'My pending work', ask: 'What is pending for me?', icon: ListTodo },
  { label: 'How do I…', ask: 'How to', icon: BookOpen },
  { label: 'GST calculator', ask: '18% GST on 10000', icon: Calculator },
  { label: 'Next numbers', ask: 'Next document numbers', icon: Hash },
];

/** Which example area fits the screen being shown. */
function areaOfPath(path: string): string | null {
  if (/^\/(billing|reports\/(sales|ageing|purchases))/.test(path)) return 'Money';
  if (/^\/(sales|dispatch)/.test(path)) return 'Sales';
  if (/^\/(production|job-work|reports\/production)/.test(path)) return 'Production';
  if (/^\/(store|masters\/(raw-materials|heats|items)|reports\/stock)/.test(path)) return 'Stock';
  if (/^\/purchase/.test(path)) return 'Purchase';
  if (/^\/(quality|reports\/traceability)/.test(path)) return 'Quality';
  if (/^\/hr/.test(path)) return 'HR';
  return null;
}

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

/** "Ask ERP": the top-bar button, Ctrl+J, and the question window. Answers come from the ERP itself, with the user's permissions. */
export function AssistantLauncher() {
  const { user, can } = useSession();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const allowed = can('assistant.view');

  useEffect(() => {
    if (!allowed) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (typeof q === 'string' && q.trim()) setPending(q.trim());
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(ASK_EVENT, onAsk);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(ASK_EVENT, onAsk);
    };
  }, [allowed]);

  if (!allowed) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label="Ask ERP (Ctrl+J)" title="Ask ERP (Ctrl+J)" className="gap-1.5">
        <Sparkles className="text-primary" /> <span className="hidden sm:inline">Ask ERP</span>
      </Button>
      <Chat key={user.id} userId={user.id} userName={user.name} open={open} onOpenChange={setOpen} pending={pending} onPendingDone={() => setPending(null)} />
    </>
  );
}

function Chat({
  userId,
  userName,
  open,
  onOpenChange,
  pending,
  onPendingDone,
}: {
  userId: number;
  userName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pending: string | null;
  onPendingDone: () => void;
}) {
  const storageKey = `erp.assistant.${userId}`;
  const recentKey = `erp.assistant.recent.${userId}`;
  const pinsKey = `erp.assistant.pins.${userId}`;
  const [saved, setSaved] = useState<Saved>({ messages: [] });
  const [recent, setRecent] = useState<string[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const examples = useApiQuery<AssistantExamples>('/assistant/examples', undefined, open);
  const pathname = usePathname();

  // the conversation survives a page refresh in this tab; recent and pinned questions stay in this browser
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const s = JSON.parse(raw) as Saved;
        setSaved(s);
        nextId.current = Math.max(0, ...s.messages.map((m) => m.id)) + 1;
      }
    } catch {
      /* storage unavailable */
    }
    setRecent(readList(recentKey));
    setPins(readList(pinsKey));
  }, [storageKey, recentKey, pinsKey]);

  const store = (s: Saved) => {
    setSaved(s);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ ...s, messages: s.messages.slice(-KEEP) }));
    } catch {
      /* storage unavailable */
    }
  };

  const remember = (q: string) =>
    setRecent((cur) => {
      const next = [q, ...cur.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
      writeList(recentKey, next);
      return next;
    });
  const togglePin = (q: string) =>
    setPins((cur) => {
      const has = cur.some((x) => x.toLowerCase() === q.toLowerCase());
      const next = has ? cur.filter((x) => x.toLowerCase() !== q.toLowerCase()) : [q, ...cur].slice(0, 12);
      writeList(pinsKey, next);
      toast.success(has ? 'Removed from pinned questions' : 'Pinned - one click away in the side panel');
      return next;
    });

  // Keep the newest question at the top of the window, so its answer is read from the start.
  const lastQuestionId = [...saved.messages].reverse().find((m) => m.from === 'user')?.id;
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const log = logRef.current;
      if (!log) return;
      const el = lastQuestionId ? log.querySelector<HTMLElement>(`[data-msg="${lastQuestionId}"]`) : null;
      const target = el ? Math.max(0, el.offsetTop - 16) : 0;
      const spacer = spacerRef.current;
      if (spacer) {
        spacer.style.height = '0px';
        spacer.style.height = `${Math.max(0, target + log.clientHeight - log.scrollHeight)}px`;
      }
      log.scrollTo({ top: target, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [lastQuestionId, saved.messages.length, busy, open]);

  const ask = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;
      const at = new Date().toISOString();
      const withQuestion: Saved = { ...saved, messages: [...saved.messages, { id: nextId.current++, from: 'user', text: question, at }] };
      store(withQuestion);
      setDraft('');
      setBusy(true);
      remember(question);
      try {
        const answer = await api<AssistantAnswer>('/assistant/ask', { method: 'POST', body: { question, context: saved.context } });
        // not understood: keep the earlier context so a follow-up still works
        store({
          messages: [...withQuestion.messages, { id: nextId.current++, from: 'erp', answer, question, at: new Date().toISOString() }],
          context: answer.context ?? saved.context,
        });
      } catch (err) {
        store({
          ...withQuestion,
          messages: [...withQuestion.messages, { id: nextId.current++, from: 'error', text: err instanceof Error ? err.message : 'The ERP could not be reached', at: new Date().toISOString() }],
        });
      } finally {
        setBusy(false);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, saved],
  );

  // a question sent from elsewhere (Ctrl+K "Ask ERP", a button on a screen)
  useEffect(() => {
    if (open && pending) {
      onPendingDone();
      void ask(pending);
    }
  }, [open, pending, onPendingDone, ask]);

  const allExamples = useMemo(() => examples.data?.areas.flatMap((a) => a.examples) ?? [], [examples.data]);
  const screenArea = areaOfPath(pathname);
  const newChat = () => store({ messages: [] });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="flex h-[min(860px,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-6xl flex-row gap-0 overflow-hidden p-0 max-sm:inset-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0"
      >
        {/* ------------------------------------------------ side panel */}
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/30 md:flex" aria-label="Your questions">
          <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
            <Avatar size="lg" />
            <div className="min-w-0 leading-tight">
              <div className="text-sm font-semibold">Ask ERP</div>
              <div className="text-[11px] text-muted-foreground">Your ERP assistant</div>
            </div>
          </div>
          <div className="px-3 pb-3">
            <Button variant="outline" className="w-full justify-start" onClick={newChat} disabled={!saved.messages.length}>
              <Plus /> New conversation
            </Button>
          </div>
          <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-3">
            <SideSection title="Shortcuts">
              {SHORTCUTS.map((s) => (
                <SideItem key={s.ask} icon={s.icon} text={s.label} onClick={() => void ask(s.ask)} disabled={busy} />
              ))}
            </SideSection>
            <SideSection title="Pinned" empty={!pins.length ? 'Pin a question from its answer to keep it here.' : undefined}>
              {pins.map((q) => (
                <SideItem key={q} icon={Pin} text={q} onClick={() => void ask(q)} disabled={busy} onRemove={() => togglePin(q)} removeLabel="Unpin" />
              ))}
            </SideSection>
            <SideSection title="Recent" empty={!recent.length ? 'Your questions show here.' : undefined}>
              {recent.slice(0, 12).map((q) => (
                <SideItem key={q} icon={History} text={q} onClick={() => void ask(q)} disabled={busy} />
              ))}
            </SideSection>
          </nav>
          <div className="space-y-1.5 border-t px-4 py-3 text-[11px] leading-snug text-muted-foreground">
            <p className="flex gap-1.5">
              <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" aria-hidden />
              Answers come only from your ERP data, within what your role may see.
            </p>
            <p className="flex items-center gap-1.5">
              <Kbd>Ctrl J</Kbd> opens Ask ERP anywhere
            </p>
          </div>
        </aside>

        {/* ------------------------------------------------ conversation */}
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-5">
            <span className="md:hidden">
              <Avatar size="lg" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">{saved.messages.length ? 'Conversation' : 'Ask ERP'}</DialogTitle>
              <DialogDescription className="flex items-center gap-1.5 text-xs">
                <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                <span className="truncate">Live ERP data · only what your role allows</span>
              </DialogDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="md:hidden" aria-label="Recent and pinned questions">
                  <History />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
                {pins.length > 0 && <DropdownMenuLabel>Pinned</DropdownMenuLabel>}
                {pins.map((q) => (
                  <DropdownMenuItem key={`p-${q}`} onSelect={() => void ask(q)}>
                    <Pin /> <span className="truncate">{q}</span>
                  </DropdownMenuItem>
                ))}
                {pins.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>Recent</DropdownMenuLabel>
                {recent.length ? (
                  recent.slice(0, 10).map((q) => (
                    <DropdownMenuItem key={`r-${q}`} onSelect={() => void ask(q)}>
                      <History /> <span className="truncate">{q}</span>
                    </DropdownMenuItem>
                  ))
                ) : (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">No questions yet.</p>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {saved.messages.length > 0 && (
              <Button type="button" variant="outline" size="sm" className="md:hidden" onClick={newChat} aria-label="New conversation">
                <Plus />
              </Button>
            )}
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label="Close">
              <X />
            </Button>
          </header>

          <div ref={logRef} role="log" aria-live="polite" aria-label="Conversation" className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/20">
            <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
              {saved.messages.length === 0 && <Welcome name={userName} examples={examples.data} screenArea={screenArea} onAsk={ask} />}
              {saved.messages.map((m) =>
                m.from === 'user' ? (
                  <div key={m.id} data-msg={m.id} className="flex scroll-mt-4 flex-col items-end gap-1">
                    <p className="max-w-[80%] rounded-xl rounded-br-md bg-primary px-4 py-2 text-sm whitespace-pre-wrap text-primary-foreground">{m.text}</p>
                    {m.at && <span className="pr-1 text-[10.5px] text-muted-foreground">{timeOf(m.at)}</span>}
                  </div>
                ) : m.from === 'error' ? (
                  <p key={m.id} role="alert" className="rounded-lg border border-destructive/40 bg-destructive/8 px-4 py-2.5 text-sm text-destructive">
                    {m.text}
                  </p>
                ) : (
                  <Answer
                    key={m.id}
                    answer={m.answer}
                    question={m.question}
                    at={m.at}
                    pinned={!!m.question && pins.some((x) => x.toLowerCase() === m.question!.toLowerCase())}
                    onPin={m.question ? () => togglePin(m.question!) : undefined}
                    onAsk={ask}
                    onNavigate={() => onOpenChange(false)}
                  />
                ),
              )}
              {busy && (
                <div className="flex items-center gap-2.5 text-xs text-muted-foreground" aria-label="Looking it up">
                  <Avatar />
                  <span className="flex gap-1 rounded-xl rounded-tl-md border bg-card px-3 py-2.5">
                    {[0, 150, 300].map((d) => (
                      <span key={d} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </span>
                  Checking the ERP…
                </div>
              )}
            </div>
            <div ref={spacerRef} aria-hidden />
          </div>

          <Composer draft={draft} setDraft={setDraft} busy={busy} onAsk={ask} pool={[...pins, ...recent, ...allExamples]} inputRef={inputRef} />
        </section>
      </DialogContent>
    </Dialog>
  );
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

function SideSection({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
      {empty ? <p className="px-2 text-xs text-muted-foreground/80">{empty}</p> : <ul className="space-y-px">{children}</ul>}
    </section>
  );
}

function SideItem({ icon: Icon, text, onClick, disabled, onRemove, removeLabel }: { icon: LucideIcon; text: string; onClick: () => void; disabled?: boolean; onRemove?: () => void; removeLabel?: string }) {
  return (
    <li className="group/side relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={text}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 pr-7 text-left text-[13px] text-foreground/85 transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{text}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${removeLabel ?? 'Remove'} ${text}`}
          className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 group-hover/side:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </li>
  );
}

/** The question box, with suggestions from pinned, recent and example questions as you type. */
function Composer({
  draft,
  setDraft,
  busy,
  onAsk,
  pool,
  inputRef,
}: {
  draft: string;
  setDraft: (v: string) => void;
  busy: boolean;
  onAsk: (q: string) => void;
  pool: string[];
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [active, setActive] = useState(-1);
  const [closed, setClosed] = useState(false);
  const q = draft.trim().toLowerCase();
  const matches = useMemo(() => {
    if (q.length < 2) return [];
    const seen = new Set<string>();
    return pool.filter((x) => {
      const k = x.toLowerCase();
      if (seen.has(k) || k === q || !k.includes(q)) return false;
      seen.add(k);
      return true;
    }).slice(0, 6);
  }, [pool, q]);
  const show = !closed && matches.length > 0;

  return (
    <footer className="border-t bg-card">
      <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6">
        <form
          className="relative flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onAsk(draft);
          }}
        >
          {show && (
            <ul role="listbox" aria-label="Suggested questions" className="absolute right-0 bottom-full left-0 mb-2 overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
              {matches.map((m, i) => (
                <li key={m} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => onAsk(m)}
                    className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm', i === active && 'bg-accent')}
                  >
                    <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="truncate">{m}</span>
                  </button>
                </li>
              ))}
              <li className="px-3 pt-1 pb-0.5 text-[10.5px] text-muted-foreground">↑ ↓ to choose · Tab to fill in · Enter to ask</li>
            </ul>
          )}
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setActive(-1);
              setClosed(false);
            }}
            onKeyDown={(e) => {
              if (show && e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, matches.length - 1));
              } else if (show && e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, -1));
              } else if (show && e.key === 'Tab' && matches.length) {
                e.preventDefault();
                setDraft(matches[Math.max(0, active)]);
                setClosed(true);
              } else if (e.key === 'Escape' && show) {
                e.preventDefault();
                e.stopPropagation();
                setClosed(true);
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onAsk(show && active >= 0 ? matches[active] : draft);
              }
            }}
            rows={1}
            maxLength={300}
            autoFocus
            placeholder="Ask about orders, stock, money, people… or type “find” and a name"
            aria-label="Your question"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-input bg-background px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
          />
          <Button type="submit" disabled={!draft.trim() || busy} aria-label="Ask" className="h-11 rounded-lg px-4">
            <SendHorizontal /> <span className="hidden sm:inline">Ask</span>
          </Button>
        </form>
        <p className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>Enter to ask · Shift + Enter for a new line</span>
          {draft.length > 240 && <span className="tabular">{300 - draft.length} letters left</span>}
        </p>
      </div>
    </footer>
  );
}

/** The assistant's face: the same small round mark on every answer. */
function Avatar({ size = 'sm', className }: { size?: 'sm' | 'lg'; className?: string }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground',
        size === 'lg' ? 'size-9 [&_svg]:size-[18px]' : 'size-7 rounded-lg [&_svg]:size-4',
        className,
      )}
      aria-hidden
    >
      <Sparkles />
    </span>
  );
}

/** Empty conversation: a greeting, shortcuts, questions for this screen, then examples by area. */
function Welcome({ name, examples, screenArea, onAsk }: { name: string; examples?: AssistantExamples; screenArea: string | null; onAsk: (q: string) => void }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const forScreen = screenArea ? examples?.areas.find((a) => a.area === screenArea) : undefined;
  const areas = examples?.areas.filter((a) => a.area !== 'General' && a.area !== screenArea) ?? [];
  return (
    <div className="space-y-6">
      <div className="pt-2 text-center">
        <div className="mx-auto mb-3 w-fit">
          <Avatar size="lg" className="size-12 rounded-xl [&_svg]:size-6" />
        </div>
        <h2 className="text-xl font-semibold tracking-[-0.01em]">
          {greeting}, {name.split(' ')[0]}
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Ask in plain words - orders, stock, production, money, HR. I answer from live ERP data, show charts, and open the right screen.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {SHORTCUTS.slice(0, 3).map((q) => (
          <button
            key={q.ask}
            type="button"
            onClick={() => onAsk(q.ask)}
            className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-3 text-left text-[13px] font-medium transition-colors hover:border-primary/40 hover:bg-accent"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <q.icon className="size-4" aria-hidden />
            </span>
            {q.label}
          </button>
        ))}
      </div>
      {forScreen && (
        <section aria-label="For this screen" className="rounded-lg border border-primary/20 bg-accent/40 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-accent-foreground uppercase">
            <Lightbulb className="size-3.5" aria-hidden /> For this screen · {forScreen.area}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {forScreen.examples.slice(0, 8).map((q) => (
              <button key={q} type="button" onClick={() => onAsk(q)} className="rounded-full border bg-card px-3 py-1 text-[13px] transition-colors hover:border-primary/50 hover:bg-accent">
                {q}
              </button>
            ))}
          </div>
        </section>
      )}
      {areas.map((a) => (
        <section key={a.area} aria-label={a.area}>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{a.area}</h3>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {a.examples.map((q) => (
              <button
                key={`${a.area}-${q}`}
                type="button"
                onClick={() => onAsk(q)}
                className="group flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left text-[13px] transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <span className="flex-1">{q}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The answer as plain text, for "Copy". */
function asText(a: AssistantAnswer) {
  const lines = [a.understood, a.text, ...(a.steps ?? []).map((st, i) => `${i + 1}. ${st}`), ...(a.facts ?? []).map((f) => `${f.label}: ${f.value}`), a.insight].filter(Boolean) as string[];
  if (a.table) {
    lines.push('', a.table.columns.map((c) => c.label).join('\t'), ...a.table.rows.map((r) => r.join('\t')));
    if (a.table.more) lines.push(`+ ${a.table.more} more`);
  }
  return lines.join('\n');
}

/** The answer's table as a CSV file (Excel opens it). */
function downloadCsv(a: AssistantAnswer) {
  if (!a.table) return;
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [a.table.columns.map((c) => esc(c.label)).join(','), ...a.table.rows.map((r) => r.map(esc).join(','))].join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(a.understood ?? 'answer').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'answer'}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const qtyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const moneyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** A chart in an answer: bars by name, or columns by month (the numbers are also in the text / table). */
function AnswerChart({ chart }: { chart: NonNullable<AssistantAnswer['chart']> }) {
  const format = chart.unit === 'money' ? (v: number) => `₹${moneyFmt.format(v)}` : (v: number) => qtyFmt.format(v);
  if (chart.kind === 'bars') {
    return (
      <div className="rounded-lg border px-3 py-2">
        <div className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">{chart.title}</div>
        <BarList label={chart.title} format={format} rows={chart.points.map((p, i) => ({ key: `${i}-${p.label}`, label: p.label, value: p.values[0] ?? 0 }))} />
      </div>
    );
  }
  const colors = ['var(--chart-1)', 'var(--chart-2)'];
  return (
    <div className="rounded-lg border px-3 pt-3 pb-1">
      <ColumnChart
        title={chart.title}
        series={chart.series.map((s, i) => ({ label: s, color: colors[i] ?? colors[0] }))}
        data={chart.points.map((p) => ({ label: p.label, short: p.label.slice(0, 3), values: p.values }))}
        format={format}
        tick={chart.unit === 'money' ? compactInr : (v) => qtyFmt.format(v)}
        height={190}
      />
    </div>
  );
}

function Answer({
  answer: a,
  question,
  at,
  pinned,
  onPin,
  onAsk,
  onNavigate,
}: {
  answer: AssistantAnswer;
  question?: string;
  at?: string;
  pinned: boolean;
  onPin?: () => void;
  onAsk: (q: string) => void;
  onNavigate: () => void;
}) {
  const [vote, setVote] = useState<'up' | 'down' | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText(a));
      toast.success('Answer copied');
    } catch {
      toast.error('Copy is not allowed in this browser');
    }
  };
  const sendVote = (helpful: boolean) => {
    setVote(helpful ? 'up' : 'down');
    if (!question) return;
    void api('/assistant/feedback', { method: 'POST', body: { question, topic: a.topic, helpful } }).catch(() => undefined);
  };
  const linkClass = 'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-accent';
  return (
    <div className="flex gap-2.5">
      <Avatar className="max-sm:hidden" />
      <div className="min-w-0 flex-1 space-y-2.5">
        <article data-slot="answer" className="overflow-hidden rounded-xl rounded-tl-md border bg-card">
          <header className="flex items-center gap-1 border-b bg-muted/40 py-1.5 pr-1.5 pl-4">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{a.understood ?? 'Ask ERP'}</h3>
            {at && <span className="mr-1 hidden text-[10.5px] text-muted-foreground sm:inline">{timeOf(at)}</span>}
            {onPin && a.topic && (
              <Button variant="ghost" size="icon-sm" onClick={onPin} aria-label={pinned ? 'Unpin this question' : 'Pin this question'} title={pinned ? 'Unpin this question' : 'Pin this question'}>
                {pinned ? <PinOff /> : <Pin />}
              </Button>
            )}
            {a.table && (
              <Button variant="ghost" size="icon-sm" onClick={() => downloadCsv(a)} aria-label="Download the table (CSV)" title="Download the table (Excel / CSV)">
                <Download />
              </Button>
            )}
            {a.topic && (
              <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy answer" title="Copy answer">
                <Copy />
              </Button>
            )}
          </header>
          <div className="space-y-3 px-4 py-3">
            {a.note && <p className="text-xs text-muted-foreground italic">{a.note}</p>}
            <p className="text-sm leading-relaxed">{a.text}</p>
            {!!a.steps?.length && (
              <ol className="space-y-2">
                {a.steps.map((st, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">{i + 1}</span>
                    <span>{st}</span>
                  </li>
                ))}
              </ol>
            )}
            {!!a.facts?.length && (
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {a.facts.map((f) => (
                  <div key={f.label} className="rounded-lg border bg-muted/25 px-3 py-2">
                    <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{f.label}</dt>
                    <dd className={cn('tabular mt-0.5 text-[15px] font-semibold', f.tone === 'bad' && 'text-destructive', f.tone === 'good' && 'text-success')}>{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {a.chart && <AnswerChart chart={a.chart} />}
            {a.table && (
              <div className="overflow-hidden rounded-lg border">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/70 text-muted-foreground">
                      <tr>
                        {a.table.columns.map((c) => (
                          <th key={c.label} scope="col" className={cn('px-3 py-2 font-semibold whitespace-nowrap', c.align === 'right' ? 'text-right' : 'text-left')}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {a.table.rows.map((r, i) => (
                        <tr key={i} className="border-t even:bg-muted/25">
                          {r.map((cell, j) => (
                            <td key={j} className={cn('px-3 py-1.5 align-top', cell.length <= 18 && 'whitespace-nowrap', a.table!.columns[j]?.align === 'right' && 'tabular text-right whitespace-nowrap')}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!!a.table.more && (
                  <p className="border-t bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
                    Showing {a.table.rows.length} of {a.table.rows.length + a.table.more}. Open the screen below for the full list.
                  </p>
                )}
              </div>
            )}
            {a.insight && (
              <p className="flex gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] leading-relaxed text-accent-foreground">
                <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{a.insight}</span>
              </p>
            )}
            {!!a.actions?.length && (
              <div className="flex flex-wrap gap-2">
                {a.actions.map((x) => (
                  <Button key={`${x.label}-${x.href}`} asChild size="sm">
                    <Link href={x.href} onClick={onNavigate}>
                      {x.label} <ArrowRight />
                    </Link>
                  </Button>
                ))}
              </div>
            )}
          </div>
          {(!!a.links?.length || question) && (
            <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2">
              {a.links?.map((l) =>
                l.href.startsWith('/api/') ? (
                  <a key={`${l.label}-${l.href}`} href={l.href} target="_blank" rel="noreferrer" className={linkClass}>
                    {l.label} <ArrowUpRight className="size-3.5" aria-hidden />
                  </a>
                ) : (
                  <Link key={`${l.label}-${l.href}`} href={l.href} onClick={onNavigate} className={linkClass}>
                    {l.label} <ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                ),
              )}
              {question && (
                <span className="ml-auto flex items-center gap-0.5 text-[11px] text-muted-foreground">
                  {vote ? (
                    <span className="flex items-center gap-1 pr-1">
                      <Check className="size-3.5 text-success" aria-hidden /> Thanks for the feedback
                    </span>
                  ) : (
                    <>
                      <span className="pr-1">Helpful?</span>
                      <button type="button" onClick={() => sendVote(true)} aria-label="Helpful" className="rounded-md p-1 hover:bg-muted hover:text-foreground">
                        <ThumbsUp className="size-3.5" />
                      </button>
                      <button type="button" onClick={() => sendVote(false)} aria-label="Not helpful" className="rounded-md p-1 hover:bg-muted hover:text-foreground">
                        <ThumbsDown className="size-3.5" />
                      </button>
                    </>
                  )}
                </span>
              )}
            </footer>
          )}
        </article>
        {!!a.suggestions?.length && (
          <div className="pl-1">
            <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{a.topic ? 'Related questions' : 'Suggested questions'}</p>
            <div className="flex flex-wrap gap-1.5">
              {a.suggestions.map((s, i) => (
                <button key={`${i}-${s}`} type="button" onClick={() => onAsk(s)} className="rounded-full border bg-card px-3 py-1 text-left text-[13px] transition-colors hover:border-primary/40 hover:bg-accent">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

