import { Redirect, Stack, usePathname, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
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
  if (!session && !onLogin) { if (pathname && pathname !== '/') afterLogin = pathname; return <Redirect href="/login" />; }
  if (session && onLogin) { const to = afterLogin ?? '/'; afterLogin = null; return <Redirect href={to as any} />; }
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: C.primary }, headerTintColor: '#fff', contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="patient/[id]" options={{ title: 'Patient' }} />
      <Stack.Screen name="patient/new" options={{ title: 'Enrol patient' }} />
      <Stack.Screen name="patient/edit" options={{ title: 'Edit patient' }} />
      <Stack.Screen name="visit/[id]" options={{ title: 'Visit' }} />
      <Stack.Screen name="photo/[id]" options={{ title: 'Photo' }} />
      <Stack.Screen name="photo/compare" options={{ title: 'Compare photos' }} />
      <Stack.Screen name="team" options={{ title: 'Team & settings' }} />
    </Stack>
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
