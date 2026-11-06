import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
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
  const [ready, setReady] = useState(false);     // an over-the-air update has been downloaded
  useEffect(() => {
    if (Platform.OS !== 'android' || !Updates.isEnabled) return;
    (async () => {
      try {
        const c = await Updates.checkForUpdateAsync();
        if (c.isAvailable) { await Updates.fetchUpdateAsync(); setReady(true); }
      } catch { /* offline or no update */ }
    })();
  }, []);
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
  if (ready && !rel) return (
    <Pressable onPress={() => Updates.reloadAsync()}
      style={{ backgroundColor: TONES.blue.bg, borderColor: TONES.blue.border, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 }}>
      <Text style={{ color: TONES.blue.title, fontWeight: '800' }}>App updated</Text>
      <Text style={{ color: C.ink, marginTop: 2 }}>Tap to restart and use the latest version (takes a second).</Text>
    </Pressable>
  );
  if (!rel) return null;
  return (
    <Pressable onPress={() => Linking.openURL(rel.url)}
      style={{ backgroundColor: TONES.green.bg, borderColor: TONES.green.border, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 }}>
      <Text style={{ color: TONES.green.title, fontWeight: '800' }}>Update available: version {rel.version}</Text>
      <View><Text style={{ color: C.ink, marginTop: 2 }}>Tap to download, then open the file to install. Your data stays in the cloud.</Text></View>
    </Pressable>
  );
}
