'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import type { Paginated } from '@bht/shared';
import { api, ApiRequestError, errorMessage } from '@/lib/api';

export interface LookupOption {
  value: number;
  label: string;
  meta?: Record<string, unknown>;
}

/** Paginated list from the API: usePaged<Customer>('/customers', params.query) */
export function usePaged<T>(path: string, query: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: [path, query],
    queryFn: () => api<Paginated<T>>(path, { query: query as Record<string, string> }),
    placeholderData: (prev) => prev,
    enabled,
  });
}

export function useApiQuery<T>(path: string, query?: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: [path, query ?? {}],
    queryFn: () => api<T>(path, { query: query as Record<string, string> }),
    enabled,
  });
}

/** Dropdown options: useLookups('customers', 'rawMaterials').data?.customers */
export function useLookups<K extends string>(...types: K[]) {
  return useQuery({
    queryKey: ['lookups', ...types],
    queryFn: () => api<Record<K, LookupOption[]>>('/lookups', { query: { types: types.join(',') } }),
    staleTime: 60_000,
  });
}

/** Puts API field errors on the matching form fields; shows the message as a toast. */
export function showApiError<T extends FieldValues>(err: unknown, form?: UseFormReturn<T, any, any>) {
  if (err instanceof ApiRequestError && form) {
    for (const [field, message] of Object.entries(err.fieldErrors)) {
      form.setError(field as Path<T>, { type: 'server', message });
    }
  }
  toast.error(errorMessage(err));
}

/**
 * Create (POST path) or update (PUT path/id) with toasts and field errors.
 *   const save = useSave({ path: '/customers', id, form, label: 'Customer', onSaved: close })
 */
export function useSave<TValues extends FieldValues, TResult = unknown>(opts: {
  path: string;
  id?: number | string | null;
  form?: UseFormReturn<any, any, TValues>;
  label: string;
  /** Toast text; defaults to "<label> created / updated". */
  successMessage?: string;
  onSaved?: (result: TResult) => void;
}) {
  return useMutation({
    mutationFn: (values: TValues) =>
      api<TResult>(opts.id ? `${opts.path}/${opts.id}` : opts.path, {
        method: opts.id ? 'PUT' : 'POST',
        body: values,
      }),
    onSuccess: (result) => {
      toast.success(opts.successMessage ?? `${opts.label} ${opts.id ? 'updated' : 'created'}`);
      opts.onSaved?.(result);
    },
    onError: (err) => showApiError(err, opts.form),
  });
}

export function useDelete(path: string, label: string, onDeleted?: () => void) {
  return useMutation({
    mutationFn: (id: number | string) => api(`${path}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(`${label} deleted`);
      onDeleted?.();
    },
    onError: (err) => showApiError(err),
  });
}
