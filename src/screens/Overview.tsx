import { Link, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronRight, MessageSquare, Play, Plus, ScanLine, Sparkles } from 'lucide-react-native';
import { buildTodayPlan } from '../../shared/today-plan.mjs';
import { createId } from '../api';
import { exercisePhotos, hero } from '../assets';
import { useActiveSession } from '../activeSession';
import { addDays, compareWorkoutTime, formatDay, formatTime, workoutDay, workoutTime } from '../dates';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { TrainingCheckIn, useCheckIns } from '../components/TrainingCheckIn';
import { emptyPreferences } from '../components/TrainingPreferences';
import { Button, Copy, Display, Notice, Panel, SectionTitle, Tag } from '../components/ui';
import { useTrainingNavigation } from '../navigation';
import { useProfiles } from '../profiles';
import { color } from '../theme';
import { completedWorkouts, movementSummary } from '../trainingProgress';
import type { Exercise, Workout } from '../types';
import { useLocalClock } from '../useLocalClock';
import { useWorkspace } from '../workspace';

export function Overview() {
  const { api, data, exerciseRecords, mutate, announce } = useWorkspace();
  const router = useRouter();
  const training = useTrainingNavigation();
  const { width } = useWindowDimensions();
  const split = width >= 1050;
  const showPhoto = width >= 740;
  const now = useLocalClock();
  const [selected, setSelected] = useState<Exercise | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [loadingExamples, setLoadingExamples] = useState(false);
  const [exampleError, setExampleError] = useState('');
  const { session: paused } = useActiveSession();
  const { state, save, busy } = useProfiles();
  const profile = state?.active;
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [preferSuggestion, setPreferSuggestion] = useState(false);
  const [intakeError, setIntakeError] = useState('');
  const current = workoutTime(now);
  const today = current.date;
  const journal = useCheckIns(today);
  const catalog = data?.catalog;
  const workouts = data?.workouts;
  const equipment = data?.equipment;
  const timingDay = current.date;
  const timingTime = current.time;
  const preferences = profile?.details.trainingPreferences;
  const suggestion = useMemo(() => catalog && workouts && buildTodayPlan({
    current: { date: timingDay, time: timingTime }, catalog, workouts, equipment: equipment ?? null,
    preferences, adjustment: journal.state?.adjustment,
  }), [catalog, workouts, equipment, preferences, timingDay, timingTime, journal.state?.adjustment]);
  if (!data || !suggestion) return null;

  const next = data.workouts.find((item) => item.status === 'planned' && compareWorkoutTime(item, current) >= 0);
  const todayPlan = data.workouts.find((item) => item.status === 'planned' && item.date === today && !item.example);
  const overdue = data.workouts.filter((item) => item.status === 'planned' && compareWorkoutTime(item, current) < 0).length;
  const completed = completedWorkouts(data.workouts, current);
  const scheduled = todayPlan && !completed.some(({ date }) => date === today) && journal.state?.adjustment !== 'rest' ? todayPlan : undefined;
  const recommendationReady = Boolean(journal.state);
  const canCompare = Boolean(scheduled && recommendationReady && suggestion.kind === 'train');
  const plan = paused?.plan ?? (preferSuggestion && canCompare ? undefined : scheduled);
  const lastTrainer = completed.find(({ source }) => source === 'trainer');
  const isSuggestion = !plan && recommendationReady && suggestion.kind === 'train';
  const movements = (plan?.exercises ?? (isSuggestion ? suggestion.exercises : [])).flatMap((movement) => {
    const exercise = exerciseRecords.get(movement.exerciseId);
    return exercise ? [{ exercise, movement }] : [];
  });
  const detailKey = plan?.id ?? (isSuggestion ? 'suggested-' + today : 'empty');
  const open = details === detailKey;

  function startSuggestion() {
    if (!suggestion || suggestion.kind !== 'train') return;
    const plan: Workout = { ...current, id: createId(), name: suggestion.name, source: 'recommended',
      status: 'planned', exercises: suggestion.exercises };
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
  const featured = [...data.catalog].sort((a, b) => Number(data.bookmarks.includes(b.id)) - Number(data.bookmarks.includes(a.id))).slice(0, 3);

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
      <View style={{ gap: 4, flexShrink: 1 }}>
        <Display accessibilityRole="header" aria-level={1} size={width < 570 ? 46 : 66}>Training overview</Display>
        <Copy tone={color.muted} size={14}>Your next step between trainer sessions.</Copy>
      </View>
      <Copy size={12} weight="medium" tone={color.muted}>
        {formatDay(today, { weekday: 'long', month: 'long', day: 'numeric' })}
      </Copy>
    </View>

    <View style={[styles.split, split && { flexDirection: 'row', alignItems: 'flex-start' }]}>
      <View style={[styles.primary, split && { flex: 1.85 }]}>
        <View style={styles.feature}>
          {showPhoto && <>
            <Image aria-hidden source={hero} resizeMode="cover" style={styles.photo} />
            {Platform.OS === 'web' && <div aria-hidden className="liftmorrow-feature-shade" />}
          </>}
          <View style={[styles.featureBody, showPhoto && { width: '64%' }]}>
            <View style={styles.eyebrow}>
              {paused ? <Play aria-hidden size={15} color={color.accent} /> : plan
                ? <CalendarDays aria-hidden size={15} color={color.accent} /> : <Sparkles aria-hidden size={15} color={color.accent} />}
              <Copy accessibilityRole="header" aria-level={2} size={12} weight="semibold" tone={color.onInk}>
                {paused ? 'Current session' : plan ? 'On your schedule today' : 'Today’s suggestion'}
              </Copy>
            </View>
            <Display size={width < 570 ? 39 : 50} tone={color.surface}>
              {plan?.name ?? (recommendationReady ? suggestion.name : journal.error ? 'Suggestion unavailable' : 'Getting today ready…')}
            </Display>
            <Copy size={13} tone={color.onInk}>{paused ? 'Paused in this tab' : plan
              ? `${formatTime(plan.time)} · ${movements.length} ${movements.length === 1 ? 'exercise' : 'exercises'}`
              : recommendationReady ? suggestion.summary : journal.error ? 'Refresh to check for your latest training adjustments.' : 'Checking your recent training.'}</Copy>
            <View style={styles.featureActions}>
              {paused ? <Button kind="primary" icon={Play} onPress={() => training.open({ type: paused.adHoc ? 'resume-session' : 'resume' })}>Resume session</Button>
                : plan ? <Button kind="primary" icon={Play} onPress={() => training.open({ type: 'train', workoutId: plan.id })}>Start session</Button>
                : isSuggestion ? <Button kind="primary" icon={Play} onPress={startSuggestion}>Start suggested session</Button>
                : journal.error && !recommendationReady ? <Button kind="primary" onPress={journal.refresh}>Retry suggestion</Button>
                : recommendationReady ? <Button kind="primary" icon={MessageSquare} onPress={() => setCheckInOpen(true)}>Open check-in</Button> : null}
            </View>
          </View>
        </View>

        {!plan && recommendationReady && <View style={styles.reason}>
          <Copy weight="semibold" size={12}>Why this today</Copy>
          {suggestion.reasons.map((reason) => <Copy key={reason} size={12} tone={color.muted}>{reason}</Copy>)}
        </View>}
        <View style={styles.featureFooter}>
          {movements.length > 0 && <Button kind="quiet" compact end={ChevronDown} aria-expanded={open} onPress={() => setDetails(open ? null : detailKey)}>
            {open ? 'Hide workout details' : 'Workout details'}
          </Button>}
          {!paused && <Button kind="quiet" compact icon={Plus} onPress={() => training.open({ type: 'new-session' })}>Log a session</Button>}
          <Button kind="quiet" compact icon={MessageSquare} onPress={() => setCheckInOpen(true)}>Training check-in</Button>
          {!paused && canCompare && <Button kind="quiet" compact icon={Sparkles} onPress={() => setPreferSuggestion(!preferSuggestion)}>
            {preferSuggestion ? 'Show scheduled workout' : 'Show suggested session'}
          </Button>}
          <Button kind="quiet" compact end={ArrowRight} onPress={() => router.push('/workouts')}>View schedule</Button>
          <Button kind="quiet" compact end={ArrowRight} onPress={() => router.push('/sessions')}>View sessions</Button>
        </View>
        {movements.length > 0 && open && <View style={styles.details}>
          {movements.map(({ exercise, movement }) => <Pressable key={exercise.id} accessibilityRole="button"
            onPress={() => setSelected(exercise)} style={({ hovered }) => [styles.movement, hovered && { backgroundColor: color.soft }]}>
            <Image aria-hidden source={exercisePhotos[exercise.id]} style={styles.thumb} />
            <Copy size={13} weight="semibold" style={{ flex: 1 }}>{exercise.name}</Copy>
            <Copy size={12} tone={color.muted} style={{ flexShrink: 1, textAlign: 'right' }}>{movementSummary(exercise, movement)}</Copy>
            <ChevronRight aria-hidden size={15} color={color.plum} />
          </Pressable>)}
          {plan && scheduled && !paused && <View style={styles.detailActions}>
            <Button compact icon={Check} onPress={() => training.open({ type: 'log-plan', workoutId: scheduled.id })}>Log this workout</Button>
            <Button compact onPress={() => training.open({ type: 'edit', workoutId: scheduled.id })}>Edit schedule</Button>
          </View>}
        </View>}
      </View>

      <View style={[styles.secondary, split && { flex: 1 }]}>
        <Panel style={styles.week}>
          <SectionTitle title="Last 7 days" />
          {completed.length > 0 ? <>
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
          </> : <Copy size={13} tone={color.muted}>Log a workout to see your training activity here.</Copy>}
          <View style={styles.weekFooter}>
            <View>
              <Copy size={12} weight="semibold">{completed.length}</Copy>
              <Copy size={11} tone={color.muted}>Workouts logged</Copy>
            </View>
            <Button kind="quiet" compact end={ArrowRight} onPress={() => router.push('/progress')}>View progress</Button>
          </View>
        </Panel>
        {lastTrainer && <Panel style={styles.trainer}>
          <SectionTitle title="Last trainer session" />
          <Copy size={14} weight="semibold">{lastTrainer.name}</Copy>
          <Copy size={12} tone={color.muted}>{formatDay(lastTrainer.date)}{lastTrainer.effort ? ` · Effort ${lastTrainer.effort}/10` : ''}</Copy>
          {!!lastTrainer.notes && <Copy size={12} numberOfLines={2} tone={color.muted}>{lastTrainer.notes}</Copy>}
          <Button compact kind="quiet" end={ArrowRight} onPress={() => router.push({ pathname: '/sessions', params: { session: lastTrainer.id } })}>
            View trainer session
          </Button>
        </Panel>}
        <Link href="/form-review" asChild>
          <Pressable accessibilityRole="link" style={styles.review}>
            <View aria-hidden style={styles.reviewIcon}><ScanLine color={color.plum} size={21} /></View>
            <View style={{ flex: 1, gap: 1 }}>
              <Copy weight="semibold" size={14}>Review your form</Copy>
              <Copy size={12} tone={color.muted}>Upload a training clip</Copy>
            </View>
            <ArrowUpRight aria-hidden size={18} color={color.plum} />
          </Pressable>
        </Link>
      </View>
    </View>

    {next && plan?.id !== next.id && <Panel style={styles.intake}>
      <View style={{ gap: 4, flexShrink: 1 }}>
        <Copy size={12} weight="semibold" tone={color.plum}>Next on your schedule{next.example ? ' · Sample workout' : ''}</Copy>
        <Copy size={15} weight="bold">{next.name}</Copy>
        <Copy size={12} tone={color.muted}>{workoutDay(next.date, today)} · {formatTime(next.time)}</Copy>
      </View>
      <Button compact kind="quiet" end={ArrowRight} onPress={() => router.push('/workouts')}>Open schedule</Button>
    </Panel>}

    {!preferences && <Panel style={styles.intake}>
      <View style={{ gap: 4, flexShrink: 1 }}>
        <Copy size={15} weight="semibold">What are you working on?</Copy>
        <Copy size={13} tone={color.muted}>Add your goals and trainer’s guidance so future sessions fit you.</Copy>
        {intakeError && <Notice error>{intakeError}</Notice>}
      </View>
      <View style={styles.detailActions}>
        <Button compact end={ArrowRight} onPress={() => router.push('/profile')}>Set up training</Button>
        <Button compact kind="quiet" disabled={busy} onPress={() => void skipIntake()}>Skip for now</Button>
      </View>
    </Panel>}

    {overdue > 0 && <View style={styles.overdue}>
      <Copy size={12} tone={color.muted}>{overdue === 1 ? '1 past workout is still on your schedule.' : `${overdue} past workouts are still on your schedule.`}</Copy>
    </View>}

    <View style={styles.library}>
      <SectionTitle title="Exercise library" action={<Button end={ArrowRight} kind="quiet" compact onPress={() => router.push('/explore')}>Explore exercises</Button>} />
      <View style={[styles.featured, width >= 780 && { flexDirection: 'row' }]}>
        {featured.map((exercise) => <Pressable key={exercise.id} accessibilityRole="button" onPress={() => setSelected(exercise)}
          style={({ hovered }) => [styles.exercise, hovered && { backgroundColor: color.soft }]}>
          <Image aria-hidden source={exercisePhotos[exercise.id]} style={styles.exerciseImage} resizeMode="cover" />
          <View style={{ flex: 1, gap: 1 }}>
            <Copy size={13} weight="semibold">{exercise.name}</Copy>
            <Copy size={11} tone={color.muted}>{exercise.muscles[0]} · {exercise.equipment.join(' + ') || 'Bodyweight'}</Copy>
          </View>
          <ArrowUpRight aria-hidden size={16} color={color.plum} />
        </Pressable>)}
      </View>
    </View>

    <View style={styles.utility}>
      {data.workouts.length === 0 && <Button compact kind="quiet" disabled={loadingExamples} onPress={loadExamples}>
        {loadingExamples ? 'Adding samples…' : 'Load sample workouts'}
      </Button>}
      <Link href="/photo-credits" style={{ alignSelf: 'center' }}>
        <Copy size={12} tone={color.muted} style={{ textDecorationLine: 'underline' }}>Photo credits</Copy>
      </Link>
    </View>
    {exampleError && <Notice error>{exampleError}</Notice>}
    {checkInOpen && <TrainingCheckIn key={today} journal={journal} currentTime={current.time} onClose={() => setCheckInOpen(false)} />}
    {selected && <ExerciseSheet exercise={selected} onClose={() => setSelected(null)} />}
  </View>;
}

const styles = StyleSheet.create({
  page: { gap: 24 },
  intro: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 },
  split: { gap: 20 },
  primary: { minWidth: 0, backgroundColor: color.surface, borderRadius: 14, borderColor: color.line, borderWidth: 1, overflow: 'hidden' },
  feature: { position: 'relative', minHeight: 260, justifyContent: 'center', backgroundColor: color.ink },
  featureBody: { gap: 11, padding: 27, minWidth: 0 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureActions: { marginTop: 5, alignItems: 'flex-start' },
  photo: { position: 'absolute', right: 0, top: 0, bottom: 0, height: '100%', width: '39%', opacity: 0.88 },
  reason: { gap: 4, paddingHorizontal: 17, paddingVertical: 12, backgroundColor: color.tint },
  intake: { padding: 16, gap: 10, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' },
  featureFooter: { paddingHorizontal: 15, paddingVertical: 9, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 4 },
  details: { paddingHorizontal: 16, paddingBottom: 14, gap: 5 },
  movement: { flexDirection: 'row', alignItems: 'center', minHeight: 40, gap: 8, borderTopWidth: 1, borderColor: color.line, paddingHorizontal: 2 },
  thumb: { width: 34, height: 26, borderRadius: 4, backgroundColor: color.soft },
  detailActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingTop: 5 },
  secondary: { gap: 12, minWidth: 0 },
  trainer: { gap: 5, alignItems: 'flex-start', padding: 14 },
  week: { padding: 17, gap: 11 },
  count: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  days: { flexDirection: 'row', gap: 3 },
  dayColumn: { alignItems: 'center', gap: 5, flex: 1, minWidth: 0 },
  day: { width: '100%', maxWidth: 34, height: 29, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: color.soft },
  dayActive: { backgroundColor: color.plum },
  dayDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: color.faint },
  today: { borderWidth: 1, borderColor: color.plum },
  weekFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 7, borderTopWidth: 1, borderColor: color.line, paddingTop: 7 },
  overdue: { marginTop: -10 },
  review: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 66, borderWidth: 1,
    borderColor: color.line, borderRadius: 10, backgroundColor: color.tint },
  reviewIcon: { width: 36, height: 36, borderRadius: 7, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  library: { gap: 10, borderTopWidth: 1, borderColor: color.line, paddingTop: 10 },
  featured: { gap: 8 },
  exercise: { flexDirection: 'row', flex: 1, minWidth: 0, alignItems: 'center', gap: 9, padding: 8, minHeight: 62,
    borderWidth: 1, borderColor: color.line, borderRadius: 10, backgroundColor: color.surface },
  exerciseImage: { width: 55, height: 43, borderRadius: 6, backgroundColor: color.soft },
  utility: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, minHeight: 35 },
});
