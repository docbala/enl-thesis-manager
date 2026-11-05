import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { notify } from '../lib/dialog';
import { Photo, Picked, pickDocument, pickImage, PhotoKind, signedUrls } from '../lib/photos';
import { fmt } from '../lib/dates';
import { C, Chip } from './ui';

export function useSignedUrls(paths: string[]) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const key = paths.join('|');
  useEffect(() => { let on = true; if (paths.length) signedUrls(paths).then(u => on && setUrls(u)); return () => { on = false; }; }, [key]);
  return urls;
}

export function Thumb({ photo, url, size = 96, selected, onPress }: { photo: Photo; url: string | null | undefined; size?: number; selected?: boolean; onPress?: () => void }) {
  const pdf = photo.mime_type === 'application/pdf';
  return (
    <Pressable onPress={onPress} style={{ width: size, marginRight: 8, marginBottom: 8 }}>
      <View style={{ width: size, height: size, borderRadius: 10, overflow: 'hidden', backgroundColor: C.tile, alignItems: 'center', justifyContent: 'center',
        borderWidth: selected ? 3 : 1, borderColor: selected ? C.primary : C.line }}>
        {pdf ? <MaterialCommunityIcons name="file-pdf-box" size={size / 2} color={C.bad} />
          : url ? <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          : <ActivityIndicator />}
      </View>
      <Text numberOfLines={1} style={{ fontSize: 11, color: C.ink, fontWeight: '600', marginTop: 2 }}>{photo.body_site ?? labelOf(photo.kind)}</Text>
      <Text style={{ fontSize: 10, color: C.quiet }}>{fmt(photo.taken_at.slice(0, 10))}</Text>
    </Pressable>
  );
}

export const labelOf = (k: PhotoKind) => ({ profile: 'Profile', lesion: 'Lesion', consent: 'Consent form', lab_report: 'Lab report', opd_slip: 'OPD slip' }[k]);

// Camera / gallery (/ file for documents) buttons. Calls onPicked with a compressed file.
export function CaptureButtons({ kind, onPicked, allowFile, disabled, label }: {
  kind: PhotoKind; onPicked: (f: Picked) => void; allowFile?: boolean; disabled?: boolean; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<Picked | null>) {
    if (disabled) return;
    setBusy(true);
    try { const f = await fn(); if (f) onPicked(f); }
    catch (e: any) { notify('Could not add the file', e.message); }
    setBusy(false);
  }
  const btn = (icon: keyof typeof MaterialCommunityIcons.glyphMap, text: string, onPress: () => void) => (
    <Pressable key={text} onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11,
        borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', opacity: pressed || disabled ? 0.6 : 1 })}>
      <MaterialCommunityIcons name={icon} size={20} color={C.primary} />
      <Text style={{ color: C.primary, fontWeight: '700' }}>{text}</Text>
    </Pressable>
  );
  return (
    <View style={{ marginVertical: 6 }}>
      {label ? <Text style={{ color: C.ink, fontWeight: '700', marginBottom: 6 }}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {btn('camera', 'Camera', () => run(() => pickImage(kind, 'camera')))}
        {btn('image-multiple', 'Gallery', () => run(() => pickImage(kind, 'library')))}
        {allowFile ? btn('file-document', 'PDF / file', () => run(() => pickDocument(kind))) : null}
      </View>
      {busy ? <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 6 }}><ActivityIndicator /><Text style={{ color: C.quiet }}>Compressing…</Text></View> : null}
    </View>
  );
}

// Photos chosen before the record exists; uploaded right after it is saved.
export function PendingList({ items, onRemove }: { items: { file: Picked; label: string }[]; onRemove: (i: number) => void }) {
  if (!items.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
      {items.map((it, i) => (
        <Pressable key={i} onPress={() => onRemove(i)}>
          <Chip text={`${it.label} · ${Math.round(it.file.bytes / 1024)} KB  ✕`} />
        </Pressable>
      ))}
    </View>
  );
}
