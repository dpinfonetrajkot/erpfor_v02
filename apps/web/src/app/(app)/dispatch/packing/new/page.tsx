'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { END_CONNECTION_LABELS, PACKING_TYPES } from '@bht/shared';
import { api } from '@/lib/api';
import { fmtQty } from '@/lib/format';
import { showApiError, useApiQuery } from '@/hooks/use-api';
import type { PackPlan } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { Field, FormGrid } from '@/components/app/form';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';

type Line = PackPlan['lines'][number];
type Part = Line['parts'][number];
/** "lineId:itemId:heatId|0" -> pieces */
type Alloc = Record<string, string>;

const key = (lineId: number, itemId: number, heatId: number | null) => `${lineId}:${itemId}:${heatId ?? 0}`;

/** Oldest heats first, up to what this part needs; other lines may already use some of a heat. */
function fifo(line: Line, sets: number, alloc: Alloc): Alloc {
  const next: Alloc = Object.fromEntries(Object.entries(alloc).filter(([k]) => !k.startsWith(`${line.lineId}:`)));
  for (const part of line.parts) {
    if (!part.item) continue;
    let need = sets * part.perSet;
    for (const h of part.heats) {
      if (need <= 0) break;
      const usedElsewhere = Object.entries(next)
        .filter(([k]) => k.endsWith(`:${part.item!.id}:${h.heatId ?? 0}`))
        .reduce((s, [, v]) => s + (Number(v) || 0), 0);
      const take = Math.min(need, h.quantity - usedElsewhere);
      if (take > 0) {
        next[key(line.lineId, part.item.id, h.heatId)] = String(take);
        need -= take;
      }
    }
  }
  return next;
}

export default function PackPage() {
  return (
    <RequirePermission permission="assemblies.create">
      <Pack />
    </RequirePermission>
  );
}

function Pack() {
  const router = useRouter();
  const salesOrderId = Number(useSearchParams().get('salesOrderId')) || undefined;
  const { data: plan, isLoading } = useApiQuery<PackPlan>('/assemblies/plan', { salesOrderId }, !!salesOrderId);
  const [sets, setSets] = useState<Record<number, string>>({});
  const [alloc, setAlloc] = useState<Alloc>({});
  const [head, setHead] = useState({ assemblyDate: new Date().toISOString().slice(0, 10), packingType: 'Wooden box', packedBy: '', packages: '', grossWeightKg: '', remarks: '' });

  // Start with what can be packed now, oldest heats first.
  useEffect(() => {
    if (!plan) return;
    let a: Alloc = {};
    const s: Record<number, string> = {};
    for (const l of plan.lines) {
      s[l.lineId] = l.canPack ? String(l.canPack) : '';
      if (l.canPack) a = fifo(l, l.canPack, a);
    }
    setSets(s);
    setAlloc(a);
  }, [plan]);

  const changeSets = (line: Line, value: string) => {
    setSets({ ...sets, [line.lineId]: value });
    setAlloc(fifo(line, Math.max(0, Math.floor(Number(value) || 0)), alloc));
  };

  const partTotal = (line: Line, part: Part) =>
    part.heats.reduce((s, h) => s + (Number(alloc[key(line.lineId, part.item!.id, h.heatId)]) || 0), 0);
  const chosen = (plan?.lines ?? []).filter((l) => Number(sets[l.lineId]) > 0);
  const problems = chosen.flatMap((l) =>
    l.parts.filter((p) => !p.item || partTotal(l, p) !== Number(sets[l.lineId]) * p.perSet).map((p) => `${l.product.name}: ${p.partName}`),
  );

  const save = useMutation({
    mutationFn: () =>
      api<{ id: number; assemblyNo: string }>('/assemblies', {
        method: 'POST',
        body: {
          salesOrderId,
          ...head,
          lines: chosen.map((l) => ({
            salesOrderLineId: l.lineId,
            quantity: Number(sets[l.lineId]),
            parts: l.parts.map((p) => ({
              itemId: p.item!.id,
              heats: p.heats
                .map((h) => ({ heatId: h.heatId ?? '', quantity: Number(alloc[key(l.lineId, p.item!.id, h.heatId)]) || 0 }))
                .filter((h) => h.quantity > 0),
            })),
          })),
        },
      }),
    onSuccess: (r) => {
      toast.success(`${r.assemblyNo} packed; parts taken out of the FG store`);
      router.replace(`/dispatch/packing/${r.id}`);
    },
    onError: (err) => showApiError(err),
  });

  if (!salesOrderId) return <p className="py-20 text-center text-sm text-muted-foreground">Open a sales order and choose Pack sets.</p>;
  if (isLoading || !plan) return <Skeleton className="h-96" />;

  return (
    <>
      <PageHeader
        title={`Pack sets · ${plan.salesOrder.soNo}`}
        description={`${plan.salesOrder.customer.name}${plan.salesOrder.customerPoNo ? ` · PO ${plan.salesOrder.customerPoNo}` : ''}. Parts are taken out of the FG store by heat (oldest first) and assembled into sets.`}
        actions={
          <Button variant="ghost" asChild>
            <Link href={`/sales/orders/${plan.salesOrder.id}`}>
              <ArrowLeft /> Back to order
            </Link>
          </Button>
        }
      />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Packing</CardTitle>
          </CardHeader>
          <CardContent>
            <FormGrid className="lg:grid-cols-3">
              <Field label="Date" required>
                <Input type="date" value={head.assemblyDate} onChange={(e) => setHead({ ...head, assemblyDate: e.target.value })} />
              </Field>
              <Field label="Packing">
                <NativeSelect value={head.packingType} onChange={(e) => setHead({ ...head, packingType: e.target.value })}>
                  {PACKING_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Packed by">
                <Input value={head.packedBy} onChange={(e) => setHead({ ...head, packedBy: e.target.value })} />
              </Field>
              <Field label="Packages (boxes)">
                <Input type="number" min={0} value={head.packages} onChange={(e) => setHead({ ...head, packages: e.target.value })} />
              </Field>
              <Field label="Gross weight (kg)">
                <Input type="number" min={0} step="0.1" value={head.grossWeightKg} onChange={(e) => setHead({ ...head, grossWeightKg: e.target.value })} />
              </Field>
              <Field label="Note">
                <Input value={head.remarks} onChange={(e) => setHead({ ...head, remarks: e.target.value })} placeholder="e.g. colour code red" />
              </Field>
            </FormGrid>
          </CardContent>
        </Card>

        {plan.lines.map((l) => {
          const n = Number(sets[l.lineId]) || 0;
          return (
            <Card key={l.lineId} className={cn(l.remaining === 0 && 'opacity-60')}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>
                    {l.product.name}
                    {l.endConnection !== 'NONE' && <span className="font-normal text-muted-foreground"> · {END_CONNECTION_LABELS[l.endConnection]}</span>}
                  </CardTitle>
                  <CardDescription>
                    Ordered {fmtQty(l.ordered)} · packed {fmtQty(l.packed)} · left {fmtQty(l.remaining)} · <b>{fmtQty(l.canPack)}</b> can be packed from stock now
                  </CardDescription>
                </div>
                <Field label="Sets to pack" className="w-36">
                  <Input
                    type="number"
                    min={0}
                    max={l.remaining}
                    step={1}
                    value={sets[l.lineId] ?? ''}
                    onChange={(e) => changeSets(l, e.target.value)}
                    disabled={l.remaining === 0}
                    aria-label={`Sets to pack ${l.product.name}`}
                    className="text-right"
                  />
                </Field>
              </CardHeader>
              {n > 0 && (
                <CardContent className="grid gap-3 pt-3 md:grid-cols-3">
                  {l.parts.map((p) => {
                    const need = n * p.perSet;
                    const got = p.item ? partTotal(l, p) : 0;
                    return (
                      <div key={p.partName} className="rounded-lg border">
                        <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm">
                          <span className="font-medium">{p.partName}</span>
                          <span className={cn('tabular text-xs', got === need ? 'text-success' : 'font-semibold text-destructive')}>
                            {got === need && <CheckCircle2 className="mr-1 inline size-3.5" aria-hidden />}
                            {fmtQty(got)} / {fmtQty(need)} pcs
                          </span>
                        </div>
                        {!p.item ? (
                          <p className="px-3 py-2 text-xs text-destructive">Item missing - generate the items of this product.</p>
                        ) : p.heats.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-destructive">None in the FG store.</p>
                        ) : (
                          <ul className="divide-y text-sm">
                            {p.heats.map((h) => (
                              <li key={h.heatId ?? 0} className="flex items-center gap-2 px-3 py-1.5">
                                <span className="font-mono text-[13px]">{h.heatNo ?? 'No heat'}</span>
                                <span className="tabular flex-1 text-xs text-muted-foreground">{fmtQty(h.quantity)} in store</span>
                                <Input
                                  type="number"
                                  min={0}
                                  max={h.quantity}
                                  step={1}
                                  value={alloc[key(l.lineId, p.item!.id, h.heatId)] ?? ''}
                                  onChange={(e) => setAlloc({ ...alloc, [key(l.lineId, p.item!.id, h.heatId)]: e.target.value })}
                                  className="h-8 w-20 text-right"
                                  aria-label={`${p.partName} from ${h.heatNo ?? 'no heat'}`}
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              )}
            </Card>
          );
        })}

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
          {problems.length > 0 && <span className="mr-auto text-sm text-destructive">Heats do not add up: {problems.join(', ')}</span>}
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!chosen.length || problems.length > 0}>
            Pack {fmtQty(chosen.reduce((s, l) => s + Number(sets[l.lineId]), 0))} set(s)
          </Button>
        </div>
      </div>
    </>
  );
}
