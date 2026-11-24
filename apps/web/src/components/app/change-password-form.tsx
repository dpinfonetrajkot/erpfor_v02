'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { changePasswordSchema, type ChangePasswordInput } from '@bht/shared';
import { api } from '@/lib/api';
import { showApiError } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { TextField } from './form';
import { PasswordChecklist } from './password-checklist';

/** Current password, new password (with the live rules checklist) and repeat; used in My account and at the first sign-in. */
export function ChangePasswordForm({
  username,
  onDone,
  currentLabel = 'Current password',
  submitLabel = 'Change password',
}: {
  username: string;
  onDone: () => void;
  currentLabel?: string;
  submitLabel?: string;
}) {
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const change = useMutation({
    mutationFn: (values: ChangePasswordInput) => api('/auth/change-password', { method: 'POST', body: values }),
    meta: { skipInvalidate: true },
    onSuccess: () => {
      form.reset();
      onDone();
    },
    onError: (err) => showApiError(err, form),
  });
  const newPassword = form.watch('newPassword');

  return (
    <form onSubmit={form.handleSubmit((v) => change.mutate(v))} className="space-y-4" noValidate>
      <TextField form={form} name="currentPassword" label={currentLabel} type="password" autoComplete="current-password" required />
      <TextField form={form} name="newPassword" label="New password" type="password" autoComplete="new-password" required />
      <PasswordChecklist password={newPassword} username={username} />
      <TextField form={form} name="confirmPassword" label="Repeat new password" type="password" autoComplete="new-password" required />
      <Button type="submit" loading={change.isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}
