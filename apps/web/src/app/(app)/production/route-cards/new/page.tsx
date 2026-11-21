'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useApiQuery, useLookups, usePaged } from '@/hooks/use-api';
import { fmtDate, fmtQty, toInputDate } from '@/lib/format';
import type { ProductionRequestRow, RcDefaults } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { Combobox, Field } from '@/components/app/form';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { createRouteCard, RouteCardEditor } from '@/components/production/rc-editor';

export default function NewRouteCardPage() {
  return (
    <RequirePermission permission="route_cards.create">
      <NewRouteCard />
    </RequirePermission>
  );
}

function NewRouteCard() {
  const router = useRouter();
  const sp = useSearchParams();
  const requestId = Number(sp.get('requestId')) || undefined;
  const requests = usePaged<ProductionRequestRow>('/production-requests', { status: 'REQUESTED', pageSize: 200, sortBy: 'requiredBy' });
  const defaults = useApiQuery<RcDefaults>('/route-cards/defaults', { requestId }, !!requestId);
  const lookups = useLookups('rawMaterials');
  const d = defaults.data;

  const options = (requests.data?.data ?? []).map((r) => ({
    value: r.id,
    label: `${r.requestNo} · ${r.item.name} · ${fmtQty(r.quantity)} pcs${r.salesOrderLine ? ` · ${r.salesOrderLine.salesOrder.soNo}` : ' · stock'}`,
  }));

  return (
    <>
      <PageHeader
        title="New route card"
        description="Made from a production request. Production then asks the store for material and the departments record each stage."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/production/route-cards">
              <ArrowLeft /> All route cards
            </Link>
          </Button>
        }
      />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Production request</CardTitle>
            <CardDescription>What to make. Only requests without a route card are listed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Request" required>
              <Combobox
                value={requestId}
                onChange={(v) => router.replace(v ? `/production/route-cards/new?requestId=${v}` : '/production/route-cards/new')}
                options={requestId && d && !options.some((o) => o.value === requestId) ? [...options, { value: requestId, label: `${d.request.requestNo} · ${d.request.item.name}` }] : options}
                placeholder={requests.isLoading ? 'Loading…' : options.length ? 'Choose a request…' : 'No open requests'}
                clearable={false}
              />
            </Field>
            {d && (
              <dl className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Part</dt>
                  <dd className="font-medium">{d.request.item.name}</dd>
                  <dd className="font-mono text-xs text-muted-foreground">{d.request.item.code}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Quantity</dt>
                  <dd className="font-medium">{fmtQty(d.request.quantity)} pcs</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">For</dt>
                  <dd>
                    {d.request.salesOrderLine ? (
                      <>
                        <span className="font-mono">{d.request.salesOrderLine.salesOrder.soNo}</span>
                        <span className="block text-xs text-muted-foreground">{d.request.salesOrderLine.salesOrder.customer.name}</span>
                      </>
                    ) : (
                      <Badge variant="secondary">Make to stock</Badge>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Needed by</dt>
                  <dd className="font-medium">{fmtDate(d.request.requiredBy)}</dd>
                  {d.request.remarks && <dd className="text-xs text-muted-foreground">{d.request.remarks}</dd>}
                </div>
              </dl>
            )}
            {d && d.request.status !== 'REQUESTED' && (
              <p className="text-sm text-destructive" role="alert">
                {d.request.requestNo} already has a route card.
              </p>
            )}
          </CardContent>
        </Card>

        {requestId && !d && defaults.isLoading && <Skeleton className="h-96" />}
        {d && d.request.status === 'REQUESTED' && (
          <RouteCardEditor
            key={d.request.id}
            orderQty={d.request.quantity}
            stages={d.stages}
            stagesFrom={d.stagesFrom}
            rawMaterials={lookups.data?.rawMaterials}
            initial={{
              rcDate: new Date().toISOString().slice(0, 10),
              rawMaterialId: (d.rawMaterialId ?? '') as unknown as number,
              inputWeightKg: d.inputWeightKg ?? '',
              extraQty: 0,
              expectedDelivery: toInputDate(d.request.requiredBy),
              remarks: '',
              stageIds: d.stageIds,
            }}
            submit={async (values) => {
              const rc = await createRouteCard(d.request.id, values);
              router.replace(`/production/route-cards/${rc.id}`);
            }}
            submitLabel="Make route card"
          />
        )}
      </div>
    </>
  );
}
