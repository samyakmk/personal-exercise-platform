import { useTrainingNavigation } from '../navigation';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Bookmark, History, Plus, Video } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { api } from '../api';
import { Demonstration } from '../platform/Demonstration';
import { color } from '../theme';
import type { Exercise } from '../types';
import { useWorkspace } from '../workspace';
import { Sheet } from './Sheet';
import { Button, Copy, Notice, SectionTitle, Tag } from './ui';

export function ExerciseSheet({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const training = useTrainingNavigation();
  const router = useRouter();
  const { data, mutate, announce } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const split = useWindowDimensions().width >= 900;
  const saved = data?.bookmarks?.includes(exercise.id) ?? false;
  function open(type: 'add' | 'review') {
    onClose();
    training.open({ type, exerciseId: exercise.id });
  }

  async function toggleBookmark() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await mutate(() => api.setExerciseBookmark(exercise.id, !saved));
      announce(saved ? 'Exercise removed from your saved list.' : 'Exercise saved to your list.');
    } catch (failure) { setError((failure as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }

  return <Sheet title={exercise.name} detail={exercise.description} onClose={onClose} wide={split}>
    <View style={[styles.content, split && { flexDirection: 'row', alignItems: 'flex-start' }]}>
      <View style={split ? { flex: 1.65, minWidth: 0 } : undefined}><Demonstration exercise={exercise} /></View>
      <View style={[styles.instructions, split && { flex: 1 }]}>
        <SectionTitle title="How to do it" level={3} />
        {exercise.cues.map((cue, index) => (
          <View key={cue} style={styles.cue}>
            <View style={styles.number}><Copy weight="bold" size={11} tone={color.plum}>{index + 1}</Copy></View>
            <Copy tone={color.text} size={13} style={{ flex: 1 }}>{cue}</Copy>
          </View>
        ))}
        <View style={styles.actions}>
          {exercise.muscles.map((muscle) => <Tag key={muscle}>{muscle}</Tag>)}
          <Tag>{exercise.equipment.join(' · ') || 'Bodyweight'}</Tag>
          <Tag>{exercise.level}</Tag>
        </View>
      </View>
    </View>
    <View style={styles.footer}>
      <View style={styles.actions}>
        <Button kind="primary" icon={Plus} onPress={() => open('add')}>Add to workout</Button>
        <Button icon={Bookmark} disabled={busy} onPress={() => void toggleBookmark()}>{saved ? 'Remove saved exercise' : 'Save exercise'}</Button>
      </View>
      <View style={styles.actions}>
        <Button icon={Video} kind="quiet" compact onPress={() => open('review')}>Upload my form</Button>
        <Button icon={History} kind="quiet" compact onPress={() => {
          onClose();
          router.push({ pathname: '/progress', params: { exercise: exercise.id } });
        }}>My exercise history</Button>
      </View>
    </View>
    {error && <Notice error>{error}</Notice>}
  </Sheet>;
}

const styles = StyleSheet.create({
  content: { gap: 20 },
  instructions: { minWidth: 0, gap: 12 },
  cue: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  number: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: color.tint },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, paddingTop: 14, borderTopWidth: 1, borderColor: color.line },
});
