import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getMyRole, Role, setGuest, supabase } from './supabase';
import { clearOffline } from './offline';

// guest: not signed in, or signed in but not yet approved (pending). Both see the de-identified view only.
type Ctx = { session: Session | null; role: Role | null; loading: boolean; guest: boolean; pending: boolean; refreshRole: () => Promise<void> };
const SessionCtx = createContext<Ctx>({ session: null, role: null, loading: true, guest: true, pending: false, refreshRole: async () => {} });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshRole = async () => {
    const r = await getMyRole();
    setGuest(!r); setRole(r);
    if (!r) supabase.rpc('request_access').then(() => {}, () => {});   // makes sure the owner sees the request
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setGuest(true); setSession(data.session);
      if (data.session) await refreshRole();
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (e, s) => {
      if (e === 'SIGNED_OUT') clearOffline();   // a shared phone keeps no member data after sign-out
      if (!s) { setGuest(true); setRole(null); }
      setSession(s);
      if (s) await refreshRole();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return <SessionCtx.Provider value={{ session, role, loading, guest: !role, pending: !!session && !role, refreshRole }}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);
export const canEdit = (r: Role | null) => r === 'owner' || r === 'editor';
