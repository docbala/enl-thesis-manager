import AsyncStorage from '@react-native-async-storage/async-storage';

// Read-only offline mode. Every successful read from the database is saved on this device; when the network is
// down, the same read returns the saved copy. Saving changes still needs the network (visit forms keep a draft).

type State = { offline: boolean; savedAt: number | null };
let state: State = { offline: false, savedAt: null };
const subs = new Set<(s: State) => void>();
const set = (s: Partial<State>) => { state = { ...state, ...s }; subs.forEach(f => f(state)); };
export const offlineState = () => state;
export const onOffline = (f: (s: State) => void) => { subs.add(f); return () => { subs.delete(f); }; };

const PREFIX = 'offline:';
const MAX_ENTRY = 600_000;        // skip very large single responses
const isRead = (url: string, method: string) =>
  url.includes('/rest/v1/') && (method === 'GET' || (method === 'HEAD') || (method === 'POST' && /\/rpc\/(my_role|is_member)\b/.test(url)));

// The signed-in user is part of the key, so a visitor never sees a member's saved copy on a shared device.
function keyFor(url: string, auth: string | null) {
  let who = 'guest';
  try { if (auth) who = JSON.parse(atob(auth.replace(/^Bearer /, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub ?? 'guest'; } catch { /* anon key */ }
  return PREFIX + who + ':' + url.replace(/^https?:\/\/[^/]+/, '');
}

export const offlineFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const method = (init?.method ?? (input as Request)?.method ?? 'GET').toUpperCase();
  if (!isRead(url, method)) {
    const r = await fetch(input as any, init);
    if (state.offline) set({ offline: false });
    return r;
  }
  const headers = new Headers(init?.headers ?? (input as Request)?.headers);
  const key = keyFor(url, headers.get('Authorization'));
  try {
    const res = await fetch(input as any, init);
    if (res.ok && method !== 'HEAD') {
      const body = await res.clone().text();
      if (body.length < MAX_ENTRY) {
        AsyncStorage.setItem(key, JSON.stringify({ at: Date.now(), status: res.status, range: res.headers.get('content-range'), body })).catch(() => {});
      }
    }
    if (state.offline) set({ offline: false, savedAt: null });
    return res;
  } catch (e) {
    const raw = await AsyncStorage.getItem(key).catch(() => null);
    if (!raw) throw e;
    const saved = JSON.parse(raw) as { at: number; status: number; range: string | null; body: string };
    set({ offline: true, savedAt: Math.min(state.savedAt ?? saved.at, saved.at) });
    return new Response(saved.body, { status: saved.status, headers: { 'Content-Type': 'application/json', ...(saved.range ? { 'Content-Range': saved.range } : {}), 'X-Offline-Copy': '1' } });
  }
};

/** Remove everything saved for offline use (on sign-out). */
export async function clearOffline() {
  const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(PREFIX));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}

// ---- drafts for forms, so typed data survives a dropped connection or a closed tab
export async function saveDraft(key: string, value: unknown) {
  try { await AsyncStorage.setItem('draft:' + key, JSON.stringify({ at: Date.now(), value })); } catch { /* storage full or blocked */ }
}
export async function loadDraft<T>(key: string): Promise<{ at: number; value: T } | null> {
  try { const raw = await AsyncStorage.getItem('draft:' + key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export async function clearDraft(key: string) { try { await AsyncStorage.removeItem('draft:' + key); } catch { /* ignore */ } }
