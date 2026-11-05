// ENLIST ENL Severity Scale, final 10-item version (Walker et al., PLoS NTD 2017;11(7):e0005716).
// Each item is scored 0-3; total 0-30. A total of 9 or more separates more severe ENL from mild; MID = 5.
// Only descriptors confirmed from the published sources are shown word for word. The rest are left for the
// official ESS sheet (add them to `descriptors` below when you have it; nothing is guessed here).
export type EssKey =
  | 'pain' | 'fever' | 'lesion_number' | 'lesion_inflammation' | 'lesion_extent'
  | 'peripheral_oedema' | 'bone_pain' | 'joint_inflammation' | 'lymphadenopathy' | 'nerve_tenderness';

export type EssItem = { key: EssKey; no: number; label: string; descriptors?: [string, string, string, string] };

export const ESS_ITEMS: EssItem[] = [
  { key: 'pain', no: 1, label: 'Pain (due to ENL)' },
  { key: 'fever', no: 2, label: 'Fever' },
  { key: 'lesion_number', no: 3, label: 'Number of skin lesions' },
  { key: 'lesion_inflammation', no: 4, label: 'Inflammation of skin lesions',
    descriptors: ['Absent', 'Erythematous', 'Painful', 'Complex (vesicular, bullous, pustular, EM-like, panniculitis, necrotic or ulcerated)'] },
  { key: 'lesion_extent', no: 5, label: 'Extent of skin lesions' },
  { key: 'peripheral_oedema', no: 6, label: 'Peripheral oedema (due to ENL)' },
  { key: 'bone_pain', no: 7, label: 'Bone pain' },
  { key: 'joint_inflammation', no: 8, label: 'Inflammation of joints and/or digits (due to ENL)' },
  { key: 'lymphadenopathy', no: 9, label: 'Lymphadenopathy' },
  { key: 'nerve_tenderness', no: 10, label: 'Nerve tenderness (pain of neuritis)' },
];

export const ESS_CUTOFF = 9;
export const ESS_MID = 5;

export type EssScores = Partial<Record<EssKey, number | null>>;

export function essTotal(s: EssScores) {
  return ESS_ITEMS.reduce((a, i) => a + (s[i.key] ?? 0), 0);
}
export function essScored(s: EssScores) {
  return ESS_ITEMS.filter(i => s[i.key] !== null && s[i.key] !== undefined).length;
}
export function essBand(total: number) {
  return total >= ESS_CUTOFF ? `Moderate–severe ENL (ESS ≥ ${ESS_CUTOFF})` : `Mild ENL (ESS < ${ESS_CUTOFF})`;
}

export const ENL_TRIGGERS = ['Infection', 'Dental', 'Pregnancy / delivery', 'Stress', 'Starting MDT', 'Vaccination', 'None found', 'Other'] as const;
export const DRUGS = ['Prednisolone', 'Thalidomide', 'Clofazimine (high dose)', 'Other'] as const;
