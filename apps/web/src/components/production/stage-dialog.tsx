'use client';

import { useId } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { CheckCircle2, XCircle } from 'lucide-react';
import { operationRecordSchema, type OperationRecordInput } from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtQty } from '@/lib/format';
import { showApiError } from '@/hooks/use-api';
import type { RcOperation, RouteCard } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Field, FormGrid, TextField } from '@/components/app/form';
import { Attachments } from '@/components/app/attachments';

type Values = z.input<typeof operationRecordSchema>;

const num = (v: unknown) => (v === '' || v === undefined || v === null ? undefined : Number(v));
const kg = (v: number) => Math.round(v * 1000) / 1000;

/** Record (or correct) one stage of a route card. The fields shown depend on the stage. */
export function StageDialog({ rc, op, onClose }: { rc: RouteCard; op: RcOperation; onClose: () => void }) {
  const idx = rc.operations.findIndex((o) => o.id === op.id);
  const before = rc.operations.slice(0, idx).reverse();
  const stage = op.stage;
  const prevPiece = before.find((o) => !o.stage.isMaterialCheck);
  const firstPiece = !stage.isMaterialCheck && !prevPiece;
  const received = prevPiece?.okQty ?? null;
  const prevWeight = before.find((o) => o.stage.captureWeights && o.outputWeightKg != null);
  const recorded = op.status !== 'PENDING';

  const form = useZodForm(operationRecordSchema, {
    result: op.readings?.result,
    okQty: op.okQty ?? '',
    rejectedQty: op.rejectedQty ?? '',
    reason: op.rejectionReason ?? '',
    outputWeightKg: op.outputWeightKg ?? '',
    scrapWeightKg: prevWeight ? '' : (op.scrapWeightKg ?? ''),
    operatorName: op.operatorName ?? '',
    machine: op.machine ?? '',
    remarks: op.remarks ?? '',
  } satisfies Values);

  const save = useMutation({
    mutationFn: (v: OperationRecordInput) => api(`/route-cards/${rc.id}/operations/${op.id}`, { method: 'POST', body: v }),
    onSuccess: () => {
      toast.success(`${stage.name} saved`);
      onClose();
    },
    onError: (err) => showApiError(err, form),
  });

  const result = form.watch('result');
  const ok = num(form.watch('okQty'));
  const rejected = num(form.watch('rejectedQty'));
  const out = num(form.watch('outputWeightKg'));
  const needsReason = stage.isMaterialCheck ? result === 'NOT_OK' : (rejected ?? (received !== null && ok !== undefined ? received - ok : 0)) > 0;
  const okId = useId();
  const rejId = useId();
  const errors = form.formState.errors;

  // Later stages: OK + rejected must equal what came from the stage before, so typing one fills the other.
  const okReg = form.register('okQty', {
    onChange: (e) => {
      const v = num(e.target.value);
      if (received !== null && v !== undefined && v <= received) form.setValue('rejectedQty', received - v);
    },
  });
  const rejReg = form.register('rejectedQty', {
    onChange: (e) => {
      const v = num(e.target.value);
      if (received !== null && v !== undefined && v <= received) form.setValue('okQty', received - v);
    },
  });

  const issuedKg = rc.material.issuedKg;
  const possible = firstPiece && out ? Math.floor(issuedKg / out) : null;
  const scrapEach = prevWeight && out ? kg(Math.max(0, prevWeight.outputWeightKg! - out)) : null;
  const pieces = firstPiece ? (ok ?? 0) + (rejected ?? 0) : (received ?? 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {recorded ? 'Change' : 'Record'} {stage.name}
          </DialogTitle>
          <DialogDescription>
            {rc.rcNo} · {rc.item.name}
            {received !== null && ` · ${fmtQty(received)} pcs received from ${prevPiece!.stage.name}`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
          {stage.isMaterialCheck ? (
            <>
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Heats on this card: </span>
                {rc.heats.filter((h) => h.quantity > 0).map((h) => `${h.heatNo}${h.millHeatNo ? ` (mill ${h.millHeatNo})` : ''} – ${fmtQty(h.quantity)} kg`).join(', ') || '—'}
              </div>
              <Field label="Result" required error={errors.result?.message}>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Result">
                  {(['OK', 'NOT_OK'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={result === r}
                      onClick={() => form.setValue('result', r, { shouldValidate: true })}
                      className={cn(
                        'flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors',
                        result === r
                          ? r === 'OK'
                            ? 'border-success bg-success/10 text-success'
                            : 'border-destructive bg-destructive/10 text-destructive'
                          : 'hover:bg-muted',
                      )}
                    >
                      {r === 'OK' ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />} {r === 'OK' ? 'OK' : 'Not OK'}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          ) : (
            <>
              {firstPiece && (
                <p className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                  Material on this card: <b>{fmtQty(issuedKg)} kg</b>
                  {possible !== null ? ` → about ${fmtQty(possible)} pcs at ${fmtQty(out!)} kg each` : '. Enter the pieces made from it.'}
                  {` · planned ${fmtQty(rc.plannedQty + rc.extraQty)} pcs`}
                </p>
              )}
              <FormGrid>
                <Field id={okId} label="OK pieces" required error={errors.okQty?.message}>
                  <Input id={okId} type="number" min={0} step={1} inputMode="numeric" aria-invalid={!!errors.okQty} autoFocus {...okReg} />
                </Field>
                <Field
                  id={rejId}
                  label="Rejected pieces"
                  error={errors.rejectedQty?.message}
                  hint={received !== null ? `OK + rejected = ${fmtQty(received)}` : undefined}
                >
                  <Input id={rejId} type="number" min={0} step={1} inputMode="numeric" aria-invalid={!!errors.rejectedQty} {...rejReg} />
                </Field>
              </FormGrid>
            </>
          )}

          {needsReason && (
            <TextField
              form={form}
              name="reason"
              label={stage.isMaterialCheck ? 'Why not OK' : 'Rejection reason'}
              required
              placeholder={stage.isMaterialCheck ? 'e.g. carbon out of range' : 'e.g. lap, crack, undersize'}
            />
          )}

          {stage.captureWeights && (
            <FormGrid>
              <TextField
                form={form}
                name="outputWeightKg"
                label={firstPiece ? 'Cut weight per piece (kg)' : 'Weight per piece after this stage (kg)'}
                type="number"
                min={0}
                step="0.001"
                required
                hint={out && pieces ? `Total ${fmtQty(kg(out * (ok ?? pieces)))} kg for ${fmtQty(ok ?? pieces)} OK pcs` : undefined}
              />
              {prevWeight ? (
                <Field label="Scrap per piece (kg)" hint={`${fmtQty(prevWeight.outputWeightKg!)} kg in from ${prevWeight.stage.name}`}>
                  <Input value={scrapEach !== null ? `${fmtQty(scrapEach)}  (total ${fmtQty(kg(scrapEach * pieces))} kg)` : '—'} readOnly tabIndex={-1} className="bg-muted/50" />
                </Field>
              ) : (
                <TextField form={form} name="scrapWeightKg" label="Loss per piece (kg)" type="number" min={0} step="0.001" hint="Cutting loss (blade width, end pieces)" />
              )}
            </FormGrid>
          )}

          <FormGrid>
            <TextField form={form} name="operatorName" label="Operator" />
            <TextField form={form} name="machine" label="Machine / furnace" />
          </FormGrid>
          <TextField
            form={form}
            name="remarks"
            label={stage.type === 'OPERATION' ? 'Note' : 'Readings / note'}
            placeholder={stage.type === 'TEST' ? 'e.g. HB 197–207, UTS 520 MPa, 15000 psi held 3 min' : undefined}
          />

          {stage.requiresReport && <Attachments entity="route_card_operation" entityId={op.id} canEdit title="Test report (needed)" />}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save {stage.name}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
