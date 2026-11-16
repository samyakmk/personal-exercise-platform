import { applyTrainingNotes, buildTodayPlan, isPlannableExercise } from '../shared/today-plan.mjs';
import { recommendationCandidateLimit, recommendationReason } from './ai.mjs';
import { catalog, levels } from './catalog.mjs';

export const refinements = ['easier', 'harder', 'shorter', 'longer'];
export const maxExercisePicks = 5;

// Keep filters fixed and change one thing at a time relative to the visible picks.
export async function refineExercisePicks(rank, selection, previous, adjustment) {
  const { candidates, history } = selection;
  const context = { ...selection, history: Object.fromEntries(history) };
  const picks = previous.map((exercise) => ({ exerciseId: exercise.id, reason: recommendationReason(exercise, context) }));
  if (adjustment === 'shorter') return picks.length > 1 ? picks.slice(0, -1) : picks;
  const selected = new Set(picks.map(({ exerciseId }) => exerciseId));
  let options = candidates.filter(({ id }) => !selected.has(id));
  let index = picks.length;
  if (adjustment === 'longer') {
    if (picks.length >= maxExercisePicks) return picks;
  } else {
    const direction = adjustment === 'easier' ? -1 : 1;
    const tier = (exercise) => levels.indexOf(exercise.level);
    index = previous.reduce((best, exercise, i) => (tier(previous[best]) - tier(exercise)) * direction > 0 ? i : best, 0);
    const current = tier(previous[index]);
    const closer = (exercise) => (tier(exercise) - current) * direction;
    const nearest = Math.min(...options.map(closer).filter((distance) => distance > 0));
    options = options.filter((exercise) => closer(exercise) === nearest);
  }
  if (!options.length) return picks;
  const [pick] = await rank({ ...selection, candidates: options.slice(0, recommendationCandidateLimit), count: 1 });
  if (pick) picks.splice(index, index < picks.length ? 1 : 0, pick);
  return picks;
}

export async function suggestWorkout({ rank, current, available, history, preferences, workouts, trainingNotes }) {
  const gear = available ?? [];
  const base = buildTodayPlan({ current, catalog, equipment: gear, preferences, workouts, forSchedule: true, trainingNotes });
  preferences = applyTrainingNotes(preferences, trainingNotes);
  const baseline = new Map(base.exercises.map((movement) => [movement.exerciseId, movement]));
  const preferred = new Set(preferences?.preferred);
  const excluded = new Set(preferences?.excluded);
  const priorities = preferences?.priorities ?? [];
  const candidates = catalog.filter((exercise) => isPlannableExercise(exercise) && !excluded.has(exercise.id)
    && exercise.equipment.every((item) => gear.includes(item))
    && (exercise.level === 'Beginner' || baseline.has(exercise.id) || preferred.has(exercise.id) || preferences?.experience === 'regular'));
  const priority = (exercise) => priorities.some((muscle) => exercise.primaryMuscles.includes(muscle)
    || exercise.muscles.includes(muscle) || muscle === 'Upper body' && exercise.muscles.some((group) => ['Chest', 'Back', 'Arms', 'Shoulders'].includes(group)));
  const score = (exercise) => (baseline.has(exercise.id) ? 10 : 0) + (preferred.has(exercise.id) ? 4 : 0)
    + (priority(exercise) ? 2 : 0) + (history.has(exercise.id) ? 1 : 0);
  candidates.sort((a, b) => score(b) - score(a));
  const light = base.exercises.length > 0 && base.exercises.every(({ sets }) => sets === 1);
  const count = Math.min(light || preferences.shorter ? 3 : preferences.experience === 'regular' ? 5 : 4, candidates.length);
  const chosen = rank && count > 0 ? await rank({
    candidates: candidates.slice(0, recommendationCandidateLimit), targets: priorities, detail: null, available: gear, history, count,
    workout: { priorities, experience: preferences?.experience || 'new', preferred: candidates.slice(0, recommendationCandidateLimit)
      .filter(({ id }) => preferred.has(id)).map(({ id }) => id) },
  }) : [...baseline.keys(), ...candidates.filter(({ id }) => !baseline.has(id)).map(({ id }) => id)]
    .slice(0, count).map((exerciseId) => ({ exerciseId }));
  const byId = new Map(candidates.map((exercise) => [exercise.id, exercise]));
  return {
    source: rank && candidates.length > 1 ? 'ai' : 'catalog',
    name: base.kind === 'train' ? base.name : priorities.length ? 'Strength for your priorities' : 'Balanced strength',
    exercises: chosen.map(({ exerciseId }) => baseline.get(exerciseId) ?? {
      exerciseId, sets: light ? 1 : 2, reps: byId.get(exerciseId).unit === 'seconds' ? light ? 10 : 15 : light ? 5 : 6,
    }),
  };
}
