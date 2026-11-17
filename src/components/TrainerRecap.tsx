import { useState } from 'react';
import { ClipboardList, Copy as CopyIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { formatDay, workoutTime } from '../dates';
import { completedWorkouts, performedSetSummary } from '../trainingProgress';
import type { Exercise, Workout } from '../types';
import { useLocalClock } from '../useLocalClock';
import { useWorkspace } from '../workspace';
import { SelectField } from '../platform/fields';
import { color } from '../theme';
import { Sheet } from './Sheet';
import { Button, Chip, Copy, Input, Notice, Panel, SectionTitle } from './ui';

export function TrainerRecap({ workouts, catalog }: { workouts: Workout[]; catalog: ReadonlyMap<string, Exercise> }) {
  const now = useLocalClock();
  const logs = completedWorkouts(workouts, workoutTime(now));
  const trainerIndex = logs.findIndex(({ source }) => source === 'trainer');
  const trainer = logs[trainerIndex];
  const since = trainer ? logs.slice(0, trainerIndex) : [];
  const [open, setOpen] = useState(false);
  if (!trainer) return null;
  return <>
    <Panel style={styles.panel}>
      <SectionTitle title="Since your last trainer session" summary={`${since.length} ${since.length === 1 ? 'session' : 'sessions'} since ${formatDay(trainer.date)}`} />
      <Button compact kind="quiet" icon={ClipboardList} style={{ alignSelf: 'flex-start' }} onPress={() => setOpen(true)}>Prepare trainer recap</Button>
    </Panel>
    {open && <RecapSheet key={trainer.id} trainer={trainer} sessions={since} catalog={catalog} onClose={() => setOpen(false)} />}
  </>;
}

function RecapSheet({ trainer, sessions, catalog, onClose }: {
  trainer: Workout; sessions: Workout[]; catalog: ReadonlyMap<string, Exercise>; onClose: () => void;
}) {
  const [selected, setSelected] = useState(() => new Set(sessions.map(({ id }) => id)));
  const [question, setQuestion] = useState('');
  const [selectedClip, setSelectedClip] = useState('');
  const [copied, setCopied] = useState(false);
  const { data } = useWorkspace();
  const clips = (data?.clips ?? []).flatMap((clip) => {
    const observation = clip.review?.observations.find(({ kind }) => kind === 'adjustment') ?? clip.review?.observations[0];
    const context = clip.trainingContext;
    if (!observation || !sessions.some(({ id }) => id === context?.sessionId || id === context?.workoutId)) return [];
    const timestamp = `${Math.floor(observation.timestamp / 60)}:${String(Math.floor(observation.timestamp % 60)).padStart(2, '0')}`;
    return [{ value: clip.id, label: `${clip.filename} · ${timestamp}`, cue: observation.cue, timestamp, filename: clip.filename }];
  });
  const chosenClip = clips.find(({ value }) => value === selectedClip);
  const chosenSessions = sessions.filter(({ id }) => selected.has(id)).reverse();
  const recap = [
    `Training since ${trainer.name} on ${formatDay(trainer.date)}`,
    ...chosenSessions.flatMap((workout) => [
      '', `${formatDay(workout.date)} · ${workout.name}${workout.effort ? ` · Effort ${workout.effort}/10` : ''}`,
      ...workout.exercises.filter(({ sets }) => sets > 0).map((movement) => {
        const exercise = catalog.get(movement.exerciseId);
        const performed = movement.setDetails?.length
          ? movement.setDetails.map((set) => performedSetSummary(exercise, set)).join(' / ')
          : `${movement.sets} × ${performedSetSummary(exercise, movement)}`;
        const original = movement.replacesExerciseId && (catalog.get(movement.replacesExerciseId)?.name ?? movement.replacesExerciseId);
        return `• ${exercise?.name ?? movement.exerciseId} · ${performed}${original ? ` (instead of ${original})` : ''}`;
      }),
      ...(workout.skippedExerciseIds ?? []).map((id) => {
        const partial = workout.exercises.some(({ exerciseId, sets }) => exerciseId === id && sets > 0);
        return `• Skipped ${partial ? 'remaining sets of ' : ''}${catalog.get(id)?.name ?? id}`;
      }),
    ]),
    ...(chosenClip ? ['', `Form cue · ${chosenClip.filename} at ${chosenClip.timestamp}`, chosenClip.cue] : []),
    ...(question.trim() ? ['', `Question for my trainer`, question.trim()] : []),
  ].join('\n');
  return <Sheet title="Trainer recap" detail="Choose what to include, then copy the preview. Your notes and video files stay private." onClose={onClose}>
    {sessions.length > 0 ? <View role="group" accessibilityLabel="Sessions to include" style={styles.choices}>
      {sessions.map(({ id, name, date }) => <Chip key={id} label={`${formatDay(date)} · ${name}`} selected={selected.has(id)} onPress={() => {
        setCopied(false);
        setSelected((old) => {
          const next = new Set(old);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        });
      }} />)}
    </View> : <Copy tone={color.muted}>Newly logged sessions will appear here.</Copy>}
    {clips.length > 0 && <SelectField label="Form cue to include (optional)" value={selectedClip}
      options={[{ value: '', label: 'No form cue' }, ...clips]} onChange={(value) => { setCopied(false); setSelectedClip(value); }} />}
    <Input label="Question for your trainer (optional)" value={question} multiline maxLength={500}
      onChangeText={(value) => { setCopied(false); setQuestion(value); }} />
    <Input label="Recap preview" value={recap} multiline editable={false} style={styles.preview} />
    {typeof navigator !== 'undefined' && navigator.clipboard && <Button icon={CopyIcon} kind="primary" style={{ alignSelf: 'flex-start' }}
      onPress={() => { void navigator.clipboard.writeText(recap).then(() => setCopied(true), () => setCopied(false)); }}>Copy recap</Button>}
    {copied && <Notice>Recap copied.</Notice>}
  </Sheet>;
}

const styles = StyleSheet.create({
  panel: { gap: 10, padding: 16 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  preview: { minHeight: 155, paddingVertical: 10, textAlignVertical: 'top', backgroundColor: color.canvas },
});
