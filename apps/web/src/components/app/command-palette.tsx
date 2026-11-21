'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  Building2,
  Component,
  Contact,
  CornerDownLeft,
  FileSignature,
  FileText,
  Flame,
  Handshake,
  Loader2,
  Package,
  Route,
  Search,
  ShoppingCart,
  Sparkles,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { SearchHit } from '@/lib/types';
import { ACCOUNT_NAV, SETTINGS_NAV, type NavGroup, type NavItem } from './nav';
import { ASK_EVENT } from './assistant';
import { useSession } from './session';

/**
 * Screen name beats keywords: typing "heat" must land on Heat Numbers,
 * not on another screen that only mentions heats in its keywords.
 */
function score(value: string, search: string, keywords?: string[]): number {
  const s = search.trim().toLowerCase();
  if (!s) return 1;
  const label = value.toLowerCase();
  if (label.startsWith(s)) return 1;
  if (label.split(/[\s&/]+/).some((w) => w.startsWith(s))) return 0.9;
  if (label.includes(s)) return 0.8;
  if (keywords?.some((k) => k.toLowerCase().startsWith(s))) return 0.5;
  return 0;
}

const HIT_ICONS: Record<string, LucideIcon> = {
  'Sales order': FileSignature,
  Invoice: FileText,
  'Purchase order': ShoppingCart,
  'Route card': Route,
  'Job work order': Handshake,
  Heat: Flame,
  Customer: Building2,
  Supplier: Truck,
  Part: Component,
  Product: Package,
  Employee: Contact,
};

type Row = { value: string; href: string; icon: LucideIcon; title: string; subtitle?: string; tag?: string };

/** Ctrl+K: search records (orders, invoices, parties, heats …) and jump to any screen. */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: NavGroup[];
}) {
  const router = useRouter();
  const { can } = useSession();
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  const go = (href: string) => {
    onOpenChange(false);
    setSearch('');
    router.push(href);
  };

  // records: asked from the server a moment after typing stops
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let live = true;
    const t = setTimeout(() => {
      api<{ hits: SearchHit[] }>('/search', { query: { q } })
        .then((r) => live && setHits(r.hits))
        .catch(() => live && setHits([]))
        .finally(() => live && setLoading(false));
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [search]);

  // While searching: records first, then matching screens. Otherwise: the grouped menu.
  const sections = useMemo((): { label: string; rows: Row[] }[] => {
    const all = [...groups, { label: 'Account', items: [SETTINGS_NAV, ACCOUNT_NAV] }];
    const screen = (item: NavItem, tag?: string): Row => ({ value: item.href, href: item.href, icon: item.icon, title: item.label, tag });
    if (!search.trim()) return all.map((g) => ({ label: g.label, rows: g.items.map((i) => screen(i)) }));
    const screens = all
      .flatMap((g) => g.items.map((item) => ({ item, group: g.label })))
      .map((r) => ({ ...r, s: score(r.item.label, search, r.item.keywords?.split(' ')) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => screen(r.item, r.group));
    const records: Row[] = hits.map((h) => ({
      value: `rec:${h.type}:${h.id}`,
      href: h.href,
      icon: HIT_ICONS[h.type] ?? FileText,
      title: h.title,
      subtitle: h.subtitle,
      tag: h.type,
    }));
    const askRow: Row[] = can('assistant.view') ? [{ value: 'ask-erp', href: '', icon: Sparkles, title: `Ask ERP: “${search.trim()}”`, subtitle: 'Answer from live ERP data', tag: 'Ctrl J' }] : [];
    return [
      ...(records.length ? [{ label: 'Records', rows: records }] : []),
      ...(screens.length ? [{ label: 'Screens', rows: screens }] : []),
      ...(askRow.length ? [{ label: 'Ask', rows: askRow }] : []),
    ];
  }, [groups, search, hits, can]);

  // Enter always opens the top result.
  const [selected, setSelected] = useState('');
  useEffect(() => setSelected(sections[0]?.rows[0]?.value ?? ''), [sections]);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) setSearch('');
        onOpenChange(o);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed top-[10vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <Command loop shouldFilter={false} value={selected} onValueChange={setSelected} className="flex flex-col">
            <div className="flex items-center gap-3 border-b px-4">
              {loading ? <Loader2 className="size-[18px] animate-spin text-muted-foreground" /> : <Search className="size-[18px] text-muted-foreground" />}
              <Command.Input
                autoFocus
                value={search}
                onValueChange={setSearch}
                placeholder="Search an order, invoice, customer, heat, part or screen…"
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Command.List className="max-h-[56vh] overflow-y-auto p-2">
              <Command.Empty className="py-10 text-center text-sm text-muted-foreground">
                {loading ? 'Searching…' : 'Nothing found. Try a number (SO/26-27/0001), a code or a name.'}
              </Command.Empty>
              {sections.map((group) => (
                <Command.Group
                  key={group.label}
                  heading={group.label}
                  className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {group.rows.map((row) => (
                    <Command.Item
                      key={row.value}
                      value={row.value}
                      onSelect={() => {
                        if (row.value === 'ask-erp') {
                          const q = search.trim();
                          onOpenChange(false);
                          setSearch('');
                          window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: q }));
                          return;
                        }
                        go(row.href);
                      }}
                      className="group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm data-[selected=true]:bg-accent"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground group-data-[selected=true]:border-primary/20 group-data-[selected=true]:text-primary">
                        <row.icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{row.title}</span>
                        {row.subtitle && <span className="block truncate text-xs text-muted-foreground">{row.subtitle}</span>}
                      </span>
                      {row.tag && <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground sm:inline">{row.tag}</span>}
                      <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-data-[selected=true]:opacity-100" />
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
            <div className="flex items-center gap-4 border-t bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
              <span>
                <kbd className="font-sans">↑ ↓</kbd> move
              </span>
              <span>
                <kbd className="font-sans">Enter</kbd> open
              </span>
              <span>
                <kbd className="font-sans">Esc</kbd> close
              </span>
              <span className="ml-auto hidden sm:inline">Searches only what your role may open</span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
