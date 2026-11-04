import { Pressable, Text, View } from 'react-native';
import type { Slot } from '../lib/types';
import { C } from './ui';
import { fmt } from '../lib/dates';

const STYLE: Record<Slot['status'], { bg: string; fg: string; label: string }> = {
  completed: { bg: C.good, fg: '#fff', label: 'done' },
  missed: { bg: C.bad, fg: '#fff', label: 'missed' },
  open: { bg: C.primary, fg: '#fff', label: 'open now' },
  upcoming: { bg: '#E6E9EE', fg: C.quiet, label: 'upcoming' },
  baseline_pending: { bg: C.warn, fg: '#fff', label: 'no baseline' },
};

// Months 0-12 of the study. Months before enrolment are hatched (not part of this patient's follow-up).
export function SlotStrip({ slots, onPressSlot }: { slots: Slot[]; onPressSlot?: (s: Slot) => void }) {
  const byMonth = new Map(slots.map(s => [s.slot_month, s]));
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: 13 }, (_, m) => {
          const sl = byMonth.get(m);
          const st = sl ? STYLE[sl.status] : null;
          return (
            <Pressable key={m} disabled={!sl} onPress={() => sl && onPressSlot?.(sl)}
              style={{ flex: 1, height: 34, borderRadius: 5, alignItems: 'center', justifyContent: 'center',
                backgroundColor: st ? st.bg : '#F0F2F5', borderWidth: st ? 0 : 1, borderColor: C.line, borderStyle: st ? 'solid' : 'dashed' }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: st ? st.fg : '#B0B8C2' }}>{m === 0 ? 'B' : m}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
        {(['completed', 'missed', 'open', 'upcoming'] as const).map(k => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: STYLE[k].bg }} />
            <Text style={{ fontSize: 11, color: C.quiet }}>{STYLE[k].label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function slotSummary(s: Slot) {
  const name = s.is_baseline ? `Baseline (month ${s.slot_month})` : `Month ${s.slot_month}`;
  const when = s.visit_date ? `seen ${fmt(s.visit_date)}` : `due ${fmt(s.due_date)} (window ${fmt(s.opens_on)} to ${fmt(s.closes_on)})`;
  return `${name}: ${STYLE[s.status].label}, ${when}`;
}
