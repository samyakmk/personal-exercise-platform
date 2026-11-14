import { View } from 'react-native';
import { Chip, Copy, Input } from '../components/ui';
import type { DateTimeProps, SelectProps } from './fieldTypes';

export function SelectField({ label, visibleLabel = label, options, value, onChange, disabled }: SelectProps) {
  return <View style={{ gap: 7 }}>
    <Copy size={12} weight="semibold">{visibleLabel}</Copy>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((option) => <Chip key={option.value} label={option.label} selected={value === option.value} onPress={() => { if (!disabled) onChange(option.value); }} />)}
    </View>
  </View>;
}

export function DateTimeField({ label, value, onChange, kind, disabled }: DateTimeProps) {
  return <Input label={label} value={value} onChangeText={onChange} editable={!disabled} placeholder={kind === 'date' ? 'YYYY-MM-DD' : 'HH:MM'} />;
}
