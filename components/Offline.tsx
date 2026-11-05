import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { offlineState, onOffline } from '../lib/offline';
import { TONES, C } from './ui';

// Thin strip at the top while the app is showing data saved on this device.
export function OfflineBanner() {
  const [s, setS] = useState(offlineState());
  const [netDown, setNetDown] = useState(Platform.OS === 'web' && typeof navigator !== 'undefined' ? !navigator.onLine : false);
  useEffect(() => onOffline(setS), []);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const on = () => setNetDown(false), off = () => setNetDown(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!s.offline && !netDown) return null;
  const when = s.savedAt ? new Date(s.savedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <View style={{ backgroundColor: TONES.amber.bg, borderBottomColor: TONES.amber.border, borderBottomWidth: 1, paddingHorizontal: 14, paddingVertical: 8 }}>
      <Text style={{ color: C.warn, fontWeight: '800' }}>Offline · view only</Text>
      <Text style={{ color: C.ink, fontSize: 12 }}>
        {when ? `Showing data saved on this device (${when}). ` : 'Showing data saved on this device. '}Changes cannot be saved until you are back online; forms keep a draft.
      </Text>
    </View>
  );
}

// Web: register the offline app shell and the install-to-home-screen manifest.
export function registerWebApp() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const base = '/enl-thesis-manager/';
  if (!document.querySelector('link[rel="manifest"]')) {
    const l = document.createElement('link'); l.rel = 'manifest'; l.href = base + 'manifest.json'; document.head.appendChild(l);
    const a = document.createElement('link'); a.rel = 'apple-touch-icon'; a.href = base + 'icon-192.png'; document.head.appendChild(a);
  }
  if ('serviceWorker' in navigator && location.pathname.startsWith(base)) {
    navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch(() => { /* offline shell is optional */ });
  }
}
