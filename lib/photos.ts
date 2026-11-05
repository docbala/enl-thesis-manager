import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from './supabase';

export type PhotoKind = 'profile' | 'lesion' | 'consent' | 'lab_report' | 'opd_slip';
export type Photo = { id: string; patient_id: string; visit_id: string | null; kind: PhotoKind; body_site: string | null;
  storage_path: string; mime_type: string; width: number | null; height: number | null; bytes: number | null; taken_at: string; note: string | null };

export const BODY_SITES = ['Face', 'Ears', 'Trunk front', 'Trunk back', 'Right arm', 'Left arm', 'Right forearm', 'Left forearm',
  'Right hand', 'Left hand', 'Right thigh', 'Left thigh', 'Right leg', 'Left leg', 'Right foot', 'Left foot', 'Other'] as const;

// Same compression as the spec: longest side and JPEG quality per kind. Re-encoding also drops EXIF/GPS.
const SIZE: Record<PhotoKind, { side: number; q: number }> = {
  profile: { side: 800, q: 0.75 }, lesion: { side: 1600, q: 0.8 },
  consent: { side: 2000, q: 0.85 }, lab_report: { side: 2000, q: 0.85 }, opd_slip: { side: 2000, q: 0.85 },
};

export type Picked = { base64: string; mime: string; width?: number; height?: number; bytes: number; name?: string };

async function compress(asset: { uri: string; width?: number; height?: number }, kind: PhotoKind): Promise<Picked> {
  const { side, q } = SIZE[kind];
  if (!asset.width || !asset.height) {                       // measure first when the picker did not report a size
    const probe = await ImageManipulator.manipulate(asset.uri).renderAsync();
    asset = { ...asset, width: probe.width, height: probe.height };
  }
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width!, asset.height!) > side) {
    ctx.resize(asset.width! >= asset.height! ? { width: side } : { height: side });
  }
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ compress: q, format: SaveFormat.JPEG, base64: true });
  const b64 = out.base64 ?? '';
  return { base64: b64, mime: 'image/jpeg', width: out.width, height: out.height, bytes: Math.round(b64.length * 0.75) };
}

// Camera or gallery, compressed. Returns null if the user cancels.
export async function pickImage(kind: PhotoKind, from: 'camera' | 'library'): Promise<Picked | null> {
  if (from === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera permission was not given.');
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false };
  const res = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  return compress({ uri: a.uri, width: a.width, height: a.height }, kind);
}

// A PDF or an image file (lab reports usually come as PDFs). Images are compressed; PDFs are kept as they are.
export async function pickDocument(kind: PhotoKind): Promise<Picked | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const mime = a.mimeType ?? (a.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  if (mime.startsWith('image/')) return compress({ uri: a.uri }, kind);
  if ((a.size ?? 0) > 10 * 1024 * 1024) throw new Error('This PDF is larger than 10 MB.');
  const base64 = await uriToBase64(a.uri);
  return { base64, mime: 'application/pdf', bytes: Math.round(base64.length * 0.75), name: a.name };
}

async function uriToBase64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(blob);
  });
}

function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Upload to the private bucket and record it. Path: <patient>/<kind>/<timestamp>.<ext>
export async function savePhoto(p: { patientId: string; visitId?: string | null; kind: PhotoKind; bodySite?: string | null; note?: string | null; file: Picked }) {
  const ext = p.file.mime === 'application/pdf' ? 'pdf' : 'jpg';
  const path = `${p.patientId}/${p.kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await supabase.storage.from('study-files').upload(path, base64ToBytes(p.file.base64), { contentType: p.file.mime, upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { data, error } = await supabase.from('photos').insert({
    patient_id: p.patientId, visit_id: p.visitId ?? null, kind: p.kind, body_site: p.bodySite ?? null, note: p.note ?? null,
    storage_path: path, mime_type: p.file.mime, width: p.file.width ?? null, height: p.file.height ?? null, bytes: p.file.bytes,
  }).select('*').single();
  if (error) { await supabase.storage.from('study-files').remove([path]); throw new Error(error.message); }
  return data as Photo;
}

export async function removePhoto(ph: Photo) {
  const { error } = await supabase.from('photos').update({ deleted_at: new Date().toISOString() }).eq('id', ph.id);
  if (error) throw new Error(error.message);
}

// Short-lived links for showing photos (members only; the bucket is private).
const cache = new Map<string, { url: string; until: number }>();
export async function signedUrls(paths: string[]) {
  const now = Date.now(), need = paths.filter(p => !(cache.get(p)?.until! > now));
  if (need.length) {
    const { data } = await supabase.storage.from('study-files').createSignedUrls(need, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) cache.set(d.path, { url: d.signedUrl, until: now + 50 * 60 * 1000 });
  }
  return Object.fromEntries(paths.map(p => [p, cache.get(p)?.url ?? null])) as Record<string, string | null>;
}

// Gemini scan through the server function (the key never reaches the phone).
export async function scanDocument(kind: 'lab_report' | 'opd_slip', file: Picked) {
  const { data, error } = await supabase.functions.invoke('scan', { body: { kind, mime: file.mime, data: file.base64 } });
  if (error) {
    let msg = error.message;
    try { const ctx: any = (error as any).context; if (ctx?.json) msg = (await ctx.json()).error ?? msg; } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as { kind: string; model: string; fields: Record<string, any>; notes: string[] };
}
