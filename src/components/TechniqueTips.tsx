import { StyleSheet, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { color } from '../theme';
import type { Exercise } from '../types';
import { Copy, SectionTitle } from './ui';

export function TechniqueTips({ exercise }: { exercise: Exercise }) {
  if (!exercise.technique) return null;
  return <View style={styles.box}>
    <SectionTitle title="Do and avoid" level={3} />
    <View style={styles.row}>
      <Check aria-hidden size={17} color={color.plum} />
      <View style={styles.copy}><Copy size={12} weight="bold">Do</Copy><Copy size={13}>{exercise.technique.do}</Copy></View>
    </View>
    <View style={styles.row}>
      <X aria-hidden size={17} color={color.plum} />
      <View style={styles.copy}><Copy size={12} weight="bold">Avoid</Copy><Copy size={13}>{exercise.technique.avoid}</Copy></View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  box: { gap: 8, backgroundColor: color.tint, borderRadius: 8, padding: 11 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  copy: { gap: 2, flex: 1 },
});
