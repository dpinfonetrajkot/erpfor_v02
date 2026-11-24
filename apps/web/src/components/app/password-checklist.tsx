'use client';

import { Check, Circle } from 'lucide-react';
import { PASSWORD_RULES } from '@bht/shared';
import { cn } from '@/lib/utils';

/**
 * The company password rules under a "new password" box, each turning green as it is met.
 * The same rules are checked again on the server.
 */
export function PasswordChecklist({ password, username, className }: { password: string; username?: string; className?: string }) {
  const met = PASSWORD_RULES.map((r) => ({ ...r, ok: password.length > 0 && r.test(password, { username }) }));
  const done = met.filter((r) => r.ok).length;
  return (
    <div className={cn('rounded-2xl bg-muted/60 px-3.5 py-3', className)} aria-live="polite">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden>
          {met.map((r) => (
            <span key={r.id} className={cn('h-1.5 flex-1 rounded-full transition-colors', r.ok ? 'bg-success' : 'bg-foreground/10')} />
          ))}
        </div>
        <span className="text-xs font-semibold text-muted-foreground">
          {done === met.length ? 'Strong password' : `${done} of ${met.length}`}
        </span>
      </div>
      <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {met.map((r) => (
          <li key={r.id} className={cn('flex items-center gap-1.5 text-xs', r.ok ? 'text-success' : 'text-muted-foreground')}>
            {r.ok ? <Check className="size-3.5 shrink-0" aria-hidden /> : <Circle className="size-3 shrink-0" aria-hidden />}
            <span>
              {r.label}
              <span className="sr-only">{r.ok ? ' (done)' : ' (not yet)'}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
