import { useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { C } from './ui';

// Validated categorical slots (blue, orange). Text always uses ink colours, never the series colour.
export const SERIES = { blue: '#2a78d6', orange: '#eb6834' };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const GRID = '#E3E8EE', AXIS = '#6B7785', BAND = '#EEF3EA', SURFACE = '#FFFFFF';

export type Pt = { x: number; y: number; hi?: boolean; note?: string };
export type Series = { name: string; color: string; points: Pt[]; step?: boolean };

function niceTicks(lo: number, hi: number, n = 4) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f >= 5 ? 10 : f >= 2 ? 5 : f >= 1 ? 2 : 1) * mag;
  const start = Math.floor(lo / step) * step, out: number[] = [];
  for (let v = start; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
const fmtNum = (v: number) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtX = (x: number, kind: 'date' | 'month') => {
  if (kind === 'month') return `M${x}`;
  const d = new Date(x); return `${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
};

function useWidth(initial = 320) {
  const [w, setW] = useState(initial);
  return { w, onLayout: (e: LayoutChangeEvent) => { const nw = Math.round(e.nativeEvent.layout.width); if (nw && Math.abs(nw - w) > 2) setW(nw); } };
}

export function Legend({ items }: { items: { label: string; color: string; ring?: boolean }[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4, marginBottom: 2 }}>
      {items.map(i => (
        <View key={i.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i.color, borderWidth: i.ring ? 2 : 0, borderColor: '#fff' }} />
          <Text style={{ color: C.ink, fontSize: 12 }}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Line chart over dates or follow-up months. Tap a point for its value. One y-axis only. */
export function LineChart({ series, height = 210, xKind = 'date', unit, band, xDomain, yMin, percent, directLabels }: {
  series: Series[]; height?: number; xKind?: 'date' | 'month'; unit?: string; band?: [number, number];
  xDomain?: [number, number]; yMin?: number; percent?: boolean; directLabels?: boolean;
}) {
  const { w, onLayout } = useWidth();
  const [sel, setSel] = useState<{ s: number; i: number } | null>(null);
  const pts = series.flatMap(s => s.points);
  if (!pts.length) return <View onLayout={onLayout} style={{ height: 60, justifyContent: 'center' }}><Text style={{ color: C.quiet }}>No values yet.</Text></View>;

  const padL = 40, padR = directLabels ? 70 : 14, padT = 30, padB = 24;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  let [x0, x1] = xDomain ?? [Math.min(...xs), Math.max(...xs)];
  if (x0 === x1) { const pad = xKind === 'date' ? 15 * 86400000 : 1; x0 -= pad; x1 += pad; }
  const yLo = Math.min(...ys, ...(band ? [band[0]] : []), ...(yMin !== undefined ? [yMin] : []));
  const yHi = Math.max(...ys, ...(band ? [band[1]] : []));
  const ticks = niceTicks(yLo, yHi);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (x: number) => padL + (x - x0) / (x1 - x0) * (w - padL - padR);
  const Y = (y: number) => padT + (1 - (y - y0) / (y1 - y0 || 1)) * (height - padT - padB);
  const xTicks = xKind === 'month'
    ? Array.from({ length: Math.floor(x1) - Math.ceil(x0) + 1 }, (_, i) => Math.ceil(x0) + i).filter((m, _, a) => a.length <= 8 || m % 2 === 0)
    : [0, 1 / 3, 2 / 3, 1].map(f => x0 + f * (x1 - x0));
  const fy = (v: number) => (percent ? `${Math.round(v * 100)}%` : fmtNum(v));

  const path = (s: Series) => {
    const p = [...s.points].sort((a, b) => a.x - b.x);
    return p.map((q, i) => {
      if (i === 0) return `M${X(q.x)},${Y(q.y)}`;
      return s.step ? `H${X(q.x)}V${Y(q.y)}` : `L${X(q.x)},${Y(q.y)}`;
    }).join('') + (s.step && xDomain ? `H${X(x1)}` : '');
  };
  const chosen = sel ? series[sel.s]?.points[sel.i] : null;
  // end-of-line labels, kept at least 14px apart
  const labelY: number[] = [];
  if (directLabels) {
    const ends = series.map((s, i) => ({ i, y: s.points.length ? Y([...s.points].sort((a, b) => a.x - b.x).slice(-1)[0].y) + 4 : NaN }))
      .filter(e => !Number.isNaN(e.y)).sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
    for (const e of ends) labelY[e.i] = Math.min(height - padB, e.y);
  }

  return (
    <View onLayout={onLayout}>
      <Svg width={w} height={height}>
        {band ? <Rect x={padL} width={w - padL - padR} y={Y(Math.min(band[1], y1))} height={Math.max(0, Y(Math.max(band[0], y0)) - Y(Math.min(band[1], y1)))} fill={BAND} /> : null}
        {ticks.map(t => (
          <G key={t}>
            <Line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} stroke={GRID} strokeWidth={1} />
            <SvgText fontFamily={FONT} x={padL - 6} y={Y(t) + 4} fontSize={10} fill={AXIS} textAnchor="end">{fy(t)}</SvgText>
          </G>
        ))}
        {xTicks.map((t, i) => (
          <SvgText fontFamily={FONT} key={i} x={X(t)} y={height - 6} fontSize={10} fill={AXIS}
            textAnchor={xKind === 'month' ? 'middle' : i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>{fmtX(t, xKind)}</SvgText>
        ))}
        {unit ? <SvgText fontFamily={FONT} x={padL} y={12} fontSize={10} fill={AXIS}>{unit}</SvgText> : null}
        {chosen ? <Line x1={X(chosen.x)} x2={X(chosen.x)} y1={padT} y2={height - padB} stroke={AXIS} strokeWidth={1} strokeDasharray="3,3" /> : null}
        {series.map((s, si) => (
          <G key={s.name}>
            {s.points.length > 1 ? <Path d={path(s)} stroke={s.color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
            {s.points.map((p, i) => (
              <G key={i}>
                <Circle cx={X(p.x)} cy={Y(p.y)} r={p.hi ? 5.5 : 4} fill={p.hi ? SERIES.orange : s.color} stroke={SURFACE} strokeWidth={2} />
                <Circle cx={X(p.x)} cy={Y(p.y)} r={14} fill="transparent" onPress={() => setSel(sel?.s === si && sel.i === i ? null : { s: si, i })} />
              </G>
            ))}
            {directLabels && labelY[si] !== undefined ? (
              <SvgText fontFamily={FONT} x={w - padR + 6} y={labelY[si]} fontSize={11} fontWeight="bold" fill={C.ink}>{s.name}</SvgText>
            ) : null}
          </G>
        ))}
        {chosen ? (() => {
          const label = `${fmtX(chosen.x, xKind)} · ${fy(chosen.y)}${unit && !percent ? ' ' + unit : ''}${chosen.note ? ' · ' + chosen.note : ''}`;
          const bw = Math.min(w - 8, 14 + label.length * 6.1), bx = Math.max(4, Math.min(w - bw - 4, X(chosen.x) - bw / 2));
          return (
            <G>
              <Rect x={bx} y={2} width={bw} height={22} rx={6} fill={C.ink} />
              <SvgText fontFamily={FONT} x={bx + bw / 2} y={17} fontSize={11} fill="#fff" textAnchor="middle">{label}</SvgText>
            </G>
          );
        })() : null}
      </Svg>
    </View>
  );
}

/** Dot strip per group with median (bar) and IQR (box). Tap a dot for its value. */
export function StripPlot({ groups, unit, height = 220 }: {
  groups: { name: string; color: string; values: { v: number; id: string }[] }[]; unit?: string; height?: number;
}) {
  const { w, onLayout } = useWidth();
  const [sel, setSel] = useState<{ g: number; i: number } | null>(null);
  const all = groups.flatMap(g => g.values.map(x => x.v));
  if (!all.length) return <View onLayout={onLayout} style={{ height: 60, justifyContent: 'center' }}><Text style={{ color: C.quiet }}>No baseline values yet.</Text></View>;
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1], padL = 40, padT = 28, padB = 22;
  const Y = (y: number) => padT + (1 - (y - y0) / (y1 - y0 || 1)) * (height - padT - padB);
  const colW = (w - padL) / groups.length;
  const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); const pos = (s.length - 1) * p, lo = Math.floor(pos); return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo); };
  // deterministic jitter so dots do not jump between renders
  const jit = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 1000; return h / 1000 - 0.5; };
  const chosen = sel ? groups[sel.g].values[sel.i] : null;

  return (
    <View onLayout={onLayout}>
      <Svg width={w} height={height}>
        {ticks.map(t => (
          <G key={t}>
            <Line x1={padL} x2={w} y1={Y(t)} y2={Y(t)} stroke={GRID} />
            <SvgText fontFamily={FONT} x={padL - 6} y={Y(t) + 4} fontSize={10} fill={AXIS} textAnchor="end">{fmtNum(t)}</SvgText>
          </G>
        ))}
        {unit ? <SvgText fontFamily={FONT} x={padL} y={12} fontSize={10} fill={AXIS}>{unit}</SvgText> : null}
        {groups.map((g, gi) => {
          const cx = padL + colW * (gi + 0.5), vs = g.values.map(x => x.v);
          const med = vs.length ? q(vs, 0.5) : null, lo = vs.length ? q(vs, 0.25) : null, hi = vs.length ? q(vs, 0.75) : null;
          return (
            <G key={g.name}>
              {lo !== null && hi !== null ? <Rect x={cx - colW * 0.28} width={colW * 0.56} y={Y(hi)} height={Math.max(1, Y(lo) - Y(hi))} rx={4} fill={g.color} opacity={0.12} /> : null}
              {g.values.map((x, i) => (
                <G key={x.id}>
                  <Circle cx={cx + jit(x.id) * colW * 0.4} cy={Y(x.v)} r={4.5} fill={g.color} stroke={SURFACE} strokeWidth={2} />
                  <Circle cx={cx + jit(x.id) * colW * 0.4} cy={Y(x.v)} r={12} fill="transparent" onPress={() => setSel({ g: gi, i })} />
                </G>
              ))}
              {med !== null ? <Line x1={cx - colW * 0.3} x2={cx + colW * 0.3} y1={Y(med)} y2={Y(med)} stroke={C.ink} strokeWidth={2.5} strokeLinecap="round" /> : null}
              <SvgText fontFamily={FONT} x={cx} y={height - 5} fontSize={11} fontWeight="bold" fill={C.ink} textAnchor="middle">{g.name} (n={g.values.length})</SvgText>
            </G>
          );
        })}
        {chosen ? (
          <G>
            <Rect x={padL + 4} y={2} width={170} height={22} rx={6} fill={C.ink} />
            <SvgText fontFamily={FONT} x={padL + 89} y={17} fontSize={11} fill="#fff" textAnchor="middle">{chosen.id} · {fmtNum(chosen.v)}{unit ? ' ' + unit : ''}</SvgText>
          </G>
        ) : null}
      </Svg>
    </View>
  );
}

/** Tiny trend for the all-parameters grid. */
export function Spark({ points, color = SERIES.blue, width = 140, height = 36 }: { points: Pt[]; color?: string; width?: number; height?: number }) {
  if (points.length < 1) return <View style={{ height }} />;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (x: number) => 4 + (x1 === x0 ? (width - 8) / 2 : (x - x0) / (x1 - x0) * (width - 8));
  const Y = (y: number) => 4 + (y1 === y0 ? (height - 8) / 2 : (1 - (y - y0) / (y1 - y0)) * (height - 8));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)},${Y(p.y)}`).join('');
  return (
    <Svg width={width} height={height}>
      {points.length > 1 ? <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" /> : null}
      {points.map((p, i) => <Circle key={i} cx={X(p.x)} cy={Y(p.y)} r={p.hi ? 3.5 : 2.5} fill={p.hi ? SERIES.orange : color} />)}
    </Svg>
  );
}

/** Tappable chip row for choosing a parameter. */
export function PickRow<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {options.map(o => (
        <Pressable key={o.key} onPress={() => onChange(o.key)}
          style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1,
            borderColor: value === o.key ? C.primary : C.line, backgroundColor: value === o.key ? C.primary : '#fff' }}>
          <Text style={{ color: value === o.key ? '#fff' : C.ink, fontWeight: '600', fontSize: 13 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
