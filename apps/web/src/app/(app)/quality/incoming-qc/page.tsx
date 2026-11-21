'use client';

import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { GrnList } from '@/components/store/grn-list';

export default function IncomingQcPage() {
  return (
    <RequirePermission permission="incoming_qc.view">
      <PageHeader title="Incoming QC" description={`Gate entries waiting for inspection. Open one to accept or reject the material and give it a heat number.`} />
      <GrnList qcQueue />
    </RequirePermission>
  );
}
