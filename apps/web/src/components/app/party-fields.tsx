'use client';

import { useEffect, useState } from 'react';
import { useWatch, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { INDIAN_STATES, type Paginated } from '@bht/shared';
import { api } from '@/lib/api';
import { FormGrid, FormSection, SelectField, SwitchField, TextField, TextareaField } from './form';

export const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }));

/** Which list to look in for a party with the same name or GSTIN (warns only; saving is still allowed). */
export interface DuplicateCheck {
  path: '/customers' | '/suppliers';
  /** The record being edited (not counted as a duplicate of itself). */
  currentId?: number;
  label: 'customer' | 'supplier';
}

/** Fields shared by customers and suppliers. */
export function PartyFields<T extends FieldValues>({
  form,
  codeHint,
  extraTop,
  extraBottom,
  duplicateCheck,
}: {
  form: UseFormReturn<T, any, any>;
  codeHint: string;
  extraTop?: React.ReactNode;
  extraBottom?: React.ReactNode;
  duplicateCheck?: DuplicateCheck;
}) {
  const f = (name: string) => name as Path<T>;
  return (
    <>
      <FormSection title="Basic details">
        <FormGrid>
          <TextField form={form} name={f('name')} label="Name" required className="sm:col-span-2" />
          <TextField form={form} name={f('code')} label="Code" placeholder="Auto" hint={codeHint} />
          {extraTop}
          <TextField form={form} name={f('contactPerson')} label="Contact person" />
          <TextField form={form} name={f('phone')} label="Phone" inputMode="tel" />
          <TextField form={form} name={f('email')} label="Email" type="email" className="sm:col-span-2" />
        </FormGrid>
        {duplicateCheck && <SameParty form={form} check={duplicateCheck} field="name" />}
      </FormSection>

      <FormSection title="Tax">
        <FormGrid>
          <TextField form={form} name={f('gstin')} label="GSTIN" placeholder="24AAAAA0000A1Z5" inputClassName="uppercase" maxLength={15} />
          <TextField form={form} name={f('pan')} label="PAN" inputClassName="uppercase" maxLength={10} />
        </FormGrid>
        {duplicateCheck && <SameParty form={form} check={duplicateCheck} field="gstin" />}
      </FormSection>

      <FormSection title="Address">
        <TextareaField form={form} name={f('address')} label="Address" rows={2} />
        <FormGrid>
          <TextField form={form} name={f('city')} label="City" />
          <TextField form={form} name={f('pincode')} label="PIN code" inputMode="numeric" />
          <SelectField form={form} name={f('stateCode')} label="State (GST)" options={STATE_OPTIONS} placeholder="— Outside India / not set —" />
          <TextField form={form} name={f('country')} label="Country" required />
        </FormGrid>
      </FormSection>

      {extraBottom}

      <FormSection title="Other">
        <FormGrid>
          <TextField form={form} name={f('paymentTermsDays')} label="Payment terms (days)" type="number" min={0} inputMode="numeric" />
        </FormGrid>
        <TextareaField form={form} name={f('notes')} label="Notes" rows={2} />
        <SwitchField form={form} name={f('isActive')} label="Active" hint="Inactive records are hidden from dropdowns but kept for history." />
      </FormSection>
    </>
  );
}

interface PartyRow {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
}

const same = (a: string | null | undefined, b: string) => (a ?? '').trim().replace(/\s+/g, ' ').toUpperCase() === b;

/**
 * A yellow note when another customer / supplier already has this name or GSTIN, so the same party is not
 * entered twice. Looks only after typing stops; saving is still allowed (some firms really have two records).
 */
function SameParty<T extends FieldValues>({ form, check, field }: { form: UseFormReturn<T, any, any>; check: DuplicateCheck; field: 'name' | 'gstin' }) {
  const value = useWatch({ control: form.control, name: field as Path<T> }) as string | undefined;
  const typed = (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  const [wanted, setWanted] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setWanted(typed), 500);
    return () => clearTimeout(t);
  }, [typed]);
  const ready = field === 'gstin' ? wanted.length === 15 : wanted.length >= 3;
  const { data } = useQuery({
    queryKey: [check.path, 'same', field, wanted],
    queryFn: () => api<Paginated<PartyRow>>(check.path, { query: { search: wanted, pageSize: 20 } }),
    enabled: ready,
    staleTime: 30_000,
    retry: false,
  });
  if (!ready || wanted !== typed || !data) return null;
  const matches = data.data.filter((p) => p.id !== check.currentId && same(p[field], wanted));
  if (!matches.length) return null;
  const what = field === 'gstin' ? 'this GSTIN' : 'this name';
  const found = matches.slice(0, 3).map((m) => `${m.code} · ${m.name}`).join(', ') + (matches.length > 3 ? ` and ${matches.length - 3} more` : '');
  return (
    <p role="status" className="flex items-start gap-2 rounded-xl bg-warning/15 px-3 py-2 text-[13px] text-[color-mix(in_oklch,var(--warning),black_40%)] dark:text-warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        A {check.label} with {what} already exists: {found}
        {found.endsWith('.') ? '' : '.'} Check it is not entered twice.
      </span>
    </p>
  );
}
