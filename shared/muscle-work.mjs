export function loggedMuscleWork(workouts, catalog) {
  const totals = new Map();
  for (const workout of workouts) {
    if (workout.status !== 'completed' || workout.example) continue;
    const exposure = new Map();
    const effort = workout.effort;
    const effortFactor = typeof effort === 'number' && effort >= 1 && effort <= 10
      ? 1 + (effort - 5.5) * 0.04 : 1;
    for (const movement of workout.exercises) {
      const exercise = catalog.get(movement.exerciseId);
      const count = movement.setDetails?.length ?? movement.sets;
      if (!exercise || count <= 0) continue;
      const primary = new Set(exercise.primaryMuscles);
      const secondary = new Set(exercise.secondaryMuscles);
      for (const muscle of primary) addWork(muscle, 1);
      for (const muscle of secondary) {
        if (!primary.has(muscle)) addWork(muscle, 0.5);
      }

      function addWork(muscle, role) {
        let accumulated = exposure.get(muscle) ?? 0;
        let points = 0;
        for (let set = 0; set < count; set += 1) {
          points += role * (1 + Math.min(accumulated * 0.08, 0.4)) * effortFactor;
          accumulated += role;
        }
        exposure.set(muscle, accumulated);
        totals.set(muscle, (totals.get(muscle) ?? 0) + points);
      }
    }
  }
  return totals;
}
