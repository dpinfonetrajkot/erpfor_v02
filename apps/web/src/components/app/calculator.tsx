'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Calculator as CalculatorIcon, Copy, Delete, History } from 'lucide-react';
import { CalcError, evaluate, fmtResult, OPERATORS, prettyExpr, toExpr } from '@/lib/calc';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';

const HISTORY_KEY = 'erp.calculator.history';
const HISTORY_SIZE = 20;

type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | (typeof OPERATORS)[number] | '%' | '(' | ')' | '()' | '=' | 'back' | 'clear';
interface Entry {
  expr: string;
  result: number;
}
interface State {
  expr: string;
  /** the expression worked out by the last "=", shown above its result */
  done: string | null;
  error: string | null;
}

const KEYBOARD: Record<string, Key> = {
  '+': '+', '-': '−', '*': '×', x: '×', X: '×', '/': '÷', '%': '%', '.': '.', ',': '.', '(': '(', ')': ')',
  '=': '=', Enter: '=', Backspace: 'back', Delete: 'clear', c: 'clear', C: 'clear',
};
const isOperator = (c: string | undefined) => !!c && (OPERATORS as readonly string[]).includes(c);
const endsValue = (expr: string) => /[\d.%)]$/.test(expr);
const openBrackets = (expr: string) => [...expr].reduce((n, c) => n + (c === '(' ? 1 : c === ')' ? -1 : 0), 0);

/** The expression after one key press (everything except "="). */
function press(expr: string, key: Key): string {
  const last = expr.at(-1);
  if (/^\d+$/.test(key)) {
    if (/[%)]$/.test(expr)) return `${expr}×${key === '00' ? '0' : key}`;
    // no leading zeros: "0" then "5" is "5"
    if (/(^|[^\d.])0$/.test(expr)) return key === '00' || key === '0' ? expr : expr.slice(0, -1) + key;
    if (!/[\d.]$/.test(expr) && key === '00') return `${expr}0`;
    return expr + key;
  }
  switch (key) {
    case '.':
      if (/\d*\.\d*$/.test(expr)) return expr;
      return expr + (/[%)]$/.test(expr) ? '×0.' : /\d$/.test(expr) ? '.' : '0.');
    case '+':
    case '−':
    case '×':
    case '÷':
      if (!expr || last === '(') return key === '−' ? expr + key : expr;
      if (isOperator(last)) {
        // "×" then "−" starts a negative number; any other pair: the new key replaces the old one(s)
        if (key === '−' && (last === '×' || last === '÷')) return expr + key;
        return expr.replace(/[+−×÷]+$/, '') + key;
      }
      return expr + key;
    case '%':
      return endsValue(expr) && last !== '%' ? expr + key : expr;
    case '(':
      return expr + (endsValue(expr) ? '×(' : '(');
    case ')':
      return openBrackets(expr) > 0 && endsValue(expr) ? expr + key : expr;
    case '()':
      return press(expr, openBrackets(expr) > 0 && endsValue(expr) ? ')' : '(');
    case 'back':
      return expr.slice(0, -1);
    case 'clear':
      return '';
    default:
      return expr;
  }
}

/** Live result while typing: only once there is something to work out. */
function preview(expr: string) {
  if (!/\d[^\d.]+[\d.(]/.test(expr) && !expr.includes('%')) return null;
  try {
    return evaluate(expr);
  } catch {
    return null;
  }
}

function loadHistory(): Entry[] {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((e) => typeof e?.expr === 'string' && typeof e?.result === 'number') : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: Entry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable */
  }
}

/** Top-bar calculator: keys or the keyboard, live result, percent like a desk calculator, history, copy. */
export function CalculatorLauncher() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ expr: '', done: null, error: null });
  const [history, setHistory] = useState<Entry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => setHistory(loadHistory()), []);

  const { expr, done, error } = state;
  const live = done !== null ? null : preview(expr);
  /** what Copy copies: the result, the live result, or the number typed */
  let current = live;
  try {
    if (current === null && expr) current = evaluate(expr);
  } catch {
    /* e.g. divided by zero: nothing to copy */
  }
  const shown = done !== null && current !== null ? fmtResult(current) : prettyExpr(expr) || '0';

  const equals = () => {
    const closed = expr.replace(/[+−×÷(]+$/, '');
    if (!closed) return;
    try {
      const result = evaluate(closed);
      if (result === null) return setState({ ...state, error: 'Please complete the calculation' });
      const full = closed + ')'.repeat(Math.max(0, openBrackets(closed)));
      setState({ expr: toExpr(result), done: full, error: null });
      const next = [{ expr: full, result }, ...history.filter((h) => h.expr !== full)].slice(0, HISTORY_SIZE);
      setHistory(next);
      saveHistory(next);
    } catch (err) {
      setState({ ...state, error: err instanceof CalcError ? err.message : 'Please check the calculation' });
    }
  };

  const onKey = (key: Key) => {
    if (key === '=') return equals();
    // after "=", a number starts a new calculation and an operator carries on with the result
    const startNew = done !== null && (/^\d+$/.test(key) || key === '.' || key === '(' || key === '()');
    setState({ expr: press(startNew ? '' : expr, key), done: null, error: null });
  };

  /** Puts a number in: after an operator it is added, otherwise it replaces what is there. */
  const insert = (value: number) => {
    const text = toExpr(value);
    const carryOn = !done && /[+−×÷(]$/.test(expr);
    setState({ expr: carryOn ? expr + (text.startsWith('−') ? `(${text})` : text) : text, done: null, error: null });
    setShowHistory(false);
  };

  const copy = async () => {
    if (current === null) return;
    try {
      await navigator.clipboard.writeText(String(current));
      toast.success(`Copied ${fmtResult(current)}`);
    } catch {
      toast.error('Copy is not allowed in this browser');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = /^\d$/.test(e.key) ? (e.key as Key) : KEYBOARD[e.key];
    if (!key) return;
    e.preventDefault();
    if (showHistory) setShowHistory(false);
    onKey(key);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/[\s,₹]/g, '');
    e.preventDefault();
    let next = done !== null || !/[+−×÷(]$/.test(expr) ? '' : expr;
    for (const ch of text) {
      const key = /^\d$/.test(ch) ? (ch as Key) : KEYBOARD[ch];
      if (key && key !== '=' && key !== 'back' && key !== 'clear') next = press(next, key);
    }
    setState({ expr: next, done: null, error: null });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Calculator">
          <CalculatorIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={panel}
        align="end"
        tabIndex={-1}
        aria-label="Calculator"
        className="w-[min(19rem,calc(100vw-1.5rem))]"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          panel.current?.focus();
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      >
        <div className="flex items-center gap-1 border-b py-1.5 pr-2 pl-4">
          <h2 className="flex-1 text-sm font-semibold">Calculator</h2>
          <Button variant="ghost" size="icon-sm" aria-label="Copy result" disabled={current === null} onClick={copy}>
            <Copy />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="History"
            aria-pressed={showHistory}
            className={cn(showHistory && 'bg-muted text-primary')}
            onClick={() => setShowHistory((s) => !s)}
          >
            <History />
          </Button>
        </div>

        <div className="space-y-0.5 px-4 pt-3 pb-2 text-right" aria-live="polite">
          <div className="min-h-5 text-xs break-all text-muted-foreground tabular-nums">{done !== null && `${prettyExpr(done)} =`}</div>
          <output
            aria-label="Display"
            className={cn('block leading-tight font-semibold break-all tabular-nums', shown.length > 21 ? 'text-lg' : shown.length > 16 ? 'text-xl' : 'text-[26px]')}
          >
            {shown}
          </output>
          <div className="flex min-h-7 items-center gap-2">
            <Button variant="ghost" size="icon-sm" aria-label="Backspace" disabled={!expr} onClick={() => onKey('back')} className="-ml-2 text-muted-foreground">
              <Delete />
            </Button>
            <span className={cn('min-w-0 flex-1 truncate text-sm tabular-nums', error ? 'text-destructive' : 'text-muted-foreground')}>
              {error ?? (live !== null && `= ${fmtResult(live)}`)}
            </span>
          </div>
        </div>

        {showHistory ? (
          <HistoryList
            entries={history}
            onPick={insert}
            onClear={() => {
              setHistory([]);
              saveHistory([]);
            }}
          />
        ) : (
          <Keypad onKey={onKey} />
        )}
      </PopoverContent>
    </Popover>
  );
}

const KEYS: { key: Key; label: string; name?: string; kind?: 'op' | 'fn' | 'equals' }[] = [
  { key: 'clear', label: 'AC', name: 'Clear', kind: 'fn' },
  { key: '()', label: '( )', name: 'Brackets', kind: 'fn' },
  { key: '%', label: '%', name: 'Percent', kind: 'fn' },
  { key: '÷', label: '÷', name: 'Divide', kind: 'op' },
  { key: '7', label: '7' },
  { key: '8', label: '8' },
  { key: '9', label: '9' },
  { key: '×', label: '×', name: 'Multiply', kind: 'op' },
  { key: '4', label: '4' },
  { key: '5', label: '5' },
  { key: '6', label: '6' },
  { key: '−', label: '−', name: 'Minus', kind: 'op' },
  { key: '1', label: '1' },
  { key: '2', label: '2' },
  { key: '3', label: '3' },
  { key: '+', label: '+', name: 'Plus', kind: 'op' },
  { key: '00', label: '00' },
  { key: '0', label: '0' },
  { key: '.', label: '.', name: 'Decimal point' },
  { key: '=', label: '=', name: 'Equals', kind: 'equals' },
];

function Keypad({ onKey }: { onKey: (key: Key) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5 px-3 pb-3" role="group" aria-label="Keys">
      {KEYS.map((k) => (
        <button
          key={k.key}
          type="button"
          aria-label={k.name}
          onClick={() => onKey(k.key)}
          className={cn(
            'h-11 rounded-lg text-lg font-medium tabular-nums transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.97]',
            !k.kind && 'bg-muted/70 hover:bg-muted',
            k.kind === 'fn' && 'bg-secondary text-[15px] text-secondary-foreground hover:bg-secondary/70',
            k.kind === 'fn' && k.key === 'clear' && 'text-destructive',
            k.kind === 'op' && 'bg-primary/12 text-xl text-primary hover:bg-primary/20',
            k.kind === 'equals' && 'bg-primary text-xl text-primary-foreground hover:bg-primary/90',
          )}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}

function HistoryList({ entries, onPick, onClear }: { entries: Entry[]; onPick: (value: number) => void; onClear: () => void }) {
  return (
    <div className="flex h-64 flex-col border-t">
      {entries.length ? (
        <>
          <ul className="flex-1 divide-y overflow-y-auto" aria-label="History">
            {entries.map((h, i) => (
              <li key={`${i}-${h.expr}`}>
                <button type="button" onClick={() => onPick(h.result)} className="w-full px-4 py-2 text-right tabular-nums hover:bg-muted/60">
                  <span className="block text-xs break-all text-muted-foreground">{prettyExpr(h.expr)} =</span>
                  <span className="block text-[15px] font-semibold">{fmtResult(h.result)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
            <span>Tap a result to use it</span>
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear history
            </Button>
          </div>
        </>
      ) : (
        <p className="m-auto px-6 text-center text-sm text-muted-foreground">No calculations yet. Results you work out with = are kept here.</p>
      )}
    </div>
  );
}
