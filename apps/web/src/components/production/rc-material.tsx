'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { z } from 'zod';
import { PackageOpen, Undo2 } from 'lucide-react';
import { materialRequestSchema, materialReturnSchema, type MaterialRequestInput, type MaterialReturnInput } from '@bht/shared';
import { useZodForm } from '@/lib/forms';
import { fmtDate, fmtQty } from '@/lib/format';
import { useSave } from '@/hooks/use-api';
import type { RouteCard } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { FormGrid, SelectField, TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { MrStatusBadge } from '@/components/app/status';
import { useSession } from '@/components/app/session';

/** Raw material of a route card: what was asked for, what the store issued by heat, and returns. */
export function RcMaterial({ rc }: { rc: RouteCard }) {
  const { can } = useSession();
  const [dialog, setDialog] = useState<'request' | 'return' | null>(null);
  const active = rc.status === 'OPEN' || rc.status === 'IN_PROGRESS' || rc.status === 'COMPLETED';
  const heatsOnCard = rc.heats.filter((h) => h.quantity > 0);
  const m = rc.material;
  const stillNeeded = m.neededKg !== null ? Math.max(0, Math.round((m.neededKg - m.requestedKg) * 1000) / 1000) : null;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <PackageOpen className="size-4 text-primary" /> Material
          </CardTitle>
          <CardDescription>
            {rc.rawMaterial ? `${rc.rawMaterial.grade.name} ${rc.rawMaterial.size}` : 'No raw material set'}
            {m.neededKg !== null && ` · needed ${fmtQty(m.neededKg)} kg`} · asked {fmtQty(m.requestedKg)} kg · on card {fmtQty(m.issuedKg)} kg
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {active && rc.status !== 'COMPLETED' && can('material_requisitions.create') && (
            <Button size="sm" variant={m.issuedKg > 0 ? 'outline' : 'default'} onClick={() => setDialog('request')}>
              <PackageOpen /> Ask store for material
            </Button>
          )}
          {heatsOnCard.length > 0 && can('material_issues.issue') && rc.status !== 'CANCELLED' && (
            <Button size="sm" variant="outline" onClick={() => setDialog('return')}>
              <Undo2 /> Return to store
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        {heatsOnCard.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {heatsOnCard.map((h) => (
              <span key={h.heatId} className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-[13px]">
                <span className="font-mono font-semibold">{h.heatNo}</span>
                {h.millHeatNo && <span className="text-xs text-muted-foreground">mill {h.millHeatNo}</span>}
                <span className="tabular">{fmtQty(h.quantity)} kg</span>
              </span>
            ))}
          </div>
        )}
        {rc.materialRequisitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No material asked for yet.{stillNeeded ? ` About ${fmtQty(stillNeeded)} kg is needed.` : ''} Stages can be recorded after the store issues material.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-xs text-muted-foreground uppercase">
                <tr className="border-b bg-muted/40">
                  <th className="px-3 py-2 text-left">Request</th>
                  <th className="px-3 py-2 text-right">Asked (kg)</th>
                  <th className="px-3 py-2 text-right">Issued (kg)</th>
                  <th className="px-3 py-2 text-left">Asked by</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {rc.materialRequisitions.map((mr) => (
                  <tr key={mr.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-mono text-[13px] font-semibold">{mr.mrNo}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(mr.mrDate)}
                        {mr.remarks && ` · ${mr.remarks}`}
                      </div>
                    </td>
                    <td className="tabular px-3 py-2 text-right">{fmtQty(mr.requestedQty)}</td>
                    <td className="tabular px-3 py-2 text-right">{fmtQty(mr.issuedQty)}</td>
                    <td className="px-3 py-2 text-[13px]">{mr.createdBy?.name ?? '—'}</td>
                    <td className="px-3 py-2">
                      <MrStatusBadge status={mr.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rc.materialIssues.length > 0 && (
          <div>
            <div className="mb-1.5 text-[13px] font-medium">Issued and returned</div>
            <ul className="divide-y rounded-lg border text-[13px]">
              {rc.materialIssues.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                  <span className={cn('tabular w-24 font-semibold', i.quantity < 0 ? 'text-warning' : 'text-success')}>
                    {i.quantity < 0 ? '−' : '+'}
                    {fmtQty(Math.abs(i.quantity))} kg
                  </span>
                  <span className="font-mono">{i.heat.heatNo}</span>
                  <span className="text-muted-foreground">
                    {i.quantity < 0 ? 'returned' : `issued${i.materialRequisition ? ` on ${i.materialRequisition.mrNo}` : ''}`} by {i.issuedBy.name} · {fmtDate(i.issueDate)}
                  </span>
                  {i.remarks && i.quantity > 0 && <span className="text-muted-foreground">· {i.remarks}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      {dialog === 'request' && <RequestDialog rc={rc} suggested={stillNeeded} onClose={() => setDialog(null)} />}
      {dialog === 'return' && <ReturnDialog rc={rc} onClose={() => setDialog(null)} />}
    </Card>
  );
}

function RequestDialog({ rc, suggested, onClose }: { rc: RouteCard; suggested: number | null; onClose: () => void }) {
  const defaults: z.input<typeof materialRequestSchema> = { quantity: suggested || '', remarks: '' };
  const form = useZodForm(materialRequestSchema, defaults);
  const save = useSave<MaterialRequestInput, { mrNo: string }>({
    path: `/route-cards/${rc.id}/material-requests`,
    form,
    label: 'Material request',
    successMessage: 'Material request sent to store',
    onSaved: (r) => {
      toast.message(r.mrNo);
      onClose();
    },
  });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Ask store for material"
      description={`${rc.rawMaterial?.grade.name ?? ''} ${rc.rawMaterial?.size ?? ''} for ${rc.rcNo}. The store chooses the heats.`}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
      submitLabel="Send to store"
    >
      <TextField
        form={form}
        name="quantity"
        label="Quantity (kg)"
        type="number"
        min={0}
        step="0.001"
        required
        autoFocus
        hint={suggested ? `Still needed for this card: about ${fmtQty(suggested)} kg` : undefined}
      />
      <TextField form={form} name="remarks" label="Note" placeholder="e.g. cut to 300 mm lengths" />
    </FormDialog>
  );
}

function ReturnDialog({ rc, onClose }: { rc: RouteCard; onClose: () => void }) {
  const heats = rc.heats.filter((h) => h.quantity > 0);
  const defaults: z.input<typeof materialReturnSchema> = { heatId: heats.length === 1 ? heats[0].heatId : ('' as unknown as number), quantity: '', remarks: '' };
  const form = useZodForm(materialReturnSchema, defaults);
  const save = useSave<MaterialReturnInput>({
    path: `/route-cards/${rc.id}/material-returns`,
    form,
    label: 'Return',
    successMessage: 'Material back in the RM store',
    onSaved: onClose,
  });
  const heat = heats.find((h) => h.heatId === Number(form.watch('heatId')));
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Return material to store"
      description="Unused bar goes back into the RM store under the same heat."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
      submitLabel="Return to store"
    >
      <FormGrid>
        <SelectField
          form={form}
          name="heatId"
          label="Heat"
          required
          numeric
          placeholder={heats.length > 1 ? 'Choose heat…' : undefined}
          options={heats.map((h) => ({ value: h.heatId, label: `${h.heatNo} (${fmtQty(h.quantity)} kg on card)` }))}
        />
        <TextField form={form} name="quantity" label="Quantity (kg)" type="number" min={0} step="0.001" required hint={heat ? `Up to ${fmtQty(heat.quantity)} kg` : undefined} />
      </FormGrid>
      <TextField form={form} name="remarks" label="Note" placeholder="e.g. end pieces, bar left over" />
    </FormDialog>
  );
}
