import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Search, SearchX, SlidersHorizontal } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { api } from '../api';
import { ExerciseCard } from '../components/ExerciseCard';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { Sheet } from '../components/Sheet';
import { Button, Chip, Copy, Empty, Input, Loading, Notice, PageTitle, Panel } from '../components/ui';
import { color } from '../theme';
import type { EquipmentMode, Exercise } from '../types';
import { useWorkspace } from '../workspace';

export function Explore() {
  const { data, mutate, revision, announce } = useWorkspace();
  const [targets, setTargets] = useState<string[]>([]);
  const [mode, setMode] = useState<EquipmentMode>(data?.equipment ? 'saved' : 'all');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Exercise[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Exercise | null>(null);
  const width = useWindowDimensions().width;
  const columns = width >= 1110 ? 3 : width >= 580 ? 2 : 1;

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    const timer = setTimeout(() => {
      api.exercises(targets, mode, search, controller.signal).then((items) => {
        if (!controller.signal.aborted) setResults(items);
      }, (failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    }, search ? 140 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [targets, mode, search, revision, retry]);

  if (!data) return null;

  const filterOptions: { value: EquipmentMode; label: string }[] = [
    { value: 'all', label: 'Any equipment' },
    ...(data.equipment === null ? [] : [{ value: 'saved' as const, label: 'My equipment' }]),
    { value: 'bodyweight', label: 'Bodyweight only' },
  ];

  function reset() {
    setSearch('');
    setTargets([]);
    setMode('all');
  }

  return <View style={{ gap: 15 }}>
    <PageTitle title="Exercise library" summary="Find a movement for your target muscles and available equipment."
      action={<Button icon={SlidersHorizontal} onPress={() => setOpen(true)}>My equipment</Button>} />

    <Panel style={styles.filters}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <View style={styles.searchIcon}><Search size={17} color={color.green} /></View>
        <Input label="Search exercises" placeholder="Search by exercise, muscle, or equipment" value={search} onChangeText={setSearch} maxLength={100} />
      </View>
      <View style={{ gap: 7 }}>
        <Copy size={12} weight="bold">Target muscles</Copy>
        <View style={styles.chips}>
          <Chip label="All muscles" selected={!targets.length} onPress={() => setTargets([])} />
          {data.muscles.map((muscle) => (
            <Chip key={muscle} label={muscle} selected={targets.includes(muscle)}
              onPress={() => setTargets((current) => current.includes(muscle) ? current.filter((item) => item !== muscle) : [...current, muscle])} />
          ))}
        </View>
      </View>
      <View style={{ gap: 7 }}>
        <Copy size={12} weight="bold">Equipment</Copy>
        <View style={styles.chips}>
          {filterOptions.map(({ value, label }) => (
            <Chip key={value} label={label} selected={mode === value} onPress={() => setMode(value)} />
          ))}
        </View>
      </View>
    </Panel>

    {error ? <Notice error action={<Button compact onPress={() => setRetry((value) => value + 1)}>Retry</Button>}>{error}</Notice>
      : results === null ? <Loading label="Finding exercises…" />
      : results.length === 0 ? <Empty icon={SearchX} title="No matching exercises" message="Try a different muscle group, equipment filter, or search."
        action={<Button compact onPress={reset}>Clear filters</Button>} />
      : <View style={{ gap: 10 }}>
        <Copy size={13} tone={color.muted} accessibilityLiveRegion="polite">{results.length} {results.length === 1 ? 'exercise' : 'exercises'}</Copy>
        {Array.from({ length: Math.ceil(results.length / columns) }, (_, row) => (
          <View key={row} style={{ flexDirection: 'row', gap: 12 }}>
            {Array.from({ length: columns }, (_, column) => {
              const exercise = results[row * columns + column];
              return <View key={column} style={{ flex: 1, minWidth: 0 }}>
                {exercise && <ExerciseCard exercise={exercise} onPress={() => setSelected(exercise)} />}
              </View>;
            })}
          </View>
        ))}
      </View>}

    <Link href="/photo-credits" style={{ alignSelf: 'flex-start' }}>
      <Copy size={12} tone={color.green} style={{ textDecorationLine: 'underline' }}>Photo credits</Copy>
    </Link>
    {selected && <ExerciseSheet exercise={selected} onClose={() => setSelected(null)} />}
    {open && <EquipmentSheet options={data.equipmentOptions} initial={data.equipment} onClose={() => setOpen(false)}
      save={async (value) => {
        await mutate(() => api.setEquipment(value));
        setMode(value === null ? 'all' : 'saved');
        announce('Equipment preferences updated.');
        setOpen(false);
      }} />}
  </View>;
}

function EquipmentSheet({ options, initial, save, onClose }: {
  options: string[]; initial: string[] | null; save: (value: string[] | null) => Promise<void>; onClose: () => void;
}) {
  const [value, setValue] = useState<string[] | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try { await save(value); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <Sheet title="My equipment" detail="Save the equipment you can use so exercise recommendations fit your setup." onClose={() => { if (!busy) onClose(); }}>
    <View style={styles.chips}>
      <Chip label="Any equipment" selected={value === null} onPress={() => setValue(null)} />
      <Chip label="Bodyweight only" selected={value?.length === 0} onPress={() => setValue([])} />
      {options.map((item) => <Chip key={item} label={item} selected={Boolean(value?.includes(item))}
        onPress={() => setValue((current) => current?.includes(item) ? current.filter((option) => option !== item) : [...(current ?? []), item])} />)}
    </View>
    {error !== '' && <Notice error>{error}</Notice>}
    <Button kind="primary" disabled={busy} onPress={submit}>{busy ? 'Saving…' : 'Save equipment'}</Button>
  </Sheet>;
}

const styles = StyleSheet.create({
  filters: { padding: 16, gap: 13 },
  searchIcon: { width: 43, height: 43, borderRadius: 8, backgroundColor: color.limeSoft, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
