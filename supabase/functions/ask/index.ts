// "Ask your data": a team member's question about the study data, answered by Gemini running Python on the
// de-identified dataset (study numbers only; no names, phones, addresses, UHIDs, notes or photos).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const VISIT_COLS = ['visit_type', 'visit_date', 'is_unscheduled', 'hb', 'tlc', 'granulocyte_pct', 'lymphocyte_pct', 'platelets', 'nlr', 'plr',
  'sgot', 'sgpt', 'alp', 'total_protein', 'albumin', 'globulin', 'agr', 'urea', 'creatinine', 'uric_acid', 'crp', 'esr', 'vit_d3', 'vit_b12',
  'hba1c', 'enl_reaction', 'ess_score', 'prednisolone_mg', 'weight_kg'];

function csv(rows: Record<string, unknown>[], cols?: string[]) {
  if (!rows.length) return '';
  const keys = cols ?? Object.keys(rows[0]);
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(','), ...rows.map(r => keys.map(k => cell(r[k])).join(','))].join('\n');
}
function toB64(s: string) {
  const bytes = new TextEncoder().encode(s); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const SYSTEM = `You are the biostatistics assistant for an MD Dermatology thesis: a prospective cohort of BL/LL leprosy patients
followed for up to 12 months, studying baseline NLR, PLR, serum vitamin D3, uric acid and albumin/globulin ratio (AGR) as predictors of
erythema nodosum leprosum (ENL). Severity is the ENLIST ENL Severity Scale (ESS; 9 or more = moderate–severe).

Two CSV files are attached and available to your Python code in the working directory. Start by running
import os; print(os.listdir('.')) and load them with pandas:
- patients file (one row per confirmed patient; columns start with study_no, b_ = baseline visit value). Outcome columns:
  enl_incident (1 = ENL first appeared after the baseline visit), enl_at_enrolment (1 = ENL already present at baseline),
  enl_ever, time_to_enl_months (months from baseline to first ENL, or to last visit if no ENL; blank if ENL at enrolment).
- visits file (one row per visit; study_no links to patients; enl_reaction 1/0).

Rules:
- ALWAYS compute with code. Never estimate or guess numbers.
- For predictor questions, compare enl_incident = 1 vs enl_ever = 0 and leave out enl_at_enrolment = 1 unless asked; say so.
- Report n for every group, and medians (IQR) for skewed lab values. Use non-parametric tests unless asked otherwise. Give exact p values.
- With small groups, say plainly that the result is underpowered.
- Patients are identified only by study number. Never try to identify anyone.
- Answer in short plain English for a doctor: the result first, then one or two lines on method. No long code explanations.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: member } = await sb.rpc('is_member');
    if (!member) return json({ error: 'Only signed-in team members can ask questions.' }, 403);

    const { question, history } = await req.json();
    const q = String(question ?? '').trim();
    if (!q || q.length > 1000) return json({ error: 'Type a question (up to 1000 characters).' }, 400);

    const [pt, vs] = await Promise.all([
      sb.from('v_analysis_patient').select('*').order('study_no'),
      sb.from('visits').select(VISIT_COLS.join(',') + ', patient:patients!inner(cr_no)').is('deleted_at', null).like('patient.cr_no', 'HD-%').order('visit_date'),
    ]);
    if (pt.error || vs.error) return json({ error: (pt.error ?? vs.error)!.message }, 500);
    const visits = (vs.data ?? []).map((v: any) => ({ study_no: v.patient?.cr_no, ...Object.fromEntries(VISIT_COLS.map(k => [k, v[k]])) }));
    const patientsCsv = csv(pt.data ?? []), visitsCsv = csv(visits, ['study_no', ...VISIT_COLS]);

    const prior = Array.isArray(history) ? history.slice(-3).map((h: any) => `Earlier question: ${String(h.q).slice(0, 500)}\nYour earlier answer: ${String(h.a).slice(0, 1500)}`).join('\n\n') : '';
    const key = Deno.env.get('GEMINI_API_KEY');
    if (!key) return json({ error: 'GEMINI_API_KEY is not set for this project' }, 500);
    const models = (Deno.env.get('GEMINI_MODELS') ?? 'gemini-3.6-flash,gemini-3.5-flash-lite').split(',').map(s => s.trim());

    let last = '';
    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            tools: [{ code_execution: {} }],
            contents: [{ role: 'user', parts: [
              { text: `${prior ? prior + '\n\n' : ''}Today is ${new Date().toISOString().slice(0, 10)}. ${pt.data?.length ?? 0} patients, ${visits.length} visits.\n\nQuestion: ${q}` },
              { inline_data: { mime_type: 'text/csv', data: toB64(patientsCsv) } },
              { inline_data: { mime_type: 'text/csv', data: toB64(visitsCsv) } },
            ] }],
            generationConfig: { temperature: 0 },
          }),
        });
        const text = await res.text();
        if (res.ok) {
          const parts = JSON.parse(text)?.candidates?.[0]?.content?.parts ?? [];
          const answer = parts.filter((p: any) => p.text).map((p: any) => p.text).join('\n').trim();
          const code = parts.filter((p: any) => p.executableCode).map((p: any) => p.executableCode.code);
          const outputs = parts.filter((p: any) => p.codeExecutionResult).map((p: any) => String(p.codeExecutionResult.output ?? '').slice(0, 4000));
          const { data: u } = await sb.auth.getUser();
          await sb.from('ask_log').insert({ question: q, answer: answer.slice(0, 8000), model, asked_by: u.user?.id });
          return json({ answer: answer || 'No answer came back. Try rephrasing the question.', code, outputs, model,
            rows: { patients: pt.data?.length ?? 0, visits: visits.length } });
        }
        last = `${model}: HTTP ${res.status} ${text.slice(0, 300)}`;
        if (res.status !== 429 && res.status !== 503) break;
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    return json({ error: 'Gemini could not answer. ' + last }, 502);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
