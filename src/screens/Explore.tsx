import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, Dumbbell, Search, SearchX, SlidersHorizontal, Sparkles, X } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { api, RequestError } from '../api';
import { ExerciseCard } from '../components/ExerciseCard';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { Sheet } from '../components/Sheet';
import { Button, Chip, Copy, Empty, IconButton, Input, Loading, Notice, PageTitle, Panel, ViewTab } from '../components/ui';
import { SelectField } from '../platform/fields';
import { color } from '../theme';
import type { EquipmentMode, Exercise, Recommendation } from '../types';
import { useWorkspace } from '../workspace';

export function Explore() {
  const { data, mutate, recommendationContext, announce } = useWorkspace();
  const router = useRouter();
  const { exercise: requested, muscles, equipment, level: difficulty, saved: savedFilter } = useLocalSearchParams<{
    exercise?: string; muscles?: string; equipment?: string; level?: string; saved?: string;
  }>();
  const muscleOptions = data?.muscles;
  const targets = useMemo(() => {
    const requestedTargets = typeof muscles === 'string' ? muscles.split(',') : [];
    return muscleOptions?.filter((muscle) => requestedTargets.includes(muscle)) ?? [];
  }, [muscles, muscleOptions]);
  const modeOverride = equipment === 'all' || equipment === 'saved' || equipment === 'bodyweight' ? equipment : null;
  const preferredMode = data?.equipment == null ? 'all' : data.equipment.length ? 'saved' : 'bodyweight';
  const mode = modeOverride === 'saved' && preferredMode !== 'saved' ? preferredMode : modeOverride ?? preferredMode;
  const [search, setSearch] = useState('');
  const level = difficulty === 'Beginner' || difficulty === 'Intermediate' ? difficulty : null;
  const savedOnly = savedFilter === '1';
  const [result, setResult] = useState<{ key: string; items: Exercise[] } | null>(null);
  const [coaching, setCoaching] = useState<{ key: string; pending?: boolean; error?: string; picks?: Recommendation[]; retryAt?: number } | null>(null);
  const coachingRequest = useRef<AbortController | null>(null);
  const equipmentKey = JSON.stringify(data?.equipment);
  const selectionKey = JSON.stringify([targets, mode, search, level, equipmentKey]);
  const coachingKey = JSON.stringify([selectionKey, recommendationContext]);
  const saved = data?.bookmarks ?? [];
  const results = result?.key === selectionKey ? result.items.filter(({ id }) => !savedOnly || saved.includes(id)) : null;
  const currentCoaching = coaching?.key === coachingKey ? coaching : null;
  const hasPicks = Boolean(currentCoaching?.picks?.length);
  const retryAt = currentCoaching?.retryAt;
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const workspaceReady = Boolean(data);
  const selected = data?.catalog.find(({ id }) => id === requested);
  const width = useWindowDimensions().width;
  const columns = width >= 1160 ? 3 : width >= 640 ? 2 : 1;
  const cardBasis = columns === 3 ? '31%' : columns === 2 ? '47%' : '100%';

  useEffect(() => {
    if (!workspaceReady) return;
    const controller = new AbortController();
    setError('');
    const timer = setTimeout(() => {
      api.exercises(targets, mode, search, level, controller.signal).then((items) => {
        if (!controller.signal.aborted) setResult({ key: selectionKey, items });
      }, (failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    }, search ? 140 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [workspaceReady, targets, mode, search, level, selectionKey, retry]);

  useEffect(() => {
    setCoaching(null);
    return () => {
      coachingRequest.current?.abort();
      coachingRequest.current = null;
    };
  }, [coachingKey, savedOnly]);

  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(() => {
      setCoaching((current) => current?.retryAt === retryAt ? { ...current, retryAt: undefined } : current);
    }, Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt]);

  if (!data) return null;

  const openExercise = (exercise: Exercise) => router.setParams({ exercise: exercise.id });
  const closeExercise = () => router.setParams({ exercise: undefined });

  async function getRecommendations() {
    if (coachingRequest.current || retryAt) return;
    const controller = new AbortController();
    coachingRequest.current = controller;
    setCoaching({ key: coachingKey, pending: true });
    try {
      const picks = await api.recommendations(targets, mode, search, level, controller.signal);
      if (!controller.signal.aborted) setCoaching({ key: coachingKey, picks });
    } catch (failure) {
      if (!controller.signal.aborted) {
        const seconds = failure instanceof RequestError ? failure.retryAfter : undefined;
        setCoaching({ key: coachingKey, error: (failure as Error).message,
          retryAt: seconds ? Date.now() + Math.min(300, seconds) * 1000 : undefined });
      }
    } finally {
      if (coachingRequest.current === controller) coachingRequest.current = null;
    }
  }

  const filterOptions: { value: EquipmentMode; label: string }[] = [
    { value: 'all', label: 'Any equipment' },
    ...(data.equipment === null || data.equipment.length === 0 ? [] : [{ value: 'saved' as const, label: 'Use saved equipment' }]),
    { value: 'bodyweight', label: 'Bodyweight only' },
  ];

  function reset() {
    setSearch('');
    router.setParams({ muscles: undefined, equipment: preferredMode === 'all' ? undefined : 'all', level: undefined });
  }

  function toggleTarget(muscle: string) {
    const next = targets.includes(muscle) ? targets.filter((item) => item !== muscle) : [...targets, muscle];
    router.setParams({ muscles: next.length ? next.join(',') : undefined });
  }

  const showAllExercises = () => router.setParams({ saved: undefined });

  const filtered = Boolean(search.trim() || targets.length || mode !== 'all' || level);
  const filterCount = Number(mode !== 'all') + Number(Boolean(level));

  return <View style={styles.page}>
    <PageTitle title="Exercise library" summary="Find a movement that fits your training and equipment." />

    <View style={styles.controls}>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Input label="Search exercises" hideLabel icon={Search} placeholder="Search exercises"
            value={search} onChangeText={setSearch} maxLength={100} />
          {!!search && <IconButton label="Clear search" icon={X} onPress={() => setSearch('')} size={43} />}
        </View>
        <View style={styles.tools}>
          <Button compact icon={SlidersHorizontal} end={ChevronDown} aria-expanded={showFilters}
            onPress={() => setShowFilters((value) => !value)}>{filterCount ? `Filters (${filterCount})` : 'Filters'}</Button>
          <Button compact kind="quiet" icon={Dumbbell} onPress={() => setOpen(true)}>My equipment</Button>
        </View>
      </View>

      <View accessibilityLabel="Target muscles" role="group" style={styles.chips}>
        <Chip label="All muscles" selected={!targets.length} onPress={() => router.setParams({ muscles: undefined })} />
        {data.muscles.map((muscle) => (
          <Chip key={muscle} label={muscle} selected={targets.includes(muscle)} onPress={() => toggleTarget(muscle)} />
        ))}
      </View>

      {showFilters && <Panel style={styles.advanced}>
        <View style={styles.filterRow}>
          <View style={{ gap: 7, flexShrink: 1 }}>
            <Copy size={12} weight="semibold">Equipment</Copy>
            <View style={styles.chips}>
              {filterOptions.map(({ value, label }) => (
                <Chip key={value} label={label} selected={mode === value} onPress={() => router.setParams({ equipment: value })} />
              ))}
            </View>
          </View>
          <View style={{ minWidth: 145 }}>
            <SelectField label="Difficulty" value={level ?? ''} onChange={(value) => router.setParams({ level: value || undefined })}
              options={[{ label: 'Any level', value: '' }, { label: 'Beginner', value: 'Beginner' }, { label: 'Intermediate', value: 'Intermediate' }]} />
          </View>
        </View>
      </Panel>}

      <View style={styles.resultsBar}>
        <View role="group" accessibilityLabel="Library view" style={styles.tabs}>
          <ViewTab label="All exercises" selected={!savedOnly} onPress={showAllExercises} />
          <ViewTab label={`Saved exercises (${saved.length})`} selected={savedOnly} onPress={() => router.setParams({ saved: '1' })} />
        </View>
        {data.aiAvailable && !savedOnly && !hasPicks && <Button icon={Sparkles} kind="quiet" compact
          disabled={currentCoaching?.pending || Boolean(retryAt) || !results?.length}
          onPress={getRecommendations}>{currentCoaching?.pending ? 'Finding picks…' : retryAt ? 'Retry shortly' : currentCoaching?.error ? 'Try again' : 'Get recommendations'}</Button>}
      </View>
    </View>

    {data.aiAvailable && !savedOnly && currentCoaching && <View style={styles.coaching}>
      {currentCoaching.pending && <Loading label="Ranking matching exercises…" />}
      {currentCoaching.error && <Notice error>{currentCoaching.error}</Notice>}
      {currentCoaching.picks?.length === 0 && <Notice>No exercises match your current filters.</Notice>}
      {hasPicks && <Panel style={styles.picks}>
        <View style={styles.pickHeading}>
          <Sparkles aria-hidden size={16} color={color.plum} />
          <Copy accessibilityRole="header" aria-level={2} size={14} weight="bold">Recommended for you</Copy>
        </View>
        {currentCoaching.picks?.map(({ exerciseId, reason }) => {
          const exercise = data.catalog.find((item) => item.id === exerciseId);
          return exercise && <View key={exerciseId} style={styles.pick}>
            <Button compact kind="quiet" end={ArrowUpRight} onPress={() => openExercise(exercise)}>{exercise.name}</Button>
            <Copy size={13} tone={color.muted}>{reason}</Copy>
          </View>;
        })}
      </Panel>}
    </View>}

    {error ? <Notice error action={<Button compact onPress={() => setRetry((value) => value + 1)}>Retry</Button>}>{error}</Notice>
      : results === null ? <Loading label="Finding exercises…" />
      : results.length === 0 ? <Empty icon={SearchX} title={savedOnly && !saved.length ? 'No saved exercises yet' : 'No matching exercises'}
        message={savedOnly && !saved.length ? 'Open a demonstration and save the exercises you want to practice again.' : 'Try a different muscle group, equipment filter, or search.'}
        action={savedOnly && !saved.length ? <Button compact onPress={showAllExercises}>Browse exercises</Button>
          : <Button compact onPress={reset}>Clear filters</Button>} />
      : <View style={{ gap: 10 }}>
        <View style={styles.resultMeta}>
          <Copy size={12} tone={color.muted} accessibilityLiveRegion="polite">{results.length} {results.length === 1 ? 'exercise' : 'exercises'}</Copy>
          {filtered && <Button compact kind="quiet" onPress={reset}>Clear filters</Button>}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {results.map((exercise) => <View key={exercise.id} style={{ flexBasis: cardBasis, flexGrow: 1, minWidth: 0 }}>
            <ExerciseCard exercise={exercise} saved={saved.includes(exercise.id)} onPress={() => openExercise(exercise)} />
          </View>)}
          {Array.from({ length: (columns - results.length % columns) % columns }, (_, index) =>
            <View key={`space-${index}`} aria-hidden style={{ flexBasis: cardBasis, flexGrow: 1, minWidth: 0 }} />)}
        </View>
      </View>}

    <Link href="/photo-credits" style={{ alignSelf: 'flex-start' }}>
      <Copy size={12} tone={color.plum} style={{ textDecorationLine: 'underline' }}>Photo credits</Copy>
    </Link>
    {selected && <ExerciseSheet key={selected.id} exercise={selected} onClose={closeExercise} />}
    {open && <EquipmentSheet options={data.equipmentOptions} initial={data.equipment} onClose={() => setOpen(false)}
      save={async (value) => {
        await mutate(() => api.setEquipment(value));
        router.setParams({ equipment: undefined });
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
  page: { gap: 15 },
  controls: { gap: 12 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9 },
  search: { flex: 1, minWidth: 200, maxWidth: 475, flexDirection: 'row', gap: 6 },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  advanced: { padding: 14 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  resultsBar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: color.line },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  resultMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 31 },
  coaching: { gap: 5 },
  picks: { padding: 13, backgroundColor: color.tint, gap: 7 },
  pickHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  pick: { borderTopWidth: 1, borderColor: color.line, paddingTop: 3, gap: 2 },
});
