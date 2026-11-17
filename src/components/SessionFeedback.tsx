import { StyleSheet, View } from 'react-native';
import { SelectField } from '../platform/fields';
import { color } from '../theme';
import type { WorkoutSource } from '../types';
import { Copy } from './ui';

const effortOptions = [
  { value: '', label: 'No rating' },
  ...Array.from({ length: 10 }, (_, index) => {
    const score = index + 1;
    return { value: String(score), label: score === 1 ? '1 · Very easy' : score === 10 ? '10 · Maximal' : String(score) };
  }),
];
const sourceOptions = [
  { value: 'manual', label: 'On my own' },
  { value: 'trainer', label: 'With my trainer' },
  { value: 'recommended', label: 'Suggested by Trainer Plus' },
];

export function EffortField({ value, onChange, disabled }: {
  value?: number | null; onChange: (effort: number | null) => void; disabled?: boolean;
}) {
  return <View style={styles.field}>
    <SelectField label="Perceived effort (optional)" value={value?.toString() ?? ''}
      onChange={(selected) => onChange(selected ? Number(selected) : null)} options={effortOptions} disabled={disabled} />
    <Copy size={11} tone={color.muted}>Rate the whole session. 1 is very easy; 10 is maximal effort.</Copy>
  </View>;
}

export function SourceField({ value, onChange, disabled }: {
  value?: WorkoutSource; onChange: (source: WorkoutSource) => void; disabled?: boolean;
}) {
  return <View style={styles.field}>
    <SelectField label="Who planned this session?" value={value ?? 'manual'} onChange={(selected) => onChange(selected as WorkoutSource)}
      options={sourceOptions.filter(({ value: option }) => option !== 'recommended' || value === 'recommended')} disabled={disabled} />
  </View>;
}

export const sessionSourceLabel = (source?: WorkoutSource) =>
  source === 'trainer' ? 'Trainer session' : source === 'recommended' ? 'Trainer Plus suggestion' : '';

const styles = StyleSheet.create({ field: { gap: 4, minWidth: 165 } });
