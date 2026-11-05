import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { ask, notify } from '../lib/dialog';
import { router } from 'expo-router';
import { supabase, tbl } from '../lib/supabase';
import type { Patient } from '../lib/types';
import { addMonths, isISODate, todayISO } from '../lib/dates';
import { toNum } from '../lib/labs';
import { Btn, C, Card, Choice, Field, H, Muted, page } from './ui';
import { Picked, savePhoto, scanDocument } from '../lib/photos';
import { CaptureButtons, PendingList } from './Photos';

const SEX = ['Male', 'Female', 'Other'] as const;
const SPECTRUM = ['LL', 'BL', 'BB', 'BT', 'TT', 'PN'] as const;
const MDT = ['Newly Diagnosed (Naive)', 'On MDT', 'Completed MDT'] as const;
const DIAG = ['Confirmed', 'Awaiting Biopsy Report', 'Awaiting SSS Report'] as const;
const FAMILY = ['No Leprosy in Family', 'Leprosy in Family (MB)', 'Leprosy in Family (PB)'] as const;
const SES = ['Class I (Upper)', 'Class II (Upper Middle)', 'Class III (Lower Middle)', 'Class IV (Upper Lower)', 'Class V (Lower)'] as const;

type Form = Record<string, string>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function PatientForm({ existing }: { existing?: Patient }) {
  const [f, setF] = useState<Form>(() => ({
    patient_name: str(existing?.patient_name), age: str(existing?.age), sex: str(existing?.sex),
    relative_name: str(existing?.relative_name), contact_no: str(existing?.contact_no), uhid: str(existing?.uhid),
    address: str(existing?.address), enrollment_date: str(existing?.enrollment_date) || todayISO(),
    mdt_status: str(existing?.mdt_status) || 'Newly Diagnosed (Naive)', initial_mdt_months: str(existing?.initial_mdt_months) || '1',
    mdt_start_date: str(existing?.mdt_start_date), leprosy_spectrum: str(existing?.leprosy_spectrum),
    baseline_bi: str(existing?.baseline_bi), baseline_mi: str(existing?.baseline_mi),
    diagnostic_status: str(existing?.diagnostic_status) || 'Confirmed',
    height_cm: str(existing?.height_cm), weight_kg: str(existing?.weight_kg),
    family_history: str(existing?.family_history), socioeconomic_status: str(existing?.socioeconomic_status),
    opd_slip_no: str(existing?.opd_slip_no),
  }));
  const [consent, setConsent] = useState(!!existing?.photo_consent);
  const [pending, setPending] = useState<{ file: Picked; label: string; kind: 'opd_slip' | 'consent' }[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<string[]>([]);   // fields filled by the scan, shown highlighted until checked
  const [startConfirmed, setStartConfirmed] = useState(existing ? !existing.mdt_start_estimated : false);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (v: string) => { setF(prev => ({ ...prev, [k]: v })); setScanned(prev => prev.filter(x => x !== k)); };

  // Gemini reads the OPD slip; filled fields are highlighted for checking. The slip image is kept with the record.
  async function scanSlip(file: Picked) {
    setPending(prev => [...prev.filter(x => x.kind !== 'opd_slip'), { file, label: 'OPD slip', kind: 'opd_slip' }]);
    setScanning(true);
    try {
      const r = (await scanDocument('opd_slip', file)).fields;
      const map: Record<string, unknown> = {
        patient_name: r.patient_name, age: r.age, sex: r.sex, relative_name: r.relative_name, contact_no: r.contact,
        uhid: r.uhid, address: r.address, opd_slip_no: r.opd_slip_no, mdt_status: r.mdt_status,
        initial_mdt_months: r.mdt_status === 'On MDT' ? r.mdt_month : r.mdt_status ? 1 : null,
      };
      const got = Object.entries(map).filter(([, v]) => v !== null && v !== undefined && v !== '');
      if (!got.length) { notify('Nothing readable', 'Please type the details.'); }
      setF(prev => ({ ...prev, ...Object.fromEntries(got.map(([k, v]) => [k, String(v)])) }));
      setScanned(got.map(([k]) => k));
    } catch (e: any) { notify('Scan failed', e.message + '\n\nThe slip is still attached; type the details.'); }
    setScanning(false);
  }
  const hl = (k: string) => scanned.includes(k) ? 'Filled from the OPD slip — check' : null;

  // Suggest MDT start = enrolment date minus (MDT month at enrolment - 1) months, until the user types a real date.
  useEffect(() => {
    if (startConfirmed) return;
    const m = Math.max(1, Math.min(12, Number(f.initial_mdt_months) || 1));
    if (isISODate(f.enrollment_date)) setF(prev => ({ ...prev, mdt_start_date: addMonths(f.enrollment_date, -(m - 1)) }));
  }, [f.enrollment_date, f.initial_mdt_months, startConfirmed]);

  const h = toNum(f.height_cm), w = toNum(f.weight_kg);
  const bmi = h && w && h >= 100 ? Math.round(w / (h / 100) ** 2 * 10) / 10 : null;
  const phoneDigits = f.contact_no.replace(/\D/g, '');

  async function save() {
    const problems: string[] = [];
    if (!f.patient_name.trim()) problems.push('Name is required.');
    if (!isISODate(f.enrollment_date)) problems.push('Enrolment date must be YYYY-MM-DD.');
    if (!isISODate(f.mdt_start_date)) problems.push('MDT start date must be YYYY-MM-DD.');
    if (isISODate(f.mdt_start_date) && isISODate(f.enrollment_date) && f.mdt_start_date > f.enrollment_date) problems.push('MDT start cannot be after enrolment.');
    if (problems.length) { notify('Please fix', problems.join('\n')); return; }

    const row: Record<string, unknown> = {
      patient_name: f.patient_name.trim(), age: toNum(f.age), sex: f.sex || null,
      relative_name: f.relative_name.trim() || null, contact_no: phoneDigits || null, uhid: f.uhid.trim() || null,
      address: f.address.trim() || null, enrollment_date: f.enrollment_date, mdt_status: f.mdt_status,
      initial_mdt_months: toNum(f.initial_mdt_months), mdt_start_date: f.mdt_start_date, mdt_start_estimated: !startConfirmed,
      leprosy_spectrum: f.leprosy_spectrum || null, baseline_bi: toNum(f.baseline_bi), baseline_mi: toNum(f.baseline_mi),
      diagnostic_status: f.diagnostic_status, height_cm: h, weight_kg: w,
      family_history: f.family_history || null, socioeconomic_status: f.socioeconomic_status || null,
      opd_slip_no: f.opd_slip_no.trim() || null, photo_consent: consent,
    };
    setBusy(true);
    if (existing) {
      const { error } = await supabase.from(tbl('patients')).update(row).eq('id', existing.id);
      setBusy(false);
      if (error) { notify('Could not save', error.message); return; }
      await uploadPending(existing.id);
      router.back();
    } else {
      const prefix = f.diagnostic_status === 'Confirmed' ? 'HD' : 'SUS';
      const { data: cr, error: idErr } = await supabase.rpc('next_study_id', { p_prefix: prefix });
      if (idErr) { setBusy(false); notify('Could not get a study number', idErr.message); return; }
      const { data, error } = await supabase.from(tbl('patients'))
        .insert({ ...row, cr_no: cr, patient_status: prefix === 'HD' ? 'Active' : 'Awaiting Report' }).select('id').single();
      if (error) { setBusy(false); notify('Could not save', error.message); return; }
      await uploadPending(data.id);
      setBusy(false);
      notify('Enrolled', `Study number ${cr}`);
      router.replace(`/patient/${data.id}`);
    }
  }

  async function uploadPending(patientId: string) {
    const failed: string[] = [];
    for (const it of pending) {
      try { await savePhoto({ patientId, kind: it.kind, file: it.file }); } catch (e: any) { failed.push(`${it.label}: ${e.message}`); }
    }
    if (failed.length) notify('Saved, but some files did not upload', failed.join('\n'));
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={page} keyboardShouldPersistTaps="handled">
        {!existing ? (
          <Card style={{ backgroundColor: '#EAF4FB', borderColor: '#BFE0F4' }}>
            <H>Scan OPD slip</H>
            <Muted>Gemini reads the slip and fills the details below. Check every highlighted field.</Muted>
            <CaptureButtons kind="opd_slip" onPicked={scanSlip} disabled={scanning} />
            {scanning ? <Muted>Reading the slip…</Muted> : null}
          </Card>
        ) : null}

        <Card>
          <H>Patient</H>
          <Field label="Name" warn={hl('patient_name')} value={f.patient_name} onChangeText={set('patient_name')} />
          <Field label="Age" unit="years" warn={hl('age')} keyboardType="number-pad" value={f.age} onChangeText={set('age')} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: C.ink, marginBottom: 4 }}>Sex</Text>
          <Choice value={f.sex as any} options={[...SEX]} onChange={set('sex')} />
          <Field label="Relative name (S/O, W/O)" warn={hl('relative_name')} value={f.relative_name} onChangeText={set('relative_name')} />
          <Field label="Phone" keyboardType="phone-pad" value={f.contact_no} onChangeText={set('contact_no')}
            warn={phoneDigits && phoneDigits.length !== 10 ? `${phoneDigits.length} digits; Indian mobiles have 10` : hl('contact_no')} />
          <Field label="UHID" autoCapitalize="characters" warn={hl('uhid')} value={f.uhid} onChangeText={set('uhid')} />
          <Field label="Address" warn={hl('address')} value={f.address} onChangeText={set('address')} multiline />
          <Field label="OPD slip no." warn={hl('opd_slip_no')} value={f.opd_slip_no} onChangeText={set('opd_slip_no')} />
          {scanned.includes('sex') || scanned.includes('mdt_status') ? <Muted>Sex and MDT status were also filled from the slip; check them.</Muted> : null}
        </Card>

        <Card>
          <H>Diagnosis and MDT</H>
          <Text style={{ fontSize: 13, fontWeight: '600', color: C.ink, marginBottom: 4 }}>Diagnostic status</Text>
          <Choice value={f.diagnostic_status as any} options={[...DIAG]} onChange={set('diagnostic_status')} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: C.ink, marginBottom: 4 }}>Ridley–Jopling spectrum</Text>
          <Choice value={f.leprosy_spectrum as any} options={[...SPECTRUM]} onChange={set('leprosy_spectrum')} />
          {f.leprosy_spectrum && !['BL', 'LL'].includes(f.leprosy_spectrum) ? <Muted>Outside the BL/LL cohort definition.</Muted> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <View style={{ flex: 1 }}><Field label="Baseline BI" keyboardType="decimal-pad" value={f.baseline_bi} onChangeText={set('baseline_bi')} /></View>
            <View style={{ flex: 1 }}><Field label="Baseline MI" unit="%" keyboardType="decimal-pad" value={f.baseline_mi} onChangeText={set('baseline_mi')} /></View>
          </View>
          <Text style={{ fontSize: 13, fontWeight: '600', color: C.ink, marginBottom: 4 }}>MDT status</Text>
          <Choice value={f.mdt_status as any} options={[...MDT]} onChange={v => { set('mdt_status')(v); if (v.startsWith('Newly')) set('initial_mdt_months')('1'); }} />
          <Field label="Enrolment date" unit="YYYY-MM-DD" value={f.enrollment_date} onChangeText={set('enrollment_date')} />
          <Field label="MDT month at enrolment" unit="1 = first month" keyboardType="number-pad" value={f.initial_mdt_months} onChangeText={set('initial_mdt_months')} />
          <Field label="MDT start date" unit="YYYY-MM-DD" value={f.mdt_start_date}
            onChangeText={v => { setStartConfirmed(true); set('mdt_start_date')(v); }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Muted>{startConfirmed ? 'Start date confirmed from the MDT card' : 'Estimated from enrolment date; check the MDT card'}</Muted>
            <Switch value={startConfirmed} onValueChange={setStartConfirmed} />
          </View>
          <Muted>The 12-month follow-up schedule runs from this date.</Muted>
        </Card>

        <Card>
          <H>Baseline details</H>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label="Height" unit="cm" keyboardType="decimal-pad" value={f.height_cm} onChangeText={set('height_cm')}
              warn={h != null && (h < 100 || h > 230) ? 'Check height' : null} /></View>
            <View style={{ flex: 1 }}><Field label="Weight" unit="kg" keyboardType="decimal-pad" value={f.weight_kg} onChangeText={set('weight_kg')}
              warn={w != null && (w < 20 || w > 200) ? 'Check weight' : null} /></View>
          </View>
          <Muted>BMI {bmi ?? '-'} (calculated)</Muted>
          <Text style={{ fontSize: 13, fontWeight: '600', color: C.ink, marginTop: 10, marginBottom: 4 }}>Family history</Text>
          <Choice value={f.family_history as any} options={[...FAMILY]} onChange={set('family_history')} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: C.ink, marginBottom: 4 }}>Socioeconomic status (modified Kuppuswamy)</Text>
          <Choice value={f.socioeconomic_status as any} options={[...SES]} onChange={set('socioeconomic_status')} />
        </Card>

        <Card>
          <H>Photo consent</H>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: C.ink, fontWeight: '600', flex: 1 }}>Patient consented to clinical photographs</Text>
            <Switch value={consent} onValueChange={setConsent} />
          </View>
          <Muted>Lesion photos cannot be saved without this. Attach the signed form if you have it.</Muted>
          <CaptureButtons kind="consent" allowFile onPicked={file => setPending(prev => [...prev, { file, label: 'Consent form', kind: 'consent' }])} />
          <PendingList items={pending} onRemove={i => setPending(prev => prev.filter((_, j) => j !== i))} />
        </Card>

        <Btn title={existing ? 'Save changes' : 'Enrol patient'} onPress={save} busy={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
