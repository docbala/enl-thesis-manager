import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSession } from '../lib/session';
import { supabase } from '../lib/supabase';
import { C, TONES } from './ui';

export function LoginPill() {
  return (
    <Pressable onPress={() => router.push('/login')} accessibilityLabel="Log in"
      style={{ backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginRight: 12 }}>
      <Text style={{ color: C.primary, fontWeight: '800' }}>Log in</Text>
    </Pressable>
  );
}

// Shown to visitors who are not signed in.
export function GuestBanner({ compact }: { compact?: boolean }) {
  const { guest, pending, session } = useSession();
  if (!guest) return null;
  if (pending) return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: TONES.amber.bg, borderColor: TONES.amber.border, borderWidth: 1,
      borderRadius: 14, padding: 12, marginBottom: 14 }}>
      <MaterialCommunityIcons name="account-clock-outline" size={22} color={C.warn} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.warn, fontWeight: '800' }}>Access request sent</Text>
        {compact ? null : <Text style={{ color: C.ink, marginTop: 2 }}>Signed in as {session?.user.email}. Until the study owner approves you, you see the de-identified view: study numbers only, no names, contacts or photos.</Text>}
      </View>
      <Text onPress={() => supabase.auth.signOut()} style={{ color: C.primary, fontWeight: '800' }}>Sign out</Text>
    </View>
  );
  return (
    <Pressable onPress={() => router.push('/login')}
      style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: TONES.blue.bg, borderColor: TONES.blue.border, borderWidth: 1,
        borderRadius: 14, padding: 12, marginBottom: 14 }}>
      <MaterialCommunityIcons name="eye-outline" size={22} color={C.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.primary, fontWeight: '800' }}>View-only preview</Text>
        {compact ? null : <Text style={{ color: C.ink, marginTop: 2 }}>Patients are shown by study number. Names, contacts and photos are hidden. Log in to see them, edit, or suggest changes.</Text>}
      </View>
      <Text style={{ color: C.primary, fontWeight: '800' }}>Log in ›</Text>
    </Pressable>
  );
}

// In place of something only members can see.
export function MembersOnly({ what }: { what: string }) {
  return <Text style={{ color: C.quiet, fontStyle: 'italic' }}>🔒 {what} — log in to see</Text>;
}
