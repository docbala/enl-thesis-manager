import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/dialog';
import { Photo, Picked, savePhoto } from '../lib/photos';
import { Btn, C, Card, Chip, H, Muted, s } from './ui';
import { CaptureButtons, Thumb, useSignedUrls } from './Photos';

// Round profile photo for the patient header; tap to take or change it.
export function ProfileAvatar({ patientId, editable, refreshKey }: { patientId: string; editable: boolean; refreshKey: number }) {
  const [path, setPath] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.from('v_profile_photo').select('storage_path').eq('patient_id', patientId).maybeSingle();
    setPath((data as any)?.storage_path ?? null);
  }, [patientId]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const urls = useSignedUrls(path ? [path] : []);
  const url = path ? urls[path] : null;

  async function onPicked(f: Picked) {
    try { await savePhoto({ patientId, kind: 'profile', file: f }); setPicking(false); load(); }
    catch (e: any) { notify('Could not save the photo', e.message); }
  }
  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable onPress={() => editable && setPicking(x => !x)}>
        <View style={{ width: 84, height: 84, borderRadius: 42, overflow: 'hidden', backgroundColor: C.tile, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
          {url ? <Image source={{ uri: url }} style={{ width: 84, height: 84 }} /> : <Text style={{ fontSize: 30, color: C.quiet }}>👤</Text>}
        </View>
      </Pressable>
      {editable ? <Text style={{ fontSize: 11, color: C.primary, marginTop: 2 }}>{path ? 'Change' : 'Add photo'}</Text> : null}
      {picking ? <View style={{ width: 260 }}><CaptureButtons kind="profile" onPicked={onPicked} /></View> : null}
    </View>
  );
}

type Filter = 'lesion' | 'docs';

// All lesion photos and documents for a patient, filtered by body site, with a two-photo compare.
export function Gallery({ patientId, editable, refreshKey, consent }: { patientId: string; editable: boolean; refreshKey: number; consent: boolean }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [filter, setFilter] = useState<Filter>('lesion');
  const [site, setSite] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('photos').select('*').eq('patient_id', patientId).is('deleted_at', null)
      .neq('kind', 'profile').order('taken_at', { ascending: false });
    setPhotos((data ?? []) as Photo[]);
  }, [patientId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const lesions = photos.filter(p => p.kind === 'lesion');
  const docs = photos.filter(p => p.kind !== 'lesion');
  const sites = [...new Set(lesions.map(p => p.body_site ?? 'Other'))].sort();
  const shown = filter === 'lesion' ? lesions.filter(p => !site || (p.body_site ?? 'Other') === site) : docs;
  const urls = useSignedUrls(shown.filter(p => p.mime_type !== 'application/pdf').map(p => p.storage_path));

  function tap(p: Photo) {
    if (!comparing) { router.push(`/photo/${p.id}`); return; }
    setPicked(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id].slice(-2));
  }
  async function addConsent(f: Picked) {
    try { await savePhoto({ patientId, kind: 'consent', file: f }); setAdding(false); load(); }
    catch (e: any) { notify('Could not save', e.message); }
  }

  return (
    <Card>
      <View style={s.row}>
        <H>Photos & documents</H>
        <Muted>{lesions.length} lesion · {docs.length} docs</Muted>
      </View>
      {!consent ? <Muted>No photo consent recorded. Lesion photos can be added once consent is ticked in Edit details.</Muted> : null}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginVertical: 8 }}>
        <Pressable onPress={() => { setFilter('lesion'); setComparing(false); }}><Chip text="Lesions" tone={filter === 'lesion' ? 'good' : undefined} /></Pressable>
        <Pressable onPress={() => { setFilter('docs'); setComparing(false); setPicked([]); }}><Chip text="Consent, reports, slips" tone={filter === 'docs' ? 'good' : undefined} /></Pressable>
      </View>
      {filter === 'lesion' && sites.length > 1 ? (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <Pressable onPress={() => setSite(null)}><Chip text="All sites" tone={!site ? 'warn' : undefined} /></Pressable>
          {sites.map(x => <Pressable key={x} onPress={() => setSite(x)}><Chip text={x} tone={site === x ? 'warn' : undefined} /></Pressable>)}
        </View>
      ) : null}
      {shown.length === 0 ? <Muted>{filter === 'lesion' ? 'No lesion photos yet. Add them from a visit.' : 'No documents yet.'}</Muted> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {shown.map(p => <Thumb key={p.id} photo={p} url={urls[p.storage_path]} selected={picked.includes(p.id)} onPress={() => tap(p)} />)}
        </View>
      )}
      {filter === 'lesion' && lesions.length >= 2 ? (
        comparing ? (
          <View>
            <Muted>Tap two photos to compare ({picked.length}/2 chosen).</Muted>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Btn kind="ghost" title="Cancel" onPress={() => { setComparing(false); setPicked([]); }} /></View>
              <View style={{ flex: 1 }}><Btn title="Compare" onPress={() => picked.length === 2 ? router.push(`/photo/compare?a=${picked[0]}&b=${picked[1]}`) : notify('Choose two photos')} /></View>
            </View>
          </View>
        ) : <Btn kind="ghost" title="Compare two photos" onPress={() => setComparing(true)} />
      ) : null}
      {filter === 'docs' && editable ? (
        adding ? <CaptureButtons kind="consent" allowFile label="Signed consent form" onPicked={addConsent} />
          : <Btn kind="ghost" title="Add consent form" onPress={() => setAdding(true)} />
      ) : null}
    </Card>
  );
}
