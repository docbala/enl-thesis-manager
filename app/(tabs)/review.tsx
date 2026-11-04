import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { ask, notify } from '../../lib/dialog';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { canEdit, useSession } from '../../lib/session';
import { Btn, C, Chip, Muted, page } from '../../components/ui';

type Item = { kind: 'patient' | 'visit'; record_id: string; patient_id: string; cr_no: string;
  patient_name: string; visit_id: string | null; visit_date: string | null; notes: string[] };

// Records the import set aside. Fix the record (tap to open), then mark it checked.
export default function Review() {
  const { role } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('v_review_items').select('*').order('cr_no');
    setItems((data ?? []) as Item[]);
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function markChecked(it: Item) {
    const table = it.kind === 'patient' ? 'patients' : 'visits';
    const { error } = await supabase.from(table).update({ reviewed_at: new Date().toISOString() }).eq('id', it.record_id);
    if (error) notify('Could not save', error.message); else load();
  }

  return (
    <FlatList data={items} keyExtractor={i => i.kind + i.record_id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      style={{ backgroundColor: C.bg }} contentContainerStyle={page}
      ListHeaderComponent={<Muted>{items.length} records to check. Open each one, correct it from the report, then mark it checked.</Muted>}
      renderItem={({ item: it }) => (
        <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 14, marginTop: 10, borderWidth: 1, borderColor: C.line }}>
          <Pressable onPress={() => router.push(it.kind === 'patient' ? `/patient/${it.patient_id}` : `/visit/${it.record_id}`)}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Chip text={it.kind === 'patient' ? 'Patient' : 'Visit'} tone={it.kind === 'patient' ? 'info' : 'warn'} />
              <Text style={{ fontWeight: '700', color: C.ink }}>{it.cr_no}</Text>
              <Text style={{ color: C.quiet, flexShrink: 1 }} numberOfLines={1}>{it.visit_id ? `${it.visit_id} · ${it.visit_date}` : it.patient_name}</Text>
            </View>
            {it.notes.map((n, i) => <Text key={i} style={{ color: C.ink, marginTop: 4 }}>• {n}</Text>)}
          </Pressable>
          {canEdit(role) ? <Btn kind="ghost" title="Mark checked" onPress={() => markChecked(it)} /> : null}
        </View>
      )} />
  );
}
