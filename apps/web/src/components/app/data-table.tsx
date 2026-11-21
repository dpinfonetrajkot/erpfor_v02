'use client';

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Inbox, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ListParams } from '@/hooks/use-list-params';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/primitives';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** API field name to sort by (column is sortable when set). */
    sortKey?: string;
    align?: 'left' | 'right' | 'center';
    className?: string;
  }
}

interface DataTableProps<T> {
  columns: ColumnDef<T, any>[];
  data: T[] | undefined;
  total?: number;
  loading?: boolean;
  /** Server-side paging/search/sort. Leave out for a small client-side list. */
  params?: ListParams;
  searchPlaceholder?: string;
  /** Filters shown next to the search box. */
  toolbar?: React.ReactNode;
  onRowClick?: (row: T) => void;
  empty?: { title: string; description?: string; action?: React.ReactNode };
  rowClassName?: (row: T) => string | undefined;
}

export function DataTable<T>({
  columns,
  data,
  total,
  loading,
  params,
  searchPlaceholder = 'Search…',
  toolbar,
  onRowClick,
  empty,
  rowClassName,
}: DataTableProps<T>) {
  const table = useReactTable({
    data: data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  const showSkeleton = loading && !data;
  const rows = table.getRowModel().rows;
  const isFiltered = !!params && (params.search !== '' || Object.keys(params.filters).length > 0);

  return (
    <div className="flex flex-col gap-3">
      {(params || toolbar) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {params && (
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={params.searchInput}
                onChange={(e) => params.setSearchInput(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9"
                aria-label="Search"
              />
              {params.searchInput && (
                <button
                  onClick={() => params.setSearchInput('')}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}
          {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      )}

      <div className="glass overflow-hidden rounded-3xl">
        <div className="overflow-x-auto">
          <table className="w-full caption-bottom text-sm">
            <thead className="border-b bg-white/45 dark:bg-white/[0.03]">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    const sortKey = meta?.sortKey;
                    const sorted = params && sortKey && params.sortBy === sortKey ? params.sortDir : null;
                    return (
                      <th
                        key={header.id}
                        className={cn(
                          'h-10 px-3 text-left align-middle text-[12.5px] font-semibold whitespace-nowrap text-muted-foreground first:pl-5 last:pr-5',
                          meta?.align === 'right' && 'text-right',
                          meta?.align === 'center' && 'text-center',
                          meta?.className,
                        )}
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                      >
                        {header.isPlaceholder ? null : sortKey && params ? (
                          <button
                            className={cn('inline-flex items-center gap-1 hover:text-foreground', meta?.align === 'right' && 'flex-row-reverse')}
                            onClick={() =>
                              params.set({ sortBy: sortKey, sortDir: sorted === 'asc' ? 'desc' : 'asc' })
                            }
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sorted === 'asc' ? (
                              <ArrowUp className="size-3.5" />
                            ) : sorted === 'desc' ? (
                              <ArrowDown className="size-3.5" />
                            ) : (
                              <ChevronsUpDown className="size-3.5 opacity-40" />
                            )}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className={cn(loading && data && 'opacity-60 transition-opacity')}>
              {showSkeleton &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {columns.map((_c, j) => (
                      <td key={j} className="px-3 py-3 first:pl-4 last:pr-4">
                        <Skeleton className="h-4 w-full max-w-40" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!showSkeleton &&
                rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={cn(
                      'border-b border-border/70 transition-colors last:border-0 hover:bg-white/55 dark:hover:bg-white/[0.04]',
                      onRowClick && 'cursor-pointer',
                      rowClassName?.(row.original),
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            'px-3 py-3 align-middle first:pl-5 last:pr-5',
                            meta?.align === 'right' && 'text-right tabular',
                            meta?.align === 'center' && 'text-center',
                            meta?.className,
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!showSkeleton && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted">
              <Inbox className="size-5 text-muted-foreground" />
            </div>
            <div className="font-medium">{isFiltered ? 'No matching records' : (empty?.title ?? 'Nothing here yet')}</div>
            <p className="max-w-sm text-sm text-muted-foreground">
              {isFiltered ? 'Try a different search or clear the filters.' : empty?.description}
            </p>
            {!isFiltered && empty?.action}
          </div>
        )}

        {params && total !== undefined && total > 0 && (
          <Pagination params={params} total={total} />
        )}
      </div>
    </div>
  );
}

function Pagination({ params, total }: { params: ListParams; total: number }) {
  const from = (params.page - 1) * params.pageSize + 1;
  const to = Math.min(params.page * params.pageSize, total);
  const pages = Math.max(1, Math.ceil(total / params.pageSize));
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-2.5 text-[13px] text-muted-foreground sm:flex-row">
      <div className="tabular">
        {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="hidden sm:inline">Rows</span>
          <NativeSelect
            value={params.pageSize}
            onChange={(e) => params.set({ pageSize: Number(e.target.value) })}
            className="h-8 w-[74px]"
            aria-label="Rows per page"
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </label>
        <span className="tabular px-1">
          Page {params.page} / {pages}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={params.page <= 1}
          onClick={() => params.set({ page: params.page - 1 })}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={params.page >= pages}
          onClick={() => params.set({ page: params.page + 1 })}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** Filter dropdown for the table toolbar. */
export function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: { value: string | number; label: string }[];
  placeholder: string;
  className?: string;
}) {
  return (
    <NativeSelect
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className={cn('w-auto min-w-36', !value && 'text-muted-foreground', className)}
      aria-label={placeholder}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}
