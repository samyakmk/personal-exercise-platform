import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { ArrowUpRight, Bookmark, Video } from 'lucide-react-native';
import { exercisePhotos } from '../assets';
import { color, radius } from '../theme';
import type { Exercise } from '../types';
import { Copy, Display, Label, VisuallyHidden } from './ui';

export function ExerciseCard({ exercise, saved, onPress }: { exercise: Exercise; saved?: boolean; onPress: () => void }) {
  const equipment = exercise.equipment.join(' + ') || 'Bodyweight';
  const [previewFailed, setPreviewFailed] = useState(false);
  const thumbnail = exercise.demonstration?.thumbnailUrl;
  const photo = exercisePhotos[exercise.id] ?? (!previewFailed && thumbnail ? { uri: thumbnail } : undefined);
  return <Pressable accessibilityRole="button" onPress={onPress}
    style={({ hovered, pressed }) => [
      styles.card, (hovered || pressed) && { borderColor: color.forest, backgroundColor: color.soft },
    ]}>
    {photo && <View style={styles.picture}>
      <Image aria-hidden source={photo} resizeMode="cover"
        onError={() => setPreviewFailed(true)}
        style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} />
      {saved && <View aria-hidden style={styles.saved}><Bookmark size={14} color={color.ink} fill={color.ink} /></View>}
    </View>}
    <View style={styles.body}>
      <View style={styles.title}>
        <Display size={23} style={{ flex: 1, letterSpacing: -0.45 }}>{exercise.name}</Display>
        {!photo && saved && <Bookmark aria-hidden size={14} color={color.forest} fill={color.forest} />}
        <ArrowUpRight aria-hidden size={17} color={color.forest} />
      </View>
      <Copy size={12} tone={color.muted}>{exercise.muscles[0]} · {equipment}</Copy>
      <View style={styles.tags}>
        <Label size={10} tone={color.muted}>{exercise.category} · {exercise.level}</Label>
        {exercise.demonstration && <View style={styles.video}>
          <Video aria-hidden size={13} color={color.forest} />
          <Copy size={12} tone={color.forest}>Video</Copy>
        </View>}
      </View>
      {saved && <VisuallyHidden>Saved exercise</VisuallyHidden>}
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { flex: 1, borderColor: color.line, borderWidth: 1, borderRadius: radius.panel, overflow: 'hidden', backgroundColor: color.surface },
  picture: { aspectRatio: 1.98, overflow: 'hidden', backgroundColor: color.ink },
  saved: { position: 'absolute', top: 9, right: 9, width: 29, height: 29, borderRadius: radius.control,
    backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 14, gap: 6 },
  tags: { borderTopWidth: 1, borderColor: color.line, marginTop: 3, paddingTop: 7, alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 5 },
  video: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { flexDirection: 'row', justifyContent: 'space-between', gap: 5, alignItems: 'flex-start' },
});
