'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowLeft, ArrowUp, Eye, EyeOff, LockKeyhole, Smartphone } from 'lucide-react';
import { loginSchema, type LoginInput, type SessionUser, type TwoFactorChallenge } from '@bht/shared';
import { api, ApiRequestError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { applyLook, effectiveLook } from '@/lib/appearance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/primitives';
import { Logo } from '@/components/app/app-shell';
import { CodeInput } from '@/components/app/two-factor';

/**
 * Sign-in page: one centred card on a clean page (the familiar layout of the big sites),
 * the company on top, a quiet footer below.
 */
export default function LoginPage() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* a very soft tint at the top, purely decorative */}
      

      <main className="relative flex flex-1 flex-col items-center px-4 pt-12 pb-10 sm:pt-20">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="size-12" />
          <div className="mt-3 text-lg font-semibold tracking-[-0.01em]">{BRAND.name}</div>
          <div className="text-[13px] text-muted-foreground">{BRAND.product}</div>
        </div>

        <Suspense>
          <LoginCard />
        </Suspense>

        <div className="mt-6 w-full max-w-[400px]">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            Need help?
            <span className="h-px flex-1 bg-border" />
          </div>
          <p className="mt-3 text-center text-[13px] leading-relaxed text-muted-foreground">
            Forgot your password, or need a login? Ask your administrator.
            <br />
            They can reset it in <span className="font-medium text-foreground">Admin → Users</span>.
          </p>
        </div>
      </main>

      <footer className="relative px-4 py-5 text-center text-xs text-muted-foreground">
        <div className="font-medium text-foreground/80">
          © {new Date().getFullYear()} {BRAND.footer}
        </div>
        <div className="mt-1">{BRAND.address}</div>
      </footer>
    </div>
  );
}

function LoginCard() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  /** Set after a right password when 2-step login is on: the pass for the code step. */
  const [ticket, setTicket] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { username: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const signedIn = (user: SessionUser) => {
    applyLook(effectiveLook(user));
    const next = params.get('next');
    // Only follow local paths, never another site; else the start page chosen in Settings.
    router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : user.preferences?.startPage || '/dashboard');
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api<SessionUser | TwoFactorChallenge>('/auth/login', { method: 'POST', body: values });
      if ('twoFactor' in res) return setTicket(res.ticket);
      signedIn(res);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Cannot reach the server. Please check your connection and try again.');
    }
  });

  const caps = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);

  if (ticket) {
    return (
      <TwoStepCard
        ticket={ticket}
        onSignedIn={signedIn}
        onRestart={(message) => {
          setTicket(null);
          form.setValue('password', '');
          setError(message);
        }}
      />
    );
  }

  return (
    <div className="w-full max-w-[400px]">
      {error && (
        <div role="alert" className="mb-4 flex gap-3 rounded-lg border border-destructive/40 bg-card p-4 shadow-[0_0_0_4px_color-mix(in_oklch,var(--destructive),transparent_92%)]">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div>
            <div className="text-sm font-semibold text-destructive">There was a problem</div>
            <div className="mt-0.5 text-sm">{error}</div>
          </div>
        </div>
      )}

      <div className="glass rounded-[28px] p-6 sm:p-8">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use the username and password given by your administrator.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              className="h-11"
              aria-invalid={!!errors.username}
              {...form.register('username')}
            />
            {errors.username && <p className="text-xs text-destructive">{errors.username.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="h-11 pr-11"
                aria-invalid={!!errors.password}
                onKeyDown={caps}
                onKeyUp={caps}
                {...form.register('password', { onBlur: () => setCapsLock(false) })}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {capsLock && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-[color-mix(in_oklch,var(--warning),black_30%)] dark:text-warning">
                <ArrowUp className="size-3.5" aria-hidden /> Caps Lock is on
              </p>
            )}
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>

          <Button type="submit" className="mt-2 h-11 w-full text-[15px]" loading={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-6 flex items-start gap-2 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
          <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          For authorised staff of {BRAND.name} only. Every sign-in is recorded in the audit log.
        </p>
      </div>
    </div>
  );
}

/** Step 2 of sign-in: the 6-digit code from the authenticator app, or a backup code. */
function TwoStepCard({ ticket, onSignedIn, onRestart }: { ticket: string; onSignedIn: (u: SessionUser) => void; onRestart: (message: string | null) => void }) {
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api<SessionUser>('/auth/login/verify', { method: 'POST', body: { ticket, code: value } }));
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'Cannot reach the server. Please check your connection and try again.';
      // the pass expired (401) or the account got locked (403): back to the password step
      if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) return onRestart(message);
      setError(message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-[400px]">
      <div className="glass rounded-[28px] p-6 sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Smartphone className="size-5" />
        </span>
        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">2-step login</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {useBackup ? 'Type one of the backup codes you saved when you turned on 2-step login.' : `Open the authenticator app on your phone and type the 6-digit code for ${BRAND.name} ERP.`}
        </p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code);
          }}
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="code">{useBackup ? 'Backup code' : 'Code'}</Label>
            {useBackup ? (
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                autoFocus
                className="h-12 font-mono text-lg tracking-widest"
                aria-invalid={!!error}
              />
            ) : (
              <CodeInput
                id="code"
                value={code}
                autoFocus
                invalid={!!error}
                onChange={(v) => {
                  setCode(v);
                  if (v.length === 6) void verify(v);
                }}
              />
            )}
            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
          </div>
          <Button type="submit" className="h-11 w-full text-[15px]" loading={busy} disabled={useBackup ? code.replace(/[^A-Z0-9]/g, '').length < 8 : code.length !== 6}>
            {busy ? 'Checking…' : 'Verify and sign in'}
          </Button>
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-[13px]">
          <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => onRestart(null)}>
            <ArrowLeft className="size-3.5" /> Back
          </button>
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => {
              setUseBackup((b) => !b);
              setCode('');
              setError(null);
            }}
          >
            {useBackup ? 'Use the app code instead' : 'Lost your phone? Use a backup code'}
          </button>
        </div>
      </div>
    </div>
  );
}
