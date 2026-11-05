// Reads a lab report or OPD slip with Gemini and returns the fields for the app to show for review.
// Only signed-in members with edit rights can use it. The Gemini key lives only in this function's secrets.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const LAB_PROMPT = `You are reading an Indian hospital laboratory report. Extract the values and return ONE JSON object with exactly these keys:
"name_on_report", "uhid_on_report", "report_date" (YYYY-MM-DD or null),
"hb" (g/dL), "tlc" (in thousands per microlitre, e.g. 7.7 for 7700/cumm), "granulocyte_pct" (neutrophils %), "lymphocyte_pct" (%),
"platelets" (in thousands per microlitre, e.g. 322 for 3.22 lakh/cumm or 322000/cumm),
"sgot", "sgpt", "alp" (U/L), "total_protein", "albumin", "globulin" (g/dL), "urea", "creatinine", "uric_acid" (mg/dL),
"crp" (mg/L), "esr" (mm/hr), "vit_d3" (ng/mL; convert nmol/L by dividing by 2.5), "vit_b12" (pg/mL),
"vit_b12_flag" ("<" or ">" if the report says below/above the measurable range, else null), "hba1c" (%).
Rules: numbers only (no units, no text) for every value field. Use null when a test is not on the report or is unreadable.
Never guess. Do not copy reference ranges as results.`;

const OPD_PROMPT = `You are reading an Indian hospital OPD registration slip, possibly with handwritten notes. Return ONE JSON object with exactly these keys:
"uhid" (the part before any "/"), "patient_name", "age" (number), "sex" ("Male" or "Female"), "relative_name", "contact" (digits only),
"address", "opd_slip_no", "mdt_status" ("On MDT" if notes mention MDT, MDT-MB, MDT-PB or blister pack, else "Newly Diagnosed (Naive)"),
"mdt_month" (integer month or blister-pack number if written, e.g. "3rd BP" -> 3, else null).
Use null for anything missing or unreadable. Never guess.`;

const num = (x: unknown) => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(String(x).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Safety net for unit slips the model sometimes makes
function tidyLab(r: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...r };
  for (const k of ['hb', 'tlc', 'granulocyte_pct', 'lymphocyte_pct', 'platelets', 'sgot', 'sgpt', 'alp', 'total_protein', 'albumin',
                   'globulin', 'urea', 'creatinine', 'uric_acid', 'crp', 'esr', 'vit_d3', 'vit_b12', 'hba1c']) out[k] = num(r[k]);
  const notes: string[] = [];
  if ((out.tlc as number) > 200) { out.tlc = Math.round((out.tlc as number) / 10) / 100; notes.push('TLC converted to ×10³/µL'); }
  if ((out.platelets as number) > 5000) { out.platelets = Math.round((out.platelets as number) / 1000); notes.push('Platelets converted to ×10³/µL'); }
  else if ((out.platelets as number) > 0 && (out.platelets as number) < 10) { out.platelets = Math.round((out.platelets as number) * 100); notes.push('Platelets converted from lakh to ×10³/µL'); }
  if (out.vit_b12_flag !== '<' && out.vit_b12_flag !== '>') out.vit_b12_flag = null;
  return { fields: out, notes };
}

async function gemini(prompt: string, mime: string, data: string) {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY is not set for this project');
  const models = (Deno.env.get('GEMINI_MODELS') ?? 'gemini-3.6-flash,gemini-3.5-flash-lite').split(',').map(s => s.trim());
  let last = '';
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data } }] }],
          generationConfig: { response_mime_type: 'application/json', temperature: 0 },
        }),
      });
      const text = await res.text();
      if (res.ok) {
        const out = JSON.parse(text)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        return { model, result: JSON.parse(out.replace(/```json|```/g, '').trim()) };
      }
      last = `${model}: HTTP ${res.status} ${text.slice(0, 200)}`;
      if (res.status !== 429 && res.status !== 503) break;
      await new Promise(r => setTimeout(r, 1200));
    }
  }
  throw new Error('Gemini could not read the file. ' + last);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: allowed, error: roleErr } = await sb.rpc('can_edit');
    if (roleErr || !allowed) return json({ error: 'Only invited members with edit rights can scan.' }, 403);

    const { kind, mime, data } = await req.json();
    if (!['lab_report', 'opd_slip'].includes(kind)) return json({ error: 'Unknown scan type' }, 400);
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime)) return json({ error: 'Use a photo or a PDF' }, 400);
    if (typeof data !== 'string' || data.length > 14_000_000) return json({ error: 'File too large (max about 10 MB)' }, 400);

    const { model, result } = await gemini(kind === 'lab_report' ? LAB_PROMPT : OPD_PROMPT, mime, data);
    if (kind === 'lab_report') {
      const { fields, notes } = tidyLab(result ?? {});
      return json({ kind, model, fields, notes });
    }
    const r = result ?? {};
    return json({ kind, model, fields: { ...r, age: num(r.age), mdt_month: num(r.mdt_month),
      contact: r.contact ? String(r.contact).replace(/\D/g, '').slice(-10) : null,
      uhid: r.uhid ? String(r.uhid).split('/')[0].trim() : null }, notes: [] });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
