import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Upload } from 'lucide-react-native';
import { color, radius } from '../theme';
import { Button, Copy } from '../components/ui';
import type { VideoPickerProps } from './VideoPicker';
import { videoMime } from './videoTypes';

export function VideoPicker({ onSelect, disabled, compact, label = 'Choose video' }: VideoPickerProps) {
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

  const picker = <>
    <Button kind={compact ? 'outline' : 'primary'} icon={Upload} onPress={() => input.current?.click()}
      disabled={disabled} style={compact ? undefined : styles.choose}>{label}</Button>
    <input
      ref={input} hidden type="file" aria-label="Video file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" disabled={disabled}
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) select(file);
        event.target.value = '';
      }}
    />
  </>;

  if (compact) return picker;

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
        {picker}
        <Copy size={13} weight="semibold" accessibilityLiveRegion="polite">{dragging ? 'Release to select video' : 'Or drop a video here'}</Copy>
        <Copy size={12} tone={color.muted}>MP4, WebM, or MOV up to 50 MB</Copy>
      </View>
    </div>
  );
}

const styles = StyleSheet.create({
  zone: { padding: 17, borderWidth: 1, borderColor: color.control, borderStyle: 'dashed', backgroundColor: color.canvas, borderRadius: radius.panel, alignItems: 'center', gap: 6 },
  dragging: { borderColor: color.forest, backgroundColor: color.tint },
  choose: { alignSelf: 'center', marginBottom: 3 },
});
