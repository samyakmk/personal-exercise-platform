import { useId } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { color, font, radius } from '../theme';
import type { DateTimeProps, SelectProps } from './fieldTypes';

const fieldStyle = {
  minHeight: 43, width: '100%', minWidth: 0, padding: '0 10px', borderRadius: radius.control,
  border: `1px solid ${color.control}`, background: color.surface, color: color.text,
  fontFamily: font.regular, fontSize: 14, boxSizing: 'border-box',
} as const;

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} style={{ fontFamily: font.semibold, fontSize: 12, color: color.text }}>{children}</label>;
}

export function SelectField({ label, visibleLabel = label, options, value, onChange, placeholder, disabled }: SelectProps) {
  const id = useId();
  return <View style={{ gap: 7 }}>
    <FieldLabel htmlFor={id}>{visibleLabel}</FieldLabel>
    <select id={id} aria-label={visibleLabel !== label ? label : undefined}
      value={value} onChange={(event) => onChange(event.target.value)} style={fieldStyle} disabled={disabled}>
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </View>;
}

export function DateTimeField({ label, value, onChange, kind, min, max, disabled }: DateTimeProps) {
  const id = useId();
  return <View style={{ gap: 7, flex: 1, minWidth: 0 }}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <input id={id} type={kind} value={value} min={min} max={max} disabled={disabled}
      onChange={(event) => onChange(event.target.value)} style={fieldStyle} />
  </View>;
}
