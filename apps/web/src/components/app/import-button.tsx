'use client';

import Link from 'next/link';
import { FileSpreadsheet } from 'lucide-react';
import { IMPORT_TYPE_INFO, type ImportType } from '@bht/shared';
import { Button } from '@/components/ui/button';
import { useSession } from './session';

/** "Import from Excel" on a list page: opens Masters → Import from Excel with this kind chosen (the first one the user may import). */
export function ImportButton({ type, label = 'Import from Excel' }: { type: ImportType | ImportType[]; label?: string }) {
  const { can } = useSession();
  const first = (Array.isArray(type) ? type : [type]).find((t) => IMPORT_TYPE_INFO[t].permissions.every(can));
  if (!first) return null;
  return (
    <Button asChild variant="outline">
      <Link href={`/masters/import?type=${first}`}>
        <FileSpreadsheet /> {label}
      </Link>
    </Button>
  );
}
