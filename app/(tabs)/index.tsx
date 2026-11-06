import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase, tbl } from '../../lib/supabase';
import { canEdit, useSession } from '../../lib/session';
import { GuestBanner } from '../../components/Guest';
import { UpdateNotice } from '../../components/UpdateNotice';
import { ExportSheet } from '../../components/ExportSheet';
import { Fab } from '../../components/Fab';
import { daysSince, noLabValues, LAB_KEYS } from '../../lib/study';
import type { Patient, Progress, Slot } from '../../lib/types';
import { ask, notify } from '../../lib/dialog';
import { comingSaturday, reminderText } from '../../lib/messages';
import { fmt, todayISO } from '../../lib/dates';
import {
  Btn, C, Card, Chip, ContactButtons, HeaderCard, Muted, PersonRow, ProgressCard, Screen, Section, StatTile, TONES,
} from '../../components/ui';

const TARGET_PATIENTS = 100;

type LastVisit = { id: string; patient_id: string; visit_type: string; visit_date: string; labs_not_ordered?: boolean; [k: string]: unknown };
type SteroidFlag = { patient_id: string; cr_no: string; patient_name: string; taper_relapses: number; stop_relapses: number;
  steroid_dependent: boolean; possible_nonresponder: boolean; current_mg: number | null };

export default function Dashboard() {
  const { role, session } = useSession();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [last, setLast] = useState<Map<string, LastVisit>>(new Map());
  const [toReview, setToReview] = useState(0);
  const [pendingSync, setPendingSync] = useState<number | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [flags, setFlags] = useState<SteroidFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [noLabVisits, setNoLabVisits] = useState<LastVisit[]>([]);
  const [reminded, setReminded] = useState<Map<string, string>>(new Map());   // patient -> channel, last 7 days

  const load = useCallback(async () => {
    setLoading(true);
    const [pt, pg, sl, vs, rv, sq, me, rm, fl] = await Promise.all([
      supabase.from(tbl('patients')).select('*').is('deleted_at', null),
      supabase.from(tbl('v_patient_progress')).select('*'),
      supabase.from(tbl('v_schedule')).select('*'),
      supabase.from(tbl('visits')).select(['id', 'patient_id', 'visit_type', 'visit_date', 'labs_not_ordered', ...LAB_KEYS].join(',')).is('deleted_at', null).order('visit_date', { ascending: false }),
      role ? supabase.from('v_review_items').select('record_id', { count: 'exact', head: true }) : Promise.resolve({ count: 0 } as any),
      role ? supabase.from('sync_queue').select('id', { count: 'exact', head: true }).is('done_at', null) : Promise.resolve({ error: true } as any),
      role && session ? supabase.from('members').select('can_export').eq('user_id', session.user.id).maybeSingle() : Promise.resolve({ data: null } as any),
      role ? supabase.from('reminder_log').select('patient_id, channel, sent_at').gt('sent_at', new Date(Date.now() - 7 * 86400000).toISOString()).order('sent_at') : Promise.resolve({ data: [] } as any),
      supabase.from(tbl('v_steroid_flags')).select('*'),
    ]);
    setFlags(((fl.data ?? []) as SteroidFlag[]).filter(f => f.steroid_dependent || f.possible_nonresponder || f.taper_relapses > 0 || f.stop_relapses > 0)
      .sort((a, b) => a.cr_no.localeCompare(b.cr_no)));
    setPatients((pt.data ?? []) as Patient[]);
    setProgress((pg.data ?? []) as Progress[]);
    setSlots((sl.data ?? []) as Slot[]);
    const m = new Map<string, LastVisit>();
    for (const v of (vs.data ?? []) as unknown as LastVisit[]) if (!m.has(v.patient_id)) m.set(v.patient_id, v);
    setLast(m);
    setNoLabVisits(((vs.data ?? []) as unknown as LastVisit[]).filter(v => noLabValues(v)));
    setToReview(rv.count ?? 0);
    setPendingSync(sq.error ? null : sq.count ?? 0);
    setCanExport(!!me.data?.can_export);
    setReminded(new Map(((rm.data ?? []) as { patient_id: string; channel: string }[]).map(r => [r.patient_id, r.channel])));
    setLoading(false);
  }, [session?.user.id, role]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const view = useMemo(() => {
    const today = todayISO();
    const sat = comingSaturday();
    const byId = new Map(patients.map(p => [p.id, p]));
    const active = patients.filter(p => (p.patient_status ?? 'Active') === 'Active');
    // Saturday list: a follow-up month whose window is open on the coming Saturday and has no visit yet
    const saturday = slots
      .filter(x => !x.is_baseline && !x.visit_uuid && x.opens_on <= sat && sat < x.closes_on && byId.get(x.patient_id)?.patient_status === 'Active')
      .sort((a, b) => a.cr_no.localeCompare(b.cr_no));
    const awaiting = patients.filter(p => p.cr_no.startsWith('SUS-') || (p.diagnostic_status ?? '').startsWith('Awaiting'))
      .sort((a, b) => a.cr_no.localeCompare(b.cr_no));
    // Pending reports: months already due with no visit (and missing baselines)
    const pending = new Map<string, string[]>();
    for (const x of slots) {
      if (x.visit_uuid || byId.get(x.patient_id)?.patient_status !== 'Active') continue;
      if (x.is_baseline || x.due_date < today) {
        const label = x.is_baseline ? 'Baseline' : `Month ${x.slot_month}`;
        pending.set(x.patient_id, [...(pending.get(x.patient_id) ?? []), label]);
      }
    }
    const labRows = noLabVisits.filter(v => byId.get(v.patient_id))
      .map(v => ({ key: 'v' + v.id, p: byId.get(v.patient_id)!, route: `/visit/${v.id}`, kind: 'labs' as const,
        text: `${v.visit_type} on ${fmt(v.visit_date)}: no lab values yet (${daysSince(v.visit_date)} day${daysSince(v.visit_date) === 1 ? '' : 's'})` }))
      .sort((a, b) => b.text.localeCompare(a.text));
    const overdueRows = [...pending.entries()].filter(([id]) => byId.get(id))
      .map(([id, months]) => ({ key: 'p' + id, p: byId.get(id)!, route: `/patient/${id}`, kind: 'overdue' as const, text: `Visit not logged: ${months.join(', ')}` }))
      .sort((a, b) => a.p.cr_no.localeCompare(b.p.cr_no));
    const pendingRows = [...labRows, ...overdueRows];
    const confirmed = patients.filter(p => p.cr_no.startsWith('HD-')).length;
    const done = progress.reduce((a, r) => a + r.followups_completed, 0);
    const due = progress.reduce((a, r) => a + r.followups_completed + r.followups_missed, 0);
    // Each confirmed patient has their own schedule: 12 months minus the MDT months already done at enrolment.
    const conf = new Set(patients.filter(p => p.cr_no.startsWith('HD-')).map(p => p.id));
    const scheduled = progress.filter(r => conf.has(r.patient_id)).reduce((a, r) => a + r.followups_planned, 0);
    const visitsDone = progress.filter(r => conf.has(r.patient_id)).reduce((a, r) => a + r.followups_completed, 0);
    return {
      sat, saturday, awaiting, pendingRows, confirmed, done, due, visitsDone, scheduled, activeCount: active.length,
      enl: patients.filter(p => p.enl_developed).length, byId, total: patients.length,
      naiveCount: patients.filter(p => (p.mdt_status ?? '').includes('Naive')).length,
    };
  }, [patients, progress, slots, noLabVisits]);

  async function confirmCase(p: Patient) {
    if (!(await ask('Confirm report?', `${p.patient_name} (${p.cr_no}) will be marked Confirmed and get the next HD number.`, 'Confirm'))) return;
    const { data, error } = await supabase.rpc('confirm_suspected', { p_patient: p.id });
    if (error) notify('Could not confirm', error.message); else { notify('Confirmed', `New study number: ${data}`); load(); }
  }

  async function logReminder(patientId: string, due: string, channel: 'call' | 'sms' | 'whatsapp') {
    if (!canEdit(role)) return;
    setReminded(prev => new Map(prev).set(patientId, channel));
    await supabase.from('reminder_log').insert({ patient_id: patientId, due_date: due, channel });
  }

  const lastLine = (id: string) => {
    const v = last.get(id);
    return v ? `Last visit: ${v.visit_type} (${fmt(v.visit_date)})` : 'No visit yet';
  };
  const naive = (p?: Patient) => (p?.mdt_status ?? '').includes('Naive') ? 'Newly Diagnosed (Naive)' : null;

  return (
    <View style={{ flex: 1 }}>
    <Screen refreshing={loading} onRefresh={load}>
      <UpdateNotice />
      <GuestBanner />
      <HeaderCard />

      <Card>
        <Text style={{ fontSize: 20, fontWeight: '800', color: C.primary, marginBottom: 14 }}>Thesis Progress Dashboard</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <StatTile value={view.total} label="Total Enrolled Patients" sub={`${view.confirmed} confirmed · ${view.awaiting.length} awaiting`} onPress={() => router.push('/master?filter=all')} />
          <StatTile value={view.awaiting.length} label="SSS / Biopsy Awaited" tone="amber" onPress={() => router.push('/master?filter=awaiting')} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          <StatTile value={view.enl} label="ENL Cases" onPress={() => router.push('/master?filter=enl')} />
          <StatTile value={view.naiveCount} label="Newly Diagnosed (Naive)" onPress={() => router.push('/master?filter=naive')} />
        </View>

        <View style={{ marginTop: 18, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: C.infoBg, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 26 }}>📊</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>Thesis Progress Overview</Text>
              <Muted>Target tracking and follow-up metrics</Muted>
            </View>
          </View>
          <ProgressCard title="Patient Enrollment" color={C.good} pct={100 * view.confirmed / TARGET_PATIENTS}
            caption={`${view.confirmed} / ${TARGET_PATIENTS} confirmed cases (target counts confirmed only)`} />
          <ProgressCard title="Follow-up Adherence" color={C.teal} pct={view.due ? 100 * view.done / view.due : 0}
            caption={`${view.done} of ${view.due} follow-ups due so far were done`} />
          <ProgressCard title="Overall Target" color={C.amber} pct={view.scheduled ? 100 * view.visitsDone / view.scheduled : 0}
            caption={`${view.visitsDone} of ${view.scheduled} scheduled follow-ups completed (sum of each patient's own schedule)`} />
        </View>
      </Card>


      <View style={{ height: 6 }} />

      <Section title={`Saturday Follow-up Cases (${fmt(view.sat)})`} icon="📅" tone="blue" items={view.saturday}
        keyOf={x => x.patient_id + x.slot_month} empty="No follow-up month is open this Saturday."
        render={x => {
          const p = view.byId.get(x.patient_id);
          return (
            <PersonRow name={p?.patient_name ?? ''} id={x.cr_no} badge={reminded.has(x.patient_id) ? `✓ Reminded (${reminded.get(x.patient_id)})` : naive(p)}
              sub={`Month ${x.slot_month} due ${fmt(x.due_date)} · ${lastLine(x.patient_id)}`}
              onPress={() => router.push(`/patient/${x.patient_id}`)}
              right={<ContactButtons vertical phone={p?.contact_no ?? null} message={reminderText(p?.patient_name ?? '', view.sat)}
                onSent={ch => logReminder(x.patient_id, x.due_date, ch)} />} />
          );
        }} />

      <Section title="Patients Awaiting SSS/Biopsy" icon="⏳" tone="amber" items={view.awaiting} keyOf={p => p.id}
        empty="No reports awaited."
        render={p => (
          <PersonRow name={p.patient_name} id={p.cr_no} badge={p.diagnostic_status} badgeTone="warn"
            sub={`Enrolled: ${fmt(p.enrollment_date)}`} onPress={() => router.push(`/patient/${p.id}`)}
            right={canEdit(role) && p.cr_no.startsWith('SUS-')
              ? <Pressable onPress={() => confirmCase(p)} style={{ backgroundColor: '#28A745', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 }}>
                  <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>Confirm{'\n'}Report</Text>
                </Pressable>
              : null} />
        )} />

      <Section title="Pending Lab Investigation Reports" icon="🔬" tone="pink" items={view.pendingRows} keyOf={r => r.key}
        empty="No visits waiting for reports, and no overdue visits."
        render={r => (
          <PersonRow name={r.p.patient_name} id={r.p.cr_no} sub={r.text} subColor={TONES.pink.title}
            badge={r.kind === 'labs' ? 'Reports pending' : null} badgeTone="warn"
            onPress={() => router.push(r.route as any)}
            right={r.kind === 'labs' && canEdit(role)
              ? <Pressable onPress={() => router.push(r.route as any)} style={{ backgroundColor: TONES.pink.title, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
                  <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>Add{'\n'}report</Text>
                </Pressable>
              : r.kind === 'overdue' ? <ContactButtons phone={r.p.contact_no} sms={false} message={reminderText(r.p.patient_name, view.sat)} /> : null} />
        )} />

      <Section title="Steroid Response Flags" icon="💊" tone="pink" items={flags} keyOf={f => f.patient_id}
        empty="No relapse during taper, dependence or possible non-response flagged."
        render={f => (
          <PersonRow name={f.patient_name} id={f.cr_no} subColor={TONES.pink.title}
            sub={[f.steroid_dependent ? 'Steroid dependent' : f.taper_relapses ? `Relapse during taper ×${f.taper_relapses}` : null,
                  f.stop_relapses ? `Relapse after stopping ×${f.stop_relapses}` : null,
                  f.possible_nonresponder ? 'Possible non-response' : null,
                  f.current_mg != null ? `now ${f.current_mg} mg/day` : null].filter(Boolean).join(' · ')}
            onPress={() => router.push(`/patient/${f.patient_id}`)} />
        )} />

      {canExport ? <Btn kind="export" icon="📥" title="Export" onPress={() => setExportOpen(true)} /> : null}
      {role ? <Btn kind="ghost" icon="💬" title="Ask your data" onPress={() => router.push('/ask')} /> : null}
      {role === 'owner' ? <Btn kind="ghost" title="Team & settings" icon="👥" onPress={() => router.push('/team')} /> : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        {session && pendingSync !== null ? <Chip text={`Sheet copy: ${pendingSync} waiting`} tone={pendingSync ? 'warn' : 'good'} /> : <View />}
        {session ? <Pressable onPress={() => supabase.auth.signOut()}><Text style={{ color: C.primary, fontWeight: '700', padding: 8 }}>Sign out</Text></Pressable> : null}
      </View>
      <View style={{ height: 80 }} />
    </Screen>
    {canEdit(role) ? <Fab /> : null}
    <ExportSheet visible={exportOpen} onClose={() => setExportOpen(false)} />
    </View>
  );
}
