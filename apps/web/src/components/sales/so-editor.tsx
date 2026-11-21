'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { CURRENCIES, END_CONNECTION_LABELS, round2, salesOrderSchema, SERVICE_TYPES, type SalesOrderInput } from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtMoney, fmtQty, toInputDate } from '@/lib/format';
import { showApiError, type LookupOption } from '@/hooks/use-api';
import type { SalesOrder } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Combobox, ComboboxField, FormGrid, SelectField, TextField, TextareaField } from '@/components/app/form';

type FormValues = z.input<typeof salesOrderSchema>;
type Line = FormValues['lines'][number];

export interface SoLookups {
  customers: LookupOption[];
  products: LookupOption[];
  materialGrades: LookupOption[];
  users: LookupOption[];
}

const emptyLine = (): Line => ({ productId: '' as unknown as number, endConnection: 'BW', service: 'STD', schedule: '', materialGradeId: '', quantity: '', rate: '', remarks: '' });

export function initialSoValues(so: SalesOrder | null, currentUserId: number): FormValues {
  if (!so) {
    return {
      soDate: toInputDate(new Date()),
      customerId: '' as unknown as number,
      customerPoNo: '',
      customerPoDate: '',
      currency: 'INR',
      exchangeRate: 1,
      expectedDelivery: '',
      salesPersonId: currentUserId,
      additionalRequirement: '',
      notes: '',
      lines: [emptyLine()],
    };
  }
  return {
    soDate: toInputDate(so.soDate),
    customerId: so.customerId,
    customerPoNo: so.customerPoNo ?? '',
    customerPoDate: toInputDate(so.customerPoDate),
    currency: so.currency,
    exchangeRate: so.exchangeRate,
    expectedDelivery: toInputDate(so.expectedDelivery),
    salesPersonId: so.salesPersonId ?? '',
    additionalRequirement: so.additionalRequirement ?? '',
    notes: so.notes ?? '',
    lines: so.lines.map((l) => ({
      productId: l.productId,
      endConnection: l.endConnection,
      service: l.service,
      schedule: l.schedule ?? '',
      materialGradeId: l.materialGradeId ?? '',
      quantity: l.quantity,
      rate: l.rate,
      remarks: l.remarks ?? '',
    })),
  };
}

export function SoEditor({
  so,
  lookups,
  initial,
  footer,
  onSaved,
}: {
  so: SalesOrder | null;
  lookups: SoLookups;
  initial: FormValues;
  footer?: (state: { dirty: boolean }) => React.ReactNode;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(salesOrderSchema, initial);
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const values = useWatch({ control: form.control }) as FormValues;

  const save = useMutation({
    mutationFn: (body: SalesOrderInput) => api<SalesOrder>(so ? `/sales-orders/${so.id}` : '/sales-orders', { method: so ? 'PUT' : 'POST', body }),
    onSuccess: (saved) => {
      toast.success(so ? `${saved.soNo} saved${so.status === 'PENDING_APPROVAL' ? ' - approvals start again' : ''}` : `${saved.soNo} created as draft`);
      form.reset(form.getValues());
      if (!so) router.replace(`/sales/orders/${saved.id}`);
      onSaved?.();
    },
    onError: (err) => showApiError(err, form),
  });

  // New customer -> use their currency.
  const customerId = Number(values.customerId) || 0;
  const lastCustomer = useRef(customerId);
  useEffect(() => {
    if (lastCustomer.current === customerId) return;
    lastCustomer.current = customerId;
    const currency = lookups.customers.find((c) => c.value === customerId)?.meta?.currency as FormValues['currency'] | undefined;
    if (currency) form.setValue('currency', currency);
  }, [customerId, lookups.customers, form]);

  // Warn early when this customer PO is already on another order.
  const [poClash, setPoClash] = useState<{ id: number; soNo: string } | null>(null);
  const poNo = (values.customerPoNo ?? '').trim();
  useEffect(() => {
    setPoClash(null);
    if (!customerId || !poNo) return;
    const t = setTimeout(async () => {
      const r = await api<{ exists: boolean; soNo: string | null; id: number | null }>('/sales-orders/check-po', {
        query: { customerId, poNo, excludeId: so?.id },
      }).catch(() => null);
      if (r?.exists && r.id && r.soNo) setPoClash({ id: r.id, soNo: r.soNo });
    }, 400);
    return () => clearTimeout(t);
  }, [customerId, poNo, so?.id]);

  const amounts = (values.lines ?? []).map((l) => round2((Number(l?.quantity) || 0) * (Number(l?.rate) || 0)));
  const total = round2(amounts.reduce((a, b) => a + b, 0));
  const cur = values.currency ?? 'INR';
  const lineErrors = form.formState.errors.lines as any;
  const productMeta = useMemo(() => new Map(lookups.products.map((p) => [p.value, p.meta])), [lookups.products]);

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Customer & order</CardTitle>
        </CardHeader>
        <CardContent>
          <FormGrid className="lg:grid-cols-4">
            <ComboboxField form={form} name="customerId" label="Customer" required options={lookups.customers} className="sm:col-span-2" />
            <div className="sm:col-span-2">
              <TextField form={form} name="customerPoNo" label="Customer PO no." placeholder="As written on their PO" />
              {poClash && (
                <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                  <AlertTriangle className="size-3.5" /> Already on{' '}
                  <Link href={`/sales/orders/${poClash.id}`} className="font-medium underline">
                    {poClash.soNo}
                  </Link>
                </p>
              )}
            </div>
            <TextField form={form} name="soDate" label="SO date" type="date" required />
            <TextField form={form} name="customerPoDate" label="Customer PO date" type="date" />
            <TextField form={form} name="expectedDelivery" label="Delivery date" type="date" />
            <SelectField form={form} name="salesPersonId" label="Sales person" numeric placeholder="—" options={lookups.users.map((u) => ({ value: u.value, label: u.label }))} />
            <SelectField form={form} name="currency" label="Currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            {cur !== 'INR' && <TextField form={form} name="exchangeRate" label={`1 ${cur} = ₹`} type="number" step="0.0001" min={0} />}
          </FormGrid>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Products</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="w-8 px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="w-40 px-3 py-2 text-left">End / service</th>
                  <th className="w-32 px-3 py-2 text-left">Schedule / grade</th>
                  <th className="w-28 px-3 py-2 text-right">Qty (sets)</th>
                  <th className="w-32 px-3 py-2 text-right">Rate ({cur})</th>
                  <th className="w-36 px-3 py-2 text-right">Amount</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {fields.map((field, i) => {
                  const meta = productMeta.get(Number(values.lines?.[i]?.productId));
                  const needsEnd = meta?.needsEndConnection !== false;
                  const err = lineErrors?.[i];
                  return (
                    <tr key={field.id} className="border-b align-top">
                      <td className="px-3 py-2.5 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2">
                        <Controller
                          control={form.control}
                          name={`lines.${i}.productId`}
                          render={({ field: f }) => (
                            <Combobox
                              value={Number(f.value) || undefined}
                              onChange={(v) => {
                                f.onChange(v);
                                const m = productMeta.get(Number(v));
                                if (m && m.needsEndConnection === false) form.setValue(`lines.${i}.endConnection`, 'NONE');
                                else if (values.lines?.[i]?.endConnection === 'NONE') form.setValue(`lines.${i}.endConnection`, 'BW');
                              }}
                              options={lookups.products}
                              placeholder="Choose product…"
                              invalid={!!err?.productId}
                            />
                          )}
                        />
                        {meta && meta.hasBom === false && <p className="mt-1 text-xs text-warning">This product has no parts (BOM) yet</p>}
                        <Input {...form.register(`lines.${i}.remarks`)} placeholder="Line note (colour, marking, packing…)" className="mt-1.5 h-8 text-[13px]" />
                        {err?.productId && <p className="mt-1 text-xs text-destructive">{err.productId.message}</p>}
                      </td>
                      <td className="space-y-1.5 px-3 py-2">
                        <NativeSelect {...form.register(`lines.${i}.endConnection`)} disabled={!needsEnd} aria-invalid={!!err?.endConnection} aria-label={`Line ${i + 1} end connection`}>
                          {needsEnd ? (
                            <>
                              <option value="BW">{END_CONNECTION_LABELS.BW}</option>
                              <option value="THD">{END_CONNECTION_LABELS.THD}</option>
                            </>
                          ) : (
                            <option value="NONE">Not applicable</option>
                          )}
                        </NativeSelect>
                        <NativeSelect {...form.register(`lines.${i}.service`)} aria-label={`Line ${i + 1} service`}>
                          {SERVICE_TYPES.map((s) => (
                            <option key={s} value={s}>
                              {s === 'SOUR' ? 'SOUR (NACE)' : 'STD'}
                            </option>
                          ))}
                        </NativeSelect>
                        {err?.endConnection && <p className="text-xs text-destructive">{err.endConnection.message}</p>}
                      </td>
                      <td className="space-y-1.5 px-3 py-2">
                        <Input {...form.register(`lines.${i}.schedule`)} placeholder="Sch. 80 / XXH" aria-label={`Line ${i + 1} schedule`} />
                        <NativeSelect
                          {...form.register(`lines.${i}.materialGradeId`, { setValueAs: (v) => (v === '' ? '' : Number(v)) })}
                          aria-label={`Line ${i + 1} material grade`}
                        >
                          <option value="">Grade —</option>
                          {lookups.materialGrades.map((g) => (
                            <option key={g.value} value={g.value}>
                              {g.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" step="1" min={0} {...form.register(`lines.${i}.quantity`)} aria-invalid={!!err?.quantity} className="text-right" aria-label={`Line ${i + 1} quantity`} />
                        {err?.quantity && <p className="mt-1 text-right text-xs text-destructive">{err.quantity.message}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" step="0.01" min={0} {...form.register(`lines.${i}.rate`)} className="text-right" aria-label={`Line ${i + 1} rate`} />
                      </td>
                      <td className="tabular px-3 py-2.5 text-right font-medium">{fmtMoney(amounts[i] ?? 0, cur)}</td>
                      <td className="px-2 py-2">
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(i)} disabled={fields.length === 1} aria-label={`Remove line ${i + 1}`}>
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine())}>
              <Plus /> Add product
            </Button>
            {typeof lineErrors?.message === 'string' && <p className="text-xs text-destructive">{lineErrors.message}</p>}
            <div className="tabular text-sm">
              <span className="text-muted-foreground">
                {fmtQty((values.lines ?? []).reduce((s, l) => s + (Number(l?.quantity) || 0), 0))} sets ·{' '}
              </span>
              <span className="font-semibold">Order value {fmtMoney(total, cur)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Requirements</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <TextareaField
            form={form}
            name="additionalRequirement"
            label="Customer requirements"
            rows={4}
            placeholder={`e.g. Marking: logo, size and heat no.\nThickness 7.1 mm\nColour: blue`}
          />
          <TextareaField form={form} name="notes" label="Internal notes" rows={4} />
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-20 -mx-4 border-t bg-background/95 backdrop-blur sm:-mx-6">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
          <span className={cn('text-sm', form.formState.isDirty ? 'text-warning' : 'text-muted-foreground')}>
            {form.formState.isDirty ? 'Unsaved changes' : so ? 'Saved' : 'New draft'}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {footer?.({ dirty: form.formState.isDirty })}
            <Button type="submit" loading={save.isPending}>
              {so ? 'Save' : 'Create draft'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
