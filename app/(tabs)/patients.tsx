import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase, tbl } from '../../lib/supabase';
import type { Progress } from '../../lib/types';
import { fmt } from '../../lib/dates';
import { C, Chip, Muted, page, PersonRow, s } from '../../components/ui';
import { Avatar, useAvatars } from '../../components/Avatar';

type Row = Progress & { uhid: string | null; contact_no: string | null; patient_status: string | null; enl_developed: boolean | null };

export default function Patients() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [prog, pts] = await Promise.all([
      supabase.from(tbl('v_patient_progress')).select('*'),
      supabase.from(tbl('patients')).select('id, uhid, contact_no, patient_status, enl_developed').is('deleted_at', null),
    ]);
    const extra = new Map((pts.data ?? []).map((p: any) => [p.id, p]));
    const merged = ((prog.data ?? []) as Progress[]).map(r => ({ ...r, ...(extra.get(r.patient_id) ?? {}) })) as Row[];
    merged.sort((a, b) => a.cr_no.localeCompare(b.cr_no));
    setRows(merged);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const avatars = useAvatars(rows.map(r => r.patient_id));

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
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList data={shown} keyExtractor={r => r.patient_id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={page}
        ListHeaderComponent={
          <View style={{ marginBottom: 12 }}>
            <View style={[s.input, { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }]}>
              <MaterialCommunityIcons name="magnify" size={22} color={C.quiet} />
              <TextInput value={q} onChangeText={setQ} placeholder="Search HD number, name, UHID or phone"
                placeholderTextColor="#98A2AE" style={{ flex: 1, fontSize: 16, paddingVertical: 8, color: C.ink }} />
            </View>
            <Muted>{shown.length} of {rows.length} patients</Muted>
          </View>
        }
        ListEmptyComponent={<Muted>No patients match.</Muted>}
        renderItem={({ item: r }) => (
          <PersonRow name={r.patient_name} id={r.cr_no} left={<Avatar name={r.patient_name} url={avatars[r.patient_id]} size={48} />}
            badge={r.mdt_status?.includes('Naive') ? 'Newly Diagnosed (Naive)' : null}
            sub={`${r.leprosy_spectrum ?? '-'} · ${r.followups_completed}/${r.followups_planned} follow-ups${r.next_due_date ? ` · next M${r.next_slot} ${fmt(r.next_due_date)}` : ''}`}
            onPress={() => router.push(`/patient/${r.patient_id}`)}
            right={
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {r.enl_developed ? <Chip text="ENL" tone="bad" /> : null}
                  {r.consecutive_missed >= 2 ? <Chip text={`${r.consecutive_missed} missed`} tone={r.ltfu_flag ? 'bad' : 'warn'} /> : null}
                  {r.patient_status && r.patient_status !== 'Active' ? <Chip text={r.patient_status} tone="warn" /> : null}
                </View>
              </View>
            } />
        )} />
    </View>
  );
}
