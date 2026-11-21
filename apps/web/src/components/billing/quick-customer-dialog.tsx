'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { CURRENCIES, customerSchema, GSTIN_REGEX, INDIAN_STATES } from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { showApiError } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { FormGrid, SelectField, TextareaField, TextField } from '@/components/app/form';

const blank = (name = '') => ({
  code: '',
  name,
  contactPerson: '',
  phone: '',
  email: '',
  gstin: '',
  pan: '',
  address: '',
  city: '',
  stateCode: '',
  pincode: '',
  country: 'India',
  paymentTermsDays: '' as unknown as number,
  notes: '',
  isActive: true,
  shippingAddress: '',
  currency: 'INR' as const,
});

/**
 * Add a customer without leaving the invoice. It is saved in the customer master (same rules, next CUS code)
 * and picked on the invoice at once. Typing the GSTIN fills the state and the PAN.
 */
export function QuickCustomerDialog({
  open,
  onOpenChange,
  initialName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated: (customer: { id: number; name: string }) => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(customerSchema, blank(initialName));

  useEffect(() => {
    if (open) form.reset(blank(initialName));
  }, [open, initialName, form]);

  // GSTIN = 2-digit state code + PAN + 3 more characters
  const gstin = form.watch('gstin');
  useEffect(() => {
    const g = (gstin ?? '').trim().toUpperCase();
    if (!GSTIN_REGEX.test(g)) return;
    if (!form.getValues('stateCode')) form.setValue('stateCode', g.slice(0, 2), { shouldDirty: true });
    if (!form.getValues('pan')) form.setValue('pan', g.slice(2, 12), { shouldDirty: true });
  }, [gstin, form]);

  const save = useMutation({
    mutationFn: (v: unknown) => api<{ id: number; name: string; code: string }>('/customers', { method: 'POST', body: v }),
    onSuccess: async (c) => {
      toast.success(`Customer ${c.name} added (${c.code})`);
      await queryClient.invalidateQueries({ queryKey: ['lookups'] });
      onCreated({ id: c.id, name: c.name });
      onOpenChange(false);
    },
    onError: (err) => showApiError(err, form),
  });

  const submit = form.handleSubmit((v) => save.mutate(v));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <UserPlus className="size-4" />
            </span>
            New customer
          </DialogTitle>
          <DialogDescription>Saved in Masters → Customers and chosen on this invoice. Type the GSTIN first: the state and PAN fill in.</DialogDescription>
        </DialogHeader>
        {/* the invoice is a form too: keep this submit to ourselves */}
        <form
          onSubmit={(e) => {
            e.stopPropagation();
            void submit(e);
          }}
          noValidate
          className="space-y-4"
        >
          <TextField form={form} name="name" label="Customer name" required autoFocus placeholder="e.g. Sharma Engineering Pvt. Ltd." />
          <FormGrid>
            <TextField form={form} name="gstin" label="GSTIN" inputClassName="uppercase font-mono" maxLength={15} placeholder="24AAAAA0000A1Z5" />
            <SelectField
              form={form}
              name="stateCode"
              label="State"
              placeholder="—"
              options={INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))}
            />
            <TextField form={form} name="contactPerson" label="Contact person" />
            <TextField form={form} name="phone" label="Phone / WhatsApp" inputMode="tel" />
            <TextField form={form} name="email" label="E-mail" type="email" />
            <TextField form={form} name="paymentTermsDays" label="Payment terms (days)" type="number" min={0} placeholder="e.g. 30" />
          </FormGrid>
          <TextareaField form={form} name="address" label="Billing address" rows={2} />
          <FormGrid>
            <TextField form={form} name="city" label="City" />
            <TextField form={form} name="pincode" label="Pincode" inputMode="numeric" maxLength={10} />
            <TextField form={form} name="pan" label="PAN" inputClassName="uppercase font-mono" maxLength={10} />
            <SelectField form={form} name="currency" label="Currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </FormGrid>
          <TextareaField form={form} name="shippingAddress" label="Delivery address (if different)" rows={2} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              <UserPlus /> Add customer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
