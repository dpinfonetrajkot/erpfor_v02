'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Link2Off, Plus, Trash2 } from 'lucide-react';
import {
  computeTotals,
  CURRENCIES,
  DEFAULT_PO_PAYMENT_TERMS,
  DEFAULT_PO_TERMS,
  defaultGstType,
  GST_TYPE_LABELS,
  GST_TYPES,
  purchaseOrderSchema,
  UNITS,
  type GstType,
  type PurchaseOrderInput,
} from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtMoney, fmtQty, toInputDate } from '@/lib/format';
import { showApiError, type LookupOption } from '@/hooks/use-api';
import type { PurchaseOrder, PurchaseRequisition } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Combobox, ComboboxField, FormGrid, SelectField, TextField, TextareaField } from '@/components/app/form';

type FormValues = z.input<typeof purchaseOrderSchema>;

interface Lookups {
  companies: LookupOption[];
  suppliers: LookupOption[];
  rawMaterials: LookupOption[];
}

/** Values for a new PO (optionally from requisitions) or for editing a draft. */
export function initialPoValues(lookups: Lookups, po: PurchaseOrder | null, prs: PurchaseRequisition[]): FormValues {
  if (po) {
    return {
      poDate: toInputDate(po.poDate),
      companyId: po.companyId,
      supplierId: po.supplierId,
      quotationRef: po.quotationRef ?? '',
      deliveryAddress: po.deliveryAddress ?? '',
      paymentTerms: po.paymentTerms ?? '',
      expectedDelivery: toInputDate(po.expectedDelivery),
      currency: po.currency,
      gstType: po.gstType,
      discountPercent: po.discountPercent,
      taxRate: po.taxRate,
      freight: po.freight,
      terms: po.terms ?? '',
      notes: po.notes ?? '',
      lines: po.lines.map((l) => ({
        rawMaterialId: (l.rawMaterialId ?? '') as number,
        itemId: l.itemId ?? '',
        purchaseRequisitionId: l.purchaseRequisitionId ?? '',
        description: l.description ?? '',
        quantity: l.quantity,
        uom: l.uom,
        rate: l.rate,
      })),
    };
  }
  const company = lookups.companies.find((c) => c.meta?.isDefault) ?? lookups.companies[0];
  return {
    poDate: toInputDate(new Date()),
    companyId: company?.value as number,
    supplierId: '' as unknown as number,
    quotationRef: '',
    deliveryAddress: company ? [company.label, company.meta?.address].filter(Boolean).join(', ') : '',
    paymentTerms: DEFAULT_PO_PAYMENT_TERMS,
    expectedDelivery: '',
    currency: 'INR',
    gstType: 'INTRA_STATE',
    discountPercent: 0,
    taxRate: 18,
    freight: 0,
    terms: (company?.meta?.purchaseTerms as string | null) || DEFAULT_PO_TERMS,
    notes: '',
    lines: prs.length
      ? prs.map((pr) => ({
          rawMaterialId: pr.rawMaterialId,
          purchaseRequisitionId: pr.id,
          description: pr.remarks ?? '',
          quantity: pr.quantity,
          uom: pr.rawMaterial.uom,
          rate: '',
        }))
      : [{ rawMaterialId: '' as unknown as number, purchaseRequisitionId: '', description: '', quantity: '', uom: 'KG', rate: '' }],
  };
}

export function PoEditor({
  po,
  lookups,
  initial,
  prLabels,
  footer,
}: {
  po: PurchaseOrder | null;
  lookups: Lookups;
  initial: FormValues;
  /** prId -> PR number, to show which lines came from requisitions */
  prLabels: Record<number, string>;
  /** Extra buttons; gets whether there are unsaved changes. */
  footer?: (state: { dirty: boolean }) => React.ReactNode;
}) {
  const router = useRouter();
  const form = useZodForm(purchaseOrderSchema, initial);
  const { fields, append, remove, update } = useFieldArray({ control: form.control, name: 'lines' });
  const values = useWatch({ control: form.control }) as FormValues;

  const save = useMutation({
    mutationFn: (body: PurchaseOrderInput) =>
      api<PurchaseOrder>(po ? `/purchase-orders/${po.id}` : '/purchase-orders', { method: po ? 'PUT' : 'POST', body }),
    onSuccess: (saved) => {
      toast.success(po ? `${saved.poNo} saved` : `${saved.poNo} created as draft`);
      form.reset(form.getValues()); // what is on screen is now the saved version
      if (!po) router.replace(`/purchase/orders/${saved.id}`);
    },
    onError: (err) => showApiError(err, form),
  });

  // When the supplier or company changes, suggest GST type and payment terms.
  const supplierId = Number(values.supplierId) || null;
  const companyId = Number(values.companyId) || null;
  const lastParty = useRef(`${supplierId}:${companyId}`);
  useEffect(() => {
    const key = `${supplierId}:${companyId}`;
    if (key === lastParty.current) return;
    lastParty.current = key;
    const supplier = lookups.suppliers.find((s) => s.value === supplierId);
    const company = lookups.companies.find((c) => c.value === companyId);
    if (!supplier) return;
    form.setValue('gstType', defaultGstType(company?.meta?.stateCode as string, supplier.meta?.stateCode as string, supplier.meta?.country as string));
    if (supplier.meta?.country && supplier.meta.country !== 'India') form.setValue('currency', 'USD');
    const days = supplier.meta?.paymentTermsDays as number | null;
    if (days) form.setValue('paymentTerms', `Payment after ${days} days`);
  }, [supplierId, companyId, lookups, form]);

  const totals = useMemo(
    () =>
      computeTotals({
        lines: (values.lines ?? []).map((l) => ({ quantity: Number(l?.quantity) || 0, rate: Number(l?.rate) || 0 })),
        discountPercent: Number(values.discountPercent) || 0,
        freight: Number(values.freight) || 0,
        taxRate: Number(values.taxRate) || 0,
        gstType: (values.gstType ?? 'INTRA_STATE') as GstType,
        currency: values.currency,
      }),
    [values],
  );
  const cur = values.currency ?? 'INR';
  const half = (Number(values.taxRate) || 0) / 2;
  const lineError = form.formState.errors.lines;
  const jobWork = po?.type === 'JOB_WORK';

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Order details</CardTitle>
        </CardHeader>
        <CardContent>
          <FormGrid className="lg:grid-cols-4">
            <ComboboxField form={form} name="supplierId" label="Supplier" required options={lookups.suppliers} className="sm:col-span-2" />
            <SelectField form={form} name="companyId" label="Order from (our company)" required numeric options={lookups.companies.map((c) => ({ value: c.value, label: c.label }))} className="sm:col-span-2" />
            <TextField form={form} name="poDate" label="PO date" type="date" required />
            <TextField form={form} name="expectedDelivery" label="Expected delivery" type="date" />
            <TextField form={form} name="quotationRef" label="Supplier quotation ref." />
            <TextField form={form} name="paymentTerms" label="Payment terms" />
            <TextareaField form={form} name="deliveryAddress" label="Deliver to" rows={2} className="sm:col-span-2" />
            <SelectField form={form} name="gstType" label="GST" options={GST_TYPES.map((g) => ({ value: g, label: GST_TYPE_LABELS[g] }))} />
            <SelectField form={form} name="currency" label="Currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </FormGrid>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{jobWork ? 'Parts (job work charges)' : 'Materials'}</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="w-8 px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">{jobWork ? 'Part' : 'Raw material'}</th>
                  <th className="w-36 px-3 py-2 text-right">Quantity</th>
                  <th className="w-24 px-3 py-2 text-left">Unit</th>
                  <th className="w-32 px-3 py-2 text-right">Rate ({cur})</th>
                  <th className="w-36 px-3 py-2 text-right">Amount</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {fields.map((field, i) => {
                  const prId = Number(values.lines?.[i]?.purchaseRequisitionId) || null;
                  const err = (lineError as any)?.[i];
                  return (
                    <tr key={field.id} className="border-b align-top">
                      <td className="px-3 py-2.5 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2">
                        <Controller
                          control={form.control}
                          name={`lines.${i}.rawMaterialId`}
                          render={({ field: f }) =>
                            jobWork ? (
                              <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-sm">
                                {po?.lines.find((l) => l.itemId === Number(values.lines?.[i]?.itemId))?.item?.name ?? '—'}
                              </div>
                            ) : prId ? (
                              <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-sm">
                                {lookups.rawMaterials.find((m) => m.value === Number(f.value))?.label ?? '—'}
                              </div>
                            ) : (
                              <Combobox value={Number(f.value) || undefined} onChange={f.onChange} options={lookups.rawMaterials} placeholder="Choose material…" invalid={!!err?.rawMaterialId} />
                            )
                          }
                        />
                        <div className="mt-1.5 flex items-center gap-2">
                          <Input {...form.register(`lines.${i}.description`)} placeholder="Note for supplier (optional)" className="h-8 text-[13px]" />
                          {prId && (
                            <Badge variant="info" className="shrink-0">
                              {prLabels[prId] ?? `PR #${prId}`}
                              <button
                                type="button"
                                onClick={() => update(i, { ...values.lines![i]!, purchaseRequisitionId: '' } as FormValues['lines'][number])}
                                className="ml-0.5 rounded hover:text-foreground"
                                aria-label="Detach requisition"
                                title="Detach requisition"
                              >
                                <Link2Off className="size-3" />
                              </button>
                            </Badge>
                          )}
                        </div>
                        {err?.rawMaterialId && <p className="mt-1 text-xs text-destructive">{err.rawMaterialId.message}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" step="0.001" min={0} {...form.register(`lines.${i}.quantity`)} aria-invalid={!!err?.quantity} className="text-right" aria-label={`Line ${i + 1} quantity`} />
                        {err?.quantity && <p className="mt-1 text-right text-xs text-destructive">{err.quantity.message}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <NativeSelect {...form.register(`lines.${i}.uom`)} aria-label={`Line ${i + 1} unit`}>
                          {UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </NativeSelect>
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" step="0.01" min={0} {...form.register(`lines.${i}.rate`)} aria-invalid={!!err?.rate} className="text-right" aria-label={`Line ${i + 1} rate`} />
                        {err?.rate && <p className="mt-1 text-right text-xs text-destructive">{err.rate.message}</p>}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right font-medium">{fmtMoney(totals.lineAmounts[i] ?? 0, cur)}</td>
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
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            {jobWork ? (
              <span className="text-xs text-muted-foreground">Parts come from the job work order.</span>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ rawMaterialId: '' as unknown as number, purchaseRequisitionId: '', description: '', quantity: '', uom: 'KG', rate: '' })}
              >
                <Plus /> Add material
              </Button>
            )}
            {typeof (lineError as any)?.message === 'string' && <p className="text-xs text-destructive">{(lineError as any).message}</p>}
            <span className="text-xs text-muted-foreground">
              Total quantity: {fmtQty((values.lines ?? []).reduce((s, l) => s + (Number(l?.quantity) || 0), 0))}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Terms & notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <TextareaField form={form} name="terms" label="Terms & conditions (printed on the PO)" rows={5} />
            <TextareaField form={form} name="notes" label="Notes (printed)" rows={2} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <TextField form={form} name="discountPercent" label="Discount %" type="number" step="0.01" min={0} max={100} />
              <TextField form={form} name="freight" label={`Freight (${cur})`} type="number" step="0.01" min={0} />
              <TextField form={form} name="taxRate" label="GST %" type="number" step="0.01" min={0} disabled={values.gstType === 'EXPORT' || values.gstType === 'EXEMPT'} />
            </div>
            <dl className="tabular space-y-1.5 border-t pt-3 text-sm">
              <Row label="Sub total" value={fmtMoney(totals.subTotal, cur)} />
              {totals.discountAmount > 0 && <Row label={`Discount (${Number(values.discountPercent)}%)`} value={`− ${fmtMoney(totals.discountAmount, cur)}`} />}
              {Number(values.freight) > 0 && <Row label="Freight" value={fmtMoney(Number(values.freight), cur)} />}
              <Row label="Taxable value" value={fmtMoney(totals.taxableAmount, cur)} />
              {values.gstType === 'INTRA_STATE' && (
                <>
                  <Row label={`CGST ${half}%`} value={fmtMoney(totals.cgst, cur)} />
                  <Row label={`SGST ${half}%`} value={fmtMoney(totals.sgst, cur)} />
                </>
              )}
              {values.gstType === 'INTER_STATE' && <Row label={`IGST ${Number(values.taxRate)}%`} value={fmtMoney(totals.igst, cur)} />}
              {totals.roundOff !== 0 && <Row label="Round off" value={fmtMoney(totals.roundOff, cur)} />}
              <div className="mt-2 flex items-baseline justify-between rounded-lg bg-accent px-3 py-2.5 text-accent-foreground">
                <dt className="font-semibold">Grand total</dt>
                <dd className="text-lg font-semibold">{fmtMoney(totals.grandTotal, cur)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-0 z-20 -mx-3 border-t bg-background/95 backdrop-blur sm:-mx-5 lg:-mx-6">
        <div className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-5 lg:px-6">
          <span className={cn('text-sm', form.formState.isDirty ? 'text-warning' : 'text-muted-foreground')}>
            {form.formState.isDirty ? 'Unsaved changes' : po ? 'Saved' : 'New draft'}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {footer?.({ dirty: form.formState.isDirty })}
            <Button type="submit" loading={save.isPending}>
              {po ? 'Save draft' : 'Create draft'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
