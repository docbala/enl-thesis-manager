import { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { canEdit, useSession } from '../lib/session';
import { ask, notify } from '../lib/dialog';
import { fmt } from '../lib/dates';
import { Btn, C, Card, H, Muted, s } from './ui';

export type Suggestion = { id: string; patient_id: string; visit_id: string | null; body: string; created_by: string; author_email: string | null;
  created_at: string; resolved_at: string | null; resolution: string | null };

// Any signed-in team member (guides with view-only rights too) can leave a suggestion; editors mark it done.
export function Suggestions({ patientId, visitId, refreshKey }: { patientId: string; visitId?: string | null; refreshKey?: number }) {
  const { session, role } = useSession();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    let q = supabase.from('suggestions').select('*').eq('patient_id', patientId).order('created_at', { ascending: false });
    if (visitId) q = q.eq('visit_id', visitId);
    const { data } = await q;
    setItems((data ?? []) as Suggestion[]);
  }, [patientId, visitId]);
  useEffect(() => { if (session && role) load(); }, [load, refreshKey, session, role]);
  if (!session || !role) return null;

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('suggestions').insert({ patient_id: patientId, visit_id: visitId ?? null, body: text.trim() });
    setBusy(false);
    if (error) notify('Could not save', error.message); else { setText(''); load(); }
  }
  async function resolve(x: Suggestion) {
    if (!(await ask('Mark as done?', x.body, 'Done'))) return;
    const { error } = await supabase.from('suggestions').update({ resolved_at: new Date().toISOString(), resolved_by: session!.user.id }).eq('id', x.id);
    if (error) notify('Could not save', error.message); else load();
  }
  async function remove(x: Suggestion) {
    const { error } = await supabase.from('suggestions').delete().eq('id', x.id);
    if (error) notify('Could not remove', error.message); else load();
  }

  const open = items.filter(x => !x.resolved_at), done = items.filter(x => x.resolved_at);
  return (
    <Card>
      <View style={s.row}>
        <H>Suggestions{open.length ? ` (${open.length})` : ''}</H>
        {done.length ? <Text onPress={() => setShowDone(v => !v)} style={{ color: C.primary, fontWeight: '700' }}>{showDone ? 'Hide done' : `${done.length} done`}</Text> : null}
      </View>
      {[...open, ...(showDone ? done : [])].map(x => (
        <View key={x.id} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 8, opacity: x.resolved_at ? 0.6 : 1 }}>
          <Text style={{ color: C.ink }}>{x.body}</Text>
          <Muted>{x.author_email ?? 'Team member'} · {fmt(x.created_at.slice(0, 10))}{x.resolved_at ? ` · done ${fmt(x.resolved_at.slice(0, 10))}` : ''}</Muted>
          {!x.resolved_at ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {canEdit(role) ? <View style={{ flex: 1 }}><Btn kind="success" title="Mark done" onPress={() => resolve(x)} /></View> : null}
              {x.created_by === session.user.id ? <View style={{ flex: 1 }}><Btn kind="ghost" title="Withdraw" onPress={() => remove(x)} /></View> : null}
            </View>
          ) : null}
        </View>
      ))}
      <TextInput value={text} onChangeText={setText} multiline placeholder={visitId ? 'Suggest a change to this visit…' : 'Suggest a change for this patient…'}
        placeholderTextColor="#98A2AE" style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, minHeight: 60, color: C.ink, marginTop: 8, backgroundColor: '#fff' }} />
      <Btn title="Send suggestion" onPress={add} busy={busy} />
    </Card>
  );
}
