'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { z } from 'zod';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CircleAlert,
  Copy,
  History,
  Info,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import {
  amountInWords,
  computeTotals,
  CURRENCIES,
  DEFAULT_INVOICE_TERMS,
  directInvoiceSchema,
  GST_TYPE_LABELS,
  GST_TYPES,
  INDIAN_STATES,
  INVOICE_UNIT_LABELS,
  invoiceSchema,
  UNITS,
  type GstType,
} from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtDate, fmtMoney, fmtQty, toInputDate } from '@/lib/format';
import { showApiError, useApiQuery, type LookupOption } from '@/hooks/use-api';
import type { Invoice } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Card, Label, Switch } from '@/components/ui/primitives';
import {
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/overlays';
import { CustomerPicker, ItemPicker, type SaleItem } from './pickers';
import { QuickCustomerDialog } from './quick-customer-dialog';

/** The form holds the fields of a direct invoice; a draft only sends the ones its schema knows. */
type FormValues = z.input<typeof directInvoiceSchema>;
type Line = FormValues['lines'][number];
type Form = ReturnType<typeof useZodForm<typeof directInvoiceSchema>>;

interface LastRate {
  description: string;
  hsnCode: string | null;
  uom: string;
  rate: number;
  currency: string;
  invoiceNo: string;
  invoiceDate: string;
}

interface PartyDefaults {
  billingName: string;
  billingAddress: string | null;
  billingGstin: string | null;
  shippingName: string | null;
  shippingAddress: string | null;
  shippingGstin: string | null;
  placeOfSupply: string | null;
  gstType: GstType;
  currency: string;
  paymentTermsDays: number | null;
  terms: string;
  notes: string | null;
  outstanding: { total: number; overdue: number; bills: number };
  lastRates: LastRate[];
}

const emptyLine = (): Line => ({ description: '', hsnCode: '', quantity: '' as unknown as number, uom: 'NOS', rate: '' as unknown as number });
const unitLabel = (u: string) => INVOICE_UNIT_LABELS[u as keyof typeof INVOICE_UNIT_LABELS] ?? u;
const TERM_DAYS = [0, 15, 30, 45, 60, 90];
const GST_RATES = [0, 5, 12, 18, 28];
const inr = (v: number) => fmtMoney(v, 'INR');
const stateName = (code?: string | null) => INDIAN_STATES.find((s) => s.code === code)?.name;

export function initialInvoiceValues(inv: Invoice): FormValues {
  return {
    companyId: inv.companyId,
    customerId: inv.customerId,
    currency: inv.currency,
    exchangeRate: 1,
    invoiceDate: toInputDate(inv.invoiceDate),
    dueDate: toInputDate(inv.dueDate),
    customerPoNo: inv.customerPoNo ?? '',
    customerPoDate: toInputDate(inv.customerPoDate),
    billingName: inv.billingName,
    billingAddress: inv.billingAddress ?? '',
    billingGstin: inv.billingGstin ?? '',
    shippingName: inv.shippingName ?? '',
    shippingAddress: inv.shippingAddress ?? '',
    shippingGstin: inv.shippingGstin ?? '',
    placeOfSupply: inv.placeOfSupply ?? '',
    gstType: inv.gstType,
    taxRate: inv.taxRate,
    discountPercent: inv.discountPercent,
    freight: inv.freight,
    transporter: inv.transporter ?? '',
    vehicleNo: inv.vehicleNo ?? '',
    terms: inv.terms ?? '',
    notes: inv.notes ?? '',
    lines: inv.lines.map((l) => ({ id: l.id, description: l.description, hsnCode: l.hsnCode ?? '', quantity: l.quantity, uom: l.uom, rate: l.rate })),
  };
}

function newInvoiceValues(companies: LookupOption[]): FormValues {
  return {
    companyId: (companies.find((c) => c.meta?.isDefault)?.value ?? companies[0]?.value) as number,
    customerId: '' as unknown as number,
    currency: 'INR',
    exchangeRate: 1,
    invoiceDate: format(new Date(), 'yyyy-MM-dd'),
    dueDate: '',
    customerPoNo: '',
    customerPoDate: '',
    billingName: '',
    billingAddress: '',
    billingGstin: '',
    shippingName: '',
    shippingAddress: '',
    shippingGstin: '',
    placeOfSupply: '',
    gstType: 'INTRA_STATE',
    taxRate: 18,
    discountPercent: 0,
    freight: 0,
    transporter: '',
    vehicleNo: '',
    terms: DEFAULT_INVOICE_TERMS,
    notes: '',
    lines: [emptyLine()],
  };
}

/** Ship-to counts as "same as bill-to" when it is empty or a copy of it. */
function shipsToBilling(v: Partial<Pick<FormValues, 'shippingName' | 'shippingAddress' | 'shippingGstin' | 'billingName' | 'billingAddress' | 'billingGstin'>>) {
  const same = (a?: string | null, b?: string | null) => !(a ?? '').trim() || (a ?? '').trim() === (b ?? '').trim();
  return same(v.shippingName, v.billingName) && same(v.shippingAddress, v.billingAddress) && same(v.shippingGstin, v.billingGstin);
}

/**
 * Invoice entry laid out like the printed invoice: our letterhead, bill-to / ship-to, the lines and the totals.
 * - no `inv`: a new direct invoice (customer and every line typed in);
 * - a direct draft: everything can be changed, lines added or removed;
 * - a draft made from a packing: quantities come from the packed sets, the rest can be corrected.
 * "Save & issue" saves and gives the number in one go.
 */
export function InvoiceEditor({
  inv,
  companies,
  customers,
  saleItems,
  canIssue,
  initialCustomerId,
  footer,
}: {
  inv?: Invoice;
  /** New invoice for this customer (from Ask ERP "create invoice for …" or a customer screen). */
  initialCustomerId?: number;
  companies: LookupOption[];
  customers?: LookupOption[];
  saleItems?: LookupOption[];
  canIssue: boolean;
  footer: (dirty: boolean) => React.ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const creating = !inv;
  const fromPacking = !!inv?.assembly;
  const initial = useMemo(() => (inv ? initialInvoiceValues(inv) : newInvoiceValues(companies)), [inv, companies]);
  const form = useZodForm(creating ? directInvoiceSchema : invoiceSchema, initial) as unknown as Form;
  const values = useWatch({ control: form.control }) as FormValues;
  const { fields, append, remove, insert, move } = useFieldArray({ control: form.control, name: 'lines' });
  const [editBill, setEditBill] = useState(false);
  const [sameShip, setSameShip] = useState(() => shipsToBilling(initial));
  const [newCustomer, setNewCustomer] = useState<string | null>(null);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const dirty = form.formState.isDirty;

  const customerId = creating ? Number(values.customerId) || undefined : inv.customerId;
  const companyId = Number(values.companyId) || undefined;
  const company = companies.find((c) => c.value === companyId);
  const party = useApiQuery<PartyDefaults>('/invoices/party-defaults', { customerId: String(customerId ?? ''), companyId: String(companyId ?? '') }, !!customerId);
  const nextNo = useApiQuery<{ invoiceNo: string }>(
    '/invoices/next-number',
    { companyId: String(companyId ?? ''), gstType: values.gstType ?? 'INTRA_STATE', date: values.invoiceDate ?? '' },
    !!companyId && /^\d{4}-\d{2}-\d{2}$/.test(values.invoiceDate ?? ''),
  );

  const set = useCallback(
    (name: string, value: unknown) => form.setValue(name as never, (value ?? '') as never, { shouldDirty: true, shouldValidate: form.formState.isSubmitted }),
    [form],
  );

  // ----------------------------------------------------------------- saving
  const bodyOf = (v: FormValues) => {
    const body = { ...v };
    if (sameShip) Object.assign(body, { shippingName: body.billingName, shippingAddress: body.billingAddress, shippingGstin: body.billingGstin });
    return body;
  };
  const saveCall = (v: FormValues) =>
    creating ? api<{ id: number }>('/invoices', { method: 'POST', body: bodyOf(v) }) : api<Invoice>(`/invoices/${inv.id}`, { method: 'PUT', body: bodyOf(v) });

  const save = useMutation({
    mutationFn: async ({ v, issue }: { v: FormValues; issue: boolean }) => {
      const saved = await saveCall(v);
      const id = creating ? (saved as { id: number }).id : inv.id;
      if (!issue) return { id, invoiceNo: null as string | null };
      try {
        const issued = await api<Invoice>(`/invoices/${id}/issue`, { method: 'POST' });
        return { id, invoiceNo: issued.invoiceNo };
      } catch (err) {
        // saved, but not issued: open the draft and say why
        showApiError(err);
        return { id, invoiceNo: null, issueFailed: true };
      }
    },
    onSuccess: async (r, { issue }) => {
      setConfirmIssue(false);
      if (r.invoiceNo) toast.success(`Invoice ${r.invoiceNo} issued`);
      else if (!(r as { issueFailed?: boolean }).issueFailed) toast.success(issue ? 'Saved' : 'Draft saved');
      form.reset(form.getValues());
      await queryClient.invalidateQueries({ queryKey: [`/invoices/${r.id}`] });
      if (creating) router.push(`/billing/invoices/${r.id}`);
    },
    onError: (err) => {
      setConfirmIssue(false);
      setEditBill(true);
      showApiError(err, form);
    },
  });

  const onInvalid = (e: Record<string, unknown>) => {
    if (e.billingName || e.billingGstin || e.placeOfSupply) setEditBill(true);
    toast.error('Some fields need a look - they are marked in red.');
  };
  const saveDraft = form.handleSubmit((v) => save.mutate({ v: v as FormValues, issue: false }), onInvalid);
  const askIssue = form.handleSubmit(() => setConfirmIssue(true), onInvalid);
  const doIssue = form.handleSubmit((v) => save.mutate({ v: v as FormValues, issue: true }), onInvalid);

  // Ctrl+S saves the draft; leaving with unsaved work asks first
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveDraft();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveDraft]);
  useEffect(() => {
    if (!dirty || save.isPending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, save.isPending]);

  // ----------------------------------------------------------------- customer
  /** Takes the customer's address, GSTIN, GST type, currency, due date and our terms. */
  const fillFromCustomer = async (id: number | undefined, coId: number | undefined, only?: 'gst') => {
    if (!id) return;
    try {
      const d = await api<PartyDefaults>('/invoices/party-defaults', { query: { customerId: String(id), ...(coId ? { companyId: String(coId) } : {}) } });
      set('gstType', d.gstType);
      if (d.gstType === 'EXPORT' || d.gstType === 'EXEMPT') set('taxRate', 0);
      else if (!Number(form.getValues('taxRate'))) set('taxRate', 18);
      if (only === 'gst') return;
      set('billingName', d.billingName);
      set('billingAddress', d.billingAddress);
      set('billingGstin', d.billingGstin);
      set('placeOfSupply', d.placeOfSupply);
      set('currency', d.currency);
      set('terms', d.terms);
      set('notes', d.notes);
      const ownDelivery = !!(d.shippingAddress ?? '').trim() && d.shippingAddress !== d.billingAddress;
      set('shippingName', ownDelivery ? d.shippingName : '');
      set('shippingAddress', ownDelivery ? d.shippingAddress : '');
      set('shippingGstin', ownDelivery ? d.shippingGstin : '');
      setSameShip(!ownDelivery);
      const date = form.getValues('invoiceDate');
      if (d.paymentTermsDays && date) set('dueDate', format(addDays(parseISO(date), d.paymentTermsDays), 'yyyy-MM-dd'));
      setEditBill(false);
    } catch (err) {
      showApiError(err);
    }
  };

  const chooseCustomer = (id: number) => {
    set('customerId', id);
    void fillFromCustomer(id, companyId);
  };
  useEffect(() => {
    if (creating && initialCustomerId) chooseCustomer(initialCustomerId);
    // only once, when the form opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------------------------------------- money
  const cur = (creating ? values.currency : inv.currency) ?? 'INR';
  const exchangeRate = creating ? Number(values.exchangeRate) || 0 : inv.exchangeRate;
  const totals = useMemo(
    () =>
      computeTotals({
        lines: (values.lines ?? []).map((l) => ({ quantity: Number(l?.quantity) || 0, rate: Number(l?.rate) || 0 })),
        discountPercent: Number(values.discountPercent) || 0,
        freight: Number(values.freight) || 0,
        taxRate: Number(values.taxRate) || 0,
        gstType: (values.gstType ?? 'INTRA_STATE') as GstType,
        currency: cur,
      }),
    [values, cur],
  );
  const taxRate = Number(values.taxRate) || 0;
  const noTax = values.gstType === 'EXPORT' || values.gstType === 'EXEMPT';
  const filledLines = (values.lines ?? []).filter((l) => (l?.description ?? '').trim()).length;
  const totalQty = (values.lines ?? []).reduce((s, l) => s + (Number(l?.quantity) || 0), 0);

  // ----------------------------------------------------------------- catalogue for the lines
  const lastRates = party.data?.lastRates;
  const catalog = useMemo<SaleItem[]>(() => {
    const last = new Map((lastRates ?? []).map((r) => [r.description.trim().toLowerCase(), r]));
    const out: SaleItem[] = [];
    const seen = new Set<string>();
    for (const o of saleItems ?? []) {
      const kind = (o.meta?.kind as 'Product' | 'Part') ?? 'Product';
      const r = last.get(o.label.trim().toLowerCase());
      seen.add(o.label.trim().toLowerCase());
      out.push({
        key: `${kind}-${o.value}`,
        kind,
        name: o.label,
        code: o.meta?.code as string | undefined,
        hsnCode: (o.meta?.hsnCode as string | null) ?? r?.hsnCode ?? null,
        uom: (o.meta?.uom as string | null) ?? null,
        price: (o.meta?.price as number | null) ?? null,
        lastRate: r ? { rate: r.rate, currency: r.currency, invoiceNo: r.invoiceNo } : null,
      });
    }
    for (const r of lastRates ?? []) {
      const k = r.description.trim().toLowerCase();
      if (seen.has(k)) continue;
      out.push({ key: `billed-${k}`, kind: 'Billed before', name: r.description, hsnCode: r.hsnCode, uom: r.uom, lastRate: { rate: r.rate, currency: r.currency, invoiceNo: r.invoiceNo } });
    }
    return out;
  }, [saleItems, lastRates]);
  const lastByName = useMemo(() => new Map((lastRates ?? []).map((r) => [r.description.trim().toLowerCase(), r])), [lastRates]);

  const pickItem = (i: number, item: SaleItem) => {
    set(`lines.${i}.description`, item.name);
    if (item.hsnCode) set(`lines.${i}.hsnCode`, item.hsnCode);
    if (item.uom && (UNITS as readonly string[]).includes(item.uom) && !fromPacking) set(`lines.${i}.uom`, item.uom);
    const rate = item.lastRate && item.lastRate.currency === cur ? item.lastRate.rate : item.price;
    if (rate != null && !fromPacking) set(`lines.${i}.rate`, rate);
    if (!fromPacking && !Number(form.getValues(`lines.${i}.quantity`))) setTimeout(() => form.setFocus(`lines.${i}.quantity`), 0);
  };

  const addLine = () => {
    append(emptyLine());
    setTimeout(() => form.setFocus(`lines.${fields.length}.description`), 0);
  };

  // ----------------------------------------------------------------- checks before issuing
  const termDays = values.invoiceDate && values.dueDate ? differenceInCalendarDays(parseISO(values.dueDate), parseISO(values.invoiceDate)) : null;
  const hasCustomer = !!(values.billingName ?? '').trim();
  const companyState = company?.meta?.stateCode as string | undefined;
  const expectedGst = noTax || !values.placeOfSupply || !companyState ? null : companyState === values.placeOfSupply ? 'INTRA_STATE' : 'INTER_STATE';
  const gstinState = (values.billingGstin ?? '').trim().slice(0, 2);
  const lines = values.lines ?? [];
  const checks: { ok: boolean; text: string; fix?: string }[] = [
    { ok: hasCustomer, text: 'Customer chosen', fix: 'Choose or add a customer.' },
    {
      ok: noTax || !!values.placeOfSupply,
      text: 'Place of supply',
      fix: 'Set the place of supply (decides CGST + SGST or IGST).',
    },
    {
      ok: !expectedGst || expectedGst === values.gstType,
      text: 'GST type fits the place of supply',
      fix: expectedGst === 'INTRA_STATE' ? 'Same state as us: use CGST + SGST.' : 'Other state: use IGST.',
    },
    {
      ok: noTax || !gstinState || gstinState === values.placeOfSupply,
      text: 'GSTIN matches the state',
      fix: `The GSTIN starts with ${gstinState}, but the place of supply is ${values.placeOfSupply || '—'}.`,
    },
    {
      ok: lines.length > 0 && lines.every((l) => (l?.description ?? '').trim() && Number(l?.quantity) > 0 && Number(l?.rate) > 0),
      text: 'Every line has item, qty and rate',
      fix: 'Fill or remove the incomplete line.',
    },
    { ok: noTax || lines.every((l) => !(l?.description ?? '').trim() || (l?.hsnCode ?? '').trim()), text: 'HSN / SAC on every line', fix: 'GST needs an HSN or SAC code per line.' },
    { ok: !!values.dueDate, text: 'Due date', fix: 'Pick payment terms or a due date.' },
  ];
  const open = checks.filter((c) => !c.ok);
  const owed = party.data?.outstanding;

  // ----------------------------------------------------------------- layout
  return (
    <form onSubmit={saveDraft} noValidate className="space-y-4">
      {creating && (
        <div className="flex items-start gap-2.5 rounded-lg border bg-card px-4 py-2.5 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <p>
            <span className="font-medium text-foreground">Direct invoice</span> for services, job work charges, scrap or samples - it does not change stock. For
            finished sets of a sales order use{' '}
            <Link href="/dispatch/packing?status=PACKED" className="font-medium text-primary hover:underline">
              Packing → Make invoice
            </Link>
            .
          </p>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="h-1.5 bg-primary" aria-hidden />

        {/* ---------------- letterhead + number and dates */}
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0 text-sm">
            {companies.length > 1 ? (
              <Controller
                control={form.control}
                name="companyId"
                render={({ field }) => (
                  <NativeSelect
                    value={String(field.value ?? '')}
                    onChange={(e) => {
                      const id = Number(e.target.value) || undefined;
                      field.onChange(id ?? '');
                      if (creating) void fillFromCustomer(Number(form.getValues('customerId')) || undefined, id, 'gst');
                    }}
                    className="h-10 max-w-sm text-base font-semibold"
                    aria-label="Billing company"
                  >
                    {companies.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              />
            ) : (
              <div className="text-lg font-semibold tracking-[-0.01em]">{(company?.meta?.legalName as string) || company?.label}</div>
            )}
            <div className="mt-1.5 space-y-0.5 text-muted-foreground">
              {company?.meta?.address ? <div>{String(company.meta.address)}</div> : null}
              {company?.meta?.phone || company?.meta?.email ? <div>{[company.meta.phone, company.meta.email].filter(Boolean).join(' · ')}</div> : null}
            </div>
            {company?.meta?.gstin ? <div className="mt-2 font-mono text-xs">GSTIN {String(company.meta.gstin)}</div> : null}
          </div>

          <div className="space-y-3 lg:w-[440px]">
            <div className="lg:text-right">
              <div className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">{values.gstType === 'EXPORT' ? 'Export invoice' : 'Tax invoice'}</div>
              <div className="mt-1 font-mono text-xl font-semibold tracking-tight">{nextNo.data?.invoiceNo ?? '—'}</div>
              <div className="text-[11px] text-muted-foreground">Number given when issued{inv ? ' · draft' : ''}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DateBox form={form} name="invoiceDate" label="Invoice date" required />
              <DateBox form={form} name="dueDate" label="Due date" />
            </div>
            <div className="flex flex-wrap gap-1.5 lg:justify-end" role="group" aria-label="Payment terms">
              {TERM_DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={!values.invoiceDate}
                  onClick={() => values.invoiceDate && set('dueDate', format(addDays(parseISO(values.invoiceDate), d), 'yyyy-MM-dd'))}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50',
                    termDays === d ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  aria-pressed={termDays === d}
                >
                  {d === 0 ? 'On receipt' : `Net ${d}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ---------------- bill to / ship to */}
        <div className="grid gap-px border-y bg-border md:grid-cols-2">
          <section className="space-y-3 bg-card p-6 sm:px-8">
            <div className="flex items-center justify-between gap-2">
              <Caption>Bill to</Caption>
              {hasCustomer && !editBill && (
                <div className="flex gap-1">
                  {creating && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => set('customerId', '')}>
                      Change
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditBill(true)}>
                    <Pencil /> Edit
                  </Button>
                </div>
              )}
            </div>

            {creating && (!customerId || !hasCustomer) ? (
              <>
                <CustomerPicker value={customerId} onChange={chooseCustomer} options={customers} onAddNew={(typed) => setNewCustomer(typed)} invalid={!!form.formState.errors.customerId} />
                {form.formState.errors.customerId && <p className="text-xs text-destructive">Choose a customer.</p>}
                <p className="text-xs text-muted-foreground">Address, GSTIN, GST type, currency, due date and terms fill in by themselves.</p>
              </>
            ) : editBill ? (
              <div className="space-y-3">
                <Fld form={form} name="billingName" label="Name" required />
                <Fld form={form} name="billingAddress" label="Address" textarea />
                <div className="grid grid-cols-2 gap-3">
                  <Fld form={form} name="billingGstin" label="GSTIN" mono upper maxLength={15} />
                  <StateSelect form={form} name="placeOfSupply" label="Place of supply" />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditBill(false)}>
                  <CheckCircle2 /> Done
                </Button>
              </div>
            ) : (
              <div className="text-sm">
                <div className="text-[15px] font-semibold">{values.billingName}</div>
                {values.billingAddress && <div className="mt-0.5 whitespace-pre-line text-muted-foreground">{values.billingAddress}</div>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {values.billingGstin ? <Chip mono>GSTIN {values.billingGstin}</Chip> : <Chip>No GSTIN (unregistered)</Chip>}
                  {values.placeOfSupply && (
                    <Chip>
                      {stateName(values.placeOfSupply)} ({values.placeOfSupply})
                    </Chip>
                  )}
                </div>
              </div>
            )}

            {owed && owed.total > 0 && (
              <div className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-xs', owed.overdue > 0 ? 'bg-destructive/8 text-destructive' : 'bg-warning/12')}>
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>
                  Already owes <b>{inr(owed.total)}</b> on {owed.bills} bill{owed.bills === 1 ? '' : 's'}
                  {owed.overdue > 0 ? (
                    <>
                      {' '}
                      - <b>{inr(owed.overdue)} overdue</b>
                    </>
                  ) : (
                    ', nothing overdue'
                  )}
                  .
                </span>
              </div>
            )}
          </section>

          <section className="space-y-3 bg-card p-6 sm:px-8">
            <div className="flex items-center justify-between gap-2">
              <Caption>Ship to</Caption>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Same as billing
                <Switch checked={sameShip} onCheckedChange={(c) => setSameShip(c)} aria-label="Ship to the billing address" />
              </label>
            </div>
            {sameShip ? (
              <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Truck className="size-4" aria-hidden /> Goods go to the billing address.
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => setSameShip(false)}>
                  <Plus /> Add a shipping address
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Fld form={form} name="shippingName" label="Name" placeholder={values.billingName || 'Consignee name'} />
                <Fld form={form} name="shippingAddress" label="Delivery address" textarea />
                <Fld form={form} name="shippingGstin" label="GSTIN (if registered)" mono upper maxLength={15} />
                <button
                  type="button"
                  onClick={() => {
                    set('shippingName', values.billingName);
                    set('shippingAddress', values.billingAddress);
                    set('shippingGstin', values.billingGstin);
                  }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Copy from billing
                </button>
              </div>
            )}
          </section>
        </div>

        {/* ---------------- references */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b px-6 py-5 sm:px-8 md:grid-cols-4">
          {!editBill && <StateSelect form={form} name="placeOfSupply" label="Place of supply" />}
          <Fld form={form} name="customerPoNo" label="Customer PO no." />
          <DateBox form={form} name="customerPoDate" label="PO date" />
          <Fld form={form} name="transporter" label="Transporter" />
          <Fld form={form} name="vehicleNo" label="Vehicle no." upper />
          {creating && (
            <div className="space-y-1.5">
              <Label htmlFor="inv-currency">Currency</Label>
              <NativeSelect id="inv-currency" {...form.register('currency')}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {creating && values.currency !== 'INR' && <Fld form={form} name="exchangeRate" label={`1 ${values.currency} = ₹`} type="number" step="0.0001" min={0} />}
        </div>

        {/* ---------------- lines */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/50 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="w-10 py-2.5 pl-6 text-left sm:pl-8">#</th>
                <th className="min-w-72 px-2 py-2.5 text-left">Item / service</th>
                <th className="w-28 px-2 py-2.5 text-left">HSN / SAC</th>
                <th className="w-24 px-2 py-2.5 text-right">Qty</th>
                <th className="w-24 px-2 py-2.5 text-left">Unit</th>
                <th className="w-36 px-2 py-2.5 text-right">Rate</th>
                <th className="w-36 px-2 py-2.5 text-right">Amount</th>
                <th className="w-12 py-2.5 pr-6 sm:pr-8" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {fields.map((f, i) => {
                const err = (form.formState.errors.lines as any)?.[i];
                const line = lines[i];
                const last = lastByName.get((line?.description ?? '').trim().toLowerCase());
                const qty = Number(line?.quantity) || 0;
                const rate = Number(line?.rate) || 0;
                return (
                  <tr key={f.id} className="align-top transition-colors hover:bg-muted/20">
                    <td className="py-3 pl-6 text-muted-foreground tabular-nums sm:pl-8">{i + 1}</td>
                    <td className="px-2 py-2">
                      <Controller
                        control={form.control}
                        name={`lines.${i}.description`}
                        render={({ field }) => (
                          <ItemPicker
                            ref={field.ref}
                            value={String(field.value ?? '')}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            onPick={(item) => pickItem(i, item)}
                            items={fromPacking ? [] : catalog}
                            currency={cur}
                            invalid={!!err?.description}
                            placeholder={fromPacking ? undefined : 'Search a product / part, or type a service'}
                            ariaLabel={`Line ${i + 1} item or service`}
                          />
                        )}
                      />
                      {err?.description && <p className="mt-1 text-xs text-destructive">{err.description.message}</p>}
                      {last && last.currency === cur && (
                        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <History className="size-3.5 shrink-0" aria-hidden />
                          {Math.abs(last.rate - rate) < 0.005 ? (
                            <span>
                              Same rate as {last.invoiceNo} ({fmtDate(last.invoiceDate)})
                            </span>
                          ) : (
                            <>
                              <span>
                                Last billed {fmtMoney(last.rate, cur)} on {last.invoiceNo}
                              </span>
                              {!fromPacking && (
                                <button type="button" className="rounded-md px-1.5 py-0.5 font-medium text-primary hover:bg-accent" onClick={() => set(`lines.${i}.rate`, last.rate)}>
                                  Use it
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Input {...form.register(`lines.${i}.hsnCode`)} className="font-mono text-[13px]" aria-label={`Line ${i + 1} HSN or SAC code`} />
                    </td>
                    {fromPacking ? (
                      <>
                        <td className="px-2 py-3 text-right tabular-nums">{fmtQty(qty)}</td>
                        <td className="px-2 py-3 text-muted-foreground">{unitLabel(String(line?.uom ?? ''))}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            step="0.001"
                            min={0}
                            inputMode="decimal"
                            {...form.register(`lines.${i}.quantity`)}
                            aria-invalid={!!err?.quantity}
                            className="text-right tabular-nums"
                            aria-label={`Line ${i + 1} quantity`}
                          />
                          {err?.quantity && <p className="mt-1 text-right text-xs text-destructive">{err.quantity.message}</p>}
                        </td>
                        <td className="px-2 py-2">
                          <NativeSelect {...form.register(`lines.${i}.uom`)} aria-label={`Line ${i + 1} unit`}>
                            {UNITS.map((u) => (
                              <option key={u} value={u}>
                                {unitLabel(u)}
                              </option>
                            ))}
                          </NativeSelect>
                        </td>
                      </>
                    )}
                    <td className="px-2 py-2">
                      <div className="relative">
                        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">{cur === 'INR' ? '₹' : cur}</span>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          {...form.register(`lines.${i}.rate`)}
                          onKeyDown={(e) => {
                            // Enter on the last line's rate: next line, cursor in its item box
                            if (e.key === 'Enter' && !fromPacking && i === fields.length - 1) {
                              e.preventDefault();
                              addLine();
                            }
                          }}
                          aria-invalid={!!err?.rate}
                          className={cn('text-right tabular-nums', cur === 'INR' ? 'pl-6' : 'pl-11')}
                          aria-label={`Line ${i + 1} rate`}
                        />
                      </div>
                      {err?.rate && <p className="mt-1 text-right text-xs text-destructive">{err.rate.message}</p>}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <div className="font-semibold tabular-nums">{fmtMoney(totals.lineAmounts[i] ?? 0, cur)}</div>
                      {qty > 0 && rate > 0 && (
                        <div className="mt-0.5 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
                          {fmtQty(qty)} × {fmtMoney(rate, cur)}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-6 sm:pr-8">
                      {!fromPacking && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Line ${i + 1} actions`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem disabled={i === 0} onSelect={() => move(i, i - 1)}>
                              <ArrowUp /> Move up
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={i === fields.length - 1} onSelect={() => move(i, i + 1)}>
                              <ArrowDown /> Move down
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => insert(i + 1, { ...form.getValues(`lines.${i}`), id: undefined })}>
                              <Copy /> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive disabled={fields.length === 1} onSelect={() => remove(i)}>
                              <Trash2 /> Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-dashed px-6 py-3 sm:px-8">
          {fromPacking ? (
            <span className="text-xs text-muted-foreground">Quantities come from packing {inv?.assembly?.assemblyNo}.</span>
          ) : (
            <>
              <Button type="button" variant="ghost" size="sm" className="text-primary hover:bg-accent hover:text-primary" onClick={addLine}>
                <Plus /> Add line
              </Button>
              <span className="hidden text-xs text-muted-foreground sm:inline">Products, parts and what this customer bought before show as you type · Enter in the last rate adds a line</span>
            </>
          )}
          {typeof (form.formState.errors.lines as any)?.message === 'string' && <span className="text-xs text-destructive">{(form.formState.errors.lines as any).message}</span>}
        </div>

        {/* ---------------- notes, terms, bank | totals */}
        <div className="grid gap-8 border-t p-6 sm:p-8 lg:grid-cols-[1fr_400px]">
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="inv-notes">Note for the customer</Label>
              <Textarea id="inv-notes" rows={2} placeholder="e.g. Thank you for your business." {...form.register('notes')} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="inv-terms">Terms & conditions</Label>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => set('terms', party.data?.terms || DEFAULT_INVOICE_TERMS)}
                >
                  <RotateCcw className="size-3" /> Company terms
                </button>
              </div>
              <Textarea id="inv-terms" rows={4} className="text-[13px]" {...form.register('terms')} />
            </div>
            {company?.meta?.bankAccountNo ? (
              <div className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
                <div className="mb-1 font-semibold tracking-wider uppercase">Bank details (printed)</div>
                {[company.meta.bankName, company.meta.bankBranch].filter(Boolean).join(', ')} · A/c <span className="font-mono">{String(company.meta.bankAccountNo)}</span>
                {company.meta.bankIfsc ? (
                  <>
                    {' '}
                    · IFSC <span className="font-mono">{String(company.meta.bankIfsc)}</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <div>
            <dl className="space-y-2.5 text-sm">
              <SumRow label="Sub total" hint={`${filledLines} item${filledLines === 1 ? '' : 's'}${totalQty ? ` · qty ${fmtQty(totalQty)}` : ''}`} value={fmtMoney(totals.subTotal, cur)} />
              <SumRow
                label="Discount"
                input={<SmallNumber form={form} name="discountPercent" suffix="%" label="Discount percent" />}
                value={totals.discountAmount > 0 ? `− ${fmtMoney(totals.discountAmount, cur)}` : fmtMoney(0, cur)}
              />
              <SumRow label="Freight / packing" input={<SmallNumber form={form} name="freight" prefix={cur === 'INR' ? '₹' : cur} label="Freight" wide />} value={fmtMoney(Number(values.freight) || 0, cur)} />
              <div className="border-t pt-2.5">
                <SumRow label="Taxable value" value={fmtMoney(totals.taxableAmount, cur)} strong />
              </div>
              <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium">GST</span>
                  <Controller
                    control={form.control}
                    name="gstType"
                    render={({ field }) => (
                      <NativeSelect value={String(field.value ?? '')} onChange={(e) => field.onChange(e.target.value)} className="h-8 w-auto max-w-[220px] text-[13px]" aria-label="GST type">
                        {GST_TYPES.map((g) => (
                          <option key={g} value={g}>
                            {GST_TYPE_LABELS[g]}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  />
                </div>
                {!noTax && (
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="GST rate">
                    {GST_RATES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => set('taxRate', r)}
                        className={cn(
                          'rounded-md border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors',
                          taxRate === r ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
                        )}
                        aria-pressed={taxRate === r}
                      >
                        {r}%
                      </button>
                    ))}
                    <SmallNumber form={form} name="taxRate" suffix="%" label="Other GST rate" />
                  </div>
                )}
                {values.gstType === 'INTRA_STATE' && (
                  <>
                    <SumRow label={`CGST ${taxRate / 2}%`} value={fmtMoney(totals.cgst, cur)} />
                    <SumRow label={`SGST ${taxRate / 2}%`} value={fmtMoney(totals.sgst, cur)} />
                  </>
                )}
                {values.gstType === 'INTER_STATE' && <SumRow label={`IGST ${taxRate}%`} value={fmtMoney(totals.igst, cur)} />}
                {noTax && <p className="text-xs text-muted-foreground">No GST on this invoice.</p>}
              </div>
              {totals.roundOff !== 0 && <SumRow label="Round off" value={fmtMoney(totals.roundOff, cur)} />}
            </dl>
            <div className="mt-3 rounded-lg bg-primary px-4 py-3.5 text-primary-foreground">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium opacity-90">Total ({cur})</span>
                <span className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">{fmtMoney(totals.grandTotal, cur)}</span>
              </div>
              {totals.grandTotal > 0 && <p className="mt-1 text-xs leading-snug opacity-85">{amountInWords(totals.grandTotal, cur)}</p>}
            </div>
            {cur !== 'INR' && exchangeRate > 0 && totals.grandTotal > 0 && (
              <p className="mt-2 text-right text-xs text-muted-foreground">
                ≈ {inr(totals.grandTotal * exchangeRate)} at 1 {cur} = ₹{exchangeRate}
              </p>
            )}
            <div className="mt-8 text-right text-sm">
              <div className="font-medium">For {(company?.meta?.legalName as string) || company?.label}</div>
              <div className="mt-6 inline-block border-t px-6 pt-1 text-xs text-muted-foreground">Authorised signatory</div>
            </div>
          </div>
        </div>
      </Card>

      {/* ---------------- always visible: total, checks, actions */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t bg-background/90 backdrop-blur-md sm:-mx-6 lg:-mx-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-lg font-semibold tracking-[-0.01em] tabular-nums">{fmtMoney(totals.grandTotal, cur)}</span>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  open.length ? 'border-warning/50 bg-warning/10 text-[color-mix(in_oklch,var(--warning),black_30%)] dark:text-warning' : 'border-success/40 bg-success/10 text-success',
                )}
              >
                {open.length ? <CircleAlert className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                {open.length ? `${open.length} to check before issuing` : 'Ready to issue'}
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" className="w-80">
              <div className="mb-2 text-sm font-semibold">Before you issue</div>
              <ul className="space-y-2">
                {checks.map((c) => (
                  <li key={c.text} className="flex gap-2 text-sm">
                    {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
                    <span>
                      <span className={cn(c.ok && 'text-muted-foreground')}>{c.text}</span>
                      {!c.ok && c.fix && <span className="block text-xs text-muted-foreground">{c.fix}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
          <span className={cn('hidden items-center gap-1.5 text-xs md:inline-flex', creating || dirty ? 'text-muted-foreground' : 'text-success')}>
            <span className={cn('size-1.5 rounded-full', creating || dirty ? 'bg-warning' : 'bg-success')} aria-hidden />
            {creating ? 'Not saved yet' : dirty ? 'Unsaved changes' : 'Draft saved'} · Ctrl+S
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {footer(dirty)}
            <Button type="submit" variant={canIssue ? 'outline' : 'default'} loading={save.isPending && !confirmIssue}>
              Save draft
            </Button>
            {canIssue && (
              <Button type="button" onClick={() => void askIssue()} disabled={save.isPending}>
                <Send /> Save & issue
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmIssue}
        onOpenChange={(o) => !o && setConfirmIssue(false)}
        title={`Issue invoice ${nextNo.data?.invoiceNo ?? ''}?`.trim()}
        description={`${values.billingName} · ${fmtMoney(totals.grandTotal, cur)}. It is saved, gets the next number of the series and cannot be changed after this.${open.length ? ` Note: ${open.length} check${open.length === 1 ? ' is' : 's are'} still open (${open.map((c) => c.text.toLowerCase()).join(', ')}).` : ''}`}
        confirmLabel="Save & issue"
        destructive={false}
        loading={save.isPending}
        onConfirm={() => void doIssue()}
      />
      <QuickCustomerDialog
        open={newCustomer !== null}
        onOpenChange={(o) => !o && setNewCustomer(null)}
        initialName={newCustomer ?? ''}
        onCreated={(c) => chooseCustomer(c.id)}
      />
    </form>
  );
}

// ------------------------------------------------------------------ small pieces

function Caption({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{children}</div>;
}

function Chip({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <span className={cn('inline-flex items-center rounded-md border bg-card px-2 py-0.5 text-xs text-muted-foreground', mono && 'font-mono')}>{children}</span>;
}

function errorOf(form: Form, name: string): string | undefined {
  const e = name.split('.').reduce<any>((o, k) => o?.[k], form.formState.errors);
  return e?.message as string | undefined;
}

/** A labelled input / textarea bound to the form. */
function Fld({
  form,
  name,
  label,
  required,
  textarea,
  mono,
  upper,
  ...input
}: {
  form: Form;
  name: keyof FormValues;
  label: string;
  required?: boolean;
  textarea?: boolean;
  mono?: boolean;
  upper?: boolean;
} & Omit<React.ComponentProps<'input'>, 'name' | 'form'>) {
  const id = `inv-${String(name)}`;
  const error = errorOf(form, String(name));
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {textarea ? (
        <Textarea id={id} rows={2} aria-invalid={!!error} {...form.register(name as never)} />
      ) : (
        <Input id={id} aria-invalid={!!error} className={cn(mono && 'font-mono', upper && 'uppercase')} {...input} {...form.register(name as never)} />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function DateBox({ form, name, label, required }: { form: Form; name: 'invoiceDate' | 'dueDate' | 'customerPoDate'; label: string; required?: boolean }) {
  return <Fld form={form} name={name} label={label} required={required} type="date" />;
}

function StateSelect({ form, name, label }: { form: Form; name: 'placeOfSupply'; label: string }) {
  const error = errorOf(form, name);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`inv-${name}`}>{label}</Label>
      <NativeSelect id={`inv-${name}`} aria-invalid={!!error} {...form.register(name)}>
        <option value="">—</option>
        {INDIAN_STATES.map((s) => (
          <option key={s.code} value={s.code}>
            {s.code} · {s.name}
          </option>
        ))}
      </NativeSelect>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** One line of the totals box: label (with an optional input) and the amount on the right. */
function SumRow({ label, hint, input, value, strong }: { label: string; hint?: string; input?: React.ReactNode; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex min-w-0 items-center gap-2">
        <span className={cn(strong ? 'font-medium text-foreground' : 'text-muted-foreground')}>{label}</span>
        {input}
        {hint && <span className="truncate text-xs text-muted-foreground/80">{hint}</span>}
      </dt>
      <dd className={cn('shrink-0 tabular-nums', strong && 'font-semibold')}>{value}</dd>
    </div>
  );
}

/** A small number box used inside the totals (discount %, freight, other GST rate). */
function SmallNumber({ form, name, prefix, suffix, label, wide }: { form: Form; name: 'discountPercent' | 'freight' | 'taxRate'; prefix?: string; suffix?: string; label: string; wide?: boolean }) {
  const error = form.formState.errors[name]?.message;
  return (
    <span className="relative inline-flex items-center">
      {prefix && <span className="pointer-events-none absolute left-2 text-[11px] text-muted-foreground">{prefix}</span>}
      <input
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={!!error}
        title={error ? String(error) : label}
        {...form.register(name)}
        className={cn(
          'h-7 rounded-md border border-input bg-card text-right text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 aria-invalid:border-destructive',
          wide ? 'w-24' : 'w-16',
          prefix ? (prefix.length > 1 ? 'pl-9' : 'pl-5') : 'pl-1.5',
          suffix ? 'pr-5' : 'pr-1.5',
        )}
      />
      {suffix && <span className="pointer-events-none absolute right-1.5 text-[11px] text-muted-foreground">{suffix}</span>}
    </span>
  );
}
