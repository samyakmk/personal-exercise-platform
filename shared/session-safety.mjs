const urgentSymptoms = /\b(?:chest (?:pain|pressure|tightness|hurts)|(?:pain|pressure|tightness) in (?:my|the) chest|can(?:not|['’]t) breathe|(?:trouble|difficulty) breathing|(?:severe|extreme) shortness of breath|fainted|passed out|passing out|(?:feel|feeling|felt) faint|going to (?:faint|pass out))\b/i;
const painfulSymptoms = /\b(?:pain(?![- ]free\b)|painful|hurts?|aching|injur(?:ed|y)|dizz(?:y|iness)|light[- ]?headed(?:ness)?|numb(?:ness)?)\b/i;

export const urgentWorkoutReply = 'Stop the workout now and call your local emergency number.';
export const pauseWorkoutReply = 'Stop the exercise and pause the workout. If pain or other symptoms persist or concern you, seek medical advice.';

export function workoutSafetyReply(question) {
  if (urgentSymptoms.test(question)) return urgentWorkoutReply;
  if (painfulSymptoms.test(question)) return pauseWorkoutReply;
  return null;
}
