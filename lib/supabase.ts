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

// Visitors who are not signed in read de-identified copies (study number in place of name; no phone, address,
// UHID, notes or photos). The database serves these only while the owner keeps the public view switched on.
const PUBLIC: Record<string, string> = {
  patients: 'pub_patients', visits: 'pub_visits', v_patient_progress: 'pub_patient_progress', v_schedule: 'pub_schedule',
  v_steroid_flags: 'pub_steroid_flags', v_episode_types: 'pub_episode_types', enl_episodes: 'pub_enl_episodes',
  drug_doses: 'pub_drug_doses', ess_assessments: 'pub_ess_assessments', study_settings: 'pub_study_settings',
};
let guest = true;
export const setGuest = (g: boolean) => { guest = g; };
export const isGuest = () => guest;
/** Table to read from: the real one for signed-in members, the de-identified copy for visitors. */
export const tbl = (name: string) => (guest ? PUBLIC[name] ?? name : name);

export async function getMyRole(): Promise<Role | null> {
  const { data, error } = await supabase.rpc('my_role');
  if (error) return null;
  return (data as Role) ?? null;
}
