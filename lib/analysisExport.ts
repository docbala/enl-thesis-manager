import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';
import { supabase } from './supabase';
import { todayISO } from './dates';

// Analysis bundle for SPSS and R: de-identified (study number only), coded outcomes, labels and ready-to-run syntax.
type T = 'num' | 'str' | 'date';
type V = [name: string, type: T, label: string, values?: Record<number, string>];
const YN = { 0: 'No', 1: 'Yes' };

const PATIENT_VARS: V[] = [
  ['study_no', 'str', 'Study number'], ['age', 'num', 'Age (years)'], ['sex', 'str', 'Sex'], ['sex_code', 'num', 'Sex (coded)', { 1: 'Male', 2: 'Female' }],
  ['spectrum', 'str', 'Ridley-Jopling spectrum'], ['spectrum_code', 'num', 'Spectrum (coded)', { 1: 'BL', 2: 'LL' }],
  ['mdt_status', 'str', 'MDT status at enrolment'], ['mdt_month_at_enrolment', 'num', 'MDT month at enrolment'],
  ['baseline_bi', 'num', 'Baseline bacillary index'], ['baseline_mi', 'num', 'Baseline morphological index (%)'], ['bmi', 'num', 'BMI (kg/m2)'],
  ['family_history', 'str', 'Family history of leprosy'], ['socioeconomic_status', 'str', 'Socioeconomic status (modified Kuppuswamy)'],
  ['enrollment_date', 'date', 'Enrolment date'], ['mdt_start_date', 'date', 'MDT start date'], ['baseline_date', 'date', 'Baseline visit date'],
  ['b_hb', 'num', 'Baseline Hb (g/dL)'], ['b_tlc', 'num', 'Baseline TLC (x10^3/uL)'], ['b_neutrophil_pct', 'num', 'Baseline neutrophils (%)'],
  ['b_lymphocyte_pct', 'num', 'Baseline lymphocytes (%)'], ['b_platelets', 'num', 'Baseline platelets (x10^3/uL)'],
  ['b_nlr', 'num', 'Baseline neutrophil-lymphocyte ratio'], ['b_plr', 'num', 'Baseline platelet-lymphocyte ratio'],
  ['b_sgot', 'num', 'Baseline SGOT (U/L)'], ['b_sgpt', 'num', 'Baseline SGPT (U/L)'], ['b_alp', 'num', 'Baseline ALP (U/L)'],
  ['b_total_protein', 'num', 'Baseline total protein (g/dL)'], ['b_albumin', 'num', 'Baseline albumin (g/dL)'], ['b_globulin', 'num', 'Baseline globulin (g/dL)'],
  ['b_agr', 'num', 'Baseline albumin-globulin ratio'], ['b_urea', 'num', 'Baseline urea (mg/dL)'], ['b_creatinine', 'num', 'Baseline creatinine (mg/dL)'],
  ['b_uric_acid', 'num', 'Baseline uric acid (mg/dL)'], ['b_crp', 'num', 'Baseline CRP (mg/L)'], ['b_esr', 'num', 'Baseline ESR (mm/hr)'],
  ['b_vit_d3', 'num', 'Baseline serum vitamin D3 (ng/mL)'], ['b_vit_b12', 'num', 'Baseline serum vitamin B12 (pg/mL)'], ['b_hba1c', 'num', 'Baseline HbA1c (%)'],
  ['first_enl_date', 'date', 'Date of first ENL'], ['enl_at_enrolment', 'num', 'ENL already present at baseline', YN],
  ['enl_incident', 'num', 'ENL developed after baseline (primary outcome)', YN], ['enl_ever', 'num', 'ENL at any time', YN],
  ['last_visit_date', 'date', 'Last visit date'], ['followup_months', 'num', 'Follow-up from baseline (months)'],
  ['time_to_enl_months', 'num', 'Months from baseline to first ENL or censoring'], ['n_visits', 'num', 'Number of visits'],
  ['n_enl_visits', 'num', 'Visits with ENL'], ['n_episodes', 'num', 'ENL episodes'], ['max_ess', 'num', 'Highest ENLIST ESS'],
  ['pred_cumulative_mg', 'num', 'Cumulative prednisolone (mg)'], ['pred_peak_mg', 'num', 'Peak prednisolone dose (mg/day)'],
  ['pred_days', 'num', 'Days on prednisolone'], ['taper_relapses', 'num', 'ENL relapses during steroid taper'],
  ['steroid_dependent', 'num', 'Steroid dependent', YN], ['followups_completed', 'num', 'Follow-ups completed'],
  ['followups_planned', 'num', 'Follow-ups planned'], ['adherence_pct', 'num', 'Follow-up adherence (%)'], ['patient_status', 'str', 'Patient status'],
];
const VISIT_LAB: [string, string][] = [['hb', 'Hb (g/dL)'], ['tlc', 'TLC (x10^3/uL)'], ['granulocyte_pct', 'Neutrophils (%)'], ['lymphocyte_pct', 'Lymphocytes (%)'],
  ['platelets', 'Platelets (x10^3/uL)'], ['nlr', 'NLR'], ['plr', 'PLR'], ['sgot', 'SGOT (U/L)'], ['sgpt', 'SGPT (U/L)'], ['alp', 'ALP (U/L)'],
  ['total_protein', 'Total protein (g/dL)'], ['albumin', 'Albumin (g/dL)'], ['globulin', 'Globulin (g/dL)'], ['agr', 'A/G ratio'], ['urea', 'Urea (mg/dL)'],
  ['creatinine', 'Creatinine (mg/dL)'], ['uric_acid', 'Uric acid (mg/dL)'], ['crp', 'CRP (mg/L)'], ['esr', 'ESR (mm/hr)'], ['vit_d3', 'Vitamin D3 (ng/mL)'],
  ['vit_b12', 'Vitamin B12 (pg/mL)'], ['hba1c', 'HbA1c (%)']];
const ESS_KEYS = ['pain', 'fever', 'lesion_number', 'lesion_inflammation', 'lesion_extent', 'peripheral_oedema', 'bone_pain', 'joint_inflammation', 'lymphadenopathy', 'nerve_tenderness'];
const VISIT_VARS: V[] = [
  ['study_no', 'str', 'Study number'], ['visit_type', 'str', 'Visit'], ['visit_date', 'date', 'Visit date'],
  ['months_since_baseline', 'num', 'Months since baseline visit'], ['months_since_mdt', 'num', 'Months since MDT start'],
  ['unscheduled', 'num', 'Unscheduled visit', YN], ...VISIT_LAB.map(([k, l]) => [k, 'num', l] as V),
  ['enl', 'num', 'ENL present at visit', YN], ['ess_total', 'num', 'ENLIST ESS total'],
  ...ESS_KEYS.map(k => [`ess_${k}`, 'num', `ESS item: ${k.replace(/_/g, ' ')} (0-3)`] as V),
  ['prednisolone_mg', 'num', 'Prednisolone (mg/day)'], ['weight_kg', 'num', 'Weight (kg)'],
];

const cell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const t = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const toCsv = (vars: V[], rows: Record<string, unknown>[]) => [vars.map(v => v[0]).join(','), ...rows.map(r => vars.map(v => cell(r[v[0]])).join(','))].join('\r\n');
const months = (a?: string | null, b?: string | null) => (a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000 / 30.4375 * 100) / 100 : null);

function spss(file: string, vars: V[], title: string) {
  const fmt = (t: T) => (t === 'num' ? 'F10.2' : t === 'date' ? 'SDATE10' : 'A60');
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const vals = vars.filter(v => v[3]);
  return [
    `* ${title}. Exported ${todayISO()} from ENL Thesis Manager (de-identified).`,
    `* 1) Unzip the bundle into one folder. 2) Change the folder below. 3) Run all.`,
    `CD 'C:\\ENL_export'.`,
    `GET DATA /TYPE=TXT /FILE='${file}' /ENCODING='UTF8' /DELCASE=LINE /DELIMITERS="," /QUALIFIER='"' /ARRANGEMENT=DELIMITED /FIRSTCASE=2`,
    `  /VARIABLES=`,
    ...vars.map(v => `  ${v[0]} ${fmt(v[1])}`),
    `.`,
    `VARIABLE LABELS`,
    vars.map(v => `  ${v[0]} ${q(v[2])}`).join('\n') + '.',
    ...(vals.length ? [`VALUE LABELS`, vals.map(v => `  ${v[0]} ${Object.entries(v[3]!).map(([k, l]) => `${k} ${q(l)}`).join(' ')}`).join(' /\n') + '.'] : []),
    ...(vars.some(v => v[1] === 'date') ? [`FORMATS ${vars.filter(v => v[1] === 'date').map(v => v[0]).join(' ')} (DATE11).`] : []),
    `VARIABLE LEVEL ${vars.filter(v => v[3]).map(v => v[0]).join(' ') || 'study_no'} (NOMINAL).`,
    `EXECUTE.`,
  ].join('\n');
}

const SPSS_ANALYSIS = `
* ---- Suggested analyses (patients file). Primary outcome: enl_incident; exclude ENL present at baseline.
DATASET NAME patients.
TEMPORARY.
SELECT IF (enl_at_enrolment = 0).
NPAR TESTS /M-W = b_nlr b_plr b_vit_d3 b_uric_acid b_agr BY enl_incident(0 1).
TEMPORARY.
SELECT IF (enl_at_enrolment = 0).
LOGISTIC REGRESSION VARIABLES enl_incident /METHOD=ENTER b_nlr b_plr b_vit_d3 b_uric_acid b_agr /PRINT=CI(95).
TEMPORARY.
SELECT IF (enl_at_enrolment = 0).
ROC b_nlr b_plr b_uric_acid BY enl_incident (1) /PRINT=SE COORDINATES /CRITERIA=CUTOFF(INCLUDE) TESTPOS(LARGE).
TEMPORARY.
SELECT IF (enl_at_enrolment = 0).
KM time_to_enl_months /STATUS=enl_incident(1) /PRINT TABLE MEAN /PLOT SURVIVAL.
`;

const R_SCRIPT = (date: string) => `# ENL Thesis Manager — analysis-ready data, exported ${date} (de-identified)
# Set the folder that holds the unzipped files:
setwd("C:/ENL_export")

patients <- read.csv("enl_patients.csv", stringsAsFactors = FALSE, na.strings = "")
visits   <- read.csv("enl_visits.csv",   stringsAsFactors = FALSE, na.strings = "")
for (d in c("enrollment_date", "mdt_start_date", "baseline_date", "first_enl_date", "last_visit_date")) patients[[d]] <- as.Date(patients[[d]])
visits$visit_date <- as.Date(visits$visit_date)
patients$sex_f      <- factor(patients$sex_code, 1:2, c("Male", "Female"))
patients$spectrum_f <- factor(patients$spectrum_code, 1:2, c("BL", "LL"))

# Primary analysis set: ENL not present at baseline
inc <- subset(patients, enl_at_enrolment == 0)
table(ENL = inc$enl_incident)

predictors <- c("b_nlr", "b_plr", "b_vit_d3", "b_uric_acid", "b_agr")
summary_by <- function(v) {
  a <- inc[[v]][inc$enl_incident == 0]; b <- inc[[v]][inc$enl_incident == 1]
  q <- function(x) sprintf("%.2f (%.2f-%.2f), n=%d", median(x, na.rm = TRUE), quantile(x, .25, na.rm = TRUE), quantile(x, .75, na.rm = TRUE), sum(!is.na(x)))
  p <- tryCatch(wilcox.test(a, b, exact = FALSE)$p.value, error = function(e) NA)
  data.frame(predictor = v, no_enl = q(a), enl = q(b), p_mann_whitney = signif(p, 3))
}
print(do.call(rbind, lapply(predictors, summary_by)))

# Logistic regression (needs enough ENL events: roughly 10 per predictor)
fit <- glm(enl_incident ~ b_nlr + b_plr + b_vit_d3 + b_uric_acid + b_agr, data = inc, family = binomial)
print(summary(fit)); print(exp(cbind(OR = coef(fit), confint.default(fit))))

# ROC for each predictor (install.packages("pROC") once)
if (requireNamespace("pROC", quietly = TRUE)) for (v in predictors) {
  r <- pROC::roc(inc$enl_incident, inc[[v]], quiet = TRUE)
  cat(v, "AUC", round(pROC::auc(r), 3), " best cut-off:", paste(round(unlist(pROC::coords(r, "best", ret = c("threshold", "sensitivity", "specificity"))), 3), collapse = " / "), "\\n")
}

# Time to first ENL (Kaplan-Meier)
library(survival)
km <- survfit(Surv(time_to_enl_months, enl_incident) ~ 1, data = inc)
print(summary(km, times = c(3, 6, 9, 12)))
plot(km, fun = "event", xlab = "Months from baseline", ylab = "Cumulative proportion with ENL", conf.int = TRUE)

# Visits: ENLIST ESS and labs over time (long format, one row per visit)
aggregate(ess_total ~ round(months_since_mdt), data = visits, FUN = median)
`;

export async function exportAnalysisBundle() {
  const [pt, vs] = await Promise.all([
    supabase.from('v_analysis_patient').select('*').order('study_no'),
    supabase.from('visits').select(`*, patient:patients!inner(cr_no, mdt_start_date), ess:ess_assessments(${ESS_KEYS.join(',')}, total)`)
      .is('deleted_at', null).like('patient.cr_no', 'HD-%').order('visit_date'),
  ]);
  if (pt.error || vs.error) throw new Error((pt.error ?? vs.error)!.message);
  const base = new Map((pt.data ?? []).map((p: any) => [p.study_no, p.baseline_date]));
  const visits = (vs.data ?? []).map((v: any) => {
    const e = Array.isArray(v.ess) ? v.ess[0] : v.ess;
    return {
      study_no: v.patient.cr_no, visit_type: v.visit_type, visit_date: v.visit_date,
      months_since_baseline: months(base.get(v.patient.cr_no), v.visit_date), months_since_mdt: months(v.patient.mdt_start_date, v.visit_date),
      unscheduled: v.is_unscheduled ? 1 : 0, ...Object.fromEntries(VISIT_LAB.map(([k]) => [k, v[k]])),
      enl: v.enl_reaction ? 1 : 0, ess_total: e?.total ?? v.ess_score, ...Object.fromEntries(ESS_KEYS.map(k => [`ess_${k}`, e?.[k]])),
      prednisolone_mg: v.prednisolone_mg, weight_kg: v.weight_kg,
    };
  });

  const date = todayISO();
  const zip = new JSZip();
  zip.file('enl_patients.csv', toCsv(PATIENT_VARS, pt.data ?? []));
  zip.file('enl_visits.csv', toCsv(VISIT_VARS, visits));
  const book = (vars: V[], file: string) => vars.map(v => [file, v[0], v[1], v[2], v[3] ? Object.entries(v[3]).map(([k, l]) => `${k}=${l}`).join('; ') : ''].map(cell).join(','));
  zip.file('codebook.csv', ['file,variable,type,label,values', ...book(PATIENT_VARS, 'enl_patients.csv'), ...book(VISIT_VARS, 'enl_visits.csv')].join('\r\n'));
  zip.file('enl_patients.sps', spss('enl_patients.csv', PATIENT_VARS, 'ENL thesis: one row per patient') + '\n' + SPSS_ANALYSIS);
  zip.file('enl_visits.sps', spss('enl_visits.csv', VISIT_VARS, 'ENL thesis: one row per visit') + '\nDATASET NAME visits.\n');
  zip.file('enl_analysis.R', R_SCRIPT(date));
  zip.file('README.txt', [
    `ENL Thesis Manager — analysis bundle, ${date}`,
    `${pt.data?.length ?? 0} confirmed patients, ${visits.length} visits. De-identified: study numbers only.`, '',
    'enl_patients.csv  one row per patient: baseline predictors, outcome and time-to-event',
    'enl_visits.csv    one row per visit: labs, ENL, ENLIST ESS items, prednisolone',
    'codebook.csv      every variable with its label and codes',
    'enl_patients.sps  SPSS: reads the file with labels, then runs Mann-Whitney, logistic regression, ROC and Kaplan-Meier',
    'enl_visits.sps    SPSS: reads the visits file with labels',
    'enl_analysis.R    R: the same analyses', '',
    'Outcome coding: enl_incident = 1 when ENL first appeared after the baseline visit (primary outcome).',
    'enl_at_enrolment = 1 when ENL was already present at baseline; leave these out of predictor analyses.',
    'time_to_enl_months: baseline to first ENL, or to the last visit if no ENL (censored).',
  ].join('\r\n'));

  const name = `ENL_analysis_${date}.zip`;
  if (Platform.OS === 'web') {
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return name;
  }
  const b64 = await zip.generateAsync({ type: 'base64' });
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  f.write(b64, { encoding: 'base64' } as any);
  await Sharing.shareAsync(f.uri, { mimeType: 'application/zip', dialogTitle: 'Save or share the analysis bundle' });
  return name;
}
