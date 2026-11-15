import additionalExercises from './free-exercise-db.json' with { type: 'json' };
import demonstrations from './exercise-demonstrations.json' with { type: 'json' };

import { technique } from './technique.mjs';

const curated = [
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
      'Push the floor away to return to a high plank.',
    ],
  },
  {
    id: 'incline-push-up', name: 'Incline Push-Up', muscles: ['Chest', 'Shoulders', 'Arms', 'Core'],
    equipment: ['Bench'], level: 'Beginner', unit: 'reps',
    description: 'An easier push-up with your hands elevated on a stable bench or similar surface.',
    demonstration: { videoId: 'yAbg3_pJKvw', creator: 'PureGym' },
    cues: [
      'Place both hands on a sturdy bench or raised surface and step back into a straight body line.',
      'Lower your chest toward the surface while keeping your shoulders, hips, and heels in line.',
      'Press back up with control. Use a higher surface if you need a lighter variation.',
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
  {
    id: 'bodyweight-squat', name: 'Bodyweight Squat', muscles: ['Legs', 'Glutes', 'Core'],
    equipment: [], level: 'Beginner', unit: 'reps',
    description: 'A squat you can practice anywhere using your own body weight.',
    demonstration: { videoId: 'l83R5PblSMA', creator: 'PureGym' },
    cues: [
      'Stand with your feet at a comfortable width and extend your arms for balance.',
      'Bend your knees and hips together. Keep your whole foot on the floor as you lower.',
      'Stop at a depth you can control, then press through both feet to stand.',
    ],
  },
  {
    id: 'glute-bridge', name: 'Glute Bridge', muscles: ['Glutes', 'Legs', 'Core'],
    equipment: [], level: 'Beginner', unit: 'reps',
    description: 'A floor exercise that works the glutes through hip extension.',
    demonstration: { videoId: 'tqp5XQPpTxY', creator: 'PureGym' },
    cues: [
      'Lie on your back with knees bent, feet flat, and arms resting by your sides.',
      'Press through your feet and lift your hips until your shoulders, hips, and knees form a line.',
      'Briefly hold the top, then lower with control.',
    ],
  },
  {
    id: 'dumbbell-curl', name: 'Single-Arm Dumbbell Curl', muscles: ['Arms'],
    equipment: ['Dumbbells'], level: 'Beginner', unit: 'reps',
    description: 'A standing curl that trains the biceps one arm at a time.',
    demonstration: { videoId: 'Zl1eiQN5Dxs', creator: 'PureGym' },
    cues: [
      'Stand tall with one dumbbell by your side and your palm facing forward.',
      'Keep your upper arm close to your torso as you bend the elbow to lift the weight.',
      'Lower the dumbbell with control, then repeat on the other side.',
    ],
  },
  {
    id: 'dumbbell-shoulder-press', name: 'Standing Dumbbell Shoulder Press', muscles: ['Shoulders', 'Arms'],
    equipment: ['Dumbbells'], level: 'Beginner', unit: 'reps',
    description: 'An overhead press that trains your shoulders and triceps without a bench.',
    demonstration: { videoId: 'aI2hGzsAMXs', creator: 'PureGym' },
    cues: [
      'Stand with both feet planted and hold the dumbbells at shoulder height.',
      'Keep your ribs over your pelvis as you press the weights overhead.',
      'Bring the dumbbells back to shoulder height under control.',
    ],
  },
  {
    id: 'dumbbell-rdl', name: 'Dumbbell Romanian Deadlift', muscles: ['Glutes', 'Legs', 'Back'],
    equipment: ['Dumbbells'], level: 'Beginner', unit: 'reps',
    description: 'A hip hinge for the glutes and hamstrings that uses two dumbbells.',
    demonstration: { videoId: 'zU-f6DMCdAI', creator: 'PureGym' },
    cues: [
      'Stand tall with a dumbbell in each hand in front of your thighs and a slight bend in your knees.',
      'Send your hips back and let the dumbbells travel close to your legs.',
      'Pause when you reach a comfortable stretch in the hamstrings, then bring your hips forward to stand.',
    ],
  },
  {
    id: 'bird-dog', name: 'Bird Dog', muscles: ['Core', 'Back', 'Glutes'],
    equipment: [], level: 'Beginner', unit: 'reps',
    description: 'A balance exercise on hands and knees that challenges trunk stability.',
    demonstration: { videoId: 'egKWoMZ6cXM', creator: 'E3 Rehab Exercise Library' },
    cues: [
      'Start on your hands and knees with your hands below your shoulders and knees below your hips.',
      'Reach one arm forward and the opposite leg back while keeping your hips facing the floor.',
      'Return both limbs to the starting position with control, then switch sides.',
    ],
  },
  {
    id: 'dead-bug', name: 'Dead Bug', muscles: ['Core'],
    equipment: [], level: 'Beginner', unit: 'reps',
    description: 'A floor exercise that practices keeping your trunk steady as your arms and legs move.',
    demonstration: { videoId: 'BZYaCzbP09M', creator: 'E3 Rehab Exercise Library' },
    cues: [
      'Lie on your back, reach toward the ceiling, and raise your knees over your hips with your knees bent.',
      'Lower one arm behind you and extend the opposite leg as far as you can while keeping your torso steady.',
      'Bring your arm and leg back to the start, then switch sides.',
    ],
  },
  {
    id: 'pull-up', name: 'Pull-Up', muscles: ['Back', 'Arms', 'Shoulders'],
    equipment: ['Pull-up bar'], level: 'Intermediate', unit: 'reps',
    description: 'An upper-body pull using an overhand grip on a fixed bar.',
    demonstration: { videoId: 'PHdHnZcbsB8', creator: 'PureGym' },
    cues: [
      'Take an overhand grip on a secure pull-up bar with your hands slightly wider than your shoulders.',
      'From the hang, pull your elbows down until your chin reaches the bar without swinging.',
      'Lower with control until your elbows are straight, then repeat.',
    ],
  },
];

const curatedMuscles = {
  'goblet-squat': [['Quadriceps', 'Glutes'], ['Abdominals', 'Hamstrings']],
  'dumbbell-bench-press': [['Chest'], ['Shoulders', 'Triceps']],
  'dumbbell-row': [['Lats', 'Mid-back'], ['Biceps', 'Forearms']],
  'push-up': [['Chest'], ['Shoulders', 'Triceps', 'Abdominals']],
  'incline-push-up': [['Chest'], ['Shoulders', 'Triceps', 'Abdominals']],
  'reverse-lunge': [['Quadriceps', 'Glutes'], ['Hamstrings']],
  'forearm-plank': [['Abdominals'], ['Shoulders']],
  'bodyweight-squat': [['Quadriceps', 'Glutes'], ['Abdominals', 'Hamstrings']],
  'glute-bridge': [['Glutes'], ['Hamstrings', 'Abdominals']],
  'dumbbell-curl': [['Biceps'], ['Forearms']],
  'dumbbell-shoulder-press': [['Shoulders'], ['Triceps']],
  'dumbbell-rdl': [['Glutes', 'Hamstrings'], ['Lower back']],
  'bird-dog': [['Abdominals', 'Lower back'], ['Glutes']],
  'dead-bug': [['Abdominals'], []],
  'pull-up': [['Lats'], ['Biceps', 'Forearms', 'Shoulders']],
};

const exerciseRecords = [
  ...curated.map((exercise) => ({
    ...exercise,
    category: 'Strength',
    ...(technique[exercise.id] && { technique: technique[exercise.id] }),
    primaryMuscles: curatedMuscles[exercise.id][0],
    secondaryMuscles: curatedMuscles[exercise.id][1],
    ...(exercise.equipment.includes('Dumbbells') && { loadType: 'per-dumbbell' }),
  })),
  ...additionalExercises.map((exercise) => {
    const video = demonstrations[exercise.id];
    if (!video) return exercise;
    const thumbnailUrl = video.thumbnailUrl ?? `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
    return { ...exercise, demonstration: { ...video, thumbnailUrl } };
  }),
];
export const catalog = exerciseRecords.filter(({ demonstration }) => demonstration);
export const archivedExercises = exerciseRecords.filter(({ demonstration }) => !demonstration);
const additionalEquipment = [...new Set(additionalExercises.flatMap((exercise) => exercise.equipment))].sort();
export const equipment = [...new Set(['Dumbbells', 'Bench', 'Pull-up bar', ...additionalEquipment])];
export const muscles = ['Legs', 'Glutes', 'Chest', 'Back', 'Shoulders', 'Arms', 'Core', 'Neck'];
export const detailedMuscles = [...new Set(exerciseRecords.flatMap((item) => [...item.primaryMuscles, ...item.secondaryMuscles]))];
export const levels = ['Beginner', 'Intermediate', 'Advanced'];
export const categories = [...new Set(catalog.map(({ category }) => category))].sort();
export const exercisesById = new Map(exerciseRecords.map((exercise) => [exercise.id, exercise]));

function words(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

const searchable = new Map(catalog.map((item) => [item.id, words([
  item.name, item.description, item.category, ...item.muscles, ...item.equipment,
  ...(item.primaryMuscles ?? []), ...(item.secondaryMuscles ?? []), ...(item.equipment.length ? [] : ['Bodyweight', 'No equipment']),
].join(' '))]));

export function recommend({ targets, detail, available, query, recent, level, category }) {
  const terms = words(query);
  return catalog
    .filter((item) => (
      (!targets.length || item.muscles.some((muscle) => targets.includes(muscle))) &&
      (!detail || item.primaryMuscles.includes(detail) || item.secondaryMuscles.includes(detail)) &&
      (available === null || item.equipment.every((item) => available.includes(item))) &&
      (!level || item.level === level) &&
      (!category || item.category === category) &&
      terms.every((term) => searchable.get(item.id).some((word) => word.startsWith(term) || term === word + 's'))
    ))
    .map((exercise, index) => ({
      exercise,
      index,
      score: (targets.includes(exercise.muscles[0]) ? 4 : 0)
        + exercise.muscles.filter((muscle) => targets.includes(muscle)).length
        + (detail && exercise.primaryMuscles.includes(detail) ? 4 : 0)
        + (recent.has(exercise.id) ? 0.25 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ exercise }) => exercise);
}
