import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CloudUpload } from 'lucide-react-native';
import { color } from '../theme';
import { Button, Copy } from '../components/ui';
import type { SelectedVideo } from '../types';
import { videoMime } from './videoTypes';

export function VideoPicker({ onSelect, disabled }: { onSelect: (file: SelectedVideo) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  function select(file: File) {
    const mime = videoMime(file.name, file.type);
    const preview = mime && mime !== file.type ? file.slice(0, file.size, mime) : file;
    const uri = URL.createObjectURL(preview);
    onSelect({
      name: file.name, mime: file.type, size: file.size, uri,
      read: async () => file,
      dispose: () => URL.revokeObjectURL(uri),
    });
  }

  return (
    <div aria-label="Video drop area" role="group"
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled && Array.from(event.dataTransfer.types).includes('Files')) {
          event.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled && event.dataTransfer.files[0]) select(event.dataTransfer.files[0]);
      }}
    >
      <View style={[styles.zone, dragging && styles.dragging]}>
        <View style={styles.icon}><CloudUpload color={color.plum} size={24} /></View>
        <Copy weight="semibold">{dragging ? 'Release to select video' : 'Drop a video here'}</Copy>
        <Copy size={12} tone={color.muted}>MP4, WebM, or MOV up to 50 MB</Copy>
        <Button onPress={() => input.current?.click()} disabled={disabled} compact style={{ alignSelf: 'center', marginTop: 3 }}>Choose video</Button>
        <input
          ref={input} hidden type="file" aria-label="Video file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" disabled={disabled}
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
  zone: { padding: 22, borderWidth: 1, borderColor: color.control, borderStyle: 'dashed', backgroundColor: color.canvas, borderRadius: 10, alignItems: 'center', gap: 5 },
  dragging: { borderColor: color.plum, backgroundColor: color.tint },
  icon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', backgroundColor: color.tint, borderRadius: 11, marginBottom: 3 },
});
