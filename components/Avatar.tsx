import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { signedUrls } from '../lib/photos';
import { useSession } from '../lib/session';

const COLORS = ['#2a78d6', '#1baf7a', '#eb6834', '#8a5cd1', '#d1477a', '#0f8fa3', '#b7791f'];
const initials = (name: string) => {
  const w = name.replace(/^(HD|SUS)-/, '').trim().split(/\s+/).filter(Boolean);
  if (/^\d+$/.test(w[0] ?? '')) return w[0].slice(-3);            // visitors: study number only
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase() || '?';
};

/** Profile photo circle, or coloured initials when there is no photo (always initials for visitors). */
export function Avatar({ name, url, size = 44 }: { name: string; url?: string | null; size?: number }) {
  const bg = COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: url ? '#E6EBF0' : bg, alignItems: 'center', justifyContent: 'center' }}>
      {url ? <Image source={{ uri: url }} style={{ width: size, height: size }} />
        : <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.36 }}>{initials(name)}</Text>}
    </View>
  );
}

/** Signed thumbnail links for a set of patients (members only; visitors get initials). */
export function useAvatars(patientIds: string[]) {
  const { guest } = useSession();
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const key = patientIds.join(',');
  useEffect(() => {
    let on = true;
    if (guest || !patientIds.length) { setUrls({}); return; }
    (async () => {
      const { data } = await supabase.from('v_profile_photo').select('patient_id, storage_path, thumb_path');
      const rows = ((data ?? []) as { patient_id: string; storage_path: string; thumb_path: string | null }[]).filter(r => patientIds.includes(r.patient_id));
      if (!rows.length) return;
      const paths = rows.map(r => r.thumb_path ?? r.storage_path);
      const signed = await signedUrls(paths);
      if (on) setUrls(Object.fromEntries(rows.map((r, i) => [r.patient_id, signed[paths[i]]])));
    })();
    return () => { on = false; };
  }, [key, guest]);
  return urls;
}
