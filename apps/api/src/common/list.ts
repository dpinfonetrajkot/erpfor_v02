import type { ListQuery, Paginated } from '@bht/shared';

interface ListOptions {
  /** Columns searched with "contains" when ?search= is given. Dotted paths reach relations. */
  searchFields: string[];
  /** Columns the client may sort by (anything else falls back to defaultSort). */
  sortable: string[];
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  /** Apply ?active=true/false to this boolean column. */
  activeField?: string;
}

/** Builds Prisma `where / orderBy / skip / take` from the standard list query. */
export function listArgs(query: ListQuery, opts: ListOptions, extraWhere: object = {}) {
  const and: object[] = [extraWhere];

  if (query.search) {
    and.push({ OR: opts.searchFields.map((f) => nested(f, { contains: query.search })) });
  }
  if (opts.activeField && query.active) {
    and.push({ [opts.activeField]: query.active === 'true' });
  }

  const sortField = query.sortBy && opts.sortable.includes(query.sortBy) ? query.sortBy : null;
  const orderBy = sortField
    ? nested(sortField, query.sortDir)
    : nested(opts.defaultSort.field, opts.defaultSort.dir);

  return {
    where: { AND: and },
    orderBy,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  };
}

export function paginated<T>(data: T[], total: number, query: ListQuery): Paginated<T> {
  return { data, total, page: query.page, pageSize: query.pageSize };
}

/** "grade.name" + value -> { grade: { name: value } } */
function nested(path: string, value: unknown): Record<string, unknown> {
  return path
    .split('.')
    .reverse()
    .reduce<unknown>((acc, key) => ({ [key]: acc }), value) as Record<string, unknown>;
}
