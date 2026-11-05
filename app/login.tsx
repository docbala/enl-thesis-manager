import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/dialog';
import { Btn, C, Card, Field, HeaderCard, Muted, Screen } from '../components/ui';

// Email + password. Only emails the owner has invited can see data (enforced in the database).
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || password.length < 8) { notify('Check details', 'Enter your email and a password of at least 8 characters.'); return; }
    setBusy(true);
    const creds = { email: email.trim().toLowerCase(), password };
    const { error, data } = mode === 'signin' ? await supabase.auth.signInWithPassword(creds) : await supabase.auth.signUp(creds);
    setBusy(false);
    if (error) { notify('Could not continue', error.message); return; }
    if (mode === 'signup' && !data.session) {
      notify('Confirm your email', 'Open the confirmation email, tap the link, then come back and sign in.');
      setMode('signin');
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Text style={{ height: 40 }} />
        <HeaderCard />
        <Card>
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.primary, marginBottom: 12 }}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
          <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} onSubmitEditing={submit} />
          <Btn title={mode === 'signin' ? 'Sign in' : 'Create account'} onPress={submit} busy={busy} />
          <Btn kind="ghost" title={mode === 'signin' ? 'First time? Create account' : 'Have an account? Sign in'}
            onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')} />
        </Card>
        <Muted>Signing in shows patient identities and photos, and lets you edit or suggest changes as your role allows. Ask the study owner for an invite.</Muted>
        <Btn kind="ghost" title="Back to view-only" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
