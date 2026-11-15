// Starter movements have a demonstration and a known role; familiar and
// explicitly preferred library movements can join this pool.
export const broadPriorities = ['Upper body'];

const starter = [
  'incline-push-up', 'bodyweight-squat', 'bird-dog', 'dumbbell-row', 'glute-bridge',
  'fedb-bent-over-two-dumbbell-row', 'fedb-band-pull-apart',
  'dumbbell-curl', 'dumbbell-shoulder-press', 'dead-bug', 'reverse-lunge',
  'goblet-squat', 'dumbbell-bench-press', 'dumbbell-rdl', 'forearm-plank',
  'push-up', 'fedb-triceps-pushdown',
];
const regions = new Map(Object.entries({
  Chest: 'push', Shoulders: 'push', Triceps: 'push',
  Lats: 'pull', 'Mid-back': 'pull', Traps: 'pull', Biceps: 'pull', Forearms: 'pull',
  Quadriceps: 'legs', Calves: 'legs', Glutes: 'legs', Hamstrings: 'legs', Abductors: 'legs', Adductors: 'legs',
  Abdominals: 'core', 'Lower back': 'core', Neck: 'neck',
}));
const byDate = ({ date, time, id }) => `${date}T${time}/${id}`;
const ageDays = (today, day) => Math.round((Date.parse(today + 'T12:00Z') - Date.parse(day + 'T12:00Z')) / 86_400_000);
const countSets = (movement) => movement.setDetails?.length ?? movement.sets;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const validEffort = (value) => Number.isInteger(value) && value >= 1 && value <= 10;

export function isPlannableExercise(exercise) {
  return exercise.category === 'Strength' && exercise.level !== 'Advanced'
    && !exercise.primaryMuscles?.includes('Neck') && Boolean(exercise.primaryMuscles?.length);
}

export function buildTodayPlan({ current, catalog, equipment, preferences, workouts, adjustment }) {
  const rest = (reason, summary) => ({ kind: 'rest', name: 'A day to recover', summary, reasons: [reason], exercises: [] });
  if (adjustment === 'rest') {
    return rest('You asked to rest today.', 'Pick up with a fresh suggestion the next time you train.');
  }
  const exerciseById = new Map(catalog.map((exercise) => [exercise.id, exercise]));
  const history = workouts.filter((workout) => workout.status === 'completed' && !workout.example
    && byDate(workout) <= `${current.date}T${current.time}/\uffff`
    && (workout.source === 'trainer' || workout.exercises.some((item) => countSets(item) > 0)))
    .sort((a, b) => byDate(b).localeCompare(byDate(a)));
  if (history[0]?.date === current.date) {
    return rest(history[0].source === 'trainer' ? 'A trainer session is already logged today.' : 'You already logged training today.',
      'Your next suggestion will take today’s session into account.');
  }
  const recent = history.filter((workout) => ageDays(current.date, workout.date) <= 14);
  const latest = recent[0];
  const yesterday = latest && ageDays(current.date, latest.date) === 1;
  const difficult = latest && validEffort(latest.effort) && latest.effort >= 8 && ageDays(current.date, latest.date) <= 3;
  const trainerYesterday = yesterday && latest.source === 'trainer';
  if (yesterday && latest.effort >= 9) {
    return rest('Yesterday’s session was rated ' + latest.effort + ' out of 10.', 'You can leave today open for recovery.');
  }
  const light = adjustment === 'easier' || difficult || trainerYesterday;
  const goals = new Set(preferences?.priorities ?? []);
  const preferred = new Set(preferences?.preferred ?? []);
  const excluded = new Set(preferences?.excluded ?? []);
  const gear = new Set(equipment ?? []);
  const work = new Map();
  const previousDay = new Set();
  const familiar = new Map();
  for (const workout of history) {
    const days = ageDays(current.date, workout.date);
    for (const movement of workout.exercises) {
      const count = countSets(movement);
      if (!count) continue;
      const exercise = exerciseById.get(movement.exerciseId);
      if (days <= 60 && !familiar.has(movement.exerciseId)) familiar.set(movement.exerciseId, { movement, effort: workout.effort });
      if (!exercise || days > 14) continue;
      const primary = new Set(exercise.primaryMuscles);
      for (const muscle of primary) {
        work.set(muscle, (work.get(muscle) ?? 0) + Math.min(5, count) / (1 + days / 3));
        if (days === 1) previousDay.add(muscle);
      }
      for (const muscle of exercise.secondaryMuscles ?? []) {
        if (!primary.has(muscle)) work.set(muscle, (work.get(muscle) ?? 0) + Math.min(5, count) / (2 + days));
      }
    }
  }

  const selected = [];
  const covered = new Set();
  const coveredMuscles = new Set();
  const pool = [...new Set([...starter, ...preferred, ...familiar.keys()])].flatMap((id) => {
    const exercise = exerciseById.get(id);
    if (!exercise || !isPlannableExercise(exercise) || excluded.has(id) || exercise.equipment.some((item) => !gear.has(item))) return [];
    if (exercise.level !== 'Beginner' && !familiar.has(id) && !preferred.has(id) && id !== 'push-up') return [];
    const targets = exercise.primaryMuscles;
    if (yesterday && targets.some((muscle) => previousDay.has(muscle))) return [];
    const aliases = new Set(targets.flatMap((muscle) => {
      const group = regions.get(muscle);
      return [
        muscle, (group === 'pull' || group === 'push') ? 'Upper body' : '', group === 'legs' ? 'Legs' : group === 'core' ? 'Core' : '',
        ['Biceps', 'Triceps', 'Forearms'].includes(muscle) ? 'Arms' : '',
        ['Lats', 'Mid-back', 'Traps', 'Lower back'].includes(muscle) ? 'Back' : '',
      ];
    }));
    const goal = [...goals].some((name) => aliases.has(name));
    const recentWork = targets.reduce((total, muscle) => total + (work.get(muscle) ?? 0), 0) / targets.length;
    const score = (goal ? 4 : 0) + (preferred.has(id) ? 3 : 0) + (familiar.has(id) ? 1.4 : 0)
      - recentWork * 0.65 + (starter.includes(id) ? (starter.length - starter.indexOf(id)) / starter.length : 0)
      + (exercise.level === 'Beginner' ? 0.8 : 0);
    return [{ exercise, score, goal, targets, region: regions.get(targets[0]) ?? targets[0] }];
  });
  const balanced = goals.size === 0;
  const limit = light ? 3 : preferences?.experience === 'regular' ? 5 : 4;
  while (pool.length && selected.length < limit) {
    const rank = ({ region, targets, score }) => score
      + (covered.has(region) ? 0 : balanced ? 8 : 2)
      - targets.filter((muscle) => coveredMuscles.has(muscle)).length * 4;
    pool.sort((a, b) => rank(b) - rank(a));
    const pick = pool.shift();
    if ((balanced && covered.has(pick.region) || pick.targets.every((muscle) => coveredMuscles.has(muscle))) && selected.length >= 2) continue;
    selected.push(pick);
    covered.add(pick.region);
    for (const muscle of pick.targets) coveredMuscles.add(muscle);
  }
  if (!selected.length) return rest(yesterday ? 'There is no suitable change of focus after yesterday’s session.' : 'No suggested movements match your current gear and preferences.',
    yesterday ? 'Take the day off or follow your trainer’s plan.' : 'Review your equipment and excluded exercises to give the planner more options.');

  let progressed = false;
  let reduced = false;
  const exercises = selected.map(({ exercise }) => {
    const prior = familiar.get(exercise.id);
    const seconds = exercise.unit === 'seconds';
    const lastTargets = prior?.movement.setDetails?.map(({ reps }) => reps).filter(Number.isInteger);
    const lastReps = lastTargets?.length ? Math.min(...lastTargets) : prior?.movement.reps;
    const priorTarget = Number.isInteger(lastReps) ? clamp(lastReps, 1, seconds ? 45 : 15) : undefined;
    const base = priorTarget ?? (seconds ? 15 : 6);
    const easier = Boolean(light || prior?.effort >= 8);
    const easierAmount = seconds ? 5 : 1;
    const smallIncrease = !easier && priorTarget !== undefined && validEffort(prior.effort) && prior.effort <= 4;
    const reps = clamp(base + (easier ? -easierAmount : smallIncrease ? (seconds ? 5 : 1) : 0), 1, seconds ? 45 : 15);
    const sets = easier ? 1 : prior ? clamp(countSets(prior.movement), 1, 2) : 2;
    progressed ||= smallIncrease && reps > base;
    reduced ||= easier;
    return { exerciseId: exercise.id, sets, reps };
  });
  const reasons = [];
  if (adjustment === 'easier') reasons.push('You asked for a lighter day.');
  if (trainerYesterday) reasons.push('Yesterday’s trainer session keeps today shorter.');
  if (yesterday && previousDay.size) reasons.push('The plan changes focus from the muscles you worked most yesterday.');
  if (difficult) reasons.push(`A recent session rated ${latest.effort} out of 10 keeps the targets lighter.`);
  else if (reduced && !light) reasons.push('Previously hard movements get a smaller target.');
  if (progressed) reasons.push('A familiar movement felt easy, so its target moves up a small step.');
  if (!history.length) reasons.push('You’re starting without training history, so targets are modest.');
  if (!gear.size) reasons.push('Uses bodyweight with no saved equipment needed.');
  if (selected.some((pick) => pick.goal)) reasons.push('Includes work for your saved muscle priorities.');
  if (selected.some(({ exercise }) => preferred.has(exercise.id))) reasons.push('Includes exercises you marked as trainer favorites.');
  if (!reasons.length) reasons.push('Uses recent training to rotate which muscle groups get attention.');
  return {
    kind: 'train',
    name: light ? 'A lighter strength session' : balanced ? 'Balanced strength' : 'Strength for your priorities',
    summary: `${exercises.length} ${exercises.length === 1 ? 'exercise' : 'exercises'} · ${exercises.reduce((total, { sets }) => total + sets, 0)} sets`,
    reasons,
    exercises,
  };
}

export function checkInReply(text, plan, names, adjustment) {
  const lower = text.toLowerCase();
  if (/\b(pain|injur(?:y|ed)|dizz(?:y|iness)|sharp ache)\b/.test(lower)) {
    return 'If a movement is causing pain or you feel unwell, stop and check with your trainer or a qualified clinician before continuing. You can set today to Rest or exclude a specific exercise in Profile.';
  }
  const prefix = adjustment === 'usual' ? 'Your check-in adjustment for today is cleared. ' : '';
  if (/\b(effort|rpe)\b/.test(lower) && /\b(what|mean|scale|rate)\b/.test(lower)) {
    return prefix + 'Perceived effort is your overall rating for the session: 1 means very easy and 10 means maximal effort. You can leave it blank. Recent high ratings can make your next suggestion lighter.';
  }
  if (/\b(trainer|coach)\b/.test(lower) && /\b(avoid|swap|skip|prefer|replace)\b/.test(lower)) {
    return prefix + 'Follow your trainer’s instruction. In Profile, mark a movement as excluded or trainer-preferred to apply that instruction to future suggestions.';
  }
  return prefix + (plan.kind === 'rest'
    ? `Today’s suggestion is a day to recover. ${plan.reasons[0]}`
    : `Today’s suggestion is ${plan.name.toLowerCase()}: ${plan.exercises.map(({ exerciseId }) => names.get(exerciseId) ?? exerciseId).join(', ')}. ${plan.reasons[0]}`);
}
