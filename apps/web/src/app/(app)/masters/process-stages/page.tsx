'use client';

import { useState } from 'react';
import type { z } from 'zod';
import { Controller } from 'react-hook-form';
import { FileText, FlaskConical, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import { humanize, processStageSchema, STAGE_TYPES, type ProcessStageInput } from '@bht/shared';
import { fromEntity, useZodForm } from '@/lib/forms';
import { useApiQuery, useDelete, useLookups, useSave } from '@/hooks/use-api';
import type { ProcessStage } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge, Card, Checkbox, Skeleton } from '@/components/ui/primitives';
import { Field, FormGrid, FormSection, FormSheet, SelectField, SwitchField, TextField, TextareaField } from '@/components/app/form';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

const TYPE_BADGE = { TEST: 'info', INSPECTION: 'warning', OPERATION: 'secondary' } as const;

export default function ProcessStagesPage() {
  return (
    <RequirePermission permission="process_stages.view">
      <Stages />
    </RequirePermission>
  );
}

function Stages() {
  const { can } = useSession();
  const { data, isLoading } = useApiQuery<ProcessStage[]>('/process-stages');
  const [editing, setEditing] = useState<ProcessStage | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProcessStage | null>(null);
  const del = useDelete('/process-stages', 'Stage', () => setDeleting(null));

  return (
    <>
      <PageHeader
        title="Process stages"
        description="The route every part follows on its route card, in this order. Each stage can only be recorded by the roles shown."
        actions={
          can('process_stages.create') && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New stage
            </Button>
          )
        }
      />
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (
        <ol className="relative space-y-2 before:absolute before:top-4 before:bottom-4 before:left-[19px] before:w-px before:bg-border">
          {data?.map((s, i) => (
            <li key={s.id} className="relative flex gap-3">
              <span
                className={cn(
                  'relative z-10 mt-3 flex size-10 shrink-0 items-center justify-center rounded-full border-2 bg-card text-sm font-semibold',
                  s.isActive ? 'border-primary/50 text-primary' : 'border-border text-muted-foreground',
                )}
              >
                {i + 1}
              </span>
              <Card className={cn('flex flex-1 flex-col gap-2 p-4 sm:flex-row sm:items-center', !s.isActive && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <Badge variant={TYPE_BADGE[s.type]}>{humanize(s.type)}</Badge>
                    {s.captureWeights && (
                      <Badge variant="outline">
                        <Scale aria-hidden /> Weights
                      </Badge>
                    )}
                    {s.requiresReport && (
                      <Badge variant="outline">
                        <FileText aria-hidden /> Report
                      </Badge>
                    )}
                    {s.isMaterialCheck && (
                      <Badge variant="outline">
                        <FlaskConical aria-hidden /> Material check
                      </Badge>
                    )}
                    {!s.isActive && <Badge variant="muted">Inactive</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Recorded by: {s.roles.length ? s.roles.map((r) => r.name).join(', ') : 'Admin only'}
                  </div>
                </div>
                <div className="flex gap-1">
                  {can('process_stages.update') && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                      <Pencil /> Edit
                    </Button>
                  )}
                  {can('process_stages.delete') && (
                    <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(s)} aria-label={`Delete ${s.name}`}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}
      {editing && (
        <StageSheet
          stage={editing === 'new' ? null : editing}
          nextSequence={((data?.at(-1)?.sequence ?? 0) as number) + 10}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete stage?"
        description={`“${deleting?.name}” will be removed. Stages already used on route cards cannot be deleted — mark them inactive instead.`}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

function StageSheet({ stage, nextSequence, onClose }: { stage: ProcessStage | null; nextSequence: number; onClose: () => void }) {
  const lookups = useLookups('roles');
  const defaults: z.input<typeof processStageSchema> = {
    code: '',
    name: '',
    sequence: nextSequence,
    type: 'OPERATION',
    captureWeights: false,
    requiresReport: false,
    isMaterialCheck: false,
    description: '',
    isActive: true,
    roleIds: [],
  };
  const form = useZodForm(processStageSchema, fromEntity(defaults, stage));
  const save = useSave<ProcessStageInput>({ path: '/process-stages', id: stage?.id, form, label: 'Stage', onSaved: onClose });

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={stage ? `Edit ${stage.name}` : 'New process stage'}
      description="Stages are listed by sequence number; leave gaps of 10 so new stages can go in between."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <FormSection title="Stage">
        <FormGrid>
          <TextField form={form} name="name" label="Name" placeholder="Heat Treatment" required className="sm:col-span-2" />
          <TextField form={form} name="code" label="Code" placeholder="heat_treatment" required inputClassName="font-mono" disabled={!!stage} hint={stage ? 'Code cannot change' : 'lowercase_with_underscores'} />
          <TextField form={form} name="sequence" label="Sequence" type="number" min={1} required />
          <SelectField form={form} name="type" label="Type" options={STAGE_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
        </FormGrid>
        <TextareaField form={form} name="description" label="Description" rows={2} />
        <SwitchField form={form} name="captureWeights" label="Record weights" hint="Input / output / scrap weight (cutting, forging, machining)." />
        <SwitchField form={form} name="requiresReport" label="Needs a test report" hint="A PDF report must be attached (chemical, mechanical testing)." />
        <SwitchField
          form={form}
          name="isMaterialCheck"
          label="Checks the raw material"
          hint="Before cutting (chemical test, RM inspection, UT): recorded as OK / not OK for the issued heats, no piece count."
        />
        <SwitchField form={form} name="isActive" label="Active" />
      </FormSection>

      <FormSection title="Who can record this stage">
        <Controller
          control={form.control}
          name="roleIds"
          render={({ field }) => {
            const value = (field.value ?? []) as number[];
            return (
              <Field label="Roles" hint="Admin can always record every stage.">
                <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                  {(lookups.data?.roles ?? [])
                    .filter((r) => r.label !== 'Admin')
                    .map((r) => (
                      <label key={r.value} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={value.includes(r.value)}
                          onCheckedChange={(c) => field.onChange(c === true ? [...value, r.value] : value.filter((v) => v !== r.value))}
                        />
                        {r.label}
                      </label>
                    ))}
                </div>
              </Field>
            );
          }}
        />
      </FormSection>
    </FormSheet>
  );
}
