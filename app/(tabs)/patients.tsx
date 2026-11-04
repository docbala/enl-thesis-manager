import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import type { Progress } from '../../lib/types';
import { C, Chip, Muted, s } from '../../components/ui';

type Row = Progress & { uhid: string | null; contact_no: string | null; patient_status: string | null };

export default function Patients() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [prog, pts] = await Promise.all([
      supabase.from('v_patient_progress').select('*'),
      supabase.from('patients').select('id, uhid, contact_no, patient_status').is('deleted_at', null),
    ]);
    const extra = new Map((pts.data ?? []).map((p: any) => [p.id, p]));
    const merged = ((prog.data ?? []) as Progress[]).map(r => ({ ...r, ...(extra.get(r.patient_id) ?? {}) })) as Row[];
    merged.sort((a, b) => a.cr_no.localeCompare(b.cr_no));
    setRows(merged);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Search matches the study ID, name, UHID or phone only, never lab values.
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    const digits = t.replace(/\D/g, '');
    return rows.filter(r =>
      r.cr_no.toLowerCase().includes(t) || r.patient_name.toLowerCase().includes(t) ||
      (r.uhid ?? '').toLowerCase().includes(t) ||
      (digits.length >= 4 && (r.contact_no ?? '').includes(digits)) ||
      (digits.length > 0 && digits.length <= 3 && r.cr_no.replace(/\D/g, '').padStart(3, '0') === digits.padStart(3, '0')));
  }, [q, rows]);

  return (
    <View style={{ flex: 1 }}>
      <TextInput value={q} onChangeText={setQ} placeholder="Search HD number, name, UHID or phone"
        placeholderTextColor="#98A2AE" style={[s.input, { margin: 12 }]} />
      <FlatList data={shown} keyExtractor={r => r.patient_id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
        ListEmptyComponent={<Muted>No patients match.</Muted>}
        renderItem={({ item: r }) => (
          <Pressable onPress={() => router.push(`/patient/${r.patient_id}`)}
            style={{ backgroundColor: C.card, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.line }}>
            <View style={s.row}>
              <Text style={{ fontWeight: '700', color: C.ink }}>{r.cr_no}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {r.leprosy_spectrum ? <Chip text={r.leprosy_spectrum} /> : null}
                {r.consecutive_missed >= 2 ? <Chip text={`${r.consecutive_missed} missed`} tone={r.ltfu_flag ? 'bad' : 'warn'} /> : null}
              </View>
            </View>
            <Text style={{ color: C.ink, marginTop: 2 }}>{r.patient_name}</Text>
            <Muted>
              {r.followups_completed}/{r.followups_planned} follow-ups
              {r.next_due_date ? ` · next M${r.next_slot} on ${r.next_due_date}` : ''}
              {r.patient_status && r.patient_status !== 'Active' ? ` · ${r.patient_status}` : ''}
            </Muted>
          </Pressable>
        )} />
    </View>
  );
}
