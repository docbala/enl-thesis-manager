import React, { useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput,
  TextInputProps, View, ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Colours taken from the current Apps Script web app so both look the same.
export const C = {
  bg: '#F4F6F9', card: '#FFFFFF', ink: '#1F2933', quiet: '#6B7785', line: '#E3E8EE', tile: '#EEF2F7',
  primary: '#1F4E78', primaryInk: '#FFFFFF',
  good: '#1E8E3E', goodBg: '#D9EFDF', warn: '#C25E00', warnBg: '#FFF3D6', bad: '#B3261E', badBg: '#FCE8E6',
  teal: '#1497A6', amber: '#F2A900', infoBg: '#E3ECF5',
  whatsapp: '#25D366', call: '#2E9E4F', sms: '#1E88E5',
};

export const TONES = {
  blue: { bg: '#EAF4FB', border: '#BFE0F4', title: '#1F4E78' },
  amber: { bg: '#FFF8E1', border: '#F3DB91', title: '#C25E00' },
  pink: { bg: '#FCEAF1', border: '#F2BFD2', title: '#9C1458' },
  green: { bg: '#EAF7EF', border: '#2E9E4F', title: '#1E7B3F' },
} as const;
export type Tone = keyof typeof TONES;

const shadow: ViewStyle = Platform.select({
  web: { boxShadow: '0 2px 10px rgba(16,24,40,0.06)' } as ViewStyle,
  default: { elevation: 2, shadowColor: '#101828', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
})!;

// Phone-width column, centred on a wide browser window.
export const page: ViewStyle = { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 720, alignSelf: 'center' };

export function Screen({ children, refreshing, onRefresh }: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={page} keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, shadow, style]}>{children}</View>;
}

export function H({ children }: { children: React.ReactNode }) {
  return <Text style={s.h}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={s.muted}>{children}</Text>;
}

export function HeaderCard() {
  return (
    <Card>
      <Text style={{ fontSize: 20, fontWeight: '800', color: C.primary, lineHeight: 26 }}>
        DEPT. OF DERMATOLOGY · M.G.M. MEDICAL COLLEGE, INDORE
      </Text>
      <Text style={{ fontSize: 15, fontWeight: '700', color: C.primary, marginTop: 2 }}>ENL Thesis Manager</Text>
      <View style={{ backgroundColor: C.infoBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginTop: 12 }}>
        <Text style={{ color: C.primary, fontWeight: '700' }}>ENL Prediction in Leprosy Patients · Dr. Shubham Bala</Text>
      </View>
    </Card>
  );
}

export function StatTile({ value, label, tone, sub, onPress }: { value: number | string; label: string; tone?: 'amber'; sub?: string; onPress?: () => void }) {
  const amber = tone === 'amber';
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => ({ flex: 1, minWidth: 140, backgroundColor: amber ? TONES.amber.bg : C.tile, borderRadius: 12,
        paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center', borderWidth: 2, borderColor: amber ? TONES.amber.border : 'transparent', opacity: pressed ? 0.75 : 1 })}>
      <Text style={{ fontSize: 30, fontWeight: '800', color: amber ? C.warn : C.primary }}>{value}</Text>
      <Text style={{ color: C.quiet, marginTop: 2, textAlign: 'center' }}>{label}</Text>
      {sub ? <Text style={{ color: C.quiet, fontSize: 11, marginTop: 2, textAlign: 'center' }}>{sub}</Text> : null}
      {onPress ? <Text style={{ color: amber ? C.warn : C.primary, fontSize: 11, fontWeight: '700', marginTop: 4 }}>View list ›</Text> : null}
    </Pressable>
  );
}

export function ProgressCard({ title, pct, caption, color }: { title: string; pct: number; caption: string; color: string }) {
  const w = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <View style={{ backgroundColor: '#F7F9FB', borderRadius: 14, padding: 16, marginTop: 12, borderLeftWidth: 4, borderLeftColor: color }}>
      <View style={s.row}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink }}>{title}</Text>
        <Text style={{ fontSize: 16, fontWeight: '800', color }}>{w}%</Text>
      </View>
      <View style={{ height: 10, backgroundColor: '#E6E9EE', borderRadius: 5, marginTop: 12, overflow: 'hidden' }}>
        <View style={{ width: `${w}%`, height: 10, backgroundColor: color, borderRadius: 5 }} />
      </View>
      <Text style={{ color: C.quiet, marginTop: 10 }}>{caption}</Text>
    </View>
  );
}

// A coloured section that shows 3 rows and a "Show all" toggle, like the current web app.
export function Section<T>({ title, icon, tone, items, render, empty, keyOf }: {
  title: string; icon: string; tone: Tone; items: T[]; render: (t: T) => React.ReactNode; empty: string; keyOf: (t: T) => string;
}) {
  const [all, setAll] = useState(false);
  const t = TONES[tone];
  const shown = all ? items : items.slice(0, 3);
  return (
    <View style={{ backgroundColor: t.bg, borderColor: t.border, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 }}>
      <Text style={{ fontSize: 18, fontWeight: '800', color: t.title, marginBottom: 10 }}>{icon}  {title} ({items.length})</Text>
      {items.length === 0 ? <Text style={{ color: C.quiet }}>{empty}</Text> : shown.map(it => <View key={keyOf(it)}>{render(it)}</View>)}
      {items.length > 3 ? (
        <Pressable onPress={() => setAll(!all)} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: t.border, borderRadius: 10,
          paddingVertical: 12, alignItems: 'center', marginTop: 2, backgroundColor: 'rgba(255,255,255,0.5)' }}>
          <Text style={{ color: t.title, fontWeight: '700', fontSize: 15 }}>{all ? '▲ Show less' : `▼ Show all (${items.length} cases)`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function PersonRow({ name, id, badge, badgeTone = 'good', sub, subColor, onPress, right, left }: {
  name: string; id: string; badge?: string | null; badgeTone?: 'good' | 'warn'; sub?: string; subColor?: string;
  onPress?: () => void; right?: React.ReactNode; left?: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.person, { opacity: pressed ? 0.85 : 1 }]}>
      {left ? <View style={{ marginRight: 12 }}>{left}</View> : null}
      <View style={{ flex: 1, paddingRight: 8 }}>
        {/* visitors see the study number in place of the name */}
        <Text style={{ fontSize: 16, color: C.ink }}><Text style={{ fontWeight: '800' }}>{name}</Text>{name === id ? '' : ` (${id})`}</Text>
        {badge ? <View style={{ marginTop: 4 }}><Chip text={badge} tone={badgeTone} big /></View> : null}
        {sub ? <Text style={{ color: subColor ?? C.quiet, marginTop: 3 }}>{sub}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

export function RoundBtn({ icon, color, onPress, filled, label }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string; onPress: () => void; filled?: boolean; label: string }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: filled ? color : '#fff', borderWidth: filled ? 0 : 1, borderColor: C.line, opacity: pressed ? 0.7 : 1 }, shadow]}>
      <MaterialCommunityIcons name={icon} size={22} color={filled ? '#fff' : color} />
    </Pressable>
  );
}

export function ContactButtons({ phone, message, sms = true, onSent }: { phone: string | null; message: string; sms?: boolean; onSent?: (channel: 'call' | 'sms' | 'whatsapp') => void }) {
  const p = (phone ?? '').replace(/\D/g, '').slice(-10);
  if (!p) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <RoundBtn label="Call" icon="phone" color={C.call} onPress={() => { onSent?.('call'); Linking.openURL(`tel:${p}`); }} />
      {sms ? <RoundBtn label="SMS" icon="email" color={C.sms} onPress={() => { onSent?.('sms'); Linking.openURL(`sms:${p}?body=${encodeURIComponent(message)}`); }} /> : null}
      <RoundBtn label="WhatsApp" icon="whatsapp" color={C.whatsapp} filled onPress={() => { onSent?.('whatsapp'); Linking.openURL(`https://wa.me/91${p}?text=${encodeURIComponent(message)}`); }} />
    </View>
  );
}

export function Btn({ title, onPress, kind = 'primary', busy, disabled, icon }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'success' | 'export'; busy?: boolean; disabled?: boolean; icon?: string;
}) {
  const bg = { primary: C.primary, ghost: '#fff', danger: C.bad, success: '#28A745', export: TONES.green.bg }[kind];
  const fg = kind === 'ghost' ? C.primary : kind === 'export' ? TONES.green.title : '#fff';
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={busy || disabled}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: pressed || disabled ? 0.7 : 1 },
        kind === 'ghost' && { borderWidth: 1, borderColor: C.line },
        kind === 'export' && { borderWidth: 2, borderColor: TONES.green.border, paddingVertical: 16 }]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg, fontSize: kind === 'export' ? 18 : 15 }]}>{icon ? `${icon}  ` : ''}{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, unit, warn, ...props }: TextInputProps & { label: string; unit?: string; warn?: string | null }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}{unit ? <Text style={s.unit}>  {unit}</Text> : null}</Text>
      <TextInput placeholderTextColor="#98A2AE" {...props}
        style={[s.input, warn ? { borderColor: C.warn, backgroundColor: C.warnBg } : null, props.editable === false && { backgroundColor: C.tile }]} />
      {warn ? <Text style={s.warn}>{warn}</Text> : null}
    </View>
  );
}

export function Chip({ text, tone = 'info', big }: { text: string; tone?: 'good' | 'warn' | 'bad' | 'info'; big?: boolean }) {
  const map = { good: [C.goodBg, '#1B6B33'], warn: [C.warnBg, C.warn], bad: [C.badBg, C.bad], info: [C.infoBg, C.primary] };
  const [bg, fg] = map[tone];
  return (
    <View style={[s.chip, { backgroundColor: bg, borderRadius: big ? 8 : 999, paddingHorizontal: big ? 12 : 10, paddingVertical: big ? 5 : 3 }]}>
      <Text style={{ color: fg, fontSize: big ? 15 : 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function Choice<T extends string>({ value, options, onChange }: { value: T | null; options: T[]; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
      {options.map(o => (
        <Pressable key={o} onPress={() => onChange(o)}
          style={[s.choice, value === o && { backgroundColor: C.primary, borderColor: C.primary }]}>
          <Text style={{ color: value === o ? '#fff' : C.ink, fontSize: 14 }}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

export const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 18, marginBottom: 14 },
  h: { fontSize: 18, fontWeight: '800', color: C.primary, marginBottom: 10 },
  muted: { fontSize: 14, color: C.quiet, lineHeight: 20 },
  btn: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', marginVertical: 5 },
  btnText: { fontWeight: '700' },
  label: { fontSize: 14, color: C.ink, fontWeight: '700', marginBottom: 5 },
  unit: { fontWeight: '400', color: C.quiet },
  input: { borderWidth: 1, borderColor: '#CCD4DE', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: C.ink, backgroundColor: '#fff' },
  warn: { color: C.warn, fontSize: 12, marginTop: 3 },
  chip: { alignSelf: 'flex-start' },
  choice: { borderWidth: 1, borderColor: '#CCD4DE', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  person: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
});
