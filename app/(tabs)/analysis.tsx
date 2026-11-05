import { useCallback, useMemo, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase, tbl } from '../../lib/supabase';
import type { Patient, Visit } from '../../lib/types';
import { monthsBetween, num, paramOf, PARAMS, PREDICTORS } from '../../lib/trends';
import { cumulativeIncidence, fmtP, mannWhitney, median, quantile, round } from '../../lib/stats';
import { todayISO } from '../../lib/dates';
import { C, Card, H, Muted, Screen, s, StatTile } from '../../components/ui';
import { Legend, LineChart, PickRow, SERIES, StripPlot } from '../../components/Charts';
import { GuestBanner } from '../../components/Guest';

type Ep = { patient_id: string; onset_date: string };
type Status = 'none' | 'developed' | 'at_enrol';
type Row = { p: Patient; visits: Visit[]; baseline: Visit | null; firstEnl: string | null; status: Status; start: string; lastSeen: string };

const iqr = (xs: number[]) => xs.length ? `${round(median(xs))} (${round(quantile(xs, 0.25))}–${round(quantile(xs, 0.75))})` : '-';

// Cohort graphs: baseline predictors by ENL outcome, time to first ENL, and parameters across follow-up months.
export default function Analysis() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [eps, setEps] = useState<Ep[]>([]);
  const [loading, setLoading] = useState(false);
  const [pred, setPred] = useState('nlr');
  const [inclPrev, setInclPrev] = useState(false);
  const [overKey, setOverKey] = useState('nlr');
  const [showTable, setShowTable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [pt, vs, ep] = await Promise.all([
      supabase.from(tbl('patients')).select('*').is('deleted_at', null),
      supabase.from(tbl('visits')).select('*').is('deleted_at', null).order('visit_date'),
      supabase.from(tbl('enl_episodes')).select('patient_id, onset_date'),
    ]);
    setPatients((pt.data ?? []) as Patient[]); setVisits((vs.data ?? []) as Visit[]); setEps((ep.data ?? []) as Ep[]);
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rows = useMemo<Row[]>(() => {
    const byP = new Map<string, Visit[]>();
    for (const v of visits) byP.set(v.patient_id, [...(byP.get(v.patient_id) ?? []), v]);
    return patients.filter(p => p.cr_no.startsWith('HD-')).map(p => {
      const vs = byP.get(p.id) ?? [];
      const baseline = vs.find(v => v.visit_type === 'Baseline Visit') ?? vs[0] ?? null;
      const dates = [...vs.filter(v => v.enl_reaction).map(v => v.visit_date), ...eps.filter(e => e.patient_id === p.id).map(e => e.onset_date)].sort();
      const firstEnl = dates[0] ?? null;
      const enrol = p.enrollment_date ?? baseline?.visit_date ?? todayISO();
      const status: Status = firstEnl ? (firstEnl <= (baseline?.visit_date ?? enrol) ? 'at_enrol' : 'developed') : p.enl_developed ? 'developed' : 'none';
      return { p, visits: vs, baseline, firstEnl, status, start: p.mdt_start_date ?? enrol, lastSeen: vs.length ? vs[vs.length - 1].visit_date : enrol };
    });
  }, [patients, visits, eps]);

  const n = { all: rows.length, none: rows.filter(r => r.status === 'none').length, dev: rows.filter(r => r.status === 'developed').length,
    prev: rows.filter(r => r.status === 'at_enrol').length };

  // 1. Baseline predictors by outcome
  const inEnl = (r: Row) => r.status === 'developed' || (inclPrev && r.status === 'at_enrol');
  const baseVals = (k: string, enl: boolean) => rows.filter(r => r.baseline && (enl ? inEnl(r) : r.status === 'none'))
    .map(r => ({ v: num(r.baseline![k])!, id: r.p.cr_no })).filter(x => x.v !== null);
  const pr = paramOf(pred), noE = baseVals(pred, false), yesE = baseVals(pred, true);
  const test = mannWhitney(noE.map(x => x.v), yesE.map(x => x.v));

  // 2. Time to first ENL from enrolment (excluding ENL already present at enrolment)
  const km = useMemo(() => {
    const items = rows.filter(r => r.status !== 'at_enrol' && r.baseline).map(r => {
      const from = r.baseline!.visit_date;
      const ev = r.status === 'developed' && r.firstEnl;
      return { t: Math.max(0, monthsBetween(from, ev ? r.firstEnl! : r.lastSeen)), event: !!ev };
    });
    return { items, curve: cumulativeIncidence(items) };
  }, [rows]);
  const kmMax = Math.max(12, ...km.items.map(i => i.t));
  const kmPts = [...km.curve.map(c => ({ x: c.t, y: c.ci, note: `${c.events} new · ${c.atRisk} at risk` })),
    { x: kmMax, y: km.curve[km.curve.length - 1].ci }];

  // 3. Parameter across months since MDT start: median per month, ENL (ever) vs no ENL
  const op = paramOf(overKey);
  const byMonth = (enl: boolean) => {
    const m = new Map<number, number[]>();
    for (const r of rows) {
      if (enl ? r.status === 'none' : r.status !== 'none') continue;
      for (const v of r.visits) {
        const y = num(v[overKey]); if (y === null) continue;
        const mo = Math.max(0, Math.min(15, monthsBetween(r.start, v.visit_date)));
        m.set(mo, [...(m.get(mo) ?? []), y]);
      }
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([x, ys]) => ({ x, y: round(median(ys))!, note: `median of ${ys.length}`, n: ys.length }));
  };
  const overNo = byMonth(false), overYes = byMonth(true);

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <GuestBanner compact />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <StatTile label="Confirmed cases" value={n.all} />
        <StatTile label="ENL during follow-up" value={n.dev} tone="amber" />
        <StatTile label="ENL at enrolment" value={n.prev} />
        <StatTile label="No ENL so far" value={n.none} />
      </View>

      <Card>
        <H>Baseline predictors by ENL outcome</H>
        <PickRow options={PREDICTORS.map(x => ({ key: x.key, label: x.label }))} value={pred} onChange={setPred} />
        <StripPlot unit={pr.unit} groups={[{ name: 'No ENL', color: SERIES.blue, values: noE }, { name: 'ENL', color: SERIES.orange, values: yesE }]} />
        <Legend items={[{ label: 'No ENL', color: SERIES.blue }, { label: inclPrev ? 'ENL (any)' : 'Developed ENL', color: SERIES.orange }, { label: 'Median (bar) · IQR (box)', color: C.ink }]} />
        <Text style={{ color: C.ink, marginTop: 6 }}>
          Median (IQR): No ENL {iqr(noE.map(x => x.v))} · ENL {iqr(yesE.map(x => x.v))}
        </Text>
        <Text style={{ color: C.ink, fontWeight: '700' }}>{test ? `Mann–Whitney U = ${round(test.u, 1)}, ${fmtP(test.p)}` : 'Need at least 3 patients in each group for a test.'}</Text>
        <View style={[s.row, { marginTop: 8 }]}>
          <Text style={{ color: C.ink, flex: 1 }}>Count ENL already present at enrolment as ENL</Text>
          <Switch value={inclPrev} onValueChange={setInclPrev} />
        </View>
        <Muted>Off by default: a predictor should be measured before ENL starts. Baseline = the baseline visit (or first visit). Exploratory only; run the final analysis in SPSS/R.</Muted>
        <Pressable onPress={() => setShowTable(t => !t)}><Text style={{ color: C.primary, fontWeight: '700', marginTop: 8 }}>{showTable ? 'Hide all-predictor table' : 'Show all five predictors as a table'}</Text></Pressable>
        {showTable ? (
          <View style={{ marginTop: 6 }}>
            <View style={{ flexDirection: 'row', paddingVertical: 4 }}>
              {['Predictor', 'No ENL', 'ENL', 'p'].map((h, i) => <Text key={h} style={{ flex: i === 0 ? 1.1 : i === 3 ? 0.8 : 1.4, color: C.quiet, fontWeight: '700', fontSize: 12 }}>{h}</Text>)}
            </View>
            {PREDICTORS.map(x => {
              const a = baseVals(x.key, false).map(v => v.v), b = baseVals(x.key, true).map(v => v.v), t = mannWhitney(a, b);
              return (
                <View key={x.key} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 5 }}>
                  <Text style={{ flex: 1.1, color: C.ink, fontWeight: '700' }}>{x.label}</Text>
                  <Text style={{ flex: 1.4, color: C.ink, fontSize: 12 }}>{iqr(a)} n={a.length}</Text>
                  <Text style={{ flex: 1.4, color: C.ink, fontSize: 12 }}>{iqr(b)} n={b.length}</Text>
                  <Text style={{ flex: 0.8, color: C.ink, fontSize: 12 }}>{t ? (t.p < 0.001 ? '<0.001' : t.p.toFixed(3)) : '-'}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </Card>

      <Card>
        <H>Time to first ENL</H>
        <Muted>Cumulative proportion developing ENL, by months from the baseline visit (Kaplan–Meier; patients without ENL are censored at their last visit). Excludes ENL present at enrolment.</Muted>
        <LineChart series={[{ name: 'Developed ENL', color: SERIES.orange, points: kmPts, step: true }]} xKind="month" percent yMin={0} xDomain={[0, kmMax]} />
        <Text style={{ color: C.ink, marginTop: 4 }}>
          {km.items.filter(i => i.event).length} of {km.items.length} developed ENL · at risk:{' '}
          {[0, 3, 6, 9, 12].map(m => `M${m} ${km.items.filter(i => i.t >= m).length}`).join(' · ')}
        </Text>
      </Card>

      <Card>
        <H>Across follow-up</H>
        <PickRow options={PARAMS.filter(x => x.group === 'Predictors' || x.key === 'ess_score' || x.key === 'crp' || x.key === 'hb').map(x => ({ key: x.key, label: x.label }))} value={overKey} onChange={setOverKey} />
        <LineChart xKind="month" unit={op.unit} directLabels xDomain={[0, Math.max(12, ...overNo.map(p => p.x), ...overYes.map(p => p.x))]}
          series={[{ name: 'No ENL', color: SERIES.blue, points: overNo }, { name: 'ENL', color: SERIES.orange, points: overYes }]} />
        <Legend items={[{ label: 'No ENL', color: SERIES.blue }, { label: 'ENL at any time', color: SERIES.orange }]} />
        <Muted>Median {op.label} at each month since MDT start. Tap a point to see how many patients it summarises.</Muted>
      </Card>
    </Screen>
  );
}
