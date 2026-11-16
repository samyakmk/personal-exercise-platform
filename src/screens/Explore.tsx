import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ChevronDown, Dumbbell, Search, SearchX, SlidersHorizontal, Sparkles, X } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { ExerciseCard } from '../components/ExerciseCard';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { RecommendationPanel, RefinementControls } from '../components/RecommendationControls';
import { Sheet } from '../components/Sheet';
import { Button, Chip, Copy, Empty, IconButton, Input, Loading, Notice, PageTitle, Panel, ViewTab } from '../components/ui';
import { muscleNames } from '../muscleWork';
import { SelectField } from '../platform/fields';
import { color } from '../theme';
import type { EquipmentMode, Exercise, ExerciseFilters, ExerciseRefinement, Refinement } from '../types';
import { useRecommendationRequest } from '../useRecommendationRequest';
import { useWorkspace } from '../workspace';

const pageSize = 30;

export function Explore() {
  const { api, data, mutate, recommendationContext, announce } = useWorkspace();
  const router = useRouter();
  const { exercise: requested, muscles, detail: detailParam, equipment, level: difficulty, saved: savedFilter, category: categoryParam } = useLocalSearchParams<{
    exercise?: string; muscles?: string; detail?: string; equipment?: string; level?: string; saved?: string; category?: string;
  }>();
  const muscleOptions = data?.muscles;
  const targets = useMemo(() => {
    const requestedTargets = typeof muscles === 'string' ? muscles.split(',') : [];
    return muscleOptions?.filter((muscle) => requestedTargets.includes(muscle)) ?? [];
  }, [muscles, muscleOptions]);
  const detail = muscleNames.find((muscle) => muscle === detailParam) ?? null;
  const modeOverride = equipment === 'all' || equipment === 'saved' || equipment === 'bodyweight' ? equipment : null;
  const preferredMode = data?.equipment == null ? 'all' : data.equipment.length ? 'saved' : 'bodyweight';
  const mode = modeOverride === 'saved' && preferredMode !== 'saved' ? preferredMode : modeOverride ?? preferredMode;
  const [search, setSearch] = useState('');
  const level = difficulty === 'Beginner' || difficulty === 'Intermediate' || difficulty === 'Advanced' ? difficulty : null;
  const category = categoryParam && data?.exerciseCategories?.includes(categoryParam) ? categoryParam : null;
  const filters = useMemo<ExerciseFilters>(() => ({ targets, detail, mode, query: search, level, category }),
    [targets, detail, mode, search, level, category]);
  const savedOnly = savedFilter === '1';
  const [result, setResult] = useState<{ key: string; items: Exercise[] } | null>(null);
  const equipmentKey = JSON.stringify(data?.equipment);
  const selectionKey = JSON.stringify([filters, equipmentKey]);
  const coachingKey = JSON.stringify([selectionKey, recommendationContext, savedOnly]);
  const coaching = useRecommendationRequest(coachingKey, (refinement: ExerciseRefinement | undefined, signal) =>
    api.recommendations(filters, signal, refinement));
  const saved = useMemo(() => {
    const bookmarks = new Set(data?.bookmarks);
    return new Set(data?.catalog.filter(({ id }) => bookmarks.has(id)).map(({ id }) => id));
  }, [data?.catalog, data?.bookmarks]);
  const results = result?.key === selectionKey ? result.items.filter(({ id }) => !savedOnly || saved.has(id)) : null;
  const resultKey = JSON.stringify([selectionKey, savedOnly]);
  const [shown, setShown] = useState({ key: '', count: pageSize });
  const showCount = shown.key === resultKey ? shown.count : pageSize;
  const visibleResults = results?.slice(0, showCount) ?? [];
  const picks = coaching.result;
  const hasPicks = Boolean(picks?.length);
  const waiting = Boolean(coaching.pending || coaching.retryAt);
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
      api.exercises(filters, controller.signal).then((items) => {
        if (!controller.signal.aborted) setResult({ key: selectionKey, items });
      }, (failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    }, search ? 140 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [workspaceReady, filters, search, selectionKey, retry]);

  if (!data) return null;

  const openExercise = (exercise: Exercise) => router.setParams({ exercise: exercise.id });
  const closeExercise = () => router.setParams({ exercise: undefined });

  function refine(adjustment: Refinement) {
    if (picks?.length) void coaching.run({ adjustment, previous: picks.map(({ exerciseId }) => exerciseId) });
  }

  const changed = coaching.input && picks && !coaching.pending && !coaching.error
    ? picks.length !== coaching.input.previous.length || picks.some(({ exerciseId }, i) => exerciseId !== coaching.input?.previous[i])
    : undefined;
  const unchangedMessage = coaching.input && {
    easier: 'No easier alternative matches these filters.', harder: 'No harder alternative matches these filters.',
    shorter: 'There’s already only one pick.', longer: 'There are no more picks to add with these filters and the five-pick limit.',
  }[coaching.input.adjustment];

  const filterOptions: { value: EquipmentMode; label: string }[] = [
    { value: 'all', label: 'Any equipment' },
    ...(data.equipment === null || data.equipment.length === 0 ? [] : [{ value: 'saved' as const, label: 'Use saved equipment' }]),
    { value: 'bodyweight', label: 'Bodyweight only' },
  ];

  function reset() {
    setSearch('');
    router.setParams({ muscles: undefined, detail: undefined, equipment: preferredMode === 'all' ? undefined : 'all',
      level: undefined, category: undefined, video: undefined });
  }

  function toggleTarget(muscle: string) {
    const next = targets.includes(muscle) ? targets.filter((item) => item !== muscle) : [...targets, muscle];
    router.setParams({ muscles: next.length ? next.join(',') : undefined });
  }

  const showAllExercises = () => router.setParams({ saved: undefined });

  const filterCount = Number(mode !== 'all') + Number(Boolean(level)) + Number(Boolean(category));
  const filtered = Boolean(search.trim() || targets.length || detail || filterCount);

  return <View style={styles.page}>
    <PageTitle title="Exercise library" summary="Find a movement that fits your training and equipment." />
    {requested && !selected && <Notice action={<Button compact kind="quiet" onPress={closeExercise}>Dismiss</Button>}>
      This exercise is no longer in the library.
    </Notice>}

    {data.aiAvailable && !savedOnly && <RecommendationPanel title="Find exercises with AI"
      detail="Get a shortlist based on your filters, equipment, and recent training. Adjust the picks until they fit.">
      {!hasPicks && !coaching.pending && <Button icon={Sparkles} kind="primary" disabled={waiting || !results?.length}
        onPress={coaching.error ? coaching.retry : () => coaching.run(undefined)}>
        {coaching.retryAt ? 'Retry shortly' : coaching.error ? 'Try again' : 'Get AI recommendations'}
      </Button>}
      {coaching.pending && <Loading label={hasPicks ? 'Refining your picks…' : 'Finding your picks…'} />}
      {coaching.error && <Notice error>{coaching.error}</Notice>}
      {picks?.length === 0 && <Notice>No exercises match your current filters.</Notice>}
      {!!picks?.length && <>
        <Copy accessibilityRole="header" aria-level={3} size={15} weight="bold">Recommended for you</Copy>
        {picks.map(({ exerciseId, reason }) => {
          const exercise = data.catalog.find((item) => item.id === exerciseId);
          return exercise && <View key={exerciseId} style={styles.pick}>
            <View style={styles.pickTitle}>
              <Button compact kind="quiet" end={ArrowUpRight} onPress={() => openExercise(exercise)}>{exercise.name}</Button>
              <Copy size={12} tone={color.plum}>{exercise.level}</Copy>
            </View>
            <Copy size={13} tone={color.muted}>{reason}</Copy>
          </View>;
        })}
        <RefinementControls onRefine={refine} disabled={waiting} exerciseList />
        {changed !== undefined && <Notice>{changed ? 'Recommendations updated.' : unchangedMessage ?? ''}</Notice>}
        {coaching.error && <Button compact disabled={waiting} onPress={coaching.retry}>{waiting ? 'Retry shortly' : 'Retry refinement'}</Button>}
      </>}
    </RecommendationPanel>}

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
        <Chip label="All muscles" selected={!targets.length && !detail}
          onPress={() => router.setParams({ muscles: undefined, detail: undefined })} />
        {data.muscles.map((muscle) => (
          <Chip key={muscle} label={muscle} selected={targets.includes(muscle)} onPress={() => toggleTarget(muscle)} />
        ))}
      </View>
      {detail && <View style={styles.chips}>
        <Button compact end={X} accessibilityLabel={`Clear ${detail} filter`}
          onPress={() => router.setParams({ detail: undefined })}>{detail}</Button>
      </View>}

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
              options={[{ label: 'Any level', value: '' }, { label: 'Beginner', value: 'Beginner' }, { label: 'Intermediate', value: 'Intermediate' }, { label: 'Advanced', value: 'Advanced' }]} />
          </View>
          {!!data.exerciseCategories?.length && <View style={{ minWidth: 145 }}>
            <SelectField label="Exercise type" value={category ?? ''} onChange={(value) => router.setParams({ category: value || undefined })}
              options={[{ label: 'Any type', value: '' }, ...data.exerciseCategories.map((value) => ({ label: value, value }))]} />
          </View>}
        </View>
      </Panel>}

      <View style={styles.resultsBar}>
        <View role="group" accessibilityLabel="Library view" style={styles.tabs}>
          <ViewTab label="All exercises" selected={!savedOnly} onPress={showAllExercises} />
          <ViewTab label={`Saved exercises (${saved.size})`} selected={savedOnly} onPress={() => router.setParams({ saved: '1' })} />
        </View>
      </View>
    </View>

    {error ? <Notice error action={<Button compact onPress={() => setRetry((value) => value + 1)}>Retry</Button>}>{error}</Notice>
      : results === null ? <Loading label="Finding exercises…" />
      : results.length === 0 ? <Empty icon={SearchX} title={savedOnly && !saved.size ? 'No saved exercises yet' : 'No matching exercises'}
        message={savedOnly && !saved.size ? 'Save the exercises you want to practice again.' : 'Try a different muscle group, equipment filter, or search.'}
        action={savedOnly && !saved.size ? <Button compact onPress={showAllExercises}>Browse exercises</Button>
          : <Button compact onPress={reset}>Clear filters</Button>} />
      : <View style={{ gap: 10 }}>
        <View style={styles.resultMeta}>
          <Copy size={12} tone={color.muted} accessibilityLiveRegion="polite">{results.length} {results.length === 1 ? 'exercise' : 'exercises'}</Copy>
          {filtered && <Button compact kind="quiet" onPress={reset}>Clear filters</Button>}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {visibleResults.map((exercise) => <View key={exercise.id} style={{ flexBasis: cardBasis, flexGrow: 1, minWidth: 0 }}>
            <ExerciseCard exercise={exercise} saved={saved.has(exercise.id)} onPress={() => openExercise(exercise)} />
          </View>)}
          {Array.from({ length: (columns - visibleResults.length % columns) % columns }, (_, index) =>
            <View key={`space-${index}`} aria-hidden style={{ flexBasis: cardBasis, flexGrow: 1, minWidth: 0 }} />)}
        </View>
        {results.length > showCount && <Button compact onPress={() => setShown({ key: resultKey, count: showCount + pageSize })}>
          Show more exercises
        </Button>}
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
  pickTitle: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  pick: { borderTopWidth: 1, borderColor: color.line, paddingTop: 3, gap: 2 },
});
