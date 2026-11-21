'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, PackageCheck } from 'lucide-react';
import { useLookups } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { InvoiceEditor } from '@/components/billing/invoice-editor';

export default function NewInvoicePage() {
  return (
    <RequirePermission permission="invoices.create">
      <Suspense>
        <NewInvoice />
      </Suspense>
    </RequirePermission>
  );
}

function NewInvoice() {
  const { can } = useSession();
  const lookups = useLookups('companies', 'customers', 'saleItems');
  // /billing/invoices/new?customerId=4 starts with that customer (Ask ERP "create invoice for …")
  const customerId = Number(useSearchParams().get('customerId')) || undefined;

  return (
    <>
      <PageHeader
        title="New invoice"
        description="Fill it in like the printed invoice. Save it as a draft, or save and issue it at once."
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link href="/billing/invoices">
                <ArrowLeft /> All invoices
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dispatch/packing?status=PACKED">
                <PackageCheck /> From packed sets
              </Link>
            </Button>
          </>
        }
      />
      {!lookups.data ? (
        <Skeleton className="h-[640px] rounded-lg" />
      ) : lookups.data.companies.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Add our company first (Admin → Companies).</p>
      ) : (
        <InvoiceEditor
          companies={lookups.data.companies}
          customers={lookups.data.customers}
          saleItems={lookups.data.saleItems}
          canIssue={can('invoices.approve')}
          initialCustomerId={lookups.data.customers.some((c) => c.value === customerId) ? customerId : undefined}
          footer={() => (
            <Button type="button" variant="ghost" asChild>
              <Link href="/billing/invoices">Cancel</Link>
            </Button>
          )}
        />
      )}
    </>
  );
}
