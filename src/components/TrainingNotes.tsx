import { useState } from 'react';
import { Link } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { color } from '../theme';
import type { TrainingNoteInput } from '../types';
import { useWorkspace } from '../workspace';
import { Copy, IconButton, Notice, Panel, SectionTitle } from './ui';

export function trainingNoteEffect({ kind }: TrainingNoteInput, name?: string) {
  if (kind === 'shorter') return 'Keep suggested workouts shorter';
  if (kind === 'avoid') return 'Leave ' + (name ?? 'this exercise') + ' out of suggested workouts';
  if (kind === 'prefer') return 'Favor ' + (name ?? 'this exercise') + ' when it fits';
  return 'Use as context for future suggestions in Chat';
}

export function TrainingNotes() {
  const { api, data, exerciseRecords, mutate, announce } = useWorkspace();
  const [removing, setRemoving] = useState<string>();
  const [error, setError] = useState('');
  const notes = data?.trainingNotes ?? [];

  async function remove(id: string) {
    if (removing) return;
    setRemoving(id);
    setError('');
    try {
      await mutate(() => api.removeTrainingNote(id));
      announce('Training note removed.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setRemoving(undefined); }
  }

  return <Panel style={styles.panel}>
    <SectionTitle title="Training notes" summary="Review the notes you saved from Chat. Remove any that no longer apply." />
    {notes.length === 0 ? <Copy size={13} tone={color.muted}>No notes yet. Share an observation or something your trainer said in <Link href="/chat" style={styles.link}>Chat</Link>.</Copy>
      : notes.map((note, index) => <View key={note.id} style={styles.row}>
        <View style={styles.detail}>
          <Copy size={13}>{note.text}</Copy>
          <Copy size={12} tone={color.muted}>{trainingNoteEffect(note, exerciseRecords.get(note.exerciseId ?? '')?.name)}</Copy>
        </View>
        <IconButton icon={Trash2} label={'Remove training note ' + (index + 1)} disabled={Boolean(removing)} onPress={() => void remove(note.id)} />
      </View>)}
    {error !== '' && <Notice error>{error}</Notice>}
  </Panel>;
}

const styles = StyleSheet.create({
  panel: { gap: 12, padding: 19 },
  row: { borderTopColor: color.line, borderTopWidth: 1, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  detail: { flex: 1, minWidth: 0, gap: 4 },
  link: { color: color.forest, textDecorationLine: 'underline' },
});
