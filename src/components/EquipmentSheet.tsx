import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useWorkspace } from '../workspace';
import { Sheet } from './Sheet';
import { Button, Chip, Notice } from './ui';

export function EquipmentSheet({ onClose, temporary }: {
  onClose: (saved?: boolean) => void;
  temporary?: { value?: string[]; onChange: (value: string[] | undefined) => void };
}) {
  const { api, data, mutate, announce } = useWorkspace();
  const options = data?.equipmentOptions ?? [];
  const [value, setValue] = useState<string[] | null>(temporary ? temporary.value ?? null : data?.equipment ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);

  async function submit() {
    if (temporary) {
      temporary.onChange(value ?? undefined);
      onClose();
      return;
    }
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await mutate(() => api.setEquipment(value));
      announce('Equipment preferences updated.');
      onClose(true);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return <Sheet title={temporary ? 'Equipment for this session' : 'My equipment'}
    detail={temporary ? 'Choose the gear available for this suggestion. Your saved equipment stays available for next time.'
      : 'Set your usual gear. With equipment unset, workout suggestions use bodyweight and the library shows all equipment.'}
    onClose={() => { if (!saving.current) onClose(); }}>
    <View style={styles.chips} aria-disabled={busy}>
      <Chip label={temporary ? 'Use saved equipment' : 'Equipment not set'} selected={value === null} disabled={busy}
        onPress={() => setValue(null)} />
      <Chip label="Bodyweight only" selected={value?.length === 0} disabled={busy} onPress={() => setValue([])} />
      {options.map((item) => <Chip key={item} label={item} selected={Boolean(value?.includes(item))} disabled={busy}
        onPress={() => setValue((current) => current?.includes(item) ? current.filter((option) => option !== item) : [...(current ?? []), item])} />)}
    </View>
    {error !== '' && <Notice error>{error}</Notice>}
    <Button kind="primary" disabled={busy} onPress={submit}>{busy ? 'Saving…' : temporary ? 'Use this equipment' : 'Save equipment'}</Button>
  </Sheet>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
});
