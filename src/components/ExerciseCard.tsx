import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { ArrowUpRight, Bookmark, Video } from 'lucide-react-native';
import { exercisePhotos } from '../assets';
import { color } from '../theme';
import type { Exercise } from '../types';
import { Copy, VisuallyHidden } from './ui';

export function ExerciseCard({ exercise, saved, onPress }: { exercise: Exercise; saved?: boolean; onPress: () => void }) {
  const equipment = exercise.equipment.join(' + ') || 'Bodyweight';
  const [previewFailed, setPreviewFailed] = useState(false);
  const thumbnail = exercise.demonstration?.thumbnailUrl;
  const photo = exercisePhotos[exercise.id] ?? (!previewFailed && thumbnail ? { uri: thumbnail } : undefined);
  return <Pressable accessibilityRole="button" onPress={onPress}
    style={({ hovered, pressed }) => [
      styles.card, (hovered || pressed) && { borderColor: color.plum, backgroundColor: color.soft },
    ]}>
    {photo && <View style={styles.picture}>
      <Image aria-hidden source={photo} resizeMode="cover"
        onError={() => setPreviewFailed(true)}
        style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} />
      {saved && <View aria-hidden style={styles.saved}><Bookmark size={14} color={color.ink} fill={color.ink} /></View>}
    </View>}
    <View style={styles.body}>
      <View style={styles.title}>
        <Copy size={15} weight="bold" style={{ flex: 1, letterSpacing: -0.35 }}>{exercise.name}</Copy>
        {!photo && saved && <Bookmark aria-hidden size={14} color={color.plum} fill={color.plum} />}
        <ArrowUpRight aria-hidden size={17} color={color.plum} />
      </View>
      <Copy size={12} tone={color.muted}>{exercise.muscles[0]} · {equipment}</Copy>
      <View style={styles.tags}>
        <Copy size={12} tone={color.muted}>{exercise.category} · {exercise.level}</Copy>
        {exercise.demonstration && <View style={styles.video}>
          <Video aria-hidden size={13} color={color.plum} />
          <Copy size={12} tone={color.plum}>Video</Copy>
        </View>}
      </View>
      {saved && <VisuallyHidden>Saved exercise</VisuallyHidden>}
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { flex: 1, borderColor: color.line, borderWidth: 1, borderRadius: 11, overflow: 'hidden', backgroundColor: color.surface },
  picture: { aspectRatio: 1.98, overflow: 'hidden', backgroundColor: color.ink },
  saved: { position: 'absolute', top: 9, right: 9, width: 29, height: 29, borderRadius: 6,
    backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 12, gap: 4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 5 },
  video: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { flexDirection: 'row', justifyContent: 'space-between', gap: 5, alignItems: 'flex-start' },
});
