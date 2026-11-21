'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import {
  APPROVAL_STAGE_LABELS,
  APPROVAL_STAGE_PERMISSION,
  APPROVAL_STAGES,
  type ApprovalDecisionInput,
  type ApprovalStage,
} from '@bht/shared';
import { api } from '@/lib/api';
import { fmtDateTime, fmtQty } from '@/lib/format';
import { showApiError } from '@/hooks/use-api';
import type { SalesOrder } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Card, Label } from '@/components/ui/primitives';
import { ApprovalBadge } from '@/components/app/status';
import { useSession } from '@/components/app/session';

const FIELD = { FEASIBILITY: 'feasibilityStatus', DESIGN: 'designStatus', PRODUCTION: 'productionStatus' } as const;
const HINT: Record<ApprovalStage, string> = {
  FEASIBILITY: 'Can we make it? Decide in-house or outsource for each product.',
  DESIGN: 'Drawing, dimensions and marking checked.',
  PRODUCTION: 'Capacity, material and delivery date agreed.',
};

/** Feasibility → design + production. Each stage is decided by its own role. */
export function ApprovalPanel({ so }: { so: SalesOrder }) {
  const { can } = useSession();
  const [deciding, setDeciding] = useState<{ stage: ApprovalStage; decision: 'APPROVED' | 'REJECTED' } | null>(null);

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {APPROVAL_STAGES.map((stage, i) => {
        const status = so[FIELD[stage]];
        const last = so.approvals.find((a) => a.stage === stage);
        const waitingForFeasibility = stage !== 'FEASIBILITY' && so.feasibilityStatus !== 'APPROVED';
        const canDecide = so.status === 'PENDING_APPROVAL' && can(APPROVAL_STAGE_PERMISSION[stage]) && !waitingForFeasibility;
        return (
          <Card key={stage} className={cn('flex flex-col p-4', canDecide && status === 'PENDING' && 'border-primary/50 ring-1 ring-primary/20')}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                <span className="font-medium">{APPROVAL_STAGE_LABELS[stage]}</span>
              </div>
              <ApprovalBadge status={status} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{HINT[stage]}</p>
            {last && (
              <div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs">
                <div>
                  <span className="font-medium">{last.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</span> by {last.user.name}
                </div>
                <div className="text-muted-foreground">{fmtDateTime(last.createdAt)}</div>
                {last.remarks && <div className="mt-1 italic">“{last.remarks}”</div>}
              </div>
            )}
            <div className="mt-auto pt-3">
              {canDecide ? (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setDeciding({ stage, decision: 'APPROVED' })}>
                    <Check /> {status === 'APPROVED' ? 'Approve again' : 'Approve'}
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDeciding({ stage, decision: 'REJECTED' })}>
                    <X /> Reject
                  </Button>
                </div>
              ) : so.status === 'PENDING_APPROVAL' && status === 'PENDING' ? (
                <p className="text-xs text-muted-foreground">{waitingForFeasibility ? 'Waits for feasibility.' : 'Waiting for the approver.'}</p>
              ) : null}
            </div>
          </Card>
        );
      })}
      {deciding && <DecisionDialog so={so} stage={deciding.stage} decision={deciding.decision} onClose={() => setDeciding(null)} />}
    </div>
  );
}

function DecisionDialog({
  so,
  stage,
  decision,
  onClose,
}: {
  so: SalesOrder;
  stage: ApprovalStage;
  decision: 'APPROVED' | 'REJECTED';
  onClose: () => void;
}) {
  const feasibility = stage === 'FEASIBILITY' && decision === 'APPROVED';
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<Record<number, 'INHOUSE' | 'OUTSOURCE'>>(
    Object.fromEntries(so.lines.map((l) => [l.id, l.decision === 'OUTSOURCE' ? 'OUTSOURCE' : 'INHOUSE'])),
  );
  const submit = useMutation({
    mutationFn: (body: ApprovalDecisionInput) => api<SalesOrder>(`/sales-orders/${so.id}/approvals/${stage}`, { method: 'POST', body }),
    onSuccess: (r) => {
      toast.success(
        decision === 'REJECTED'
          ? `${APPROVAL_STAGE_LABELS[stage]} rejected - order sent back to sales`
          : r.status === 'APPROVED'
            ? `${r.soNo} is fully approved - ready for stock check`
            : `${APPROVAL_STAGE_LABELS[stage]} approved`,
      );
      onClose();
    },
    onError: (err) => showApiError(err),
  });
  const reject = decision === 'REJECTED';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={feasibility ? 'max-w-2xl' : undefined}>
        <DialogHeader>
          <DialogTitle>
            {reject ? 'Reject' : 'Approve'} {APPROVAL_STAGE_LABELS[stage].toLowerCase()} · {so.soNo}
          </DialogTitle>
          <DialogDescription>
            {reject ? 'The order goes back to sales with your reason.' : feasibility ? 'Choose how each product will be made.' : HINT[stage]}
          </DialogDescription>
        </DialogHeader>
        {feasibility && (
          <div className="divide-y rounded-lg border">
            {so.lines.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{l.product.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[l.endConnection !== 'NONE' && l.endConnection, l.service, l.schedule && `Sch. ${l.schedule}`].filter(Boolean).join(' · ')} · {fmtQty(l.quantity)} sets
                  </div>
                </div>
                <NativeSelect
                  value={lines[l.id]}
                  onChange={(e) => setLines({ ...lines, [l.id]: e.target.value as 'INHOUSE' | 'OUTSOURCE' })}
                  className="w-auto"
                  aria-label={`How to make ${l.product.name}`}
                >
                  <option value="INHOUSE">In-house (production)</option>
                  <option value="OUTSOURCE">Outsource (job work)</option>
                </NativeSelect>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="decision-remarks">
            {reject ? 'Reason' : 'Remarks'}
            {reject && <span className="text-destructive">*</span>}
          </Label>
          <Textarea id="decision-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={reject ? 'Why it cannot be accepted as it is' : 'Optional'} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant={reject ? 'destructive' : 'default'}
            loading={submit.isPending}
            disabled={reject && !remarks.trim()}
            onClick={() =>
              submit.mutate({
                decision,
                remarks,
                lineDecisions: feasibility ? Object.entries(lines).map(([lineId, d]) => ({ lineId: Number(lineId), decision: d })) : undefined,
              })
            }
          >
            {reject ? 'Reject' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
