import { Link, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ArrowRight, Check, ChevronDown, ChevronRight, ChevronUp, Dumbbell, MessageCircle, MessageSquare, Play, Plus, ScanLine, Sparkles } from 'lucide-react-native';
import { buildTodayPlan } from '../../shared/today-plan.mjs';
import { createId } from '../api';
import { exercisePhotos } from '../assets';
import { useActiveSession } from '../activeSession';
import { addDays, compareWorkoutTime, formatDay, formatTime, workoutDay, workoutTime } from '../dates';
import { EquipmentSheet } from '../components/EquipmentSheet';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { RefinementControls } from '../components/RecommendationControls';
import { TrainingCheckIn, useCheckIns } from '../components/TrainingCheckIn';
import { TrainingDial } from '../components/TrainingDial';
import { emptyPreferences } from '../components/TrainingPreferences';
import { Button, Copy, Display, EditorialTitle, Label, Notice, Panel, SectionTitle } from '../components/ui';
import { useTrainingNavigation } from '../navigation';
import { useProfiles } from '../profiles';
import { color, radius } from '../theme';
import { completedWorkouts, movementSummary } from '../trainingProgress';
import type { Exercise, Refinement, Workout } from '../types';
import { useLocalClock } from '../useLocalClock';
import { useWorkspace } from '../workspace';
import { lighterPlannedWorkout, refineWorkout, workoutSize } from '../workoutRefinement';

export function Overview() {
  const { api, data, exerciseRecords, mutate, announce } = useWorkspace();
  const router = useRouter();
  const training = useTrainingNavigation();
  const { width } = useWindowDimensions();
  const split = width >= 1100;
  const fullDial = width >= 1280;
  const now = useLocalClock();
  const [selected, setSelected] = useState<Exercise | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [equipmentOpen, setEquipmentOpen] = useState<'saved' | 'session'>();
  const [sessionEquipment, setSessionEquipment] = useState<{ day: string; items: string[] }>();
  const [loadingExamples, setLoadingExamples] = useState(false);
  const [exampleError, setExampleError] = useState('');
  const { session: paused } = useActiveSession();
  const { state, save, busy } = useProfiles();
  const profile = state?.active;
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [preferSuggestion, setPreferSuggestion] = useState(false);
  const [adjusted, setAdjusted] = useState<{ key: string } & ReturnType<typeof refineWorkout>>();
  const [intakeError, setIntakeError] = useState('');
  const current = workoutTime(now);
  const today = current.date;
  const journal = useCheckIns(today);
  const catalog = data?.catalog;
  const workouts = data?.workouts;
  const temporaryGear = sessionEquipment?.day === today ? sessionEquipment.items : undefined;
  const equipment = temporaryGear ?? data?.equipment;
  const trainingNotes = data?.trainingNotes;
  const timingDay = current.date;
  const timingTime = current.time;
  const preferences = profile?.details.trainingPreferences;
  const suggestion = useMemo(() => catalog && workouts && buildTodayPlan({
    current: { date: timingDay, time: timingTime }, catalog, workouts, equipment: equipment ?? null,
    preferences, trainingNotes, adjustment: journal.state?.adjustment,
  }), [catalog, workouts, equipment, preferences, trainingNotes, timingDay, timingTime, journal.state?.adjustment]);
  if (!data || !suggestion) return null;

  const next = data.workouts.find((item) => item.status === 'planned' && compareWorkoutTime(item, current) >= 0);
  const todayPlan = data.workouts.find((item) => item.status === 'planned' && item.date === today && !item.example);
  const overdue = data.workouts.filter((item) => item.status === 'planned' && compareWorkoutTime(item, current) < 0).length;
  const completed = completedWorkouts(data.workouts, current);
  const scheduled = todayPlan;
  const recommendationReady = Boolean(journal.state);
  const canCompare = Boolean(scheduled && recommendationReady && suggestion.kind === 'train');
  const plan = paused?.plan ?? (preferSuggestion && canCompare ? undefined : scheduled);
  const planReadiness = plan && !paused && recommendationReady ? suggestion.readiness : 'usual';
  const missingGear = temporaryGear && plan && !paused
    ? [...new Set(plan.exercises.flatMap(({ exerciseId }) => exerciseRecords.get(exerciseId)?.equipment ?? []))]
      .filter((item) => !temporaryGear.includes(item)) : [];
  const lastTrainer = completed.find(({ source }) => source === 'trainer');
  const isSuggestion = !plan && recommendationReady && suggestion.kind === 'train';
  const suggestionKey = JSON.stringify([today, suggestion]);
  const refined = adjusted?.key === suggestionKey ? adjusted : undefined;
  const suggestedExercises = refined?.exercises ?? suggestion.exercises;
  const equipmentVersion = plan && !paused && missingGear.length && canCompare ? suggestedExercises : undefined;
  const lighterExercises = planReadiness === 'lighter' && plan ? lighterPlannedWorkout(plan.exercises, exerciseRecords) : undefined;
  const adjustedPlan = equipmentVersion || lighterExercises;
  const movements = (adjustedPlan ?? plan?.exercises ?? (isSuggestion ? suggestedExercises : [])).flatMap((movement) => {
    const exercise = exerciseRecords.get(movement.exerciseId);
    return exercise ? [{ exercise, movement }] : [];
  });
  const detailKey = plan?.id ?? (isSuggestion ? 'suggested-' + today : 'empty');
  const open = details === detailKey;
  const featureTitle = plan?.name ?? (recommendationReady ? suggestion.name : journal.error ? 'Suggestion unavailable' : 'Getting today ready…');
  const showFeatureActions = Boolean(plan || recommendationReady || journal.error);

  function refineSuggestion(choice: Refinement) {
    setAdjusted({ key: suggestionKey, ...refineWorkout(suggestedExercises, choice, exerciseRecords) });
  }

  function startSuggestion() {
    if (!suggestion || suggestion.kind !== 'train') return;
    const plan: Workout = { ...current, id: createId(), name: suggestion.name, source: 'recommended',
      status: 'planned', exercises: suggestedExercises };
    training.open({ type: 'recommended-session', plan });
  }

  async function skipIntake() {
    if (!profile || busy) return;
    setIntakeError('');
    try {
      await save(profile.workspaceKey, { displayName: profile.details.displayName ?? '', trainingGoal: profile.details.trainingGoal ?? '',
        trainingPreferences: emptyPreferences });
    } catch (error) {
      setIntakeError((error as Error).message);
    }
  }

  const lastSeven = completed.filter(({ date }) => date >= addDays(today, -6));
  const byDate = new Map<string, number>();
  for (const { date } of lastSeven) byDate.set(date, (byDate.get(date) ?? 0) + 1);

  async function loadExamples() {
    setLoadingExamples(true);
    setExampleError('');
    try {
      await mutate(api.addExampleWorkouts);
      announce('Sample workouts added.');
    } catch (error) {
      setExampleError((error as Error).message);
    } finally {
      setLoadingExamples(false);
    }
  }

  return <View style={styles.page}>
    <View style={styles.intro}>
      <EditorialTitle accessibilityRole="header" aria-level={1} size={width < 570 ? 39 : 51} title="Training overview" />
      <Label tone={color.muted} style={styles.date}>
        {formatDay(today, { weekday: 'long', month: 'long', day: 'numeric' })}
      </Label>
    </View>

    <View style={[styles.split, split && { flexDirection: 'row', alignItems: 'flex-start' }]}>
      <View style={[styles.primary, split && { flex: 1.95 }]}>
        <View nativeID="trainer-plus-overview-feature" style={styles.feature}>
          <TrainingDial compact={!fullDial} />
          <View style={[styles.featureBody, split && styles.featureBodyWide]}>
            <Label tone={color.accent}>
              {paused ? 'Current session' : plan ? 'On your schedule today' : 'Today’s suggestion'}
            </Label>
            <EditorialTitle accessibilityRole="header" aria-level={2} title={featureTitle}
              size={width < 570 ? 40 : split ? 64 : 58} tone={color.surface} emphasisTone={color.accent} />
            <Copy tone={color.onInk}>{paused ? 'Paused on this device' : plan
              ? `${formatTime(plan.time)} · ${movements.length} ${movements.length === 1 ? 'exercise' : 'exercises'}`
              : recommendationReady ? isSuggestion ? workoutSize(suggestedExercises) : suggestion.reasons[0]
              : journal.error ? 'Refresh to check for your latest training adjustments.' : 'Checking your recent training.'}</Copy>
            {showFeatureActions && <View style={styles.featureActions}>
              {paused ? <Button kind="primary" icon={Play} onPress={() => training.open({ type: paused.adHoc ? 'resume-session' : 'resume' })}>Resume session</Button>
                : plan && planReadiness === 'rest' ? <Button kind="primary" onPress={() => training.open({ type: 'edit', workoutId: plan.id })}>Reschedule workout</Button>
                : plan && adjustedPlan ? <Button kind="primary" icon={Play}
                  onPress={() => training.open({ type: 'train', workoutId: plan.id, exercises: adjustedPlan })}>
                  {equipmentVersion ? 'Start equipment-matched version' : 'Start lighter version'}
                </Button>
                : plan ? <Button kind="primary" icon={Play} onPress={() => training.open({ type: 'train', workoutId: plan.id })}>Start session</Button>
                : isSuggestion ? <Button kind="primary" icon={Play} onPress={startSuggestion}>Start suggested session</Button>
                : journal.error && !recommendationReady ? <Button kind="primary" onPress={journal.refresh}>Retry suggestion</Button>
                : recommendationReady ? <Button kind="primary" icon={MessageSquare} onPress={() => setCheckInOpen(true)}>Training check-in</Button> : null}
              {movements.length > 0 && <Button kind="inverse" end={open ? ChevronUp : ChevronDown} aria-expanded={open}
                onPress={() => setDetails(open ? null : detailKey)}>Workout details</Button>}
            </View>}
          </View>
        </View>
        {isSuggestion && movements.length > 0 && <View style={styles.adjustments}>
          <RefinementControls onRefine={refineSuggestion} />
          {refined && <Notice action={<Button compact kind="quiet" onPress={() => setAdjusted(undefined)}>Reset</Button>}>{refined.message}</Notice>}
        </View>}
        {plan && scheduled && !paused && movements.length > 0 && <View style={[styles.adjustments, styles.detailActions]}>
          {(planReadiness !== 'usual' || missingGear.length > 0) && <View style={{ width: '100%' }}>
            <Notice>{planReadiness === 'rest' ? suggestion.reasons[0] : equipmentVersion
              ? `Your scheduled workout needs ${missingGear.join(', ')}. This version uses what you have today.`
              : planReadiness === 'lighter' ? `${suggestion.reasons[0]} The lighter version has ${workoutSize(lighterExercises ?? [])} and leaves load for you to choose.`
              : `Your scheduled workout needs ${missingGear.join(', ')}.`}</Notice>
          </View>}
          {(planReadiness !== 'usual' || adjustedPlan) && <Button compact kind="quiet" onPress={() => training.open({ type: 'train', workoutId: scheduled.id })}>
            Start original workout
          </Button>}
          <Button compact kind="quiet" icon={Check} onPress={() => training.open({ type: 'log-plan', workoutId: scheduled.id })}>Log this workout</Button>
          <Button compact kind="quiet" onPress={() => training.open({ type: 'edit', workoutId: scheduled.id })}>Edit schedule</Button>
        </View>}
        {movements.length > 0 && open && <View style={styles.details}>
          <SectionTitle title={paused ? 'Session exercises' : adjustedPlan ? 'Adjusted workout preview' : 'Workout preview'} level={3} />
          {movements.map(({ exercise, movement }) => <Pressable key={exercise.id} accessibilityRole="button"
            onPress={() => setSelected(exercise)} style={({ hovered }) => [styles.movement, hovered && { backgroundColor: color.soft }]}>
            <Image aria-hidden source={exercisePhotos[exercise.id]} style={styles.thumb} />
            <Copy size={14} weight="semibold" style={{ flex: 1 }}>{exercise.name}</Copy>
            <Copy size={12} tone={color.muted} style={{ flexShrink: 1, textAlign: 'right' }}>{movementSummary(exercise, movement)}</Copy>
            <ChevronRight aria-hidden size={15} color={color.forest} />
          </Pressable>)}
          {isSuggestion && <View style={styles.reason}>
            <Copy size={13} weight="semibold">Why this workout</Copy>
            {suggestion.reasons.map((reason) => <Copy key={reason} size={13} tone={color.muted}>{reason}</Copy>)}
          </View>}
        </View>}

        <View style={styles.featureFooter}>
          <View style={styles.footerActions}>
            {!paused && <Button compact kind="quiet" icon={Plus} onPress={() => training.open({ type: 'new-session' })}>Log a session</Button>}
            {!paused && <Button compact kind="quiet" icon={Dumbbell} onPress={() => setEquipmentOpen('session')}>Equipment for today</Button>}
            {(plan || isSuggestion || !recommendationReady) && <Button compact kind="quiet" icon={MessageSquare} onPress={() => setCheckInOpen(true)}>Training check-in</Button>}
            {!paused && canCompare && <Button compact kind="quiet" icon={Sparkles} onPress={() => setPreferSuggestion(!preferSuggestion)}>
              {preferSuggestion ? 'Show scheduled workout' : 'Show suggested session'}
            </Button>}
          </View>
          {temporaryGear && !paused && <Copy size={13} tone={color.muted}>
            {`This suggestion uses ${temporaryGear.length ? temporaryGear.join(', ') : 'bodyweight only'}.`}
          </Copy>}
          {overdue > 0 && <Copy size={13} tone={color.muted} style={styles.scheduleNote}>
            {overdue === 1 ? '1 past workout is still on your schedule.' : `${overdue} past workouts are still on your schedule.`}
          </Copy>}
        </View>
      </View>

      <View style={[styles.secondary, split && { flex: 1 }]}>
        {!preferences && <Panel style={styles.intake}>
          <SectionTitle title="Personalize your suggestions" summary="Choose training priorities or save your equipment." />
          <View style={styles.detailActions}>
            <Button compact end={ArrowRight} onPress={() => router.push({ pathname: '/profile', params: { from: 'overview' } })}>Set up training</Button>
            <Button compact kind="quiet" icon={Dumbbell} onPress={() => setEquipmentOpen('saved')}>My equipment</Button>
            <Button compact kind="quiet" disabled={busy} onPress={() => void skipIntake()}>Skip for now</Button>
          </View>
          {intakeError && <Notice error>{intakeError}</Notice>}
        </Panel>}
        {next && plan?.id !== next.id && <Panel style={styles.intake}>
          <SectionTitle title={next.example ? 'Next on your schedule · Sample workout' : 'Next on your schedule'} />
          <Copy size={15} weight="semibold">{next.name}</Copy>
          <Copy size={13} tone={color.muted}>{workoutDay(next.date, today)} · {formatTime(next.time)}</Copy>
          <Button compact kind="quiet" end={ArrowRight} onPress={() => router.push('/workouts')}>Open schedule</Button>
        </Panel>}
        {completed.length > 0 && <Panel style={styles.week}>
          <SectionTitle title="Last 7 days" />
            <View style={styles.count}>
              <Display size={57}>{lastSeven.length}</Display>
              <Copy size={13} tone={color.muted}>{lastSeven.length === 1 ? 'workout' : 'workouts'} completed</Copy>
            </View>
            <View role="list" accessibilityLabel="Training over the last seven days" style={styles.days}>
              {Array.from({ length: 7 }, (_, index) => {
                const day = addDays(today, index - 6);
                const count = byDate.get(day) ?? 0;
                return <View key={day} role="listitem"
                  accessibilityLabel={`${formatDay(day)}, ${count ? `${count} ${count === 1 ? 'workout' : 'workouts'} logged` : 'no workout'}`}
                  style={styles.dayColumn}>
                  <View aria-hidden style={[styles.day, count > 0 && styles.dayActive, day === today && styles.today]}>
                    {count > 0 ? <Check size={14} color={color.surface} strokeWidth={2.5} /> : <View style={styles.dayDot} />}
                  </View>
                  <Copy aria-hidden size={10} tone={color.muted}>{formatDay(day, { weekday: 'short' }).slice(0, 2)}</Copy>
                </View>;
              })}
            </View>
          <Button kind="quiet" compact end={ArrowRight} onPress={() => router.push('/progress')}>View progress</Button>
        </Panel>}
        {lastTrainer && <Panel style={styles.trainer}>
          <SectionTitle title="Last trainer session" />
          <Copy size={14} weight="semibold">{lastTrainer.name}</Copy>
          <Copy size={12} tone={color.muted}>{formatDay(lastTrainer.date)}{lastTrainer.effort ? ` · Effort ${lastTrainer.effort}/10` : ''}</Copy>
          {!!lastTrainer.notes && <Copy size={12} numberOfLines={2} tone={color.muted}>{lastTrainer.notes}</Copy>}
          <Button compact kind="quiet" end={ArrowRight} onPress={() => router.push({ pathname: '/sessions', params: { session: lastTrainer.id } })}>
            View trainer session
          </Button>
        </Panel>}
        <Panel style={styles.shortcuts}>
          {data.aiAvailable && <Link href="/chat" asChild>
            <Pressable accessibilityRole="link" dataSet={{ workspaceShortcut: 'true' }} style={styles.shortcut}>
              <MessageCircle aria-hidden color={color.forest} size={20} />
              <Copy weight="semibold" style={{ flex: 1 }}>Ask about your training</Copy>
              <ArrowRight aria-hidden size={17} color={color.forest} />
            </Pressable>
          </Link>}
          <Link href="/form-review" asChild>
            <Pressable accessibilityRole="link" dataSet={{ workspaceShortcut: 'true' }} style={styles.shortcut}>
              <ScanLine aria-hidden color={color.forest} size={20} />
              <Copy weight="semibold" style={{ flex: 1 }}>Review your form</Copy>
              <ArrowRight aria-hidden size={17} color={color.forest} />
            </Pressable>
          </Link>
        </Panel>
        <View style={styles.utility}>
          {data.workouts.length === 0 && <Button compact kind="quiet" disabled={loadingExamples} onPress={loadExamples}>
            {loadingExamples ? 'Adding samples…' : 'Load sample workouts'}
          </Button>}
          <Link href="/photo-credits" asChild>
            <Pressable accessibilityRole="link" style={styles.creditLink}>
              <Copy size={12} tone={color.muted} style={styles.creditText}>Photo credits</Copy>
            </Pressable>
          </Link>
        </View>
        {exampleError && <Notice error>{exampleError}</Notice>}
      </View>
    </View>

    {equipmentOpen && <EquipmentSheet onClose={() => setEquipmentOpen(undefined)}
      temporary={equipmentOpen === 'session' ? { value: temporaryGear, onChange: (items) => setSessionEquipment(items ? { day: today, items } : undefined) } : undefined} />}
    {checkInOpen && <TrainingCheckIn key={today} journal={journal} currentTime={current.time} onClose={() => setCheckInOpen(false)} />}
    {selected && <ExerciseSheet exercise={selected} onClose={() => setSelected(null)} />}
  </View>;
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  intro: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 14, rowGap: 3 },
  date: { paddingBottom: 2 },
  split: { gap: 16 },
  primary: { minWidth: 0, backgroundColor: color.surface, borderRadius: radius.panel, borderColor: color.line, borderWidth: 1 },
  feature: { backgroundColor: color.ink, borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel, overflow: 'hidden' },
  featureBody: { gap: 10, paddingHorizontal: 20, paddingVertical: 20, minWidth: 0 },
  featureBodyWide: { paddingHorizontal: 28, paddingVertical: 24 },
  featureActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  reason: { gap: 4, marginTop: 7 },
  intake: { padding: 17, gap: 9 },
  featureFooter: { borderTopWidth: 1, borderColor: color.line, paddingHorizontal: 9, paddingVertical: 5 },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  scheduleNote: { paddingHorizontal: 10, paddingBottom: 6 },
  adjustments: { paddingHorizontal: 17, paddingVertical: 12, gap: 8 },
  details: { padding: 17, gap: 9, borderTopWidth: 1, borderColor: color.line },
  movement: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 9, borderTopWidth: 1, borderColor: color.line, paddingHorizontal: 2 },
  thumb: { width: 39, height: 31, borderRadius: 4, backgroundColor: color.soft },
  detailActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  secondary: { gap: 10, minWidth: 0 },
  trainer: { gap: 5, alignItems: 'flex-start', padding: 17 },
  week: { padding: 17, gap: 8 },
  count: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  days: { flexDirection: 'row', gap: 3 },
  dayColumn: { alignItems: 'center', gap: 5, flex: 1, minWidth: 0 },
  day: { width: '100%', maxWidth: 34, height: 29, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: color.soft },
  dayActive: { backgroundColor: color.forest },
  dayDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: color.faint },
  today: { borderWidth: 1, borderColor: color.forest },
  shortcuts: { paddingHorizontal: 6, paddingVertical: 2 },
  shortcut: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10, minHeight: 48 },
  utility: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 2 },
  creditLink: { minHeight: 39, paddingHorizontal: 10, justifyContent: 'center', borderRadius: radius.control },
  creditText: { textDecorationLine: 'underline' },
});
