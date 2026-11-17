const urgentSymptoms = /\b(?:chest (?:pain|pressure|tightness|hurts)|(?:pain|pressure|tightness) in (?:my|the) chest|can(?:not|['’]t) (?:breathe|catch (?:my|a) breath)|(?:trouble|difficulty) breathing|(?:severe|extreme) shortness of breath|fainted|passed out|passing out|(?:feel|feeling|felt) faint|going to (?:faint|pass out))\b/i;
const painfulSymptoms = /\b(?:pain(?![- ]free\b)|painful|hurts?|aching|injur(?:ed|y)|dizz(?:y|iness)|light[- ]?headed(?:ness)?|numb(?:ness)?)\b/i;
const historical = /\b(?:years? ago|months? ago|last year|last month|a previous injury|history of|healed|fully recovered)\b/i;
const current = /\b(?:now|today|still|again|currently|at the moment|i (?:feel|have(?! (?:a history of|a previous|an old))|am having|can(?:not|['’]t)))\b/i;
const resolved = /^\s*(?:it|the (?:pain|injury|symptoms?))\s+(?:(?:is|are|has|have)\s+)?(?:gone|resolved|healed|stopped)\b/i;
const negation = /\b(?:no|without|never|(?:do|does|did|is|was|were)(?: not|n['’]t)|haven['’]t|hasn['’]t)\s+(?:(?:feel|felt|have|had|having|experience|experienced)\s+)?(?:(?:any|a|an|the|my|sharp|severe|chest|knee|back|hip|shoulder)\s+){0,4}$/i;
const negatedList = /\b(?:no|without)\s+.{0,55}\bor\s+(?:(?:any|a|an|the|my|sharp|severe|chest|knee|back|hip|shoulder)\s+){0,4}$/i;

function mentionsSymptom(clause, pattern) {
  for (const match of clause.matchAll(new RegExp(pattern.source, 'gi'))) {
    const prefix = clause.slice(0, match.index);
    if (!negation.test(prefix) && !negatedList.test(prefix)) return true;
  }
  return false;
}

export const urgentWorkoutReply = 'Stop the workout now and call your local emergency number.';
export const pauseWorkoutReply = 'Stop the exercise and pause the workout. If pain or other symptoms persist or concern you, seek medical advice.';

export function workoutSafetyReply(question) {
  const clauses = question.split(/[.!?;]+|,\s*|\b(?:but|however|although|and)\b/i);
  let pause = false;
  for (const [index, clause] of clauses.entries()) {
    const atPresent = current.test(clause);
    if (!atPresent && (historical.test(clause) || resolved.test(clause) || resolved.test(clauses[index + 1] ?? ''))) continue;
    if (mentionsSymptom(clause, urgentSymptoms)) return urgentWorkoutReply;
    if (mentionsSymptom(clause.replace(new RegExp(urgentSymptoms.source, 'gi'), ''), painfulSymptoms)) pause = true;
  }
  return pause ? pauseWorkoutReply : null;
}
