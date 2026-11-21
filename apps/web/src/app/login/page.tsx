'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowUp, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { loginSchema, type LoginInput, type SessionUser } from '@bht/shared';
import { api, ApiRequestError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { applyLook, effectiveLook } from '@/lib/appearance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/primitives';
import { Logo } from '@/components/app/app-shell';

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
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { username: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const user = await api<SessionUser>('/auth/login', { method: 'POST', body: values });
      applyLook(effectiveLook(user));
      const next = params.get('next');
      // Only follow local paths, never another site; else the start page chosen in Settings.
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : user.preferences?.startPage || '/dashboard');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Cannot reach the server. Please check your connection and try again.');
    }
  });

  const caps = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);

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
