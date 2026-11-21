'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { changePasswordSchema, type ChangePasswordInput } from '@bht/shared';
import { api } from '@/lib/api';
import { showApiError } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { TextField } from '@/components/app/form';
import { useSession } from '@/components/app/session';

export default function AccountPage() {
  const { user } = useSession();
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const change = useMutation({
    mutationFn: (values: ChangePasswordInput) => api('/auth/change-password', { method: 'POST', body: values }),
    meta: { skipInvalidate: true },
    onSuccess: () => {
      toast.success('Password changed. Other devices have been signed out.');
      form.reset();
    },
    onError: (err) => showApiError(err, form),
  });

  return (
    <>
      <PageHeader title="My account" description={`${user.name} · @${user.username} · ${user.role.name}`} />
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>At least 8 characters, with a letter and a number.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit((v) => change.mutate(v))} className="space-y-4" noValidate>
            <TextField form={form} name="currentPassword" label="Current password" type="password" autoComplete="current-password" required />
            <TextField form={form} name="newPassword" label="New password" type="password" autoComplete="new-password" required />
            <TextField form={form} name="confirmPassword" label="Repeat new password" type="password" autoComplete="new-password" required />
            <Button type="submit" loading={change.isPending}>
              Change password
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
