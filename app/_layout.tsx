import { Redirect, Stack, usePathname, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { LoginPill } from '../components/Guest';
import { OfflineBanner, registerWebApp } from '../components/Offline';

registerWebApp();
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from '../lib/session';
import { C } from '../components/ui';

let afterLogin: string | null = null;   // e.g. a photo link opened from the Google Sheet before signing in

function Gate() {
  const { session, loading } = useSession();
  const segments = useSegments();
  const pathname = usePathname();
  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  const onLogin = segments[0] === 'login';
  // Visitors browse a de-identified, view-only copy; signing in is needed to see identities, edit or suggest.
  if (!session && !onLogin) afterLogin = pathname && pathname !== '/' ? pathname : null;
  if (session && onLogin) { const to = afterLogin ?? '/'; afterLogin = null; return <Redirect href={to as any} />; }
  return (
    <View style={{ flex: 1 }}>
    <OfflineBanner />
    <Stack key={session ? 'member' : 'guest'} screenOptions={{ headerStyle: { backgroundColor: C.primary }, headerTintColor: '#fff', contentStyle: { backgroundColor: C.bg },
      headerRight: session ? undefined : () => <LoginPill /> }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="patient/[id]" options={{ title: 'Patient' }} />
      <Stack.Screen name="patient/new" options={{ title: 'Enrol patient' }} />
      <Stack.Screen name="patient/edit" options={{ title: 'Edit patient' }} />
      <Stack.Screen name="visit/[id]" options={{ title: 'Visit' }} />
      <Stack.Screen name="patient/trends" options={{ title: 'Trends' }} />
      <Stack.Screen name="photo/[id]" options={{ title: 'Photo' }} />
      <Stack.Screen name="photo/compare" options={{ title: 'Compare photos' }} />
      <Stack.Screen name="ask" options={{ title: 'Ask your data' }} />
      <Stack.Screen name="team" options={{ title: 'Team & settings' }} />
    </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Gate />
    </SessionProvider>
  );
}
