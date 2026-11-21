'use client';

import { createContext, useContext } from 'react';
import { hasPermission, type SessionUser } from '@bht/shared';

interface SessionValue {
  user: SessionUser;
  /** can('customers.create') */
  can: (permission: string) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const can = (permission: string) => hasPermission(user.permissions, permission);
  return <SessionContext.Provider value={{ user, can }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside the app layout');
  return value;
}
