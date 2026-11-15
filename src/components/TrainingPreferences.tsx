import { useEffect, useState } from 'react';
import { ChevronDown, X } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { broadPriorities, isPlannableExercise } from '../../shared/today-plan.mjs';
import { ExercisePicker } from '../platform/ExercisePicker';
import { SelectField } from '../platform/fields';
import { color } from '../theme';
import type { Exercise, ProfileRevision, TrainingPreferences } from '../types';
import { useWorkspace } from '../workspace';
import { Button, Chip, Copy, Input, Loading, Notice, Panel, SectionTitle } from './ui';

export const emptyPreferences: TrainingPreferences = {
  intake: 'skipped', trainerNotes: '', experience: '', priorities: [], preferred: [], excluded: [],
};

const commonPriorities = [
  ...broadPriorities, 'Legs', 'Glutes', 'Chest', 'Back', 'Shoulders', 'Core', 'Arms', 'Biceps', 'Triceps', 'Calves', 'Hamstrings', 'Quadriceps',
];

export function PreferenceFields({ value, onChange, disabled }: {
  value: TrainingPreferences; onChange: (values: TrainingPreferences) => void; disabled: boolean;
}) {
  const { data } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const planExercises = (data?.catalog ?? []).filter(isPlannableExercise);
  const muscles = expanded
    ? [...new Set([...commonPriorities, ...planExercises.flatMap(({ primaryMuscles }) => primaryMuscles ?? [])])].sort()
    : [...new Set([...commonPriorities, ...value.priorities])];
  function edit(patch: Partial<TrainingPreferences>) {
    onChange({ ...value, ...patch, intake: 'completed' });
  }
  return <View style={styles.group}>
    <SelectField label="How often have you been strength training?" value={value.experience} disabled={disabled}
      onChange={(experience) => edit({ experience: experience as TrainingPreferences['experience'] })}
      options={[
        { value: '', label: 'Prefer not to say' },
        { value: 'new', label: 'I’m getting started or getting back into it' },
        { value: 'regular', label: 'I train regularly' },
      ]} />
    <Input label="What has your trainer asked you to work on between sessions?" visibleLabel="What has your trainer asked you to work on?"
      value={value.trainerNotes} editable={!disabled} onChangeText={(trainerNotes) => edit({ trainerNotes })}
      multiline maxLength={1200} placeholder="Optional · Cues, things to practice, or guidance to remember" style={styles.textarea} />
    <View role="group" accessibilityLabel="Muscle priorities" style={styles.stack}>
      <Copy size={13} weight="semibold">Muscle priorities (optional)</Copy>
      <Copy size={12} tone={color.muted}>Leave these blank for balanced training. Choose a few to put them first over the week.</Copy>
      <View style={styles.actions}>
        {muscles.map((muscle) => {
          const selected = value.priorities.includes(muscle);
          return <Chip key={muscle} label={muscle} selected={selected} onPress={() => {
            if (!disabled) edit({ priorities: selected ? value.priorities.filter((item) => item !== muscle) : [...value.priorities, muscle] });
          }} />;
        })}
        <Button compact kind="quiet" end={ChevronDown} aria-expanded={expanded} onPress={() => setExpanded(!expanded)}>
          {expanded ? 'Show common priorities' : 'More muscles'}
        </Button>
      </View>
    </View>
    <View style={styles.stack}>
      <Copy size={13} weight="semibold">Put your trainer’s guidance into practice</Copy>
      <Copy size={12} tone={color.muted}>Written notes are saved for you to refer to. Pick named exercises below to change suggestions.</Copy>
    </View>
    <ExercisePreference kind="preferred" exercises={planExercises} values={value} disabled={disabled} change={edit} />
    <ExercisePreference kind="excluded" exercises={planExercises} values={value} disabled={disabled} change={edit} />
  </View>;
}

function ExercisePreference({ kind, exercises, values, disabled, change }: {
  kind: 'preferred' | 'excluded'; exercises: Exercise[]; values: TrainingPreferences; disabled: boolean;
  change: (patch: Partial<TrainingPreferences>) => void;
}) {
  const [choice, setChoice] = useState('');
  const title = kind === 'preferred' ? 'Trainer-preferred exercises' : 'Exercises to leave out';
  const selected = values[kind];
  const other = values[kind === 'excluded' ? 'preferred' : 'excluded'];
  const options = exercises.filter(({ id }) => !selected.includes(id) && !other.includes(id));
  const suggested = options.map(({ id, name }) => ({ value: id, label: name }));
  return <View style={styles.stack}>
    <View style={[styles.actions, { alignItems: 'flex-end' }]}>
      <View style={{ flex: 1, minWidth: 155 }}>
        <ExercisePicker label={title} options={suggested} value={choice} onChange={setChoice} disabled={disabled || selected.length >= 20} />
      </View>
      <Button compact disabled={disabled || !options.some(({ id }) => id === choice) || selected.length >= 20}
        onPress={() => { change({ [kind]: [...selected, choice] }); setChoice(''); }}>
        {kind === 'preferred' ? 'Prefer exercise' : 'Exclude exercise'}
      </Button>
    </View>
    {selected.length > 0 && <View style={styles.actions}>
      {selected.map((id) => {
        const name = exercises.find((exercise) => exercise.id === id)?.name ?? id;
        return <Button key={id} compact end={X} disabled={disabled} accessibilityLabel={`Remove ${name} from ${title.toLowerCase()}`}
          onPress={() => change({ [kind]: selected.filter((key) => key !== id) })}>{name}</Button>;
      })}
    </View>}
  </View>;
}

export function TrainingProfileHistory() {
  const { api, exerciseRecords } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [entries, setEntries] = useState<ProfileRevision[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError('');
    setEntries(undefined);
    void api.profileHistory(controller.signal).then((value) => {
      if (!controller.signal.aborted) setEntries(value);
    }, (failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [api, open, attempt]);
  return <Panel style={styles.history}>
    <SectionTitle title="Profile history" summary="Your most recent saved intake and goal changes." />
    <Button compact kind="quiet" end={ChevronDown} aria-expanded={open} onPress={() => setOpen(!open)} style={{ alignSelf: 'flex-start' }}>
      {open ? 'Hide profile history' : 'Show profile history'}
    </Button>
    {open && (error ? <Notice error action={<Button compact onPress={() => setAttempt(attempt + 1)}>Retry</Button>}>{error}</Notice>
      : !entries ? <Loading label="Loading profile history…" />
      : !entries.length ? <Copy size={13} tone={color.muted}>Your saved changes will appear here.</Copy>
      : <View role="list" accessibilityLabel="Saved training profile revisions" style={styles.stack}>
      {entries.map(({ id, savedAt, details }) => {
        const preferences = details.trainingPreferences;
        const names = (ids: string[]) => ids.map((key) => exerciseRecords.get(key)?.name ?? key).join(', ');
        return <View key={id} role="listitem" style={styles.revision}>
          <Copy size={12} weight="bold" tone={color.plum}>{new Date(savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Copy>
          {details.displayName ? <Copy size={13}>{details.displayName}</Copy> : null}
          <Copy size={13}>{details.trainingGoal || 'No written goal'}</Copy>
          {preferences?.trainerNotes ? <Copy size={13}>{preferences.trainerNotes}</Copy> : null}
          {preferences?.experience ? <Copy size={12} tone={color.muted}>Experience: {preferences.experience === 'new' ? 'Getting started' : 'Training regularly'}</Copy> : null}
          <Copy size={12} tone={color.muted}>Priorities: {preferences?.priorities.join(', ') || 'Balanced'}</Copy>
          {preferences?.preferred.length ? <Copy size={12} tone={color.muted}>Prefer: {names(preferences.preferred)}</Copy> : null}
          {preferences?.excluded.length ? <Copy size={12} tone={color.muted}>Leave out: {names(preferences.excluded)}</Copy> : null}
        </View>;
      })}
      </View>)}
  </Panel>;
}

const styles = StyleSheet.create({
  group: { gap: 14 },
  stack: { gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  textarea: { minHeight: 84, paddingVertical: 10 },
  history: { gap: 10, padding: 19 },
  revision: { gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: color.line },
});
