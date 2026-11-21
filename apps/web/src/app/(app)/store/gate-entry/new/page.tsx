'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { GrnForm } from '@/components/store/grn-form';

export default function NewGateEntryPage() {
  const sp = useSearchParams();
  const supplierId = Number(sp.get('supplierId')) || undefined;
  const poId = Number(sp.get('poId')) || undefined;
  return (
    <RequirePermission permission="goods_receipts.create">
      <PageHeader
        title="New gate entry"
        description="Choose the supplier and purchase order; the materials still to come are filled in."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/store/gate-entry">
              <ArrowLeft /> All gate entries
            </Link>
          </Button>
        }
      />
      <GrnForm grn={null} supplierId={supplierId} poId={poId} />
    </RequirePermission>
  );
}
