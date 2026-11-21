'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from './session';

/** Renders children only when the user has the permission (or one of several); otherwise a friendly message. */
export function RequirePermission({ permission, children }: { permission: string | string[]; children: React.ReactNode }) {
  const { can } = useSession();
  if ((Array.isArray(permission) ? permission : [permission]).some(can)) return <>{children}</>;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Lock className="size-5 text-muted-foreground" />
      </div>
      <h1 className="text-lg font-semibold">You don&apos;t have access to this screen</h1>
      <p className="text-sm text-muted-foreground">Ask the admin to add it to your role if you need it for your work.</p>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
