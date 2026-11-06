import { useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { C } from './ui';
import { PatientPicker } from './PatientPicker';

type Action = { key: 'enrol' | 'visit' | 'enl'; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string };
const ACTIONS: Action[] = [
  { key: 'enl', label: 'Log ENL reaction', icon: 'fire', color: '#C2410C' },
  { key: 'visit', label: 'Log patient visit', icon: 'calendar-check', color: '#0F8FA3' },
  { key: 'enrol', label: 'Enrol new patient', icon: 'account-plus', color: '#1F7A4D' },
];
const native = Platform.OS !== 'web';

// Round + button (bottom right). Opens three quick actions with a small spring animation.
export function Fab() {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<null | 'visit' | 'enl'>(null);
  const a = useRef(new Animated.Value(0)).current;

  const toggle = (to = !open) => {
    setOpen(to);
    Animated.spring(a, { toValue: to ? 1 : 0, useNativeDriver: native, friction: 7, tension: 80 }).start();
  };
  const choose = (k: Action['key']) => {
    toggle(false);
    if (k === 'enrol') router.push('/patient/new'); else setPick(k);
  };

  const rotate = a.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '135deg'] });
  return (
    <>
      {open ? <Pressable onPress={() => toggle(false)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(16,24,40,0.35)' }} /> : null}
      <View pointerEvents="box-none" style={{ position: 'absolute', right: 20, bottom: 24, alignItems: 'flex-end' }}>
        {ACTIONS.map((x, i) => {
          const y = a.interpolate({ inputRange: [0, 1], outputRange: [20 * (ACTIONS.length - i), 0] });
          const op = a.interpolate({ inputRange: [0, 0.4 + 0.15 * (ACTIONS.length - 1 - i), 1], outputRange: [0, 0, 1], extrapolate: 'clamp' });
          return (
            <Animated.View key={x.key} pointerEvents={open ? 'auto' : 'none'} style={{ opacity: op, transform: [{ translateY: y }], marginBottom: 14 }}>
              <Pressable onPress={() => choose(x.key)} accessibilityLabel={x.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}>
                  <Text style={{ color: C.ink, fontWeight: '800' }}>{x.label}</Text>
                </View>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: x.color, alignItems: 'center', justifyContent: 'center', marginRight: 4,
                  shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}>
                  <MaterialCommunityIcons name={x.icon} size={24} color="#fff" />
                </View>
              </Pressable>
            </Animated.View>
          );
        })}
        <Pressable onPress={() => toggle()} accessibilityLabel={open ? 'Close menu' : 'Add'}
          style={({ pressed }) => ({ width: 60, height: 60, borderRadius: 30, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
            transform: [{ scale: pressed ? 0.94 : 1 }], shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 })}>
          <Animated.View style={{ transform: [{ rotate }] }}>
            <MaterialCommunityIcons name="plus" size={32} color="#fff" />
          </Animated.View>
        </Pressable>
      </View>
      <PatientPicker visible={!!pick} title={pick === 'enl' ? 'Log ENL reaction for…' : 'Log visit for…'} onClose={() => setPick(null)}
        onPick={p => { const k = pick; setPick(null); router.push(`/visit/new?patient=${p.id}${k === 'enl' ? '&enl=1' : ''}`); }} />
    </>
  );
}
