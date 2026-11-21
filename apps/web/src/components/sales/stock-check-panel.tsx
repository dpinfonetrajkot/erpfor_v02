'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Factory, Handshake, PackageCheck, Send } from 'lucide-react';
import type { SoProductionRequestInput } from '@bht/shared';
import { api } from '@/lib/api';
import { fmtQty, toInputDate } from '@/lib/format';
import { showApiError, useApiQuery } from '@/hooks/use-api';
import type { SalesOrder, StockCheck } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Skeleton } from '@/components/ui/primitives';
import { RequestStatusBadge } from '@/components/app/status';
import { useSession } from '@/components/app/session';

/**
 * For every product of an approved order: parts needed (BOM), finished stock,
 * what production already makes, and the shortage to request.
 */
export function StockCheckPanel({ so }: { so: SalesOrder }) {
  const { can } = useSession();
  const { data, isLoading } = useApiQuery<StockCheck>(`/sales-orders/${so.id}/stock-check`);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [requiredBy, setRequiredBy] = useState(toInputDate(so.expectedDelivery));
  const [remarks, setRemarks] = useState('');
  const canRequest = can('stock_check.create') && (so.status === 'APPROVED' || so.status === 'IN_PRODUCTION');

  const key = (lineId: number, itemId: number) => `${lineId}:${itemId}`;
  const valueOf = (lineId: number, itemId: number, shortage: number) => qty[key(lineId, itemId)] ?? (shortage > 0 ? String(shortage) : '');

  const toRequest: SoProductionRequestInput['lines'] = (data?.lines ?? []).flatMap((l) =>
    l.decision !== 'INHOUSE'
      ? []
      : l.parts
          .filter((p) => p.item && Number(valueOf(l.lineId, p.item.id, p.shortage)) > 0)
          .map((p) => ({ salesOrderLineId: l.lineId, itemId: p.item!.id, quantity: Number(valueOf(l.lineId, p.item!.id, p.shortage)) })),
  );

  const send = useMutation({
    mutationFn: () =>
      api<{ created: string[] }>(`/sales-orders/${so.id}/production-requests`, {
        method: 'POST',
        body: { requiredBy, remarks, lines: toRequest },
      }),
    onSuccess: (r) => {
      toast.success(`${r.created.length} production request(s) sent`, { description: r.created.slice(0, 4).join('\n') });
      setQty({});
      setRemarks('');
    },
    onError: (err) => showApiError(err),
  });

  const requests = so.lines.flatMap((l) => l.productionRequests.map((r) => ({ ...r, product: l.product.name })));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Factory className="size-4 text-primary" /> Stock check
        </CardTitle>
        <CardDescription>Finished parts in the FG store are shared by all orders. Ask production (in-house) or a job-work vendor (outsourced) only for what is short.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading || !data ? (
          <Skeleton className="h-40" />
        ) : (
          data.lines.map((line) => (
            <div key={line.lineId} className="overflow-hidden rounded-lg border">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-4 py-2.5">
                <span className="font-medium">{line.product.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[line.endConnection !== 'NONE' && line.endConnection, line.service].filter(Boolean).join(' · ')} · {fmtQty(line.quantity)} sets
                </span>
                {line.decision === 'OUTSOURCE' ? (
                  <Badge variant="secondary">Outsource</Badge>
                ) : (
                  <Badge variant="info">In-house</Badge>
                )}
                <span className={cn('ml-auto flex items-center gap-1 text-xs', line.setsFromStock > 0 ? 'text-success' : 'text-muted-foreground')}>
                  <PackageCheck className="size-3.5" aria-hidden /> {fmtQty(line.setsFromStock)} set(s) can be assembled from stock now
                </span>
              </div>
              {line.decision === 'OUTSOURCE' ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead className="text-xs text-muted-foreground uppercase">
                      <tr className="border-b">
                        <th className="px-4 py-2 text-left">Part / item</th>
                        <th className="px-3 py-2 text-right">Needed</th>
                        <th className="px-3 py-2 text-right">In FG stock</th>
                        <th className="px-3 py-2 text-right">With vendor</th>
                        <th className="px-4 py-2 text-right">Short</th>
                      </tr>
                    </thead>
                    <tbody>
                      {line.parts.map((p) => (
                        <tr key={p.partTypeId} className="border-b last:border-0">
                          <td className="px-4 py-2">
                            <div className="font-medium">{p.partName}</div>
                            {p.item && (
                              <div className="text-xs text-muted-foreground">
                                <span className="font-mono">{p.item.code}</span> · {p.item.name}
                              </div>
                            )}
                          </td>
                          <td className="tabular px-3 py-2 text-right">{fmtQty(p.needed)}</td>
                          <td className="tabular px-3 py-2 text-right">{fmtQty(p.inStock)}</td>
                          <td className="tabular px-3 py-2 text-right">{fmtQty(p.withVendor)}</td>
                          <td className="tabular px-4 py-2 text-right">
                            {p.shortage > 0 ? <span className="font-semibold text-destructive">{fmtQty(p.shortage)}</span> : <span className="text-success">0</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-[13px]">
                    {so.lines
                      .find((l) => l.id === line.lineId)
                      ?.jobWorkLines.filter((j, i, all) => j.jobWorkOrder.status !== 'CANCELLED' && all.findIndex((x) => x.jobWorkOrder.id === j.jobWorkOrder.id) === i)
                      .map((j) => (
                        <Link key={j.jobWorkOrder.id} href={`/job-work/orders/${j.jobWorkOrder.id}`} className="font-mono text-primary hover:underline">
                          {j.jobWorkOrder.jwoNo}
                        </Link>
                      ))}
                    {can('job_work_orders.create') && line.parts.some((p) => p.shortage > 0) && (so.status === 'APPROVED' || so.status === 'IN_PRODUCTION') && (
                      <Button size="sm" variant="outline" className="ml-auto" asChild>
                        <Link href={`/job-work/orders/new?salesOrderId=${so.id}`}>
                          <Handshake /> Make job work order
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="text-xs text-muted-foreground uppercase">
                      <tr className="border-b">
                        <th className="px-4 py-2 text-left">Part / item</th>
                        <th className="px-3 py-2 text-right">Needed</th>
                        <th className="px-3 py-2 text-right">In FG stock</th>
                        <th className="px-3 py-2 text-right">With production</th>
                        <th className="px-3 py-2 text-right">Short</th>
                        {canRequest && <th className="w-36 px-4 py-2 text-right">Request now</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {line.parts.map((p) => (
                        <tr key={p.partTypeId} className="border-b last:border-0">
                          <td className="px-4 py-2">
                            <div className="font-medium">
                              {p.partName}
                              {p.perSet !== 1 && <span className="text-xs text-muted-foreground"> ×{p.perSet} per set</span>}
                            </div>
                            {p.item ? (
                              <div className="text-xs text-muted-foreground">
                                <span className="font-mono">{p.item.code}</span> · {p.item.name}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-xs text-warning">
                                <AlertTriangle className="size-3" /> Item missing -{' '}
                                <Link href="/masters/products" className="underline">
                                  generate items
                                </Link>
                              </div>
                            )}
                          </td>
                          <td className="tabular px-3 py-2 text-right">{fmtQty(p.needed)}</td>
                          <td className="tabular px-3 py-2 text-right">{fmtQty(p.inStock)}</td>
                          <td className="tabular px-3 py-2 text-right">{fmtQty(p.requested)}</td>
                          <td className="tabular px-3 py-2 text-right">
                            {p.shortage > 0 ? (
                              <span className="font-semibold text-destructive">{fmtQty(p.shortage)}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-success">
                                <CheckCircle2 className="size-3.5" aria-hidden /> 0
                              </span>
                            )}
                          </td>
                          {canRequest && (
                            <td className="px-4 py-1.5">
                              {p.item && (
                                <Input
                                  type="number"
                                  min={0}
                                  value={valueOf(line.lineId, p.item.id, p.shortage)}
                                  onChange={(e) => setQty({ ...qty, [key(line.lineId, p.item!.id)]: e.target.value })}
                                  className="ml-auto h-8 w-28 text-right"
                                  aria-label={`Request ${p.partName}`}
                                />
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))
        )}

        {canRequest && (
          <div className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/40 p-3">
            <label className="space-y-1.5">
              <Label>Needed by</Label>
              <Input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} className="w-44" />
            </label>
            <label className="min-w-56 flex-1 space-y-1.5">
              <Label>Note to production</Label>
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Priority, special instructions…" />
            </label>
            <Button onClick={() => send.mutate()} loading={send.isPending} disabled={toRequest.length === 0}>
              <Send /> Send {toRequest.length || ''} request(s) to production
            </Button>
          </div>
        )}

        {requests.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between text-sm font-medium">
              Production requests for this order
              <Link href={`/production/requests?salesOrderId=${so.id}`} className="text-xs font-normal text-primary hover:underline">
                Open list
              </Link>
            </div>
            <ul className="divide-y rounded-lg border text-sm">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="font-mono text-[13px] font-medium">{r.requestNo}</span>
                  <span className="flex-1 text-muted-foreground">
                    {fmtQty(r.quantity)} pcs · {r.product}
                  </span>
                  <RequestStatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
