import { useState } from 'react';
import { Linking, Modal, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { C } from './ui';

type Channel = 'whatsapp' | 'sms' | 'call';
const OPTIONS: { key: Channel; label: string; sub: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp', sub: 'Hindi reminder message ready to send', icon: 'whatsapp', color: '#25D366' },
  { key: 'sms', label: 'SMS', sub: 'Same message as a text', icon: 'message-text', color: '#2a78d6' },
  { key: 'call', label: 'Call', sub: 'Phone the patient', icon: 'phone', color: '#1F7A4D' },
];

// One small "Remind" button per patient. Tapping it offers WhatsApp, SMS or Call.
export function RemindButton({ phone, name, message, sent, onSent }: {
  phone: string | null; name: string; message: string; sent?: string | null; onSent?: (c: Channel) => void;
}) {
  const [open, setOpen] = useState(false);
  const p = (phone ?? '').replace(/\D/g, '').slice(-10);
  if (!p) return <Text style={{ color: C.quiet, fontSize: 12 }}>No phone</Text>;

  const go = (c: Channel) => {
    setOpen(false);
    onSent?.(c);
    Linking.openURL(c === 'call' ? `tel:${p}` : c === 'sms' ? `sms:${p}?body=${encodeURIComponent(message)}` : `https://wa.me/91${p}?text=${encodeURIComponent(message)}`);
  };
  const done = !!sent;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityLabel={`Remind ${name}`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
          backgroundColor: done ? '#EAF7EF' : '#1F9D55', borderWidth: done ? 1 : 0, borderColor: '#9AD5B0', opacity: pressed ? 0.8 : 1 })}>
        <MaterialCommunityIcons name={done ? 'check' : 'bell-ring-outline'} size={17} color={done ? '#1E7B3F' : '#fff'} />
        <Text style={{ color: done ? '#1E7B3F' : '#fff', fontWeight: '800' }}>{done ? 'Sent' : 'Remind'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.45)', justifyContent: 'flex-end' }}>
          <Pressable style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, alignSelf: 'center', marginBottom: 12 }} />
            <Text style={{ fontSize: 18, fontWeight: '800', color: C.primary }}>Remind {name}</Text>
            <Text style={{ color: C.quiet, marginBottom: 10 }}>{p}{done ? ` · already reminded by ${sent} this week` : ''}</Text>
            {OPTIONS.map(o => (
              <Pressable key={o.key} onPress={() => go(o.key)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.line,
                  marginBottom: 8, backgroundColor: pressed ? '#F2F6FA' : '#fff' })}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: o.color, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name={o.icon} size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.ink, fontWeight: '800', fontSize: 15 }}>{o.label}</Text>
                  <Text style={{ color: C.quiet, fontSize: 12 }}>{o.sub}</Text>
                </View>
              </Pressable>
            ))}
            <Pressable onPress={() => setOpen(false)} style={{ padding: 10, alignItems: 'center' }}>
              <Text style={{ color: C.quiet, fontWeight: '700' }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
