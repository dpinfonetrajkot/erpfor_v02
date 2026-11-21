'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Ban, Check, Eraser, FileText, Inbox, Lock, Paperclip, Pencil, Printer, Scale, X } from 'lucide-react';
import type { RouteCardFieldsInput } from '@bht/shared';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtQty, toInputDate } from '@/lib/format';
import { showApiError, useApiQuery, useLookups } from '@/hooks/use-api';
import type { RcOperation, RouteCard } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { Attachments } from '@/components/app/attachments';
import { PageHeader } from '@/components/app/page-header';
import { ReasonDialog } from '@/components/app/reason-dialog';
import { RcStatusBadge, StageProgress } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { RC_READERS } from '@/components/production/rc-access';
import { RouteCardEditor } from '@/components/production/rc-editor';
import { RcMaterial } from '@/components/production/rc-material';
import { StageDialog } from '@/components/production/stage-dialog';

export default function RouteCardPage() {
  return (
    <RequirePermission permission={RC_READERS}>
      <RouteCardDetail />
    </RequirePermission>
  );
}

function RouteCardDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data: rc, isError } = useApiQuery<RouteCard>(`/route-cards/${id}`);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [recording, setRecording] = useState<RcOperation | null>(null);
  const [clearing, setClearing] = useState<RcOperation | null>(null);

  const cancel = useMutation({
    mutationFn: (reason: string) => api(`/route-cards/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      toast.success('Route card cancelled; the request can be planned again');
      setCancelling(false);
    },
    onError: (err) => showApiError(err),
  });
  const clear = useMutation({
    mutationFn: (op: RcOperation) => api(`/route-cards/${id}/operations/${op.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Stage entry cleared');
      setClearing(null);
    },
    onError: (err) => showApiError(err),
  });

  if (isError) return <p className="py-20 text-center text-sm text-muted-foreground">Route card not found.</p>;
  if (!rc) return <Skeleton className="h-96" />;

  const notStarted = rc.status === 'OPEN' && rc.operations.every((o) => o.status === 'PENDING');
  const done = rc.operations.filter((o) => o.status === 'DONE').length;
  const so = rc.salesOrderLine?.salesOrder;
  const total = rc.plannedQty + rc.extraQty;
  const finalOp = rc.operations.at(-1);
  const pendingSlip = rc.completions.find((c) => c.status === 'PENDING');
  const movedSlip = rc.completions.find((c) => c.status === 'MOVED_TO_STOCK');

  return (
    <>
      <PageHeader
        title={rc.rcNo}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <RcStatusBadge status={rc.status} />
            <span>
              {rc.item.name} · {fmtDate(rc.rcDate)}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/route-cards/${rc.id}/pdf`} target="_blank" rel="noreferrer">
                <Printer /> Print
              </a>
            </Button>
            {notStarted && can('route_cards.update') && !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Change plan
              </Button>
            )}
            {notStarted && can('route_cards.update') && !editing && (
              <Button variant="outline" className="text-destructive" onClick={() => setCancelling(true)}>
                <Ban /> Cancel card
              </Button>
            )}
            <Button variant="ghost" asChild>
              <Link href="/production/route-cards">
                <ArrowLeft /> All cards
              </Link>
            </Button>
          </>
        }
      />

      {rc.status === 'CANCELLED' && (
        <div className="mb-4 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
          <span className="font-medium">Cancelled:</span> {rc.cancelReason}
        </div>
      )}
      {pendingSlip && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <Inbox className="size-4 shrink-0 text-warning" />
          <span className="flex-1">
            All stages done. <b>{fmtQty(pendingSlip.okQty)} pcs</b> wait for the store to put them in the FG store (slip {pendingSlip.slipNo}).
          </span>
          {can('rc_completions.create') && (
            <Button size="sm" asChild>
              <Link href="/store/rc-completion">Put in FG store</Link>
            </Button>
          )}
        </div>
      )}
      {movedSlip && (
        <div role="status" className="mb-4 flex items-center gap-3 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm">
          <Check className="size-4 shrink-0 text-success" />
          <span>
            <b>{fmtQty(movedSlip.okQty)} pcs</b> in FG stock ({movedSlip.heats.map((h) => `${h.heat.heatNo}: ${fmtQty(h.quantity)}`).join(', ')}) · {movedSlip.slipNo} by {movedSlip.movedBy?.name} on {fmtDate(movedSlip.movedAt)}
          </span>
        </div>
      )}
      {rc.status === 'CLOSED' && !movedSlip && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm">
          No piece passed {finalOp?.stage.name}. The production request is open again for a new route card.
        </div>
      )}

      {editing ? (
        <EditPlan rc={rc} onDone={() => setEditing(false)} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>Part</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="font-medium">{rc.item.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{rc.item.code}</div>
                {rc.item.drawingNo && <div className="text-muted-foreground">Drawing {rc.item.drawingNo}</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>For</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {so ? (
                  <>
                    <Link href={`/sales/orders/${so.id}`} className="font-mono font-medium text-primary hover:underline">
                      {so.soNo}
                    </Link>
                    <div>{so.customer.name}</div>
                    <div className="text-muted-foreground">
                      {[so.customerPoNo && `PO ${so.customerPoNo}`, rc.salesOrderLine?.service === 'SOUR' && 'Sour (NACE)', rc.salesOrderLine?.schedule && `Sch. ${rc.salesOrderLine.schedule}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </>
                ) : (
                  <Badge variant="secondary">Make to stock</Badge>
                )}
                {rc.productionRequest && <div className="text-xs text-muted-foreground">{rc.productionRequest.requestNo}</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Pieces</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div>
                  <span className="text-xl font-semibold">{fmtQty(total)}</span> <span className="text-muted-foreground">planned ({fmtQty(rc.plannedQty)} + {fmtQty(rc.extraQty)} extra)</span>
                </div>
                <div className="text-muted-foreground">
                  {finalOp?.status === 'DONE' ? `${fmtQty(finalOp.okQty)} OK at the end` : `${fmtQty(rc.rejectedQty)} rejected so far`} · needed by {fmtDate(rc.expectedDelivery)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <StageProgress done={done} total={rc.operations.length} label={rc.currentStage?.name ?? (rc.status === 'CANCELLED' ? 'Cancelled' : 'All stages done')} />
                <div className="text-xs text-muted-foreground">
                  Made by {rc.createdBy?.name ?? '—'} · {fmtDateTime(rc.createdAt)}
                </div>
              </CardContent>
            </Card>
          </div>

          {rc.remarks && (
            <div className="rounded-lg border bg-card px-4 py-3 text-sm whitespace-pre-line">
              <span className="font-medium">Notes: </span>
              {rc.remarks}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Stages</CardTitle>
              <CardDescription>In order. Each department records its own stage; the next stage gets the OK pieces.</CardDescription>
            </CardHeader>
            <CardContent className="pt-3">
              <ol className="relative space-y-2">
                {rc.operations.map((op, i) => (
                  <StageRow
                    key={op.id}
                    op={op}
                    n={i + 1}
                    current={rc.currentStage?.id === op.stage.id && (rc.status === 'OPEN' || rc.status === 'IN_PROGRESS')}
                    onRecord={() => setRecording(op)}
                    onClear={() => setClearing(op)}
                  />
                ))}
              </ol>
            </CardContent>
          </Card>

          <RcMaterial rc={rc} />

          <Card>
            <CardContent>
              <Attachments entity="route_card" entityId={rc.id} canEdit={can('route_cards.update')} title="Drawings & documents" />
            </CardContent>
          </Card>
        </div>
      )}

      {recording && <StageDialog rc={rc} op={rc.operations.find((o) => o.id === recording.id) ?? recording} onClose={() => setRecording(null)} />}
      <ConfirmDialog
        open={!!clearing}
        onOpenChange={(o) => !o && setClearing(null)}
        title={`Clear ${clearing?.stage.name}?`}
        description="The entry is removed so it can be recorded again. Use this only for a mistake."
        confirmLabel="Clear entry"
        loading={clear.isPending}
        onConfirm={() => clearing && clear.mutate(clearing)}
      />
      {cancelling && (
        <ReasonDialog
          title={`Cancel ${rc.rcNo}?`}
          description="Issued material must be returned to the store first. The production request can then be planned again."
          confirmLabel="Cancel card"
          saving={cancel.isPending}
          onConfirm={(reason) => cancel.mutate(reason)}
          onClose={() => setCancelling(false)}
        />
      )}
    </>
  );
}

function StageRow({ op, n, current, onRecord, onClear }: { op: RcOperation; n: number; current: boolean; onRecord: () => void; onClear: () => void }) {
  const s = op.stage;
  const result = op.readings?.result;
  const failed = op.status === 'IN_PROGRESS' && result === 'NOT_OK';
  const doneOp = op.status === 'DONE';

  let summary: React.ReactNode = null;
  if (doneOp || failed) {
    if (s.isMaterialCheck) {
      summary = result === 'OK' ? <span className="font-medium text-success">OK</span> : <span className="font-medium text-destructive">Not OK: {op.rejectionReason}</span>;
    } else {
      summary = (
        <span className="tabular">
          {op.receivedQty !== null && <span className="text-muted-foreground">{fmtQty(op.receivedQty)} in · </span>}
          <span className="font-semibold text-success">{fmtQty(op.okQty)} OK</span>
          {!!op.rejectedQty && (
            <span className="text-destructive">
              {' '}
              · {fmtQty(op.rejectedQty)} rejected ({op.rejectionReason})
            </span>
          )}
        </span>
      );
    }
  }

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center',
        current && 'border-primary/50 bg-primary/5 ring-1 ring-primary/20',
        failed && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
            doneOp ? 'bg-success text-white' : failed ? 'bg-destructive text-white' : current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
          aria-label={doneOp ? 'Done' : failed ? 'Not OK' : current ? 'Next' : 'Waiting'}
        >
          {doneOp ? <Check className="size-4" /> : failed ? <X className="size-4" /> : n}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{s.name}</span>
            <span className="text-xs text-muted-foreground">{s.roles.map((r) => r.role.name).join(' / ') || 'Admin only'}</span>
            {s.requiresReport && (
              <Badge variant={op.reports ? 'outline' : 'muted'}>
                {op.reports ? <Paperclip aria-hidden /> : <FileText aria-hidden />} {op.reports ? `${op.reports} report${op.reports > 1 ? 's' : ''}` : 'Report needed'}
              </Badge>
            )}
          </div>
          {summary && <div className="text-[13px]">{summary}</div>}
          {s.captureWeights && op.outputWeightKg !== null && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Scale className="size-3" aria-hidden /> {fmtQty(op.outputWeightKg)} kg / pc
              {op.scrapWeightKg !== null && ` · scrap ${fmtQty(op.scrapWeightKg)} kg / pc (${fmtQty(Math.round(op.scrapWeightKg * (op.receivedQty ?? 0) * 1000) / 1000)} kg)`}
            </div>
          )}
          {(doneOp || failed) && (
            <div className="text-xs text-muted-foreground">
              {[op.updatedBy?.name, fmtDateTime(op.completedAt), op.operatorName && `operator ${op.operatorName}`, op.machine, op.remarks].filter(Boolean).join(' · ')}
            </div>
          )}
          {!doneOp && !failed && current && !op.canRecord && op.lockedReason && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3" aria-hidden /> {op.lockedReason}
            </div>
          )}
        </div>
      </div>
      {op.canRecord && (
        <div className="flex shrink-0 gap-1 sm:justify-end">
          {(doneOp || failed) && (
            <Button variant="ghost" size="sm" onClick={onClear} aria-label={`Clear ${s.name}`}>
              <Eraser />
            </Button>
          )}
          <Button size="sm" variant={doneOp ? 'outline' : 'default'} onClick={onRecord}>
            {doneOp || failed ? <Pencil /> : null}
            {doneOp ? 'Change' : failed ? 'Record again' : 'Record'}
          </Button>
        </div>
      )}
    </li>
  );
}

function EditPlan({ rc, onDone }: { rc: RouteCard; onDone: () => void }) {
  const stages = useApiQuery<{ id: number; code: string; name: string; isActive: boolean; type: RouteCard['operations'][number]['stage']['type']; captureWeights: boolean; requiresReport: boolean; isMaterialCheck: boolean; roles: { id: number; name: string }[] }[]>(
    '/process-stages',
  );
  const lookups = useLookups('rawMaterials');
  if (!stages.data) return <Skeleton className="h-96" />;
  const active = stages.data.filter((s) => s.isActive).map((s) => ({ ...s, roles: s.roles.map((r) => ({ role: r })) }));
  return (
    <RouteCardEditor
      orderQty={rc.plannedQty}
      stages={active}
      rawMaterials={lookups.data?.rawMaterials}
      initial={{
        rcDate: toInputDate(rc.rcDate),
        rawMaterialId: (rc.rawMaterialId ?? '') as unknown as number,
        inputWeightKg: rc.inputWeightKg ?? '',
        extraQty: rc.extraQty,
        expectedDelivery: toInputDate(rc.expectedDelivery),
        remarks: rc.remarks ?? '',
        stageIds: rc.operations.map((o) => o.stage.id),
      }}
      submit={async (values: RouteCardFieldsInput) => {
        await api(`/route-cards/${rc.id}`, { method: 'PUT', body: values });
        toast.success('Plan saved');
        onDone();
      }}
      submitLabel="Save plan"
      footer={
        <Button type="button" variant="outline" onClick={onDone}>
          Close
        </Button>
      }
    />
  );
}
