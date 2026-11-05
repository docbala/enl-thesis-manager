import { useEffect, useMemo, useRef, useState } from 'react';
import { clearDraft, loadDraft, saveDraft } from '../../lib/offline';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { ask, notify } from '../../lib/dialog';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { supabase, tbl } from '../../lib/supabase';
import { canEdit, useSession } from '../../lib/session';
import type { Patient, Slot, Visit } from '../../lib/types';
import { ALL_LAB_FIELDS, hba1cDue, LAB_GROUPS, LabKey, outOfRange, ratios, toNum } from '../../lib/labs';
import { fmt, isISODate, todayISO } from '../../lib/dates';
import { Btn, C, Card, Choice, Field, H, Muted, s, page } from '../../components/ui';
import { EssForm } from '../../components/EssForm';
import { ESS_ITEMS, EssScores, essScored, essTotal } from '../../lib/ess';
import { BODY_SITES, Photo, Picked, savePhoto, scanDocument } from '../../lib/photos';
import { CaptureButtons, PendingList, Thumb, useSignedUrls } from '../../components/Photos';
import { GuestBanner, MembersOnly } from '../../components/Guest';
import { Suggestions } from '../../components/Suggestions';

type Pending = { file: Picked; label: string; kind: 'lesion' | 'lab_report'; site?: string };
const norm = (x: unknown) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
  const { role, guest } = useSession();
  const editable = canEdit(role);

  const [p, setP] = useState<Patient | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [date, setDate] = useState(todayISO());
  const [kind, setKind] = useState<'Scheduled' | 'Baseline' | 'Unscheduled'>('Scheduled');
  const [labs, setLabs] = useState<Lab>(emptyLabs());
  const [enl, setEnl] = useState(false);
  const [ess, setEss] = useState<EssScores>({});
  const [oldEss, setOldEss] = useState<number | null>(null);   // a score saved with the old app's questionnaire
  const [pred, setPred] = useState('');
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [saved, setSaved] = useState<Photo[]>([]);
  const [site, setSite] = useState<string>('Face');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<string[]>([]);
  const [scanInfo, setScanInfo] = useState<{ name?: string; uhid?: string; date?: string; notes: string[] } | null>(null);

  useEffect(() => {
    (async () => {
      let pid = patient as string | undefined;
      if (!isNew) {
        const { data } = await supabase.from(tbl('visits')).select('*').eq('id', id).single();
        const v = data as Visit; setVisit(v); pid = v.patient_id;
        setDate(v.visit_date);
        setKind(v.visit_type === 'Baseline Visit' ? 'Baseline' : v.is_unscheduled || !v.visit_type.startsWith('Month') ? 'Unscheduled' : 'Scheduled');
        setLabs(Object.fromEntries(ALL_LAB_FIELDS.map(f => [f.key,
          f.key === 'vit_b12' && v.vit_b12_flag ? v.vit_b12_flag + str(v.vit_b12) : str(v[f.key])])) as Lab);
        setEnl(!!v.enl_reaction); setPred(str(v.prednisolone_mg));
        const { data: a } = await supabase.from(tbl('ess_assessments')).select('*').eq('visit_id', v.id).maybeSingle();
        if (a) setEss(Object.fromEntries(ESS_ITEMS.map(i => [i.key, (a as any)[i.key]])) as EssScores);
        else if (v.ess_score != null) setOldEss(Number(v.ess_score));
        const ph = guest ? { data: [] } : await supabase.from('photos').select('*').eq('visit_id', v.id).is('deleted_at', null).order('taken_at');
        setSaved((ph.data ?? []) as Photo[]);
        setWeight(str(v.weight_kg)); setNotes(v.clinical_notes && v.clinical_notes !== 'Verified & Saved' ? v.clinical_notes : '');
      }
      if (!pid) return;
      const [pt, sl, vs] = await Promise.all([
        supabase.from(tbl('patients')).select('*').eq('id', pid).single(),
        supabase.from(tbl('v_schedule')).select('*').eq('patient_id', pid).order('slot_month'),
        supabase.from(tbl('visits')).select('id').eq('patient_id', pid).eq('visit_type', 'Baseline Visit').is('deleted_at', null).limit(1),
      ]);
      setP(pt.data as Patient); setSlots((sl.data ?? []) as Slot[]);
      if (isNew && (vs.data ?? []).length === 0) setKind('Baseline');
      setReady(true);
    })();
  }, [id, patient]);

  // Draft: whatever is typed is kept on this device until the visit is saved.
  const draftKey = `visit:${isNew ? 'new:' + patient : id}`;
  const form = { date, kind, labs, enl, ess, pred, weight, notes };
  const initial = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !editable) return;
    const snap = JSON.stringify(form);
    if (initial.current === null) {
      initial.current = snap;
      loadDraft<typeof form>(draftKey).then(async d => {
        if (!d || JSON.stringify(d.value) === snap) return;
        const when = new Date(d.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        if (await ask('Unsaved draft found', `You typed changes on ${when} that were not saved. Restore them?`, 'Restore')) {
          const v = d.value;
          setDate(v.date); setKind(v.kind); setLabs(v.labs); setEnl(v.enl); setEss(v.ess); setPred(v.pred); setWeight(v.weight); setNotes(v.notes);
        } else clearDraft(draftKey);
      });
      return;
    }
    const h = setTimeout(() => { snap === initial.current ? clearDraft(draftKey) : saveDraft(draftKey, form); }, 500);
    return () => clearTimeout(h);
  }, [ready, date, kind, labs, enl, ess, pred, weight, notes]);

  const savedUrls = useSignedUrls(saved.filter(x => x.mime_type !== 'application/pdf').map(x => x.storage_path));

  // Gemini reads the report; values fill empty boxes only, highlighted until checked. The report is attached to the visit.
  async function scanReport(file: Picked) {
    setPending(prev => [...prev, { file, label: 'Lab report', kind: 'lab_report' }]);
    setScanning(true);
    try {
      const res = await scanDocument('lab_report', file);
      const r = res.fields;
      const filled: string[] = [];
      setLabs(prev => {
        const next = { ...prev };
        for (const f of ALL_LAB_FIELDS) {
          let v = r[f.key];
          if (v === null || v === undefined || v === '') continue;
          if (f.key === 'vit_b12' && r.vit_b12_flag) v = r.vit_b12_flag + String(v);
          if (prev[f.key].trim()) continue;            // never overwrite what was typed
          next[f.key] = String(v); filled.push(f.key);
        }
        return next;
      });
      setScanned(filled);
      setScanInfo({ name: r.name_on_report ?? undefined, uhid: r.uhid_on_report ?? undefined, date: r.report_date ?? undefined, notes: res.notes ?? [] });
      if (isNew && r.report_date && isISODate(r.report_date) && r.report_date <= todayISO()) setDate(r.report_date);
    } catch (e: any) { notify('Scan failed', e.message + '\n\nThe report is still attached; type the values.'); }
    setScanning(false);
  }
  const nameMismatch = scanInfo?.name && p && !norm(scanInfo.name).includes(norm(p.patient_name).slice(0, 4));
  const uhidMismatch = scanInfo?.uhid && p?.uhid && !norm(scanInfo.uhid).includes(norm(p.uhid)) && !norm(p.uhid).includes(norm(scanInfo.uhid));

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
    const scored = essScored(ess);
    for (const f of ALL_LAB_FIELDS) {
      const raw = labs[f.key].trim();
      if (raw && toNum(raw.replace(/^[<>]/, '')) == null) problems.push(`${f.label}: "${raw}" is not a number.`);
    }
    if (problems.length) { notify('Please fix', problems.join('\n')); return; }

    const warn = ALL_LAB_FIELDS.filter(f => outOfRange(f, nums[f.key] ?? null)).map(f => `${f.label} ${nums[f.key]}`);
    const doSave = async () => {
      const b12raw = labs.vit_b12.trim();
      const row: Record<string, unknown> = {
        patient_id: p.id, visit_type: visitType, visit_date: date, is_unscheduled: kind === 'Unscheduled',
        enl_reaction: enl, ...(enl ? {} : { ess_score: null }), prednisolone_mg: toNum(pred), weight_kg: toNum(weight),
        clinical_notes: notes.trim() || null,
        ...Object.fromEntries(ALL_LAB_FIELDS.filter(f => f.key !== 'vit_b12').map(f => [f.key, nums[f.key] ?? null])),
        vit_b12: nums.vit_b12 ?? null, vit_b12_flag: /^[<>]/.test(b12raw) ? b12raw[0] : null,
      };
      setBusy(true);
      const res = visit
        ? await supabase.from(tbl('visits')).update(row).eq('id', visit.id).select('id').single()
        : await supabase.from(tbl('visits')).insert(row).select('id').single();
      if (res.error) { setBusy(false); notify('Could not save', `${res.error.message}\n\nYour entries are kept as a draft on this device.`); return; }
      // ENLIST ESS items; the database copies the total to the visit and opens an ENL episode if needed
      if (enl && scored) {
        const e = await supabase.from(tbl('ess_assessments')).upsert({ visit_id: res.data.id, patient_id: p.id,
          ...Object.fromEntries(ESS_ITEMS.map(i => [i.key, ess[i.key] ?? null])) }, { onConflict: 'visit_id' });
        if (e.error) { setBusy(false); notify('Visit saved, but the ESS was not', e.error.message); return; }
      } else if (!enl && visit) {
        await supabase.from(tbl('ess_assessments')).delete().eq('visit_id', visit.id);
      }
      const failed: string[] = [];
      for (const it of pending) {
        try { await savePhoto({ patientId: p.id, visitId: res.data.id, kind: it.kind, bodySite: it.site ?? null, file: it.file }); }
        catch (e: any) { failed.push(`${it.label}: ${e.message}`); }
      }
      setBusy(false);
      if (failed.length) notify('Visit saved, but some files did not upload', failed.join('\n'));
      await clearDraft(draftKey);
      router.back();
    };
    if (warn.length) {
      if (await ask('Unusual values', `${warn.join(', ')}\n\nSave anyway?`, 'Save')) doSave();
    } else doSave();
  }

  async function remove() {
    if (!visit) return;
    if (!(await ask('Delete visit?', `${visit.visit_id} on ${fmt(visit.visit_date)} will be removed from the app (kept in the history).`, 'Delete', true))) return;
    const { error } = await supabase.from(tbl('visits')).update({ deleted_at: new Date().toISOString() }).eq('id', visit.id);
    if (error) notify('Could not delete', error.message); else router.back();
  }

  if (!p) return <View style={{ padding: 16 }}><Muted>Loading…</Muted></View>;
  const flags = (visit?.import_flags ?? []).filter(f => !f.startsWith('sheet row'));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: visit ? visit.visit_id : `New visit · ${p.cr_no}` }} />
      <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={page} keyboardShouldPersistTaps="handled">
        <GuestBanner compact />
        {flags.length && !visit?.reviewed_at ? (
          <Card style={{ backgroundColor: C.warnBg, borderColor: C.warn }}>
            <H>Check against the report</H>
            {flags.map((f, i) => <Text key={i} style={{ color: C.ink }}>• {f}</Text>)}
            {visit?.report_url ? <Btn kind="ghost" title="Open lab report" onPress={() => Linking.openURL(visit.report_url!)} /> : null}
          </Card>
        ) : null}

        <Card>
          <Text style={{ fontWeight: '700', color: C.ink }}>{p.cr_no}{guest ? '' : ` · ${p.patient_name}`}</Text>
          <Field label="Visit date" unit="YYYY-MM-DD" value={date} onChangeText={setDate} editable={editable} />
          <Choice value={kind} options={['Scheduled', 'Baseline', 'Unscheduled']} onChange={v => editable && setKind(v)} />
          <Text style={{ color: visitType && !slotTaken ? C.good : C.bad, fontWeight: '600' }}>
            {kind === 'Scheduled'
              ? slot ? `Counts as Month ${slot.slot_month} (due ${fmt(slot.due_date)})${slotTaken ? ' — already has a visit' : ''}` : 'No follow-up month is open on this date'
              : `Saved as ${visitType}`}
          </Text>
        </Card>

        {editable ? (
          <Card style={{ backgroundColor: '#EAF4FB', borderColor: '#BFE0F4' }}>
            <H>Scan lab report</H>
            <Muted>Gemini fills the empty lab boxes. Highlighted values must be checked against the report.</Muted>
            <CaptureButtons kind="lab_report" allowFile onPicked={scanReport} disabled={scanning} />
            {scanning ? <Muted>Reading the report…</Muted> : null}
            {scanInfo ? (
              <View style={{ marginTop: 6 }}>
                <Text style={{ color: nameMismatch ? C.bad : C.ink, fontWeight: nameMismatch ? '800' : '400' }}>
                  Name on report: {scanInfo.name ?? 'not read'}{nameMismatch ? `  ≠ ${p.patient_name}?` : ''}
                </Text>
                <Text style={{ color: uhidMismatch ? C.bad : C.ink, fontWeight: uhidMismatch ? '800' : '400' }}>
                  UHID on report: {scanInfo.uhid ?? 'not read'}{uhidMismatch ? `  ≠ ${p.uhid}?` : ''}
                </Text>
                {scanInfo.date ? <Muted>Report date {fmt(scanInfo.date)}</Muted> : null}
                <Text style={{ color: C.good, fontWeight: '600' }}>{scanned.length} values filled</Text>
                {scanInfo.notes.map((n, i) => <Muted key={i}>{n}</Muted>)}
              </View>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <H>Clinical</H>
          <View style={s.row}>
            <Text style={{ color: C.ink, fontWeight: '600' }}>ENL present</Text>
            <Switch value={enl} onValueChange={setEnl} disabled={!editable} />
          </View>
          {enl && oldEss != null && !essScored(ess) ? (
            <Muted>ESS {oldEss} was recorded with the old app's questionnaire (not the ENLIST items). Score the 10 items below to replace it.</Muted>
          ) : null}
          {enl ? <View style={{ marginTop: 8 }}><EssForm value={ess} onChange={setEss} editable={editable} /></View> : null}
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
                value={labs[f.key]} onChangeText={t => { setLabs(prev => ({ ...prev, [f.key]: t })); setScanned(prev => prev.filter(x => x !== f.key)); }}
                warn={outOfRange(f, nums[f.key] ?? null) ? `Outside ${f.warn[0]}–${f.warn[1]}; check the report`
                  : scanned.includes(f.key) ? 'From the scan — check' : null}
                onFocus={() => setScanned(prev => prev.filter(x => x !== f.key))} />
            ))}
            {g.title === 'CBC' ? <Text style={{ color: C.primary, fontWeight: '600' }}>NLR {calc.nlr ?? '-'} · PLR {calc.plr ?? '-'}</Text> : null}
            {g.title === 'LFT' ? <Text style={{ color: C.primary, fontWeight: '600' }}>Globulin {calc.glob ?? '-'} · AGR {calc.agr ?? '-'}</Text> : null}
          </Card>
        ))}

        {guest ? <Card><H>Lesion photos</H><MembersOnly what="Photos" /></Card> : <Card>
          <H>Lesion photos</H>
          {saved.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {saved.map(x => <Thumb key={x.id} photo={x} url={savedUrls[x.storage_path]} size={84} onPress={() => router.push(`/photo/${x.id}`)} />)}
            </View>
          ) : null}
          {!p.photo_consent ? <Muted>No photo consent recorded for this patient. Tick it in Edit details first.</Muted>
            : editable ? (
              <View>
                <Text style={{ fontSize: 13, fontWeight: '600', color: C.ink, marginBottom: 4 }}>Body site</Text>
                <Choice value={site as any} options={[...BODY_SITES]} onChange={setSite} />
                <CaptureButtons kind="lesion" onPicked={file => setPending(prev => [...prev, { file, label: site, kind: 'lesion', site }])} />
              </View>
            ) : null}
          <PendingList items={pending} onRemove={i => setPending(prev => prev.filter((_, j) => j !== i))} />
          {pending.length ? <Muted>Uploaded when you save the visit.</Muted> : null}
        </Card>}

        {visit && !guest ? <Suggestions patientId={p.id} visitId={visit.id} /> : null}

        <Card>
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline editable={editable} />
        </Card>

        {editable ? <Btn title={visit ? 'Save changes' : 'Save visit'} onPress={save} busy={busy} /> : null}
        {visit && role === 'owner' ? <Btn kind="danger" title="Delete visit" onPress={remove} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
