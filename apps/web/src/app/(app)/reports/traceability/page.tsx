'use client';

import Link from 'next/link';
import { ChevronRight, Flame, Search, FileSignature } from 'lucide-react';
import { TRACE_SEARCH_HINT } from '@bht/shared';
import { fmtDate } from '@/lib/format';
import { useApiQuery } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { TraceSearchResult } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { SoStatusBadge } from '@/components/app/status';

export default function TraceabilityPage() {
  return (
    <RequirePermission permission="traceability.view">
      <TraceSearch />
    </RequirePermission>
  );
}

function TraceSearch() {
  const params = useListParams();
  const q = params.search.trim();
  const { data, isFetching } = useApiQuery<TraceSearchResult>(
    '/traceability/search',
    { q },
    q.length >= 2,
  );
  const nothing = data && !data.heats.length && !data.orders.length;

  return (
    <>
      <PageHeader
        title="Traceability"
        description="Follow a heat forward to the customers who got its parts, or an order back to the mill heat and tests of every part."
      />
      <div className="relative mb-2 max-w-xl">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={params.searchInput}
          onChange={(e) => params.setSearchInput(e.target.value)}
          placeholder="Heat no., mill heat, SO, customer PO, invoice or dispatch no."
          aria-label="Trace search"
          className="h-11 pl-9 text-base"
        />
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        Type at least 2 characters: {TRACE_SEARCH_HINT}
      </p>

      {q.length < 2 ? null : !data && isFetching ? (
        <Skeleton className="h-48" />
      ) : nothing ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nothing found for &ldquo;{q}&rdquo;.
        </p>
      ) : data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flame className="size-4 text-primary" /> Heats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {data.heats.length === 0 && (
                <p className="text-sm text-muted-foreground">No heat matches.</p>
              )}
              {data.heats.map((h) => (
                <Link
                  key={h.id}
                  href={`/reports/traceability/heat/${h.id}`}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:border-primary/50 hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm font-semibold">
                      {h.heatNo}
                      {h.millHeatNo && (
                        <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">
                          mill {h.millHeatNo}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {h.grade} {h.size}
                      {h.supplier && ` · ${h.supplier}`}
                      {h.receivedDate && ` · received ${fmtDate(h.receivedDate)}`}
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSignature className="size-4 text-primary" /> Orders
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {data.orders.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No order, invoice or dispatch matches.
                </p>
              )}
              {data.orders.map((o) => (
                <Link
                  key={o.id}
                  href={`/reports/traceability/order/${o.id}`}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:border-primary/50 hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{o.soNo}</span>
                      <SoStatusBadge status={o.status} />
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {o.customer.name} · found by {o.matched}
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
