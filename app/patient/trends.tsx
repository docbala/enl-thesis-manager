import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { supabase, tbl } from '../../lib/supabase';
import type { Patient, Visit } from '../../lib/types';
import { GROUPS, ms, num, paramOf, PARAMS } from '../../lib/trends';
import { round } from '../../lib/stats';
import { fmt, todayISO } from '../../lib/dates';
import { C, Card, H, Muted, page } from '../../components/ui';
import { Legend, LineChart, PickRow, SERIES, Spark } from '../../components/Charts';
import { GuestBanner } from '../../components/Guest';

type Dose = { drug: string; start_date: string; mg_per_day: number };

// Every parameter for one patient over time: one large chart, steroid course with ESS, and an all-parameters grid.
export default function Trends() {
  const { id, param } = useLocalSearchParams<{ id: string; param?: string }>();
  const [p, setP] = useState<Patient | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [key, setKey] = useState<string>(param ?? 'nlr');
  const [group, setGroup] = useState<string>(() => paramOf(param ?? 'nlr').group);
  const [table, setTable] = useState(false);
  const scroll = useRef<any>(null);

  useEffect(() => {
    (async () => {
      const [pt, vs, dd] = await Promise.all([
        supabase.from(tbl('patients')).select('*').eq('id', id).single(),
        supabase.from(tbl('visits')).select('*').eq('patient_id', id).is('deleted_at', null).order('visit_date'),
        supabase.from(tbl('drug_doses')).select('drug, start_date, mg_per_day').eq('patient_id', id).order('start_date'),
      ]);
      setP(pt.data as Patient); setVisits((vs.data ?? []) as Visit[]); setDoses((dd.data ?? []) as Dose[]);
    })();
  }, [id]);

  const seriesOf = (k: string) => visits.filter(v => num(v[k]) !== null)
    .map(v => ({ x: ms(v.visit_date), y: num(v[k])!, hi: !!v.enl_reaction, note: v.enl_reaction ? 'ENL' : undefined, date: v.visit_date, type: v.visit_type }));
  const cur = paramOf(key), pts = useMemo(() => seriesOf(key), [visits, key]);
  const domain: [number, number] | undefined = visits.length ? [ms(visits[0].visit_date), Math.max(ms(visits[visits.length - 1].visit_date), ms(todayISO()))] : undefined;

  // Prednisolone as a step line from the dose timeline (falls back to the dose recorded at visits)
  const pred = doses.filter(d => d.drug.toLowerCase().startsWith('pred'));
  const predPts = pred.length ? pred.map(d => ({ x: ms(d.start_date), y: Number(d.mg_per_day) })) : seriesOf('prednisolone_mg');
  const essPts = seriesOf('ess_score');
  const ref = cur.ref && key === 'hb' && p?.sex === 'Female' ? [12, 15.5] as [number, number] : key === 'hb' && p?.sex === 'Male' ? [13, 17] as [number, number] : cur.ref;

  function choose(k: string) { setKey(k); setGroup(paramOf(k).group); scroll.current?.scrollTo({ y: 0, animated: true }); }

  if (!p) return <View style={{ padding: 16 }}><Muted>Loading…</Muted></View>;
  const anyEnl = pts.some(x => x.hi);

  return (
    <ScrollView ref={scroll} style={{ backgroundColor: C.bg }} contentContainerStyle={page}>
      <Stack.Screen options={{ title: `Trends · ${p.cr_no}` }} />
      <GuestBanner compact />
      <Card>
        <PickRow options={GROUPS.map(g => ({ key: g, label: g }))} value={group} onChange={g => { setGroup(g); setKey(PARAMS.find(x => x.group === g)!.key); }} />
        <PickRow options={PARAMS.filter(x => x.group === group).map(x => ({ key: x.key, label: x.label }))} value={key} onChange={setKey} />
        <Text style={{ fontSize: 18, fontWeight: '800', color: C.primary }}>{cur.label}</Text>
        <Muted>{pts.length} value{pts.length === 1 ? '' : 's'}{pts.length ? ` · latest ${round(pts[pts.length - 1].y)} ${cur.unit} on ${fmt(pts[pts.length - 1].date)}` : ''}</Muted>
        <LineChart series={[{ name: cur.label, color: SERIES.blue, points: pts }]} unit={cur.unit} band={ref} xDomain={domain} />
        <Legend items={[{ label: 'Visit value', color: SERIES.blue }, ...(anyEnl ? [{ label: 'ENL present at that visit', color: SERIES.orange }] : []),
          ...(ref ? [{ label: `Typical range ${ref[0]}–${ref[1]}`, color: '#DCE8D3' }] : [])]} />
        <Muted>Tap a point for its value. The shaded band is a typical adult range; check the lab's own range.</Muted>
        <Pressable onPress={() => setTable(t => !t)}><Text style={{ color: C.primary, fontWeight: '700', marginTop: 8 }}>{table ? 'Hide table' : 'Show as table'}</Text></Pressable>
        {table ? pts.map((x, i) => (
          <View key={i} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 5 }}>
            <Text style={{ flex: 1, color: C.ink }}>{fmt(x.date)}</Text>
            <Text style={{ flex: 1, color: C.quiet }}>{x.type}</Text>
            <Text style={{ width: 90, textAlign: 'right', color: C.ink, fontWeight: '700' }}>{round(x.y)}{x.hi ? '  ENL' : ''}</Text>
          </View>
        )) : null}
      </Card>

      <Card>
        <H>Steroid course and ESS</H>
        <Text style={{ color: C.ink, fontWeight: '700', marginTop: 4 }}>Prednisolone (mg/day)</Text>
        <LineChart series={[{ name: 'Prednisolone', color: SERIES.blue, points: predPts, step: pred.length > 0 }]} unit="mg/day" xDomain={domain} yMin={0} height={170} />
        <Text style={{ color: C.ink, fontWeight: '700', marginTop: 8 }}>ENLIST ESS</Text>
        <LineChart series={[{ name: 'ESS', color: SERIES.blue, points: essPts }]} unit="score" xDomain={domain} yMin={0} height={170} />
        <Muted>Same time axis for both, so a flare during a taper lines up with the dose drop. ESS 9 or more is moderate–severe.</Muted>
      </Card>

      <Card>
        <H>All parameters</H>
        <Muted>Tap one to open it above.</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, marginHorizontal: -4 }}>
          {PARAMS.map(x => {
            const s = seriesOf(x.key), last = s[s.length - 1];
            return (
              <Pressable key={x.key} onPress={() => choose(x.key)} style={{ width: '50%', padding: 4 }}>
                <View style={{ borderWidth: 1, borderColor: x.key === key ? C.primary : C.line, borderRadius: 12, padding: 8, backgroundColor: '#fff' }}>
                  <Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{x.label}</Text>
                  <Text style={{ color: C.quiet, fontSize: 12 }}>{last ? `${round(last.y)} ${x.unit} · n=${s.length}` : 'no values'}</Text>
                  <Spark points={s} width={140} />
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>
    </ScrollView>
  );
}
