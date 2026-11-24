'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import type { SessionUser } from '@bht/shared';
import { api } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Logo } from './app-shell';
import { ChangePasswordForm } from './change-password-form';
import { TwoFactorSetupFlow } from './two-factor';

/**
 * Shown instead of the ERP until the account is safe: first the user's own password (when an admin
 * set it), then 2-step login (when the company requires it). The server holds back everything else
 * until both are done.
 */
export function AccountSetup({ user }: { user: SessionUser }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { mustChangePassword, twoFactorSetupRequired } = user.security;
  const steps = [mustChangePassword && 'password', twoFactorSetupRequired && '2fa'].filter(Boolean) as ('password' | '2fa')[];
  const current = steps[0];
  const reload = () => queryClient.invalidateQueries({ queryKey: ['session'] });

  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    queryClient.clear();
    router.replace('/login');
  };

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pt-10 pb-10 sm:pt-16">
      <div className="mb-6 flex flex-col items-center text-center">
        <Logo className="size-11" />
        <div className="mt-2 text-base font-semibold">{BRAND.name}</div>
      </div>
      <div className="glass w-full max-w-[480px] rounded-[28px] p-6 sm:p-8">
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">Secure your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hello {user.name.split(' ')[0]}. {steps.length > 1 ? 'Two quick steps' : 'One quick step'} before you start.
        </p>

        {steps.length > 1 && (
          <ol className="mt-5 flex gap-2">
            {steps.map((s, i) => (
              <li key={s} className={cn('flex flex-1 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold', s === current ? 'bg-ink text-ink-foreground' : 'bg-muted text-muted-foreground')}>
                <span className="flex size-5 items-center justify-center rounded-full bg-white/20">{i + 1}</span>
                {s === 'password' ? 'Your password' : '2-step login'}
              </li>
            ))}
          </ol>
        )}

        <div className="mt-6">
          {current === 'password' && (
            <>
              <div className="mb-4 flex items-start gap-3">
                <KeyRound className="mt-0.5 size-5 shrink-0 text-primary" />
                <p className="text-sm text-muted-foreground">Your admin set your password. Please choose your own one that only you know.</p>
              </div>
              <ChangePasswordForm
                username={user.username}
                currentLabel="Password given by the admin"
                submitLabel="Save my password"
                onDone={() => {
                  toast.success('Your new password is saved');
                  void reload();
                }}
              />
            </>
          )}
          {current === '2fa' && (
            <>
              <div className="mb-4 flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
                <p className="text-sm text-muted-foreground">Your company requires 2-step login: after your password you will also type a code from your phone.</p>
              </div>
              <TwoFactorSetupFlow
                onDone={() => {
                  toast.success('2-step login is on');
                  void reload();
                }}
              />
            </>
          )}
        </div>
      </div>
      <Button variant="ghost" size="sm" className="mt-5" onClick={signOut}>
        <LogOut /> Sign out
      </Button>
    </div>
  );
}
