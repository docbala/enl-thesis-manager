import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl: string; supabaseKey: string };

// The publishable key is safe in the app: every table is protected by row-level security,
// so only invited members can read or change data.
export const supabase = createClient(extra.supabaseUrl, extra.supabaseKey, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

export type Role = 'owner' | 'editor' | 'viewer';

export async function getMyRole(): Promise<Role | null> {
  const { data, error } = await supabase.rpc('my_role');
  if (error) return null;
  return (data as Role) ?? null;
}
