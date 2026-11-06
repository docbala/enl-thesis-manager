import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase, tbl } from '../lib/supabase';
import { useSession } from '../lib/session';
import type { Patient, Progress } from '../lib/types';
import { fmt } from '../lib/dates';
import { C, Chip, Muted, page, s } from '../components/ui';
import { Avatar, useAvatars } from '../components/Avatar';
import { GuestBanner } from '../components/Guest';

export type MasterFilter = 'all' | 'confirmed' | 'awaiting' | 'enl' | 'naive';
const FILTERS: { key: MasterFilter; label: string }[] = [
  { key: 'all', label: 'All enrolled' }, { key: 'confirmed', label: 'Confirmed' }, { key: 'awaiting', label: 'Awaiting SSS/Biopsy' },
  { key: 'enl', label: 'ENL' }, { key: 'naive', label: 'Newly diagnosed' },
];
type Sort = 'cr' | 'name' | 'enrolled' | 'last';

type Row = Patient & { visits: number; lastVisit: string | null; prog?: Progress };
const isAwaiting = (p: Patient) => p.cr_no.startsWith('SUS-') || (p.diagnostic_status ?? '').startsWith('Awaiting');
export const matches = (p: Patient, f: MasterFilter) =>
  f === 'all' ? true : f === 'confirmed' ? p.cr_no.startsWith('HD-') : f === 'awaiting' ? isAwaiting(p)
  : f === 'enl' ? !!p.enl_developed : (p.mdt_status ?? '').includes('Naive');

// Master list, like the legacy app: every patient with the key details; tap a row to open the profile.
export default function Master() {
  const { filter: f0 } = useLocalSearchParams<{ filter?: MasterFilter }>();
  const { guest } = useSession();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<MasterFilter>(f0 && FILTERS.some(x => x.key === f0) ? f0 : 'all');
  const [sort, setSort] = useState<Sort>('cr');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [pt, pg, vs] = await Promise.all([
      supabase.from(tbl('patients')).select('*').is('deleted_at', null),
      supabase.from(tbl('v_patient_progress')).select('*'),
      supabase.from(tbl('visits')).select('patient_id, visit_date').is('deleted_at', null),
    ]);
    const prog = new Map(((pg.data ?? []) as Progress[]).map(r => [r.patient_id, r]));
    const count = new Map<string, { n: number; last: string | null }>();
    for (const v of (vs.data ?? []) as { patient_id: string; visit_date: string }[]) {
      const c = count.get(v.patient_id) ?? { n: 0, last: null };
      count.set(v.patient_id, { n: c.n + 1, last: !c.last || v.visit_date > c.last ? v.visit_date : c.last });
    }
    setRows(((pt.data ?? []) as Patient[]).map(p => ({ ...p, visits: count.get(p.id)?.n ?? 0, lastVisit: count.get(p.id)?.last ?? null, prog: prog.get(p.id) })));
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase(), digits = t.replace(/\D/g, '');
    const list = rows.filter(p => matches(p, filter)).filter(p => !t || p.cr_no.toLowerCase().includes(t) || p.patient_name.toLowerCase().includes(t)
      || (p.uhid ?? '').toLowerCase().includes(t) || (digits.length >= 4 && String(p.contact_no ?? '').includes(digits)));
    const by: Record<Sort, (a: Row, b: Row) => number> = {
      cr: (a, b) => a.cr_no.localeCompare(b.cr_no, undefined, { numeric: true }),
      name: (a, b) => a.patient_name.localeCompare(b.patient_name),
      enrolled: (a, b) => (b.enrollment_date ?? '').localeCompare(a.enrollment_date ?? ''),
      last: (a, b) => (b.lastVisit ?? '').localeCompare(a.lastVisit ?? ''),
    };
    return list.sort(by[sort]);
  }, [rows, filter, sort, q]);
  const avatars = useAvatars(shown.map(p => p.id));
  const counts = Object.fromEntries(FILTERS.map(x => [x.key, rows.filter(p => matches(p, x.key)).length])) as Record<MasterFilter, number>;
  const wide = width >= 900;

  const cols: { h: string; w: number; v: (p: Row) => string }[] = [
    { h: 'CR No.', w: 80, v: p => p.cr_no }, ...(guest ? [] : [{ h: 'Name', w: 170, v: (p: Row) => p.patient_name }, { h: 'UHID', w: 110, v: (p: Row) => p.uhid ?? '-' }]),
    { h: 'Age/Sex', w: 70, v: p => `${p.age ?? '?'}/${p.sex?.[0] ?? '?'}` }, { h: 'Diagnosis', w: 120, v: p => `${p.leprosy_spectrum ?? '-'} · ${p.diagnostic_status ?? '-'}` },
    { h: 'MDT', w: 150, v: p => p.mdt_status ?? '-' }, ...(guest ? [] : [{ h: 'Phone', w: 110, v: (p: Row) => p.contact_no ?? '-' }]),
    { h: 'Enrolled', w: 95, v: p => fmt(p.enrollment_date) }, { h: 'Visits', w: 60, v: p => String(p.visits) },
    { h: 'Follow-ups', w: 85, v: p => p.prog ? `${p.prog.followups_completed}/${p.prog.followups_planned}` : '-' },
    { h: 'Last visit', w: 95, v: p => fmt(p.lastVisit) }, { h: 'Next due', w: 110, v: p => p.prog?.next_due_date ? `M${p.prog.next_slot} ${fmt(p.prog.next_due_date)}` : '-' },
    { h: 'ENL', w: 50, v: p => (p.enl_developed ? 'Yes' : '') }, { h: 'Status', w: 90, v: p => p.patient_status ?? 'Active' },
  ];

  const header = (
    <View style={{ marginBottom: 10 }}>
      <GuestBanner compact />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
        {FILTERS.map(x => (
          <Pressable key={x.key} onPress={() => setFilter(x.key)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
            borderColor: filter === x.key ? C.primary : C.line, backgroundColor: filter === x.key ? C.primary : '#fff' }}>
            <Text style={{ color: filter === x.key ? '#fff' : C.ink, fontWeight: '700' }}>{x.label} · {counts[x.key]}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={[s.input, { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }]}>
        <MaterialCommunityIcons name="magnify" size={22} color={C.quiet} />
        <TextInput value={q} onChangeText={setQ} placeholder={guest ? 'Search study number' : 'Search CR no., name, UHID or phone'}
          placeholderTextColor="#98A2AE" style={{ flex: 1, fontSize: 16, paddingVertical: 8, color: C.ink }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
        <Muted>{shown.length} patients · sort:</Muted>
        {([['cr', 'CR no.'], ...(guest ? [] : [['name', 'Name']]), ['enrolled', 'Newest'], ['last', 'Last visit']] as [Sort, string][]).map(([k, l]) => (
          <Pressable key={k} onPress={() => setSort(k)}><Chip text={l} tone={sort === k ? 'good' : undefined} /></Pressable>
        ))}
      </View>
    </View>
  );

  const title = FILTERS.find(x => x.key === filter)!.label;
  if (wide) {
    const total = cols.reduce((a, c) => a + c.w, 0) + 56;
    return (
      <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <Stack.Screen options={{ title: `Master list · ${title}` }} />
        <View style={{ maxWidth: 1400, width: '100%', alignSelf: 'center' }}>
          {header}
          <ScrollView horizontal>
            <View style={{ width: total, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.line }}>
              <View style={{ flexDirection: 'row', backgroundColor: C.tile, borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingVertical: 10, paddingLeft: 56 }}>
                {cols.map(c => <Text key={c.h} style={{ width: c.w, fontWeight: '800', color: C.primary, fontSize: 13, paddingRight: 8 }}>{c.h}</Text>)}
              </View>
              {shown.map(p => (
                <Pressable key={p.id} onPress={() => router.push(`/patient/${p.id}`)}
                  style={({ pressed, hovered }: any) => ({ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 8,
                    backgroundColor: pressed || hovered ? '#F2F6FA' : '#fff' })}>
                  <View style={{ width: 56, alignItems: 'center' }}><Avatar name={p.patient_name} url={avatars[p.id]} size={34} /></View>
                  {cols.map(c => <Text key={c.h} numberOfLines={2} style={{ width: c.w, color: c.h === 'ENL' && p.enl_developed ? C.bad : C.ink, fontSize: 13, paddingRight: 8,
                    fontWeight: c.h === 'CR No.' || c.h === 'Name' ? '700' : '400' }}>{c.v(p)}</Text>)}
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title }} />
      <FlatList data={shown} keyExtractor={p => p.id} contentContainerStyle={page} ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={<Muted>{loading ? 'Loading…' : 'No patients in this list.'}</Muted>}
        renderItem={({ item: p }) => (
          <Pressable onPress={() => router.push(`/patient/${p.id}`)} style={({ pressed }) => [s.person, { alignItems: 'flex-start', opacity: pressed ? 0.85 : 1 }]}>
            <View style={{ marginRight: 12 }}><Avatar name={p.patient_name} url={avatars[p.id]} size={48} /></View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6 }}>
                <Text style={{ fontSize: 16, color: C.ink, flex: 1 }}><Text style={{ fontWeight: '800' }}>{p.patient_name}</Text>{p.patient_name === p.cr_no ? '' : ` (${p.cr_no})`}</Text>
                {p.enl_developed ? <Chip text="ENL" tone="bad" /> : null}
              </View>
              <Text style={{ color: C.quiet, marginTop: 2 }}>
                {[`${p.age ?? '?'}/${p.sex?.[0] ?? '?'}`, p.leprosy_spectrum, p.diagnostic_status, guest ? null : p.uhid && `UHID ${p.uhid}`].filter(Boolean).join(' · ')}
              </Text>
              <Text style={{ color: C.ink, marginTop: 2 }}>{p.mdt_status ?? 'MDT status ?'}{guest || !p.contact_no ? '' : ` · ${p.contact_no}`}</Text>
              <Text style={{ color: C.quiet, marginTop: 2, fontSize: 13 }}>
                {p.visits} visit{p.visits === 1 ? '' : 's'}{p.prog ? ` · ${p.prog.followups_completed}/${p.prog.followups_planned} follow-ups` : ''}
                {p.lastVisit ? ` · last ${fmt(p.lastVisit)}` : ''}{p.prog?.next_due_date ? ` · next M${p.prog.next_slot} ${fmt(p.prog.next_due_date)}` : ''}
              </Text>
            </View>
          </Pressable>
        )} />
    </View>
  );
}
