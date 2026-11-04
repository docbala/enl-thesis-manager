// Lab panel: same fields, order and units as the current Apps Script app and the Google Sheet.
export type LabKey =
  | 'hb' | 'tlc' | 'granulocyte_pct' | 'lymphocyte_pct' | 'platelets'
  | 'sgot' | 'sgpt' | 'alp' | 'total_protein' | 'albumin'
  | 'urea' | 'creatinine' | 'uric_acid'
  | 'crp' | 'esr' | 'vit_d3' | 'vit_b12' | 'hba1c';

export type LabField = { key: LabKey; label: string; unit: string; warn: [number, number] };

export const LAB_GROUPS: { title: string; fields: LabField[] }[] = [
  { title: 'CBC', fields: [
    { key: 'hb', label: 'Hb', unit: 'g/dL', warn: [3, 20] },
    { key: 'tlc', label: 'TLC', unit: '×10³/µL', warn: [1, 50] },
    { key: 'granulocyte_pct', label: 'Neutrophils / granulocytes', unit: '%', warn: [5, 99] },
    { key: 'lymphocyte_pct', label: 'Lymphocytes', unit: '%', warn: [1, 90] },
    { key: 'platelets', label: 'Platelets', unit: '×10³/µL', warn: [20, 1000] },
  ]},
  { title: 'LFT', fields: [
    { key: 'sgot', label: 'SGOT', unit: 'U/L', warn: [5, 1000] },
    { key: 'sgpt', label: 'SGPT', unit: 'U/L', warn: [5, 1000] },
    { key: 'alp', label: 'ALP', unit: 'U/L', warn: [20, 1500] },
    { key: 'total_protein', label: 'Total protein', unit: 'g/dL', warn: [3, 10] },
    { key: 'albumin', label: 'Albumin', unit: 'g/dL', warn: [1, 6] },
  ]},
  { title: 'RFT', fields: [
    { key: 'urea', label: 'Urea', unit: 'mg/dL', warn: [5, 300] },
    { key: 'creatinine', label: 'Creatinine', unit: 'mg/dL', warn: [0.2, 15] },
    { key: 'uric_acid', label: 'Uric acid', unit: 'mg/dL', warn: [1, 15] },
  ]},
  { title: 'Inflammation', fields: [
    { key: 'crp', label: 'CRP', unit: 'mg/L', warn: [0, 500] },
    { key: 'esr', label: 'ESR', unit: 'mm/hr', warn: [0, 150] },
  ]},
  { title: 'Vitamins and sugar', fields: [
    { key: 'vit_d3', label: 'S. Vit D3', unit: 'ng/mL', warn: [3, 150] },
    { key: 'vit_b12', label: 'S. Vit B12', unit: 'pg/mL', warn: [50, 5000] },
    { key: 'hba1c', label: 'HbA1c', unit: '%', warn: [4, 18] },
  ]},
];

export const ALL_LAB_FIELDS = LAB_GROUPS.flatMap(g => g.fields);

export function toNum(s: string | undefined | null): number | null {
  if (s === undefined || s === null) return null;
  const t = String(s).trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// Same formulas the database uses (generated columns), shown live while typing.
export function ratios(v: Partial<Record<LabKey, number | null>>) {
  const { tlc, granulocyte_pct: g, lymphocyte_pct: l, platelets: p, total_protein: tp, albumin: alb } = v;
  const nlr = g != null && l ? r2(g / l) : null;
  const absLymph = tlc && l ? tlc * l / 100 : null;
  const plr = p != null && absLymph ? r2(p / absLymph) : null;
  const glob = tp != null && alb != null && tp > alb ? r2(tp - alb) : null;
  const agr = glob && alb != null ? r2(alb / glob) : null;
  return { nlr, plr, glob, agr };
}

export function outOfRange(f: LabField, n: number | null) {
  return n != null && (n < f.warn[0] || n > f.warn[1]);
}

// HbA1c is due at enrolment and every 3rd slot after it; all other labs every visit.
export function hba1cDue(slotMonth: number | null, enrollmentMonth: number) {
  if (slotMonth == null) return false;
  return (slotMonth - enrollmentMonth) % 3 === 0;
}
