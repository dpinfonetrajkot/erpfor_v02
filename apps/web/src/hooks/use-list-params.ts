'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface ListParams {
  page: number;
  pageSize: number;
  search: string;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
  /** Extra filters, e.g. { active: 'true', type: 'MATERIAL' } */
  filters: Record<string, string>;
  /** What is typed in the search box right now (search itself is debounced). */
  searchInput: string;
  setSearchInput: (value: string) => void;
  set: (patch: Partial<{ page: number; pageSize: number; sortBy?: string; sortDir: 'asc' | 'desc' } & Record<string, string | number | undefined>>) => void;
  /** Ready to pass to api(..., { query }) */
  query: Record<string, string | number | undefined>;
}

const RESERVED = ['page', 'pageSize', 'search', 'sortBy', 'sortDir'];

/**
 * List state (page, search, sort, filters) kept in the URL, so refresh,
 * back/forward and shared links show the same list.
 */
export function useListParams(defaults: { pageSize?: number; filters?: Record<string, string> } = {}): ListParams {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const page = Number(sp.get('page') ?? 1) || 1;
  const pageSize = Number(sp.get('pageSize') ?? defaults.pageSize ?? 25) || 25;
  const search = sp.get('search') ?? '';
  const sortBy = sp.get('sortBy') ?? undefined;
  const sortDir = sp.get('sortDir') === 'desc' ? 'desc' : 'asc';

  const filters = useMemo(() => {
    const f: Record<string, string> = { ...(defaults.filters ?? {}) };
    sp.forEach((v, k) => {
      if (!RESERVED.includes(k)) f[k] = v;
    });
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const set = useCallback<ListParams['set']>(
    (patch) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '' || v === null) next.delete(k);
        else next.set(k, String(v));
      }
      // Changing anything but the page goes back to page 1.
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => setSearchInput(search), [search]);
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => set({ search: searchInput }), 300);
    return () => clearTimeout(t);
  }, [searchInput, search, set]);

  const query = { page, pageSize, search: search || undefined, sortBy, sortDir, ...filters };
  return { page, pageSize, search, sortBy, sortDir, filters, searchInput, setSearchInput, set, query };
}
