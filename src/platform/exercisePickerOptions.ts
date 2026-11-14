type Option = { value: string; label: string; detail?: string };

export type ExercisePickerProps = {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function matchingExercises(options: Option[], query: string) {
  const search = normalize(query);
  if (!search) return options;

  const terms = search.split(' ');
  const prefixes: Option[] = [];
  const matches: Option[] = [];
  for (const option of options) {
    const name = normalize(option.label);
    if (name.startsWith(search)) {
      prefixes.push(option);
    } else {
      const words = name.split(' ');
      if (terms.every((term) => words.some((word) => word.startsWith(term)))) matches.push(option);
    }
  }
  return [...prefixes, ...matches];
}
