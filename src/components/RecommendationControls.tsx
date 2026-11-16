import { ArrowDown, ArrowUp, Minus, Plus, Sparkles } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { color } from '../theme';
import type { Refinement } from '../types';
import { Button, Copy, Panel } from './ui';

export function RecommendationPanel({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return <Panel style={styles.panel}>
    <View style={styles.header}>
      <View style={styles.icon}><Sparkles size={19} color={color.plum} aria-hidden /></View>
      <View style={styles.intro}>
        <Copy accessibilityRole="header" aria-level={2} weight="bold" size={18}>{title}</Copy>
        <Copy size={13} tone={color.muted}>{detail}</Copy>
      </View>
    </View>
    {children}
  </Panel>;
}

export function RefinementControls({ onRefine, disabled, exerciseList = false }: {
  onRefine: (choice: Refinement) => void; disabled?: boolean; exerciseList?: boolean;
}) {
  return <View style={styles.options}>
    <Copy size={12} weight="semibold">Want to adjust it?</Copy>
    <View role="group" accessibilityLabel="Refine recommendation" style={styles.actions}>
      <Button compact icon={ArrowDown} disabled={disabled} onPress={() => onRefine('easier')}>Make it easier</Button>
      <Button compact icon={ArrowUp} disabled={disabled} onPress={() => onRefine('harder')}>Make it harder</Button>
      <Button compact icon={Minus} disabled={disabled} onPress={() => onRefine('shorter')}>{exerciseList ? 'Fewer picks' : 'Make it shorter'}</Button>
      <Button compact icon={Plus} disabled={disabled} onPress={() => onRefine('longer')}>{exerciseList ? 'More picks' : 'Make it longer'}</Button>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: color.tint, borderColor: color.control, gap: 12, padding: 15 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { backgroundColor: color.surface, borderRadius: 9, padding: 9 },
  intro: { flex: 1, gap: 2 },
  options: { gap: 6 },
  actions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
});
