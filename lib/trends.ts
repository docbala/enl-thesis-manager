import { LAB_GROUPS } from './labs';

// Every parameter that can be graphed, grouped as in the visit form, with the thesis predictors first.
export type Param = { key: string; label: string; unit: string; group: string; ref?: [number, number]; predictor?: boolean };

// Typical adult ranges for the shaded band. Labs differ; these are a guide, not the report's own range.
const REF: Record<string, [number, number]> = {
  hb: [12, 17], tlc: [4, 11], granulocyte_pct: [40, 75], lymphocyte_pct: [20, 45], platelets: [150, 450],
  sgot: [0, 40], sgpt: [0, 40], alp: [40, 130], total_protein: [6, 8.3], albumin: [3.5, 5.2], globulin: [2, 3.5],
  urea: [15, 45], creatinine: [0.6, 1.3], uric_acid: [3.5, 7.2], crp: [0, 6], esr: [0, 20], vit_d3: [30, 100],
  vit_b12: [200, 900], hba1c: [4, 5.7], nlr: [1, 3], plr: [50, 150], agr: [1.1, 2.2],
};

export const PARAMS: Param[] = [
  { key: 'nlr', label: 'NLR', unit: 'ratio', group: 'Predictors', predictor: true },
  { key: 'plr', label: 'PLR', unit: 'ratio', group: 'Predictors', predictor: true },
  { key: 'vit_d3', label: 'S. Vit D3', unit: 'ng/mL', group: 'Predictors', predictor: true },
  { key: 'uric_acid', label: 'Uric acid', unit: 'mg/dL', group: 'Predictors', predictor: true },
  { key: 'agr', label: 'A/G ratio', unit: 'ratio', group: 'Predictors', predictor: true },
  { key: 'ess_score', label: 'ENLIST ESS', unit: 'score', group: 'ENL' },
  { key: 'prednisolone_mg', label: 'Prednisolone', unit: 'mg/day', group: 'ENL' },
  { key: 'weight_kg', label: 'Weight', unit: 'kg', group: 'ENL' },
  ...LAB_GROUPS.flatMap(g => g.fields.filter(f => !['vit_d3', 'uric_acid'].includes(f.key)).map(f => ({ key: f.key, label: f.label, unit: f.unit, group: g.title }))),
  { key: 'globulin', label: 'Globulin', unit: 'g/dL', group: 'LFT' },
].map(p => ({ ...p, ref: REF[p.key] }));

export const PREDICTORS = PARAMS.filter(p => p.predictor);
export const paramOf = (k: string) => PARAMS.find(p => p.key === k)!;
export const GROUPS = [...new Set(PARAMS.map(p => p.group))];

const DAY = 86400000;
export const ms = (iso: string) => new Date(iso + 'T00:00:00Z').getTime();
/** Whole months between two ISO dates (30.44-day months), for "months since MDT start". */
export const monthsBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY / 30.44);

export const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
