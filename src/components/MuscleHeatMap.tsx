import { Link, useRouter } from 'expo-router';
import { ArrowUpRight, ChevronDown, ChevronUp, PersonStanding } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { loggedMuscleWork, muscleNames } from '../muscleWork';
import type { Muscle } from '../muscleWork';
import { color } from '../theme';
import type { Exercise, Workout } from '../types';
import { contours, figurePath, outline, regions } from './muscleIllustration';
import type { BodyModel, BodyView } from './muscleIllustration';
import { Button, Chip, Copy } from './ui';

const heatColors = ['#ded8d1', '#f2d4b5', '#e9a97e', '#cd705c', '#983f5d'];
const neutral = '#f7f0e8';
const bodyViews: BodyView[] = ['Front', 'Back'];
const bodyModels: BodyModel[] = ['Male', 'Female'];

function heatColor(points: number, scale: number) {
  return heatColors[Math.ceil(points / scale * (heatColors.length - 1))];
}

function pointLabel(points: number) {
  const rounded = Math.round(points * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'point' : 'points'}`;
}

function muscleLink(muscle: Muscle) {
  return { pathname: '/explore' as const, params: { detail: muscle, equipment: 'all' } };
}

export function SessionHeatMapLink({ workoutId }: { workoutId: string }) {
  return <Link href={{ pathname: '/progress', params: { session: workoutId } }} push asChild>
    <Button accessibilityRole="link" compact icon={PersonStanding}>Muscle heat map</Button>
  </Link>;
}

export function MuscleHeatMap({ workouts, catalog }: {
  workouts: readonly Workout[];
  catalog: ReadonlyMap<string, Exercise>;
}) {
  const router = useRouter();
  const [model, setModel] = useState<BodyModel>('Male');
  const [showAll, setShowAll] = useState(false);
  const [hovered, setHovered] = useState<Muscle | null>(null);
  const totals = useMemo(() => loggedMuscleWork(workouts, catalog), [workouts, catalog]);
  const ranked = muscleNames.map((muscle) => ({ muscle, points: totals.get(muscle) ?? 0 }))
    .sort((a, b) => b.points - a.points);
  const worked = ranked.filter(({ points }) => points > 0);
  const visible = showAll ? ranked : worked.slice(0, 5);
  const scale = Math.max(12, Math.ceil(ranked[0].points / 4) * 4);

  return <View style={styles.map} role="group" accessibilityLabel="Muscle heat map">
    <View style={styles.layout}>
      <View style={styles.stage}>
        <View role="group" accessibilityLabel="Body model" style={styles.modelPicker}>
          {bodyModels.map((choice) => <Chip key={choice} label={choice} selected={model === choice}
            onPress={() => setModel(choice)} />)}
        </View>
        <View style={styles.figures}>
          {bodyViews.map((view) => <View key={view} style={styles.figure}>
            <View style={styles.drawing} aria-hidden>
              <MuscleFigure view={view} model={model} totals={totals} scale={scale} hovered={hovered}
                onHover={setHovered} onPress={(muscle) => router.push(muscleLink(muscle))} />
            </View>
            <Copy size={12} weight="semibold" tone={color.muted}>{view}</Copy>
          </View>)}
        </View>
        <View style={styles.legend}>
          <Copy size={11} tone={color.muted}>0 points</Copy>
          <View aria-hidden style={styles.ramp}>
            {heatColors.map((fill) => <View key={fill} style={[styles.step, { backgroundColor: fill }]} />)}
          </View>
          <Copy size={11} tone={color.muted}>{scale} points</Copy>
        </View>
        <Copy aria-hidden size={12} weight="semibold" tone={color.plum} style={styles.hoverLabel}>
          {hovered ? `${hovered} · ${pointLabel(totals.get(hovered) ?? 0)}` : ' '}
        </Copy>
      </View>

      <View style={styles.breakdown}>
        <Copy accessibilityRole="header" aria-level={3} size={16} weight="bold">Muscle breakdown</Copy>
        <Copy size={13} tone={color.muted}>{worked.length
          ? `${worked.length} of ${muscleNames.length} muscle groups worked. Select a muscle to find exercises.`
          : 'No logged sets in this view. Select any muscle to find exercises.'}</Copy>
        {visible.length > 0 && <View role="list" accessibilityLabel="Muscle work by region">
          {visible.map(({ muscle, points }) => <View key={muscle} role="listitem">
            <Link href={muscleLink(muscle)} push asChild>
              <Pressable accessibilityRole="link" accessibilityLabel={`${muscle}, ${pointLabel(points)} · Find exercises`}
                onHoverIn={() => setHovered(muscle)} onHoverOut={() => setHovered(null)}
                onFocus={() => setHovered(muscle)} onBlur={() => setHovered(null)}
                style={StyleSheet.flatten([styles.muscleRow, hovered === muscle && { backgroundColor: color.canvas }])}>
                <View style={[styles.swatch, { backgroundColor: heatColor(points, scale) }]} />
                <Copy size={13} weight="semibold" style={styles.muscleName}>{muscle}</Copy>
                <Copy size={12} tone={color.muted}>{pointLabel(points)}</Copy>
                <ArrowUpRight aria-hidden size={14} color={color.plum} />
              </Pressable>
            </Link>
          </View>)}
        </View>}
        <Button compact kind="quiet" end={showAll ? ChevronUp : ChevronDown} aria-expanded={showAll}
          onPress={() => setShowAll((open) => !open)}>
          {showAll ? 'Show fewer muscles' : 'Show all muscles'}
        </Button>
        <Copy size={12} tone={color.muted} style={styles.scoring}>Points estimate logged work. Primary muscles start at 1 point per set and secondary muscles at 0.5. Repeated work for a muscle in the same session adds a little more, and the optional effort rating adjusts the total. Points don’t measure recovery or muscle growth.</Copy>
      </View>
    </View>
  </View>;
}

function MuscleFigure({ view, model, totals, scale, hovered, onHover, onPress }: {
  view: BodyView;
  model: BodyModel;
  totals: ReadonlyMap<string, number>;
  scale: number;
  hovered: Muscle | null;
  onHover: (muscle: Muscle | null) => void;
  onPress: (muscle: Muscle) => void;
}) {
  const body = figurePath(outline, model);
  const details = figurePath(contours[view].join(' '), model);
  const shapes = regions[view].map(({ muscle, path }) => ({ muscle, path: figurePath(path, model) }));

  return <Svg viewBox="4 0 176 339" width="100%" height="100%">
    {[false, true].map((mirrored) => <G key={String(mirrored)} transform={mirrored ? 'translate(184 0) scale(-1 1)' : undefined}>
      <Path d={body} fill={neutral} stroke="#a8928f" strokeWidth={0.9} strokeLinejoin="round" />
      <Path d={details} fill="none" stroke="#c3aea9" strokeWidth={0.65} strokeLinecap="round" />
    </G>)}
    {[false, true].map((mirrored) => <G key={String(mirrored)} transform={mirrored ? 'translate(184 0) scale(-1 1)' : undefined}>
      {shapes.map(({ muscle, path }) => {
        const pointer = Platform.OS === 'web' ? {
          'data-muscle': muscle, cursor: 'pointer',
          onPointerEnter: () => onHover(muscle), onPointerLeave: () => onHover(null),
        } : {};
        return <Path key={muscle} d={path} {...pointer}
          fill={heatColor(totals.get(muscle) ?? 0, scale)} stroke={hovered === muscle ? color.plum : '#ad9893'}
          strokeWidth={hovered === muscle ? 1.6 : 0.65} strokeLinejoin="round"
          onPress={() => { onHover(null); onPress(muscle); }} />;
      })}
    </G>)}
  </Svg>;
}

const styles = StyleSheet.create({
  map: { minWidth: 0 },
  layout: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20 },
  stage: { flexBasis: 310, flexGrow: 2, flexShrink: 1, minWidth: 0, padding: 12, gap: 10,
    alignItems: 'center', backgroundColor: color.canvas, borderWidth: 1, borderColor: color.line, borderRadius: 12 },
  modelPicker: { flexDirection: 'row', alignSelf: 'center', gap: 6 },
  figures: { flexDirection: 'row', justifyContent: 'center', width: '100%', gap: 7 },
  figure: { flex: 1, maxWidth: 170, minWidth: 0, alignItems: 'center', gap: 4 },
  drawing: { width: '100%', aspectRatio: 176 / 339 },
  legend: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  ramp: { flexDirection: 'row', gap: 2 },
  step: { height: 8, width: 14, borderRadius: 2 },
  hoverLabel: { minHeight: 17 },
  breakdown: { flexBasis: 226, flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 8 },
  muscleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 42, paddingHorizontal: 5,
    paddingVertical: 6, borderTopWidth: 1, borderColor: color.line },
  swatch: { width: 10, height: 10, borderRadius: 3, borderWidth: 1, borderColor: '#ad9893' },
  muscleName: { flex: 1 },
  scoring: { paddingTop: 8, borderTopWidth: 1, borderColor: color.line },
});
