import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Button, Copy, Input } from '../components/ui';
import { color } from '../theme';
import { matchingExercises } from './exercisePickerOptions';
import type { ExercisePickerProps } from './exercisePickerOptions';

export function ExercisePicker({ label, options, value, onChange, disabled }: ExercisePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const matches = open && !disabled ? matchingExercises(options, query) : [];
  const selected = options.find((option) => option.value === value);

  function toggle() {
    setQuery('');
    setLimit(50);
    setOpen(!open);
  }

  return <View style={{ gap: 7 }}>
    <Copy size={12} weight="semibold">{label}</Copy>
    <Button disabled={disabled} end={open ? ChevronUp : ChevronDown}
      accessibilityLabel={`${label}, ${selected?.label ?? 'Choose an exercise'}`} aria-expanded={open && !disabled}
      style={{ alignSelf: 'stretch', justifyContent: 'space-between' }} onPress={toggle}>
      {selected?.label ?? 'Choose an exercise'}
    </Button>
    {open && !disabled && <>
      <Input label="Search exercises" hideLabel placeholder="Type an exercise name" value={query}
        onChangeText={(text) => { setQuery(text); setLimit(50); }} />
      {matches.length === 0 ? <Copy size={13} tone={color.muted}>No matching exercises</Copy>
        : <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 240,
          borderWidth: 1, borderColor: color.line, borderRadius: 8 }}>
          {matches.slice(0, limit).map((option) => <Pressable key={option.value} accessibilityRole="button"
            accessibilityState={{ selected: option.value === value }}
            onPress={() => { toggle(); onChange(option.value); }}
            style={{ padding: 10, backgroundColor: option.value === value ? color.tint : color.surface }}>
            <Copy size={14}>{option.label}{option.detail ? ` · ${option.detail}` : ''}</Copy>
          </Pressable>)}
          {matches.length > limit && <Button compact kind="quiet" onPress={() => setLimit(limit + 50)}>Show more exercises</Button>}
        </ScrollView>}
    </>}
  </View>;
}
