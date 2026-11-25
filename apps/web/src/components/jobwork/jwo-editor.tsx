'use client';

import { useMutation } from '@tanstack/react-query';
import { useFieldArray, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { jobWorkOrderSchema, type JobWorkOrderInput } from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtMoney, fmtQty } from '@/lib/format';
import { showApiError, type LookupOption } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Combobox, ComboboxField, FormGrid, TextareaField, TextField } from '@/components/app/form';

export type JwoFormValues = z.input<typeof jobWorkOrderSchema>;

/**
 * Job work order: vendor, the parts to make (with the charge per piece) and our raw material to send.
 * Lines that come from an outsourced sales order line keep their part; extra lines can be added for stock.
 */
export function JobWorkEditor({
  initial,
  lookups,
  soLabel,
  itemLabels,
  submit,
  submitLabel,
  footer,
}: {
  initial: JwoFormValues;
  lookups: { suppliers: LookupOption[]; items: LookupOption[]; rawMaterials: LookupOption[] };
  /** "SO/26-27/0004 · customer" when made for a sales order. */
  soLabel?: string | null;
  /** itemId -> name, for lines whose part is fixed by the sales order. */
  itemLabels: Record<number, string>;
  submit: (values: JobWorkOrderInput) => Promise<unknown>;
  submitLabel: string;
  footer?: React.ReactNode;
}) {
  const form = useZodForm(jobWorkOrderSchema, initial);
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const materials = useFieldArray({ control: form.control, name: 'materials' });
  const values = useWatch({ control: form.control }) as JwoFormValues;
  const save = useMutation({ mutationFn: submit, onError: (err) => showApiError(err, form) });
  const errors = form.formState.errors;

  // Job-work vendors first in the list.
  const vendors = [...lookups.suppliers].sort((a, b) => Number(b.meta?.type === 'JOB_WORK') - Number(a.meta?.type === 'JOB_WORK'));
  const pcs = (values.lines ?? []).reduce((s, l) => s + (Number(l?.quantity) || 0), 0);
  const charges = (values.lines ?? []).reduce((s, l) => s + (Number(l?.quantity) || 0) * (Number(l?.rate) || 0), 0);
  const kg = (values.materials ?? []).reduce((s, m) => s + (Number(m?.quantity) || 0), 0);

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Vendor & dates</CardTitle>
          <CardDescription>{soLabel ? `For sales order ${soLabel}` : 'For stock (no sales order)'}</CardDescription>
        </CardHeader>
        <CardContent>
          <FormGrid className="lg:grid-cols-4">
            <ComboboxField form={form} name="supplierId" label="Job-work vendor" required options={vendors} className="sm:col-span-2" />
            <TextField form={form} name="jwoDate" label="Order date" type="date" required />
            <TextField form={form} name="expectedDate" label="Parts back by" type="date" />
            <TextField form={form} name="challanNo" label="Our challan no." placeholder="if a printed challan book is used" />
            <TextareaField form={form} name="remarks" label="Instructions to vendor" rows={2} className="sm:col-span-3" placeholder="e.g. rough machining as per drawing, keep heat no. punched" />
          </FormGrid>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Parts to make</CardTitle>
            <CardDescription>Rate = job-work charge per piece (for the PO). {fmtQty(pcs)} pcs · {fmtMoney(charges)}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="w-8 px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Part</th>
                  <th className="w-32 px-3 py-2 text-right">Pieces</th>
                  <th className="w-32 px-3 py-2 text-right">Rate (₹/pc)</th>
                  <th className="w-32 px-3 py-2 text-right">Amount</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.fields.map((field, i) => {
                  const fixed = !!values.lines?.[i]?.salesOrderLineId;
                  const err = (errors.lines as any)?.[i];
                  const itemId = Number(values.lines?.[i]?.itemId) || undefined;
                  return (
                    <tr key={field.id} className="border-b align-top">
                      <td className="px-3 py-2.5 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2">
                        {fixed ? (
                          <div className="flex h-9 items-center gap-2 rounded-md border border-dashed px-3">
                            <span className="truncate">{itemLabels[itemId!] ?? lookups.items.find((o) => o.value === itemId)?.label}</span>
                            <Badge variant="info" className="ml-auto shrink-0">
                              SO line
                            </Badge>
                          </div>
                        ) : (
                          <Combobox
                            value={itemId}
                            onChange={(v) => form.setValue(`lines.${i}.itemId`, v as number, { shouldValidate: true, shouldDirty: true })}
                            options={lookups.items}
                            placeholder="Choose part…"
                            invalid={!!err?.itemId}
                          />
                        )}
                        <Input {...form.register(`lines.${i}.remarks`)} placeholder="Note for this part (optional)" className="mt-1.5 h-8 text-[13px]" />
                        {err?.itemId && <p className="mt-1 text-xs text-destructive">{err.itemId.message}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min={1} step={1} {...form.register(`lines.${i}.quantity`)} aria-invalid={!!err?.quantity} className="text-right" aria-label={`Line ${i + 1} pieces`} />
                        {err?.quantity && <p className="mt-1 text-right text-xs text-destructive">{err.quantity.message}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min={0} step="0.01" {...form.register(`lines.${i}.rate`)} className="text-right" aria-label={`Line ${i + 1} rate`} />
                      </td>
                      <td className="tabular px-3 py-2.5 text-right font-medium">{fmtMoney((Number(values.lines?.[i]?.quantity) || 0) * (Number(values.lines?.[i]?.rate) || 0))}</td>
                      <td className="px-2 py-2">
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => lines.remove(i)} disabled={lines.fields.length === 1} aria-label={`Remove line ${i + 1}`}>
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-2 px-5 py-3">
            <Button type="button" variant="outline" size="sm" onClick={() => lines.append({ itemId: '' as unknown as number, salesOrderLineId: '', quantity: '', rate: 0, remarks: '' })}>
              <Plus /> Add part
            </Button>
            {typeof (errors.lines as any)?.message === 'string' && <p className="text-xs text-destructive">{(errors.lines as any).message}</p>}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Our material to send</CardTitle>
          <CardDescription>The store sends it heat by heat from Material issue. Leave empty if the vendor uses own material. {kg ? `${fmtQty(kg)} kg in all.` : ''}</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {materials.fields.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-y bg-muted/40 text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Raw material</th>
                    <th className="w-40 px-3 py-2 text-right">Quantity (kg)</th>
                    <th className="w-10 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {materials.fields.map((field, i) => {
                    const err = (errors.materials as any)?.[i];
                    return (
                      <tr key={field.id} className="border-b align-top">
                        <td className="px-3 py-2">
                          <Combobox
                            value={Number(values.materials?.[i]?.rawMaterialId) || undefined}
                            onChange={(v) => form.setValue(`materials.${i}.rawMaterialId`, v as number, { shouldValidate: true, shouldDirty: true })}
                            options={lookups.rawMaterials}
                            placeholder="Choose material…"
                            invalid={!!err?.rawMaterialId}
                          />
                          {err?.rawMaterialId && <p className="mt-1 text-xs text-destructive">{err.rawMaterialId.message}</p>}
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" min={0} step="0.001" {...form.register(`materials.${i}.quantity`)} aria-invalid={!!err?.quantity} className="text-right" aria-label={`Material ${i + 1} kg`} />
                          {err?.quantity && <p className="mt-1 text-right text-xs text-destructive">{err.quantity.message}</p>}
                        </td>
                        <td className="px-2 py-2">
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => materials.remove(i)} aria-label={`Remove material ${i + 1}`}>
                            <Trash2 />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-5 py-3">
            <Button type="button" variant="outline" size="sm" onClick={() => materials.append({ rawMaterialId: '' as unknown as number, quantity: '' })}>
              <Plus /> Add material
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-3 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-3 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-4">
        {footer}
        <Button type="submit" loading={save.isPending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export async function createJobWork(values: JobWorkOrderInput) {
  const r = await api<{ id: number; jwoNo: string }>('/job-work-orders', { method: 'POST', body: values });
  toast.success(`Job work order ${r.jwoNo} made`);
  return r;
}
