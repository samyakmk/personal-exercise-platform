import * as DocumentPicker from 'expo-document-picker';
import { Upload } from 'lucide-react-native';
import { Button } from '../components/ui';

export type BackupFile = { name: string; size: number; read: () => Promise<string> };
export type BackupPickerProps = { onSelect: (file: BackupFile) => void; onError: (message: string) => void; disabled?: boolean };

export function BackupPicker({ onSelect, onError, disabled }: BackupPickerProps) {
  async function choose() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (result.canceled) return;
      const file = result.assets[0];
      onSelect({ name: file.name, size: file.size ?? 0, read: async () => (await fetch(file.uri)).text() });
    } catch {
      onError('The backup file could not be opened.');
    }
  }
  return <Button icon={Upload} disabled={disabled} onPress={() => void choose()}>Choose backup file</Button>;
}
