import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { canEdit, useSession } from '../../lib/session';
import type { Progress } from '../../lib/types';
import { Btn, C, Card, Chip, H, Muted, s } from '../../components/ui';

const TARGET = 100;

export default function Dashboard() {
  const { role, session } = useSession();
  const [rows, setRows] = useState<Progress[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState(0);
  const [pendingSync, setPendingSync] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [prog, pts, rv, sq] = await Promise.all([
      supabase.from('v_patient_progress').select('*'),
      supabase.from('patients').select('id, patient_status').is('deleted_at', null),
      supabase.from('v_review_items').select('record_id', { count: 'exact', head: true }),
      supabase.from('sync_queue').select('id', { count: 'exact', head: true }).is('done_at', null),
    ]);
    setRows((prog.data ?? []) as Progress[]);
    setStatuses(Object.fromEntries((pts.data ?? []).map((p: any) => [p.id, p.patient_status ?? ''])));
    setFlagged(rv.count ?? 0);
    setPendingSync(sq.error ? null : sq.count ?? 0);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!role) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Card>
          <H>Waiting for access</H>
          <Muted>You are signed in as {session?.user.email}, but this email has not been invited yet. Ask the study owner to add you.</Muted>
          <Btn kind="ghost" title="Sign out" onPress={() => supabase.auth.signOut()} />
        </Card>
      </ScrollView>
    );
  }

  const confirmed = rows.filter(r => r.cr_no.startsWith('HD-')).length;
  const suspected = rows.filter(r => r.cr_no.startsWith('SUS-')).length;
  const done = rows.reduce((a, r) => a + (r.followups_completed ?? 0), 0);
  const missed = rows.reduce((a, r) => a + (r.followups_missed ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const dueThisWeek = rows.filter(r => r.next_due_date && r.next_due_date >= today && r.next_due_date <= in7)
    .sort((a, b) => (a.next_due_date! < b.next_due_date! ? -1 : 1));
  const noBaseline = rows.filter(r => !r.has_baseline && statuses[r.patient_id] === 'Active');
  const atRisk = rows.filter(r => r.consecutive_missed >= 2).sort((a, b) => b.consecutive_missed - a.consecutive_missed);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Card>
        <View style={s.row}>
          <View>
            <Text style={{ fontSize: 30, fontWeight: '700', color: C.primary }}>{confirmed}<Text style={{ fontSize: 16, color: C.quiet }}> / {TARGET}</Text></Text>
            <Muted>confirmed patients enrolled{suspected ? ` · ${suspected} suspected` : ''}</Muted>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: C.ink }}>{done + missed ? Math.round(100 * done / (done + missed)) : 0}%</Text>
            <Muted>follow-up adherence</Muted>
          </View>
        </View>
        <View style={{ height: 8, backgroundColor: C.line, borderRadius: 4, marginTop: 12 }}>
          <View style={{ width: `${Math.min(100, confirmed)}%`, height: 8, backgroundColor: C.primary, borderRadius: 4 }} />
        </View>
        <Muted>{done} follow-ups done · {missed} missed</Muted>
      </Card>

      {canEdit(role) ? <Btn title="+ Enrol new patient" onPress={() => router.push('/patient/new')} /> : null}

      {flagged ? (
        <Pressable onPress={() => router.push('/review')}>
          <Card style={{ backgroundColor: C.warnBg, borderColor: C.warn }}>
            <Text style={{ color: C.warn, fontWeight: '700' }}>{flagged} imported records need checking</Text>
            <Muted>Tap to open the review list</Muted>
          </Card>
        </Pressable>
      ) : null}

      <Card>
        <H>Due in the next 7 days ({dueThisWeek.length})</H>
        {dueThisWeek.length === 0 ? <Muted>Nothing due.</Muted> : dueThisWeek.map(r => (
          <Pressable key={r.patient_id} onPress={() => router.push(`/patient/${r.patient_id}`)} style={[s.row, { paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: C.ink }}>{r.cr_no} · {r.patient_name}</Text>
              <Muted>Month {r.next_slot} due {r.next_due_date}</Muted>
            </View>
            <Chip text={`M${r.next_slot}`} />
          </Pressable>
        ))}
      </Card>

      <Card>
        <H>Missed 2 or more visits in a row ({atRisk.length})</H>
        {atRisk.length === 0 ? <Muted>None.</Muted> : atRisk.map(r => (
          <Pressable key={r.patient_id} onPress={() => router.push(`/patient/${r.patient_id}`)} style={[s.row, { paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line }]}>
            <Text style={{ flex: 1, color: C.ink }}>{r.cr_no} · {r.patient_name}</Text>
            <Chip text={`${r.consecutive_missed} missed`} tone={r.ltfu_flag ? 'bad' : 'warn'} />
          </Pressable>
        ))}
      </Card>

      <Card>
        <H>No baseline visit yet ({noBaseline.length})</H>
        {noBaseline.length === 0 ? <Muted>All active patients have a baseline.</Muted> : noBaseline.map(r => (
          <Pressable key={r.patient_id} onPress={() => router.push(`/patient/${r.patient_id}`)} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line }}>
            <Text style={{ color: C.ink }}>{r.cr_no} · {r.patient_name}</Text>
          </Pressable>
        ))}
      </Card>

      {pendingSync !== null ? <Muted>Google Sheet copy: {pendingSync} change{pendingSync === 1 ? '' : 's'} waiting</Muted> : null}
      <Btn kind="ghost" title="Sign out" onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}
