'use client';

import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FileText, FlaskConical, Scale } from 'lucide-react';
import { routeCardFieldsSchema, type RouteCardFieldsInput } from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtQty } from '@/lib/format';
import { showApiError, type LookupOption } from '@/hooks/use-api';
import type { StageInfo } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox } from '@/components/ui/primitives';
import { ComboboxField, FormGrid, TextareaField, TextField } from '@/components/app/form';

export type RcFormValues = z.input<typeof routeCardFieldsSchema>;

/**
 * The plan of a route card: material, extra pieces and the stages this part goes through.
 * Used for a new card (POST with the request id) and to change a card not started yet (PUT).
 */
export function RouteCardEditor({
  initial,
  stages,
  stagesFrom,
  rawMaterials,
  orderQty,
  submit,
  submitLabel,
  footer,
}: {
  initial: RcFormValues;
  stages: StageInfo[];
  stagesFrom?: string | null;
  rawMaterials: LookupOption[] | undefined;
  /** Pieces asked for by the production request. */
  orderQty: number;
  submit: (values: RouteCardFieldsInput) => Promise<unknown>;
  submitLabel: string;
  footer?: React.ReactNode;
}) {
  const form = useZodForm(routeCardFieldsSchema, initial);
  const save = useMutation({ mutationFn: submit, onError: (err) => showApiError(err, form) });

  const stageIds = (form.watch('stageIds') ?? []).map(Number);
  const extra = Number(form.watch('extraQty') || 0);
  const weight = Number(form.watch('inputWeightKg') || 0);
  const total = orderQty + (Number.isFinite(extra) ? extra : 0);
  const stageError = form.formState.errors.stageIds?.message;

  const toggle = (id: number, on: boolean) => {
    const next = on ? [...stageIds, id] : stageIds.filter((s) => s !== id);
    form.setValue('stageIds', stages.filter((s) => next.includes(s.id)).map((s) => s.id), { shouldDirty: true, shouldValidate: true });
  };

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>Extra pieces cover rejections on the way. Bar weight per piece tells the store how much material to give.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormGrid>
            <TextField form={form} name="rcDate" label="Route card date" type="date" required />
            <TextField form={form} name="expectedDelivery" label="Needed by" type="date" />
            <TextField
              form={form}
              name="extraQty"
              label="Extra pieces"
              type="number"
              min={0}
              step={1}
              hint={`Make ${fmtQty(orderQty)} + ${fmtQty(extra || 0)} = ${fmtQty(total)} pcs`}
            />
            <ComboboxField form={form} name="rawMaterialId" label="Raw material (grade / bar size)" required options={rawMaterials} loading={!rawMaterials} />
            <TextField
              form={form}
              name="inputWeightKg"
              label="Bar weight per piece (kg)"
              type="number"
              min={0}
              step="0.001"
              hint={weight > 0 ? `Material needed: ${fmtQty(total)} × ${fmtQty(weight)} = ${fmtQty(Math.round(total * weight * 1000) / 1000)} kg` : 'Cut weight of one piece, incl. cutting loss'}
            />
          </FormGrid>
          <TextareaField form={form} name="remarks" label="Notes for the shop floor" rows={2} placeholder="Customer requirement, marking, priority…" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Stages ({stageIds.length} of {stages.length})</CardTitle>
            <CardDescription>
              {stagesFrom ? `Ticked like the last card of this part (${stagesFrom}). ` : ''}Untick the stages this part does not go through. Order comes from the stage master.
            </CardDescription>
          </div>
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => form.setValue('stageIds', stages.map((s) => s.id), { shouldValidate: true })}>
              Tick all
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {stageError && (
            <p className="mb-3 text-sm text-destructive" role="alert">
              {stageError}
            </p>
          )}
          <ol className="grid gap-2 sm:grid-cols-2">
            {stages.map((s, i) => {
              const on = stageIds.includes(s.id);
              return (
                <li key={s.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                      on ? 'border-primary/40 bg-primary/5' : 'bg-card opacity-70 hover:opacity-100',
                    )}
                  >
                    <Checkbox checked={on} onCheckedChange={(c) => toggle(s.id, c === true)} aria-label={s.name} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="tabular text-xs text-muted-foreground">{i + 1}.</span>
                        <span className="font-medium">{s.name}</span>
                        {s.isMaterialCheck && (
                          <Badge variant="outline">
                            <FlaskConical aria-hidden /> Material
                          </Badge>
                        )}
                        {s.captureWeights && (
                          <Badge variant="outline">
                            <Scale aria-hidden /> Weight
                          </Badge>
                        )}
                        {s.requiresReport && (
                          <Badge variant="outline">
                            <FileText aria-hidden /> Report
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{s.roles.map((r) => r.role.name).join(' / ') || 'Admin only'}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ol>
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

/** POST a new card; returns its id. */
export function createRouteCard(requestId: number, values: RouteCardFieldsInput) {
  return api<{ id: number; rcNo: string }>('/route-cards', { method: 'POST', body: { ...values, productionRequestId: requestId } }).then((r) => {
    toast.success(`Route card ${r.rcNo} made`);
    return r;
  });
}
