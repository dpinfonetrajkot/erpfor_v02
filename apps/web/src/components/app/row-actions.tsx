'use client';

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Badge } from '@/components/ui/primitives';

/** The "⋯" menu at the end of a table row. */
export function RowActions({
  onEdit,
  onDelete,
  children,
}: {
  onEdit?: () => void;
  onDelete?: () => void;
  children?: React.ReactNode;
}) {
  if (!onEdit && !onDelete && !children) return null;
  return (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Row actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onEdit && (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
          )}
          {children}
          {onDelete && (
            <>
              {(onEdit || children) && <DropdownMenuSeparator />}
              <DropdownMenuItem destructive onSelect={onDelete}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Inactive</Badge>;
}

export const ACTIVE_FILTER_OPTIONS = [
  { value: 'true', label: 'Active only' },
  { value: 'false', label: 'Inactive only' },
];
