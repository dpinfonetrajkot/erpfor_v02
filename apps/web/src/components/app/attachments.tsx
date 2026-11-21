'use client';

import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { showApiError, useApiQuery } from '@/hooks/use-api';
import type { Attachment } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/primitives';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.step,.stp';

function fmtSize(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

/** Files linked to one record, e.g. the MTC of a heat. */
export function Attachments({
  entity,
  entityId,
  category,
  canEdit,
  title = 'Files',
}: {
  entity: string;
  entityId: number;
  category?: string;
  canEdit: boolean;
  title?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useApiQuery<Attachment[]>('/attachments', { entity, entityId });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api('/attachments', { method: 'POST', body, query: { entity, entityId, category } });
    },
    onSuccess: () => toast.success('File uploaded'),
    onError: (err) => showApiError(err),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => toast.success('File removed'),
    onError: (err) => showApiError(err),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          <Paperclip className="size-3.5" /> {title}
        </div>
        {canEdit && (
          <>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} loading={upload.isPending}>
              <Upload /> Upload
            </Button>
          </>
        )}
      </div>
      {isLoading ? (
        <Skeleton className="h-12" />
      ) : data?.length ? (
        <ul className="divide-y rounded-lg border">
          {data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <a href={`/api/attachments/${a.id}/download`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline">
                {a.originalName}
              </a>
              {a.category && <Badge variant="muted">{a.category}</Badge>}
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {fmtSize(a.sizeBytes)} · {fmtDate(a.createdAt)}
              </span>
              {canEdit && (
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove.mutate(a.id)} aria-label={`Remove ${a.originalName}`}>
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">No files yet. PDF, image, Word, Excel or drawing files up to 15 MB.</p>
      )}
    </div>
  );
}
