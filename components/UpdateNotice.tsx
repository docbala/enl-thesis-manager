import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { C, TONES } from './ui';

const REPO = 'docbala/enl-thesis-manager';
const newer = (a: string, b: string) => {          // is version a newer than b?
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

// Android app only: tells you when a newer APK has been published, with a one-tap download.
export function UpdateNotice() {
  const [rel, setRel] = useState<{ version: string; url: string } | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const v = String(j?.tag_name ?? '').replace(/^apk-v/, '');
        const apk = (j?.assets ?? []).find((a: any) => String(a.name).endsWith('.apk'));
        const mine = Constants.expoConfig?.version ?? '0.0.0';
        if (v && apk && newer(v, mine)) setRel({ version: v, url: apk.browser_download_url });
      })
      .catch(() => { /* offline: try next time */ });
  }, []);
  if (!rel) return null;
  return (
    <Pressable onPress={() => Linking.openURL(rel.url)}
      style={{ backgroundColor: TONES.green.bg, borderColor: TONES.green.border, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 }}>
      <Text style={{ color: TONES.green.title, fontWeight: '800' }}>Update available: version {rel.version}</Text>
      <View><Text style={{ color: C.ink, marginTop: 2 }}>Tap to download, then open the file to install. Your data stays in the cloud.</Text></View>
    </Pressable>
  );
}
