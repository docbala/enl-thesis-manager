import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { supabase, tbl } from '../lib/supabase';
import type { Patient } from '../lib/types';
import { C } from './ui';
import { Avatar, useAvatars } from './Avatar';

// Bottom sheet to choose a patient quickly (search by study number, name, UHID or phone).
export function PatientPicker({ visible, title, onPick, onClose }: { visible: boolean; title: string; onPick: (p: Patient) => void; onClose: () => void }) {
  const [list, setList] = useState<Patient[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!visible) return;
    setQ('');
    supabase.from(tbl('patients')).select('*').is('deleted_at', null).order('cr_no').then(({ data }) => setList((data ?? []) as Patient[]));
  }, [visible]);
  const avatars = useAvatars(visible ? list.map(p => p.id) : []);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const digits = s.replace(/\D/g, '');
    return list.filter(p => (p.patient_status ?? 'Active') === 'Active').filter(p => !s || p.cr_no.toLowerCase().includes(s) || p.patient_name.toLowerCase().includes(s)
      || (p.uhid ?? '').toLowerCase().includes(s) || (digits.length >= 4 && String(p.contact_no ?? '').includes(digits)));
  }, [list, q]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.45)' }} />
      <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '80%', width: '100%', maxWidth: 720, alignSelf: 'center' }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, alignSelf: 'center', marginBottom: 10 }} />
        <Text style={{ fontSize: 18, fontWeight: '800', color: C.primary, marginBottom: 8 }}>{title}</Text>
        <TextInput value={q} onChangeText={setQ} autoFocus placeholder="Search study no., name, UHID or phone" placeholderTextColor="#98A2AE"
          style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 15, color: C.ink, marginBottom: 8 }} />
        <FlatList data={shown} keyExtractor={p => p.id} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={{ color: C.quiet, padding: 12 }}>{list.length ? 'No match.' : 'Loading…'}</Text>}
          renderItem={({ item: p }) => (
            <Pressable onPress={() => onPick(p)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
              borderTopWidth: 1, borderTopColor: C.line, opacity: pressed ? 0.6 : 1 })}>
              <Avatar name={p.patient_name} url={avatars[p.id]} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontWeight: '800' }}>{p.patient_name}{p.patient_name === p.cr_no ? '' : `  (${p.cr_no})`}</Text>
                <Text style={{ color: C.quiet, fontSize: 12 }}>{[p.age && `${p.age}/${p.sex?.[0] ?? '?'}`, p.leprosy_spectrum, p.mdt_status].filter(Boolean).join(' · ')}</Text>
              </View>
            </Pressable>
          )} />
      </View>
    </Modal>
  );
}
