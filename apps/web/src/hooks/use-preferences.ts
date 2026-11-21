'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SessionUser, UserPreferences } from '@bht/shared';
import { api } from '@/lib/api';
import { applyLook, effectiveLook } from '@/lib/appearance';
import { useSession } from '@/components/app/session';

/**
 * The user's own settings, and `save(change)`: the look changes on screen at once,
 * then the whole set is stored with the login (so it follows the user to any computer).
 */
export function usePreferences() {
  const { user } = useSession();
  const queryClient = useQueryClient();

  const save = useCallback(
    async (change: Partial<UserPreferences>, opts: { quiet?: boolean } = {}) => {
      const current = (queryClient.getQueryData<SessionUser>(['session']) ?? user).preferences;
      const next: UserPreferences = { ...current, ...change };
      // undefined = "back to the default": drop the key
      for (const k of Object.keys(next) as (keyof UserPreferences)[]) if (next[k] === undefined) delete next[k];
      applyLook(effectiveLook(user, next));
      queryClient.setQueryData<SessionUser>(['session'], (u) => (u ? { ...u, preferences: next } : u));
      try {
        const updated = await api<SessionUser>('/account/preferences', { method: 'PUT', body: next });
        queryClient.setQueryData(['session'], updated);
        if (!opts.quiet) toast.success('Saved', { id: 'preferences-saved', duration: 1500 });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save the setting');
      }
    },
    [queryClient, user],
  );

  return { preferences: user.preferences, save };
}
