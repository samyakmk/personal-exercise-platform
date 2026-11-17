export function estimatedWorkoutMinutes(movements, exerciseById) {
  if (!movements.length) return 0;
  let seconds = 120;
  let sets = 0;
  for (const movement of movements) {
    const timed = exerciseById.get(movement.exerciseId)?.unit === 'seconds';
    sets += movement.sets;
    const amount = movement.setDetails?.reduce((sum, set) => sum + (set.reps ?? 0), 0)
      ?? movement.sets * (movement.reps ?? (timed ? 15 : 6));
    seconds += 30 + amount * (timed ? 1 : 3);
  }
  return Math.ceil((seconds + Math.max(0, sets - 1) * 60) / 60);
}
