import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Dumbbell, Search, SearchX, X } from 'lucide-react-native';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ExerciseCard } from '../components/ExerciseCard';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { RecommendationPanel, RefinementControls } from '../components/RecommendationControls';
import { EquipmentSheet } from '../components/EquipmentSheet';
import { Button, Chip, Copy, Empty, IconButton, Input, Loading, Notice, PageTitle, Panel, ViewTab } from '../components/ui';
import { muscleNames } from '../muscleWork';
import { SelectField } from '../platform/fields';
import { color } from '../theme';
import type { EquipmentMode, Exercise, ExerciseFilters, ExerciseRefinement, Refinement } from '../types';
import { useRecommendationRequest } from '../useRecommendationRequest';
import { useWorkspace } from '../workspace';

const pageSize = 30;

export function Explore() {
  const { api, data, recommendationContext } = useWorkspace();
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

  const filtered = Boolean(search.trim() || targets.length || detail || mode !== 'all' || level || category);

  return <View style={styles.page}>
    <PageTitle title="Exercise library" />
    {requested && !selected && <Notice action={<Button compact kind="quiet" onPress={closeExercise}>Dismiss</Button>}>
      This exercise is no longer in the library.
    </Notice>}

    <View style={styles.controls}>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Input label="Search exercises" hideLabel icon={Search} placeholder="Search exercises"
            value={search} onChangeText={setSearch} maxLength={100} />
          {!!search && <IconButton label="Clear search" icon={X} onPress={() => setSearch('')} size={43} />}
        </View>
        <Button compact kind="quiet" icon={Dumbbell} onPress={() => setOpen(true)}>My equipment</Button>
      </View>

      {detail && <View style={styles.chips}>
        <Button compact end={X} accessibilityLabel={`Clear ${detail} filter`}
          onPress={() => router.setParams({ detail: undefined })}>{detail}</Button>
      </View>}

      <Panel style={styles.filters}>
        <View accessibilityLabel="Target muscles" role="group" style={{ gap: 7 }}>
          <Copy weight="semibold" size={13}>Target muscles</Copy>
          <View style={styles.chips}>
            <Chip label="All muscles" selected={!targets.length && !detail}
              onPress={() => router.setParams({ muscles: undefined, detail: undefined })} />
            {data.muscles.map((muscle) => (
              <Chip key={muscle} label={muscle} selected={targets.includes(muscle)} onPress={() => toggleTarget(muscle)} />
            ))}
          </View>
        </View>
        <View style={styles.filterRow}>
          <View role="group" accessibilityLabel="Equipment" style={styles.equipmentFilters}>
            <Copy size={12} weight="semibold">Equipment</Copy>
            <View style={styles.chips}>
              {filterOptions.map(({ value, label }) => (
                <Chip key={value} label={label} selected={mode === value} onPress={() => router.setParams({ equipment: value })} />
              ))}
            </View>
          </View>
          <View style={styles.selectFilters}>
            <View style={styles.selectFilter}>
              <SelectField label="Difficulty" value={level ?? ''} onChange={(value) => router.setParams({ level: value || undefined })}
                options={[{ label: 'Any level', value: '' }, { label: 'Beginner', value: 'Beginner' }, { label: 'Intermediate', value: 'Intermediate' }, { label: 'Advanced', value: 'Advanced' }]} />
            </View>
            {!!data.exerciseCategories?.length && <View style={styles.selectFilter}>
              <SelectField label="Exercise type" value={category ?? ''} onChange={(value) => router.setParams({ category: value || undefined })}
                options={[{ label: 'Any type', value: '' }, ...data.exerciseCategories.map((value) => ({ label: value, value }))]} />
            </View>}
          </View>
        </View>
      </Panel>

      <View style={styles.resultsBar}>
        <View role="group" accessibilityLabel="Library view" style={styles.tabs}>
          <ViewTab label="All exercises" selected={!savedOnly} onPress={showAllExercises} />
          <ViewTab label={`Saved exercises (${saved.size})`} selected={savedOnly} onPress={() => router.setParams({ saved: '1' })} />
        </View>
      </View>
    </View>

    {data.aiAvailable && !savedOnly && results?.length !== 0 && <RecommendationPanel
      title="Exercise recommendations"
      detail={hasPicks ? undefined : 'Based on your filters and recent training.'}
      action={!hasPicks && !coaching.pending ? <Button kind="primary" disabled={waiting || !results?.length}
        onPress={coaching.error ? coaching.retry : () => coaching.run(undefined)}>
        {coaching.retryAt ? 'Retry shortly' : coaching.error ? 'Try again' : 'Get recommendations'}
      </Button> : undefined}>
      {coaching.pending && <Loading label={hasPicks ? 'Refining your picks…' : 'Finding your picks…'} />}
      {coaching.error && <Notice error>{coaching.error}</Notice>}
      {picks?.length === 0 && <Notice>No exercises match your current filters.</Notice>}
      {!!picks?.length && <>
        <View role="list" accessibilityLabel="Recommended exercises">
          {picks.map(({ exerciseId, reason }) => {
            const exercise = data.catalog.find((item) => item.id === exerciseId);
            return exercise && <View role="listitem" key={exerciseId}>
              <Pressable accessibilityRole="button" onPress={() => openExercise(exercise)}
                style={({ hovered }) => [styles.pick, hovered && styles.pickHover]}>
                <View style={styles.pickBody}>
                  <Copy size={15} weight="semibold">{exercise.name}</Copy>
                  <Copy size={13} tone={color.muted}>{reason}</Copy>
                </View>
                <ChevronRight aria-hidden size={20} color={color.forest} />
              </Pressable>
            </View>;
          })}
        </View>
        <RefinementControls onRefine={refine} disabled={waiting} exerciseList />
        {changed !== undefined && <Copy role="status" accessibilityLiveRegion="polite" size={13} tone={color.forest}>
          {changed ? 'Recommendations updated.' : unchangedMessage ?? ''}
        </Copy>}
        {coaching.error && <Button compact disabled={waiting} onPress={coaching.retry}>{waiting ? 'Retry shortly' : 'Retry refinement'}</Button>}
      </>}
    </RecommendationPanel>}

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
      <Copy size={12} tone={color.forest} style={{ textDecorationLine: 'underline' }}>Photo credits</Copy>
    </Link>
    {selected && <ExerciseSheet key={selected.id} exercise={selected} onClose={closeExercise} />}
    {open && <EquipmentSheet onClose={(saved) => {
      if (saved) router.setParams({ equipment: undefined });
      setOpen(false);
    }} />}
  </View>;
}

const styles = StyleSheet.create({
  page: { gap: 15 },
  controls: { gap: 12 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9 },
  search: { flex: 1, minWidth: 169, maxWidth: 475, flexDirection: 'row', gap: 6 },
  filters: { padding: 12, gap: 10 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 },
  equipmentFilters: { gap: 7, flexGrow: 1, flexShrink: 1 },
  selectFilters: { flexDirection: 'row', flexWrap: 'wrap', flexBasis: 260, flexGrow: 1, flexShrink: 1, maxWidth: 452, gap: 12 },
  selectFilter: { flex: 1, minWidth: 120 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  resultsBar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: color.line },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  resultMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 31 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 60,
    borderTopWidth: 1, borderColor: color.line, backgroundColor: color.surface },
  pickBody: { flex: 1, minWidth: 0, gap: 3 },
  pickHover: { backgroundColor: color.canvas },
});
