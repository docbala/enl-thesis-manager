import { useEffect, useState } from 'react';
import { Image, Linking, Text, useWindowDimensions, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { canEdit, useSession } from '../../lib/session';
import { ask, notify } from '../../lib/dialog';
import { Photo, removePhoto, signedUrls } from '../../lib/photos';
import { fmt } from '../../lib/dates';
import { Btn, C, Card, Muted, Screen } from '../../components/ui';
import { labelOf } from '../../components/Photos';

// One photo or scanned document. This is also where the links in the Google Sheet open (sign-in required).
export default function PhotoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { role } = useSession();
  const { width } = useWindowDimensions();
  const [ph, setPh] = useState<Photo | null>(null);
  const [cr, setCr] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('photos').select('*, patient:patients(cr_no, patient_name)').eq('id', id).maybeSingle();
      if (!data) { setMissing(true); return; }
      setPh(data as Photo); setCr(`${(data as any).patient?.cr_no} · ${(data as any).patient?.patient_name}`);
      const u = await signedUrls([(data as Photo).storage_path]);
      setUrl(u[(data as Photo).storage_path]);
    })();
  }, [id]);

  if (missing) return <Screen><Muted>Photo not found, or you do not have access.</Muted></Screen>;
  if (!ph) return <Screen><Muted>Loading…</Muted></Screen>;
  const w = Math.min(width, 720) - 32;
  const h = ph.width && ph.height ? Math.round(w * ph.height / ph.width) : w;
  const pdf = ph.mime_type === 'application/pdf';

  async function del() {
    if (!(await ask('Remove this photo?', 'It is hidden from the app and the sheet link stops showing it (kept in the backup).', 'Remove', true))) return;
    try { await removePhoto(ph!); router.back(); } catch (e: any) { notify('Could not remove', e.message); }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: labelOf(ph.kind) }} />
      <Card>
        <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16 }}>{cr}</Text>
        <Muted>{labelOf(ph.kind)}{ph.body_site ? ` · ${ph.body_site}` : ''} · {fmt(ph.taken_at.slice(0, 10))}{ph.bytes ? ` · ${Math.round(ph.bytes / 1024)} KB` : ''}</Muted>
        {ph.note ? <Muted>{ph.note}</Muted> : null}
      </Card>
      {pdf
        ? <Btn title="Open PDF" onPress={() => url && Linking.openURL(url)} />
        : url ? <Image source={{ uri: url }} style={{ width: w, height: h, borderRadius: 12, backgroundColor: C.tile }} resizeMode="contain" /> : <Muted>Loading image…</Muted>}
      <View style={{ height: 12 }} />
      <Btn kind="ghost" title="Open patient" onPress={() => router.push(`/patient/${ph.patient_id}`)} />
      {canEdit(role) ? <Btn kind="danger" title="Remove photo" onPress={del} /> : null}
    </Screen>
  );
}
