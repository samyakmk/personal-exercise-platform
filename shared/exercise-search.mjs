const aliases = {
  'dumbbell-bench-press': ['db bench', 'db press', 'dumbbell press', 'dumbbell flat bench'],
  'dumbbell-curl': ['db curl', 'dumbbell curl'],
  'dumbbell-rdl': ['rdl', 'db rdl', 'romanian deadlift'],
  'dumbbell-row': ['db row', 'one arm row', 'single arm row', 'one arm dumbbell row'],
  'dumbbell-shoulder-press': ['db press', 'db shoulder press', 'overhead press'],
  'fedb-chin-up': ['chinup', 'chin ups'],
};

export function exerciseSearchTerms(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/ +/).filter(Boolean)
    .map((word) => ({ db: 'dumbbell', pushups: 'pushup', pullups: 'pullup', chinups: 'chinup' })[word] ?? word);
}

export function matchesExerciseTerms(words, terms) {
  return terms.every((term) => words.some((word) => word.startsWith(term) || term === word + 's'));
}

export function exerciseNameScore(id, name, query) {
  const terms = exerciseSearchTerms(query);
  if (!terms.length) return 0;
  const phrase = terms.join(' ');
  const words = exerciseSearchTerms(name);
  const label = words.join(' ');
  if (label === phrase || words.join('') === terms.join('')) return 4;
  if (Object.hasOwn(aliases, id) && aliases[id].some((alias) => exerciseSearchTerms(alias).join(' ') === phrase)) return 3;
  if (label.startsWith(phrase)) return 2;
  return matchesExerciseTerms(words, terms) ? 1 : 0;
}
