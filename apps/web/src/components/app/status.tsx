'use client';

import { Ban, CheckCircle2, CircleDashed, Clock, Cpu, FileEdit, FileText, Hourglass, Lock, Package, PackageCheck, PlayCircle, Send, ThumbsUp, Truck, Warehouse, XCircle } from 'lucide-react';
import {
  ASSEMBLY_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  JWO_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type AssemblyStatus,
  type InvoiceStatus,
  type PaymentStatus,
  MR_STATUS_LABELS,
  PO_STATUS_LABELS,
  RC_STATUS_LABELS,
  SO_STATUS_LABELS,
  type JwoStatus,
  type MrStatus,
  type PoStatus,
  type QcStatus,
  type RcStatus,
  type SoStatus,
} from '@bht/shared';
import { Badge } from '@/components/ui/primitives';

type Variant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' | 'info' | 'muted';

const PO: Record<PoStatus, { variant: Variant; icon: React.ElementType }> = {
  DRAFT: { variant: 'muted', icon: FileEdit },
  ISSUED: { variant: 'info', icon: Send },
  PARTIALLY_RECEIVED: { variant: 'warning', icon: Truck },
  RECEIVED: { variant: 'success', icon: PackageCheck },
  CLOSED: { variant: 'secondary', icon: Lock },
  CANCELLED: { variant: 'destructive', icon: Ban },
};

export function PoStatusBadge({ status }: { status: PoStatus }) {
  const s = PO[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {PO_STATUS_LABELS[status]}
    </Badge>
  );
}

const PR = {
  PENDING: { variant: 'warning', icon: Clock, label: 'Pending' },
  ORDERED: { variant: 'success', icon: CheckCircle2, label: 'Ordered' },
  CANCELLED: { variant: 'destructive', icon: Ban, label: 'Cancelled' },
} as const;

export function PrStatusBadge({ status }: { status: keyof typeof PR }) {
  const s = PR[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {s.label}
    </Badge>
  );
}

const GRN = {
  PENDING_QC: { variant: 'warning', icon: CircleDashed, label: 'Waiting for QC' },
  COMPLETED: { variant: 'success', icon: CheckCircle2, label: 'QC done' },
} as const;

export function GrnStatusBadge({ status }: { status: keyof typeof GRN }) {
  const s = GRN[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {s.label}
    </Badge>
  );
}

const QC: Record<QcStatus, { variant: Variant; icon: React.ElementType; label: string }> = {
  PENDING: { variant: 'warning', icon: CircleDashed, label: 'Pending' },
  ACCEPTED: { variant: 'success', icon: CheckCircle2, label: 'Accepted' },
  PARTIAL: { variant: 'info', icon: CheckCircle2, label: 'Part accepted' },
  REJECTED: { variant: 'destructive', icon: XCircle, label: 'Rejected' },
};

export function QcStatusBadge({ status }: { status: QcStatus }) {
  const s = QC[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {s.label}
    </Badge>
  );
}

const SO: Record<SoStatus, { variant: Variant; icon: React.ElementType }> = {
  DRAFT: { variant: 'muted', icon: FileEdit },
  PENDING_APPROVAL: { variant: 'warning', icon: Hourglass },
  APPROVED: { variant: 'info', icon: ThumbsUp },
  IN_PRODUCTION: { variant: 'default', icon: Cpu },
  PARTIALLY_DISPATCHED: { variant: 'warning', icon: Truck },
  DISPATCHED: { variant: 'success', icon: PackageCheck },
  CLOSED: { variant: 'secondary', icon: Lock },
  CANCELLED: { variant: 'destructive', icon: Ban },
};

export function SoStatusBadge({ status }: { status: SoStatus }) {
  const s = SO[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {SO_STATUS_LABELS[status]}
    </Badge>
  );
}

const APPROVAL = {
  PENDING: { variant: 'muted', icon: CircleDashed, label: 'Pending' },
  APPROVED: { variant: 'success', icon: CheckCircle2, label: 'Approved' },
  REJECTED: { variant: 'destructive', icon: XCircle, label: 'Rejected' },
} as const;

export function ApprovalBadge({ status }: { status: keyof typeof APPROVAL }) {
  const s = APPROVAL[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {s.label}
    </Badge>
  );
}

/** Three small marks F / D / P for the order list. */
export function ApprovalDots({ f, d, p }: { f: keyof typeof APPROVAL; d: keyof typeof APPROVAL; p: keyof typeof APPROVAL }) {
  const mark = (letter: string, name: string, st: keyof typeof APPROVAL) => (
    <span
      key={letter}
      title={`${name}: ${APPROVAL[st].label}`}
      className={`inline-flex size-5 items-center justify-center rounded text-[10px] font-bold ${
        st === 'APPROVED' ? 'bg-success/15 text-success' : st === 'REJECTED' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'
      }`}
    >
      {letter}
    </span>
  );
  return (
    <span className="inline-flex gap-1" aria-label={`Feasibility ${f.toLowerCase()}, design ${d.toLowerCase()}, production ${p.toLowerCase()}`}>
      {mark('F', 'Feasibility', f)}
      {mark('D', 'Design', d)}
      {mark('P', 'Production', p)}
    </span>
  );
}

const REQUEST = {
  REQUESTED: { variant: 'warning', icon: Clock, label: 'Requested' },
  ACCEPTED: { variant: 'info', icon: Cpu, label: 'Accepted' },
  REJECTED: { variant: 'destructive', icon: XCircle, label: 'Rejected' },
  CANCELLED: { variant: 'muted', icon: Ban, label: 'Cancelled' },
  COMPLETED: { variant: 'success', icon: PackageCheck, label: 'Made' },
} as const;

export function RequestStatusBadge({ status }: { status: keyof typeof REQUEST }) {
  const s = REQUEST[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {s.label}
    </Badge>
  );
}

const RC: Record<RcStatus, { variant: Variant; icon: React.ElementType }> = {
  OPEN: { variant: 'muted', icon: CircleDashed },
  IN_PROGRESS: { variant: 'info', icon: PlayCircle },
  COMPLETED: { variant: 'warning', icon: Warehouse },
  CLOSED: { variant: 'success', icon: PackageCheck },
  CANCELLED: { variant: 'destructive', icon: Ban },
};

export function RcStatusBadge({ status }: { status: RcStatus }) {
  const s = RC[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {RC_STATUS_LABELS[status]}
    </Badge>
  );
}

const MR: Record<MrStatus, { variant: Variant; icon: React.ElementType }> = {
  PENDING: { variant: 'warning', icon: Clock },
  PARTIAL: { variant: 'info', icon: Hourglass },
  ISSUED: { variant: 'success', icon: CheckCircle2 },
  CANCELLED: { variant: 'muted', icon: Ban },
};

export function MrStatusBadge({ status }: { status: MrStatus }) {
  const s = MR[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {MR_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Small progress bar: stages done out of total. */
export function StageProgress({ done, total, label }: { done: number; total: number; label?: string | null }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="min-w-36">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="truncate font-medium">{label ?? (done === total ? 'All stages done' : '—')}</span>
        <span className="tabular shrink-0 text-xs text-muted-foreground">
          {done}/{total}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${done} of ${total} stages done`}
      >
        <div className={`h-full rounded-full ${done === total ? 'bg-success' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const JWO: Record<JwoStatus, { variant: Variant; icon: React.ElementType }> = {
  OPEN: { variant: 'muted', icon: CircleDashed },
  MATERIAL_ISSUED: { variant: 'info', icon: Truck },
  PARTIALLY_RECEIVED: { variant: 'warning', icon: Hourglass },
  COMPLETED: { variant: 'success', icon: PackageCheck },
  CANCELLED: { variant: 'destructive', icon: Ban },
};

export function JwoStatusBadge({ status }: { status: JwoStatus }) {
  const s = JWO[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {JWO_STATUS_LABELS[status]}
    </Badge>
  );
}

const ASM: Record<AssemblyStatus, { variant: Variant; icon: React.ElementType }> = {
  PACKED: { variant: 'info', icon: Package },
  INVOICED: { variant: 'warning', icon: FileText },
  DISPATCHED: { variant: 'success', icon: Truck },
  CANCELLED: { variant: 'destructive', icon: Ban },
};

export function AssemblyStatusBadge({ status }: { status: AssemblyStatus }) {
  const s = ASM[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {ASSEMBLY_STATUS_LABELS[status]}
    </Badge>
  );
}

const INV: Record<InvoiceStatus, { variant: Variant; icon: React.ElementType }> = {
  DRAFT: { variant: 'muted', icon: FileEdit },
  ISSUED: { variant: 'info', icon: FileText },
  CANCELLED: { variant: 'destructive', icon: Ban },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const s = INV[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {INVOICE_STATUS_LABELS[status]}
    </Badge>
  );
}

const PAY: Record<PaymentStatus, { variant: Variant; icon: React.ElementType }> = {
  UNPAID: { variant: 'warning', icon: Clock },
  PARTIAL: { variant: 'info', icon: Hourglass },
  PAID: { variant: 'success', icon: CheckCircle2 },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const s = PAY[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden /> {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}
