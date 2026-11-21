'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { GrnList } from '@/components/store/grn-list';

export default function GateEntryPage() {
  const { can } = useSession();
  return (
    <RequirePermission permission="goods_receipts.view">
      <PageHeader
        title="Gate entry"
        description="Material arriving at the factory. QC inspects it before it goes into the store."
        actions={
          can('goods_receipts.create') && (
            <Button asChild>
              <Link href="/store/gate-entry/new">
                <Plus /> New gate entry
              </Link>
            </Button>
          )
        }
      />
      <GrnList />
    </RequirePermission>
  );
}
