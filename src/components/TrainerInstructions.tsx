import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { isPlannableExercise } from '../../shared/today-plan.mjs';
import { createId } from '../api';
import { ExercisePicker } from '../platform/ExercisePicker';
import { SelectField } from '../platform/fields';
import type { TrainerInstruction } from '../types';
import { useWorkspace } from '../workspace';
import { Button, Copy, Input, Notice, SectionTitle } from './ui';

const effects = [
  { value: 'cue', label: 'Show before this exercise' },
  { value: 'prefer', label: 'Prefer in suggestions' },
  { value: 'avoid', label: 'Leave out of suggestions' },
] as const;

export function TrainerInstructions({ items, onChange, disabled }: {
  items: TrainerInstruction[]; onChange: (items: TrainerInstruction[]) => void; disabled: boolean;
}) {
  const { data, exerciseRecords } = useWorkspace();
  const [draft, setDraft] = useState<TrainerInstruction>();
  const exercises = (data?.catalog ?? []).filter((exercise) => draft?.kind === 'cue' || isPlannableExercise(exercise));
  const duplicate = draft && items.some(({ id, exerciseId, kind }) => id !== draft.id && exerciseId === draft.exerciseId &&
    (kind === 'cue') === (draft.kind === 'cue'));
  const valid = draft && !duplicate && exercises.some(({ id }) => id === draft.exerciseId) && (draft.kind !== 'cue' || draft.text.trim());

  return <View style={styles.block}>
    <SectionTitle title="Trainer instructions" level={3} summary="Pin a cue to an exercise or choose how an exercise appears in suggestions. Apply the changes with Save profile." />
    {items.map((item) => {
      const name = exerciseRecords.get(item.exerciseId)?.name ?? item.exerciseId;
      return <View key={item.id} style={styles.row}>
        <View style={styles.description}>
          <Copy weight="semibold" size={14}>{name}</Copy>
          <Copy size={13}>{effects.find(({ value }) => value === item.kind)?.label}</Copy>
          {!!item.text && <Copy size={13}>{item.text}</Copy>}
        </View>
        <Button compact kind="quiet" icon={Pencil} disabled={disabled || Boolean(draft)} accessibilityLabel={`Edit instruction for ${name}`}
          onPress={() => setDraft(item)}>Edit</Button>
        <Button compact kind="quiet" icon={Trash2} disabled={disabled || Boolean(draft)} accessibilityLabel={`Remove instruction for ${name}`}
          onPress={() => onChange(items.filter(({ id }) => id !== item.id))}>Remove</Button>
      </View>;
    })}
    {draft ? <View style={styles.block}>
      <SelectField label="What should this instruction do?" value={draft.kind} options={[...effects]} disabled={disabled}
        onChange={(kind) => setDraft({ ...draft, kind: kind as TrainerInstruction['kind'] })} />
      <ExercisePicker label="Exercise for this instruction" value={draft.exerciseId} disabled={disabled} onChange={(exerciseId) => setDraft({ ...draft, exerciseId })}
        options={exercises.map(({ id, name }) => ({ value: id, label: name }))} />
      <Input label={draft.kind === 'cue' ? 'Cue to show during training' : 'Reason for this instruction'} value={draft.text}
        maxLength={300} multiline editable={!disabled} onChangeText={(text) => setDraft({ ...draft, text })} />
      {duplicate && <Notice error>Edit the existing instruction for this exercise first.</Notice>}
      <View style={styles.row}>
        <Button compact kind="primary" disabled={disabled || !valid} onPress={() => {
          const instruction = { ...draft, text: draft.text.trim() };
          onChange(items.some(({ id }) => id === draft.id) ? items.map((item) => item.id === draft.id ? instruction : item) : [...items, instruction]);
          setDraft(undefined);
        }}>Apply instruction</Button>
        <Button compact disabled={disabled} onPress={() => setDraft(undefined)}>Cancel</Button>
      </View>
    </View> : <Button compact icon={Plus} disabled={disabled || items.length >= 20} style={{ alignSelf: 'flex-start' }}
      onPress={() => setDraft({ id: createId(), kind: 'cue', exerciseId: '', text: '' })}>Add trainer instruction</Button>}
  </View>;
}

const styles = StyleSheet.create({
  block: { gap: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  description: { gap: 3, flexGrow: 1, flexBasis: 190 },
});
