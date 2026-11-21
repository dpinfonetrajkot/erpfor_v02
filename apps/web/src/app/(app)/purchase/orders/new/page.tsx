'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { Paginated } from '@bht/shared';
import { useApiQuery, useLookups } from '@/hooks/use-api';
import type { PurchaseRequisition } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { initialPoValues, PoEditor } from '@/components/purchase/po-editor';

export default function NewPurchaseOrderPage() {
  return (
    <RequirePermission permission="purchase_orders.create">
      <NewPurchaseOrder />
    </RequirePermission>
  );
}

function NewPurchaseOrder() {
  const sp = useSearchParams();
  const prIds = (sp.get('prs') ?? '').split(',').map(Number).filter(Boolean);
  const lookups = useLookups('companies', 'suppliers', 'rawMaterials');
  const prs = useApiQuery<Paginated<PurchaseRequisition>>('/purchase-requisitions', { status: 'PENDING', pageSize: 500 }, prIds.length > 0);
  const ready = lookups.data && (prIds.length === 0 || prs.data);
  const chosen = (prs.data?.data ?? []).filter((p) => prIds.includes(p.id));

  return (
    <>
      <PageHeader
        title="New purchase order"
        description={chosen.length ? `From ${chosen.length} requisition(s). Choose the supplier and enter rates.` : 'Saved as a draft; approve it to send to the supplier.'}
        actions={
          <Button variant="ghost" asChild>
            <Link href="/purchase/orders">
              <ArrowLeft /> All orders
            </Link>
          </Button>
        }
      />
      {ready ? (
        <PoEditor
          po={null}
          lookups={lookups.data!}
          initial={initialPoValues(lookups.data!, null, chosen)}
          prLabels={Object.fromEntries(chosen.map((p) => [p.id, p.prNo]))}
        />
      ) : (
        <Skeleton className="h-96" />
      )}
    </>
  );
}
