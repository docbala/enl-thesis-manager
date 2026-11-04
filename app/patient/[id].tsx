import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { canEdit, useSession } from '../../lib/session';
import type { Patient, Progress, Slot, Visit } from '../../lib/types';
import { Btn, C, Card, Chip, H, Muted, s } from '../../components/ui';
import { SlotStrip, slotSummary } from '../../components/SlotStrip';
import { fmt } from '../../lib/dates';

const L = (v: Visit, k: string) => { const x = v[k]; return x === null || x === undefined ? '-' : String(x); };

export default function PatientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { role } = useSession();
  const [p, setP] = useState<Patient | null>(null);
  const [prog, setProg] = useState<Progress | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);

  const load = useCallback(async () => {
    const [pt, pg, sl, vs] = await Promise.all([
      supabase.from('patients').select('*').eq('id', id).single(),
      supabase.from('v_patient_progress').select('*').eq('patient_id', id).maybeSingle(),
      supabase.from('v_schedule').select('*').eq('patient_id', id).order('slot_month'),
      // visits are fetched by this patient's own ID only
      supabase.from('visits').select('*').eq('patient_id', id).is('deleted_at', null).order('visit_date', { ascending: false }),
    ]);
    setP(pt.data as Patient); setProg(pg.data as Progress); setSlots((sl.data ?? []) as Slot[]); setVisits((vs.data ?? []) as Visit[]);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!p) return <View style={{ padding: 16 }}><Muted>Loading…</Muted></View>;

  async function confirmCase() {
    Alert.alert('Confirm diagnosis?', `${p!.cr_no} will get the next HD number.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: async () => {
        const { data, error } = await supabase.rpc('confirm_suspected', { p_patient: p!.id });
        if (error) Alert.alert('Could not confirm', error.message); else { Alert.alert('Confirmed', `New number: ${data}`); load(); }
      } },
    ]);
  }

  const phone = (p.contact_no ?? '').replace(/\D/g, '');
  const next = slots.find(x => x.status === 'open') ?? slots.find(x => x.status === 'upcoming');
  const reminder = `नमस्ते ${p.patient_name} जी,\nयह एम.वाई. अस्पताल (M.Y. Hospital), इंदौर के त्वचा रोग विभाग से सूचना है। आपकी नियमित स्वास्थ्य एवं खून की जाँच का समय हो गया है।\nफॉलो अप तिथि: ${next ? fmt(next.due_date) : '-'}\nसमय: सुबह 9:00 बजे, Dermatology OPD.\nपुरानी पर्ची एवं जाँच रिपोर्ट साथ लाएँ।`;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Stack.Screen options={{ title: p.cr_no }} />
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700', color: C.ink }}>{p.patient_name}</Text>
        <Muted>{[p.age && `${p.age} y`, p.sex, p.leprosy_spectrum, p.mdt_status].filter(Boolean).join(' · ')}</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          <Chip text={p.diagnostic_status ?? 'Status unknown'} tone={p.diagnostic_status === 'Confirmed' ? 'good' : 'warn'} />
          {p.enl_developed ? <Chip text="ENL" tone="bad" /> : null}
          {p.import_flags.length && !p.reviewed_at ? <Chip text={`${p.import_flags.length} import notes`} tone="warn" /> : null}
        </View>
        <View style={{ marginTop: 10 }}>
          <Muted>UHID {p.uhid ?? '-'} · Enrolled {fmt(p.enrollment_date)}</Muted>
          <Muted>MDT start {fmt(p.mdt_start_date)}{p.mdt_start_estimated ? ' (estimated, please confirm)' : ''} · BI {p.baseline_bi ?? '-'} · MI {p.baseline_mi ?? '-'}</Muted>
          <Muted>Height {p.height_cm ?? '-'} cm · Weight {p.weight_kg ?? '-'} kg · BMI {p.bmi ?? '-'}</Muted>
        </View>
        {canEdit(role) ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}><Btn kind="ghost" title="Edit details" onPress={() => router.push(`/patient/edit?id=${p.id}`)} /></View>
            {p.cr_no.startsWith('SUS-') ? <View style={{ flex: 1 }}><Btn title="Confirm case" onPress={confirmCase} /></View> : null}
          </View>
        ) : null}
      </Card>

      {p.import_flags.length && !p.reviewed_at ? (
        <Card style={{ backgroundColor: C.warnBg, borderColor: C.warn }}>
          <H>Check these from the old sheet</H>
          {p.import_flags.map((f, i) => <Text key={i} style={{ color: C.ink, marginBottom: 2 }}>• {f}</Text>)}
        </Card>
      ) : null}

      <Card>
        <View style={s.row}>
          <H>Follow-up</H>
          {prog ? <Muted>{prog.followups_completed}/{prog.followups_planned} done{prog.adherence_pct != null ? ` · ${prog.adherence_pct}%` : ''}</Muted> : null}
        </View>
        <SlotStrip slots={slots} onPressSlot={sl => Alert.alert(sl.is_baseline ? 'Baseline' : `Month ${sl.slot_month}`, slotSummary(sl))} />
        {next ? <Muted>Next: Month {next.slot_month}, due {fmt(next.due_date)}</Muted> : <Muted>All 12 months covered.</Muted>}
        {prog?.ltfu_flag ? <Text style={{ color: C.bad, marginTop: 6 }}>3 or more visits missed in a row: review lost-to-follow-up status.</Text> : null}
      </Card>

      {phone ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Btn kind="ghost" title="Call" onPress={() => Linking.openURL(`tel:${phone}`)} /></View>
          <View style={{ flex: 1 }}><Btn kind="ghost" title="WhatsApp reminder" onPress={() => Linking.openURL(`https://wa.me/91${phone.slice(-10)}?text=${encodeURIComponent(reminder)}`)} /></View>
        </View>
      ) : null}

      {canEdit(role) ? <Btn title="+ Add visit" onPress={() => router.push(`/visit/new?patient=${p.id}`)} /> : null}

      <H>Visits ({visits.length})</H>
      {visits.length === 0 ? <Muted>No visits yet.</Muted> : visits.map(v => (
        <Pressable key={v.id} onPress={() => router.push(`/visit/${v.id}`)}>
          <Card>
            <View style={s.row}>
              <Text style={{ fontWeight: '700', color: C.primary }}>{v.visit_type}</Text>
              <Muted>{fmt(v.visit_date)}</Muted>
            </View>
            <Text style={{ color: C.ink, marginTop: 4 }}>
              Hb {L(v, 'hb')} · TLC {L(v, 'tlc')} · Plat {L(v, 'platelets')} · NLR {L(v, 'nlr')} · PLR {L(v, 'plr')} · AGR {L(v, 'agr')}
            </Text>
            <Muted>
              SGOT {L(v, 'sgot')} · SGPT {L(v, 'sgpt')} · Urea {L(v, 'urea')} · Creat {L(v, 'creatinine')} · UA {L(v, 'uric_acid')} · HbA1c {L(v, 'hba1c')}
            </Muted>
            <Muted>CRP {L(v, 'crp')} · ESR {L(v, 'esr')} · Vit D3 {L(v, 'vit_d3')} · B12 {v.vit_b12_flag ?? ''}{L(v, 'vit_b12')}</Muted>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
              {v.enl_reaction ? <Chip text={`ENL${v.ess_score != null ? ` · ESS ${v.ess_score}` : ''}`} tone="bad" /> : null}
              {v.is_unscheduled ? <Chip text="Unscheduled" /> : null}
              {v.import_flags.some(f => !f.startsWith('sheet row')) && !v.reviewed_at ? <Chip text="Check" tone="warn" /> : null}
            </View>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
