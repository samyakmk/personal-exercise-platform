import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CloudUpload } from 'lucide-react-native';
import { color } from '../theme';
import { Button, Copy } from '../components/ui';
import type { SelectedVideo } from '../types';

export function VideoPicker({ onSelect, disabled }: { onSelect: (file: SelectedVideo) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  function select(file: File) {
    const uri = URL.createObjectURL(file);
    onSelect({
      name: file.name, mime: file.type, size: file.size, uri,
      read: async () => file,
      dispose: () => URL.revokeObjectURL(uri),
    });
  }

  return (
    <div
      onDragOver={(event) => { event.preventDefault(); }}
      onDrop={(event) => {
        event.preventDefault();
        if (!disabled && event.dataTransfer.files[0]) select(event.dataTransfer.files[0]);
      }}
    >
      <View style={styles.zone}>
        <View style={styles.icon}><CloudUpload color={color.green} size={24} /></View>
        <Copy weight="semibold">Drop a video here</Copy>
        <Copy size={12} tone={color.muted}>MP4 or WebM up to 50 MB</Copy>
        <Button onPress={() => input.current?.click()} disabled={disabled} compact style={{ alignSelf: 'center', marginTop: 3 }}>Choose video</Button>
        <input
          ref={input} hidden type="file" aria-label="Video file" accept="video/mp4,video/webm,.mp4,.webm" disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) select(file);
            event.target.value = '';
          }}
        />
      </View>
    </div>
  );
}

const styles = StyleSheet.create({
  zone: { padding: 20, borderWidth: 1, borderColor: '#b7c8ad', borderStyle: 'dashed', backgroundColor: '#f9fbf5', borderRadius: 12, alignItems: 'center', gap: 5 },
  icon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', backgroundColor: color.limeSoft, borderRadius: 11, marginBottom: 3 },
});
