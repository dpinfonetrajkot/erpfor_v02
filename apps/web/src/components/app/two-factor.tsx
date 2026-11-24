'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, Download, KeyRound, Loader2, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import type { SecurityPolicy, TwoFactorPolicy, TwoFactorSetup, TwoFactorStatus } from '@bht/shared';
import { api, ApiRequestError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { useApiQuery } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Checkbox, Label } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { useSession } from './session';

const errorText = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.');

/** 6-digit code box: numbers only, the phone keypad on mobiles, filled in by password managers. */
export function CodeInput({ value, onChange, id, autoFocus, invalid }: { value: string; onChange: (v: string) => void; id: string; autoFocus?: boolean; invalid?: boolean }) {
  return (
    <Input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      autoFocus={autoFocus}
      aria-invalid={invalid}
      className="h-12 max-w-[200px] text-center font-mono text-xl tracking-[0.4em]"
    />
  );
}

/** The backup codes, shown once, with copy and download. */
export function BackupCodes({ codes }: { codes: string[] }) {
  const text = `${BRAND.name} ERP - 2-step login backup codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Backup codes copied');
    } catch {
      toast.error('Could not copy. Please write them down.');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'erp-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-2 rounded-2xl bg-muted/70 p-4 font-mono text-[15px] font-semibold tracking-wider">
        {codes.map((c) => (
          <li key={c} className="text-center">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          <Copy /> Copy
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download /> Download .txt
        </Button>
      </div>
    </div>
  );
}

/**
 * Turning on 2-step login: scan the QR code, type the first code, save the backup codes.
 * Used in Settings and on the "secure your account" screen at the first sign-in.
 */
export function TwoFactorSetupFlow({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    api<TwoFactorSetup>('/account/2fa/setup', { method: 'POST' })
      .then(async (s) => {
        const img = await QRCode.toDataURL(s.otpauthUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
        if (alive) {
          setSetup(s);
          setQr(img);
        }
      })
      .catch((err) => alive && setError(errorText(err)));
    return () => {
      alive = false;
    };
  }, []);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return setError('Enter the 6-digit code from the app.');
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ backupCodes: string[] }>('/account/2fa/enable', { method: 'POST', body: { code } });
      setBackupCodes(res.backupCodes);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (backupCodes) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-success">
          <ShieldCheck className="size-5" />
          <span className="font-semibold">2-step login is on.</span>
        </div>
        <div>
          <p className="text-sm font-semibold">Save your backup codes</p>
          <p className="mt-0.5 text-sm text-muted-foreground">If you lose your phone, sign in with one of these instead of the app code. Each code works once.</p>
        </div>
        <BackupCodes codes={backupCodes} />
        <label className="flex items-center gap-2.5 text-sm">
          <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} /> I have saved these codes somewhere safe
        </label>
        <Button type="button" className="w-full" disabled={!saved} onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="space-y-5">
      <ol className="space-y-4 text-sm">
        <li className="flex gap-3">
          <Step n={1} />
          <span>
            Install <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong> on your phone (free).
          </span>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <div className="min-w-0 flex-1 space-y-3">
            <span>In the app, tap <strong>+</strong> and scan this QR code.</span>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex size-[188px] items-center justify-center rounded-2xl border bg-white p-2">
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt="QR code for the authenticator app" width={172} height={172} />
                ) : (
                  <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
                )}
              </div>
              {setup && (
                <div className="min-w-0 text-xs text-muted-foreground">
                  Can&apos;t scan? Type this key in the app:
                  <div className="mt-1 font-mono text-[13px] font-semibold break-all text-foreground select-all">{setup.secret.match(/.{1,4}/g)?.join(' ')}</div>
                </div>
              )}
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={3} />
          <div className="space-y-2">
            <Label htmlFor="tf-code">Type the 6-digit code the app shows</Label>
            <CodeInput id="tf-code" value={code} onChange={setCode} invalid={!!error} />
          </div>
        </li>
      </ol>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={busy} disabled={!setup}>
        Turn on 2-step login
      </Button>
    </form>
  );
}

function Step({ n }: { n: number }) {
  return <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-ink-foreground">{n}</span>;
}

/** Settings → Account & security: the user's own 2-step login. */
export function TwoFactorCard() {
  const queryClient = useQueryClient();
  const status = useApiQuery<TwoFactorStatus>('/account/2fa');
  const [dialog, setDialog] = useState<'setup' | 'codes' | 'off' | null>(null);
  const refresh = () => {
    void status.refetch();
    void queryClient.invalidateQueries({ queryKey: ['session'] });
  };
  const s = status.data;

  return (
    <div className="rounded-2xl border px-4 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', s?.enabled ? 'bg-success/12 text-success' : 'bg-muted text-muted-foreground')}>
          <Smartphone className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">2-step login</span>
            {s && (s.enabled ? <Badge variant="success">On</Badge> : <Badge variant="muted">Off</Badge>)}
            {s?.required && <Badge variant="info">Required by your company</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {s?.enabled
              ? `After your password, you also type a code from the authenticator app. ${s.backupCodesLeft} backup code${s.backupCodesLeft === 1 ? '' : 's'} left.`
              : 'Protects your account even if someone learns your password: sign-in also needs a code from your phone.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {s && !s.enabled && (
            <Button size="sm" onClick={() => setDialog('setup')}>
              <ShieldCheck /> Set up
            </Button>
          )}
          {s?.enabled && (
            <>
              <Button size="sm" variant="outline" onClick={() => setDialog('codes')}>
                <KeyRound /> New backup codes
              </Button>
              {!s.required && (
                <Button size="sm" variant="outline" onClick={() => setDialog('off')}>
                  <ShieldOff /> Turn off
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={dialog === 'setup'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set up 2-step login</DialogTitle>
            <DialogDescription>Takes about a minute. You need your phone.</DialogDescription>
          </DialogHeader>
          {dialog === 'setup' && (
            <TwoFactorSetupFlow
              onDone={() => {
                setDialog(null);
                refresh();
                toast.success('2-step login is on');
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'codes'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New backup codes</DialogTitle>
            <DialogDescription>Your old backup codes will stop working.</DialogDescription>
          </DialogHeader>
          {dialog === 'codes' && <NewCodesForm onDone={refresh} />}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'off'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Turn off 2-step login</DialogTitle>
            <DialogDescription>Your account will be protected by the password only.</DialogDescription>
          </DialogHeader>
          {dialog === 'off' && (
            <TurnOffForm
              onDone={() => {
                setDialog(null);
                refresh();
                toast.success('2-step login is off');
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewCodesForm({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  if (codes) return <BackupCodes codes={codes} />;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await api<{ backupCodes: string[] }>('/account/2fa/backup-codes', { method: 'POST', body: { code } });
          setCodes(res.backupCodes);
          onDone();
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="nc-code">Code from the authenticator app</Label>
        <CodeInput id="nc-code" value={code} onChange={setCode} autoFocus invalid={!!error} />
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <Button type="submit" loading={busy} disabled={code.length !== 6}>
        Make new codes
      </Button>
    </form>
  );
}

function TurnOffForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api('/account/2fa/disable', { method: 'POST', body: { password, code } });
          onDone();
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="off-pw">Your password</Label>
        <Input id="off-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </div>
      <div className="space-y-2">
        <Label htmlFor="off-code">Code from the authenticator app</Label>
        <CodeInput id="off-code" value={code} onChange={setCode} invalid={!!error} />
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <Button type="submit" variant="destructive" loading={busy} disabled={!password || code.length !== 6}>
        Turn off
      </Button>
    </form>
  );
}

const POLICY_OPTIONS: { value: TwoFactorPolicy; label: string; hint: string }[] = [
  { value: 'off', label: 'Not required', hint: 'Each person decides' },
  { value: 'admins', label: 'Admins', hint: 'People who manage users or settings' },
  { value: 'everyone', label: 'Everyone', hint: 'All users of the ERP' },
];

/** Settings (admin): who must use 2-step login. */
export function CompanySecurityCard() {
  const { can, user } = useSession();
  const queryClient = useQueryClient();
  const policy = useApiQuery<SecurityPolicy>('/settings/security');
  const [saving, setSaving] = useState<TwoFactorPolicy | null>(null);
  const editable = can('settings.update');
  const current = policy.data?.twoFactor;

  const choose = async (value: TwoFactorPolicy) => {
    if (!editable || value === current) return;
    setSaving(value);
    try {
      await api('/settings/security', { method: 'PUT', body: { twoFactor: value } });
      await policy.refetch();
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success(value === 'off' ? '2-step login is now optional' : `2-step login is now required for ${value === 'admins' ? 'admins' : 'everyone'}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="rounded-2xl border px-4 py-4">
      <div className="font-semibold">Require 2-step login</div>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        People who must use it, but have not set it up, are asked to do so at their next sign-in. Admins can turn it off for someone who lost their phone (Admin → Users).
      </p>
      {!user.security.twoFactorEnabled && (
        <p className="mt-1.5 text-[13px] font-medium text-[color-mix(in_oklch,var(--warning),black_30%)] dark:text-warning">
          Your own 2-step login is off: if you choose Admins or Everyone, you will set it up right away.
        </p>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Require 2-step login for">
        {POLICY_OPTIONS.map((o) => {
          const on = current === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!editable || !!saving}
              onClick={() => choose(o.value)}
              className={cn(
                'flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed',
                on ? 'border-ink bg-ink text-ink-foreground' : 'hover:bg-muted/70',
              )}
            >
              <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-ink-foreground' : 'border-input')}>
                {saving === o.value ? <Loader2 className="size-3 animate-spin" /> : on && <Check className="size-2.5" strokeWidth={4} />}
              </span>
              <span>
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className={cn('block text-xs', on ? 'text-ink-foreground/75' : 'text-muted-foreground')}>{o.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
