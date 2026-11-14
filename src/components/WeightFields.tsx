import { View } from 'react-native';
import { SelectField } from '../platform/fields';
import type { ExerciseLoad } from '../types';
import { Input } from './ui';

export type WeightDraft = { load: string; unit: ExerciseLoad['unit'] };

export function validWeight(value: string) {
  return /^\d+(?:[.,]\d{1,2})?$/.test(value) && Number(value.replace(',', '.')) > 0
    && Number(value.replace(',', '.')) <= 1000;
}

export function WeightFields({ label, perDumbbell, set, onChange }: { label: string; perDumbbell: boolean; set: WeightDraft; onChange: (fields: Partial<WeightDraft>) => void }) {
  const title = perDumbbell ? 'Weight per dumbbell' : 'Weight';
  return <>
    <Input label={`${title} · ${label}`} visibleLabel={title}
      value={set.load} onChangeText={(load) => onChange({ load })} placeholder="Optional" keyboardType="decimal-pad" maxLength={7} />
    <View style={{ minWidth: 64 }}>
      <SelectField label={`Unit · ${label}`} visibleLabel="Unit" value={set.unit}
        onChange={(unit) => onChange({ unit: unit === 'kg' ? 'kg' : 'lb' })}
        options={[{ value: 'lb', label: 'lb' }, { value: 'kg', label: 'kg' }]} />
    </View>
  </>;
}
