import { Pressable, Text, View } from 'react-native';
import { ESS_ITEMS, EssScores, essBand, essScored, essTotal } from '../lib/ess';
import { C, TONES } from './ui';

// Item-by-item ENLIST ESS. Tap a number to score, tap it again to clear.
export function EssForm({ value, onChange, editable }: { value: EssScores; onChange: (v: EssScores) => void; editable: boolean }) {
  const total = essTotal(value), scored = essScored(value);
  const severe = total >= 9;
  return (
    <View>
      {ESS_ITEMS.map(item => (
        <View key={item.key} style={{ paddingVertical: 8, borderTopWidth: item.no === 1 ? 0 : 1, borderTopColor: C.line }}>
          <Text style={{ color: C.ink, fontWeight: '700' }}>{item.no}. {item.label}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            {[0, 1, 2, 3].map(n => {
              const on = value[item.key] === n;
              return (
                <Pressable key={n} disabled={!editable} accessibilityLabel={`${item.label} ${n}`}
                  onPress={() => onChange({ ...value, [item.key]: on ? null : n })}
                  style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
                    backgroundColor: on ? C.primary : '#fff', borderWidth: 1, borderColor: on ? C.primary : '#CCD4DE' }}>
                  <Text style={{ color: on ? '#fff' : C.ink, fontWeight: '800', fontSize: 16 }}>{n}</Text>
                </Pressable>
              );
            })}
          </View>
          {item.descriptors
            ? <Text style={{ color: C.quiet, fontSize: 12, marginTop: 4 }}>{item.descriptors.map((d, i) => `${i} ${d}`).join(' · ')}</Text>
            : <Text style={{ color: C.quiet, fontSize: 12, marginTop: 4 }}>0–3 as on the official ENLIST ESS sheet</Text>}
        </View>
      ))}
      <View style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: severe ? TONES.pink.bg : TONES.green.bg,
        borderWidth: 1, borderColor: severe ? TONES.pink.border : TONES.green.border }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: severe ? TONES.pink.title : TONES.green.title }}>ESS {total} / 30</Text>
        <Text style={{ color: C.ink, fontWeight: '700' }}>{essBand(total)}</Text>
        <Text style={{ color: scored === 10 ? C.quiet : C.warn }}>{scored} of 10 items scored{scored < 10 ? ' — unscored items count as 0' : ''}</Text>
      </View>
    </View>
  );
}
