import { useEffect, useState } from 'react';
import { Image, Text, useWindowDimensions, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Photo, signedUrls } from '../../lib/photos';
import { fmt } from '../../lib/dates';
import { C, Muted, Screen } from '../../components/ui';

type Row = Photo & { visit: { visit_type: string; ess_score: number | null } | null };

// Two lesion photos side by side (or one above the other on a narrow phone), with dates and ESS.
export default function Compare() {
  const { a, b } = useLocalSearchParams<{ a: string; b: string }>();
  const { width } = useWindowDimensions();
  const [rows, setRows] = useState<Row[]>([]);
  const [urls, setUrls] = useState<Record<string, string | null>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('photos').select('*, visit:visits(visit_type, ess_score)').in('id', [a, b]);
      const list = ((data ?? []) as Row[]).sort((x, y) => x.taken_at.localeCompare(y.taken_at)).slice(0, 2);
      setRows(list); setUrls(await signedUrls(list.map(r => r.storage_path)));
    })();
  }, [a, b]);

  const wide = width >= 600;
  const w = wide ? (Math.min(width, 720) - 48) / 2 : Math.min(width, 720) - 32;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Compare photos' }} />
      {rows.length < 2 ? <Muted>Loading…</Muted> : (
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 16 }}>
          {rows.map((r, i) => (
            <View key={r.id} style={{ width: w }}>
              <Text style={{ color: C.primary, fontWeight: '800', fontSize: 16 }}>{i === 0 ? 'Before' : 'After'} · {fmt(r.taken_at.slice(0, 10))}</Text>
              <Muted>{r.body_site ?? 'Lesion'}{r.visit ? ` · ${r.visit.visit_type}` : ''}{r.visit?.ess_score != null ? ` · ESS ${r.visit.ess_score}` : ''}</Muted>
              {urls[r.storage_path]
                ? <Image source={{ uri: urls[r.storage_path]! }} style={{ width: w, height: r.width && r.height ? w * r.height / r.width : w, borderRadius: 12, marginTop: 6, backgroundColor: C.tile }} resizeMode="contain" />
                : <Muted>Loading image…</Muted>}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
