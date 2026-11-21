'use client';

import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  dispatchSchema,
  emailDocumentSchema,
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  paymentSchema,
  type DispatchInput,
  type EmailDocumentInput,
  type PaymentInput,
} from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtMoney, toInputDate } from '@/lib/format';
import { showApiError } from '@/hooks/use-api';
import type { DispatchRow } from '@/lib/types';
import type { Currency } from '@bht/shared';
import { FormGrid, SelectField, TextareaField, TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';

const today = () => new Date().toISOString().slice(0, 10);

/** Transport details: new dispatch of an invoice, or correcting an existing dispatch. */
export function DispatchDialog({
  invoiceId,
  dispatch,
  defaults,
  onClose,
}: {
  invoiceId?: number;
  dispatch?: DispatchRow;
  defaults?: Partial<{ transporter: string; vehicleNo: string; packages: number | null; grossWeightKg: number | null }>;
  onClose: () => void;
}) {
  const initial: z.input<typeof dispatchSchema> = dispatch
    ? {
        dispatchDate: toInputDate(dispatch.dispatchDate),
        challanNo: dispatch.challanNo ?? '',
        transporter: dispatch.transporter ?? '',
        lrNo: dispatch.lrNo ?? '',
        vehicleNo: dispatch.vehicleNo ?? '',
        driverName: dispatch.driverName ?? '',
        driverPhone: dispatch.driverPhone ?? '',
        loadedBy: dispatch.loadedBy ?? '',
        packages: dispatch.packages ?? '',
        grossWeightKg: dispatch.grossWeightKg ?? '',
        remarks: dispatch.remarks ?? '',
      }
    : {
        dispatchDate: today(),
        challanNo: '',
        transporter: defaults?.transporter ?? '',
        lrNo: '',
        vehicleNo: defaults?.vehicleNo ?? '',
        driverName: '',
        driverPhone: '',
        loadedBy: '',
        packages: defaults?.packages ?? '',
        grossWeightKg: defaults?.grossWeightKg ?? '',
        remarks: '',
      };
  const form = useZodForm(dispatchSchema, initial);
  const save = useMutation({
    mutationFn: (v: DispatchInput) =>
      dispatch ? api(`/dispatches/${dispatch.id}`, { method: 'PUT', body: v }) : api<{ dispatchNo: string }>(`/invoices/${invoiceId}/dispatch`, { method: 'POST', body: v }),
    onSuccess: (r) => {
      toast.success(dispatch ? 'Transport details saved' : `Dispatched as ${(r as { dispatchNo: string }).dispatchNo}`);
      onClose();
    },
    onError: (err) => showApiError(err, form),
  });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={dispatch ? `Transport details · ${dispatch.dispatchNo}` : 'Dispatch'}
      description={dispatch ? undefined : 'The sets on this invoice leave the factory; the sales order is updated.'}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
      submitLabel={dispatch ? 'Save' : 'Dispatch'}
    >
      <FormGrid>
        <TextField form={form} name="dispatchDate" label="Date" type="date" required />
        <TextField form={form} name="challanNo" label="Delivery challan no." />
        <TextField form={form} name="transporter" label="Transporter" />
        <TextField form={form} name="lrNo" label="LR / AWB no." />
        <TextField form={form} name="vehicleNo" label="Vehicle no." inputClassName="uppercase" />
        <TextField form={form} name="driverName" label="Driver" />
        <TextField form={form} name="driverPhone" label="Driver phone" inputMode="tel" />
        <TextField form={form} name="loadedBy" label="Loaded by" />
        <TextField form={form} name="packages" label="Packages" type="number" min={0} />
        <TextField form={form} name="grossWeightKg" label="Gross weight (kg)" type="number" min={0} step="0.1" />
      </FormGrid>
      <TextField form={form} name="remarks" label="Note" />
    </FormDialog>
  );
}

/** Money received on an invoice, or paid on a purchase order. */
export function PaymentDialog({
  target,
  onClose,
}: {
  target: { direction: 'RECEIPT' | 'PAYMENT'; id: number; number: string; party: string; balance: number; currency: Currency };
  onClose: () => void;
}) {
  const receipt = target.direction === 'RECEIPT';
  const initial: z.input<typeof paymentSchema> = {
    direction: target.direction,
    paymentDate: today(),
    invoiceId: receipt ? target.id : '',
    purchaseOrderId: receipt ? '' : target.id,
    amount: target.balance,
    mode: 'BANK_TRANSFER',
    reference: '',
    remarks: '',
  };
  const form = useZodForm(paymentSchema, initial);
  const save = useMutation({
    mutationFn: (v: PaymentInput) => api<{ paymentNo: string }>('/payments', { method: 'POST', body: v }),
    onSuccess: (r) => {
      toast.success(`${r.paymentNo} saved`);
      onClose();
    },
    onError: (err) => showApiError(err, form),
  });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={receipt ? `Payment received · ${target.number}` : `Payment made · ${target.number}`}
      description={`${receipt ? 'From' : 'To'} ${target.party}. Still due: ${fmtMoney(target.balance, target.currency)}`}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
      submitLabel="Save payment"
    >
      <FormGrid>
        <TextField form={form} name="amount" label={`Amount (${target.currency})`} type="number" min={0} step="0.01" required autoFocus />
        <TextField form={form} name="paymentDate" label="Date" type="date" required />
        <SelectField form={form} name="mode" label="Mode" options={PAYMENT_MODES.map((m) => ({ value: m, label: PAYMENT_MODE_LABELS[m] }))} />
        <TextField form={form} name="reference" label="UTR / cheque no." />
      </FormGrid>
      <TextField form={form} name="remarks" label="Note" />
    </FormDialog>
  );
}

/** E-mail a document PDF (invoice ...). */
export function EmailDialog({
  title,
  path,
  initial,
  mailEnabled,
  onClose,
}: {
  title: string;
  path: string;
  initial: EmailDocumentInput;
  mailEnabled?: boolean;
  onClose: () => void;
}) {
  const form = useZodForm(emailDocumentSchema, initial);
  const send = useMutation({
    mutationFn: (v: EmailDocumentInput) => api<{ sentTo: string }>(path, { method: 'POST', body: v }),
    onSuccess: (r) => {
      toast.success(`Sent to ${r.sentTo}`);
      onClose();
    },
    onError: (err) => showApiError(err, form),
  });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={mailEnabled === false ? 'E-mail is not set up on the server yet (SMTP settings).' : 'The PDF is attached automatically.'}
      onSubmit={form.handleSubmit((v) => send.mutate(v))}
      saving={send.isPending}
      submitLabel="Send"
    >
      <TextField form={form} name="to" label="To" required hint="Separate several addresses with a comma" />
      <TextField form={form} name="cc" label="Cc" />
      <TextField form={form} name="subject" label="Subject" required />
      <TextareaField form={form} name="message" label="Message" rows={6} />
    </FormDialog>
  );
}
