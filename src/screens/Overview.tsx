import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import {
  ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronRight, Clock3, Dumbbell, Plus, Video,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { exercisePhotos, hero } from '../assets';
import { addDays, asDate, dateKey, formatDay, formatTime, workoutDay } from '../dates';
import { ExerciseCard } from '../components/ExerciseCard';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { Button, Copy, Display, Panel, SectionTitle } from '../components/ui';
import { useTrainingNavigation } from '../navigation';
import { color } from '../theme';
import type { Exercise } from '../types';
import { useWorkspace } from '../workspace';

export function Overview() {
  const { data } = useWorkspace();
  const router = useRouter();
  const training = useTrainingNavigation();
  const width = useWindowDimensions().width;
  const wide = width >= 1120;
  const [selected, setSelected] = useState<Exercise | null>(null);
  if (!data) return null;

  const today = dateKey();
  const next = data.workouts.find((item) => item.status === 'planned' && item.date >= today);
  const completed = data.workouts.filter((item) => item.status === 'completed' && item.date <= today);
  const lastSeven = completed.filter((item) => item.date >= addDays(today, -6));
  const activeDates = new Set(lastSeven.map((workout) => workout.date));
  const exerciseCount = new Set(completed.flatMap((item) => item.exercises.map((exercise) => exercise.exerciseId))).size;
  const nextExercises = next?.exercises.flatMap((item) => {
    const exercise = data.catalog.find((entry) => entry.id === item.exerciseId);
    return exercise ? [{ ...item, exercise }] : [];
  }) ?? [];

  return (
    <View style={{ gap: 22 }}>
      <View style={styles.intro}>
        <View style={{ gap: 5, flexShrink: 1, maxWidth: '100%' }}>
          <Display accessibilityRole="header" size={width < 480 ? 44 : 50}>Training overview</Display>
          <Copy tone={color.muted}>Plan your workouts, practice your form, and see your progress.</Copy>
        </View>
        <View style={styles.datePill}>
          <CalendarDays size={15} color={color.green} />
          <Copy size={12} weight="semibold" tone={color.green}>{formatDay(today, { weekday: 'long', month: 'long', day: 'numeric' })}</Copy>
        </View>
      </View>

      <View style={[styles.hero, { minHeight: width < 600 ? 257 : 276 }]}>
        <Image source={hero} resizeMode="cover" style={[StyleSheet.absoluteFill, { width: '100%' }, width < 600 ? { height: '100%', opacity: 0.45 } : { aspectRatio: 2.81, bottom: undefined }]} />
        <View style={{ gap: 12, maxWidth: 410 }}>
          <Display size={width < 600 ? 54 : 69} tone={color.white} style={{ letterSpacing: -0.8, lineHeight: width < 600 ? 50 : 61 }}>
            Find your{ '\n' }<Copy size={width < 600 ? 54 : 69} tone={color.lime} weight="display" style={{ lineHeight: width < 600 ? 50 : 61 }}>next exercise.</Copy>
          </Display>
          <Copy tone="#e1e9dd" size={14}>Filter by target muscles and available equipment.</Copy>
          <Button kind="primary" end={ArrowRight} onPress={() => router.push('/explore')}>Explore exercises</Button>
        </View>
      </View>

      <View style={[styles.metrics, width < 520 && { gap: 6 }]}>
        <Metric icon={Dumbbell} label="Workouts logged" value={completed.length} narrow={width < 520} />
        <Metric icon={CalendarDays} label="Sessions in 7 days" value={lastSeven.length} narrow={width < 520} />
        <Metric icon={Check} label="Exercises practiced" value={exerciseCount} narrow={width < 520} />
      </View>

      <View style={[styles.split, wide && { flexDirection: 'row', alignItems: 'stretch' }]}>
        <Panel style={[styles.schedule, wide && { flex: 1.55 }]}>
          <SectionTitle title="Next workout" action={<Button kind="quiet" end={ArrowRight} compact onPress={() => router.push('/workouts')}>View schedule</Button>} />
          {next ? <>
            <View style={styles.nextHeading}>
              <View style={styles.dateBlock}>
                <Copy size={10} weight="bold" tone={color.green}>{formatDay(next.date, { month: 'short' }).toUpperCase()}</Copy>
                <Copy size={20} weight="extra" style={{ lineHeight: 23 }}>{asDate(next.date).getDate()}</Copy>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Copy size={16} weight="bold" style={{ letterSpacing: -0.35 }}>{next.name}</Copy>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 }}>
                  <Clock3 size={13} color={color.muted} />
                  <Copy tone={color.muted} size={12}>{workoutDay(next.date)} · {formatTime(next.time)} · {nextExercises.length} exercises</Copy>
                </View>
              </View>
            </View>
            <View>
              {nextExercises.map(({ exercise, sets, reps }) => (
                <Pressable key={exercise.id} onPress={() => setSelected(exercise)} accessibilityRole="button" accessibilityLabel={`Open ${exercise.name}`}
                  style={({ hovered }) => [styles.movement, hovered && { backgroundColor: color.canvas }]}>
                  <Image source={exercisePhotos[exercise.id]} style={styles.thumb} />
                  <Copy size={13} weight="semibold" style={{ flex: 1 }}>{exercise.name}</Copy>
                  <Copy size={12} tone={color.muted}>{sets} × {reps}{exercise.unit === 'seconds' ? 's' : ''}</Copy>
                  <ChevronRight size={15} color={color.green} />
                </Pressable>
              ))}
            </View>
            <Button kind="outline" end={ArrowRight} compact onPress={() => training.open({ type: 'edit', workoutId: next.id })}>Open workout</Button>
          </> : <>
            <Copy tone={color.muted}>You have no upcoming workouts.</Copy>
            <Button icon={Plus} kind="primary" onPress={() => training.open({ type: 'schedule' })}>Schedule a workout</Button>
          </>}
        </Panel>

        <View style={[styles.split, wide && { flex: 1 }]}>
          <Panel style={styles.week}>
            <SectionTitle title="Last 7 days" />
            <View style={styles.days}>
              {Array.from({ length: 7 }, (_, index) => {
                const day = addDays(today, index - 6);
                const active = activeDates.has(day);
                return <View key={day} accessible accessibilityLabel={`${formatDay(day)}: ${active ? 'workout logged' : 'no workout'}`} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                  <Copy size={10} tone={color.muted}>{formatDay(day, { weekday: 'short' }).slice(0, 2)}</Copy>
                  <View style={[styles.day, active && { backgroundColor: color.lime }, day === today && styles.today]}>
                    {active ? <Check color={color.forest} size={15} strokeWidth={2.6} /> : <Copy size={13} weight="bold" tone={color.muted}>·</Copy>}
                  </View>
                </View>;
              })}
            </View>
            <Copy size={12} tone={color.muted}>{lastSeven.length} {lastSeven.length === 1 ? 'workout' : 'workouts'} completed</Copy>
          </Panel>
          <Pressable accessibilityRole="link" onPress={() => router.push('/form-review')}
            style={({ hovered }) => [styles.review, { backgroundColor: hovered ? color.forestHover : color.forest }]}>
            <View style={styles.reviewIcon}><Video color={color.lime} size={21} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Copy weight="bold" size={15} tone={color.white}>Review your form</Copy>
              <Copy size={12} tone="#d0dccf">Upload a clip of your exercise.</Copy>
            </View>
            <ArrowUpRight size={19} color={color.lime} />
          </Pressable>
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <SectionTitle title="Exercise library" action={<Button end={ArrowRight} kind="quiet" compact onPress={() => router.push('/explore')}>Browse library</Button>} />
        <View style={{ flexDirection: width >= 670 ? 'row' : 'column', gap: 12 }}>
          {data.catalog.slice(0, 3).map((exercise) => (
            <View key={exercise.id} style={{ flex: 1, minWidth: 0 }}><ExerciseCard exercise={exercise} onPress={() => setSelected(exercise)} /></View>
          ))}
        </View>
      </View>
      <Link href="/photo-credits" style={{ alignSelf: 'flex-start' }}>
        <Copy size={12} tone={color.green} style={{ textDecorationLine: 'underline' }}>Photo credits</Copy>
      </Link>
      {selected && <ExerciseSheet exercise={selected} onClose={() => setSelected(null)} />}
    </View>
  );
}

function Metric({ icon: Icon, label, value, narrow }: { icon: LucideIcon; label: string; value: number; narrow: boolean }) {
  return <Panel style={[styles.metric, narrow && { flexDirection: 'column', alignItems: 'flex-start', padding: 10, gap: 5 }]}>
    <View style={[styles.metricIcon, narrow && { width: 30, height: 30 }]}><Icon color={color.green} size={narrow ? 16 : 21} /></View>
    <View style={{ flexShrink: 1 }}>
      <Copy weight="extra" size={narrow ? 21 : 25} style={{ letterSpacing: -0.9, lineHeight: 29 }}>{value}</Copy>
      <Copy size={narrow ? 10 : 12} tone={color.muted} weight="medium">{label}</Copy>
    </View>
  </Panel>;
}

const styles = StyleSheet.create({
  intro: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 11 },
  datePill: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: color.line, backgroundColor: color.white, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  hero: { paddingHorizontal: 29, paddingVertical: 25, justifyContent: 'center', borderRadius: 17, overflow: 'hidden', backgroundColor: color.forest },
  metrics: { flexDirection: 'row', gap: 13 },
  metric: { flex: 1, minWidth: 0, minHeight: 83, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  metricIcon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: color.limeSoft },
  split: { gap: 13, minWidth: 0 },
  schedule: { padding: 15, gap: 11 },
  nextHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dateBlock: { width: 44, height: 44, borderRadius: 8, backgroundColor: color.limeSoft, alignItems: 'center', justifyContent: 'center' },
  movement: { flexDirection: 'row', alignItems: 'center', minHeight: 39, gap: 8, borderTopWidth: 1, borderColor: color.line, paddingHorizontal: 2 },
  thumb: { width: 34, height: 26, borderRadius: 4, backgroundColor: color.soft },
  week: { padding: 15, gap: 13, flex: 1, justifyContent: 'space-between' },
  days: { flexDirection: 'row', gap: 3 },
  day: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: color.soft },
  today: { borderWidth: 1, borderColor: '#90a47b' },
  review: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, minHeight: 77, borderRadius: 14 },
  reviewIcon: { width: 41, height: 41, borderRadius: 10, backgroundColor: '#35452a', alignItems: 'center', justifyContent: 'center' },
});
