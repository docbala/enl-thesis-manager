// Called by the weekly backup in the Google Apps Script with the sync secret.
// Returns short-lived download links for photos and scans added since a given time.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const { secret, since } = await req.json();
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: s } = await admin.from('sync_secrets').select('secret_hash').eq('id', 1).single();
    if (!secret || !s || s.secret_hash !== await sha256(String(secret))) return json({ error: 'bad secret' }, 401);

    const { data: rows, error } = await admin.from('photos')
      .select('id, storage_path, kind, body_site, mime_type, taken_at, created_at, patient:patients(cr_no)')
      .is('deleted_at', null).gt('created_at', since || '1970-01-01').order('created_at').limit(200);
    if (error) return json({ error: error.message }, 500);
    if (!rows?.length) return json({ items: [], more: false });
    const { data: signed, error: sErr } = await admin.storage.from('study-files').createSignedUrls(rows.map(r => r.storage_path), 3600);
    if (sErr) return json({ error: sErr.message }, 500);
    const urlOf = new Map((signed ?? []).map(x => [x.path, x.signedUrl]));
    return json({
      items: rows.map((r: any) => ({ id: r.id, cr_no: r.patient?.cr_no, kind: r.kind, body_site: r.body_site, mime_type: r.mime_type,
        taken_at: r.taken_at, created_at: r.created_at, path: r.storage_path, url: urlOf.get(r.storage_path) })),
      more: rows.length === 200,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
