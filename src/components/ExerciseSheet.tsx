import { useTrainingNavigation } from '../navigation';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Bookmark, History, Plus, Video } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Demonstration } from '../platform/Demonstration';
import { color } from '../theme';
import type { Exercise } from '../types';
import { useWorkspace } from '../workspace';
import { Sheet } from './Sheet';
import { TechniqueTips } from './TechniqueTips';
import { Button, Copy, Notice, SectionTitle, Tag } from './ui';

export function ExerciseSheet({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const training = useTrainingNavigation();
  const router = useRouter();
  const { api, data, mutate, announce } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const { width } = useWindowDimensions();
  const split = width >= 900 && Boolean(exercise.demonstration);
  const saved = data?.bookmarks?.includes(exercise.id) ?? false;
  function open(type: 'add' | 'review' | 'new-session') {
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

  return <Sheet title={exercise.name} detail={exercise.description === exercise.category ? undefined : exercise.description}
    onClose={onClose} wide={split}>
    <View style={[styles.content, split && styles.columns]}>
      {exercise.demonstration && <View style={split && styles.mediaColumn}><Demonstration exercise={exercise} /></View>}
      <View style={[styles.instructions, split && styles.instructionColumn]}>
        <View style={styles.facts}>
          <View style={styles.actions}>
            <Tag>{exercise.category}</Tag>
            <Tag>{exercise.level}</Tag>
            <Tag>{exercise.equipment.join(' · ') || 'Bodyweight'}</Tag>
          </View>
          <MuscleTags label="Primary muscles" muscles={exercise.primaryMuscles ?? exercise.muscles} />
          {!!exercise.secondaryMuscles?.length && <MuscleTags label="Secondary muscles" muscles={exercise.secondaryMuscles} />}
        </View>
        {exercise.cues.length > 0 && <View style={styles.steps}>
          <SectionTitle title="How to do it" level={3} />
          {exercise.cues.map((cue, index) => (
            <View key={cue} style={styles.cue}>
              <View style={styles.number}><Copy weight="bold" size={11} tone={color.plum}>{index + 1}</Copy></View>
              <Copy size={14} style={styles.cueText}>{cue}</Copy>
            </View>
          ))}
        </View>}
      </View>
    </View>
    <TechniqueTips exercise={exercise} sideBySide={width >= 620} />
    <View style={styles.footer}>
      <View style={[styles.actions, styles.footerActions]}>
        {exercise.demonstration && <>
          <Button kind="primary" icon={Plus} onPress={() => open('add')}>Add to workout</Button>
          <Button icon={Plus} onPress={() => open('new-session')}>New session</Button>
        </>}
        {(exercise.demonstration || saved) && <Button icon={Bookmark} disabled={busy} onPress={() => void toggleBookmark()}>
          {saved ? 'Remove saved exercise' : 'Save exercise'}
        </Button>}
      </View>
      <View style={[styles.actions, styles.footerActions]}>
        {exercise.demonstration && <Button icon={Video} kind="quiet" compact onPress={() => open('review')}>Upload my form</Button>}
        <Button icon={History} kind="quiet" compact onPress={() => {
          onClose();
          router.push({ pathname: '/progress', params: { exercise: exercise.id } });
        }}>My exercise history</Button>
      </View>
    </View>
    {error && <Notice error>{error}</Notice>}
  </Sheet>;
}

function MuscleTags({ label, muscles }: { label: string; muscles: string[] }) {
  return <View style={styles.muscleRow}>
    <Copy size={12} weight="semibold" tone={color.muted} style={styles.muscleLabel}>{label}</Copy>
    <View style={[styles.actions, styles.muscleTags]}>
      {muscles.map((muscle) => <Tag key={muscle}>{muscle}</Tag>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 20 },
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  mediaColumn: { flex: 1.3, minWidth: 0 },
  instructionColumn: { flex: 1 },
  instructions: { minWidth: 0, gap: 14 },
  facts: { gap: 7 },
  muscleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  muscleLabel: { width: 116, paddingTop: 2 },
  muscleTags: { flex: 1, minWidth: 0 },
  steps: { gap: 9, paddingTop: 12, borderTopWidth: 1, borderColor: color.line },
  cue: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  cueText: { flex: 1, paddingTop: 1 },
  number: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: color.tint },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, paddingTop: 14, borderTopWidth: 1, borderColor: color.line },
  footerActions: { maxWidth: '100%' },
});
