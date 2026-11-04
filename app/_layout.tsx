import { Redirect, Stack, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from '../lib/session';
import { C } from '../components/ui';

function Gate() {
  const { session, loading } = useSession();
  const segments = useSegments();
  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  const onLogin = segments[0] === 'login';
  if (!session && !onLogin) return <Redirect href="/login" />;
  if (session && onLogin) return <Redirect href="/" />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: C.primary }, headerTintColor: '#fff', contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="patient/[id]" options={{ title: 'Patient' }} />
      <Stack.Screen name="patient/new" options={{ title: 'Enrol patient' }} />
      <Stack.Screen name="patient/edit" options={{ title: 'Edit patient' }} />
      <Stack.Screen name="visit/[id]" options={{ title: 'Visit' }} />
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
