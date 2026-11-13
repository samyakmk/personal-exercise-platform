import { useId } from 'react';
import { View } from 'react-native';
import { Copy } from '../components/ui';
import { color, font } from '../theme';
import type { DateTimeProps, SelectProps } from './fieldTypes';

const fieldStyle = {
  minHeight: 43, width: '100%', minWidth: 0, padding: '0 10px', borderRadius: 8,
  border: `1px solid ${color.line}`, background: color.white, color: color.text,
  fontFamily: font.regular, fontSize: 14, boxSizing: 'border-box',
} as const;

export function SelectField({ label, options, value, onChange, placeholder, disabled }: SelectProps) {
  const id = useId();
  return <View style={{ gap: 7 }}>
    <Copy nativeID={id} size={12} weight="semibold">{label}</Copy>
    <select aria-labelledby={id} value={value} onChange={(event) => onChange(event.target.value)} style={fieldStyle} disabled={disabled}>
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </View>;
}

export function DateTimeField({ label, value, onChange, kind }: DateTimeProps) {
  const id = useId();
  return <View style={{ gap: 7, flex: 1, minWidth: 0 }}>
    <Copy nativeID={id} size={12} weight="semibold">{label}</Copy>
    <input aria-labelledby={id} type={kind} value={value} onChange={(event) => onChange(event.target.value)} style={fieldStyle} />
  </View>;
}
