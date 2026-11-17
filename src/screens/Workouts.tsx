import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Dumbbell, History, Pencil, Play, Plus, Repeat2, Search, SearchX, X } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { newTrainingSession, useActiveSession } from '../activeSession';
import { createId } from '../api';
import { addDays, asDate, compareWorkoutTime, dateKey, earliestWorkoutDate, formatDay, formatTime, isWorkoutDate, latestWorkoutDate, weekStart, workoutDay, workoutTime } from '../dates';
import { SessionHeatMapLink } from '../components/MuscleHeatMap';
import { Sheet } from '../components/Sheet';
import { TrainingBackup } from '../components/TrainingBackup';
import { TrainingSession } from '../components/TrainingSession';
import { WorkoutEditor } from '../components/WorkoutEditor';
import type { WorkoutDraft } from '../components/WorkoutEditor';
import { Button, Copy, Display, Empty, IconButton, Input, Notice, PageTitle, Panel, SectionTitle, Tag, ViewTab, VisuallyHidden } from '../components/ui';
import { useTrainingNavigation } from '../navigation';
import { DownloadLink } from '../platform/DownloadLink';
import { DateTimeField } from '../platform/fields';
import { readWorkoutDraft, removeWorkoutDraft, writeWorkoutDraft } from '../platform/workoutDraft';
import { color, radius } from '../theme';
import { completedWorkouts, movementSummary } from '../trainingProgress';
import type { Exercise, Movement, Workout, WorkoutStatus } from '../types';
import { useLocalClock } from '../useLocalClock';
import { useWorkspace } from '../workspace';
import { useSaveWorkout } from '../useSaveWorkout';

type Editor = { initial?: Workout; preset?: Exercise; status: WorkoutStatus; date: string; copy?: boolean; draft?: WorkoutDraft; keepDraft?: boolean;
  seriesExpected?: { id: string; revision: number }[] };

function futureOccurrences(initial: Workout, workouts: Workout[]) {
  if (!initial.seriesId || initial.seriesIndex === undefined) return undefined;
  return workouts.filter((item) => item.seriesId === initial.seriesId && item.status === 'planned'
    && (item.seriesIndex ?? -1) >= initial.seriesIndex! && item.revision !== undefined)
    .sort((a, b) => a.seriesIndex! - b.seriesIndex!)
    .map(({ id, revision }) => ({ id, revision: revision! }));
}

export function Workouts() {
  const { api, data, exerciseRecords: exercises, mutate, announce, reload } = useWorkspace();
  const { intent, clear, open } = useTrainingNavigation();
  const router = useRouter();
  const { view, week, day, scope, logged } = useLocalSearchParams<{
    view?: string; week?: string; day?: string; scope?: string; logged?: string;
  }>();
  const tab: WorkoutStatus = view === 'history' ? 'completed' : 'planned';
  const weekOnly = scope === 'week';
  const loggedOnly = tab === 'completed' && logged === '1';
  const [jumpDate, setJumpDate] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [limit, setLimit] = useState(12);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [skipCandidate, setSkipCandidate] = useState<Workout | null>(null);
  const [skipStatus, setSkipStatus] = useState({ busy: false, error: '' });
  const seriesOperation = useRef<{ key: string; id: string }>(null);
  const [addExercise, setAddExercise] = useState<Exercise | null>(null);
  const [addLimit, setAddLimit] = useState(10);
  const [removingExamples, setRemovingExamples] = useState(false);
  const [examplesError, setExamplesError] = useState('');
  const [storedDraft, setStoredDraft] = useState<WorkoutDraft | null>(null);
  const { session, keepSession } = useActiveSession();
  const saveWorkout = useSaveWorkout();
  const [sessionOpen, setSessionOpen] = useState(false);
  const [nextPlan, setNextPlan] = useState<Workout | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [expandedWorkout, setExpandedWorkout] = useState<string | null>(null);
  const workspaceKey = data?.workspaceKey;
  const firstWeek = weekStart(earliestWorkoutDate);
  const lastWeek = weekStart(latestWorkoutDate);
  useEffect(() => { setStoredDraft(workspaceKey ? readWorkoutDraft(workspaceKey) : null); }, [workspaceKey]);
  useEffect(() => {
    setSessionOpen(false);
    setNextPlan(null);
    setConfirmDiscard(false);
  }, [workspaceKey]);
  const draft = storedDraft && !data?.workouts.some(({ id }) => id === storedDraft.id) ? storedDraft : null;
  const keepDraft = useCallback((value: WorkoutDraft) => {
    if (!workspaceKey) return;
    writeWorkoutDraft(workspaceKey, value);
    setStoredDraft(value);
  }, [workspaceKey]);
  useEffect(() => {
    if (workspaceKey && storedDraft && !draft) {
      removeWorkoutDraft(workspaceKey);
      setStoredDraft(null);
    }
  }, [workspaceKey, storedDraft, draft]);
  function clearDraft() {
    if (workspaceKey) removeWorkoutDraft(workspaceKey);
    setStoredDraft(null);
  }
  const now = useLocalClock();
  const current = workoutTime(now);
  const today = current.date;
  const thisWeek = weekStart(today);
  const shownWeek = week && isWorkoutDate(week) ? weekStart(week) : thisWeek;
  const dayFilter = day && isWorkoutDate(day) && weekStart(day) === shownWeek ? day : null;
  const nextWeek = addDays(shownWeek, 7);
  const narrow = useWindowDimensions().width < 540;

  useEffect(() => {
    if (!session) setSessionOpen(false);
  }, [session]);

  const startSession = useCallback((plan: Workout) => {
    if (session && session.plan.id !== plan.id) {
      setNextPlan(plan);
      return;
    }
    if (!session) keepSession(newTrainingSession(plan));
    setEditor(null);
    setAddExercise(null);
    setSessionOpen(true);
  }, [keepSession, session]);

  useEffect(() => {
    if (!data || !intent || intent.type === 'review' || intent.type === 'new-session'
      || intent.type === 'resume-session' || intent.type === 'recommended-session') return;
    if (intent.type === 'log') {
      setAddExercise(null);
      const preset = data.catalog.find((item) => item.id === intent.exerciseId);
      setEditor({ preset, status: 'completed', date: dateKey(), keepDraft: !draft });
    } else if (intent.type === 'train') {
      const plan = data.workouts.find(({ id, status }) => id === intent.workoutId && status === 'planned');
      if (plan) startSession(intent.exercises ? { ...plan, exercises: intent.exercises } : plan);
    } else if (intent.type === 'resume') {
      setEditor(null);
      setAddExercise(null);
      setSessionOpen(true);
    } else if (intent.type === 'schedule-template') {
      const initial = data.workouts.find(({ id }) => id === intent.workoutId);
      if (initial) setEditor({ initial, status: 'planned', date: dateKey(), copy: true });
    } else if (intent.type === 'edit' || intent.type === 'log-plan') {
      setAddExercise(null);
      const initial = data.workouts.find((item) => item.id === intent.workoutId);
      if (initial) {
        setEditor(intent.type === 'log-plan' && initial.status === 'planned'
          ? { initial, status: 'completed', date: dateKey() }
          : { initial, status: initial.status, date: initial.date, seriesExpected: futureOccurrences(initial, data.workouts) });
      }
    } else {
      setEditor(null);
      const preset = data.catalog.find((item) => item.id === intent.exerciseId);
      if (preset) { setAddExercise(preset); setAddLimit(10); }
    }
    clear();
  }, [data, intent, clear, draft, startSession]);

  if (!data) return null;

  const planned = data.workouts.filter((item) => item.status === 'planned');
  const history = data.workouts.filter((item) => item.status === 'completed').reverse();
  const scheduled = planned.filter((item) => compareWorkoutTime(item, current) >= 0);
  const past = planned.filter((item) => compareWorkoutTime(item, current) < 0).reverse();
  const terms = tab === 'completed' ? historySearch.trim().toLowerCase().split(/\s+/).filter(Boolean) : [];
  const completed = completedWorkouts(data.workouts, current, loggedOnly || sessionOpen ? undefined : 5);
  const displayed = tab === 'planned' ? [...scheduled, ...past] : loggedOnly ? completed : history;
  const rows = displayed.filter((item) => {
    if (dayFilter ? item.date !== dayFilter : weekOnly && (item.date < shownWeek || item.date >= nextWeek)) return false;
    if (!terms.length) return true;
    const text = [item.name, item.notes, ...item.exercises.map(({ exerciseId }) => exercises.get(exerciseId)?.name ?? exerciseId)]
      .join(' ').toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const visibleRows = rows.slice(0, limit);
  const dayCounts = new Map<string, number>();
  for (const { date } of displayed) dayCounts.set(date, (dayCounts.get(date) ?? 0) + 1);
  const emptyState = terms.length ? {
    icon: SearchX, title: 'No matching workouts',
    message: dayFilter ? `No matches on ${formatDay(dayFilter)}.`
      : weekOnly ? 'Try another search or show workouts from all dates.' : 'Try another workout or exercise name.',
    action: <Button compact onPress={() => setHistorySearch('')}>Clear search</Button>,
  } : {
    icon: tab === 'planned' ? CalendarDays : History,
    title: tab === 'planned' ? 'No scheduled workouts' : 'No workout logs',
    message: dayFilter ? `Nothing saved for ${formatDay(dayFilter)}.`
      : weekOnly ? 'Nothing saved for this week.' : undefined,
  };
  const days = Array.from({ length: 7 }, (_, index) => addDays(shownWeek, index));
  const suggested = [...new Set(completed.slice(0, 5)
    .flatMap((item) => item.exercises.map((movement) => movement.exerciseId)))];
  const recentMovements = new Map<string, Movement>();
  if (sessionOpen) {
    for (const workout of completed) {
      for (const movement of workout.exercises) {
        if (!recentMovements.has(movement.exerciseId)) recentMovements.set(movement.exerciseId, movement);
      }
      if (recentMovements.size === exercises.size) break;
    }
  }
  const originalPlan = session && data.workouts.find(({ id }) => id === session.plan.id);
  const planCurrent = originalPlan?.status === 'planned' && originalPlan.revision === session?.plan.revision;

  function openNew(status: WorkoutStatus) {
    setEditor({ status, date: dayFilter ?? (weekOnly && shownWeek !== thisWeek ? shownWeek : dateKey()), keepDraft: !draft });
  }

  function browseWeek(start: string, onlyWeek = true, date?: string, status = tab) {
    router.setParams({
      week: start === thisWeek ? undefined : start < firstWeek ? earliestWorkoutDate : start > lastWeek ? latestWorkoutDate : start,
      day: date,
      scope: onlyWeek ? 'week' : undefined,
      view: status === 'completed' ? 'history' : undefined,
      ...(onlyWeek ? {} : { logged: undefined }),
    });
    setLimit(12);
  }

  async function removeExamples() {
    setRemovingExamples(true);
    setExamplesError('');
    try {
      await mutate(api.removeExampleWorkouts);
      announce('Sample workouts removed.');
    } catch (error) {
      setExamplesError((error as Error).message);
    } finally {
      setRemovingExamples(false);
    }
  }

  async function skipOccurrence() {
    if (!skipCandidate || skipStatus.busy) return;
    setSkipStatus({ busy: true, error: '' });
    try {
      await mutate(() => api.deleteWorkout(skipCandidate.id, skipCandidate.revision));
      setSkipCandidate(null);
      setSkipStatus({ busy: false, error: '' });
      announce('Workout occurrence skipped.');
    } catch (error) {
      setSkipStatus({ busy: false, error: (error as Error).message });
    }
  }

  return <View style={styles.page}>
    <PageTitle title="Workouts"
      action={tab === 'planned'
        ? <Button icon={Plus} kind="primary" onPress={() => openNew('planned')}>Schedule workout</Button>
        : <Button icon={Check} kind="primary" onPress={() => openNew('completed')}>Log workout</Button>} />

    {data.workouts.some((workout) => workout.example) && <Notice action={
      <Button compact kind="quiet" onPress={removeExamples} disabled={removingExamples}>
        {removingExamples ? 'Removing samples…' : 'Remove sample workouts'}
      </Button>
    }>Sample workouts are marked and excluded from your progress.</Notice>}
    {examplesError && <Notice error>{examplesError}</Notice>}
    {session && !sessionOpen && <Notice action={<View style={styles.actions}>
      <Button compact icon={Play} onPress={() => session.adHoc ? open({ type: 'resume-session' }) : setSessionOpen(true)}>Resume session</Button>
        <Button compact kind="quiet" onPress={() => {
          if (Object.values(session.sets).some((sets) => sets.length)) setConfirmDiscard(true);
          else keepSession(null);
        }}>Discard session</Button>
    </View>}>{`Session in progress · ${session.plan.name}`}</Notice>}
    {draft && !editor && <Notice action={<View style={styles.actions}>
      <Button compact onPress={() => setEditor({ status: draft.status, date: draft.day, draft, keepDraft: true })}>Resume draft</Button>
      <Button compact kind="quiet" onPress={clearDraft}>Discard draft</Button>
    </View>}>An unsaved workout draft is available in this tab.</Notice>}

    <View style={styles.toolbar}>
      {tab === 'completed' ? <View accessibilityLabel="Workout view" role="group" style={styles.actions}>
        <ViewTab label={`Schedule (${planned.length})`} selected={false}
          onPress={() => { router.setParams({ view: undefined, logged: undefined }); setLimit(12); setExpandedWorkout(null); }} />
        <ViewTab label={`History (${loggedOnly ? completed.length : history.length})`} selected
          onPress={() => { router.setParams({ view: 'history' }); setLimit(12); setExpandedWorkout(null); }} />
      </View> : <Link href={{ pathname: '/sessions', params: dayFilter ? { day: dayFilter } : weekOnly ? { week: shownWeek } : {} }}
        asChild><Button kind="quiet" compact icon={History} accessibilityRole="link">Session history</Button></Link>}
    </View>

    <Panel style={[styles.week, narrow && { paddingHorizontal: 10 }]}>
      <SectionTitle title={weekTitle(shownWeek)} action={<View style={[styles.actions, styles.weekActions]}>
        <Button compact kind="quiet" onPress={() => setJumpDate(dayFilter ?? (shownWeek === thisWeek ? today : shownWeek))}>Go to date</Button>
        {shownWeek !== thisWeek && <Button compact kind="quiet" onPress={() => browseWeek(thisWeek)}>This week</Button>}
        <IconButton icon={ChevronLeft} label="Previous week" disabled={shownWeek <= firstWeek}
          onPress={() => browseWeek(addDays(shownWeek, -7))} />
        <IconButton icon={ChevronRight} label="Next week" disabled={shownWeek >= lastWeek} onPress={() => browseWeek(nextWeek)} />
      </View>} />
      <View style={{ flexDirection: 'row', gap: narrow ? 3 : 6 }}>
        {days.map((day) => {
          return <DayCell key={day} date={day} today={today} active={dayFilter === day} total={dayCounts.get(day) ?? 0}
            disabled={!isWorkoutDate(day)} onPress={() => {
              router.setParams({ day: dayFilter === day ? undefined : day });
              setLimit(12);
            }} />;
        })}
      </View>
    </Panel>

    {loggedOnly && <Notice action={<Button compact kind="quiet" onPress={() => {
      router.setParams({ logged: undefined });
      setLimit(12);
    }}>Show all history</Button>}>Showing personal workouts already logged.</Notice>}

    <View style={styles.listHeading}>
      <SectionTitle title={dayFilter ? formatDay(dayFilter) : weekOnly ? 'Workouts this week' : tab === 'planned' ? 'Schedule' : 'Workout history'} />
      {tab === 'completed' && displayed.length > 0 && <View style={styles.search}>
        <Input label="Search workout history" hideLabel icon={Search} value={historySearch} placeholder="Search workout history"
          onChangeText={(value) => { setHistorySearch(value); setLimit(12); }} maxLength={100} />
        {historySearch !== '' && <IconButton icon={X} size={43} label="Clear workout search" onPress={() => setHistorySearch('')} />}
      </View>}
      {dayFilter || weekOnly
        ? <Button compact kind="quiet" onPress={() => { router.setParams({ day: undefined, scope: undefined }); setLimit(12); }}>Show all dates</Button>
        : <Button compact kind="quiet" onPress={() => { router.setParams({ scope: 'week' }); setLimit(12); }}>Show week only</Button>}
    </View>

    {rows.length === 0 && <Empty {...emptyState} />}
    {visibleRows.length > 0 && <Panel style={styles.agenda}>
      {visibleRows.map((workout, index) => {
        const open = expandedWorkout === workout.id;
        const isPlanned = workout.status === 'planned';
        const isPastPlan = isPlanned && compareWorkoutTime(workout, current) < 0;
        const canResume = session?.plan.id === workout.id;
        const count = workout.exercises.length;
        const WorkoutIcon = isPlanned ? Dumbbell : Check;
        return <View key={workout.id} style={index > 0 && styles.agendaBorder}>
          <View style={styles.workout}>
            <View aria-hidden style={styles.workoutIcon}><WorkoutIcon color={color.forest} size={19} /></View>
            <View style={styles.workoutName}>
              <Copy accessibilityRole="header" aria-level={3} size={16} weight="semibold">{workout.name}</Copy>
              <Copy size={12} tone={color.muted}>{workoutDay(workout.date, today)} · {formatTime(workout.time)} · {count} {count === 1 ? 'exercise' : 'exercises'}</Copy>
              {(workout.example || isPastPlan || workout.seriesId) && <View style={styles.workoutTags}>
                {workout.example && <Tag>Sample workout</Tag>}
                {isPastPlan && <Tag>Past scheduled time</Tag>}
                {workout.seriesId && <Tag>{`Weekly series · ${(workout.seriesIndex ?? 0) + 1}`}</Tag>}
              </View>}
            </View>
            <View style={styles.rowActions}>
              {isPlanned && <Button compact kind="outline" icon={Play} accessibilityLabel={`${canResume ? 'Resume' : 'Start'} session · ${workout.name}`}
                onPress={() => startSession(workout)}>{canResume ? 'Resume session' : 'Start session'}</Button>}
              <Button compact kind="quiet" end={open ? ChevronUp : ChevronDown} aria-expanded={open}
                accessibilityLabel={`Details · ${workout.name}`} onPress={() => setExpandedWorkout(open ? null : workout.id)}>Details</Button>
            </View>
          </View>
          <View role="group" accessibilityLabel={`Actions · ${workout.name}`} style={[styles.actions, styles.workoutActions]}>
            <Button compact kind="quiet" icon={Pencil} onPress={() => setEditor({ initial: workout, status: workout.status, date: workout.date,
              seriesExpected: futureOccurrences(workout, data.workouts) })}
              accessibilityLabel={`Edit workout · ${workout.name}`}>Edit workout</Button>
            {isPlanned && <Button compact kind="quiet" icon={Check} accessibilityLabel={`Log as completed · ${workout.name}`}
              onPress={() => setEditor({ initial: workout, status: 'completed', date: today })}>Log as completed</Button>}
            {isPlanned && !workout.example
              && <DownloadLink compact href={api.workoutCalendarUrl(workout.id)} label="Calendar file"
                accessibilityLabel={`Download calendar file · ${workout.name}`} />}
            {isPlanned && !workout.example && workout.id !== session?.plan.id && (workout.seriesId || isPastPlan)
              && <Button compact kind="quiet" accessibilityLabel={`Skip occurrence · ${workout.name}`}
                onPress={() => { setSkipStatus({ busy: false, error: '' }); setSkipCandidate(workout); }}>Skip occurrence</Button>}
            {!isPlanned && <Button compact kind="quiet" icon={Repeat2} accessibilityLabel={`Repeat workout · ${workout.name}`}
              onPress={() => setEditor({ initial: workout, status: 'planned', date: today, copy: true })}>Repeat workout</Button>}
            {!isPlanned && !workout.example && <SessionHeatMapLink workoutId={workout.id} />}
          </View>
          {open && <View style={styles.workoutDetails}>
            <View>
              {workout.exercises.map((movement) => {
                const exercise = exercises.get(movement.exerciseId);
                return <View key={movement.exerciseId} style={styles.movement}>
                  <Copy size={13} style={{ flex: 1 }}>{exercise?.name ?? movement.exerciseId}</Copy>
                  <Copy size={12} tone={color.muted} style={{ flexShrink: 1, textAlign: 'right' }}>
                    {movementSummary(exercise ?? { unit: 'reps' }, movement)}
                  </Copy>
                </View>;
              })}
            </View>
            {workout.notes && <Copy size={13} tone={color.muted}>{workout.notes}</Copy>}
          </View>}
        </View>;
      })}
    </Panel>}
    {visibleRows.length < rows.length && <Button onPress={() => setLimit((value) => value + 12)}>Show more workouts</Button>}
    <Button compact kind="quiet" icon={Archive} onPress={() => setBackupOpen(true)}>Export and backup</Button>
    {skipCandidate && <Sheet title="Skip this occurrence?" detail={`${skipCandidate.name} · ${formatDay(skipCandidate.date)} at ${formatTime(skipCandidate.time)}`}
      onClose={() => { if (!skipStatus.busy) setSkipCandidate(null); }}>
      {skipCandidate.seriesId && <Copy>Later occurrences will stay on your schedule.</Copy>}
      {skipStatus.error && <Notice error>{skipStatus.error}</Notice>}
      <View style={styles.actions}>
        <Button disabled={skipStatus.busy} onPress={() => setSkipCandidate(null)}>Keep occurrence</Button>
        <Button kind="danger" disabled={skipStatus.busy} onPress={() => void skipOccurrence()}>{skipStatus.busy ? 'Skipping…' : 'Skip this occurrence'}</Button>
      </View>
    </Sheet>}
    {jumpDate !== null && <Sheet title="Go to a workout date" onClose={() => setJumpDate(null)}>
      <DateTimeField kind="date" label="Workout date to open" value={jumpDate} min={earliestWorkoutDate} max={latestWorkoutDate} onChange={setJumpDate} />
      <Button kind="primary" disabled={!isWorkoutDate(jumpDate)} onPress={() => {
        browseWeek(weekStart(jumpDate), true, jumpDate);
        setJumpDate(null);
      }}>Show workouts on this date</Button>
    </Sheet>}
    {backupOpen && <TrainingBackup onClose={() => setBackupOpen(false)} />}

    {(nextPlan || confirmDiscard) && session && <Sheet title={nextPlan ? 'Start a different workout?' : 'Discard this session?'}
      detail={`Recorded sets for “${session.plan.name}” are still in progress in this tab.`}
      onClose={() => { setNextPlan(null); setConfirmDiscard(false); }}>
      <View style={styles.actions}>
        <Button onPress={() => { setNextPlan(null); setConfirmDiscard(false); setSessionOpen(true); }}>Resume current session</Button>
        <Button kind="danger" onPress={() => {
          keepSession(nextPlan ? newTrainingSession(nextPlan) : null);
          setSessionOpen(Boolean(nextPlan));
          setNextPlan(null);
          setConfirmDiscard(false);
        }}>{nextPlan ? 'Discard and start new' : 'Discard recorded sets'}</Button>
      </View>
    </Sheet>}

    {session && sessionOpen && <TrainingSession key={session.logId} session={session} catalog={data.catalog} planCurrent={planCurrent}
      onChange={keepSession} onClose={() => setSessionOpen(false)}
      onSave={(workout, sync) => {
        setSessionOpen(false);
        if (sync === 'queued') {
          announce('Workout saved on this device. It will sync when you reconnect.');
          return;
        }
        router.navigate({ pathname: '/sessions', params: { session: workout.id } });
        announce('Workout synced.');
      }} />}

    {addExercise && <Sheet title={`Add ${addExercise.name} to a workout`} detail="Choose a scheduled workout or start a new one." onClose={() => setAddExercise(null)}>
      <Button icon={Plus} kind="primary" onPress={() => {
        setEditor({ preset: addExercise, status: 'planned', date: dateKey(), keepDraft: !draft });
        setAddExercise(null);
      }}>Start a new workout</Button>
      {scheduled.slice(0, addLimit).map((workout) => (
        <Button key={workout.id} icon={CalendarDays} onPress={() => {
          setEditor({ initial: workout, preset: addExercise, status: 'planned', date: workout.date });
          setAddExercise(null);
        }}>{workout.name + ' · ' + workoutDay(workout.date)}</Button>
      ))}
      {scheduled.length > addLimit && <Button compact onPress={() => setAddLimit((limit) => limit + 10)}>Show more scheduled workouts</Button>}
    </Sheet>}

    {editor && <WorkoutEditor {...editor} catalog={data.catalog} suggested={suggested}
      bookmarks={data.bookmarks ?? []}
      onDraftChange={workspaceKey && editor.keepDraft ? keepDraft : undefined}
      onClose={() => { setEditor(null); reload(); }}
      onSave={async (workout, existing, repeatWeeks, editFuture) => {
        if (editFuture && editor.seriesExpected) {
          const expected = editor.seriesExpected;
          const key = JSON.stringify([workspaceKey, workout, expected]);
          const operation = seriesOperation.current?.key === key ? seriesOperation.current : { key, id: createId() };
          seriesOperation.current = operation;
          await mutate(() => api.saveWorkoutSeries(workout, expected, operation.id));
          if (seriesOperation.current === operation) seriesOperation.current = null;
        } else await saveWorkout(workout, existing, repeatWeeks);
        if (workout.status === 'completed' && tab === 'planned' && !editor.initial?.example) {
          router.navigate({ pathname: '/sessions', params: { session: workout.id } });
        } else browseWeek(weekStart(workout.date), false, undefined, workout.status);
        if (draft?.id === workout.id) clearDraft();
        setEditor(null);
        announce(editFuture ? 'Series changes saved.' : workout.status === 'completed' ? 'Workout logged.' : repeatWeeks > 1
          ? `${repeatWeeks} workouts saved to your schedule.` : 'Workout saved to your schedule.');
      }}
      onDelete={async (id, revision) => {
        await mutate(() => api.deleteWorkout(id, revision));
        setEditor(null);
        announce('Workout deleted.');
      }} />}
  </View>;
}

function weekTitle(start: string) {
  const end = addDays(start, 6);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return formatDay(start, { month: 'short', day: 'numeric', ...(!sameYear && { year: 'numeric' }) }) +
    ' – ' + formatDay(end, { month: 'short', day: 'numeric', year: 'numeric' });
}

function DayCell({ date, today, active, total, disabled, onPress }: {
  date: string; today: string; active: boolean; total: number; disabled: boolean; onPress: () => void;
}) {
  const weekday = formatDay(date, { weekday: 'short' });
  const isToday = date === today;
  const dateNumber = asDate(date).getDate();
  return <Pressable
      accessibilityRole="button"
      accessibilityState={Platform.OS === 'web' ? undefined : { selected: active }}
      aria-pressed={Platform.OS === 'web' ? active : undefined}
      onPress={onPress}
      disabled={disabled}
      style={({ hovered }) => [styles.dateCell, { backgroundColor: active ? color.ink : hovered ? color.soft : color.surface,
        borderColor: active ? color.ink : isToday ? color.forest : color.line, opacity: disabled ? 0.5 : 1 }]}
    >
      <Copy size={11} tone={active ? color.onInk : color.muted} weight="medium">{weekday}</Copy>
      <Display size={26} tone={active ? color.surface : color.text}>{String(dateNumber)}</Display>
      <VisuallyHidden>{`${formatDay(date)}${isToday ? ', today' : ''}, ${total} ${total === 1 ? 'workout' : 'workouts'}`}</VisuallyHidden>
      <View aria-hidden style={[styles.dateDot, total > 0 && { backgroundColor: active ? color.accent : color.forest }]} />
    </Pressable>;
}

const styles = StyleSheet.create({
  page: { gap: 15 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', maxWidth: '100%', gap: 7 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
    gap: 5, borderBottomWidth: 1, borderColor: color.line },
  week: { padding: 16, gap: 10 },
  weekActions: { marginLeft: 'auto', justifyContent: 'flex-end' },
  dateCell: { minWidth: 0, flex: 1, paddingVertical: 5, gap: 2, minHeight: 64, borderWidth: 1, borderRadius: radius.control,
    alignItems: 'center', justifyContent: 'center' },
  dateDot: { width: 5, height: 5, borderRadius: 5, backgroundColor: 'transparent' },
  listHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 3 },
  search: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginLeft: 'auto', width: 310, maxWidth: '100%' },
  agenda: { overflow: 'hidden' },
  agendaBorder: { borderTopWidth: 1, borderColor: color.line },
  workout: { paddingHorizontal: 14, paddingTop: 12, gap: 11, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', minHeight: 54 },
  workoutIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: color.tint, borderRadius: radius.control },
  workoutName: { flex: 1, minWidth: 130, gap: 2 },
  workoutTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  rowActions: { maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  workoutActions: { alignItems: 'center', paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  workoutDetails: { gap: 11, paddingVertical: 12, paddingHorizontal: 17, borderTopWidth: 1,
    borderColor: color.line, backgroundColor: color.canvas },
  movement: { paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
});
