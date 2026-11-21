'use client';

import { useState } from 'react';
import type { z } from 'zod';
import { Landmark, Mail, MapPin, Pencil, Phone, Plus, Star } from 'lucide-react';
import { companySchema, INDIAN_STATES, type CompanyInput } from '@bht/shared';
import { fromEntity, useZodForm } from '@/lib/forms';
import { useApiQuery, useSave } from '@/hooks/use-api';
import type { Company } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { FormGrid, FormSection, FormSheet, SelectField, SwitchField, TextField, TextareaField } from '@/components/app/form';
import { PageHeader } from '@/components/app/page-header';
import { STATE_OPTIONS } from '@/components/app/party-fields';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

export default function CompaniesPage() {
  return (
    <RequirePermission permission="settings.view">
      <Companies />
    </RequirePermission>
  );
}

function Companies() {
  const { can } = useSession();
  const { data, isLoading } = useApiQuery<Company[]>('/settings/companies');
  const [editing, setEditing] = useState<Company | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Companies"
        description="Your own companies (legal entities). Purchase orders and invoices are issued in the name of one of them."
        actions={
          can('settings.update') && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New company
            </Button>
          )
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-56" />)}
        {data?.map((c) => {
          const state = INDIAN_STATES.find((s) => s.code === c.stateCode)?.name;
          return (
            <Card key={c.id} className="flex flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Landmark className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{c.name}</h2>
                    {c.isDefault && (
                      <Badge>
                        <Star aria-hidden /> Default
                      </Badge>
                    )}
                    {!c.isActive && <Badge variant="muted">Inactive</Badge>}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {c.code} · GSTIN {c.gstin ?? '—'}
                  </div>
                </div>
                {can('settings.update') && (
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}>
                    <Pencil />
                  </Button>
                )}
              </div>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{[c.address, c.city, state, c.pincode].filter(Boolean).join(', ') || '—'}</span>
                </div>
                <div className="flex gap-2">
                  <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{c.phone ?? '—'}</span>
                </div>
                <div className="flex gap-2">
                  <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{c.email ?? '—'}</span>
                </div>
              </dl>
              {c.bankName && (
                <div className="mt-4 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  Bank: {c.bankName} · A/c {c.bankAccountNo} · IFSC {c.bankIfsc}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {editing && <CompanySheet company={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const defaults: z.input<typeof companySchema> = {
  code: '',
  name: '',
  legalName: '',
  address: '',
  city: '',
  stateCode: '24',
  pincode: '',
  country: 'India',
  phone: '',
  email: '',
  website: '',
  gstin: '',
  pan: '',
  iecCode: '',
  bankName: '',
  bankAccountNo: '',
  bankIfsc: '',
  bankBranch: '',
  swiftCode: '',
  invoiceTerms: '',
  purchaseTerms: '',
  isDefault: false,
  isActive: true,
};

function CompanySheet({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const form = useZodForm(companySchema, fromEntity(defaults, company));
  const save = useSave<CompanyInput>({ path: '/settings/companies', id: company?.id, form, label: 'Company', onSaved: onClose });
  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={company ? `Edit ${company.name}` : 'New company'}
      description="These details are printed on purchase orders and invoices."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <FormSection title="Company">
        <FormGrid>
          <TextField form={form} name="name" label="Name" required className="sm:col-span-2" />
          <TextField form={form} name="code" label="Short code" placeholder="DEMO" required inputClassName="uppercase" />
          <TextField form={form} name="legalName" label="Legal name (if different)" />
        </FormGrid>
      </FormSection>
      <FormSection title="Address & contact">
        <TextareaField form={form} name="address" label="Address" rows={2} />
        <FormGrid>
          <TextField form={form} name="city" label="City" />
          <TextField form={form} name="pincode" label="PIN code" />
          <SelectField form={form} name="stateCode" label="State (GST)" options={STATE_OPTIONS} placeholder="—" />
          <TextField form={form} name="country" label="Country" required />
          <TextField form={form} name="phone" label="Phone" />
          <TextField form={form} name="email" label="Email" type="email" />
          <TextField form={form} name="website" label="Website" className="sm:col-span-2" />
        </FormGrid>
      </FormSection>
      <FormSection title="Tax & export">
        <FormGrid>
          <TextField form={form} name="gstin" label="GSTIN" inputClassName="uppercase" maxLength={15} />
          <TextField form={form} name="pan" label="PAN" inputClassName="uppercase" maxLength={10} />
          <TextField form={form} name="iecCode" label="IEC code" hint="Needed on export invoices" />
        </FormGrid>
      </FormSection>
      <FormSection title="Bank (printed on invoices)">
        <FormGrid>
          <TextField form={form} name="bankName" label="Bank name" />
          <TextField form={form} name="bankBranch" label="Branch" />
          <TextField form={form} name="bankAccountNo" label="Account number" />
          <TextField form={form} name="bankIfsc" label="IFSC" inputClassName="uppercase" />
          <TextField form={form} name="swiftCode" label="SWIFT code" inputClassName="uppercase" hint="For USD payments" />
        </FormGrid>
      </FormSection>
      <FormSection title="Default terms">
        <TextareaField form={form} name="invoiceTerms" label="Invoice terms & conditions" rows={3} />
        <TextareaField form={form} name="purchaseTerms" label="Purchase order terms" rows={3} />
      </FormSection>
      <SwitchField form={form} name="isDefault" label="Default company" hint="Pre-selected on new POs and invoices." />
      <SwitchField form={form} name="isActive" label="Active" />
    </FormSheet>
  );
}
