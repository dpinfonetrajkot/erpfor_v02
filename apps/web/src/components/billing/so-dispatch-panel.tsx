'use client';

import Link from 'next/link';
import { PackagePlus, Truck } from 'lucide-react';
import { END_CONNECTION_LABELS } from '@bht/shared';
import { fmtDate, fmtQty } from '@/lib/format';
import { useApiQuery, usePaged } from '@/hooks/use-api';
import type { AssemblyRow, OrderProgressLine, SalesOrder } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { AssemblyStatusBadge } from '@/components/app/status';
import { useSession } from '@/components/app/session';

/** On the sales order: how many sets are packed, invoiced and dispatched, and the packings made. */
export function SoDispatchPanel({ so }: { so: SalesOrder }) {
  const { can } = useSession();
  const progress = useApiQuery<OrderProgressLine[]>('/assemblies/progress', { salesOrderId: so.id });
  const packings = usePaged<AssemblyRow>('/assemblies', { salesOrderId: so.id, pageSize: 50 });
  const lines = progress.data ?? [];
  const left = lines.some((l) => l.packed < l.ordered);
  const canPack = can('assemblies.create') && left && ['APPROVED', 'IN_PRODUCTION', 'PARTIALLY_DISPATCHED'].includes(so.status);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Truck className="size-4 text-primary" /> Packing, invoices & dispatch
          </CardTitle>
          <CardDescription>Sets are packed from FG stock by heat, invoiced, then dispatched.</CardDescription>
        </div>
        {canPack && (
          <Button asChild>
            <Link href={`/dispatch/packing/new?salesOrderId=${so.id}`}>
              <PackagePlus /> Pack sets
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        {progress.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground uppercase">
                <tr className="border-b">
                  <th className="px-4 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="px-3 py-2 text-right">Packed</th>
                  <th className="px-3 py-2 text-right">Invoiced</th>
                  <th className="px-4 py-2 text-right">Dispatched</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.lineId} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      {l.product.name}
                      {l.endConnection !== 'NONE' && <span className="text-muted-foreground"> · {END_CONNECTION_LABELS[l.endConnection]}</span>}
                    </td>
                    <td className="tabular px-3 py-2 text-right">{fmtQty(l.ordered)}</td>
                    <td className={cn('tabular px-3 py-2 text-right', l.packed >= l.ordered && 'text-success')}>{fmtQty(l.packed)}</td>
                    <td className={cn('tabular px-3 py-2 text-right', l.invoiced >= l.ordered && 'text-success')}>{fmtQty(l.invoiced)}</td>
                    <td className={cn('tabular px-4 py-2 text-right font-medium', l.dispatched >= l.ordered && 'text-success')}>{fmtQty(l.dispatched)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(packings.data?.data.length ?? 0) > 0 && (
          <ul className="divide-y rounded-lg border text-sm">
            {packings.data!.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <Link href={`/dispatch/packing/${p.id}`} className="font-mono text-[13px] font-medium text-primary hover:underline">
                  {p.assemblyNo}
                </Link>
                <span className="text-muted-foreground">
                  {fmtDate(p.assemblyDate)} · {p.lines.map((l) => `${fmtQty(l.quantity)} set(s)`).join(', ')}
                </span>
                {p.invoices[0] && <span className="font-mono text-[13px]">{p.invoices[0].status === 'DRAFT' ? 'draft invoice' : p.invoices[0].invoiceNo}</span>}
                <span className="ml-auto">
                  <AssemblyStatusBadge status={p.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
