import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/session';
import { notify } from '../../lib/dialog';
import { fmt } from '../../lib/dates';
import { Category, markRead, Note, useNotifications } from '../../lib/notifications';
import { C, Muted, page, TONES } from '../../components/ui';
import { GuestBanner, MembersOnly } from '../../components/Guest';

const ORDER: Category[] = ['Team', 'Follow-up', 'ENL & steroids', 'Labs', 'Needs checking', 'System'];
const ICON: Record<Category, keyof typeof MaterialCommunityIcons.glyphMap> = {
  'Follow-up': 'calendar-alert', Labs: 'test-tube', 'ENL & steroids': 'pill', Team: 'account-multiple', 'Needs checking': 'flag', System: 'cog-outline',
};
const LEVEL = { high: { c: '#C53030', t: 'Urgent' }, medium: { c: '#B7791F', t: 'Soon' }, info: { c: '#2a78d6', t: 'FYI' } };

export default function Notifications() {
  const { role, guest } = useSession();
  const { notes, read, unread, refresh } = useNotifications(role);
  const [loading, setLoading] = useState(false);
  const [cat, setCat] = useState<Category | 'All'>('All');
  const [showRead, setShowRead] = useState(false);

  const reload = useCallback(async () => { setLoading(true); await refresh(); setLoading(false); }, [refresh]);
  useFocusEffect(useCallback(() => { if (role) reload(); }, [role]));

  const cats = useMemo(() => ORDER.filter(c => notes.some(n => n.category === c)), [notes]);
  const shown = notes.filter(n => (cat === 'All' || n.category === cat) && (showRead || !read.has(n.key)));
  const hiddenRead = notes.filter(n => (cat === 'All' || n.category === cat) && read.has(n.key)).length;

  async function approve(n: Note, role: 'viewer' | 'editor' | null) {
    const a = n.action!;
    const { error } = await supabase.rpc('handle_access_request', { p_user: a.userId, p_role: role ?? 'viewer', p_approve: !!role });
    if (error) { notify('Could not update', error.message); return; }
    notify(role ? 'Approved' : 'Declined', role ? `${a.email} can now see the data as ${role === 'editor' ? 'an editor' : 'a viewer'}. Change it any time in Team & settings.` : `${a.email} keeps the de-identified view only.`);
    await markRead([n.key]); reload();
  }

  if (guest) return <ScrollView contentContainerStyle={page}><GuestBanner /><MembersOnly what="Notifications" /></ScrollView>;

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={page} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: C.primary }}>{unread ? `${unread} new` : 'All caught up'}</Text>
        {unread ? <Text onPress={() => markRead(shown.map(n => n.key))} style={{ color: C.primary, fontWeight: '700' }}>Mark all read</Text> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
        {(['All', ...cats] as (Category | 'All')[]).map(c => {
          const n = notes.filter(x => (c === 'All' || x.category === c) && !read.has(x.key)).length;
          return (
            <Pressable key={c} onPress={() => setCat(c)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
              borderColor: cat === c ? C.primary : C.line, backgroundColor: cat === c ? C.primary : '#fff' }}>
              <Text style={{ color: cat === c ? '#fff' : C.ink, fontWeight: '700' }}>{c}{n ? ` · ${n}` : ''}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {!shown.length ? <Muted>{loading ? 'Checking…' : 'Nothing new here.'}</Muted> : null}
      {shown.map(n => {
        const isRead = read.has(n.key), lv = LEVEL[n.level];
        return (
          <Pressable key={n.key} onPress={() => { markRead([n.key]); if (n.route) router.push(n.route as any); }}
            style={({ pressed }) => ({ flexDirection: 'row', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10,
              borderWidth: 1, borderColor: C.line, borderLeftWidth: 4, borderLeftColor: lv.c, opacity: pressed ? 0.85 : isRead ? 0.65 : 1 })}>
            <MaterialCommunityIcons name={ICON[n.category]} size={24} color={lv.c} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: C.ink, fontWeight: isRead ? '600' : '800', flex: 1 }}>{n.title}</Text>
                {!isRead ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: lv.c, marginTop: 5 }} /> : null}
              </View>
              <Text style={{ color: C.ink, marginTop: 2 }}>{n.body}</Text>
              <Text style={{ color: C.quiet, fontSize: 12, marginTop: 4 }}>{lv.t} · {n.category} · {fmt(n.date)}</Text>
              {n.action?.kind === 'access' && role === 'owner' ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {([['viewer', 'Allow view only', TONES.blue], ['editor', 'Allow editing', TONES.green]] as const).map(([r, label, tone]) => (
                    <Pressable key={r} onPress={() => approve(n, r)} style={{ backgroundColor: tone.bg, borderColor: tone.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                      <Text style={{ color: tone.title, fontWeight: '800' }}>{label}</Text>
                    </Pressable>
                  ))}
                  <Pressable onPress={() => approve(n, null)} style={{ borderColor: C.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                    <Text style={{ color: C.quiet, fontWeight: '800' }}>Decline</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
      {hiddenRead ? <Text onPress={() => setShowRead(v => !v)} style={{ color: C.primary, fontWeight: '700', textAlign: 'center', padding: 8 }}>
        {showRead ? 'Hide read' : `Show ${hiddenRead} read`}</Text> : null}
    </ScrollView>
  );
}
