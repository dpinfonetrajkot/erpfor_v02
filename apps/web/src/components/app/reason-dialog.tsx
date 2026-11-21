'use client';

import { reasonSchema, type ReasonInput } from '@bht/shared';
import { useZodForm } from '@/lib/forms';
import { TextField } from './form';
import { FormDialog } from './form-dialog';

/** Asks why (cancel / close a document) before calling onConfirm. */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  saving,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  saving?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const form = useZodForm(reasonSchema, { reason: '' });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      onSubmit={form.handleSubmit((v: ReasonInput) => onConfirm(v.reason))}
      saving={saving}
      submitLabel={confirmLabel}
    >
      <TextField form={form} name="reason" label="Reason" required autoFocus />
    </FormDialog>
  );
}
