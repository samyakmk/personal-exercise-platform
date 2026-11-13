export const equipment = ['Dumbbells', 'Bench'];
export const muscles = ['Legs', 'Glutes', 'Chest', 'Back', 'Shoulders', 'Arms', 'Core'];

export const catalog = [
  {
    id: 'goblet-squat', name: 'Goblet Squat', muscles: ['Legs', 'Glutes', 'Core'],
    equipment: ['Dumbbells'], level: 'Beginner', unit: 'reps',
    description: 'A squat variation with the weight held in front of your chest.',
    demonstration: { videoId: 'NIrcxSkwui8', creator: 'Bony to Bombshell' },
    cues: [
      'Hold one dumbbell vertically at your chest and stand with your feet about shoulder-width apart.',
      'Bend at the hips and knees. Keep your heels down and let your knees track in the direction of your toes.',
      'Lower as far as you can control, then push through your whole foot to stand.',
    ],
  },
  {
    id: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', muscles: ['Chest', 'Shoulders', 'Arms'],
    equipment: ['Dumbbells', 'Bench'], level: 'Beginner', unit: 'reps',
    description: 'A horizontal press for the chest, shoulders, and triceps.',
    demonstration: { videoId: 'AduT4Eq-iP0', creator: 'PureGym' },
    cues: [
      'Lie on a flat bench with your feet planted and a dumbbell over each shoulder.',
      'Lower the weights toward either side of your chest with your wrists stacked above your elbows.',
      'Press the weights back up with control, keeping your feet planted and shoulder blades steady.',
    ],
  },
  {
    id: 'dumbbell-row', name: 'Single-Arm Dumbbell Row', muscles: ['Back', 'Arms'],
    equipment: ['Dumbbells', 'Bench'], level: 'Beginner', unit: 'reps',
    description: 'A supported single-arm pull that trains the upper back.',
    demonstration: { videoId: 'ZRSGpBUVcNw', creator: 'PureGym' },
    cues: [
      'Support one hand and the same-side knee on a stable bench. Hold the dumbbell in your free hand.',
      'Keep your torso steady as you pull your elbow back toward your hip.',
      'Lower the weight with control. Complete the same number of reps on each side.',
    ],
  },
  {
    id: 'push-up', name: 'Push-Up', muscles: ['Chest', 'Shoulders', 'Arms', 'Core'],
    equipment: [], level: 'Intermediate', unit: 'reps',
    description: 'A bodyweight press that also challenges trunk stability.',
    demonstration: { videoId: 'IODxDxX7oi4', creator: 'Calisthenicmovement' },
    cues: [
      'Place your hands slightly wider than your shoulders and step into a high plank.',
      'Bend your elbows and lower your chest toward the floor while keeping your hips in line with your shoulders.',
      'Push the floor away to return to a high plank. Use a sturdy raised surface if you need an easier variation.',
    ],
  },
  {
    id: 'reverse-lunge', name: 'Reverse Lunge', muscles: ['Legs', 'Glutes'],
    equipment: [], level: 'Beginner', unit: 'reps',
    description: 'A step-back lunge that works each leg independently.',
    demonstration: { videoId: 'xrPteyQLGAo', creator: 'PureGym' },
    cues: [
      'Stand tall with your feet about hip-width apart.',
      'Step back on one foot and bend both knees, keeping your front foot flat.',
      'Press through the front foot to stand. Repeat on the other side.',
    ],
  },
  {
    id: 'forearm-plank', name: 'Forearm Plank', muscles: ['Core', 'Shoulders'],
    equipment: [], level: 'Beginner', unit: 'seconds',
    description: 'A static hold that trains you to keep your trunk steady.',
    demonstration: { videoId: 'A2b2EmIg0dA', creator: 'E3 Rehab' },
    cues: [
      'Set your elbows directly under your shoulders and extend your legs behind you.',
      'Brace your abdomen and keep a straight line from your head to your heels.',
      'Breathe steadily throughout the hold. End the set when you can no longer maintain the position.',
    ],
  },
];

export const exercisesById = new Map(catalog.map((exercise) => [exercise.id, exercise]));

export function recommend({ targets, available, query, recent }) {
  const search = query.trim().toLowerCase();
  return catalog
    .filter((item) => (
      (!targets.length || item.muscles.some((muscle) => targets.includes(muscle))) &&
      (available === null || item.equipment.every((item) => available.includes(item))) &&
      (!search || [item.name, ...item.muscles, ...item.equipment, ...(item.equipment.length ? [] : ['Bodyweight'])].join(' ').toLowerCase().includes(search))
    ))
    .map((exercise, index) => ({
      exercise,
      index,
      score: (targets.includes(exercise.muscles[0]) ? 4 : 0)
        + exercise.muscles.filter((muscle) => targets.includes(muscle)).length
        + (recent.has(exercise.id) ? 0.25 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ exercise }) => exercise);
}
