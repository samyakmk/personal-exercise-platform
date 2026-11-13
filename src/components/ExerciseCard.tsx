import { Image, Pressable, StyleSheet, View } from 'react-native';
import { ArrowUpRight, Play } from 'lucide-react-native';
import { exercisePhotos } from '../assets';
import { color } from '../theme';
import type { Exercise } from '../types';
import { Copy, Tag } from './ui';

export function ExerciseCard({ exercise, onPress }: { exercise: Exercise; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Watch ${exercise.name} demonstration`}
      onPress={onPress}
      style={({ hovered }) => [styles.card, hovered && { borderColor: '#92a67b' }]}
    >
      <View style={styles.picture}>
        <Image source={exercisePhotos[exercise.id]} resizeMode="cover" style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} />
        <View style={styles.play}><Play color={color.white} size={17} fill={color.white} /></View>
      </View>
      <View style={styles.body}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 4, alignItems: 'flex-start' }}>
          <Copy size={15} weight="bold" style={{ flex: 1, letterSpacing: -0.35 }}>{exercise.name}</Copy>
          <ArrowUpRight size={16} color={color.green} />
        </View>
        <Copy size={12} tone={color.muted}>{exercise.equipment.length ? exercise.equipment.join(' · ') : 'Bodyweight'}</Copy>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          <Tag>{exercise.muscles[0]}</Tag>
          <Tag style={{ backgroundColor: '#f2f3ee' }}>{exercise.level}</Tag>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderColor: color.line, borderWidth: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: color.white },
  picture: { aspectRatio: 1.95, overflow: 'hidden', backgroundColor: color.forest },
  play: { position: 'absolute', bottom: 10, right: 10, width: 34, height: 34, borderRadius: 18, backgroundColor: '#16241fd9', borderWidth: 1, borderColor: '#ffffff80', alignItems: 'center', justifyContent: 'center' },
  body: { padding: 12, gap: 5 },
});
