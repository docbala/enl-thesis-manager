import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { canEdit, useSession } from '../../lib/session';
import type { Patient, Progress, Slot, Visit } from '../../lib/types';
import { ask, notify } from '../../lib/dialog';
import { reminderText } from '../../lib/messages';
import { fmt } from '../../lib/dates';
import { Btn, C, Card, Chip, ContactButtons, H, Muted, Screen, s, TONES } from '../../components/ui';
import { SlotStrip, slotSummary } from '../../components/SlotStrip';
import { EnlCard } from '../../components/EnlCard';
import { Gallery, ProfileAvatar } from '../../components/Gallery';

const L = (v: Visit, k: string) => { const x = v[k]; return x === null || x === undefined ? '-' : String(x); };

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '50%', paddingVertical: 6, paddingRight: 8 }}>
      <Text style={{ color: C.quiet, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: C.ink, fontSize: 15, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

export default function PatientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { role } = useSession();
  const [p, setP] = useState<Patient | null>(null);
  const [prog, setProg] = useState<Progress | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [pt, pg, sl, vs] = await Promise.all([
      supabase.from('patients').select('*').eq('id', id).single(),
      supabase.from('v_patient_progress').select('*').eq('patient_id', id).maybeSingle(),
      supabase.from('v_schedule').select('*').eq('patient_id', id).order('slot_month'),
      // visits are fetched by this patient's own ID only
      supabase.from('visits').select('*').eq('patient_id', id).is('deleted_at', null).order('visit_date', { ascending: false }),
    ]);
    setP(pt.data as Patient); setProg(pg.data as Progress); setSlots((sl.data ?? []) as Slot[]); setVisits((vs.data ?? []) as Visit[]);
    setLoading(false);
    setTick(t => t + 1);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!p) return <Screen><Muted>Loading…</Muted></Screen>;

  async function confirmCase() {
    if (!(await ask('Confirm report?', `${p!.cr_no} will be marked Confirmed and get the next HD number.`, 'Confirm'))) return;
    const { data, error } = await supabase.rpc('confirm_suspected', { p_patient: p!.id });
    if (error) notify('Could not confirm', error.message); else { notify('Confirmed', `New study number: ${data}`); load(); }
  }

  const next = slots.find(x => x.status === 'open') ?? slots.find(x => x.status === 'upcoming');
  const notes = p.import_flags.length && !p.reviewed_at;

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <Stack.Screen options={{ title: p.cr_no }} />
      <Card>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {p.mdt_status?.includes('Naive') ? <Chip text="Newly Diagnosed (Naive)" tone="good" big /> : <Chip text={p.mdt_status ?? 'MDT status?'} big />}
            {p.enl_developed ? <Chip text="ENL" tone="bad" big /> : null}
          </View>
          <ProfileAvatar patientId={p.id} editable={canEdit(role)} refreshKey={tick} />
        </View>
        <Text style={{ fontSize: 22, color: C.ink }}>
          <Text style={{ fontWeight: '800' }}>Name: </Text>{p.patient_name} ({p.age ?? '?'}/{p.sex ?? '?'})
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>Status:</Text>
          <Chip text={p.diagnostic_status ?? 'Unknown'} tone={p.diagnostic_status === 'Confirmed' ? 'good' : 'warn'} big />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 }}>
          <Info label="Study no." value={p.cr_no} />
          <Info label="UHID" value={p.uhid ?? '-'} />
          <Info label="Spectrum" value={p.leprosy_spectrum ?? '-'} />
          <Info label="BI / MI" value={`${p.baseline_bi ?? '-'} / ${p.baseline_mi ?? '-'}`} />
          <Info label="Enrolled" value={fmt(p.enrollment_date)} />
          <Info label={p.mdt_start_estimated ? 'MDT start (estimated)' : 'MDT start'} value={fmt(p.mdt_start_date)} />
          <Info label="Height / Weight" value={`${p.height_cm ?? '-'} cm / ${p.weight_kg ?? '-'} kg`} />
          <Info label="BMI" value={String(p.bmi ?? '-')} />
        </View>
        <View style={[s.row, { marginTop: 10 }]}>
          <Muted>{p.contact_no ?? 'No phone'}</Muted>
          <ContactButtons phone={p.contact_no} message={reminderText(p.patient_name, next?.due_date ?? null)} />
        </View>
        {canEdit(role) ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}><Btn kind="ghost" title="Edit details" onPress={() => router.push(`/patient/edit?id=${p.id}`)} /></View>
            {p.cr_no.startsWith('SUS-') ? <View style={{ flex: 1 }}><Btn kind="success" title="Confirm Report" onPress={confirmCase} /></View> : null}
          </View>
        ) : null}
      </Card>

      {notes ? (
        <View style={{ backgroundColor: TONES.amber.bg, borderColor: TONES.amber.border, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: C.warn, marginBottom: 6 }}>⚑  Check these from the old sheet</Text>
          {p.import_flags.map((f, i) => <Text key={i} style={{ color: C.ink, marginBottom: 2 }}>• {f}</Text>)}
        </View>
      ) : null}

      <Card>
        <View style={s.row}>
          <H>Follow-up schedule</H>
          {prog ? <Muted>{prog.followups_completed}/{prog.followups_planned} done{prog.adherence_pct != null ? ` · ${prog.adherence_pct}%` : ''}</Muted> : null}
        </View>
        <SlotStrip slots={slots} onPressSlot={sl => notify(sl.is_baseline ? 'Baseline' : `Month ${sl.slot_month}`, slotSummary(sl))} />
        <View style={{ marginTop: 8 }}>
          {next ? <Muted>Next: Month {next.slot_month}, due {fmt(next.due_date)}</Muted> : <Muted>All 12 months covered.</Muted>}
          {prog?.ltfu_flag ? <Text style={{ color: C.bad, marginTop: 6, fontWeight: '700' }}>3 or more visits missed in a row: review lost-to-follow-up status.</Text> : null}
        </View>
      </Card>

      <EnlCard patientId={p.id} editable={canEdit(role)} refreshKey={tick} />

      <Gallery patientId={p.id} editable={canEdit(role)} refreshKey={tick} consent={!!p.photo_consent} />

      {canEdit(role) ? <Btn title="Add visit" icon="＋" onPress={() => router.push(`/visit/new?patient=${p.id}`)} /> : null}

      <Text style={{ fontSize: 18, fontWeight: '800', color: C.primary, marginVertical: 10 }}>Visits ({visits.length})</Text>
      {visits.length === 0 ? <Muted>No visits yet.</Muted> : visits.map(v => (
        <Pressable key={v.id} onPress={() => router.push(`/visit/${v.id}`)}>
          <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, borderLeftWidth: 5, borderLeftColor: C.primary, borderWidth: 1, borderColor: C.line }}>
            <View style={s.row}>
              <Text style={{ fontWeight: '800', color: C.primary, fontSize: 17 }}>{v.visit_type} ({fmt(v.visit_date)})</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {v.enl_reaction ? <Chip text={`ENL${v.ess_score != null ? ` · ESS ${v.ess_score}` : ''}`} tone="bad" /> : null}
                {v.import_flags.some(f => !f.startsWith('sheet row')) && !v.reviewed_at ? <Chip text="Check" tone="warn" /> : null}
              </View>
            </View>
            <Text style={{ color: C.ink, marginTop: 8, lineHeight: 22 }}>
              <Text style={{ fontWeight: '700' }}>Hb:</Text> {L(v, 'hb')} | <Text style={{ fontWeight: '700' }}>TLC:</Text> {L(v, 'tlc')} | <Text style={{ fontWeight: '700' }}>Plat:</Text> {L(v, 'platelets')} | <Text style={{ fontWeight: '700' }}>NLR:</Text> <Text style={{ fontWeight: '800', color: (v.nlr ?? 0) > 3.5 ? C.bad : C.good }}>{L(v, 'nlr')}</Text> | <Text style={{ fontWeight: '700' }}>PLR:</Text> <Text style={{ fontWeight: '800' }}>{L(v, 'plr')}</Text> | <Text style={{ fontWeight: '700' }}>AGR:</Text> {L(v, 'agr')}
            </Text>
            <Text style={{ color: C.ink, lineHeight: 22 }}>
              <Text style={{ fontWeight: '700' }}>SGOT:</Text> {L(v, 'sgot')} | <Text style={{ fontWeight: '700' }}>SGPT:</Text> {L(v, 'sgpt')} | <Text style={{ fontWeight: '700' }}>ALP:</Text> {L(v, 'alp')} | <Text style={{ fontWeight: '700' }}>Creatinine:</Text> {L(v, 'creatinine')} | <Text style={{ fontWeight: '700' }}>Uric Acid:</Text> {L(v, 'uric_acid')}
            </Text>
            <Text style={{ color: C.ink, lineHeight: 22 }}>
              <Text style={{ fontWeight: '700' }}>Urea:</Text> {L(v, 'urea')} | <Text style={{ fontWeight: '700' }}>HbA1c:</Text> {L(v, 'hba1c')} | <Text style={{ fontWeight: '700' }}>T.Protein:</Text> {L(v, 'total_protein')} | <Text style={{ fontWeight: '700' }}>Alb:</Text> {L(v, 'albumin')}
            </Text>
            <Text style={{ color: C.ink, lineHeight: 22 }}>
              <Text style={{ fontWeight: '700' }}>CRP:</Text> {L(v, 'crp')} | <Text style={{ fontWeight: '700' }}>ESR:</Text> {L(v, 'esr')} | <Text style={{ fontWeight: '700' }}>S. Vit D3:</Text> {L(v, 'vit_d3')} | <Text style={{ fontWeight: '700' }}>S. Vit B12:</Text> {v.vit_b12_flag ?? ''}{L(v, 'vit_b12')}
            </Text>
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}
