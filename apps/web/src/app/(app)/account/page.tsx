'use client';

import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { useSession } from '@/components/app/session';
import { ChangePasswordForm } from '@/components/app/change-password-form';

export default function AccountPage() {
  const { user } = useSession();
  return (
    <>
      <PageHeader title="My account" description={`${user.name} · @${user.username} · ${user.role.name}`} />
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>8 or more characters with an uppercase letter, a lowercase letter, a number and a symbol. Other devices are signed out.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm username={user.username} onDone={() => toast.success('Password changed. Other devices have been signed out.')} />
        </CardContent>
      </Card>
    </>
  );
}
