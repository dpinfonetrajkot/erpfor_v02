'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useApiQuery, useLookups } from '@/hooks/use-api';
import { toInputDate } from '@/lib/format';
import type { JwoDefaults } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { createJobWork, JobWorkEditor } from '@/components/jobwork/jwo-editor';

export default function NewJobWorkPage() {
  return (
    <RequirePermission permission="job_work_orders.create">
      <NewJobWork />
    </RequirePermission>
  );
}

function NewJobWork() {
  const router = useRouter();
  const salesOrderId = Number(useSearchParams().get('salesOrderId')) || undefined;
  const lookups = useLookups('suppliers', 'items', 'rawMaterials');
  const defaults = useApiQuery<JwoDefaults>('/job-work-orders/defaults', { salesOrderId }, !!salesOrderId);
  const d = defaults.data;
  const ready = lookups.data && (!salesOrderId || d);
  const today = new Date().toISOString().slice(0, 10);
  const lines = d?.lines.filter((l) => l.quantity > 0) ?? [];

  return (
    <>
      <PageHeader
        title="New job work order"
        description={
          salesOrderId
            ? 'Filled in from the outsourced products of the sales order: what is still short after stock and earlier job work.'
            : 'Parts made by a vendor for stock.'
        }
        actions={
          <Button variant="ghost" asChild>
            <Link href="/job-work/orders">
              <ArrowLeft /> All job work orders
            </Link>
          </Button>
        }
      />
      {!ready ? (
        <Skeleton className="h-96" />
      ) : salesOrderId && d && !lines.length ? (
        <p className="rounded-lg border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing is short on the outsourced products of {d.salesOrder.soNo}: it is in stock or already with vendors.
        </p>
      ) : (
        <JobWorkEditor
          lookups={lookups.data!}
          soLabel={d ? `${d.salesOrder.soNo} · ${d.salesOrder.customer.name}` : null}
          itemLabels={Object.fromEntries(lines.map((l) => [l.itemId, l.item.name]))}
          initial={{
            jwoDate: today,
            supplierId: '' as unknown as number,
            salesOrderId: d?.salesOrder.id ?? '',
            challanNo: '',
            expectedDate: toInputDate(d?.salesOrder.expectedDelivery),
            remarks: '',
            lines: lines.length
              ? lines.map((l) => ({ itemId: l.itemId, salesOrderLineId: l.salesOrderLineId, quantity: l.quantity, rate: 0, remarks: '' }))
              : [{ itemId: '' as unknown as number, salesOrderLineId: '', quantity: '', rate: 0, remarks: '' }],
            materials: d?.materials.map((m) => ({ rawMaterialId: m.rawMaterialId, quantity: m.quantity })) ?? [],
          }}
          submit={async (values) => {
            const r = await createJobWork(values);
            router.replace(`/job-work/orders/${r.id}`);
          }}
          submitLabel="Make job work order"
        />
      )}
    </>
  );
}
