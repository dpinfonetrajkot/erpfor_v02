'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { PackageOpen, Plus } from 'lucide-react';
import { useLookups, usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import { fmtDate, fmtQty } from '@/lib/format';
import type { RouteCardRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { RcStatusBadge, StageProgress } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { RC_READERS } from '@/components/production/rc-access';

const TABS: { label: string; status?: string; mine?: boolean }[] = [
  { label: 'Running', status: 'ACTIVE' },
  { label: 'Not started', status: 'OPEN' },
  { label: 'To FG store', status: 'COMPLETED' },
  { label: 'In FG stock', status: 'CLOSED' },
  { label: 'Cancelled', status: 'CANCELLED' },
  { label: 'All' },
];

export default function RouteCardsPage() {
  return (
    <RequirePermission permission={RC_READERS}>
      <RouteCards />
    </RequirePermission>
  );
}

function RouteCards() {
  const { can } = useSession();
  const router = useRouter();
  const params = useListParams();
  const lookups = useLookups('processStages');
  const { data, isFetching } = usePaged<RouteCardRow>('/route-cards', params.query);
  const today = new Date().toISOString().slice(0, 10);
  const mine = params.filters.mine === 'true';

  const columns = useMemo<ColumnDef<RouteCardRow>[]>(
    () => [
      {
        header: 'Route card',
        accessorKey: 'rcNo',
        meta: { sortKey: 'rcNo' },
        cell: ({ row }) => (
          <div>
            <Link href={`/production/route-cards/${row.original.id}`} className="font-mono text-[13px] font-semibold whitespace-nowrap hover:text-primary hover:underline">
              {row.original.rcNo}
            </Link>
            <div className="text-xs text-muted-foreground">{fmtDate(row.original.rcDate)}</div>
          </div>
        ),
      },
      {
        header: 'Part',
        id: 'item',
        cell: ({ row }) => (
          <div className="min-w-48">
            <div className="font-medium">{row.original.item.name}</div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.item.code}</div>
          </div>
        ),
      },
      {
        header: 'For',
        id: 'for',
        cell: ({ row }) => {
          const so = row.original.salesOrderLine?.salesOrder;
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
      {
        header: 'Pieces',
        accessorKey: 'plannedQty',
        meta: { sortKey: 'plannedQty', align: 'right' },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="text-right whitespace-nowrap">
              <div className="font-semibold">{fmtQty(r.plannedQty + r.extraQty)}</div>
              <div className="text-xs text-muted-foreground">
                {r.finalOkQty !== null ? `${fmtQty(r.finalOkQty)} OK` : r.rejectedQty ? `${fmtQty(r.rejectedQty)} rejected` : r.extraQty ? `${fmtQty(r.plannedQty)} + ${fmtQty(r.extraQty)}` : ''}
              </div>
            </div>
          );
        },
      },
      {
        header: 'Stage now',
        id: 'progress',
        cell: ({ row }) => {
          const r = row.original;
          const active = r.status === 'OPEN' || r.status === 'IN_PROGRESS';
          if (active && !r.materialIssued) {
            return (
              <Badge variant="warning">
                <PackageOpen aria-hidden /> Waiting for material
              </Badge>
            );
          }
          return <StageProgress done={r.stagesDone} total={r.stagesTotal} label={active ? r.currentStage?.name : r.status === 'CANCELLED' ? 'Cancelled' : 'All stages done'} />;
        },
      },
      {
        header: 'Needed by',
        accessorKey: 'expectedDelivery',
        meta: { sortKey: 'expectedDelivery' },
        cell: ({ row }) => {
          const open = row.original.status === 'OPEN' || row.original.status === 'IN_PROGRESS';
          const late = open && row.original.expectedDelivery && row.original.expectedDelivery.slice(0, 10) < today;
          return <span className={cn('whitespace-nowrap', late && 'font-medium text-destructive')}>{fmtDate(row.original.expectedDelivery)}{late && ' · late'}</span>;
        },
      },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <RcStatusBadge status={row.original.status} /> },
    ],
    [today],
  );

  return (
    <>
      <PageHeader
        title="Route cards"
        description="Each card follows one part through its stages, from bar to FG store. Departments record their stage here."
        actions={
          can('route_cards.create') && (
            <Button asChild>
              <Link href="/production/route-cards/new">
                <Plus /> New route card
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-full glass p-1" role="tablist" aria-label="Status">
        {can('route_card_operations.update') && (
          <button
            role="tab"
            aria-selected={mine}
            onClick={() => params.set({ mine: 'true', status: undefined, stageId: undefined })}
            className={cn('h-8 rounded-full px-4 text-[13px] font-semibold transition-colors', mine ? 'bg-ink text-ink-foreground' : 'text-primary/80 hover:text-primary')}
          >
            Waiting for me
          </button>
        )}
        {TABS.map((t) => {
          const active = !mine && (params.filters.status ?? undefined) === t.status;
          return (
            <button
              key={t.label}
              role="tab"
              aria-selected={active}
              onClick={() => params.set({ status: t.status, mine: undefined })}
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
        searchPlaceholder="Search card no., part, SO no.…"
        toolbar={
          <FilterSelect
            value={params.filters.stageId}
            onChange={(v) => params.set({ stageId: v, mine: undefined })}
            options={(lookups.data?.processStages ?? []).map((o) => ({ value: o.value, label: `At ${o.label}` }))}
            placeholder="Any stage"
            className="max-w-60"
          />
        }
        onRowClick={(rc) => router.push(`/production/route-cards/${rc.id}`)}
        empty={{
          title: mine ? 'Nothing waiting at your stages' : 'No route cards',
          description: mine ? 'Cards appear here when they reach a stage your department records.' : 'Route cards are made from production requests.',
        }}
      />
    </>
  );
}
