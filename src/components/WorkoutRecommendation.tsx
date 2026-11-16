import { useState } from 'react';
import { Check, Sparkles } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { color } from '../theme';
import { movementSummary } from '../trainingProgress';
import type { Refinement, WorkoutSuggestion } from '../types';
import { useRecommendationRequest } from '../useRecommendationRequest';
import { useWorkspace } from '../workspace';
import { refineWorkout, workoutSize } from '../workoutRefinement';
import { RecommendationPanel, RefinementControls } from './RecommendationControls';
import { Button, Copy, Loading, Notice } from './ui';

export function WorkoutRecommendation({ onApply, disabled }: { onApply: (workout: WorkoutSuggestion) => void; disabled: boolean }) {
  const { api, data, exerciseRecords } = useWorkspace();
  const request = useRecommendationRequest('workout', (_: undefined, signal) => api.workoutRecommendation(signal));
  const [adjusted, setAdjusted] = useState<ReturnType<typeof refineWorkout>>();
  const workout = request.result && { ...request.result, exercises: adjusted?.exercises ?? request.result.exercises };
  const available = data?.aiAvailable;
  const hasWorkout = Boolean(workout?.exercises.length);
  const waiting = disabled || Boolean(request.pending || request.retryAt);

  function refine(choice: Refinement) {
    if (workout) setAdjusted(refineWorkout(workout.exercises, choice, exerciseRecords));
  }

  return <RecommendationPanel title={available ? 'Plan your workout with AI' : 'Get a suggested workout'}
    detail="Get a complete workout based on your equipment and training. Adjust it here, then add it to your schedule.">
    {!workout && !request.pending && <Button kind="primary" icon={Sparkles} disabled={waiting} onPress={() => request.run(undefined)}>
      {request.retryAt ? 'Retry shortly' : request.error ? 'Try again' : available ? 'Suggest a workout with AI' : 'Suggest a workout'}
    </Button>}
    {request.pending && <Loading label="Building your workout…" />}
    {request.error && <Notice error>{request.error}</Notice>}
    {workout && !hasWorkout && <Notice>No suggested exercises fit your equipment and preferences. You can choose exercises below.</Notice>}
    {workout && hasWorkout && <>
      <View>
        <Copy accessibilityRole="header" aria-level={3} weight="bold" size={16}>{workout.name}</Copy>
        <Copy size={12} tone={color.muted}>{workoutSize(workout.exercises)}</Copy>
      </View>
      <View role="list" accessibilityLabel="Suggested exercises">
        {workout.exercises.map((movement) => {
          const exercise = exerciseRecords.get(movement.exerciseId);
          return exercise && <View key={exercise.id} role="listitem" style={styles.exercise}>
            <Copy weight="semibold" size={13} style={styles.name}>{exercise.name}</Copy>
            <Copy size={12} tone={color.muted}>{movementSummary(exercise, movement)}</Copy>
          </View>;
        })}
      </View>
      <RefinementControls onRefine={refine} disabled={disabled} />
      {adjusted && <Notice>{adjusted.message}</Notice>}
      <Button kind="primary" icon={Check} disabled={disabled} onPress={() => onApply(workout)}>Use this workout</Button>
    </>}
  </RecommendationPanel>;
}

const styles = StyleSheet.create({
  exercise: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 6,
    paddingVertical: 6, borderTopWidth: 1, borderColor: color.line },
  name: { flexShrink: 1 },
});
