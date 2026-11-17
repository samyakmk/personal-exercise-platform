import * as DocumentPicker from 'expo-document-picker';
import { CloudUpload } from 'lucide-react-native';
import { Button } from '../components/ui';
import type { SelectedVideo } from '../types';

export type VideoPickerProps = {
  onSelect: (file: SelectedVideo) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
};

export function VideoPicker({ onSelect, disabled, compact, label = 'Choose video' }: VideoPickerProps) {
  async function choose() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['video/mp4', 'video/webm', 'video/quicktime'] });
    if (result.canceled) return;
    const item = result.assets[0];
    onSelect({
      name: item.name, mime: item.mimeType ?? '', size: item.size ?? 0, uri: item.uri,
      read: async () => (await fetch(item.uri)).blob(),
      dispose: () => {},
    });
  }
  return <Button kind={compact ? 'outline' : 'primary'} onPress={choose} icon={CloudUpload} disabled={disabled}>{label}</Button>;
}
