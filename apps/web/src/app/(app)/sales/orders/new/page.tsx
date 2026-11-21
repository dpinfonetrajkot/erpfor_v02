'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLookups } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { initialSoValues, SoEditor } from '@/components/sales/so-editor';

export default function NewSalesOrderPage() {
  return (
    <RequirePermission permission="sales_orders.create">
      <NewSalesOrder />
    </RequirePermission>
  );
}

function NewSalesOrder() {
  const { user } = useSession();
  const lookups = useLookups('customers', 'products', 'materialGrades', 'users');
  return (
    <>
      <PageHeader
        title="New sales order"
        description="Saved as a draft. Send it for approval when it is complete."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/sales/orders">
              <ArrowLeft /> All orders
            </Link>
          </Button>
        }
      />
      {lookups.data ? <SoEditor so={null} lookups={lookups.data} initial={initialSoValues(null, user.id)} /> : <Skeleton className="h-96" />}
    </>
  );
}
