'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Clock, Inbox } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtQty } from '@/lib/format';
import { showApiError, usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { CompletionRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge } from '@/components/ui/primitives';
import { DataTable } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

const TABS: { label: string; status?: string }[] = [
  { label: 'To put in FG store', status: 'PENDING' },
  { label: 'In FG stock', status: 'MOVED_TO_STOCK' },
  { label: 'All', status: 'ALL' },
];

export default function RcCompletionPage() {
  return (
    <RequirePermission permission={['rc_completions.view', 'route_cards.view']}>
      <RcCompletions />
    </RequirePermission>
  );
}

function RcCompletions() {
  const { can } = useSession();
  const params = useListParams({ filters: { status: 'PENDING' } });
  const query = { ...params.query, status: params.filters.status === 'ALL' ? undefined : params.filters.status };
  const { data, isFetching } = usePaged<CompletionRow>('/rc-completions', query);
  const [moving, setMoving] = useState<CompletionRow | null>(null);

  const columns = useMemo<ColumnDef<CompletionRow>[]>(
    () => [
      {
        header: 'Slip',
        accessorKey: 'slipNo',
        meta: { sortKey: 'slipNo' },
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-[13px] font-semibold whitespace-nowrap">{row.original.slipNo}</div>
            <div className="text-xs text-muted-foreground">{fmtDate(row.original.createdAt)}</div>
          </div>
        ),
      },
      {
        header: 'Part',
        id: 'item',
        cell: ({ row }) => (
          <div className="min-w-48">
            <div className="font-medium">{row.original.routeCard.item.name}</div>
            <Link href={`/production/route-cards/${row.original.routeCard.id}`} className="font-mono text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.original.routeCard.rcNo}
            </Link>
          </div>
        ),
      },
      {
        header: 'For',
        id: 'for',
        cell: ({ row }) => {
          const so = row.original.routeCard.salesOrderLine?.salesOrder;
          return so ? (
            <div>
              <span className="font-mono text-[13px]">{so.soNo}</span>
              <div className="max-w-44 truncate text-xs text-muted-foreground">{so.customer.name}</div>
            </div>
          ) : (
            <Badge variant="secondary">Make to stock</Badge>
          );
        },
      },
      { header: 'OK pieces', accessorKey: 'okQty', meta: { sortKey: 'okQty', align: 'right' }, cell: ({ getValue }) => <span className="font-semibold">{fmtQty(getValue<number>())}</span> },
      {
        header: 'Heats',
        id: 'heats',
        cell: ({ row }) => {
          const r = row.original;
          const list = r.status === 'MOVED_TO_STOCK' ? r.heats.map((h) => `${h.heat.heatNo}: ${fmtQty(h.quantity)}`) : r.issuedHeats.map((h) => h.heatNo);
          return <span className="font-mono text-[13px]">{list.join(', ') || '—'}</span>;
        },
      },
      {
        header: 'Status',
        accessorKey: 'status',
        meta: { sortKey: 'status' },
        cell: ({ row }) =>
          row.original.status === 'PENDING' ? (
            <Badge variant="warning">
              <Clock aria-hidden /> Waiting
            </Badge>
          ) : (
            <Badge variant="success" title={`${row.original.movedBy?.name ?? ''} · ${fmtDate(row.original.movedAt)}`}>
              <CheckCircle2 aria-hidden /> In FG stock
            </Badge>
          ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.status === 'PENDING' && can('rc_completions.create') ? (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" onClick={() => setMoving(row.original)}>
                <Inbox /> Put in FG store
              </Button>
            </div>
          ) : null,
      },
    ],
    [can],
  );

  return (
    <>
      <PageHeader title="Finished parts in" description="Pieces that passed the last stage of a route card. Put them in the FG store under the heats they were made from." />
      <div className="mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-full glass p-1" role="tablist" aria-label="Status">
        {TABS.map((t) => {
          const active = params.filters.status === t.status;
          return (
            <button
              key={t.label}
              role="tab"
              aria-selected={active}
              onClick={() => params.set({ status: t.status })}
              className={cn('h-8 rounded-full px-4 text-[13px] font-semibold text-muted-foreground transition-colors', active ? 'bg-ink text-ink-foreground' : 'hover:text-foreground')}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search slip, route card, part…"
        onRowClick={(r) => r.status === 'PENDING' && can('rc_completions.create') && setMoving(r)}
        empty={{ title: params.filters.status === 'PENDING' ? 'Nothing waiting' : 'No completion slips', description: 'A slip is made when the last stage of a route card is recorded.' }}
      />
      {moving && <MoveDialog slip={moving} onClose={() => setMoving(null)} />}
    </>
  );
}

/** Default split: by the kg of each heat on the card, whole pieces, remainder to the biggest heat. */
function defaultSplit(slip: CompletionRow): Record<number, string> {
  const heats = slip.issuedHeats;
  if (heats.length === 1) return { [heats[0].heatId]: String(slip.okQty) };
  const kg = heats.reduce((s, h) => s + h.quantity, 0);
  const out: Record<number, number> = {};
  let given = 0;
  for (const h of heats) {
    out[h.heatId] = Math.floor((slip.okQty * h.quantity) / kg);
    given += out[h.heatId];
  }
  const biggest = [...heats].sort((a, b) => b.quantity - a.quantity)[0];
  if (biggest) out[biggest.heatId] += slip.okQty - given;
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, String(v)]));
}

function MoveDialog({ slip, onClose }: { slip: CompletionRow; onClose: () => void }) {
  const [qty, setQty] = useState<Record<number, string>>(() => defaultSplit(slip));
  const total = Object.values(qty).reduce((s, v) => s + (Number(v) || 0), 0);
  const move = useMutation({
    mutationFn: () =>
      api(`/rc-completions/${slip.id}/move`, {
        method: 'POST',
        body: { heats: Object.entries(qty).map(([heatId, v]) => ({ heatId: Number(heatId), quantity: Number(v) || 0 })) },
      }),
    onSuccess: () => {
      toast.success(`${fmtQty(total)} × ${slip.routeCard.item.name} in FG stock`);
      onClose();
    },
    onError: (err) => showApiError(err),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Put in FG store</DialogTitle>
          <DialogDescription>
            {slip.slipNo} · {slip.routeCard.rcNo} · {slip.routeCard.item.name}: <b>{fmtQty(slip.okQty)} OK pieces</b>. Split them over the heats they were made from.
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y rounded-lg border">
          {slip.issuedHeats.map((h) => (
            <div key={h.heatId} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono font-semibold">{h.heatNo}</div>
                <div className="text-xs text-muted-foreground">
                  {h.millHeatNo ? `mill ${h.millHeatNo} · ` : ''}
                  {fmtQty(h.quantity)} kg used on the card
                </div>
              </div>
              <Input
                type="number"
                min={0}
                step={1}
                value={qty[h.heatId] ?? ''}
                onChange={(e) => setQty({ ...qty, [h.heatId]: e.target.value })}
                className="h-9 w-28 text-right"
                aria-label={`Pieces from heat ${h.heatNo}`}
              />
              <span className="w-8 text-xs text-muted-foreground">pcs</span>
            </div>
          ))}
        </div>
        <DialogFooter className="items-center pt-2">
          <span className={cn('mr-auto text-sm', total !== slip.okQty ? 'font-medium text-destructive' : 'text-success')}>
            {fmtQty(total)} of {fmtQty(slip.okQty)} pcs
          </span>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => move.mutate()} loading={move.isPending} disabled={total !== slip.okQty}>
            Put in FG store
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
