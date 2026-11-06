import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { STUDY } from './study';
import { fmt, todayISO } from './dates';
import type { Patient, Progress, Visit } from './types';

// PDF and Excel reports with the thesis heading. Identified (names, UHID, phone, address) only when asked.

type Ep = { patient_id: string; onset_date: string; end_date: string | null; trigger_cause: string | null; suggested_type: string | null };
type Dose = { patient_id: string; drug: string; start_date: string; mg_per_day: number; note: string | null };
type Steroid = { patient_id: string; cumulative_mg: number | null; peak_mg: number | null; current_mg: number | null };
export type ReportData = { patients: Patient[]; visits: Map<string, Visit[]>; prog: Map<string, Progress>; eps: Map<string, Ep[]>;
  doses: Map<string, Dose[]>; steroid: Map<string, Steroid>; generated: string };

const group = <T extends { patient_id: string }>(rows: T[]) => {
  const m = new Map<string, T[]>(); for (const r of rows) m.set(r.patient_id, [...(m.get(r.patient_id) ?? []), r]); return m;
};

export async function loadReportData(): Promise<ReportData> {
  const [pt, vs, pg, ep, dd, st] = await Promise.all([
    supabase.from('patients').select('*').is('deleted_at', null),
    supabase.from('visits').select('*').is('deleted_at', null).order('visit_date'),
    supabase.from('v_patient_progress').select('*'),
    supabase.from('v_episode_types').select('patient_id, onset_date, end_date, trigger_cause, suggested_type').order('onset_date'),
    supabase.from('drug_doses').select('patient_id, drug, start_date, mg_per_day, note').order('start_date'),
    supabase.from('v_steroid_summary').select('patient_id, cumulative_mg, peak_mg, current_mg'),
  ]);
  const err = pt.error ?? vs.error ?? pg.error;
  if (err) throw new Error(err.message);
  const patients = ((pt.data ?? []) as Patient[]).sort((a, b) => a.cr_no.localeCompare(b.cr_no, undefined, { numeric: true }));
  return {
    patients, visits: group((vs.data ?? []) as Visit[]), prog: new Map(((pg.data ?? []) as Progress[]).map(r => [r.patient_id, r])),
    eps: group((ep.data ?? []) as Ep[]), doses: group((dd.data ?? []) as Dose[]),
    steroid: new Map(((st.data ?? []) as Steroid[]).map(r => [r.patient_id, r])), generated: todayISO(),
  };
}

// Key labs per visit (same order in the PDF and Excel)
const VCOLS: [string, string][] = [['hb', 'Hb'], ['tlc', 'TLC'], ['granulocyte_pct', 'N%'], ['lymphocyte_pct', 'L%'], ['platelets', 'Plt'],
  ['nlr', 'NLR'], ['plr', 'PLR'], ['sgot', 'SGOT'], ['sgpt', 'SGPT'], ['alp', 'ALP'], ['albumin', 'Alb'], ['globulin', 'Glob'], ['agr', 'A/G'],
  ['urea', 'Urea'], ['creatinine', 'Creat'], ['uric_acid', 'UA'], ['crp', 'CRP'], ['esr', 'ESR'], ['vit_d3', 'Vit D3'], ['vit_b12', 'B12'], ['hba1c', 'HbA1c']];
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : Math.round(Number(v) * 100) / 100);
const b12 = (v: Visit) => (v.vit_b12 == null ? '' : `${v.vit_b12_flag ?? ''}${v.vit_b12}`);
const enlCell = (v: Visit) => (v.enl_reaction ? `ENL${v.ess_score != null ? ` · ESS ${v.ess_score}` : ''}` : '');
const who = (p: Patient, identified: boolean) => (identified ? `${p.patient_name} (${p.cr_no})` : p.cr_no);
const baseline = (vs: Visit[]) => vs.find(v => v.visit_type === 'Baseline Visit') ?? vs[0];
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ---------------------------------------------------------------- PDF (HTML printed to PDF)
export function reportHtml(d: ReportData, identified: boolean) {
  const n = d.patients.length, confirmed = d.patients.filter(p => p.cr_no.startsWith('HD-')).length;
  const enl = d.patients.filter(p => p.enl_developed).length;
  const visits = [...d.visits.values()].reduce((a, v) => a + v.length, 0);
  const head = `
    <div class="head"><div class="c1">${esc(STUDY.college)}</div><div class="c2">${esc(STUDY.department)}</div>
    <div class="c3">Affiliated to ${esc(STUDY.university)}</div></div>`;
  const title = `
    <section class="title">${head}
      <div class="label">Thesis</div><div class="t">${esc(STUDY.title)}</div>
      <table class="people">
        <tr><td>Candidate</td><td>${esc(STUDY.candidate)}</td></tr>
        <tr><td>Guide</td><td>${esc(STUDY.guide)}</td></tr>
        <tr><td>Co-guide</td><td>${esc(STUDY.coGuide)}</td></tr>
        <tr><td>Report date</td><td>${fmt(d.generated)}</td></tr>
      </table>
      <div class="stats"><div><b>${n}</b>enrolled</div><div><b>${confirmed}</b>confirmed</div><div><b>${n - confirmed}</b>awaiting SSS/biopsy</div>
        <div><b>${enl}</b>with ENL</div><div><b>${visits}</b>visits recorded</div></div>
      <p class="note">${identified ? 'CONFIDENTIAL — contains patient identifiers. Do not share outside the study team.'
        : 'De-identified: patients are shown by study number only.'}</p>
    </section>`;
  const summary = `
    <section><h2>Patient summary</h2><table class="grid"><thead><tr>
      <th>Study no.</th>${identified ? '<th>Name</th><th>UHID</th><th>Phone</th>' : ''}<th>Age/Sex</th><th>Spectrum</th><th>Diagnosis</th><th>MDT at enrolment</th>
      <th>Enrolled</th><th>Visits</th><th>Follow-ups</th><th>ENL</th><th>Base NLR</th><th>Base PLR</th><th>Base Vit D3</th><th>Base UA</th><th>Base A/G</th><th>Status</th>
    </tr></thead><tbody>${d.patients.map(p => {
      const vs = d.visits.get(p.id) ?? [], b = vs.length ? baseline(vs) : undefined, pr = d.prog.get(p.id);
      return `<tr><td><b>${esc(p.cr_no)}</b></td>${identified ? `<td>${esc(p.patient_name)}</td><td>${esc(p.uhid)}</td><td>${esc(p.contact_no)}</td>` : ''}
        <td>${esc(p.age)}/${esc(p.sex?.[0])}</td><td>${esc(p.leprosy_spectrum)}</td><td>${esc(p.diagnostic_status)}</td><td>${esc(p.mdt_status)}</td>
        <td>${fmt(p.enrollment_date)}</td><td>${vs.length}</td><td>${pr ? `${pr.followups_completed}/${pr.followups_planned}` : ''}</td>
        <td>${p.enl_developed ? 'Yes' : ''}</td><td>${num(b?.nlr)}</td><td>${num(b?.plr)}</td><td>${num(b?.vit_d3)}</td><td>${num(b?.uric_acid)}</td><td>${num(b?.agr)}</td>
        <td>${esc(p.patient_status ?? 'Active')}</td></tr>`;
    }).join('')}</tbody></table></section>`;
  const each = d.patients.map(p => {
    const vs = d.visits.get(p.id) ?? [], pr = d.prog.get(p.id), st = d.steroid.get(p.id), eps = d.eps.get(p.id) ?? [];
    const facts = [
      ['Age/Sex', `${p.age ?? '?'} / ${p.sex ?? '?'}`], ['Spectrum', p.leprosy_spectrum], ['Diagnosis', p.diagnostic_status], ['MDT', p.mdt_status],
      ['MDT start', fmt(p.mdt_start_date)], ['Enrolled', fmt(p.enrollment_date)], ['BI / MI', `${p.baseline_bi ?? '-'} / ${p.baseline_mi ?? '-'}`],
      ['BMI', p.bmi], ['Follow-ups', pr ? `${pr.followups_completed} of ${pr.followups_planned} (${pr.followups_missed} missed)` : '-'],
      ...(identified ? [['UHID', p.uhid], ['Phone', p.contact_no], ['Relative', p.relative_name], ['Address', p.address]] : []),
      ['Prednisolone', st?.cumulative_mg ? `${st.cumulative_mg} mg total, peak ${st.peak_mg} mg/day` : '-'],
    ] as [string, unknown][];
    return `<section class="pt"><h3>${esc(who(p, identified))}${p.enl_developed ? ' <span class="enl">ENL</span>' : ''}</h3>
      <div class="facts">${facts.map(([k, v]) => `<div><span>${k}</span>${esc(v ?? '-')}</div>`).join('')}</div>
      ${eps.length ? `<div class="eps"><b>ENL episodes:</b> ${eps.map(e => `${fmt(e.onset_date)} – ${e.end_date ? fmt(e.end_date) : 'ongoing'}${e.suggested_type ? ` (${esc(e.suggested_type)})` : ''}${e.trigger_cause ? `, trigger: ${esc(e.trigger_cause)}` : ''}`).join('; ')}</div>` : ''}
      ${vs.length ? `<table class="grid v"><thead><tr><th>Visit</th><th>Date</th>${VCOLS.map(c => `<th>${c[1]}</th>`).join('')}<th>ENL</th><th>Pred mg</th></tr></thead><tbody>
        ${vs.map(v => `<tr${v.enl_reaction ? ' class="r"' : ''}><td>${esc(v.visit_type.replace(' Visit', ''))}${v.is_unscheduled ? '*' : ''}</td><td>${fmt(v.visit_date)}</td>
          ${VCOLS.map(([k]) => `<td>${k === 'vit_b12' ? esc(b12(v)) : num(v[k])}</td>`).join('')}<td>${esc(enlCell(v))}</td><td>${num(v.prednisolone_mg)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No visits recorded.</p>'}
    </section>`;
  }).join('');
  const css = `
    @page { size: A4 landscape; margin: 12mm 10mm; }
    * { box-sizing: border-box; } body { font-family: Arial, Helvetica, sans-serif; color: #1d2733; font-size: 9.5px; margin: 0; }
    .head { text-align: center; border-bottom: 2px solid #1F4E78; padding-bottom: 8px; margin-bottom: 14px; }
    .c1 { font-size: 20px; font-weight: 800; color: #1F4E78; } .c2 { font-size: 14px; font-weight: 700; margin-top: 2px; } .c3 { font-size: 11px; color: #5b6775; margin-top: 2px; }
    .title { page-break-after: always; } .label { text-transform: uppercase; letter-spacing: 1px; color: #5b6775; font-size: 10px; margin-top: 24px; text-align: center; }
    .t { font-size: 20px; font-weight: 800; text-align: center; margin: 6px 60px 22px; line-height: 1.3; }
    .people { margin: 0 auto; font-size: 13px; border-collapse: collapse; } .people td { padding: 5px 14px; } .people td:first-child { color: #5b6775; text-align: right; }
    .stats { display: flex; justify-content: center; gap: 14px; margin-top: 26px; } .stats div { border: 1px solid #d6dde5; border-radius: 8px; padding: 10px 16px; text-align: center; font-size: 11px; color: #5b6775; }
    .stats b { display: block; font-size: 22px; color: #1F4E78; } .note { text-align: center; margin-top: 20px; font-size: 11px; color: #9b2c2c; }
    h2 { color: #1F4E78; font-size: 15px; margin: 0 0 8px; } h3 { color: #1F4E78; font-size: 13px; margin: 0 0 6px; }
    .grid { width: 100%; border-collapse: collapse; } .grid th { background: #E8F0F7; color: #1F4E78; text-align: left; font-weight: 700; }
    .grid th, .grid td { border: 1px solid #d6dde5; padding: 3px 4px; vertical-align: top; } .grid tr { page-break-inside: avoid; }
    .grid td:first-child, .grid th:first-child { white-space: nowrap; }
    .v td, .v th { font-size: 8.5px; text-align: center; } .v td:first-child, .v td:nth-child(2) { text-align: left; white-space: nowrap; }
    tr.r td { background: #FFF1EB; } .pt { page-break-inside: avoid; margin-top: 16px; border-top: 1px solid #d6dde5; padding-top: 10px; }
    .facts { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-bottom: 6px; } .facts div { font-size: 9.5px; } .facts span { color: #5b6775; margin-right: 4px; }
    .eps { margin-bottom: 6px; } .enl { background: #FDE2E1; color: #9b2c2c; border-radius: 4px; padding: 1px 6px; font-size: 10px; } .muted { color: #5b6775; }
    .foot { margin-top: 18px; color: #5b6775; font-size: 9px; }`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>ENL thesis report ${d.generated}</title><style>${css}</style></head><body>
    ${title}${summary}<section style="page-break-before: always"><h2>Patients and follow-ups</h2>
    <p class="muted">* unscheduled visit. Rows shaded orange: ENL at that visit. Units: Hb g/dL, TLC ×10³/µL, Plt ×10³/µL, enzymes U/L, Alb/Glob g/dL, Urea/Creat/UA mg/dL, CRP mg/L, ESR mm/hr, Vit D3 ng/mL, B12 pg/mL, HbA1c %.</p>
    ${each}</section><p class="foot">Generated by ENL Thesis Manager on ${fmt(d.generated)}.</p></body></html>`;
}

export async function exportPdf(identified: boolean) {
  const d = await loadReportData();
  const html = reportHtml(d, identified);
  const name = `ENL_thesis_report_${d.generated}${identified ? '_IDENTIFIED' : ''}.pdf`;
  if (Platform.OS === 'web') {
    // Print through a hidden frame: choose "Save as PDF" in the print dialog.
    const f = document.createElement('iframe');
    Object.assign(f.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    document.body.appendChild(f);
    const doc = f.contentWindow!.document; doc.open(); doc.write(html); doc.close();
    setTimeout(() => { f.contentWindow!.focus(); f.contentWindow!.print(); setTimeout(() => f.remove(), 60_000); }, 400);
    return name;
  }
  const { uri } = await Print.printToFileAsync({ html, width: 842, height: 595 });
  const out = new File(Paths.cache, name);
  if (out.exists) out.delete();
  new File(uri).move(out);
  await Sharing.shareAsync(out.uri, { mimeType: 'application/pdf', dialogTitle: 'Save or share the report', UTI: 'com.adobe.pdf' });
  return name;
}

// ---------------------------------------------------------------- Excel
export async function exportExcel(identified: boolean) {
  const d = await loadReportData();
  const heading = (what: string) => [[STUDY.college], [STUDY.department], [`Thesis: ${STUDY.title}`],
    [`Candidate: ${STUDY.candidate}`], [`Guide: ${STUDY.guide}`], [`Co-guide: ${STUDY.coGuide}`],
    [`${what} · exported ${fmt(d.generated)}${identified ? ' · CONFIDENTIAL: contains identifiers' : ' · de-identified'}`], []];
  const sheet = (what: string, header: string[], rows: unknown[][], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet([...heading(what), header, ...rows]);
    ws['!cols'] = widths.map(w => ({ wch: w }));
    ws['!merges'] = [0, 1, 2, 3, 4, 5, 6].map(r => ({ s: { r, c: 0 }, e: { r, c: Math.max(6, header.length - 1) } }));
    return ws;
  };
  const wb = XLSX.utils.book_new();
  const idCols = identified ? ['Name', 'UHID', 'Phone', 'Relative', 'Address'] : [];
  XLSX.utils.book_append_sheet(wb, sheet('Patients', ['Study no.', ...idCols, 'Age', 'Sex', 'Spectrum', 'Diagnosis', 'MDT at enrolment', 'MDT start', 'Enrolled',
    'BI', 'MI', 'BMI', 'Visits', 'Follow-ups done', 'Follow-ups planned', 'Missed', 'ENL', 'Base NLR', 'Base PLR', 'Base Vit D3', 'Base uric acid', 'Base A/G',
    'Prednisolone total mg', 'Peak mg/day', 'Status'],
  d.patients.map(p => {
    const vs = d.visits.get(p.id) ?? [], b = vs.length ? baseline(vs) : undefined, pr = d.prog.get(p.id), st = d.steroid.get(p.id);
    return [p.cr_no, ...(identified ? [p.patient_name, p.uhid, p.contact_no, p.relative_name, p.address] : []), p.age, p.sex, p.leprosy_spectrum, p.diagnostic_status,
      p.mdt_status, p.mdt_start_date, p.enrollment_date, p.baseline_bi, p.baseline_mi, p.bmi, vs.length, pr?.followups_completed, pr?.followups_planned, pr?.followups_missed,
      p.enl_developed ? 'Yes' : 'No', num(b?.nlr), num(b?.plr), num(b?.vit_d3), num(b?.uric_acid), num(b?.agr), st?.cumulative_mg, st?.peak_mg, p.patient_status ?? 'Active'];
  }), [10, ...(identified ? [22, 12, 12, 18, 30] : []), 5, 7, 9, 14, 22, 11, 11, 5, 5, 6, 7, 9, 9, 7, 5, 9, 9, 10, 10, 9, 12, 10, 10]), 'Patients');
  const allVisits = d.patients.flatMap(p => (d.visits.get(p.id) ?? []).map(v => [p.cr_no, ...(identified ? [p.patient_name] : []), v.visit_type, v.visit_date,
    v.is_unscheduled ? 'Yes' : '', ...VCOLS.map(([k]) => (k === 'vit_b12' ? b12(v) : num(v[k]))), v.enl_reaction ? 'Yes' : '', v.ess_score ?? '', num(v.prednisolone_mg), num(v.weight_kg)]));
  XLSX.utils.book_append_sheet(wb, sheet('Visits and labs', ['Study no.', ...(identified ? ['Name'] : []), 'Visit', 'Date', 'Unscheduled', ...VCOLS.map(c => c[1]), 'ENL', 'ESS', 'Prednisolone mg', 'Weight kg'],
    allVisits, [10, ...(identified ? [22] : []), 14, 11, 6, ...VCOLS.map(() => 7), 5, 5, 8, 8]), 'Visits');
  XLSX.utils.book_append_sheet(wb, sheet('ENL episodes', ['Study no.', 'Onset', 'End', 'Type', 'Trigger'],
    d.patients.flatMap(p => (d.eps.get(p.id) ?? []).map(e => [p.cr_no, e.onset_date, e.end_date ?? 'ongoing', e.suggested_type, e.trigger_cause])), [10, 11, 11, 12, 30]), 'ENL episodes');
  XLSX.utils.book_append_sheet(wb, sheet('Steroid doses', ['Study no.', 'Drug', 'From', 'mg/day', 'Note'],
    d.patients.flatMap(p => (d.doses.get(p.id) ?? []).map(x => [p.cr_no, x.drug, x.start_date, x.mg_per_day, identified ? x.note : ''])), [10, 14, 11, 8, 30]), 'Steroid doses');

  const name = `ENL_thesis_data_${d.generated}${identified ? '_IDENTIFIED' : ''}.xlsx`;
  if (Platform.OS === 'web') { XLSX.writeFile(wb, name); return name; }
  const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create(); f.write(b64, { encoding: 'base64' } as any);
  await Sharing.shareAsync(f.uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Save or share the spreadsheet' });
  return name;
}
