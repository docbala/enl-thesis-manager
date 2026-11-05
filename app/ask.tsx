import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { Btn, C, Card, H, Muted, page } from '../components/ui';
import { MembersOnly } from '../components/Guest';

type Turn = { q: string; a: string; code: string[]; outputs: string[]; model?: string; error?: boolean; open?: boolean };

const EXAMPLES = [
  'Compare baseline NLR between patients who developed ENL and those who did not.',
  'Which of the five predictors differ most between ENL and no ENL?',
  'What proportion developed ENL by 6 months, and the median time to ENL?',
  'Is baseline vitamin D3 lower in LL than BL patients?',
  'How many patients are lost to follow-up, and at which month?',
  'Does ESS fall after starting prednisolone 40 mg or more?',
];

// Questions about the study data, answered by Gemini running Python on the de-identified dataset.
export default function Ask() {
  const { session, role } = useSession();
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  async function send(text = q) {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true); setQ('');
    const history = turns.filter(t => !t.error).slice(-3).map(t => ({ q: t.q, a: t.a }));
    const { data, error } = await supabase.functions.invoke('ask', { body: { question, history } });
    let msg = error?.message;
    if (error) { try { const ctx: any = (error as any).context; if (ctx?.json) msg = (await ctx.json()).error ?? msg; } catch { /* keep message */ } }
    setTurns(prev => [...prev, error || data?.error
      ? { q: question, a: String(msg ?? data?.error ?? 'Something went wrong.'), code: [], outputs: [], error: true }
      : { q: question, a: data.answer, code: data.code ?? [], outputs: data.outputs ?? [], model: data.model }]);
    setBusy(false);
  }

  if (!session || !role) return <View style={{ padding: 16 }}><Stack.Screen options={{ title: 'Ask your data' }} /><MembersOnly what="Ask your data" /></View>;

  const mono = Platform.OS === 'web' ? 'ui-monospace, Menlo, Consolas, monospace' : Platform.OS === 'ios' ? 'Menlo' : 'monospace';
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Ask your data' }} />
      <Card>
        <H>Ask a question about your cohort</H>
        <Muted>Gemini answers by running Python on your data, and shows the calculation. Only de-identified data is sent: study numbers, clinical values and dates; no names, phone numbers, addresses, UHIDs, notes or photos.</Muted>
        <TextInput value={q} onChangeText={setQ} multiline placeholder="e.g. Is baseline PLR higher in patients who developed ENL?"
          placeholderTextColor="#98A2AE" onSubmitEditing={() => send()}
          style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, minHeight: 70, color: C.ink, marginTop: 10, backgroundColor: '#fff', fontSize: 15 }} />
        <Btn title={busy ? 'Working it out…' : 'Ask'} onPress={() => send()} busy={busy} />
        {!turns.length ? (
          <View style={{ marginTop: 6 }}>
            <Text style={{ color: C.quiet, fontWeight: '700', marginBottom: 6 }}>Try one</Text>
            {EXAMPLES.map(e => (
              <Pressable key={e} onPress={() => send(e)} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, marginBottom: 6, backgroundColor: '#fff' }}>
                <Text style={{ color: C.primary }}>{e}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Card>

      {busy ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 }}><ActivityIndicator /><Muted>Running the analysis (up to a minute)…</Muted></View> : null}

      {[...turns].reverse().map((t, i) => (
        <Card key={turns.length - i} style={t.error ? { backgroundColor: C.badBg, borderColor: C.bad } : undefined}>
          <Text style={{ color: C.primary, fontWeight: '800', marginBottom: 6 }}>{t.q}</Text>
          <Text style={{ color: C.ink, lineHeight: 22 }} selectable>{t.a.replace(/\*\*(.+?)\*\*/g, '$1')}</Text>
          {t.code.length ? (
            <View style={{ marginTop: 8 }}>
              <Pressable onPress={() => setTurns(prev => prev.map((x, j) => j === turns.length - 1 - i ? { ...x, open: !x.open } : x))}>
                <Text style={{ color: C.primary, fontWeight: '700' }}>{t.open ? 'Hide the calculation' : `Show the calculation (${t.code.length} step${t.code.length === 1 ? '' : 's'})`}</Text>
              </Pressable>
              {t.open ? t.code.map((c, k) => (
                <View key={k} style={{ marginTop: 8 }}>
                  <Text selectable style={{ fontFamily: mono, fontSize: 12, color: '#E8EEF4', backgroundColor: '#1F2933', padding: 10, borderRadius: 8 }}>{c}</Text>
                  {t.outputs[k] ? <Text selectable style={{ fontFamily: mono, fontSize: 12, color: C.ink, backgroundColor: C.tile, padding: 10, borderRadius: 8, marginTop: 4 }}>{t.outputs[k]}</Text> : null}
                </View>
              )) : null}
            </View>
          ) : !t.error ? <Muted>No calculation was shown for this answer; treat any numbers with care.</Muted> : null}
          {t.model ? <Muted>{t.model} · check important results in SPSS/R before using them in the thesis.</Muted> : null}
        </Card>
      ))}
    </ScrollView>
  );
}
