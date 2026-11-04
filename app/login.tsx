import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { supabase } from '../lib/supabase';
import { Btn, C, Card, Field, Muted } from '../components/ui';

// Email + password. Only emails the owner has invited can see data (enforced in the database).
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || password.length < 8) {
      Alert.alert('Check details', 'Enter your email and a password of at least 8 characters.');
      return;
    }
    setBusy(true);
    const creds = { email: email.trim().toLowerCase(), password };
    const { error, data } = mode === 'signin'
      ? await supabase.auth.signInWithPassword(creds)
      : await supabase.auth.signUp(creds);
    setBusy(false);
    if (error) { Alert.alert('Could not continue', error.message); return; }
    if (mode === 'signup' && !data.session) {
      Alert.alert('Confirm your email', 'Open the confirmation email on this phone, tap the link, then come back and sign in.');
      setMode('signin');
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 80 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: C.primary }}>ENL Thesis Manager</Text>
        <Muted>Department of DVL, M.G.M. Medical College & M.Y. Hospital, Indore</Muted>
        <Card style={{ marginTop: 24 }}>
          <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} />
          <Btn title={mode === 'signin' ? 'Sign in' : 'Create account'} onPress={submit} busy={busy} />
          <Btn kind="ghost" title={mode === 'signin' ? 'First time? Create account' : 'Have an account? Sign in'}
            onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')} />
        </Card>
        <Muted>Only invited members can see patient data. Ask the study owner for an invite.</Muted>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
