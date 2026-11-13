import { useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { createId } from '../api';
import { DateTimeField, SelectField } from '../platform/fields';
import { color } from '../theme';
import type { Exercise, Workout, WorkoutStatus } from '../types';
import { Sheet } from './Sheet';
import { Button, Chip, Copy, IconButton, Input, Notice } from './ui';

type DraftEntry = { exerciseId: string; sets: string; reps: string };

type Props = {
  initial?: Workout;
  preset?: Exercise;
  status: WorkoutStatus;
  date: string;
  catalog: Exercise[];
  suggested: string[];
  onClose: () => void;
  onSave: (workout: Workout, existing: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

function makeEntry(exercise: Exercise): DraftEntry {
  return { exerciseId: exercise.id, sets: '3', reps: exercise.unit === 'seconds' ? '30' : '10' };
}

export function WorkoutEditor({ initial, preset, status, date, catalog, suggested, onClose, onSave, onDelete }: Props) {
  const [id] = useState(() => initial?.id ?? createId());
  const [name, setName] = useState(initial?.name ?? (preset ? preset.name + ' workout' : ''));
  const [day, setDay] = useState(initial?.date ?? date);
  const [time, setTime] = useState(initial?.time ?? '17:00');
  const [currentStatus, setStatus] = useState(status);
  const [entries, setEntries] = useState<DraftEntry[]>(() => {
    const items = initial?.exercises.map((entry) => ({ ...entry, sets: String(entry.sets), reps: String(entry.reps) })) ?? [];
    return preset && !items.some((item) => item.exerciseId === preset.id) ? [...items, makeEntry(preset)] : items;
  });
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const narrow = useWindowDimensions().width < 500;
  const available = catalog.filter((exercise) => !entries.some((entry) => entry.exerciseId === exercise.id));
  const ranked = [...available].sort((a, b) => Number(suggested.includes(b.id)) - Number(suggested.includes(a.id)));

  function add() {
    const exercise = available.find((item) => item.id === choice);
    if (!exercise) return;
    setEntries((items) => [...items, makeEntry(exercise)]);
    setChoice('');
  }

  function update(id: string, field: 'sets' | 'reps', value: string) {
    setEntries((items) => items.map((item) => item.exerciseId === id ? { ...item, [field]: value } : item));
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  const close = () => { if (!busy) onClose(); };

  if (confirmDelete && initial) {
    return <Sheet title="Delete workout?" detail={`“${initial.name}” will be removed from your schedule or history.`} onClose={close}>
      {error && <Notice error>{error}</Notice>}
      <View style={styles.actions}>
        <Button onPress={() => { setError(''); setConfirmDelete(false); }} disabled={busy}>Keep workout</Button>
        <Button kind="danger" icon={Trash2} disabled={busy} onPress={() => run(() => onDelete(initial.id))}>{busy ? 'Deleting…' : 'Delete workout'}</Button>
      </View>
    </Sheet>;
  }

  const logging = currentStatus === 'completed';
  const title = initial ? (status === 'completed' && initial.status === 'planned' ? 'Log planned workout' : 'Edit workout')
    : logging ? 'Log a workout' : 'Schedule a workout';

  function submit() {
    if (!name.trim() || !day || !time || !entries.length) {
      setError('Enter a name, date, and time, then add at least one exercise.');
      return;
    }
    if (entries.some(({ sets, reps }) => !/^\d+$/.test(sets) || !/^\d+$/.test(reps) || Number(sets) < 1 || Number(sets) > 30 || Number(reps) < 1 || Number(reps) > 600)) {
      setError('Use whole numbers between 1 and 30 for sets and between 1 and 600 for reps or seconds.');
      return;
    }
    void run(() => onSave({
      id, name: name.trim(), date: day, time, status: currentStatus,
      exercises: entries.map(({ exerciseId, sets, reps }) => ({ exerciseId, sets: Number(sets), reps: Number(reps) })),
    }, Boolean(initial)));
  }

  return <Sheet title={title} detail={logging ? 'Enter the sets and reps or hold times you completed.' : 'Choose when you’ll train and which exercises you’ll do.'} onClose={close}>
    <View style={styles.actions}>
      <Chip label="Planned" selected={!logging} onPress={() => setStatus('planned')} />
      <Chip label="Completed" selected={logging} onPress={() => setStatus('completed')} />
    </View>
    <Input label="Workout name" value={name} onChangeText={setName} placeholder="e.g. Upper Body Strength" maxLength={70} />
    <View style={styles.actions}>
      <DateTimeField label="Date" kind="date" value={day} onChange={setDay} />
      <DateTimeField label="Time" kind="time" value={time} onChange={setTime} />
    </View>
    <View style={{ gap: 8 }}>
      <Copy size={16} weight="bold">Exercises</Copy>
      {entries.map((entry) => {
        const exercise = catalog.find((item) => item.id === entry.exerciseId);
        const unit = exercise?.unit === 'seconds' ? 'Seconds' : 'Reps';
        return <View key={entry.exerciseId} style={[styles.entry, narrow && { alignItems: 'stretch', flexDirection: 'column' }]}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <Copy size={13} weight="semibold" style={{ flexShrink: 1 }}>{exercise?.name ?? entry.exerciseId}</Copy>
            {narrow && <IconButton icon={X} label={`Remove ${exercise?.name ?? entry.exerciseId}`}
              onPress={() => setEntries((items) => items.filter((item) => item.exerciseId !== entry.exerciseId))} />}
          </View>
          <View style={[styles.actions, !narrow && { width: 152 }]}>
            <Input label={`Sets · ${exercise?.name ?? entry.exerciseId}`} visibleLabel="Sets" style={{ paddingHorizontal: 8 }} value={entry.sets}
              onChangeText={(value) => update(entry.exerciseId, 'sets', value)} keyboardType="number-pad" maxLength={2} />
            <Input label={`${unit} · ${exercise?.name ?? entry.exerciseId}`} visibleLabel={unit} style={{ paddingHorizontal: 8 }} value={entry.reps}
              onChangeText={(value) => update(entry.exerciseId, 'reps', value)} keyboardType="number-pad" maxLength={3} />
          </View>
          {!narrow && <IconButton icon={X} label={`Remove ${exercise?.name ?? entry.exerciseId}`}
            onPress={() => setEntries((items) => items.filter((item) => item.exerciseId !== entry.exerciseId))} />}
        </View>;
      })}
      {available.length > 0 && <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 7 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <SelectField label="Choose an exercise" value={choice} onChange={setChoice} placeholder="Select an exercise"
            options={ranked.map((exercise) => ({ value: exercise.id, label: exercise.name + (suggested.includes(exercise.id) ? ' · Recent' : '') }))} />
        </View>
        <Button icon={Plus} disabled={!choice} onPress={add}>Add</Button>
      </View>}
    </View>
    {error && <Notice error>{error}</Notice>}
    <View style={[styles.actions, { justifyContent: 'space-between' }]}>
      <Button icon={Check} kind="primary" disabled={busy} onPress={submit}>
        {busy ? 'Saving…' : logging ? 'Save workout log' : 'Save workout'}
      </Button>
      {initial && <Button icon={Trash2} kind="quiet" disabled={busy} onPress={() => { setError(''); setConfirmDelete(true); }}>Delete workout</Button>}
    </View>
  </Sheet>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: color.canvas, borderRadius: 8, padding: 8 },
});
