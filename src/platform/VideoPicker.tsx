import * as DocumentPicker from 'expo-document-picker';
import { CloudUpload } from 'lucide-react-native';
import { Button } from '../components/ui';
import type { SelectedVideo } from '../types';

export function VideoPicker({ onSelect, disabled }: { onSelect: (file: SelectedVideo) => void; disabled?: boolean }) {
  async function choose() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['video/mp4', 'video/webm'] });
    if (result.canceled) return;
    const item = result.assets[0];
    onSelect({
      name: item.name, mime: item.mimeType ?? '', size: item.size ?? 0, uri: item.uri,
      read: async () => (await fetch(item.uri)).blob(),
      dispose: () => {},
    });
  }
  return <Button onPress={choose} icon={CloudUpload} disabled={disabled}>Choose video</Button>;
}
