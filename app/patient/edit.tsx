import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import type { Patient } from '../../lib/types';
import { PatientForm } from '../../components/PatientForm';
import { Muted } from '../../components/ui';

export default function EditPatient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [p, setP] = useState<Patient | null>(null);
  useEffect(() => { supabase.from('patients').select('*').eq('id', id).single().then(({ data }) => setP(data as Patient)); }, [id]);
  if (!p) return <View style={{ padding: 16 }}><Muted>Loading…</Muted></View>;
  return <PatientForm existing={p} />;
}
