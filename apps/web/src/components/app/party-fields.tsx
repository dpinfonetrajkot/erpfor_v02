'use client';

import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { INDIAN_STATES } from '@bht/shared';
import { FormGrid, FormSection, SelectField, SwitchField, TextField, TextareaField } from './form';

export const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }));

/** Fields shared by customers and suppliers. */
export function PartyFields<T extends FieldValues>({
  form,
  codeHint,
  extraTop,
  extraBottom,
}: {
  form: UseFormReturn<T, any, any>;
  codeHint: string;
  extraTop?: React.ReactNode;
  extraBottom?: React.ReactNode;
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
      </FormSection>

      <FormSection title="Tax">
        <FormGrid>
          <TextField form={form} name={f('gstin')} label="GSTIN" placeholder="24AAAAA0000A1Z5" inputClassName="uppercase" maxLength={15} />
          <TextField form={form} name={f('pan')} label="PAN" inputClassName="uppercase" maxLength={10} />
        </FormGrid>
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
