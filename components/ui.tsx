import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

export const C = {
  bg: '#F4F6F9', card: '#FFFFFF', ink: '#1C2430', quiet: '#5E6B7A', line: '#DDE3EA',
  primary: '#1F4E78', primaryInk: '#FFFFFF', good: '#1E7B4F', warn: '#B26A00', bad: '#B3261E',
  goodBg: '#E3F3EA', warnBg: '#FFF2DC', badBg: '#FCE8E6', infoBg: '#E6EEF7',
};

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function H({ children }: { children: React.ReactNode }) {
  return <Text style={s.h}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={s.muted}>{children}</Text>;
}

export function Btn({ title, onPress, kind = 'primary', busy, disabled }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; busy?: boolean; disabled?: boolean;
}) {
  const bg = kind === 'primary' ? C.primary : kind === 'danger' ? C.bad : 'transparent';
  const fg = kind === 'ghost' ? C.primary : C.primaryInk;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={busy || disabled}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: pressed || disabled ? 0.6 : 1 },
        kind === 'ghost' && { borderWidth: 1, borderColor: C.primary }]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, unit, warn, ...props }: TextInputProps & { label: string; unit?: string; warn?: string | null }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.label}>{label}{unit ? <Text style={s.unit}>  {unit}</Text> : null}</Text>
      <TextInput placeholderTextColor="#98A2AE" {...props}
        style={[s.input, warn ? { borderColor: C.warn, backgroundColor: C.warnBg } : null]} />
      {warn ? <Text style={s.warn}>{warn}</Text> : null}
    </View>
  );
}

export function Chip({ text, tone = 'info' }: { text: string; tone?: 'good' | 'warn' | 'bad' | 'info' }) {
  const map = { good: [C.goodBg, C.good], warn: [C.warnBg, C.warn], bad: [C.badBg, C.bad], info: [C.infoBg, C.primary] };
  const [bg, fg] = map[tone];
  return <View style={[s.chip, { backgroundColor: bg }]}><Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{text}</Text></View>;
}

export function Choice<T extends string>({ value, options, onChange }: { value: T | null; options: T[]; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
      {options.map(o => (
        <Pressable key={o} onPress={() => onChange(o)}
          style={[s.choice, value === o && { backgroundColor: C.primary, borderColor: C.primary }]}>
          <Text style={{ color: value === o ? '#fff' : C.ink, fontSize: 14 }}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: C.line },
  h: { fontSize: 16, fontWeight: '700', color: C.ink, marginBottom: 8 },
  muted: { fontSize: 13, color: C.quiet },
  btn: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', marginVertical: 4 },
  btnText: { fontSize: 15, fontWeight: '600' },
  label: { fontSize: 13, color: C.ink, fontWeight: '600', marginBottom: 4 },
  unit: { fontWeight: '400', color: C.quiet },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink, backgroundColor: '#fff' },
  warn: { color: C.warn, fontSize: 12, marginTop: 3 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  choice: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
