'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  FileSignature,
  FileText,
  Handshake,
  House,
  KeyRound,
  LayoutGrid,
  LogOut,
  Menu,
  MessagesSquare,
  Moon,
  PackageCheck,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  ShoppingCart,
  Sparkles,
  Star,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { useApiQuery } from '@/hooks/use-api';
import { usePreferences } from '@/hooks/use-preferences';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/primitives';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/overlays';
import { ASK_EVENT, AssistantLauncher } from './assistant';
import { CalculatorLauncher } from './calculator';
import { CommandPalette } from './command-palette';
import { useLiveUpdates } from './live-updates';
import { NotificationBell } from './notification-bell';
import { ACCOUNT_NAV, NAV, SETTINGS_NAV, type NavGroup, type NavItem } from './nav';
import { useSession } from './session';
import { UserAvatar } from './user-avatar';

const pinsKey = (userId: number) => `erp.pins.${userId}`;

/** Things anyone may start from the "+" button (each needs its create permission). */
const QUICK_CREATE: { label: string; hint: string; href: string; icon: LucideIcon; permission: string }[] = [
  { label: 'Sales order', hint: 'Customer order with approvals', href: '/sales/orders/new', icon: FileSignature, permission: 'sales_orders.create' },
  { label: 'Invoice', hint: 'Direct GST invoice', href: '/billing/invoices/new', icon: FileText, permission: 'invoices.create' },
  { label: 'Purchase order', hint: 'Order material from a supplier', href: '/purchase/orders/new', icon: ShoppingCart, permission: 'purchase_orders.create' },
  { label: 'Gate entry', hint: 'Material arrived at the gate', href: '/store/gate-entry/new', icon: PackageCheck, permission: 'goods_receipts.create' },
  { label: 'Job work order', hint: 'Parts made by a vendor', href: '/job-work/orders/new', icon: Handshake, permission: 'job_work_orders.create' },
];

/** Menu groups shown as pills in the top bar (short names); the rest are under "More". */
const PILL_GROUPS: Record<string, string> = {
  Sales: 'Sales',
  Production: 'Production',
  'Dispatch & Billing': 'Billing',
  Purchase: 'Purchase',
  Store: 'Store',
  Reports: 'Reports',
};

/** Screens on the round-button rail, when the user may open them. */
const RAIL_SCREENS = ['/sales/orders', '/production/route-cards', '/billing/invoices', '/purchase/orders', '/store/stock'];

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

/** A list of strings kept in this browser (pinned screens). */
function useStoredList(key: string) {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => setList(readList(key)), [key]);
  const toggle = useCallback(
    (value: string) =>
      setList((cur) => {
        const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
        writeList(key, next);
        return next;
      }),
    [key],
  );
  return [list, toggle] as const;
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { can, user } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pathname = usePathname();
  useLiveUpdates(user.id);

  const groups: NavGroup[] = useMemo(
    () => NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) })).filter((g) => g.items.length > 0),
    [can],
  );
  const [pins, togglePin] = useStoredList(pinsKey(user.id));

  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // the screen being shown (longest matching menu link)
  const current = useMemo(() => {
    let best: { group: string; item: NavItem } | null = null;
    for (const g of groups)
      for (const item of g.items)
        if (isActive(pathname, item.href) && (!best || item.href.length > best.item.href.length)) best = { group: g.label, item };
    if (!best) for (const item of [SETTINGS_NAV, ACCOUNT_NAV]) if (isActive(pathname, item.href)) best = { group: 'Account', item };
    return best;
  }, [groups, pathname]);

  return (
    <div className="min-h-dvh print:bg-white">
      <header className="sticky top-0 z-30 bg-[color-mix(in_oklch,var(--canvas-1)_72%,transparent)] px-3 py-3 backdrop-blur-xl sm:px-5 lg:px-6 print:hidden">
        <div className="mx-auto flex max-w-[1680px] items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="glass flex size-10 shrink-0 items-center justify-center rounded-full xl:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-[18px]" />
          </button>
          <Link href="/dashboard" className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-full pr-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <Logo className="size-9" />
            <span className="hidden min-w-0 leading-tight sm:block">
              <span className="block truncate text-[17px] font-extrabold tracking-[-0.01em]">{BRAND.name}</span>
              <span className="block truncate text-[11.5px] text-muted-foreground">{BRAND.product}</span>
            </span>
          </Link>

          <TopNav groups={groups} pathname={pathname} />

          <div className="toolbar-round ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="glass flex size-10 items-center justify-center rounded-full text-foreground/85 transition-colors hover:text-foreground"
              aria-label="Search (Ctrl K)"
              title="Search (Ctrl K)"
            >
              <Search className="size-[18px]" />
            </button>
            <AssistantLauncher />
            <span className="hidden 2xl:contents">
              <CalculatorLauncher />
            </span>
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1680px] gap-5 px-3 pb-12 sm:px-5 lg:px-6 print:block print:p-0">
        <Rail groups={groups} pins={pins} togglePin={togglePin} current={current?.item ?? null} pathname={pathname} />
        <main className="min-w-0 flex-1 pt-2 print:p-0">{children}</main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-[300px] flex-col p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <MobileNav groups={groups} pins={pins} pathname={pathname} />
        </SheetContent>
      </Sheet>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={groups} />
    </div>
  );
}

// ------------------------------------------------------------------ top bar menu (pills)

function TopNav({ groups, pathname }: { groups: NavGroup[]; pathname: string }) {
  const router = useRouter();
  const { can } = useSession();
  const pills = groups.filter((g) => PILL_GROUPS[g.label]);
  const more = groups.filter((g) => !PILL_GROUPS[g.label] && g.label !== 'Overview');
  const inGroup = (g: NavGroup) => g.items.some((i) => isActive(pathname, i.href));
  const pill = (active: boolean) =>
    cn(
      'inline-flex h-9 items-center gap-1 rounded-full px-4 text-[13px] font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active ? 'bg-ink text-ink-foreground' : 'text-foreground/80 hover:bg-white/70 hover:text-foreground dark:hover:bg-white/10',
    );

  return (
    <nav aria-label="Main" className="mx-auto hidden min-w-0 xl:block">
      <div className="glass flex items-center gap-0.5 rounded-full p-1">
        {can('dashboard.view') && (
          <Link href="/dashboard" aria-current={pathname === '/dashboard' ? 'page' : undefined} className={pill(pathname === '/dashboard')}>
            Dashboard
          </Link>
        )}
        {pills.map((g) => (
          <DropdownMenu key={g.label}>
            <DropdownMenuTrigger className={pill(inGroup(g))}>
              {PILL_GROUPS[g.label]}
              <ChevronDown className="size-3.5 opacity-60" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
              {g.items.map((it) => (
                <DropdownMenuItem key={it.href} onSelect={() => router.push(it.href)} className={cn(isActive(pathname, it.href) && 'bg-accent text-accent-foreground')}>
                  <it.icon /> {it.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
        {more.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className={pill(more.some(inGroup))}>
              More
              <ChevronDown className="size-3.5 opacity-60" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[70dvh] w-[520px] overflow-y-auto">
              <div className="grid grid-cols-2 gap-x-2">
                {more.map((g) => (
                  <div key={g.label} className="py-1">
                    <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
                    {g.items.map((it) => (
                      <DropdownMenuItem key={it.href} onSelect={() => router.push(it.href)} className={cn(isActive(pathname, it.href) && 'bg-accent text-accent-foreground')}>
                        <it.icon /> {it.label}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------ round-button rail

function railClass(kind: 'plain' | 'ink' | 'on') {
  return cn(
    'relative flex size-11 shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
    kind === 'ink' && 'bg-ink text-ink-foreground hover:opacity-90',
    kind === 'on' && 'bg-popover text-primary shadow-[0_4px_14px_rgb(40_52_90/0.12)] ring-1 ring-primary/25',
    kind === 'plain' && 'glass text-foreground/80 hover:text-foreground',
  );
}

function RailLink({ href, label, icon: Icon, active, dot }: { href: string; label: string; icon: LucideIcon; active: boolean; dot?: number }) {
  return (
    <Tooltip content={label} side="right">
      <Link href={href} aria-label={dot ? `${label}, ${dot} unread` : label} aria-current={active ? 'page' : undefined} className={railClass(active ? 'on' : 'plain')}>
        <Icon className="size-[18px]" strokeWidth={1.8} />
        {!!dot && <span className="absolute top-2 right-2 size-2.5 rounded-full bg-destructive ring-2 ring-popover" aria-hidden />}
      </Link>
    </Tooltip>
  );
}

function Rail({
  groups,
  pins,
  togglePin,
  current,
  pathname,
}: {
  groups: NavGroup[];
  pins: string[];
  togglePin: (href: string) => void;
  current: NavItem | null;
  pathname: string;
}) {
  const { can } = useSession();
  const router = useRouter();
  const all = groups.flatMap((g) => g.items);
  const screens = RAIL_SCREENS.map((href) => all.find((i) => i.href === href)).filter((i): i is NavItem => !!i);
  const pinned = pins.map((href) => all.find((i) => i.href === href)).filter((i): i is NavItem => !!i);
  const create = QUICK_CREATE.filter((q) => can(q.permission));
  const chat = useApiQuery<{ total: number }>('/chat/unread', undefined, can('chat.view'));
  const currentPinned = current ? pins.includes(current.href) : false;

  return (
    <nav aria-label="Quick actions" className="sticky top-[76px] hidden h-[calc(100dvh-92px)] w-11 shrink-0 flex-col items-center gap-2.5 py-2 lg:flex print:hidden">
      {can('dashboard.view') && <RailLink href="/dashboard" label="Home" icon={House} active={pathname === '/dashboard'} />}
      {can('assistant.view') && (
        <Tooltip content="Ask ERP (Ctrl J)" side="right">
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: '' }))} aria-label="Ask ERP" className={railClass('plain')}>
            <Sparkles className="size-[18px] text-primary" strokeWidth={1.8} />
          </button>
        </Tooltip>
      )}
      <DropdownMenu>
        <Tooltip content="Pinned screens" side="right">
          <DropdownMenuTrigger aria-label="Pinned screens" className={railClass(pinned.length ? 'plain' : 'plain')}>
            <Star className={cn('size-[18px]', pinned.length && 'fill-current text-warning')} strokeWidth={1.8} />
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent side="right" align="start" className="w-64">
          <DropdownMenuLabel>Pinned screens</DropdownMenuLabel>
          {pinned.length === 0 && <div className="px-2.5 pb-2 text-xs text-muted-foreground">Pin the screens you open every day.</div>}
          {pinned.map((it) => (
            <DropdownMenuItem key={it.href} onSelect={() => router.push(it.href)}>
              <it.icon /> {it.label}
            </DropdownMenuItem>
          ))}
          {current && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => togglePin(current.href)}>
                {currentPinned ? <PinOff /> : <Pin />} {currentPinned ? `Unpin ${current.label}` : `Pin ${current.label}`}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {create.length > 0 && (
        <DropdownMenu>
          <Tooltip content="Create new" side="right">
            <DropdownMenuTrigger aria-label="Create new" className={railClass('ink')}>
              <Plus className="size-5" strokeWidth={2.2} />
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent side="right" align="start" className="w-64">
            <DropdownMenuLabel>Create new</DropdownMenuLabel>
            {create.map((q) => (
              <DropdownMenuItem key={q.href} onSelect={() => router.push(q.href)} className="items-start gap-3 py-2">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <q.icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{q.label}</span>
                  <span className="block text-xs text-muted-foreground">{q.hint}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {can('chat.view') && <RailLink href="/chat" label="Chat" icon={MessagesSquare} active={isActive(pathname, '/chat')} dot={chat.data?.total ?? 0} />}
      {screens.length > 0 && <span className="my-1 h-px w-6 bg-foreground/10" aria-hidden />}
      {screens.map((it) => (
        <RailLink key={it.href} href={it.href} label={it.label} icon={it.icon} active={isActive(pathname, it.href)} />
      ))}
      <span className="flex-1" aria-hidden />
      <RailTheme />
    </nav>
  );
}

/** The two round theme buttons at the foot of the rail; the one in use is dark. */
function RailTheme() {
  const { resolvedTheme, setTheme } = useTheme();
  const { save } = usePreferences();
  const pick = (t: 'light' | 'dark') => {
    setTheme(t);
    void save({ theme: t }, { quiet: true });
  };
  return (
    <>
      <Tooltip content="Dark theme" side="right">
        <button type="button" onClick={() => pick('dark')} aria-label="Dark theme" aria-pressed={resolvedTheme === 'dark'} className={railClass(resolvedTheme === 'dark' ? 'ink' : 'plain')}>
          <Moon className="size-[18px]" strokeWidth={1.8} />
        </button>
      </Tooltip>
      <Tooltip content="Light theme" side="right">
        <button type="button" onClick={() => pick('light')} aria-label="Light theme" aria-pressed={resolvedTheme !== 'dark'} className={railClass(resolvedTheme !== 'dark' ? 'ink' : 'plain')}>
          <Sun className="size-[18px]" strokeWidth={1.8} />
        </button>
      </Tooltip>
    </>
  );
}

// ------------------------------------------------------------------ phone / small screen menu

function MobileNav({ groups, pins, pathname }: { groups: NavGroup[]; pins: string[]; pathname: string }) {
  const all = groups.flatMap((g) => g.items);
  const pinned = pins.map((href) => all.find((i) => i.href === href)).filter((i): i is NavItem => !!i);
  const link = (it: NavItem) => {
    const active = isActive(pathname, it.href);
    return (
      <li key={it.href}>
        <Link
          href={it.href}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex h-10 items-center gap-3 rounded-full px-3.5 text-sm transition-colors',
            active ? 'bg-ink font-semibold text-ink-foreground' : 'text-foreground/85 hover:bg-muted',
          )}
        >
          <it.icon className="size-4 shrink-0" strokeWidth={1.8} />
          <span className="truncate">{it.label}</span>
        </Link>
      </li>
    );
  };
  return (
    <>
      <div className="flex items-center gap-2.5 border-b px-4 py-4">
        <Logo className="size-9" />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[15px] font-extrabold">{BRAND.name}</div>
          <div className="truncate text-xs text-muted-foreground">{BRAND.product}</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main">
        {pinned.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-1.5 px-3.5 pb-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
              <Star className="size-3" /> Pinned
            </div>
            <ul className="space-y-0.5">{pinned.map(link)}</ul>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-4">
            <div className="flex items-center gap-1.5 px-3.5 pb-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
              <LayoutGrid className="size-3" /> {g.label}
            </div>
            <ul className="space-y-0.5">{g.items.map(link)}</ul>
          </div>
        ))}
      </nav>
    </>
  );
}

// ------------------------------------------------------------------ logo and account

/** The product mark: a dark tile with a hex nut, the most common part in any engineering works. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8 shrink-0', className)} aria-hidden>
      <rect width="32" height="32" rx="10" style={{ fill: 'var(--ink)' }} />
      <path d="M16 6.2 24.5 11.1v9.8L16 25.8l-8.5-4.9v-9.8Z" fill="none" strokeWidth="2.4" strokeLinejoin="round" style={{ stroke: 'var(--ink-foreground)' }} />
      <circle cx="16" cy="16" r="3.6" style={{ fill: 'var(--ink-foreground)' }} />
    </svg>
  );
}

/** The signed-in user's picture, as chosen in Settings. */
function Avatar({ className }: { className?: string }) {
  const { user } = useSession();
  return <UserAvatar name={user.name} photo={user.avatar} style={user.preferences.avatar} className={className} />;
}

function UserMenu() {
  const { user } = useSession();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { save } = usePreferences();
  const queryClient = useQueryClient();

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    queryClient.clear();
    router.replace('/login');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full ring-2 ring-white/90 focus-visible:ring-ring focus-visible:outline-none dark:ring-white/10" aria-label="Account menu">
          <Avatar className="size-10 text-[12px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
          <Avatar className="size-10" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{user.name}</span>
            <span className="block truncate text-xs font-normal">
              @{user.username} · {user.role.name}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/settings')}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/account')}>
          <KeyRound /> Change password
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const t = resolvedTheme === 'dark' ? 'light' : 'dark';
            setTheme(t);
            void save({ theme: t }, { quiet: true });
          }}
        >
          {resolvedTheme === 'dark' ? <Sun /> : <Moon />} {resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'}
        </DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={logout}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
