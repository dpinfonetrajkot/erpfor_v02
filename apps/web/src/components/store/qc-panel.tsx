'use client';

import { useFieldArray, useWatch } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { CheckCheck, ClipboardCheck } from 'lucide-react';
import { qcSchema, type QcInput } from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtQty } from '@/lib/format';
import { showApiError } from '@/hooks/use-api';
import type { GoodsReceipt } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';

type Values = z.input<typeof qcSchema>;

/** Incoming QC of the lines still waiting for inspection. */
export function QcPanel({ grn }: { grn: GoodsReceipt }) {
  const pending = grn.lines.filter((l) => l.qcStatus === 'PENDING');
  const form = useZodForm(qcSchema, {
    lines: pending.map((l) => ({
      lineId: l.id,
      acceptedQty: l.receivedQty,
      rejectedQty: 0,
      heatNo: '',
      millHeatNo: l.millHeatNo ?? '',
      qcRemarks: '',
    })),
  });
  const { fields } = useFieldArray({ control: form.control, name: 'lines' });
  const values = useWatch({ control: form.control }) as Values;
  const errors = form.formState.errors.lines as any;

  const submit = useMutation({
    mutationFn: (body: QcInput) => api<GoodsReceipt>(`/goods-receipts/${grn.id}/qc`, { method: 'POST', body }),
    onSuccess: (r) => {
      const heats = r.lines.filter((l) => l.heat).map((l) => l.heat!.heatNo);
      toast.success('QC result saved, material is in the RM store', {
        description: heats.length ? `Heat no. ${[...new Set(heats)].join(', ')} - upload the MTC on the heat.` : undefined,
      });
    },
    onError: (err) => showApiError(err, form),
  });

  /** Typing the accepted quantity fills the rejected one (received - accepted). */
  const setAccepted = (i: number, raw: string) => {
    const received = pending[i].receivedQty;
    const accepted = raw === '' ? '' : Math.min(Math.max(Number(raw), 0), received);
    form.setValue(`lines.${i}.acceptedQty`, accepted, { shouldDirty: true });
    form.setValue(`lines.${i}.rejectedQty`, accepted === '' ? 0 : Math.round((received - Number(accepted)) * 1000) / 1000, { shouldDirty: true });
  };

  return (
    <Card id="qc" className="border-warning/50 scroll-mt-20">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="size-4 text-warning" /> Incoming QC
          </CardTitle>
          <CardDescription>
            Check the material and its MTC. Accepted quantity goes into the RM store under its own heat number. Leave the heat number empty to give the next one
            automatically, or type an existing heat number when the same heat arrives again.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => pending.forEach((l, i) => setAccepted(i, String(l.receivedQty)))}
        >
          <CheckCheck /> Accept all
        </Button>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <form onSubmit={form.handleSubmit((v) => submit.mutate(v))} noValidate>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Material</th>
                  <th className="px-3 py-2 text-right">Received</th>
                  <th className="w-32 px-3 py-2 text-right">Accepted</th>
                  <th className="w-24 px-3 py-2 text-right">Rejected</th>
                  <th className="w-40 px-3 py-2 text-left">Heat no.</th>
                  <th className="w-36 px-3 py-2 text-left">Mill heat no.</th>
                  <th className="px-3 py-2 text-left">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field, i) => {
                  const line = pending[i];
                  const rejected = Number(values.lines?.[i]?.rejectedQty) || 0;
                  const err = errors?.[i];
                  return (
                    <tr key={field.id} className="border-b align-top">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">
                          {line.rawMaterial.grade.name} · {line.rawMaterial.size}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">{line.rawMaterial.code}</div>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">
                        {fmtQty(line.receivedQty)} <span className="text-xs text-muted-foreground">{line.rawMaterial.uom.toLowerCase()}</span>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.001"
                          min={0}
                          max={line.receivedQty}
                          value={String(values.lines?.[i]?.acceptedQty ?? '')}
                          onChange={(e) => setAccepted(i, e.target.value)}
                          className="text-right"
                          aria-invalid={!!err?.acceptedQty}
                          aria-label={`Accepted quantity of ${line.rawMaterial.grade.name} ${line.rawMaterial.size}`}
                        />
                        {err?.acceptedQty && <p className="mt-1 text-right text-xs text-destructive">{err.acceptedQty.message}</p>}
                      </td>
                      <td className={`tabular px-3 py-2.5 text-right ${rejected > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>{fmtQty(rejected)}</td>
                      <td className="px-3 py-2">
                        <Input {...form.register(`lines.${i}.heatNo`)} placeholder="Auto" className="font-mono uppercase" aria-label="Heat number" />
                        {err?.heatNo && <p className="mt-1 text-xs text-destructive">{err.heatNo.message}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <Input {...form.register(`lines.${i}.millHeatNo`)} className="font-mono" aria-label="Mill heat number" />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          {...form.register(`lines.${i}.qcRemarks`)}
                          placeholder={rejected > 0 ? 'Reason for rejection (required)' : 'Optional'}
                          aria-invalid={!!err?.qcRemarks}
                          aria-label="QC remarks"
                        />
                        {err?.qcRemarks && <p className="mt-1 text-xs text-destructive">{err.qcRemarks.message}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end px-5 py-3">
            <Button type="submit" loading={submit.isPending}>
              <ClipboardCheck /> Save QC result
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
