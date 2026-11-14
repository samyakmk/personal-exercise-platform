import { useRef } from 'react';
import { Upload } from 'lucide-react-native';
import { Button } from '../components/ui';
import type { BackupPickerProps } from './BackupPicker';

export function BackupPicker({ onSelect, disabled }: BackupPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <Button icon={Upload} disabled={disabled} onPress={() => input.current?.click()}>Choose backup file</Button>
    <input ref={input} type="file" hidden accept=".json,application/json" aria-label="Training backup file" disabled={disabled}
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onSelect({ name: file.name, size: file.size, read: () => file.text() });
        event.target.value = '';
      }} />
  </>;
}
