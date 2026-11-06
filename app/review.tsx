import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { ask, notify } from '../lib/dialog';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { canEdit, useSession } from '../lib/session';
import { fmt } from '../lib/dates';
import { Btn, C, Chip, Muted, page, Screen, TONES } from '../components/ui';
import { GuestBanner, MembersOnly } from '../components/Guest';
import type { Suggestion } from '../components/Suggestions';

type Item = { kind: 'patient' | 'visit' | 'conflict'; record_id: string; patient_id: string; cr_no: string;
  patient_name: string; visit_id: string | null; visit_date: string | null; notes: string[]; conflict_id: number | null };

// Records to check: notes from the import, rows changed in the old app, and changes made in both apps.
export default function Review() {
  const { role, guest } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [sugg, setSugg] = useState<(Suggestion & { patient: { cr_no: string } | null })[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    if (guest) { setLoading(false); return; }
    const [{ data }, sg] = await Promise.all([
      supabase.from('v_review_items').select('*').order('cr_no'),
      supabase.from('suggestions').select('*, patient:patients(cr_no)').is('resolved_at', null).order('created_at', { ascending: false }),
    ]);
    setSugg((sg.data ?? []) as any);
    const rows = (data ?? []) as Item[];
    rows.sort((a, b) => (a.kind === 'conflict' ? 0 : 1) - (b.kind === 'conflict' ? 0 : 1));   // conflicts first
    setItems(rows);
    setLoading(false);
  }, [guest]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function markChecked(it: Item) {
    const table = it.kind === 'patient' ? 'patients' : 'visits';
    const { error } = await supabase.from(table).update({ reviewed_at: new Date().toISOString() }).eq('id', it.record_id);
    if (error) notify('Could not save', error.message); else load();
  }

  async function resolve(it: Item, useSheet: boolean) {
    const msg = useSheet
      ? 'The old app\'s value will replace the new app\'s value, in both places.'
      : 'The new app\'s value is kept and written back over the old sheet.';
    if (!(await ask(useSheet ? 'Use old app value?' : 'Keep new app value?', msg, 'Confirm'))) return;
    const { error } = await supabase.rpc('resolve_sheet_conflict', { p_id: it.conflict_id, p_use_sheet: useSheet });
    if (error) notify('Could not save', error.message); else load();
  }

  const open = (it: Item) => router.push(it.kind === 'patient' || (it.kind === 'conflict' && !it.visit_id) ? `/patient/${it.patient_id}` : `/visit/${it.record_id}`);

  if (guest) return <Screen><GuestBanner /><MembersOnly what="The review list (import notes, sheet changes and team suggestions)" /></Screen>;

  return (
    <FlatList data={items} keyExtractor={i => i.kind + i.record_id + (i.conflict_id ?? '')}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      style={{ backgroundColor: C.bg }} contentContainerStyle={page}
      ListHeaderComponent={<View>
        {sugg.length ? (
          <View style={{ backgroundColor: TONES.blue.bg, borderColor: TONES.blue.border, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: C.primary, marginBottom: 4 }}>Suggestions from the team ({sugg.length})</Text>
            {sugg.map(x => (
              <Pressable key={x.id} onPress={() => router.push(x.visit_id ? `/visit/${x.visit_id}` : `/patient/${x.patient_id}`)}
                style={{ borderTopWidth: 1, borderTopColor: TONES.blue.border, paddingVertical: 8 }}>
                <Text style={{ color: C.ink }}><Text style={{ fontWeight: '800' }}>{x.patient?.cr_no}{x.visit_id ? ' · visit' : ''}: </Text>{x.body}</Text>
                <Muted>{x.author_email ?? 'Team member'} · {fmt(x.created_at.slice(0, 10))}</Muted>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Muted>{items.length} records to check. Open each one, correct it from the report, then mark it checked.</Muted>
      </View>}
      ListEmptyComponent={<Muted>Nothing to check.</Muted>}
      renderItem={({ item: it }) => {
        const conflict = it.kind === 'conflict';
        return (
          <View style={{ backgroundColor: conflict ? TONES.pink.bg : C.card, borderRadius: 14, padding: 14, marginTop: 10,
            borderWidth: 1, borderColor: conflict ? TONES.pink.border : C.line }}>
            <Pressable onPress={() => open(it)}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Chip text={conflict ? 'Changed in both apps' : it.kind === 'patient' ? 'Patient' : 'Visit'}
                  tone={conflict ? 'bad' : it.kind === 'patient' ? 'info' : 'warn'} />
                <Text style={{ fontWeight: '700', color: C.ink }}>{it.cr_no}</Text>
                <Text style={{ color: C.quiet, flexShrink: 1 }} numberOfLines={1}>
                  {it.visit_id ? `${it.visit_id.split('__')[0]} · ${fmt(it.visit_date)}` : it.patient_name}
                </Text>
              </View>
              {it.notes.map((n, i) => <Text key={i} style={{ color: C.ink, marginTop: 4 }}>• {n.replace('Changed in both apps · ', '')}</Text>)}
            </Pressable>
            {canEdit(role) && conflict ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Btn kind="ghost" title="Use old app value" onPress={() => resolve(it, true)} /></View>
                <View style={{ flex: 1 }}><Btn title="Keep new app value" onPress={() => resolve(it, false)} /></View>
              </View>
            ) : canEdit(role) ? <Btn kind="ghost" title="Mark checked" onPress={() => markChecked(it)} /> : null}
          </View>
        );
      }} />
  );
}
