import { useRef } from 'react';
import { Upload } from 'lucide-react-native';
import { Button } from '../components/ui';
import type { BackupPickerProps } from './BackupPicker';

export function BackupPicker({ onSelect, disabled, label = 'Choose backup file', inputLabel = 'Training backup file' }: BackupPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <Button icon={Upload} disabled={disabled} onPress={() => input.current?.click()}>{label}</Button>
    <input ref={input} type="file" hidden accept=".json,application/json" aria-label={inputLabel} disabled={disabled}
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onSelect({ name: file.name, size: file.size, read: () => file.text(), body: file });
        event.target.value = '';
      }} />
  </>;
}
