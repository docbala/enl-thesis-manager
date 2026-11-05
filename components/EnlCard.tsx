import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { ask, notify } from '../lib/dialog';
import { fmt, isISODate, todayISO } from '../lib/dates';
import { toNum } from '../lib/labs';
import { DRUGS, ENL_TRIGGERS } from '../lib/ess';
import { Btn, C, Card, Chip, Choice, Field, H, Label, Muted, s, TONES } from './ui';

type Episode = { id: string; onset_date: string; end_date: string | null; trigger_cause: string | null; notes: string | null;
  suggested_type: 'acute' | 'recurrent' | 'chronic' | 'ongoing'; days: number };
type Flags = { taper_relapses: number; stop_relapses: number; steroid_dependent: boolean; possible_nonresponder: boolean;
  ess_start: number | null; ess_best: number | null; ess_now: number | null; adequate_days: number;
  cumulative_mg: number | null; days_on_steroid: number | null; current_mg: number | null; peak_mg: number | null };
type Dose = { id: string; drug: string; start_date: string; mg_per_day: number; source_visit: string | null; note: string | null };

const TYPE_TONE = { acute: 'warn', recurrent: 'bad', chronic: 'bad', ongoing: 'info' } as const;

// ENL episodes, prednisolone course and the steroid-response flags for one patient.
export function EnlCard({ patientId, editable, refreshKey }: { patientId: string; editable: boolean; refreshKey?: number }) {
  const [eps, setEps] = useState<Episode[]>([]);
  const [flags, setFlags] = useState<Flags | null>(null);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [adding, setAdding] = useState(false);
  const [drug, setDrug] = useState<string>('Prednisolone');
  const [dDate, setDDate] = useState(todayISO());
  const [dMg, setDMg] = useState('');
  const [editEp, setEditEp] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [e, f, d] = await Promise.all([
      supabase.from('v_episode_types').select('*').eq('patient_id', patientId).order('onset_date', { ascending: false }),
      supabase.from('v_steroid_flags').select('*').eq('patient_id', patientId).maybeSingle(),
      supabase.from('drug_doses').select('*').eq('patient_id', patientId).order('start_date', { ascending: false }),
    ]);
    setEps((e.data ?? []) as Episode[]); setFlags(f.data as Flags | null); setDoses((d.data ?? []) as Dose[]);
  }, [patientId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function addDose() {
    const mg = toNum(dMg);
    if (!isISODate(dDate) || mg == null || mg < 0) { notify('Check the dose', 'Enter a date (YYYY-MM-DD) and a dose in mg/day (0 = stopped).'); return; }
    const { error } = await supabase.from('drug_doses').upsert({ patient_id: patientId, drug, start_date: dDate, mg_per_day: mg },
      { onConflict: 'patient_id,drug,start_date' });
    if (error) notify('Could not save', error.message); else { setAdding(false); setDMg(''); load(); }
  }

  async function removeDose(d: Dose) {
    if (d.source_visit) { notify('Recorded at a visit', 'Change this dose in the visit itself.'); return; }
    if (!(await ask('Remove dose change?', `${d.drug} ${d.mg_per_day} mg/day from ${fmt(d.start_date)}`, 'Remove', true))) return;
    const { error } = await supabase.from('drug_doses').delete().eq('id', d.id);
    if (error) notify('Could not remove', error.message); else load();
  }

  async function saveEpisode(ep: Episode, patch: Partial<Episode>) {
    const { error } = await supabase.from('enl_episodes').update(patch).eq('id', ep.id);
    if (error) notify('Could not save', error.message); else load();
  }

  async function endEpisode(ep: Episode) {
    if (!(await ask('End this ENL episode?', `Episode from ${fmt(ep.onset_date)} will be marked ended today (${fmt(todayISO())}).`, 'End episode'))) return;
    saveEpisode(ep, { end_date: todayISO() });
  }

  async function newEpisode() {
    const { error } = await supabase.from('enl_episodes').insert({ patient_id: patientId, onset_date: todayISO() });
    if (error) notify('Could not add', error.message); else load();
  }

  const pred = doses.filter(d => d.drug === 'Prednisolone');
  const others = doses.filter(d => d.drug !== 'Prednisolone');
  const anyFlag = flags && (flags.taper_relapses > 0 || flags.stop_relapses > 0 || flags.steroid_dependent || flags.possible_nonresponder);

  return (
    <Card>
      <View style={s.row}>
        <H>ENL and steroids</H>
        {eps.length ? <Chip text={`${eps.length} episode${eps.length > 1 ? 's' : ''}`} tone="bad" /> : <Chip text="No ENL" tone="good" />}
      </View>

      {anyFlag ? (
        <View style={{ backgroundColor: TONES.pink.bg, borderColor: TONES.pink.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 }}>
          {flags!.steroid_dependent ? <Text style={{ color: TONES.pink.title, fontWeight: '800' }}>Steroid dependent ({flags!.taper_relapses} relapses during taper)</Text>
            : flags!.taper_relapses ? <Text style={{ color: TONES.pink.title, fontWeight: '800' }}>Relapse during taper ×{flags!.taper_relapses}</Text> : null}
          {flags!.stop_relapses ? <Text style={{ color: TONES.pink.title, fontWeight: '800' }}>Relapse within 28 days of stopping ×{flags!.stop_relapses}</Text> : null}
          {flags!.possible_nonresponder ? <Text style={{ color: TONES.pink.title, fontWeight: '800' }}>
            Possible steroid non-response: ESS {flags!.ess_start} → best {flags!.ess_best} after {Math.round(flags!.adequate_days / 7)} weeks on an adequate dose</Text> : null}
          <Muted>Suggested by the app from the visits and doses. Confirm clinically; thresholds are in study settings.</Muted>
        </View>
      ) : null}

      {flags?.cumulative_mg != null ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
          {[['Current', `${flags.current_mg ?? 0} mg/day`], ['Peak', `${flags.peak_mg ?? 0} mg/day`],
            ['Cumulative', `${Number(flags.cumulative_mg).toLocaleString()} mg`], ['Days on steroid', String(flags.days_on_steroid ?? 0)]].map(([l, v]) => (
            <View key={l} style={{ width: '50%', paddingVertical: 4 }}>
              <Text style={{ color: C.quiet, fontSize: 12 }}>Prednisolone · {l}</Text>
              <Text style={{ color: C.ink, fontWeight: '700' }}>{v}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Label>Episodes</Label>
      {eps.length === 0 ? <Muted>None. Turning on "ENL present" in a visit opens one automatically.</Muted> : eps.map(ep => (
        <View key={ep.id} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 8 }}>
          <View style={s.row}>
            <Text style={{ color: C.ink, fontWeight: '700' }}>{fmt(ep.onset_date)} → {ep.end_date ? fmt(ep.end_date) : 'ongoing'}</Text>
            <Chip text={`${ep.suggested_type} · ${Math.round(ep.days / 7)} wk`} tone={TYPE_TONE[ep.suggested_type]} />
          </View>
          <Muted>Trigger: {ep.trigger_cause ?? 'not recorded'}{ep.notes ? ` · ${ep.notes}` : ''}</Muted>
          {editable ? (
            editEp === ep.id ? (
              <View style={{ marginTop: 6 }}>
                <Choice value={ep.trigger_cause as any} options={[...ENL_TRIGGERS]} onChange={v => saveEpisode(ep, { trigger_cause: v })} />
                <Btn kind="ghost" title="Done" onPress={() => setEditEp(null)} />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Btn kind="ghost" title="Set trigger" onPress={() => setEditEp(ep.id)} /></View>
                {!ep.end_date ? <View style={{ flex: 1 }}><Btn kind="ghost" title="End episode" onPress={() => endEpisode(ep)} /></View> : null}
              </View>
            )
          ) : null}
        </View>
      ))}
      {editable && !eps.some(e => !e.end_date) ? <Btn kind="ghost" title="Start a new episode today" onPress={newEpisode} /> : null}

      <View style={{ marginTop: 10 }}><Label>Dose timeline</Label></View>
      {pred.length === 0 && others.length === 0 ? <Muted>No doses recorded. Doses typed in a visit appear here.</Muted> : null}
      {[...pred, ...others].map(d => (
        <Pressable key={d.id} onLongPress={() => editable && removeDose(d)} style={[s.row, { paddingVertical: 5, borderTopWidth: 1, borderTopColor: C.line }]}>
          <Text style={{ color: C.ink }}>{fmt(d.start_date)}</Text>
          <Text style={{ color: C.ink, fontWeight: '700' }}>{d.drug === 'Prednisolone' ? '' : d.drug + ' '}{d.mg_per_day} mg/day{d.mg_per_day === 0 ? ' (stopped)' : ''}</Text>
          <Text style={{ color: C.quiet, fontSize: 12 }}>{d.source_visit ? 'visit' : 'change'}</Text>
        </Pressable>
      ))}
      {editable ? (adding ? (
        <View style={{ marginTop: 8 }}>
          <Choice value={drug} options={[...DRUGS]} onChange={setDrug} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label="From date" unit="YYYY-MM-DD" value={dDate} onChangeText={setDDate} /></View>
            <View style={{ flex: 1 }}><Field label="Dose" unit="mg/day (0 = stop)" keyboardType="decimal-pad" value={dMg} onChangeText={setDMg} /></View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Btn kind="ghost" title="Cancel" onPress={() => setAdding(false)} /></View>
            <View style={{ flex: 1 }}><Btn title="Save dose" onPress={addDose} /></View>
          </View>
        </View>
      ) : <Btn kind="ghost" title="Add dose change (taper / stop / restart)" onPress={() => setAdding(true)} />) : null}
      {editable && doses.some(d => !d.source_visit) ? <Muted>Long-press a dose change to remove it.</Muted> : null}
    </Card>
  );
}
