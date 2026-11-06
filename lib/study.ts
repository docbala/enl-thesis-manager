import { ALL_LAB_FIELDS } from './labs';

// Printed on report and spreadsheet headings.
export const STUDY = {
  college: 'M.G.M. Medical College & M.Y. Hospital, Indore',
  university: 'Madhya Pradesh Medical Science University, Jabalpur',
  department: 'Department of Dermatology, Venereology & Leprosy',
  title: 'Clinical, Haematological, and Biochemical Profile of Leprosy Patients as Predictors of Erythema Nodosum Leprosum',
  guide: 'Dr. Sanjay Khare, Professor & Head',
  coGuide: 'Dr. Pritica Debnath Mathur, Assistant Professor',
  candidate: 'Dr. Shubham Bala, Postgraduate Resident (MD Dermatology)',
};

export const LAB_KEYS = ALL_LAB_FIELDS.map(f => f.key as string);

/** A visit is waiting for reports when not a single lab value has been entered (and it was not marked "no labs ordered"). */
export function noLabValues(v: Record<string, unknown>) {
  if (v.labs_not_ordered) return false;
  return LAB_KEYS.every(k => v[k] === null || v[k] === undefined || v[k] === '');
}

export const daysSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso + 'T00:00:00').getTime()) / 86400000));
