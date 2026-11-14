import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, ClipboardList, Dumbbell, Pencil, Play, Plus, RotateCcw, Search, X } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useActiveSession } from '../activeSession';
import { api, createId } from '../api';
import { exercisePhotos } from '../assets';
import { Sheet } from '../components/Sheet';
import { TrainingSession } from '../components/TrainingSession';
import { WorkoutEditor } from '../components/WorkoutEditor';
import type { WorkoutDraft } from '../components/WorkoutEditor';
import { Button, Copy, Display, Empty, IconButton, Input, Notice, PageTitle, Panel, SectionTitle } from '../components/ui';
import { compareWorkoutTime, dateKey, formatDay, formatTime, workoutTime } from '../dates';
import { useTrainingNavigation } from '../navigation';
import { readWorkoutDraft, removeWorkoutDraft, writeWorkoutDraft } from '../platform/workoutDraft';
import { color } from '../theme';
import { completedWorkouts, performedSetSummary } from '../trainingProgress';
import type { Exercise, Movement, Workout } from '../types';
import { useLocalClock } from '../useLocalClock';
import { useSaveWorkout } from '../useSaveWorkout';
import { useWorkspace } from '../workspace';

type Editor = { initial?: Workout; preset?: Exercise; draft?: WorkoutDraft; keepDraft?: boolean; exercisesOnly?: boolean };
type StartChoice = { plan: Workout; adHoc: boolean };
const pageSize = 12;

export function Sessions() {
  const { data, mutate, reload, announce } = useWorkspace();
  const { session, keepSession } = useActiveSession();
  const { intent, clear } = useTrainingNavigation();
  const router = useRouter();
  const { session: requested } = useLocalSearchParams<{ session?: string }>();
  const saveWorkout = useSaveWorkout();
  const now = useLocalClock();
  const current = workoutTime(now);
  const wide = useWindowDimensions().width >= 1000;
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(pageSize);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [confirm, setConfirm] = useState<StartChoice | 'discard' | null>(null);
  const workspaceKey = data?.workspaceKey;
  const [storedDraft, setStoredDraft] = useState<WorkoutDraft | null>(() => workspaceKey ? readWorkoutDraft(workspaceKey, 'session') : null);

  useEffect(() => {
    setStoredDraft(workspaceKey ? readWorkoutDraft(workspaceKey, 'session') : null);
    setEditor(null);
    setTrainingOpen(false);
    setConfirm(null);
  }, [workspaceKey]);

  const draftWorkout = storedDraft && data?.workouts.find(({ id, status }) => id === storedDraft.id && status === 'completed');
  const draft = storedDraft && (draftWorkout ? storedDraft.revision === draftWorkout.revision : storedDraft.revision === undefined)
    ? storedDraft : null;
  const saveDraft = useCallback((value: WorkoutDraft) => {
    if (!workspaceKey) return;
    writeWorkoutDraft(workspaceKey, value, 'session');
    setStoredDraft(value);
  }, [workspaceKey]);

  function clearDraft() {
    if (workspaceKey) removeWorkoutDraft(workspaceKey, 'session');
    setStoredDraft(null);
  }

  const begin = useCallback(({ plan, adHoc }: StartChoice) => {
    keepSession({ plan, ...(adHoc && { adHoc: true }),
      logId: createId(), startedAt: Date.now(), sets: {}, notes: plan.notes ?? '' });
    setTrainingOpen(true);
  }, [keepSession]);

  const start = useCallback((choice: StartChoice) => {
    setEditor(null);
    if (!session) begin(choice);
    else if (!choice.adHoc && session.plan.id === choice.plan.id) setTrainingOpen(true);
    else setConfirm(choice);
  }, [begin, session]);

  useEffect(() => {
    if (!data || !intent) return;
    if (intent.type === 'resume-session') {
      if (session) setTrainingOpen(true);
      else return;
    } else if (intent.type === 'new-session') {
      const preset = data.catalog.find(({ id }) => id === intent.exerciseId);
      setEditor({ preset, keepDraft: !draft });
    } else {
      return;
    }
    clear();
  }, [data, intent, clear, session, draft]);

  useEffect(() => {
    if (!session) setTrainingOpen(false);
  }, [session]);

  if (!data) return null;

  const catalog = new Map(data.catalog.map((exercise) => [exercise.id, exercise]));
  const logs = data.workouts.filter(({ status, example }) => status === 'completed' && !example).reverse();
  const recent = completedWorkouts(data.workouts, current);
  const plans = data.workouts.filter(({ status }) => status === 'planned');
  const nextPlan = plans.find((plan) => compareWorkoutTime(plan, current) >= 0);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = logs.filter((log) => {
    if (!terms.length) return true;
    const text = [log.name, log.notes, ...log.exercises.map(({ exerciseId }) => catalog.get(exerciseId)?.name ?? exerciseId)]
      .join(' ').toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const selected = (requested ? logs.find(({ id }) => id === requested) : undefined) ?? filtered[0];
  const visibleLogs = filtered.slice(0, limit);
  const recentMovements = new Map<string, Movement>();
  for (const workout of trainingOpen ? recent : recent.slice(0, 5)) {
    for (const movement of workout.exercises) {
      if (!recentMovements.has(movement.exerciseId)) recentMovements.set(movement.exerciseId, movement);
    }
    if (recentMovements.size === catalog.size) break;
  }
  const original = session && plans.find(({ id }) => id === session.plan.id);
  const planCurrent = Boolean(original && original.revision === session?.plan.revision);

  function repeat(workout: Workout) {
    const exercises = workout.exercises.map((movement) => {
      const fallback = catalog.get(movement.exerciseId)?.unit === 'seconds' ? 30 : 10;
      return { ...movement, sets: movement.sets || 3, reps: movement.reps ?? fallback,
        setDetails: movement.setDetails?.length ? movement.setDetails.map((set) => ({ ...set, reps: set.reps ?? fallback })) : undefined };
    });
    start({ plan: { ...workout, exercises, id: createId(), status: 'planned', revision: undefined, notes: undefined }, adHoc: true });
  }

  function showSaved(workout: Workout) {
    setQuery('');
    setLimit(pageSize);
    router.setParams({ session: workout.id });
    announce('Session saved.');
  }

  function openExercises(workout: Workout) {
    setEditor({ initial: workout, exercisesOnly: true, draft: draft?.id === workout.id ? draft : undefined,
      keepDraft: !draft || draft.id === workout.id });
  }

  return <View style={styles.page}>
    <PageTitle title="Sessions" summary="Keep track of your sessions, exercises, and sets."
      action={<Button icon={Plus} kind="primary" onPress={() => setEditor({ keepDraft: !draft })}>New session</Button>} />

    {(session || nextPlan) && <View style={styles.feature}>
      <View style={styles.featureBody}>
        <Copy tone={color.onInk} size={12} weight="semibold">{session ? 'In progress' : 'From your schedule'}</Copy>
        <Display size={39} tone={color.surface}>{session?.plan.name ?? nextPlan?.name}</Display>
        <Copy tone={color.onInk} size={13}>
          {session ? `${Object.values(session.sets).reduce((count, sets) => count + sets.length, 0)} sets recorded · saved in this tab`
            : nextPlan && `${formatDay(nextPlan.date)} · ${formatTime(nextPlan.time)} · ${nextPlan.exercises.length} ${nextPlan.exercises.length === 1 ? 'exercise' : 'exercises'}`}
        </Copy>
      </View>
      {session ? <View style={styles.actions}>
        <Button compact icon={Play} onPress={() => setTrainingOpen(true)}>Resume session</Button>
        <Button compact onPress={() => setConfirm('discard')}>Discard active session</Button>
      </View> : nextPlan && <Button icon={Play} onPress={() => start({ plan: nextPlan, adHoc: false })}>Train scheduled workout</Button>}
    </View>}

    {draft && !editor && <Notice action={<View style={styles.actions}>
      <Button compact onPress={() => draftWorkout ? openExercises(draftWorkout) : setEditor({ draft, keepDraft: true })}>Resume session draft</Button>
      <Button compact kind="quiet" onPress={clearDraft}>Discard draft</Button>
    </View>}>{draftWorkout ? `You have unsaved exercise edits for “${draftWorkout.name}” in this tab.` : 'You have an unsaved session draft in this tab.'}</Notice>}

    <View style={styles.logHeading}>
      <SectionTitle title="Session log" summary={`${logs.length} ${logs.length === 1 ? 'session' : 'sessions'} saved`} />
      {(logs.length > 0 || query !== '') && <View style={styles.search}>
        <Input label="Search sessions" hideLabel icon={Search} placeholder="Search by session or exercise"
          value={query} maxLength={100} onChangeText={(value) => {
            setQuery(value);
            setLimit(pageSize);
            if (requested) router.setParams({ session: undefined });
          }} />
        {!!query && <IconButton label="Clear session search" icon={X} size={43} onPress={() => setQuery('')} />}
      </View>}
    </View>

    {requested && !logs.some(({ id }) => id === requested) && <Notice
      action={<Button compact kind="quiet" onPress={() => router.setParams({ session: undefined })}>Dismiss</Button>}>
      This session is unavailable in this workspace.
    </Notice>}

    {filtered.length === 0 && !selected ? <Empty icon={terms.length ? Search : ClipboardList}
      title={terms.length ? 'No matching sessions' : 'No sessions logged yet'}
      message={terms.length ? 'Try another session or exercise name.' : 'Create a session to start your log.'} />
      : <View style={[styles.journal, wide && styles.journalWide]}>
        <View style={[styles.listColumn, wide && { flex: 0.85 }]}>
          <Panel>
            {visibleLogs.map((log, index) => {
              const active = selected?.id === log.id;
              return <Pressable key={log.id} accessibilityRole="button" aria-pressed={active}
                onPress={() => router.setParams({ session: log.id })}
                style={({ hovered }) => [styles.row, index > 0 && styles.divider,
                  active && styles.selectedRow, hovered && !active && { backgroundColor: color.canvas }]}>
                <CalendarDays aria-hidden color={color.plum} size={17} />
                <View style={styles.rowBody}>
                  <Copy weight="semibold" size={14}>{log.name}</Copy>
                  <Copy tone={color.muted} size={12}>{formatDay(log.date)} · {log.exercises.length} {log.exercises.length === 1 ? 'exercise' : 'exercises'}</Copy>
                </View>
                <ArrowRight aria-hidden size={15} color={color.plum} />
              </Pressable>;
            })}
          </Panel>
          {visibleLogs.length < filtered.length && <Button compact onPress={() => setLimit((value) => value + pageSize)}>Show older sessions</Button>}
        </View>
        {selected && <SessionDetails key={selected.id} workout={selected} catalog={catalog}
          onRepeat={() => repeat(selected)}
          onAdd={() => openExercises(selected)}
          onEdit={() => setEditor({ initial: selected, draft: draft?.id === selected.id ? draft : undefined })} />}
      </View>}

    {confirm && session && <Sheet title={confirm === 'discard' ? 'Discard this session?' : 'Start a different session?'}
      detail={`The unsaved sets and inputs for “${session.plan.name}” will be removed.`} onClose={() => setConfirm(null)}>
      <View style={styles.actions}>
        <Button onPress={() => { setConfirm(null); setTrainingOpen(true); }}>Resume current session</Button>
        <Button kind="danger" onPress={() => {
          if (confirm === 'discard') keepSession(null);
          else begin(confirm);
          setConfirm(null);
        }}>{confirm === 'discard' ? 'Discard session' : 'Discard and start new'}</Button>
      </View>
    </Sheet>}

    {session && trainingOpen && <TrainingSession key={session.logId} session={session} catalog={data.catalog}
      recentMovements={recentMovements} planCurrent={planCurrent} onChange={keepSession} onClose={() => setTrainingOpen(false)}
      onSave={async (workout, existing) => {
        await saveWorkout(workout, existing);
        setTrainingOpen(false);
        keepSession(null);
        showSaved(workout);
      }} />}

    {editor && <WorkoutEditor key={editor.initial?.id ?? 'new'} {...editor} mode="session"
      catalog={data.catalog} suggested={[...recentMovements.keys()]} bookmarks={data.bookmarks} status="completed" date={dateKey()}
      onDraftChange={editor.keepDraft ? saveDraft : undefined}
      onClose={() => { setEditor(null); reload(); }}
      onSave={async (workout, existing) => {
        if (!existing) {
          let saved: Workout | undefined;
          await mutate(async () => {
            const change = await api.saveWorkout(workout, false);
            saved = change.workouts.upsert.find(({ id }) => id === workout.id);
            return change;
          });
          if (!saved) throw new Error('Could not open the saved session. Try again.');
          const carriedDraft = editor.draft?.entries.length ? {
            ...editor.draft, name: saved.name, day: saved.date, time: saved.time, notes: saved.notes, revision: saved.revision,
          } : undefined;
          if (carriedDraft) saveDraft(carriedDraft);
          else if (storedDraft?.id === workout.id) clearDraft();
          showSaved(saved);
          setEditor({ initial: saved, preset: editor.preset, exercisesOnly: true, draft: carriedDraft, keepDraft: editor.keepDraft });
          return;
        }
        await saveWorkout(workout, true);
        if (storedDraft?.id === workout.id) clearDraft();
        setEditor(null);
        showSaved(workout);
      }}
      onDelete={async (id, revision) => {
        await mutate(() => api.deleteWorkout(id, revision));
        if (storedDraft?.id === id) clearDraft();
        setEditor(null);
        router.setParams({ session: undefined });
        announce('Session deleted.');
      }} />}
  </View>;
}

function SessionDetails({ workout, catalog, onAdd, onEdit, onRepeat }: {
  workout: Workout; catalog: Map<string, Exercise>; onAdd: () => void; onEdit: () => void; onRepeat: () => void;
}) {
  const sets = workout.exercises.reduce((total, movement) => total + movement.sets, 0);
  return <Panel style={styles.detail}>
    <View style={styles.detailHeading}>
      <View style={styles.rowBody}>
        <Copy tone={color.plum} size={12} weight="semibold">{formatDay(workout.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · {formatTime(workout.time)}</Copy>
        <Display accessibilityRole="header" aria-level={3} size={37}>{workout.name}</Display>
        <Copy tone={color.muted} size={13}>{workout.exercises.length} {workout.exercises.length === 1 ? 'exercise' : 'exercises'} · {sets} {sets === 1 ? 'set' : 'sets'}</Copy>
      </View>
      <View style={styles.actions}>
        {workout.exercises.length > 0 && <Button icon={RotateCcw} kind="quiet" compact onPress={onRepeat}>Train again</Button>}
        <Button icon={Pencil} compact onPress={onEdit}>Edit session</Button>
      </View>
    </View>
    {workout.exercises.length === 0 && <View style={styles.exercise}>
      <Copy tone={color.muted} size={13}>No exercises added yet.</Copy>
      <Button icon={Plus} compact onPress={onAdd}>Add exercises</Button>
    </View>}
    {workout.exercises.map((movement) => {
      const exercise = catalog.get(movement.exerciseId);
      const photo = exercisePhotos[movement.exerciseId];
      const rows = movement.setDetails ?? Array.from({ length: movement.sets }, () => movement);
      return <View key={movement.exerciseId} style={styles.exercise}>
        <View style={styles.exerciseHeading}>
          {photo ? <Image source={photo} aria-hidden style={styles.thumbnail} />
            : <Dumbbell aria-hidden size={19} color={color.plum} />}
          <Copy weight="bold" size={15}>{exercise?.name ?? movement.exerciseId}</Copy>
        </View>
        {rows.length ? <View role="list" accessibilityLabel={`Sets for ${exercise?.name ?? movement.exerciseId}`}>
          {rows.map((set, index) => <View key={index} role="listitem" style={styles.setRow}>
            <Copy size={12} weight="medium" tone={color.muted}>{`Set ${index + 1}`}</Copy>
            <Copy size={13} weight="semibold">{performedSetSummary(exercise, set)}</Copy>
          </View>)}
        </View> : <Copy tone={color.muted} size={12}>No sets recorded.</Copy>}
      </View>;
    })}
    {workout.notes && <View style={styles.notes}>
      <Copy weight="semibold" size={13}>Session notes</Copy>
      <Copy tone={color.muted} size={13}>{workout.notes}</Copy>
    </View>}
  </Panel>;
}

const styles = StyleSheet.create({
  page: { gap: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  feature: { padding: 22, borderRadius: 13, backgroundColor: color.ink, flexDirection: 'row',
    flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  featureBody: { gap: 5, flexShrink: 1, minWidth: 0 },
  logHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 6 },
  search: { flexDirection: 'row', gap: 7, width: 310, maxWidth: '100%' },
  journal: { gap: 14 },
  journalWide: { flexDirection: 'row', alignItems: 'flex-start' },
  listColumn: { minWidth: 0, gap: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 66, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 8 },
  divider: { borderTopWidth: 1, borderColor: color.line },
  selectedRow: { backgroundColor: color.tint },
  rowBody: { flex: 1, minWidth: 100, gap: 3 },
  detail: { flex: 1.45, minWidth: 0, gap: 17, padding: 18 },
  detailHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10 },
  exercise: { gap: 6, borderTopWidth: 1, borderColor: color.line, paddingTop: 12 },
  exerciseHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  thumbnail: { width: 42, height: 33, borderRadius: 5, backgroundColor: color.soft },
  setRow: { minHeight: 32, gap: 8, paddingHorizontal: 8, flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'space-between', alignItems: 'center' },
  notes: { backgroundColor: color.canvas, borderRadius: 8, padding: 10, gap: 4 },
});
