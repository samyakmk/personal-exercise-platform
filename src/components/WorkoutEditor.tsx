import { useEffect, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import { Check, ChevronDown, ChevronUp, List, Plus, Trash2, X } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { createId } from '../api';
import { addDays, dateKey, earliestWorkoutDate, formatDay, isWorkoutDate, latestWorkoutDate, timeKey } from '../dates';
import { DateTimeField, SelectField } from '../platform/fields';
import { color } from '../theme';
import type { DumbbellLoad, Exercise, ExerciseSet, Movement, Workout, WorkoutStatus } from '../types';
import { RestTimer } from './RestTimer';
import { Sheet } from './Sheet';
import { Button, Chip, Copy, IconButton, Input, Notice, SectionTitle } from './ui';
import { validWeight, WeightFields } from './WeightFields';

type DraftSet = {
  reps: string;
  load: string;
  unit: DumbbellLoad['unit'];
};
type DetailedSet = DraftSet & { id: string };
type DraftEntry = DraftSet & { exerciseId: string; sets: string; details?: DetailedSet[] };

export type WorkoutDraft = {
  id: string; name: string; day: string; time: string; status: WorkoutStatus; entries: DraftEntry[]; notes?: string; repeatWeeks?: number;
};

type Props = {
  initial?: Workout;
  preset?: Exercise;
  status: WorkoutStatus;
  date: string;
  copy?: boolean;
  draft?: WorkoutDraft;
  catalog: Exercise[];
  suggested: string[];
  bookmarks: string[];
  onClose: () => void;
  onSave: (workout: Workout, existing: boolean, repeatWeeks: number) => Promise<void>;
  onDelete: (id: string, revision?: number) => Promise<void>;
  onDraftChange?: (draft: WorkoutDraft) => void;
};

function makeEntry(exercise: Exercise): DraftEntry {
  return { exerciseId: exercise.id, sets: '3', reps: exercise.unit === 'seconds' ? '30' : '10', load: '', unit: 'lb' };
}

function draftSet({ reps, load }: ExerciseSet): DraftSet {
  return { reps: String(reps), load: load ? String(load.value) : '', unit: load?.unit ?? 'lb' };
}

function toSet({ reps, load, unit }: DraftSet): ExerciseSet {
  return { reps: Number(reps), ...(load ? { load: { value: Number(load.replace(',', '.')), unit } } : {}) };
}

function wholeNumber(value: string, max: number) {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max;
}

export function WorkoutEditor({ initial, preset, status, date, copy = false, catalog, suggested, bookmarks, draft, onClose, onSave, onDelete, onDraftChange }: Props) {
  const loggingPlan = status === 'completed' && initial?.status === 'planned';
  const editing = initial && !copy;
  const [id] = useState(() => editing ? initial.id : draft?.id ?? createId());
  const [name, setName] = useState(draft?.name ?? initial?.name ?? (preset ? preset.name + ' workout' : ''));
  const [day, setDay] = useState(draft?.day ?? (loggingPlan || copy ? date : initial?.date ?? date));
  const [time, setTime] = useState(() => {
    const now = new Date();
    return draft?.time ?? (loggingPlan || (!initial && status === 'completed' && date === dateKey(now))
      ? timeKey(now) : initial?.time ?? '17:00');
  });
  const [currentStatus, setStatus] = useState(draft?.status ?? status);
  const [notes, setNotes] = useState(draft?.notes ?? initial?.notes ?? '');
  const [repeatWeeks, setRepeatWeeks] = useState(draft?.repeatWeeks ?? 1);
  const [showOptions, setShowOptions] = useState(Boolean(draft?.notes || initial?.notes || (draft?.repeatWeeks ?? 1) > 1));
  const [entries, setEntries] = useState<DraftEntry[]>(() => {
    const items = initial?.exercises.map(({ exerciseId, sets, reps, load, setDetails }) => ({
      exerciseId, sets: String(sets), ...draftSet({ reps, load }),
      details: setDetails?.map((set) => ({ id: createId(), ...draftSet(set) })),
    })) ?? draft?.entries ?? [];
    return preset && !items.some((item) => item.exerciseId === preset.id) ? [...items, makeEntry(preset)] : items;
  });
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const narrow = useWindowDimensions().width < 500;
  const available = catalog.filter((exercise) => !entries.some((entry) => entry.exerciseId === exercise.id));
  const rank = (id: string) => bookmarks.includes(id) ? 2 : Number(suggested.includes(id));
  const ranked = [...available].sort((a, b) => rank(b.id) - rank(a.id));
  const [startedEditing, markEdited] = useState(false);
  useEffect(() => {
    if (startedEditing) onDraftChange?.({ id, name, day, time, status: currentStatus, entries, notes, repeatWeeks });
  }, [startedEditing, onDraftChange, id, name, day, time, currentStatus, entries, notes, repeatWeeks]);

  function changeEntries(next: SetStateAction<DraftEntry[]>) {
    markEdited(true);
    setEntries(next);
  }

  function add() {
    const exercise = available.find((item) => item.id === choice);
    if (!exercise) return;
    changeEntries((items) => items.some(({ exerciseId }) => exerciseId === exercise.id) ? items : [...items, makeEntry(exercise)]);
    setChoice('');
  }

  function update(id: string, fields: Partial<Omit<DraftEntry, 'exerciseId'>>) {
    changeEntries((items) => items.map((item) => item.exerciseId === id ? { ...item, ...fields } : item));
  }

  function moveExercise(exerciseId: string, direction: -1 | 1) {
    changeEntries((items) => {
      const from = items.findIndex((item) => item.exerciseId === exerciseId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= items.length) return items;
      const ordered = items.slice();
      [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
      return ordered;
    });
  }

  function showDetails(entry: DraftEntry) {
    if (!wholeNumber(entry.sets, 30)) {
      setError('Enter a set count from 1 to 30 before editing individual sets.');
      return;
    }
    setError('');
    const { reps, load, unit } = entry;
    update(entry.exerciseId, { details: Array.from({ length: Number(entry.sets) }, () => ({ id: createId(), reps, load, unit })) });
  }

  async function run(action: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (failure) { setError((failure as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }

  const close = () => { if (!saving.current) onClose(); };

  if (confirmDelete && editing) {
    return <Sheet title="Delete workout?" detail={`“${initial.name}” will be removed from your schedule or history.`} onClose={close}>
      {error && <Notice error>{error}</Notice>}
      <View style={styles.actions}>
        <Button onPress={() => { setError(''); setConfirmDelete(false); }} disabled={busy}>Keep workout</Button>
        <Button kind="danger" icon={Trash2} disabled={busy} onPress={() => run(() => onDelete(initial.id, initial.revision))}>{busy ? 'Deleting…' : 'Delete workout'}</Button>
      </View>
    </Sheet>;
  }

  const logging = currentStatus === 'completed';
  const canRepeat = !editing && !logging;
  const lastDay = canRepeat && repeatWeeks > 1 && isWorkoutDate(day) ? addDays(day, (repeatWeeks - 1) * 7) : '';
  const lastDayValid = !lastDay || isWorkoutDate(lastDay);
  const title = copy ? 'Repeat workout' : editing ? (loggingPlan ? 'Log planned workout' : 'Edit workout')
    : logging ? 'Log a workout' : 'Schedule a workout';

  function submit() {
    if (saving.current) return;
    if (!name.trim() || !day || !time || !entries.length) {
      setError('Enter a name, date, and time, then add at least one exercise.');
      return;
    }
    if (!isWorkoutDate(day) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError('Choose a valid date and time for your workout.');
      return;
    }
    if (!lastDayValid) {
      setError('Choose a weekly schedule that ends by December 2199.');
      return;
    }
    const details = entries.flatMap<DraftSet>((entry) => entry.details ?? [entry]);
    if (entries.some((entry) => !entry.details && !wholeNumber(entry.sets, 30)) || details.some(({ reps }) => !wholeNumber(reps, 600))) {
      setError('Use whole numbers between 1 and 30 for sets and between 1 and 600 for reps or seconds.');
      return;
    }
    if (details.some(({ load }) => load && !validWeight(load))) {
      setError('Enter a dumbbell weight from 0.01 to 1000 kg or lb, or leave it blank.');
      return;
    }
    void run(() => onSave({
      id, name: name.trim(), date: day, time, status: currentStatus, revision: editing ? initial.revision : undefined,
      notes: notes.trim(),
      exercises: entries.map((entry): Movement => {
        if (!entry.details) return { exerciseId: entry.exerciseId, sets: Number(entry.sets), ...toSet(entry) };
        const setDetails = entry.details.map(toSet);
        return { exerciseId: entry.exerciseId, sets: setDetails.length, ...setDetails[0], setDetails };
      }),
    }, Boolean(editing), canRepeat ? repeatWeeks : 1));
  }

  return <Sheet title={title} detail={logging ? 'Enter the sets and reps or hold times you completed.' : 'Choose when you’ll train and which exercises you’ll do.'} onClose={close}>
    {editing && initial.example && <Notice>Saving adds this workout to your own schedule or history.</Notice>}
    <View style={styles.basics}>
      <Input label="Workout name" value={name} onChangeText={(value) => { markEdited(true); setName(value); }}
        placeholder="e.g. Upper Body Strength" maxLength={70} />
      <View style={styles.actions}>
        <DateTimeField label="Date" kind="date" value={day} min={earliestWorkoutDate} max={latestWorkoutDate} disabled={busy}
          onChange={(value) => { markEdited(true); setDay(value); }} />
        <DateTimeField label="Time" kind="time" value={time} disabled={busy} onChange={(value) => { markEdited(true); setTime(value); }} />
      </View>
    </View>
    <View style={styles.exerciseSection}>
      <SectionTitle title="Exercises" level={3} />
      {entries.map((entry, index) => {
        const exercise = catalog.find((item) => item.id === entry.exerciseId);
        const measurement = exercise?.unit === 'seconds' ? 'Seconds' : 'Reps';
        const exerciseName = exercise?.name ?? entry.exerciseId;
        const weighted = exercise?.equipment.includes('Dumbbells');
        const individual = entry.details;
        return <View key={entry.exerciseId} style={[styles.entry, (narrow || individual) && { alignItems: 'stretch', flexDirection: 'column' }]}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
            <Copy size={13} weight="semibold" style={{ flexShrink: 1 }}>{exerciseName}</Copy>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {entries.length > 1 && <>
                <IconButton size={31} icon={ChevronUp} label={`Move ${exerciseName} up`} disabled={index === 0}
                  onPress={() => moveExercise(entry.exerciseId, -1)} />
                <IconButton size={31} icon={ChevronDown} label={`Move ${exerciseName} down`} disabled={index === entries.length - 1}
                  onPress={() => moveExercise(entry.exerciseId, 1)} />
              </>}
              {(narrow || individual) && <IconButton size={31} icon={X} label={`Remove ${exerciseName}`}
                onPress={() => changeEntries((items) => items.filter((item) => item.exerciseId !== entry.exerciseId))} />}
            </View>
          </View>
          {individual ? <>
            {individual.map((set, index) => {
              const label = `Set ${index + 1} · ${exerciseName}`;
              const change = (fields: Partial<DraftSet>) => update(entry.exerciseId, {
                details: individual.map((item, position) => position === index ? { ...item, ...fields } : item),
              });
              return <View key={set.id} style={styles.set}>
                <View style={styles.setTitle}>
                  <Copy size={12} weight="semibold">{`Set ${index + 1}`}</Copy>
                  {individual.length > 1 && <IconButton icon={X} label={`Remove ${label}`}
                    onPress={() => update(entry.exerciseId, { details: individual.filter((_, position) => position !== index) })} />}
                </View>
                <View style={[styles.actions, { alignItems: 'flex-end' }]}>
                  <Input label={`${measurement} · ${label}`} visibleLabel={measurement} value={set.reps}
                    onChangeText={(reps) => change({ reps })} keyboardType="number-pad" maxLength={3} />
                  {weighted && <WeightFields label={label} set={set} onChange={change} />}
                </View>
              </View>;
            })}
            <Button compact icon={Plus} disabled={individual.length >= 30}
              accessibilityLabel={`Add set · ${exerciseName}`}
              onPress={() => update(entry.exerciseId, {
                details: [...individual, { ...individual[individual.length - 1], id: createId() }],
              })}>Add set</Button>
          </> : <>
            <View style={[styles.actions, !narrow && { width: 152 }]}>
              <Input label={`Sets · ${exerciseName}`} visibleLabel="Sets" style={{ paddingHorizontal: 8 }} value={entry.sets}
                onChangeText={(sets) => update(entry.exerciseId, { sets })} keyboardType="number-pad" maxLength={2} />
              <Input label={`${measurement} · ${exerciseName}`} visibleLabel={measurement} style={{ paddingHorizontal: 8 }} value={entry.reps}
                onChangeText={(reps) => update(entry.exerciseId, { reps })} keyboardType="number-pad" maxLength={3} />
            </View>
            {!narrow && <IconButton icon={X} label={`Remove ${exerciseName}`}
              onPress={() => changeEntries((items) => items.filter((item) => item.exerciseId !== entry.exerciseId))} />}
            {weighted && <View style={[styles.actions, { flexBasis: narrow ? 'auto' : '100%', alignItems: 'flex-end' }]}>
              <WeightFields label={exerciseName} set={entry} onChange={(fields) => update(entry.exerciseId, fields)} />
            </View>}
            <Button kind="quiet" compact icon={List} accessibilityLabel={`${logging ? 'Log each set' : 'Plan each set'} · ${exerciseName}`}
              onPress={() => showDetails(entry)}>{logging ? 'Log each set' : 'Plan each set'}</Button>
          </>}
        </View>;
      })}
      {available.length > 0 && <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 7 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <SelectField label="Choose an exercise" value={choice} onChange={setChoice} placeholder="Select an exercise"
            options={ranked.map((exercise) => ({ value: exercise.id,
              label: exercise.name + (bookmarks.includes(exercise.id) ? ' · Saved' : suggested.includes(exercise.id) ? ' · Recent' : '') }))} />
        </View>
        <Button icon={Plus} disabled={!choice} style={{ alignSelf: 'flex-end', minHeight: 43 }} onPress={add}>Add</Button>
      </View>}
    </View>
    {loggingPlan && logging && <RestTimer />}
    <View style={styles.options}>
      <Button kind="quiet" compact end={showOptions ? ChevronUp : ChevronDown} aria-expanded={showOptions}
        onPress={() => setShowOptions((value) => !value)}>Workout options</Button>
      {showOptions && <View style={styles.optionFields}>
        <View style={styles.optionRow}>
          <View role="group" accessibilityLabel="Workout status" style={{ gap: 7 }}>
            <Copy size={12} weight="semibold">Workout status</Copy>
            <View style={styles.actions}>
              <Chip label="Planned" selected={!logging} onPress={() => { markEdited(true); setStatus('planned'); }} />
              <Chip label="Completed" selected={logging} onPress={() => { markEdited(true); setStatus('completed'); }} />
            </View>
          </View>
          {canRepeat && <View style={{ gap: 5, minWidth: 150 }}>
            <SelectField label="Repeat weekly" value={String(repeatWeeks)} onChange={(value) => { markEdited(true); setRepeatWeeks(Number(value)); }}
              options={Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: index ? `${index + 1} weekly sessions` : 'One session' }))} />
          </View>}
        </View>
        <Input label="Workout notes" value={notes} onChangeText={(value) => { markEdited(true); setNotes(value); }}
          placeholder={logging ? 'What went well or what to change next time' : 'Plan reminders or exercise cues'}
          maxLength={1200} multiline numberOfLines={3} style={{ minHeight: 74, paddingVertical: 8, textAlignVertical: 'top' }} />
      </View>}
      {lastDay && lastDayValid && <Copy size={12} tone={color.muted}>{`Last session · ${formatDay(lastDay)}`}</Copy>}
    </View>
    {error && <Notice error>{error}</Notice>}
    <View style={[styles.actions, styles.footer]}>
      <Button icon={Check} kind="primary" disabled={busy} onPress={submit}>
        {busy ? 'Saving…' : logging ? 'Save workout log' : canRepeat && repeatWeeks > 1 ? `Schedule ${repeatWeeks} workouts` : 'Save workout'}
      </Button>
      {editing && <Button icon={Trash2} kind="quiet" disabled={busy} onPress={() => { setError(''); setConfirmDelete(true); }}>Delete workout</Button>}
    </View>
  </Sheet>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' },
  basics: { gap: 12 },
  exerciseSection: { gap: 9, paddingTop: 11, borderTopWidth: 1, borderColor: color.line },
  options: { gap: 8 },
  optionFields: { gap: 11, backgroundColor: color.canvas, borderRadius: 9, padding: 12 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14 },
  footer: { justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderColor: color.line },
  entry: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, backgroundColor: color.canvas, borderRadius: 8, padding: 8 },
  set: { gap: 5, borderTopWidth: 1, borderColor: color.line, paddingVertical: 7 },
  setTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
