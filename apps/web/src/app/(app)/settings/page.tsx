'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Camera, Check, ChevronRight, DatabaseBackup, Image as ImageIcon, KeyRound, LayoutDashboard, Monitor, Moon, Palette, RotateCcw, Shapes, Sun, Trash2, Type, UserRound } from 'lucide-react';
import {
  AVATAR_COLORS,
  AVATAR_ICONS,
  UI_ACCENTS,
  UI_FONTS,
  UI_TEXT_SIZES,
  type AvatarColor,
  type CompanyAppearance,
  type SessionUser,
  type UserPreferences,
} from '@bht/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { FONT_FAMILY } from '@/lib/appearance';
import { usePreferences } from '@/hooks/use-preferences';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Label, Switch } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { Row, Section } from '@/components/app/settings-section';
import { BackupsSection } from '@/components/app/backups';
import { useSession } from '@/components/app/session';
import { canOpen, NAV } from '@/components/app/nav';
import { AVATAR_GRADIENT, AVATAR_ICON, UserAvatar } from '@/components/app/user-avatar';
import { CompanySecurityCard, TwoFactorCard } from '@/components/app/two-factor';

const SECTIONS = [
  { id: 'profile', label: 'Profile picture', icon: UserRound },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'workspace', label: 'Workspace', icon: LayoutDashboard },
  { id: 'company', label: 'Company look', icon: Building2, admin: true },
  { id: 'security', label: 'Account & security', icon: KeyRound },
  { id: 'backups', label: 'Backups', icon: DatabaseBackup, admin: true },
];

export default function SettingsPage() {
  const { can } = useSession();
  const admin = can('settings.update');
  return (
    <>
      <PageHeader title="Settings" description="Your picture, your look and how the ERP opens for you. Saved with your login, so it follows you to any computer." />
      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-20 space-y-0.5">
            {SECTIONS.filter((s) => !s.admin || admin).map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <s.icon className="size-4" aria-hidden /> {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6">
          <ProfileSection />
          <AppearanceSection />
          <WorkspaceSection />
          {admin && <CompanySection />}
          <SecuritySection />
          {admin && <BackupsSection />}
        </div>
      </div>
    </>
  );
}

/** A choice tile with a check mark when selected. */
function Choice({ selected, onClick, children, className, label }: { selected: boolean; onClick: () => void; children: React.ReactNode; className?: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      className={cn(
        'relative rounded-lg border bg-card text-left transition-[border-color,box-shadow] hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        selected && 'border-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary),transparent_82%)]',
        className,
      )}
    >
      {selected && (
        <span className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ profile picture

/** Center-crops the photo to a square and makes it 192 px (JPEG) in the browser, so only a small image is sent. */
async function squarePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This file is not a picture'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot resize pictures');
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 192, 192);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ProfileSection() {
  const { user } = useSession();
  const { preferences, save } = usePreferences();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const style = preferences.avatar ?? { kind: 'initials' as const, color: 'blue' as AvatarColor };
  const setStyle = (change: Partial<NonNullable<UserPreferences['avatar']>>) => void save({ avatar: { ...style, ...change } });

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Choose a picture (JPG or PNG)');
    if (file.size > 15 * 1024 * 1024) return toast.error('That file is bigger than 15 MB');
    setBusy(true);
    try {
      const photo = await squarePhoto(file);
      const updated = await api<SessionUser>('/account/avatar', { method: 'PUT', body: { photo } });
      queryClient.setQueryData(['session'], updated);
      toast.success('Photo saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the photo');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const removePhoto = async () => {
    setBusy(true);
    try {
      const updated = await api<SessionUser>('/account/avatar', { method: 'PUT', body: { photo: null } });
      queryClient.setQueryData(['session'], updated);
      toast.success('Photo removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the photo');
    } finally {
      setBusy(false);
    }
  };

  const kinds = [
    { id: 'initials' as const, label: 'Initials', icon: Type },
    { id: 'icon' as const, label: 'Icon', icon: Shapes },
    { id: 'photo' as const, label: 'Photo', icon: ImageIcon },
  ];

  return (
    <Section id="profile" title="Profile picture" description="Shown in the top bar, the side menu and your messages." icon={UserRound}>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <UserAvatar name={user.name} photo={user.avatar} style={style} className="size-24 text-3xl shadow-sm ring-4 ring-background" />
        <div className="min-w-0">
          <div className="text-lg font-semibold tracking-[-0.01em]">{user.name}</div>
          <div className="text-sm text-muted-foreground">
            @{user.username} · {user.role.name}
          </div>
          <div className="mt-3 inline-flex rounded-full glass p-1" role="tablist" aria-label="Picture style">
            {kinds.map((k) => (
              <button
                key={k.id}
                type="button"
                role="tab"
                aria-selected={style.kind === k.id}
                onClick={() => (k.id === 'photo' && !user.avatar ? fileRef.current?.click() : setStyle({ kind: k.id, ...(k.id === 'icon' && !style.icon ? { icon: 'user' } : {}) }))}
                className={cn('inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold text-muted-foreground transition-colors', style.kind === k.id ? 'bg-ink text-ink-foreground' : 'hover:text-foreground')}
              >
                <k.icon className="size-3.5" /> {k.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {style.kind !== 'photo' && (
        <Row label="Colour" hint="Background of your picture.">
          <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Picture colour">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={style.color === c}
                aria-label={c}
                onClick={() => setStyle({ color: c })}
                className={cn('flex size-10 items-center justify-center rounded-full bg-gradient-to-br text-white transition-transform hover:scale-105', AVATAR_GRADIENT[c], style.color === c && 'ring-2 ring-primary ring-offset-2 ring-offset-card')}
              >
                {style.color === c && <Check className="size-4" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Row>
      )}

      {style.kind === 'icon' && (
        <Row label="Icon" hint="Pick one that fits your work.">
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-12" role="radiogroup" aria-label="Picture icon">
            {AVATAR_ICONS.map((i) => {
              const Icon = AVATAR_ICON[i];
              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={style.icon === i}
                  aria-label={i.replace('-', ' ')}
                  onClick={() => setStyle({ icon: i })}
                  className={cn('flex aspect-square items-center justify-center rounded-lg border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground', style.icon === i && 'border-primary bg-accent text-accent-foreground')}
                >
                  <Icon className="size-5" />
                </button>
              );
            })}
          </div>
        </Row>
      )}

      <Row label="Photo" hint="JPG or PNG. It is cut to a square and made small (192 px) before saving.">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} loading={busy}>
            <Camera /> {user.avatar ? 'Change photo' : 'Upload a photo'}
          </Button>
          {user.avatar && (
            <Button type="button" variant="ghost" className="text-destructive" onClick={() => void removePhoto()} disabled={busy}>
              <Trash2 /> Remove photo
            </Button>
          )}
        </div>
      </Row>
    </Section>
  );
}

// ------------------------------------------------------------------ appearance

function ThemePreview({ mode }: { mode: 'light' | 'dark' | 'system' }) {
  const pane = (dark: boolean) => (
    <div className={cn('flex h-full gap-1.5 p-2', dark ? 'bg-[#16161d]' : 'bg-[#f3f3f7]')}>
      <div className={cn('w-1/4 space-y-1 rounded-sm p-1', dark ? 'bg-[#1d1d26]' : 'bg-[#e9e9ef]')}>
        <div className="h-1.5 w-full rounded-full bg-primary/70" />
        <div className={cn('h-1 w-3/4 rounded-full', dark ? 'bg-white/20' : 'bg-black/15')} />
        <div className={cn('h-1 w-2/3 rounded-full', dark ? 'bg-white/20' : 'bg-black/15')} />
      </div>
      <div className={cn('flex-1 space-y-1.5 rounded-sm p-1.5', dark ? 'bg-[#22222c]' : 'bg-white')}>
        <div className={cn('h-1.5 w-1/2 rounded-full', dark ? 'bg-white/40' : 'bg-black/30')} />
        <div className="flex gap-1">
          <div className={cn('h-5 flex-1 rounded-sm', dark ? 'bg-white/10' : 'bg-black/5')} />
          <div className={cn('h-5 flex-1 rounded-sm', dark ? 'bg-white/10' : 'bg-black/5')} />
        </div>
        <div className="h-1.5 w-1/3 rounded-full bg-primary" />
      </div>
    </div>
  );
  if (mode === 'system')
    return (
      <div className="relative h-full overflow-hidden">
        {pane(false)}
        <div className="absolute inset-0" style={{ clipPath: 'polygon(55% 0, 100% 0, 100% 100%, 45% 100%)' }}>
          {pane(true)}
        </div>
      </div>
    );
  return pane(mode === 'dark');
}

function AppearanceSection() {
  const { user } = useSession();
  const { preferences, save } = usePreferences();
  const { theme, setTheme } = useTheme();
  const font = preferences.font ?? user.appearance.font;
  const accent = preferences.accent ?? user.appearance.accent;
  const size = preferences.textSize ?? 'md';
  const companyFont = UI_FONTS.find((f) => f.id === user.appearance.font)?.label;
  const companyAccent = UI_ACCENTS.find((a) => a.id === user.appearance.accent)?.label;
  const custom = !!(preferences.font || preferences.accent || preferences.textSize);
  const themes = [
    { id: 'light' as const, label: 'Light', icon: Sun },
    { id: 'dark' as const, label: 'Dark', icon: Moon },
    { id: 'system' as const, label: 'Same as computer', icon: Monitor },
  ];

  return (
    <Section
      id="appearance"
      title="Appearance"
      description="Theme, colour, font and size. Changes show at once."
      icon={Palette}
      action={
        custom ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => void save({ font: undefined, accent: undefined, textSize: undefined })}>
            <RotateCcw /> Company default
          </Button>
        ) : undefined
      }
    >
      <Row label="Theme" hint="Light, dark, or follow this computer.">
        <div className="grid grid-cols-3 gap-3">
          {themes.map((t) => (
            <Choice
              key={t.id}
              selected={(preferences.theme ?? theme) === t.id}
              onClick={() => {
                setTheme(t.id);
                void save({ theme: t.id });
              }}
              className="overflow-hidden"
            >
              <div className="h-20 border-b">
                <ThemePreview mode={t.id} />
              </div>
              <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
                <t.icon className="size-4 text-muted-foreground" /> {t.label}
              </div>
            </Choice>
          ))}
        </div>
      </Row>

      <Row label="Accent colour" hint={`Buttons, links and highlights. Company default: ${companyAccent}.`}>
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Accent colour">
          {UI_ACCENTS.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={accent === a.id} onClick={() => void save({ accent: a.id })} className="group flex w-16 flex-col items-center gap-1.5">
              <span
                className={cn('flex size-10 items-center justify-center rounded-full text-white shadow-sm transition-transform group-hover:scale-105', accent === a.id && 'ring-2 ring-offset-2 ring-offset-card')}
                style={{ background: a.hex, ...(accent === a.id ? { ['--tw-ring-color' as string]: a.hex } : {}) }}
              >
                {accent === a.id && <Check className="size-4" strokeWidth={3} />}
              </span>
              <span className={cn('text-xs', accent === a.id ? 'font-medium text-foreground' : 'text-muted-foreground')}>{a.label}</span>
            </button>
          ))}
        </div>
      </Row>

      <Row label="Font" hint={`The typeface of every screen. Company default: ${companyFont}.`}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {UI_FONTS.map((f) => (
            <Choice key={f.id} selected={font === f.id} onClick={() => void save({ font: f.id })} className="p-4" label={`Font ${f.label}`}>
              <div style={{ fontFamily: FONT_FAMILY[f.id] }}>
                <div className="text-[28px] leading-none font-semibold tracking-[-0.02em]">Aa</div>
                <div className="mt-3 text-sm font-semibold">{f.label}</div>
                <div className="mt-0.5 text-[13px] text-muted-foreground">Invoice DEMO/26-27/003 · ₹1,11,156.00</div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{f.note}</div>
            </Choice>
          ))}
        </div>
      </Row>

      <Row label="Interface size" hint="Makes every screen a little smaller or bigger.">
        <div className="inline-flex rounded-3xl glass p-1" role="radiogroup" aria-label="Interface size">
          {UI_TEXT_SIZES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={size === s.id}
              onClick={() => void save({ textSize: s.id })}
              className={cn('flex min-w-28 flex-col items-center rounded-[20px] px-4 py-1.5 transition-colors', size === s.id ? 'bg-popover shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              <span className={cn('font-semibold', s.id === 'sm' ? 'text-xs' : s.id === 'lg' ? 'text-base' : 'text-sm')}>{s.label}</span>
              <span className="text-[11px] text-muted-foreground">{s.note}</span>
            </button>
          ))}
        </div>
      </Row>
    </Section>
  );
}

// ------------------------------------------------------------------ workspace

function WorkspaceSection() {
  const { can } = useSession();
  const { preferences, save } = usePreferences();
  const screens = NAV.flatMap((g) => g.items.filter((i) => canOpen(can, i)).map((i) => ({ ...i, group: g.label })));
  return (
    <Section id="workspace" title="Workspace" description="How the ERP opens and looks around the edges." icon={LayoutDashboard}>
      <Row label="Start page" hint="The screen you see after signing in.">
        <NativeSelect value={preferences.startPage ?? '/dashboard'} onChange={(e) => void save({ startPage: e.target.value === '/dashboard' ? undefined : e.target.value })} className="max-w-sm" aria-label="Start page">
          {[...new Set(screens.map((s) => s.group))].map((group) => (
            <optgroup key={group} label={group}>
              {screens
                .filter((s) => s.group === group)
                .map((s) => (
                  <option key={s.href} value={s.href}>
                    {s.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </NativeSelect>
      </Row>
      <Row label="Side menu" hint="Folded shows only icons, giving the screen more room.">
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={!!preferences.menuCollapsed} onCheckedChange={(c) => void save({ menuCollapsed: c })} aria-label="Start with the side menu folded" />
          Start with the side menu folded
        </label>
      </Row>
    </Section>
  );
}

// ------------------------------------------------------------------ company look (admin)

function CompanySection() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [look, setLook] = useState<CompanyAppearance>(user.appearance);
  const [busy, setBusy] = useState(false);
  const changed = look.font !== user.appearance.font || look.accent !== user.appearance.accent;
  const saveLook = async () => {
    setBusy(true);
    try {
      await api<CompanyAppearance>('/settings/appearance', { method: 'PUT', body: look });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success('Company look saved - everyone sees it on their next page load');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      id="company"
      title="Company look"
      description="The default font and colour for everyone in the company. Each person can still choose their own above."
      icon={Building2}
      action={
        <Button type="button" onClick={() => void saveLook()} disabled={!changed} loading={busy}>
          Save for everyone
        </Button>
      }
    >
      <Row label="Default colour">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Company colour">
          {UI_ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={look.accent === a.id}
              onClick={() => setLook((l) => ({ ...l, accent: a.id }))}
              className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-muted', look.accent === a.id && 'border-foreground/30 bg-muted font-medium')}
            >
              <span className="size-3.5 rounded-full" style={{ background: a.hex }} aria-hidden /> {a.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Default font">
        <div className="flex max-w-sm flex-col gap-1.5">
          <Label htmlFor="company-font" className="sr-only">
            Company font
          </Label>
          <NativeSelect id="company-font" value={look.font} onChange={(e) => setLook((l) => ({ ...l, font: e.target.value as CompanyAppearance['font'] }))}>
            {UI_FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} - {f.note}
              </option>
            ))}
          </NativeSelect>
          <p className="text-[13px] text-muted-foreground" style={{ fontFamily: FONT_FAMILY[look.font] }}>
            Sample: Invoice DEMO/26-27/003 · ₹1,11,156.00
          </p>
        </div>
      </Row>
    </Section>
  );
}

// ------------------------------------------------------------------ account

function SecuritySection() {
  const { user, can } = useSession();
  return (
    <Section id="security" title="Account & security" description="Your login details, 2-step login and the company security rule." icon={KeyRound}>
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Name</dt>
          <dd className="font-medium">{user.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Username</dt>
          <dd className="font-medium">@{user.username}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Role</dt>
          <dd className="font-medium">{user.role.name}</dd>
        </div>
      </dl>
      <Link href="/account" className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm transition-colors hover:bg-muted">
        <span className="flex items-center gap-3">
          <KeyRound className="size-4 text-muted-foreground" />
          <span>
            <span className="block font-medium">Change password</span>
            <span className="block text-xs text-muted-foreground">Signs you out on every other device.</span>
          </span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
      <TwoFactorCard />
      {can('settings.view') && <CompanySecurityCard />}
    </Section>
  );
}
