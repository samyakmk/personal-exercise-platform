import { useState } from 'react';
import { Check, Sparkles } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { estimatedWorkoutMinutes } from '../../shared/workout-duration.mjs';
import { color } from '../theme';
import { movementSummary } from '../trainingProgress';
import type { Refinement, WorkoutSuggestion, WorkoutSuggestionContext } from '../types';
import { useRecommendationRequest } from '../useRecommendationRequest';
import { useWorkspace } from '../workspace';
import { refineWorkout, workoutSize } from '../workoutRefinement';
import { RecommendationPanel, RefinementControls } from './RecommendationControls';
import { Button, Copy, Loading, Notice } from './ui';

export function WorkoutRecommendation({ onApply, disabled, context }: {
  onApply: (workout: WorkoutSuggestion) => void; disabled: boolean; context: WorkoutSuggestionContext;
}) {
  const { api, exerciseRecords } = useWorkspace();
  const request = useRecommendationRequest('workout', (_: undefined, signal) => api.workoutRecommendation(context, signal));
  const [adjusted, setAdjusted] = useState<ReturnType<typeof refineWorkout>>();
  const workout = request.result && { ...request.result, exercises: adjusted?.exercises ?? request.result.exercises };
  const hasWorkout = Boolean(workout?.exercises.length);
  const estimated = workout && estimatedWorkoutMinutes(workout.exercises, exerciseRecords);
  const overBudget = Boolean(estimated && estimated > context.minutes);
  const waiting = disabled || Boolean(request.pending || request.retryAt);

  function refine(choice: Refinement) {
    if (workout) setAdjusted(refineWorkout(workout.exercises, choice, exerciseRecords));
  }

  return <RecommendationPanel title={workout && hasWorkout ? workout.name : 'Start with a suggestion'}
    detail={workout && hasWorkout ? `${workoutSize(workout.exercises)} · about ${estimated} min` : 'Uses the scheduled day, time available, equipment, and nearby workouts.'}>
    {!workout && !request.pending && <Button kind="primary" icon={Sparkles} disabled={waiting} onPress={() => request.run(undefined)}>
      {request.retryAt ? 'Retry shortly' : request.error ? 'Try again' : 'Suggest a workout'}
    </Button>}
    {request.pending && <Loading label="Building your workout…" />}
    {request.error && <Notice error>{request.error}</Notice>}
    {workout && !hasWorkout && <Notice>No suggested exercises fit your equipment and preferences. You can choose exercises below.</Notice>}
    {workout && hasWorkout && <>
      <View role="list" accessibilityLabel="Suggested exercises">
        {workout.exercises.map((movement) => {
          const exercise = exerciseRecords.get(movement.exerciseId);
          return exercise && <View key={exercise.id} role="listitem" style={styles.exercise}>
            <Copy weight="semibold" size={13} style={styles.name}>{exercise.name}</Copy>
            <Copy size={12} tone={color.muted}>{movementSummary(exercise, movement)}</Copy>
          </View>;
        })}
      </View>
      {overBudget && <Notice>This version exceeds your available time. Choose Shorter or increase the time available.</Notice>}
      <Button kind="primary" icon={Check} disabled={disabled || overBudget} onPress={() => onApply(workout)}>Use this workout</Button>
      <RefinementControls onRefine={refine} disabled={disabled} />
      {adjusted && <Copy role="status" accessibilityLiveRegion="polite" size={13} tone={color.forest}>{adjusted.message}</Copy>}
    </>}
  </RecommendationPanel>;
}

const styles = StyleSheet.create({
  exercise: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 6,
    paddingVertical: 6, borderTopWidth: 1, borderColor: color.line },
  name: { flexShrink: 1 },
});
