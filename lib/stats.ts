// Small, dependency-free statistics for the in-app graphs. The thesis analysis itself is done in SPSS/R;
// these are for looking at the data as it comes in.

export const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = sorted(xs), pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (xs: number[]) => quantile(xs, 0.5);

export function round(x: number | null | undefined, d = 2) {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  const f = 10 ** d; return Math.round(x * f) / f;
}

// Standard normal CDF (Abramowitz–Stegun 7.1.26)
function phi(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Mann–Whitney U, two-sided, normal approximation with tie and continuity correction. */
export function mannWhitney(a: number[], b: number[]): { u: number; p: number } | null {
  const n1 = a.length, n2 = b.length;
  if (n1 < 3 || n2 < 3) return null;
  const all = [...a.map(v => ({ v, g: 0 })), ...b.map(v => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array(all.length);
  let tie = 0;
  for (let i = 0; i < all.length;) {
    let j = i; while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1, t = j - i + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    tie += t ** 3 - t; i = j + 1;
  }
  const r1 = all.reduce((s, x, i) => s + (x.g === 0 ? ranks[i] : 0), 0);
  const u1 = r1 - n1 * (n1 + 1) / 2, u = Math.min(u1, n1 * n2 - u1);
  const n = n1 + n2, mu = n1 * n2 / 2;
  const sd = Math.sqrt(n1 * n2 / 12 * ((n + 1) - tie / (n * (n - 1))));
  if (!sd) return { u, p: 1 };
  const z = (Math.abs(u1 - mu) - 0.5) / sd;
  return { u, p: Math.min(1, 2 * (1 - phi(Math.max(0, z)))) };
}

export const fmtP = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);

/** Kaplan–Meier cumulative incidence (1 − S). Items: time and whether the event happened (else censored then). */
export function cumulativeIncidence(items: { t: number; event: boolean }[]) {
  const times = [...new Set(items.filter(i => i.event).map(i => i.t))].sort((a, b) => a - b);
  let s = 1;
  const out = [{ t: 0, ci: 0, atRisk: items.length, events: 0 }];
  for (const t of times) {
    const atRisk = items.filter(i => i.t >= t).length;
    const d = items.filter(i => i.t === t && i.event).length;
    if (!atRisk) continue;
    s *= 1 - d / atRisk;
    out.push({ t, ci: 1 - s, atRisk, events: d });
  }
  return out;
}
