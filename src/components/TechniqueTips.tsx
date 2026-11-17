import { StyleSheet, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { color } from '../theme';
import type { Exercise } from '../types';
import { Copy, SectionTitle } from './ui';

export function TechniqueTips({ exercise, sideBySide = false }: { exercise: Exercise; sideBySide?: boolean }) {
  if (!exercise.technique) return null;
  return <View style={styles.section}>
    <SectionTitle title="Do and avoid" level={3} />
    <View style={[styles.tips, sideBySide && styles.columns]}>
      <Tip label="Do" text={exercise.technique.do} sideBySide={sideBySide} />
      <Tip label="Avoid" text={exercise.technique.avoid} sideBySide={sideBySide} />
    </View>
  </View>;
}

function Tip({ label, text, sideBySide }: { label: 'Do' | 'Avoid'; text: string; sideBySide: boolean }) {
  const avoid = label === 'Avoid';
  const Icon = avoid ? X : Check;
  const tone = avoid ? color.danger : color.forest;
  return <View style={[styles.tip, sideBySide && styles.column]}>
    <View aria-hidden style={[styles.badge, { backgroundColor: avoid ? color.dangerSoft : color.tint }]}>
      <Icon size={16} color={tone} />
    </View>
    <View style={styles.copy}>
      <Copy size={13} weight="bold" tone={tone}>{label}</Copy>
      <Copy size={13}>{text}</Copy>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  tips: { gap: 8 },
  columns: { flexDirection: 'row', gap: 12 },
  column: { flex: 1, minWidth: 0 },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 11, borderRadius: 10,
    borderWidth: 1, borderColor: color.line },
  badge: { width: 25, height: 25, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  copy: { gap: 2, flex: 1, minWidth: 0, paddingTop: 2 },
});
