import { useCallback, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { ask, notify } from '../lib/dialog';
import { toNum } from '../lib/labs';
import { Btn, C, Card, Chip, Choice, Field, H, Muted, Screen, s } from '../components/ui';

type Member = { id: string; email: string; full_name: string | null; role: 'owner' | 'editor' | 'viewer'; can_export: boolean; user_id: string | null; joined_at: string | null };
type Setting = { key: string; value: number; note: string };

const ROLE_NOTE = { owner: 'Everything, including deleting and inviting', editor: 'Add and edit patients and visits', viewer: 'Can see everything, cannot change' };

// Owner only: who can use the app, and the study thresholds used for the steroid flags.
export default function Team() {
  const { role } = useSession();
  const owner = role === 'owner';
  const [members, setMembers] = useState<Member[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [email, setEmail] = useState(''); const [name, setName] = useState('');
  const [newRole, setNewRole] = useState<'editor' | 'viewer'>('editor');
  const [edits, setEdits] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [m, st] = await Promise.all([
      supabase.from('members').select('*').order('invited_at'),
      supabase.from('study_settings').select('*').order('key'),
    ]);
    setMembers((m.data ?? []) as Member[]); setSettings((st.data ?? []) as Setting[]);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function invite() {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { notify('Check the email', 'Enter a valid email address.'); return; }
    const { error } = await supabase.from('members').insert({ email: e, full_name: name.trim() || null, role: newRole, can_export: false });
    if (error) { notify('Could not invite', error.message.includes('duplicate') ? 'This email is already a member.' : error.message); return; }
    notify('Invited', `${e} can now sign up at the app link with this email and will get ${newRole} access.`);
    setEmail(''); setName(''); load();
  }

  async function update(m: Member, patch: Partial<Member>) {
    const { error } = await supabase.from('members').update(patch).eq('id', m.id);
    if (error) notify('Could not save', error.message); else load();
  }

  async function remove(m: Member) {
    if (!(await ask('Remove access?', `${m.email} will no longer see any patient data.`, 'Remove', true))) return;
    const { error } = await supabase.from('members').delete().eq('id', m.id);
    if (error) notify('Could not remove', error.message); else load();
  }

  async function saveSetting(st: Setting) {
    const v = toNum(edits[st.key]);
    if (v == null || v < 0) { notify('Check the value', 'Enter a number.'); return; }
    const { error } = await supabase.from('study_settings').update({ value: v }).eq('key', st.key);
    if (error) notify('Could not save', error.message); else { setEdits(prev => { const n = { ...prev }; delete n[st.key]; return n; }); load(); }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Team & settings' }} />
      <Card>
        <H>Team ({members.length})</H>
        {members.map(m => (
          <View key={m.id} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 10 }}>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontWeight: '700' }}>{m.full_name ?? m.email}</Text>
                {m.full_name ? <Muted>{m.email}</Muted> : null}
              </View>
              <Chip text={m.user_id ? 'Joined' : 'Invited, not signed up yet'} tone={m.user_id ? 'good' : 'warn'} />
            </View>
            {owner && m.role !== 'owner' ? (
              <View style={{ marginTop: 6 }}>
                <Choice value={m.role} options={['editor', 'viewer']} onChange={r => update(m, { role: r })} />
                <View style={s.row}>
                  <Text style={{ color: C.ink }}>Can export the dataset</Text>
                  <Switch value={m.can_export} onValueChange={v => update(m, { can_export: v })} />
                </View>
                <Btn kind="ghost" title="Remove access" onPress={() => remove(m)} />
              </View>
            ) : <Muted>{m.role} · {ROLE_NOTE[m.role]}{m.can_export ? ' · can export' : ''}</Muted>}
          </View>
        ))}
      </Card>

      {owner ? (
        <Card>
          <H>Invite a co-resident or guide</H>
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Dr. Pritica Debnath Mathur" />
          <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <Choice value={newRole} options={['editor', 'viewer']} onChange={setNewRole} />
          <Muted>{ROLE_NOTE[newRole]}. They sign up at the app link with this same email.</Muted>
          <Btn title="Invite" onPress={invite} />
        </Card>
      ) : null}

      <Card>
        <H>Study thresholds</H>
        <Muted>Used for the ESS band and the steroid flags. Agree these with your guide.</Muted>
        {settings.map(st => (
          <View key={st.key} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 8, marginTop: 6 }}>
            <Text style={{ color: C.ink, fontWeight: '600' }}>{st.note}</Text>
            {owner ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <Field label="Value" keyboardType="decimal-pad" value={edits[st.key] ?? String(st.value)}
                    onChangeText={t => setEdits(prev => ({ ...prev, [st.key]: t }))} />
                </View>
                {edits[st.key] !== undefined && edits[st.key] !== String(st.value)
                  ? <View style={{ marginBottom: 12 }}><Btn title="Save" onPress={() => saveSetting(st)} /></View> : null}
              </View>
            ) : <Text style={{ color: C.primary, fontWeight: '800' }}>{st.value}</Text>}
          </View>
        ))}
      </Card>
    </Screen>
  );
}
