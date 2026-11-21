'use client';

import { forwardRef, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { Building2, Check, ChevronsUpDown, Component, History, Package, Plus, Search } from 'lucide-react';
import type { LookupOption } from '@/hooks/use-api';
import { fmtMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';

// ------------------------------------------------------------------ customer

/** Pick a customer by name or code, or add a new one with what was typed. */
export function CustomerPicker({
  value,
  onChange,
  options,
  onAddNew,
  invalid,
}: {
  value: number | undefined;
  onChange: (id: number) => void;
  options: LookupOption[] | undefined;
  onAddNew: (typed: string) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options?.find((o) => o.value === value);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn(
            'flex h-11 w-full items-center gap-2.5 rounded-lg border border-input bg-card px-3 text-left text-sm transition-colors hover:border-[color-mix(in_oklch,var(--input),var(--foreground)_12%)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none aria-invalid:border-destructive',
          )}
        >
          <Building2 className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>{selected?.label ?? 'Search or add a customer…'}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-80 p-0">
        <Command>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" />
            <Command.Input value={search} onValueChange={setSearch} placeholder="Name or code…" className="h-10 flex-1 bg-transparent text-sm outline-none" />
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-5 text-center text-sm text-muted-foreground">No customer found.</Command.Empty>
            {options?.map((o) => (
              <Command.Item
                key={o.value}
                value={`${o.label} ${String(o.meta?.code ?? '')}`}
                onSelect={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent"
              >
                <Check className={cn('size-4 text-primary', o.value === value ? 'opacity-100' : 'opacity-0')} />
                <span className="flex-1 truncate">{o.label}</span>
                {typeof o.meta?.code === 'string' && <span className="font-mono text-xs text-muted-foreground">{o.meta.code}</span>}
              </Command.Item>
            ))}
          </Command.List>
          <div className="border-t p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onAddNew(search.trim());
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-primary hover:bg-accent"
            >
              <Plus className="size-4" />
              {search.trim() ? `Add “${search.trim()}” as a new customer` : 'Add a new customer'}
            </button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------------ invoice line item

export interface SaleItem {
  key: string;
  kind: 'Product' | 'Part' | 'Billed before';
  name: string;
  code?: string;
  hsnCode?: string | null;
  uom?: string | null;
  /** price from the master (part minimum price) */
  price?: number | null;
  /** this customer's last rate for it */
  lastRate?: { rate: number; currency: string; invoiceNo: string } | null;
}

const KIND_ICON = { Product: Package, Part: Component, 'Billed before': History } as const;

/**
 * Description box of an invoice line that suggests products, parts and what this customer was billed before.
 * Typing anything else is fine too (services, scrap, charges). Arrow keys + Enter pick, Esc closes.
 */
export const ItemPicker = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (text: string) => void;
    onBlur?: () => void;
    onPick: (item: SaleItem) => void;
    items: SaleItem[];
    currency: string;
    invalid?: boolean;
    disabled?: boolean;
    placeholder?: string;
    ariaLabel: string;
  }
>(function ItemPicker({ value, onChange, onBlur, onPick, items, currency, invalid, disabled, placeholder, ariaLabel }, ref) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q ? items.filter((i) => i.name.toLowerCase().includes(q) || (i.code ?? '').toLowerCase().includes(q)) : items;
    // what this customer bought before comes first, then exact starts
    return list
      .map((i, n) => ({ i, n, s: (i.lastRate ? 0 : 2) + (q && i.name.toLowerCase().startsWith(q) ? 0 : 1) }))
      .sort((a, b) => a.s - b.s || a.n - b.n)
      .slice(0, 8)
      .map((r) => r.i);
  }, [items, value]);

  const exact = matches.length === 1 && matches[0].name.toLowerCase() === value.trim().toLowerCase();
  const show = open && !disabled && matches.length > 0 && !exact;

  const pick = (item: SaleItem) => {
    onPick(item);
    setOpen(false);
  };

  return (
    <PopoverPrimitive.Root open={show} onOpenChange={(o) => !o && setOpen(false)}>
      <PopoverPrimitive.Anchor asChild>
        <div ref={anchor}>
          <Input
            ref={ref}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              onBlur?.();
              setTimeout(() => setOpen(false), 120);
            }}
            onKeyDown={(e) => {
              if (!show) {
                if (e.key === 'ArrowDown') setOpen(true);
                return;
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, matches.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(matches[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              }
            }}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-invalid={invalid}
            aria-autocomplete="list"
            autoComplete="off"
          />
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (anchor.current?.contains(e.target as Node)) e.preventDefault();
          }}
          className="z-50 w-[max(var(--radix-popover-trigger-width),380px)] overflow-hidden rounded-lg border bg-popover p-1 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <ul role="listbox" aria-label="Suggestions" className="max-h-80 overflow-y-auto">
            {matches.map((m, n) => {
              const Icon = KIND_ICON[m.kind];
              const rate = m.lastRate && m.lastRate.currency === currency ? m.lastRate.rate : m.price;
              return (
                <li key={m.key} role="option" aria-selected={n === active}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(n)}
                    onClick={() => pick(m)}
                    className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left', n === active && 'bg-accent')}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{m.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[m.kind, m.code, m.hsnCode && `HSN ${m.hsnCode}`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {rate != null && (
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-medium tabular-nums">{fmtMoney(rate, m.lastRate ? m.lastRate.currency : 'INR')}</span>
                        <span className="block text-[11px] text-muted-foreground">{m.lastRate ? 'last rate' : 'min. price'}</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 border-t px-2.5 pt-1.5 pb-1 text-[11px] text-muted-foreground">↑ ↓ to move · Enter to pick · or keep typing for a service / charge</div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
});
