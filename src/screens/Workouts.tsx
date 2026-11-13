import { useEffect, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Dumbbell, History, Pencil, Plus } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { api } from '../api';
import { addDays, asDate, dateKey, formatDay, formatTime, workoutDay } from '../dates';
import { Sheet } from '../components/Sheet';
import { WorkoutEditor } from '../components/WorkoutEditor';
import { Button, Chip, Copy, Empty, IconButton, PageTitle, Panel, SectionTitle, Tag } from '../components/ui';
import { useTrainingNavigation } from '../navigation';
import { color } from '../theme';
import type { Exercise, Workout, WorkoutStatus } from '../types';
import { useWorkspace } from '../workspace';

type Editor = { initial?: Workout; preset?: Exercise; status: WorkoutStatus; date: string };

function weekStart(day: string) {
  return addDays(day, -((asDate(day).getDay() + 6) % 7));
}

export function Workouts() {
  const { data, mutate, announce } = useWorkspace();
  const { intent, clear } = useTrainingNavigation();
  const [tab, setTab] = useState<WorkoutStatus>('planned');
  const [week, setWeek] = useState(() => weekStart(dateKey()));
  const [filter, setFilter] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [addExercise, setAddExercise] = useState<Exercise | null>(null);
  const narrow = useWindowDimensions().width < 540;

  useEffect(() => {
    if (!data || !intent || intent.type === 'review') return;
    if (intent.type === 'schedule') {
      setAddExercise(null);
      setEditor({ status: 'planned', date: dateKey() });
    } else if (intent.type === 'edit') {
      const initial = data.workouts.find((item) => item.id === intent.workoutId);
      if (initial) setEditor({ initial, status: initial.status, date: initial.date });
    } else {
      const preset = data.catalog.find((item) => item.id === intent.exerciseId);
      if (preset) setAddExercise(preset);
    }
    clear();
  }, [data, intent, clear]);

  if (!data) return null;

  const planned = data.workouts.filter((item) => item.status === 'planned');
  const history = data.workouts.filter((item) => item.status === 'completed').reverse();
  const rows = (tab === 'planned' ? planned : history).filter((item) => !filter || item.date === filter);
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const suggested = [...new Set(history.slice(0, 5).flatMap((item) => item.exercises.map((movement) => movement.exerciseId)))];

  function openNew(status: WorkoutStatus) {
    setEditor({ status, date: filter ?? dateKey() });
  }

  return <View style={{ gap: 14 }}>
    <PageTitle title="Workouts" summary="Schedule your sessions and keep a record of what you trained."
      action={<View style={styles.actions}>
        <Button icon={Check} onPress={() => openNew('completed')}>Log workout</Button>
        <Button icon={Plus} kind="primary" onPress={() => openNew('planned')}>Schedule workout</Button>
      </View>} />

    <Panel style={{ padding: narrow ? 12 : 17, gap: 12 }}>
      <SectionTitle title={formatDay(week, { month: 'long', year: 'numeric' })} action={<View style={styles.actions}>
        <IconButton icon={ChevronLeft} label="Previous week" onPress={() => { setWeek(addDays(week, -7)); setFilter(null); }} />
        <IconButton icon={ChevronRight} label="Next week" onPress={() => { setWeek(addDays(week, 7)); setFilter(null); }} />
      </View>} />
      <View style={{ flexDirection: 'row', gap: narrow ? 4 : 8 }}>
        {days.map((day) => {
          const total = (tab === 'planned' ? planned : history).filter((item) => item.date === day).length;
          return <DayCell key={day} date={day} active={filter === day} total={total} onPress={() => setFilter(filter === day ? null : day)} />;
        })}
      </View>
    </Panel>

    <View style={[styles.actions, { justifyContent: 'space-between', marginTop: 6 }]}>
      <View style={styles.actions}>
        <Chip label={`Schedule (${planned.length})`} selected={tab === 'planned'} onPress={() => setTab('planned')} />
        <Chip label={`History (${history.length})`} selected={tab === 'completed'} onPress={() => setTab('completed')} />
      </View>
      {filter && <Button compact kind="quiet" onPress={() => setFilter(null)}>Show all dates</Button>}
    </View>

    {rows.length === 0 ? <Empty icon={tab === 'planned' ? CalendarDays : History}
      title={tab === 'planned' ? 'No scheduled workouts' : 'No workout logs'}
      message={filter ? `Nothing saved for ${formatDay(filter)}.` : 'Add a workout to get started.'}
      action={<Button kind="primary" icon={Plus} onPress={() => openNew(tab)}>{tab === 'planned' ? 'Schedule workout' : 'Log workout'}</Button>} />
      : rows.map((workout) => <Panel key={workout.id} style={styles.workout}>
        <View style={{ flexDirection: 'row', gap: 11, alignItems: 'center' }}>
          <View style={styles.workoutIcon}>{workout.status === 'planned' ? <Dumbbell color={color.green} size={22} /> : <Check color={color.green} size={22} />}</View>
          <View style={{ flex: 1, gap: 2 }}>
            <Copy accessibilityRole="header" size={17} weight="bold">{workout.name}</Copy>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <Clock3 size={13} color={color.muted} />
              <Copy size={12} tone={color.muted}>{workoutDay(workout.date)} · {formatTime(workout.time)}</Copy>
            </View>
          </View>
          <Tag style={{ backgroundColor: workout.status === 'completed' ? color.limeSoft : color.soft }}>
            {workout.status === 'completed' ? 'Completed' : 'Planned'}
          </Tag>
        </View>
        <View style={{ gap: 6 }}>
          {workout.exercises.map(({ exerciseId, sets, reps }) => {
            const exercise = data.catalog.find((item) => item.id === exerciseId);
            return <View key={exerciseId} style={styles.movement}>
              <Copy size={13} style={{ flex: 1 }}>{exercise?.name ?? exerciseId}</Copy>
              <Copy size={12} tone={color.muted}>{sets} × {reps}{exercise?.unit === 'seconds' ? ' sec' : ' reps'}</Copy>
            </View>;
          })}
        </View>
        <View style={styles.actions}>
          <Button compact icon={Pencil} onPress={() => setEditor({ initial: workout, status: workout.status, date: workout.date })} accessibilityLabel={`Edit ${workout.name}`}>Edit workout</Button>
          {workout.status === 'planned' && <Button compact kind="primary" icon={Check}
            accessibilityLabel={`Log ${workout.name}`}
            onPress={() => setEditor({ initial: workout, status: 'completed', date: workout.date })}>Log as completed</Button>}
        </View>
      </Panel>)}

    {addExercise && <Sheet title={`Add ${addExercise.name} to a workout`} detail="Choose a scheduled workout or start a new one." onClose={() => setAddExercise(null)}>
      {planned.map((workout) => (
        <Button key={workout.id} icon={CalendarDays} onPress={() => {
          setEditor({ initial: workout, preset: addExercise, status: 'planned', date: workout.date });
          setAddExercise(null);
        }}>{workout.name + ' · ' + workoutDay(workout.date)}</Button>
      ))}
      <Button icon={Plus} kind="primary" onPress={() => {
        setEditor({ preset: addExercise, status: 'planned', date: dateKey() });
        setAddExercise(null);
      }}>Start a new workout</Button>
    </Sheet>}

    {editor && <WorkoutEditor {...editor} catalog={data.catalog} suggested={suggested} onClose={() => setEditor(null)}
      onSave={async (workout, existing) => {
        await mutate(() => api.saveWorkout(workout, existing));
        setTab(workout.status);
        setWeek(weekStart(workout.date));
        setFilter(null);
        setEditor(null);
        announce(workout.status === 'completed' ? 'Workout logged.' : 'Workout saved to your schedule.');
      }}
      onDelete={async (id) => {
        await mutate(() => api.deleteWorkout(id));
        setEditor(null);
        announce('Workout deleted.');
      }} />}
  </View>;
}

function DayCell({ date, active, total, onPress }: { date: string; active: boolean; total: number; onPress: () => void }) {
  const weekday = formatDay(date, { weekday: 'short' });
  const today = date === dateKey();
  return <View style={{ flex: 1, minWidth: 0 }}>
    <Button
      accessibilityLabel={`${formatDay(date)}${today ? ', today' : ''}, ${total} ${total === 1 ? 'workout' : 'workouts'}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      kind={active ? 'dark' : today ? 'primary' : 'outline'}
      style={{ alignSelf: 'stretch', paddingHorizontal: 2 }}
      compact
    >{weekday.slice(0, 2) + ' ' + asDate(date).getDate()}</Button>
    <Copy size={10} tone={color.muted} style={{ textAlign: 'center', marginTop: 2 }}>{total ? String(total) : '·'}</Copy>
  </View>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  workout: { padding: 14, gap: 11 },
  workoutIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', backgroundColor: color.limeSoft, borderRadius: 9 },
  movement: { borderTopWidth: 1, borderColor: color.line, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 6 },
});
