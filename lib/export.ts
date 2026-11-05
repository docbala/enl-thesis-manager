import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase, tbl } from './supabase';
import { todayISO } from './dates';

const PATIENT_COLS = ['cr_no', 'patient_name', 'age', 'sex', 'uhid', 'contact_no', 'address', 'enrollment_date', 'mdt_start_date',
  'mdt_start_estimated', 'initial_mdt_months', 'mdt_status', 'leprosy_spectrum', 'baseline_bi', 'baseline_mi', 'diagnostic_status',
  'height_cm', 'weight_kg', 'bmi', 'family_history', 'socioeconomic_status', 'enl_developed', 'patient_status'];
const IDENTIFYING = new Set(['patient_name', 'uhid', 'contact_no', 'address']);
const VISIT_COLS = ['visit_id', 'visit_type', 'visit_date', 'is_unscheduled', 'hb', 'tlc', 'granulocyte_pct', 'lymphocyte_pct', 'platelets',
  'abs_lymph', 'nlr', 'plr', 'sgot', 'sgpt', 'alp', 'total_protein', 'albumin', 'globulin', 'agr', 'urea', 'creatinine', 'uric_acid',
  'crp', 'esr', 'vit_d3', 'vit_b12_flag', 'vit_b12', 'hba1c', 'enl_reaction', 'ess_score', 'prednisolone_mg', 'weight_kg', 'clinical_notes'];

const cell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

// Master dataset: one row per visit with that patient's details in front. Identifying columns only if asked.
export async function exportMasterDataset(identified: boolean) {
  const [pt, vs] = await Promise.all([
    supabase.from(tbl('patients')).select('*').is('deleted_at', null),
    supabase.from(tbl('visits')).select('*').is('deleted_at', null).order('visit_date'),
  ]);
  if (pt.error || vs.error) throw new Error((pt.error ?? vs.error)!.message);
  const pcols = PATIENT_COLS.filter(c => identified || !IDENTIFYING.has(c));
  const byId = new Map((pt.data ?? []).map((p: any) => [p.id, p]));
  const lines = [[...pcols, ...VISIT_COLS.map(c => c === 'weight_kg' ? 'visit_weight_kg' : c)].join(',')];
  for (const v of vs.data ?? []) {
    const p: any = byId.get((v as any).patient_id);
    if (!p) continue;
    lines.push([...pcols.map(c => cell(p[c])), ...VISIT_COLS.map(c => cell((v as any)[c]))].join(','));
  }
  // patients with no visit yet still appear once
  const seen = new Set((vs.data ?? []).map((v: any) => v.patient_id));
  for (const p of pt.data ?? []) if (!seen.has((p as any).id)) lines.push(pcols.map(c => cell((p as any)[c])).join(','));
  const csv = '﻿' + lines.join('\n');   // BOM so Excel reads Hindi/English text correctly
  const name = `ENL_master_${identified ? 'identified' : 'deidentified'}_${todayISO()}.csv`;

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return name;
  }
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  f.write(csv);
  await Sharing.shareAsync(f.uri, { mimeType: 'text/csv', dialogTitle: 'Save or share the dataset' });
  return name;
}
