export type Patient = {
  id: string; cr_no: string; patient_name: string; age: number | null; sex: string | null;
  uhid: string | null; contact_no: string | null; relative_name: string | null; address: string | null;
  enrollment_date: string | null; mdt_start_date: string | null; mdt_start_estimated: boolean;
  initial_mdt_months: number | null; leprosy_spectrum: string | null; mdt_status: string | null;
  baseline_bi: number | null; baseline_mi: number | null; diagnostic_status: string | null;
  height_cm: number | null; weight_kg: number | null; bmi: number | null;
  family_history: string | null; socioeconomic_status: string | null;
  enl_developed: boolean | null; patient_status: string | null;
  import_flags: string[]; reviewed_at: string | null;
  photo_consent: boolean | null; opd_slip_no: string | null;
};

export type Visit = {
  id: string; visit_id: string; patient_id: string; visit_type: string; visit_date: string;
  is_unscheduled: boolean; enl_reaction: boolean | null; ess_score: number | null;
  prednisolone_mg: number | null; weight_kg: number | null; clinical_notes: string | null;
  report_url: string | null; nlr: number | null; plr: number | null; agr: number | null; globulin: number | null;
  vit_b12_flag: '<' | '>' | null; import_flags: string[]; reviewed_at: string | null;
  [lab: string]: unknown;
};

export type Slot = {
  patient_id: string; cr_no: string; slot_month: number; is_baseline: boolean;
  due_date: string; opens_on: string; closes_on: string;
  visit_uuid: string | null; visit_id: string | null; visit_date: string | null;
  status: 'completed' | 'missed' | 'open' | 'upcoming' | 'baseline_pending';
};

export type Progress = {
  patient_id: string; cr_no: string; patient_name: string; leprosy_spectrum: string | null;
  mdt_status: string | null; enrollment_month: number; followups_planned: number;
  followups_completed: number; followups_missed: number; adherence_pct: number | null;
  next_slot: number | null; next_due_date: string | null; has_baseline: boolean;
  consecutive_missed: number; ltfu_flag: boolean;
};
