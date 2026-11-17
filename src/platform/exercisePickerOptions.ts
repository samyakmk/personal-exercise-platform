import { exerciseNameScore, exerciseSearchTerms } from '../../shared/exercise-search.mjs';

type Option = { value: string; label: string; detail?: string };

export type ExercisePickerProps = {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function matchingExercises(options: Option[], query: string) {
  if (!exerciseSearchTerms(query).length) return options;
  return options.map((option) => ({ option, score: exerciseNameScore(option.value, option.label, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ option }) => option);
}
