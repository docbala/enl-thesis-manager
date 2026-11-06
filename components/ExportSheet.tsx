import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Switch, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { notify } from '../lib/dialog';
import { exportExcel, exportPdf } from '../lib/report';
import { exportAnalysisBundle } from '../lib/analysisExport';
import { C, TONES } from './ui';

type Kind = 'pdf' | 'xlsx' | 'spss';
const OPTIONS: { key: Kind; icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string; title: string; sub: string }[] = [
  { key: 'pdf', icon: 'file-pdf-box', color: '#C53030', title: 'PDF report', sub: 'Title page with college, guide and thesis title; summary table; every patient with all follow-ups and key labs' },
  { key: 'xlsx', icon: 'microsoft-excel', color: '#1F7A4D', title: 'Excel workbook', sub: 'Same heading; sheets for patients, visits and labs, ENL episodes and steroid doses' },
  { key: 'spss', icon: 'chart-box-outline', color: '#2a78d6', title: 'SPSS / R analysis bundle', sub: 'Coded, labelled data with ready-to-run syntax (always de-identified)' },
];

// One Export button on the dashboard opens this sheet.
export function ExportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [identified, setIdentified] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);

  async function run(k: Kind) {
    setBusy(k);
    try {
      const name = k === 'pdf' ? await exportPdf(identified) : k === 'xlsx' ? await exportExcel(identified) : await exportAnalysisBundle();
      onClose();
      notify('Export ready', k === 'pdf' ? `${name}\n\nOn a computer, choose "Save as PDF" in the print window.` : name);
    } catch (e: any) { notify('Export failed', e.message); }
    setBusy(null);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.45)' }} />
      <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, alignSelf: 'center', marginBottom: 12 }} />
        <Text style={{ fontSize: 19, fontWeight: '800', color: C.primary, marginBottom: 10 }}>Export</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, marginBottom: 12,
          backgroundColor: identified ? TONES.pink.bg : C.tile, borderWidth: 1, borderColor: identified ? TONES.pink.border : C.line }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: identified ? TONES.pink.title : C.ink, fontWeight: '800' }}>Include names, UHID, phone and address</Text>
            <Text style={{ color: C.quiet, fontSize: 12, marginTop: 2 }}>{identified ? 'The PDF and Excel will be marked CONFIDENTIAL. Keep them private.' : 'Off: patients appear by study number only.'}</Text>
          </View>
          <Switch value={identified} onValueChange={setIdentified} />
        </View>
        {OPTIONS.map(o => (
          <Pressable key={o.key} disabled={!!busy} onPress={() => run(o.key)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.line,
              marginBottom: 8, backgroundColor: pressed ? '#F2F6FA' : '#fff', opacity: busy && busy !== o.key ? 0.5 : 1 })}>
            <MaterialCommunityIcons name={o.icon} size={32} color={o.color} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.ink, fontWeight: '800', fontSize: 15 }}>{o.title}</Text>
              <Text style={{ color: C.quiet, fontSize: 12, marginTop: 2 }}>{o.sub}</Text>
            </View>
            {busy === o.key ? <ActivityIndicator /> : <MaterialCommunityIcons name="chevron-right" size={22} color={C.quiet} />}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}
