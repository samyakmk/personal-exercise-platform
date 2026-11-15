import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowRight, CalendarDays, ChartNoAxesColumnIncreasing, ChevronDown, ChevronUp, Clock3, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { MuscleHeatMap } from '../components/MuscleHeatMap';
import { Button, Chip, Copy, Display, Empty, PageTitle, Panel, SectionTitle } from '../components/ui';
import { addDays, formatDay, formatTime, workoutTime } from '../dates';
import { useTrainingNavigation } from '../navigation';
import { ExercisePicker } from '../platform/ExercisePicker';
import { color } from '../theme';
import { completedWorkouts, exerciseLogs, exerciseTrend, heaviestLoad, movementSummary, performedSetSummary, weeklyActivity } from '../trainingProgress';
import type { ExerciseTrend } from '../trainingProgress';
import type { Exercise, Workout } from '../types';
import { useLocalClock } from '../useLocalClock';
import { useWorkspace } from '../workspace';

export function Progress() {
  const { data, exerciseRecords } = useWorkspace();
  const training = useTrainingNavigation();
  const router = useRouter();
  const { exercise: requested, session: requestedSession } = useLocalSearchParams<{ exercise?: string; session?: string }>();
  const now = useLocalClock();
  const split = useWindowDimensions().width >= 1230;
  if (!data) return null;

  const current = workoutTime(now);
  const workouts = completedWorkouts(data.workouts, current);
  const session = workouts.find(({ id }) => id === requestedSession);
  const loggedIds = new Set(workouts.flatMap(({ exercises }) => exercises.map(({ exerciseId }) => exerciseId)));
  const options = [...data.catalog, ...(data.archivedExercises ?? []).filter(({ id }) => loggedIds.has(id))]
    .map(({ id, name }) => ({ value: id, label: name }));
  const requestedId = options.find(({ value }) => value === requested)?.value;
  const orderedOptions = [...options].sort((a, b) => Number(loggedIds.has(b.value)) - Number(loggedIds.has(a.value)))
    .map(({ value, label }) => ({ value, label, detail: loggedIds.has(value) ? 'Logged' : undefined }));
  const initialId = requestedId ?? workouts.find(({ exercises }) => exercises.length)?.exercises[0].exerciseId ?? options[0]?.value;
  const exercise = initialId && exerciseRecords.get(initialId);

  return <View style={styles.page}>
    <PageTitle title="Training progress" summary="See which muscles you trained and look back at your workouts."
      action={<Button kind="primary" icon={Plus} onPress={() => training.open({ type: 'new-session' })}>New session</Button>} />
    <MuscleActivity key={requestedSession ?? 'recent'} workouts={workouts} catalog={exerciseRecords}
      today={current.date} session={session} missingSession={Boolean(requestedSession && !session)} />
    {!workouts.length && !requestedId ? <Empty icon={ChartNoAxesColumnIncreasing} title="Your first workout goes here"
      message="Log a completed workout to see your weekly activity and exercise history."
      /> : <View style={[styles.progressLayout, split && styles.progressSplit]}>
      {workouts.length > 0 && <View style={split ? styles.activityColumn : undefined}>
        <WeeklyActivity workouts={workouts} today={current.date} />
      </View>}
      {exercise && <View style={[styles.exerciseColumn, split && { flex: 1.65 }]}>
        <View style={styles.picker}>
          <ExercisePicker label="Exercise history" value={exercise.id} options={orderedOptions}
            onChange={(id) => router.setParams({ exercise: id })} />
        </View>
        <ExerciseHistory key={exercise.id} exercise={exercise} workouts={workouts} />
      </View>}
    </View>}
  </View>;
}

function MuscleActivity({ workouts, catalog, today, session, missingSession }: {
  workouts: Workout[]; catalog: ReadonlyMap<string, Exercise>; today: string; session?: Workout; missingSession: boolean;
}) {
  const [range, setRange] = useState<'session' | 7 | 30>(session ? 'session' : 7);
  const selectedSession = range === 'session' ? session : undefined;
  const days = range === 30 ? 30 : 7;
  const from = addDays(today, 1 - days);
  const selection = selectedSession ? [selectedSession] : workouts.filter(({ date }) => date >= from);
  const label = selectedSession
    ? `${selectedSession.name} · ${formatDay(selectedSession.date)}`
    : `${formatDay(from, { month: 'short', day: 'numeric' })} – ${formatDay(today, { month: 'short', day: 'numeric' })} · ${selection.length} completed ${selection.length === 1 ? 'workout' : 'workouts'}`;

  return <Panel style={styles.panel}>
    <SectionTitle title="Muscle heat map" summary={label} action={
      <View role="group" accessibilityLabel="Muscle heat map period" style={styles.period}>
        {session && <Chip label="This session" selected={range === 'session'} onPress={() => setRange('session')} />}
        <Chip label="Past 7 days" selected={range === 7} onPress={() => setRange(7)} />
        <Chip label="Past 30 days" selected={range === 30} onPress={() => setRange(30)} />
      </View>
    } />
    {missingSession && <Copy tone={color.muted} size={13}>The requested session is no longer available.</Copy>}
    <MuscleHeatMap workouts={selection} catalog={catalog} />
  </Panel>;
}

function WeeklyActivity({ workouts, today }: { workouts: Workout[]; today: string }) {
  const weeks = weeklyActivity(workouts, today, 6);
  const max = Math.max(1, ...weeks.map(({ sessions }) => sessions));
  const total = weeks.reduce((sum, { sessions }) => sum + sessions, 0);
  const short = useWindowDimensions().width < 550;

  return <Panel style={styles.panel}>
    <SectionTitle title="Weekly activity" />
    <View style={styles.activityTotal}>
      <Display size={54}>{String(total)}</Display>
      <Copy size={13} tone={color.muted}>{total === 1 ? 'workout' : 'workouts'} logged in six weeks</Copy>
    </View>
    <View role="list" accessibilityLabel="Workouts by week" style={[styles.chart, short && { gap: 5 }]}>
      {weeks.map(({ start, sessions }, index) => {
        const label = formatDay(start, { month: 'short', day: 'numeric' });
        const current = index === weeks.length - 1;
        const description = `Week of ${label}${current ? ', current week' : ''}, ${sessions} ${sessions === 1 ? 'workout' : 'workouts'}`;
        return <View key={start} role="listitem" accessibilityLabel={sessions ? undefined : description} style={styles.column}>
          <View aria-hidden style={styles.plot}>
            <Copy weight="bold" size={13}>{sessions}</Copy>
            <View style={[styles.bar, {
              height: Math.max(4, sessions / max * 82),
              backgroundColor: !sessions ? color.soft : current ? color.accent : color.plum,
              ...(sessions > 0 && current && { borderWidth: 1, borderColor: color.plum }),
            }]} />
          </View>
          {sessions > 0 ? <Link asChild href={{ pathname: '/workouts', params: { view: 'history', week: start, scope: 'week', logged: '1' } }}>
            <Pressable accessibilityRole="link" accessibilityLabel={`${label} · View workout history, ${description}`} style={styles.weekLink}>
              <Copy size={short ? 10 : 12} tone={color.plum} style={{ textAlign: 'center', textDecorationLine: 'underline' }}>{label}</Copy>
            </Pressable>
          </Link> : <View style={styles.weekLink}>
            <Copy aria-hidden size={short ? 10 : 12} tone={color.muted} style={{ textAlign: 'center' }}>{label}</Copy>
          </View>}
        </View>;
      })}
    </View>
  </Panel>;
}

function ExerciseHistory({ exercise, workouts }: { exercise: Exercise; workouts: Workout[] }) {
  const training = useTrainingNavigation();
  const [limit, setLimit] = useState(8);
  const [expanded, setExpanded] = useState<string | null>(null);
  const logs = exerciseLogs(workouts, exercise.id);
  const load = heaviestLoad(logs);
  const trend = exerciseTrend(logs, exercise);

  return <Panel style={styles.panel}>
    <SectionTitle title={exercise.name} summary={logs.length
      ? `${logs.length} ${logs.length === 1 ? 'session' : 'sessions'} logged`
      : 'No completed sessions for this exercise yet.'} />
    {logs.length ? <>
      <View style={styles.facts}>
        <Fact label="Latest session" value={movementSummary(exercise, logs[0].movement)} />
        {load && <Fact label={exercise.loadType === 'per-dumbbell' ? 'Heaviest logged dumbbell' : 'Heaviest logged weight'}
          value={`${load.value} ${load.unit}`} />}
      </View>
      {trend.points.length >= 2 && <TrendChart {...trend} />}
      <View role="list" accessibilityLabel={`${exercise.name} sessions`}>
        {logs.slice(0, limit).map(({ workout, movement }) => {
          const open = expanded === workout.id;
          return <View key={workout.id} role="listitem" style={styles.session}>
            <View style={styles.sessionRow}>
              <View style={styles.sessionIcon}><CalendarDays size={17} color={color.plum} /></View>
              <View style={styles.sessionName}>
                <Copy weight="semibold" size={14}>{workout.name}</Copy>
                <Copy size={12} tone={color.muted}>{formatDay(workout.date, { month: 'short', day: 'numeric', year: 'numeric' })} · {formatTime(workout.time)}</Copy>
              </View>
              <Copy size={13} style={styles.movement}>{movementSummary(exercise, movement)}</Copy>
              {Boolean(movement.setDetails?.length) && <Button kind="quiet" compact end={open ? ChevronUp : ChevronDown} aria-expanded={open}
                accessibilityLabel={`${open ? 'Hide' : 'Show'} sets · ${workout.name}`}
                onPress={() => setExpanded(open ? null : workout.id)}>{open ? 'Hide sets' : 'Show sets'}</Button>}
              <Button kind="quiet" compact end={ArrowRight} accessibilityLabel={`Open workout · ${workout.name}`}
                onPress={() => training.open({ type: 'edit', workoutId: workout.id })}>Open</Button>
            </View>
            {open && movement.setDetails && <View role="list" accessibilityLabel={`Sets for ${workout.name}`} style={styles.sets}>
              {movement.setDetails.map((set, index) => <View key={index} role="listitem" style={styles.set}>
                <Copy size={12} weight="semibold">{`Set ${index + 1}`}</Copy>
                <Copy size={12} tone={color.muted}>{performedSetSummary(exercise, set)}</Copy>
              </View>)}
            </View>}
          </View>;
        })}
      </View>
      {logs.length > limit && <Button onPress={() => setLimit((value) => value + 8)}>Show older sessions</Button>}
    </> : <Button compact icon={Clock3} onPress={() => training.open({ type: 'log', exerciseId: exercise.id })}>{`Log ${exercise.name}`}</Button>}
  </Panel>;
}

function TrendChart({ measurement, points, unit }: { measurement: string; points: ExerciseTrend[]; unit: string }) {
  const max = Math.max(...points.map(({ value }) => value));
  const short = useWindowDimensions().width < 620;
  const numbers = new Intl.NumberFormat('en-US', { maximumFractionDigits: unit === 'kg' || unit === 'lb' ? 1 : 0 });
  return <View style={{ gap: 6, paddingTop: 6 }}>
    <Copy accessibilityRole="header" aria-level={3} size={14} weight="bold">{measurement}</Copy>
    <View role="list" accessibilityLabel={`${measurement} across recent sessions`} style={[styles.chart, short && { gap: 3 }]}>
      {points.map(({ workout, value }, index) => {
        const label = formatDay(workout.date, { month: 'short', day: 'numeric' });
        const last = index === points.length - 1;
        return <View key={workout.id} role="listitem" style={styles.column}
          accessibilityLabel={`${workout.name}, ${label}, ${formatTime(workout.time)}, ${numbers.format(value)} ${unit}`}>
          <View aria-hidden style={[styles.plot, { height: 85 }]}>
            <Copy weight="semibold" size={short ? 10 : 12}>{numbers.format(value)}</Copy>
            <View style={[styles.bar, { height: Math.max(3, value / max * 60), backgroundColor: last ? color.accent : color.plum },
              last && { borderWidth: 1, borderColor: color.plum }]} />
          </View>
          {(!short || points.length <= 4 || index === 0 || last) && <Copy aria-hidden size={short ? 9 : 11} tone={color.muted}
            style={{ textAlign: 'center' }}>{label}</Copy>}
        </View>;
      })}
    </View>
  </View>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <View style={styles.fact}>
    <Copy size={12} tone={color.muted}>{label}</Copy>
    <Copy size={17} weight="bold">{value}</Copy>
  </View>;
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  progressLayout: { gap: 17 },
  progressSplit: { flexDirection: 'row', alignItems: 'flex-start' },
  activityColumn: { flex: 1, minWidth: 0 },
  exerciseColumn: { gap: 12, minWidth: 0 },
  panel: { padding: 18, gap: 13 },
  period: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  activityTotal: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  picker: { width: '100%', maxWidth: 380 },
  chart: { flexDirection: 'row', gap: 14, paddingTop: 4 },
  column: { flex: 1, minWidth: 0, gap: 7, alignItems: 'stretch' },
  weekLink: { minHeight: 24, justifyContent: 'center', borderRadius: 7 },
  plot: { height: 110, gap: 3, alignItems: 'center', justifyContent: 'flex-end', borderBottomWidth: 1, borderColor: color.line },
  bar: { width: '65%', minWidth: 16, maxWidth: 62, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 17 },
  fact: { borderLeftWidth: 2, borderColor: color.control, paddingHorizontal: 10, paddingVertical: 4, gap: 2 },
  session: { gap: 8, borderTopWidth: 1, borderColor: color.line, paddingVertical: 8 },
  sessionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  sessionIcon: { width: 33, height: 33, borderRadius: 7, backgroundColor: color.soft, alignItems: 'center', justifyContent: 'center' },
  sessionName: { flex: 1, minWidth: 128 },
  movement: { flexShrink: 1 },
  sets: { gap: 6, borderRadius: 8, backgroundColor: color.canvas, padding: 9 },
  set: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
});
