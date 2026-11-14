import { View } from 'react-native';
import { SelectField } from '../platform/fields';
import type { DumbbellLoad } from '../types';
import { Input } from './ui';

export type WeightDraft = { load: string; unit: DumbbellLoad['unit'] };

export function validWeight(value: string) {
  return /^\d+(?:[.,]\d{1,2})?$/.test(value) && Number(value.replace(',', '.')) > 0
    && Number(value.replace(',', '.')) <= 1000;
}

export function WeightFields({ label, set, onChange }: { label: string; set: WeightDraft; onChange: (fields: Partial<WeightDraft>) => void }) {
  return <>
    <Input label={`Weight per dumbbell · ${label}`} visibleLabel="Weight per dumbbell"
      value={set.load} onChangeText={(load) => onChange({ load })} placeholder="Optional" keyboardType="decimal-pad" maxLength={7} />
    <View style={{ minWidth: 64 }}>
      <SelectField label={`Unit · ${label}`} visibleLabel="Unit" value={set.unit}
        onChange={(unit) => onChange({ unit: unit === 'kg' ? 'kg' : 'lb' })}
        options={[{ value: 'lb', label: 'lb' }, { value: 'kg', label: 'kg' }]} />
    </View>
  </>;
}
