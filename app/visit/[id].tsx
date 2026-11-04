import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { canEdit, useSession } from '../../lib/session';
import type { Patient, Slot, Visit } from '../../lib/types';
import { ALL_LAB_FIELDS, hba1cDue, LAB_GROUPS, LabKey, outOfRange, ratios, toNum } from '../../lib/labs';
import { fmt, isISODate, todayISO } from '../../lib/dates';
import { Btn, C, Card, Choice, Field, H, Muted, s } from '../../components/ui';

type Lab = Record<LabKey, string>;
const emptyLabs = () => Object.fromEntries(ALL_LAB_FIELDS.map(f => [f.key, ''])) as Lab;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

// The slot a date falls in, using the same windows as the database (opens 7 days early, open until the next one opens).
function slotFor(date: string, slots: Slot[]) {
  return slots.find(x => !x.is_baseline && date >= x.opens_on && date < x.closes_on) ?? null;
}

export default function VisitScreen() {
  const { id, patient } = useLocalSearchParams<{ id: string; patient?: string }>();
  const isNew = id === 'new';
  const { role } = useSession();
  const editable = canEdit(role);

  const [p, setP] = useState<Patient | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [date, setDate] = useState(todayISO());
  const [kind, setKind] = useState<'Scheduled' | 'Baseline' | 'Unscheduled'>('Scheduled');
  const [labs, setLabs] = useState<Lab>(emptyLabs());
  const [enl, setEnl] = useState(false);
  const [ess, setEss] = useState('');
  const [pred, setPred] = useState('');
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      let pid = patient as string | undefined;
      if (!isNew) {
        const { data } = await supabase.from('visits').select('*').eq('id', id).single();
        const v = data as Visit; setVisit(v); pid = v.patient_id;
        setDate(v.visit_date);
        setKind(v.visit_type === 'Baseline Visit' ? 'Baseline' : v.is_unscheduled || !v.visit_type.startsWith('Month') ? 'Unscheduled' : 'Scheduled');
        setLabs(Object.fromEntries(ALL_LAB_FIELDS.map(f => [f.key,
          f.key === 'vit_b12' && v.vit_b12_flag ? v.vit_b12_flag + str(v.vit_b12) : str(v[f.key])])) as Lab);
        setEnl(!!v.enl_reaction); setEss(str(v.ess_score)); setPred(str(v.prednisolone_mg));
        setWeight(str(v.weight_kg)); setNotes(v.clinical_notes && v.clinical_notes !== 'Verified & Saved' ? v.clinical_notes : '');
      }
      if (!pid) return;
      const [pt, sl, vs] = await Promise.all([
        supabase.from('patients').select('*').eq('id', pid).single(),
        supabase.from('v_schedule').select('*').eq('patient_id', pid).order('slot_month'),
        supabase.from('visits').select('id').eq('patient_id', pid).eq('visit_type', 'Baseline Visit').is('deleted_at', null).limit(1),
      ]);
      setP(pt.data as Patient); setSlots((sl.data ?? []) as Slot[]);
      if (isNew && (vs.data ?? []).length === 0) setKind('Baseline');
    })();
  }, [id, patient]);

  const enrollMonth = slots.find(x => x.is_baseline)?.slot_month ?? 0;
  const slot = useMemo(() => (isISODate(date) ? slotFor(date, slots) : null), [date, slots]);
  const slotTaken = !!(slot && slot.visit_uuid && slot.visit_uuid !== visit?.id && kind === 'Scheduled');
  const visitType = kind === 'Baseline' ? 'Baseline Visit' : kind === 'Unscheduled' ? (enl ? 'ENL Event Visit' : 'Unscheduled') : slot ? `Month ${slot.slot_month}` : null;

  const nums = useMemo(() => {
    const out: Partial<Record<LabKey, number | null>> = {};
    for (const f of ALL_LAB_FIELDS) out[f.key] = toNum(labs[f.key].replace(/^[<>]/, ''));
    return out;
  }, [labs]);
  const calc = ratios(nums);
  const due = hba1cDue(kind === 'Baseline' ? enrollMonth : slot?.slot_month ?? null, enrollMonth);

  async function save() {
    if (!p) return;
    const problems: string[] = [];
    if (!isISODate(date)) problems.push('Date must be YYYY-MM-DD.');
    if (date > todayISO()) problems.push('Date cannot be in the future.');
    if (!visitType) problems.push(`No follow-up month is open on ${fmt(date)}. Save it as Unscheduled, or check the date.`);
    if (slotTaken) problems.push(`Month ${slot!.slot_month} already has a visit (${fmt(slot!.visit_date)}). Save this one as Unscheduled.`);
    const essN = toNum(ess);
    if (enl && essN != null && (essN < 0 || essN > 30)) problems.push('ESS total must be 0–30.');
    for (const f of ALL_LAB_FIELDS) {
      const raw = labs[f.key].trim();
      if (raw && toNum(raw.replace(/^[<>]/, '')) == null) problems.push(`${f.label}: "${raw}" is not a number.`);
    }
    if (problems.length) { Alert.alert('Please fix', problems.join('\n')); return; }

    const warn = ALL_LAB_FIELDS.filter(f => outOfRange(f, nums[f.key] ?? null)).map(f => `${f.label} ${nums[f.key]}`);
    const doSave = async () => {
      const b12raw = labs.vit_b12.trim();
      const row: Record<string, unknown> = {
        patient_id: p.id, visit_type: visitType, visit_date: date, is_unscheduled: kind === 'Unscheduled',
        enl_reaction: enl, ess_score: enl ? essN : null, prednisolone_mg: toNum(pred), weight_kg: toNum(weight),
        clinical_notes: notes.trim() || null,
        ...Object.fromEntries(ALL_LAB_FIELDS.filter(f => f.key !== 'vit_b12').map(f => [f.key, nums[f.key] ?? null])),
        vit_b12: nums.vit_b12 ?? null, vit_b12_flag: /^[<>]/.test(b12raw) ? b12raw[0] : null,
      };
      setBusy(true);
      const res = visit
        ? await supabase.from('visits').update(row).eq('id', visit.id)
        : await supabase.from('visits').insert(row);
      if (!res.error && enl && !p.enl_developed) await supabase.from('patients').update({ enl_developed: true }).eq('id', p.id);
      setBusy(false);
      if (res.error) { Alert.alert('Could not save', res.error.message); return; }
      router.back();
    };
    if (warn.length) {
      Alert.alert('Unusual values', `${warn.join(', ')}\n\nSave anyway?`, [{ text: 'Go back', style: 'cancel' }, { text: 'Save', onPress: doSave }]);
    } else doSave();
  }

  async function remove() {
    if (!visit) return;
    Alert.alert('Delete visit?', `${visit.visit_id} on ${fmt(visit.visit_date)} will be removed from the app (kept in the history).`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('visits').update({ deleted_at: new Date().toISOString() }).eq('id', visit.id);
        if (error) Alert.alert('Could not delete', error.message); else router.back();
      } },
    ]);
  }

  if (!p) return <View style={{ padding: 16 }}><Muted>Loading…</Muted></View>;
  const flags = (visit?.import_flags ?? []).filter(f => !f.startsWith('sheet row'));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: visit ? visit.visit_id : `New visit · ${p.cr_no}` }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {flags.length && !visit?.reviewed_at ? (
          <Card style={{ backgroundColor: C.warnBg, borderColor: C.warn }}>
            <H>Check against the report</H>
            {flags.map((f, i) => <Text key={i} style={{ color: C.ink }}>• {f}</Text>)}
            {visit?.report_url ? <Btn kind="ghost" title="Open lab report" onPress={() => Linking.openURL(visit.report_url!)} /> : null}
          </Card>
        ) : null}

        <Card>
          <Text style={{ fontWeight: '700', color: C.ink }}>{p.cr_no} · {p.patient_name}</Text>
          <Field label="Visit date" unit="YYYY-MM-DD" value={date} onChangeText={setDate} editable={editable} />
          <Choice value={kind} options={['Scheduled', 'Baseline', 'Unscheduled']} onChange={v => editable && setKind(v)} />
          <Text style={{ color: visitType && !slotTaken ? C.good : C.bad, fontWeight: '600' }}>
            {kind === 'Scheduled'
              ? slot ? `Counts as Month ${slot.slot_month} (due ${fmt(slot.due_date)})${slotTaken ? ' — already has a visit' : ''}` : 'No follow-up month is open on this date'
              : `Saved as ${visitType}`}
          </Text>
        </Card>

        <Card>
          <H>Clinical</H>
          <View style={s.row}>
            <Text style={{ color: C.ink, fontWeight: '600' }}>ENL present</Text>
            <Switch value={enl} onValueChange={setEnl} disabled={!editable} />
          </View>
          {enl ? <Field label="ESS total (ENLIST)" unit="0–30" keyboardType="decimal-pad" value={ess} onChangeText={setEss} editable={editable} /> : null}
          {enl ? <Muted>Item-by-item ESS scoring comes in Phase 2.</Muted> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <View style={{ flex: 1 }}><Field label="Prednisolone today" unit="mg/day" keyboardType="decimal-pad" value={pred} onChangeText={setPred} editable={editable} /></View>
            <View style={{ flex: 1 }}><Field label="Weight" unit="kg" keyboardType="decimal-pad" value={weight} onChangeText={setWeight} editable={editable} /></View>
          </View>
        </Card>

        {LAB_GROUPS.map(g => (
          <Card key={g.title}>
            <H>{g.title}</H>
            {g.fields.map(f => (
              <Field key={f.key} label={f.label + (f.key === 'hba1c' && due ? '  (due this visit)' : '')} unit={f.unit}
                keyboardType={f.key === 'vit_b12' ? 'default' : 'decimal-pad'} editable={editable}
                placeholder={f.key === 'vit_b12' ? 'e.g. 350, <105, >2106' : undefined}
                value={labs[f.key]} onChangeText={t => setLabs(prev => ({ ...prev, [f.key]: t }))}
                warn={outOfRange(f, nums[f.key] ?? null) ? `Outside ${f.warn[0]}–${f.warn[1]}; check the report` : null} />
            ))}
            {g.title === 'CBC' ? <Text style={{ color: C.primary, fontWeight: '600' }}>NLR {calc.nlr ?? '-'} · PLR {calc.plr ?? '-'}</Text> : null}
            {g.title === 'LFT' ? <Text style={{ color: C.primary, fontWeight: '600' }}>Globulin {calc.glob ?? '-'} · AGR {calc.agr ?? '-'}</Text> : null}
          </Card>
        ))}

        <Card>
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline editable={editable} />
        </Card>

        {editable ? <Btn title={visit ? 'Save changes' : 'Save visit'} onPress={save} busy={busy} /> : null}
        {visit && role === 'owner' ? <Btn kind="danger" title="Delete visit" onPress={remove} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
