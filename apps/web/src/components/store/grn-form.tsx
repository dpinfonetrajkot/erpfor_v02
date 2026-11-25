'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { goodsReceiptSchema, type GoodsReceiptInput } from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtDate, fmtQty, toInputDate } from '@/lib/format';
import { showApiError, useApiQuery, useLookups } from '@/hooks/use-api';
import type { GoodsReceipt, PoOption } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, Label } from '@/components/ui/primitives';
import { Combobox, ComboboxField, FormGrid, TextField, TextareaField } from '@/components/app/form';

type Values = z.input<typeof goodsReceiptSchema>;
type Line = Values['lines'][number];

const emptyLine = (): Line => ({ purchaseOrderLineId: '', rawMaterialId: '' as unknown as number, millHeatNo: '', receivedQty: '' });

function initial(grn: GoodsReceipt | null, supplierId?: number, poId?: number): Values {
  if (grn) {
    return {
      grnDate: toInputDate(grn.grnDate),
      supplierId: grn.supplierId,
      purchaseOrderId: grn.purchaseOrderId ?? '',
      supplierChallan: grn.supplierChallan ?? '',
      supplierInvoice: grn.supplierInvoice ?? '',
      vehicleNo: grn.vehicleNo ?? '',
      remarks: grn.remarks ?? '',
      lines: grn.lines.map((l) => ({
        purchaseOrderLineId: l.purchaseOrderLineId ?? '',
        rawMaterialId: l.rawMaterialId,
        millHeatNo: l.millHeatNo ?? '',
        receivedQty: l.receivedQty,
      })),
    };
  }
  return {
    grnDate: toInputDate(new Date()),
    supplierId: (supplierId ?? '') as number,
    purchaseOrderId: poId ?? '',
    supplierChallan: '',
    supplierInvoice: '',
    vehicleNo: '',
    remarks: '',
    lines: poId ? [] : [emptyLine()],
  };
}

/** Gate entry form: material arriving at the factory, usually against a purchase order. */
export function GrnForm({
  grn,
  supplierId,
  poId,
  onDone,
}: {
  grn: GoodsReceipt | null;
  supplierId?: number;
  poId?: number;
  onDone?: () => void;
}) {
  const router = useRouter();
  const lookups = useLookups('suppliers', 'rawMaterials');
  const form = useZodForm(goodsReceiptSchema, initial(grn, supplierId, poId));
  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: 'lines' });
  const values = useWatch({ control: form.control }) as Values;
  const sid = Number(values.supplierId) || 0;
  const pid = Number(values.purchaseOrderId) || 0;
  const pos = useApiQuery<PoOption[]>('/goods-receipts/po-options', { supplierId: sid }, sid > 0);
  const po = pos.data?.find((p) => p.id === pid);

  // Picking a PO fills the lines with what is still to come.
  const filledFor = useRef<number | null>(grn ? (grn.purchaseOrderId ?? 0) : null);
  useEffect(() => {
    if (!pos.data || filledFor.current === pid) return;
    filledFor.current = pid;
    if (!pid) {
      replace([emptyLine()]);
      return;
    }
    const chosen = pos.data.find((p) => p.id === pid);
    if (!chosen) return;
    replace(
      chosen.lines
        .filter((l) => l.pending > 0)
        .map((l) => ({ purchaseOrderLineId: l.id, rawMaterialId: l.rawMaterialId, millHeatNo: '', receivedQty: l.pending })),
    );
  }, [pid, pos.data, replace]);

  // Changing the supplier clears the PO.
  const lastSupplier = useRef(sid);
  useEffect(() => {
    if (lastSupplier.current !== sid) {
      lastSupplier.current = sid;
      form.setValue('purchaseOrderId', '');
    }
  }, [sid, form]);

  const save = useMutation({
    mutationFn: (body: GoodsReceiptInput) =>
      api<GoodsReceipt>(grn ? `/goods-receipts/${grn.id}` : '/goods-receipts', { method: grn ? 'PUT' : 'POST', body }),
    onSuccess: (saved) => {
      toast.success(grn ? `${saved.grnNo} updated` : `Gate entry ${saved.grnNo} saved - waiting for QC`);
      if (onDone) onDone();
      else router.replace(`/store/gate-entry/${saved.id}`);
    },
    onError: (err) => showApiError(err, form),
  });

  const lineErrors = form.formState.errors.lines as any;

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Vehicle & documents</CardTitle>
        </CardHeader>
        <CardContent>
          <FormGrid className="lg:grid-cols-4">
            <ComboboxField form={form} name="supplierId" label="Supplier" required options={lookups.data?.suppliers} loading={lookups.isLoading} className="sm:col-span-2" />
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="grn-po">Purchase order</Label>
              <Controller
                control={form.control}
                name="purchaseOrderId"
                render={({ field }) => (
                  <NativeSelect id="grn-po" value={String(field.value ?? '')} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : '')} disabled={!sid}>
                    <option value="">{sid ? (pos.data?.length ? 'No PO (direct receipt)' : 'No open PO for this supplier') : 'Choose the supplier first'}</option>
                    {pos.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.poNo} · {fmtDate(p.poDate)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              />
            </div>
            <TextField form={form} name="grnDate" label="Date" type="date" required />
            <TextField form={form} name="vehicleNo" label="Vehicle no." placeholder="GJ10AB1234" inputClassName="uppercase" />
            <TextField form={form} name="supplierChallan" label="Supplier challan no." />
            <TextField form={form} name="supplierInvoice" label="Supplier invoice no." />
          </FormGrid>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Material received</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {fields.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              {pid ? 'Everything on this PO is already received or waiting for QC.' : 'Add the material that arrived.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-y bg-muted/40 text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left">Raw material</th>
                    <th className="w-48 px-3 py-2 text-left">Mill heat no. (from MTC)</th>
                    <th className="w-40 px-3 py-2 text-right">Received qty</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, i) => {
                    const poLineId = Number(values.lines?.[i]?.purchaseOrderLineId) || 0;
                    const poLine = po?.lines.find((l) => l.id === poLineId);
                    const err = lineErrors?.[i];
                    return (
                      <tr key={field.id} className="border-b align-top">
                        <td className="px-4 py-2">
                          {poLineId ? (
                            <div className="pt-1.5">
                              <div className="font-medium">{poLine?.label ?? lookups.data?.rawMaterials.find((m) => m.value === Number(values.lines?.[i]?.rawMaterialId))?.label}</div>
                              {poLine && (
                                <div className="text-xs text-muted-foreground">
                                  Ordered {fmtQty(poLine.ordered)} · accepted {fmtQty(poLine.accepted)}
                                  {poLine.awaitingQc > 0 && ` · ${fmtQty(poLine.awaitingQc)} waiting QC`} · <span className="font-medium text-foreground">{fmtQty(poLine.pending)} to come</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <Controller
                              control={form.control}
                              name={`lines.${i}.rawMaterialId`}
                              render={({ field: f }) => (
                                <Combobox value={Number(f.value) || undefined} onChange={f.onChange} options={lookups.data?.rawMaterials} placeholder="Choose material…" invalid={!!err?.rawMaterialId} />
                              )}
                            />
                          )}
                          {err?.rawMaterialId && <p className="mt-1 text-xs text-destructive">{err.rawMaterialId.message}</p>}
                        </td>
                        <td className="px-3 py-2">
                          <Input {...form.register(`lines.${i}.millHeatNo`)} placeholder="e.g. CSC787" className="font-mono" aria-label={`Line ${i + 1} mill heat number`} />
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" step="0.001" min={0} {...form.register(`lines.${i}.receivedQty`)} aria-invalid={!!err?.receivedQty} className="text-right" aria-label={`Line ${i + 1} received quantity`} />
                          {poLine && Number(values.lines?.[i]?.receivedQty) > poLine.pending && poLine.pending > 0 && (
                            <p className="mt-1 text-right text-xs text-warning">More than ordered</p>
                          )}
                          {err?.receivedQty && <p className="mt-1 text-right text-xs text-destructive">{err.receivedQty.message}</p>}
                        </td>
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
          )}
          {!pid && (
            <div className="px-5 py-3">
              <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine())}>
                <Plus /> Add material
              </Button>
            </div>
          )}
          {typeof lineErrors?.message === 'string' && <p className="px-5 pb-3 text-xs text-destructive">{lineErrors.message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <TextareaField form={form} name="remarks" label="Remarks" rows={2} placeholder="Condition of material, packing, shortages seen at the gate…" />
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-20 -mx-3 flex items-center justify-end gap-2 border-t bg-background/95 px-3 py-3 backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6">
        {onDone && (
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={save.isPending} disabled={fields.length === 0}>
          {grn ? 'Save changes' : 'Save gate entry'}
        </Button>
      </div>
    </form>
  );
}
