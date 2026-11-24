'use client';

import { Suspense, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { SessionUser } from '@bht/shared';
import { api } from '@/lib/api';
import { applyLook, effectiveLook } from '@/lib/appearance';
import { AppShell } from '@/components/app/app-shell';
import { AccountSetup } from '@/components/app/account-setup';
import { SessionProvider } from '@/components/app/session';

/** Everything behind login: loads the user once, then renders the app shell. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: user, isError } = useQuery({
    queryKey: ['session'],
    queryFn: () => api<SessionUser>('/auth/me'),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        {isError ? (
          'Could not load your session. Please refresh the page.'
        ) : (
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </span>
        )}
      </div>
    );
  }

  // An admin-set password or a missing 2-step login (company rule) is finished first; the server
  // holds back the rest of the ERP until then.
  const needsSetup = user.security?.mustChangePassword || user.security?.twoFactorSetupRequired;

  return (
    <SessionProvider user={user}>
      <LookSync user={user} />
      {needsSetup ? (
        <AccountSetup user={user} />
      ) : (
        <AppShell>
          <Suspense>{children}</Suspense>
        </AppShell>
      )}
    </SessionProvider>
  );
}

/** Applies the user's saved look (font, colour, size, theme) - also on a new computer, right after sign-in. */
function LookSync({ user }: { user: SessionUser }) {
  const { theme, setTheme } = useTheme();
  const { font, accent, textSize } = user.preferences;
  useEffect(() => {
    applyLook(effectiveLook(user));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, accent, textSize, user.appearance.font, user.appearance.accent]);
  const wanted = user.preferences.theme;
  useEffect(() => {
    if (wanted && wanted !== theme) setTheme(wanted);
    // only when the saved choice changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  return null;
}
