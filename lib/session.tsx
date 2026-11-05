import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getMyRole, Role, setGuest, supabase } from './supabase';

type Ctx = { session: Session | null; role: Role | null; loading: boolean; guest: boolean; refreshRole: () => Promise<void> };
const SessionCtx = createContext<Ctx>({ session: null, role: null, loading: true, guest: true, refreshRole: async () => {} });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshRole = async () => setRole(await getMyRole());

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setGuest(!data.session); setSession(data.session);
      if (data.session) await refreshRole();
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setGuest(!s); setSession(s);
      if (s) await refreshRole(); else setRole(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return <SessionCtx.Provider value={{ session, role, loading, guest: !session, refreshRole }}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);
export const canEdit = (r: Role | null) => r === 'owner' || r === 'editor';
