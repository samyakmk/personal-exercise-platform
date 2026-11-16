import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Dumbbell, Minus, Plus, RotateCcw, Timer, Video } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { RequestError } from '../api';
import { filmingTips } from '../formFilming';
import { useTrainingNavigation } from '../navigation';
import { CameraRecorder } from '../platform/CameraRecorder';
import { Demonstration } from '../platform/Demonstration';
import { ExercisePicker } from '../platform/ExercisePicker';
import { color } from '../theme';
import { movementSummary, performedSetSummary, trainingLog } from '../trainingProgress';
import type { Exercise, ExerciseSet, SessionCoachState, TrainingSession as Session, TrainingSetDraft, Workout } from '../types';
import { useRestTimer } from '../useRestTimer';
import { useVideoUpload } from '../videoUpload';
import { useWorkspace } from '../workspace';
import { Countdown, formatCountdown } from './Countdown';
import { SessionCoach } from './SessionCoach';
import { RestTimer } from './RestTimer';
import { Sheet } from './Sheet';
import { TechniqueTips } from './TechniqueTips';
import { EffortField } from './SessionFeedback';
import { Button, Chip, Copy, IconButton, Input, Notice, SectionTitle } from './ui';
import { validWeight, WeightFields } from './WeightFields';

type Props = {
  session: Session;
  catalog: Exercise[];
  recentMovements: ReadonlyMap<string, Workout['exercises'][number]>;
  planCurrent: boolean;
  onChange: (session: Session) => void;
  onClose: () => void;
  onSave: (workout: Workout, existing: boolean) => Promise<void>;
};

const restDuration = 60_000;
const restExtension = 30_000;
const maxRest = 300_000;

export function TrainingSession({ session, catalog, recentMovements, planCurrent, onChange, onClose, onSave }: Props) {
  const { exerciseRecords } = useWorkspace();
  const { draft: videoDraft, progress: videoProgress, pick: pickVideo } = useVideoUpload();
  const navigation = useTrainingNavigation();
  const router = useRouter();
  const movements = session.plan.exercises;
  const active = movements.findIndex(({ exerciseId }) => exerciseId === session.activeExercise);
  const remaining = movements.findIndex(({ exerciseId, sets }) => (session.sets[exerciseId]?.length ?? 0) < sets);
  const position = active >= 0 ? active : remaining >= 0 ? remaining : movements.length - 1;
  const [finish, setFinish] = useState(false);
  const [noting, setNoting] = useState<string | null>(null);
  const [demonstrating, setDemonstrating] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(!movements.length);
  const [choice, setChoice] = useState(session.suggestedExercise ?? '');
  const split = useWindowDimensions().width >= 1000;
  const saving = useRef(false);
  const current = movements[position];
  const exerciseId = current?.exerciseId ?? '';
  const exercise = exerciseRecords.get(exerciseId);
  const name = exercise?.name ?? exerciseId;
  const performed = session.sets[exerciseId] ?? [];
  const holdDeadline = session.hold?.exerciseId === exerciseId && session.hold.setNumber === performed.length + 1
    ? session.hold.deadline : null;
  const [expandedTimer, setExpandedTimer] = useState<'hold' | 'rest' | null>(() => {
    const now = Date.now();
    if (holdDeadline !== null && holdDeadline > now) return 'hold';
    return (session.restDeadline ?? 0) > now ? 'rest' : null;
  });
  const recent = recentMovements.get(exerciseId);
  const showDemonstration = demonstrating === exerciseId;
  const liveLog = Boolean(session.logTime);
  const total = movements.reduce((count, { sets }) => count + sets, 0);
  const logged = Object.values(session.sets).reduce((count, sets) => count + sets.length, 0);
  const coach = liveLog ? undefined : session.coach;
  const skipped = coach?.skipped ?? [];
  const target = current?.setDetails?.[performed.length] ?? current;
  const guidedSet = target && { ...target, load: target.load ?? (!current.setDetails ? performed.at(-1)?.load : undefined) };
  const movementDone = Boolean(current && (performed.length >= current.sets || skipped.includes(exerciseId)));
  const phase = coach && (coach.stage === 'rest' ? 'rest' : movementDone ? 'complete' : coach.stage);
  const nextPosition = movementDone ? nextPending(session.sets, skipped) : -1;
  const nextExerciseId = movements[nextPosition]?.exerciseId;
  const nextName = nextExerciseId && (exerciseRecords.get(nextExerciseId)?.name ?? nextExerciseId);
  const canFinish = liveLog || logged > 0;
  const plannedDone = movements.reduce((count, { exerciseId, sets }) => count + Math.min(sets, session.sets[exerciseId]?.length ?? 0), 0);
  const separateLog = !planCurrent || conflict;
  const available = catalog.filter(({ id }) => !movements.some(({ exerciseId }) => exerciseId === id));

  function addExercise() {
    const exercise = available.find(({ id }) => id === choice);
    if (!exercise) return;
    const movement = { exerciseId: exercise.id, sets: 3, reps: exercise.unit === 'seconds' ? 30 : 10 };
    onChange({ ...session, activeExercise: exercise.id, suggestedExercise: undefined,
      ...(coach && { coach: { stage: 'setup', skipped }, hold: undefined }),
      plan: { ...session.plan, exercises: [...movements, movement] } });
    setDemonstrating(null);
    setAdding(false);
    setChoice('');
  }

  const restTimer = <RestTimer deadline={session.restDeadline ?? null} expanded={expandedTimer === 'rest'}
    onExpandedChange={(expanded) => setExpandedTimer(expanded ? 'rest' : null)}
    onDeadlineChange={(restDeadline) => onChange({ ...session, restDeadline })} />;

  function nextPending(sets: Session['sets'], omitted: string[]) {
    const unfinished = ({ exerciseId, sets: target }: Workout['exercises'][number], index: number) =>
      index !== position && !omitted.includes(exerciseId) && (sets[exerciseId]?.length ?? 0) < target;
    const after = movements.findIndex((movement, index) => index > position && unfinished(movement, index));
    return after >= 0 ? after : movements.findIndex(unfinished);
  }

  function updateSets(sets: ExerciseSet[]) {
    const setDrafts = { ...session.setDrafts };
    delete setDrafts[exerciseId];
    const allSets = { ...session.sets, [exerciseId]: sets };
    const restNeeded = coach && sets.length > performed.length
      && (sets.length < current.sets || nextPending(allSets, skipped) >= 0);
    onChange({ ...session, activeExercise: exerciseId, setDrafts,
      hold: session.hold?.exerciseId === exerciseId ? undefined : session.hold, sets: allSets,
      ...(coach && { coach: restNeeded ? { stage: 'rest', restUntil: Date.now() + restDuration, skipped } : { stage: 'set', skipped } }),
    });
  }

  function draftSet(fields: TrainingSetDraft, resetHold?: boolean) {
    onChange({ ...session, activeExercise: exerciseId,
      setDrafts: { ...session.setDrafts, [exerciseId]: fields },
      hold: resetHold && session.hold?.exerciseId === exerciseId ? undefined : session.hold });
  }

  function reportAmount(amount: number) {
    if (holdDeadline !== null && holdDeadline > Date.now()) return 'Finish or stop the hold timer before reporting your time.';
    draftSet({ ...setFields(guidedSet, performed.length + 1, session.setDrafts?.[exerciseId]), reps: String(amount) }, true);
    return `I entered ${amount} ${exercise?.unit === 'seconds' ? 'seconds' : amount === 1 ? 'rep' : 'reps'}. Check the set and record it when you’re ready.`;
  }

  function moveTo(index: number, omitted = skipped) {
    const id = movements[index].exerciseId;
    setDemonstrating(null);
    onChange({ ...session, activeExercise: id,
      ...(coach && { coach: { stage: 'setup', skipped: omitted.filter((item) => item !== id) }, hold: undefined }) });
  }

  function changeCoach(state: SessionCoachState) {
    onChange({ ...session, activeExercise: exerciseId, coach: state });
  }

  function continueCoach() {
    if (movementDone && nextPosition >= 0) moveTo(nextPosition);
    else changeCoach({ stage: 'set', skipped });
  }

  function extendRest() {
    const now = Date.now();
    const restUntil = Math.max(now, coach?.restUntil ?? 0) + restExtension;
    if (restUntil <= now + maxRest) changeCoach({ stage: 'rest', restUntil, skipped });
  }

  function skipExercise() {
    const omitted = [...skipped, exerciseId];
    const next = nextPending(session.sets, omitted);
    if (next >= 0) moveTo(next, omitted);
    else onChange({ ...session, activeExercise: exerciseId, hold: undefined, coach: { stage: 'setup', skipped: omitted } });
  }

  function toggleCoach() {
    setExpandedTimer(null);
    onChange({ ...session, activeExercise: exerciseId, hold: undefined, restDeadline: null, coach: coach ? undefined : { stage: 'setup' } });
  }

  async function save() {
    if (saving.current || !canFinish) return;
    saving.current = true;
    setError('');
    setBusy(true);
    try {
      await onSave(trainingLog(session, separateLog), !separateLog);
    } catch (failure) {
      if (failure instanceof RequestError && !separateLog && [404, 409].includes(failure.status)) setConflict(true);
      else setError((failure as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const lineup = <View style={[styles.lineup, split && { flex: 0.8 }]}>
    <SectionTitle title="Exercises" level={3} />
    <View style={styles.actions}>
      {movements.map(({ exerciseId, sets }, index) => <Chip key={exerciseId}
        label={`${exerciseRecords.get(exerciseId)?.name ?? exerciseId} · ${skipped.includes(exerciseId) ? 'Skipped'
          : `${session.sets[exerciseId]?.length ?? 0}${liveLog ? '' : `/${sets}`}`}`}
        selected={position === index} onPress={() => { if (position !== index || skipped.includes(exerciseId)) moveTo(index); }} />)}
    </View>
    {available.length > 0 && <Button compact kind="quiet" icon={Plus} aria-expanded={adding}
      onPress={() => setAdding(!adding)}>{adding ? 'Hide exercise picker' : 'Add exercise'}</Button>}
    {adding && <View style={styles.picker}>
      <ExercisePicker label="Exercise to add" value={choice} onChange={setChoice}
        options={available.map(({ id, name }) => ({ value: id, label: name }))} />
      <Button compact disabled={!choice} onPress={addExercise}>Add to session</Button>
    </View>}
    {split && !coach && restTimer}
  </View>;

  return <Sheet title={session.plan.name} detail={finish ? 'Review what you recorded before saving.'
    : current ? coach ? undefined : 'Record each set as you finish it.' : 'Add an exercise to start recording sets.'}
    wide={!finish && split} onClose={() => { if (!saving.current) onClose(); }}>
    {finish ? <>
      {!liveLog && plannedDone < total && <Notice>{`${total - plannedDone} planned ${total - plannedDone === 1 ? 'set was' : 'sets were'} left open. Your log will include the ${logged} ${logged === 1 ? 'set' : 'sets'} you recorded.`}</Notice>}
      {separateLog && !session.adHoc && <Notice>The original workout changed. Save these sets as a separate workout log.</Notice>}
      <View style={{ gap: 6 }}>
        {movements.map(({ exerciseId, sets }) => <View key={exerciseId} style={styles.summaryRow}>
          <Copy weight="semibold" size={13}>{exerciseRecords.get(exerciseId)?.name ?? exerciseId}</Copy>
          <Copy size={12} tone={color.muted}>{`${session.sets[exerciseId]?.length ?? 0} recorded${liveLog ? '' : ` · ${sets} planned`}`}</Copy>
        </View>)}
      </View>
      <EffortField value={session.effort} onChange={(effort) => onChange({ ...session, effort })} disabled={busy} />
      <Input label={session.adHoc ? 'Session notes' : 'Workout notes'} value={session.notes} onChangeText={(notes) => onChange({ ...session, notes })}
        placeholder="Optional · What went well or what to change next time" multiline numberOfLines={3} maxLength={1200}
        style={{ minHeight: 76, paddingVertical: 8, textAlignVertical: 'top' }} />
      {error && <Notice error>{error}</Notice>}
      <View style={styles.actions}>
        <Button icon={Check} kind="primary" disabled={busy || !canFinish} onPress={() => void save()}>
          {busy ? 'Saving…' : session.adHoc ? 'Save session' : separateLog ? 'Save separate log' : 'Save workout log'}
        </Button>
        <Button icon={ChevronLeft} disabled={busy} onPress={() => setFinish(false)}>Back to session</Button>
      </View>
    </> : <>
      {!!movements.length && <View style={{ gap: 7 }}>
        <View style={styles.sessionProgress}>
          <Copy size={13} weight="semibold" tone={color.plum}>{`Exercise ${position + 1} of ${movements.length}`}</Copy>
          <Copy size={13} tone={color.muted} role="status" accessibilityLiveRegion="polite">{liveLog ? `${logged} ${logged === 1 ? 'set' : 'sets'} recorded` : `${plannedDone} of ${total} planned sets recorded`}</Copy>
        </View>
        {!liveLog && <View aria-hidden style={styles.track}><View style={[styles.fill, { width: `${100 * plannedDone / total}%` }]} /></View>}
      </View>}
      <View style={[styles.trainingLayout, split && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        {split && lineup}
        {current && <View style={[styles.active, split && { flex: 1.55 }]}>
          <View style={styles.activeHead}>
            <View style={styles.exerciseTitle}>
              <Dumbbell aria-hidden size={20} color={color.plum} />
              <Copy accessibilityRole="header" aria-level={3} size={19} weight="bold" style={{ flexShrink: 1 }}>{name}</Copy>
            </View>
            {exercise && (exercise.demonstration || exercise.cues.length > 0) && <Button compact kind="quiet" icon={Video} aria-expanded={showDemonstration}
              onPress={() => setDemonstrating(showDemonstration ? null : exercise.id)}>
              {showDemonstration ? 'Hide technique' : 'Show technique'}
            </Button>}
          </View>
          {recent && <Copy size={12} tone={color.muted}>{`Last session · ${movementSummary(exercise ?? { unit: 'reps' }, recent)}`}</Copy>}
          {recent?.notes && <Copy size={12} tone={color.muted}>Last exercise note · {recent.notes}</Copy>}
          {exercise && showDemonstration && <View style={{ gap: 8 }}>
            <Demonstration exercise={exercise} />
            {exercise.cues.map((cue) => <Copy key={cue} tone={color.muted} size={13}>{cue}</Copy>)}
            <TechniqueTips exercise={exercise} />
          </View>}
          {phase && <SessionCoach phase={phase} exercise={exercise} name={name} target={movementDone ? undefined : target}
            setNumber={performed.length + 1} setCount={current.sets} restUntil={coach?.restUntil} nextName={nextName} canFinish={canFinish}
            onContinue={continueCoach} onExtendRest={extendRest} onSkip={skipExercise} onReport={reportAmount} />}
          {performed.length < 30 && (!coach || phase === 'set') && <SetInput key={current.exerciseId} exercise={exercise} name={name}
            planned={coach ? guidedSet : current.setDetails?.[performed.length] ?? performed.at(-1) ?? (liveLog ? undefined : current)}
            next={performed.length + 1}
            optionalReps={Boolean(session.adHoc)}
            draft={session.setDrafts?.[current.exerciseId]}
            holdDeadline={holdDeadline} expandedHold={expandedTimer === 'hold'}
            onExpandedHoldChange={(expanded) => setExpandedTimer(expanded ? 'hold' : null)}
            onHold={(deadline) => onChange({ ...session, activeExercise: current.exerciseId,
              hold: deadline === null ? undefined : { exerciseId: current.exerciseId, setNumber: performed.length + 1, deadline } })}
            onDraft={draftSet}
            extra={!liveLog && performed.length >= current.sets} onRecord={(set) => updateSets([...performed, set])} />}
          {exercise && !skipped.includes(exerciseId) && (videoDraft || videoProgress !== null
            ? <Button compact kind="quiet" icon={Video} onPress={() => { onClose(); router.navigate('/form-review'); }}>Open video draft</Button>
            : <CameraRecorder key={`camera:${exerciseId}`} filmingTip={filmingTips[exerciseId]}
              selectionLabel="Continue to form review" onSelect={(clip) => {
                pickVideo(clip, exerciseId);
                onClose();
                navigation.open({ type: 'review', exerciseId });
              }} />)}
          <Button compact kind="quiet" aria-expanded={noting === exerciseId}
            onPress={() => setNoting(noting === exerciseId ? null : exerciseId)}>
            {noting === exerciseId ? 'Hide exercise notes' : session.exerciseNotes?.[exerciseId] ? 'Edit exercise notes' : 'Add exercise notes'}
          </Button>
          {noting === exerciseId && <Input label={`Exercise notes · ${name}`} visibleLabel="Exercise notes (optional)"
            value={session.exerciseNotes?.[exerciseId] ?? current.notes ?? ''} multiline maxLength={500}
            onChangeText={(notes) => onChange({ ...session, exerciseNotes: { ...session.exerciseNotes, [exerciseId]: notes } })}
            style={{ minHeight: 60, paddingVertical: 8 }} />}
          {!!performed.length && <View style={{ gap: 6 }}>
            {performed.map((set, index) => <View key={index} style={styles.summaryRow}>
              <Copy size={12}>{`Set ${index + 1}`}</Copy>
              <Copy size={12} tone={color.muted}>{performedSetSummary(exercise, set)}</Copy>
            </View>)}
            <Button compact kind="quiet" icon={RotateCcw} onPress={() => updateSets(performed.slice(0, -1))}>Undo last set</Button>
          </View>}
        </View>}
        {!split && lineup}
      </View>
      {!split && !coach && restTimer}
      <View style={styles.sessionFooter}>
        {!coach && position < movements.length - 1 && <Button end={ChevronRight} onPress={() => moveTo(position + 1)}>Next exercise</Button>}
        <Button icon={Check} kind="dark" disabled={!canFinish} onPress={() => setFinish(true)}>Finish session</Button>
        <Button kind="quiet" onPress={onClose}>Pause session</Button>
        {current && !liveLog && <Button kind="quiet" onPress={toggleCoach}>{coach ? 'Switch to manual' : 'Turn on coach'}</Button>}
      </View>
    </>}
  </Sheet>;
}

function setFields(planned: ExerciseSet | undefined, setNumber: number, draft?: TrainingSetDraft): TrainingSetDraft {
  if (draft?.setNumber === setNumber) return draft;
  return { setNumber, reps: planned?.reps === undefined ? '' : String(planned.reps),
    load: planned?.load ? String(planned.load.value) : '', unit: planned?.load?.unit ?? 'lb' };
}

function SetInput({ exercise, name, planned, next, draft, holdDeadline, expandedHold, onExpandedHoldChange, onHold, onDraft, extra, optionalReps, onRecord }: {
  exercise?: Exercise; name: string; planned?: ExerciseSet; next: number; draft?: TrainingSetDraft;
  holdDeadline: number | null; expandedHold: boolean; onExpandedHoldChange: (expanded: boolean) => void;
  onHold: (deadline: number | null) => void;
  onDraft: (draft: TrainingSetDraft, resetHold?: boolean) => void; extra: boolean; optionalReps: boolean; onRecord: (set: ExerciseSet) => void;
}) {
  const [failure, setFailure] = useState<{ next: number; message: string } | null>(null);
  const hold = useRestTimer(holdDeadline, onHold);
  const { reps, load, unit: weightUnit } = setFields(planned, next, draft);
  const weight = { load, unit: weightUnit };
  const error = failure?.next === next ? failure.message : '';
  const amount = Number(reps);
  const adjustable = /^\d+$/.test(reps) && amount >= 1 && amount <= 600;
  const unit = exercise?.unit === 'seconds' ? 'Seconds' : 'Reps';
  function setReps(value: string) {
    onDraft({ ...weight, setNumber: next, reps: value }, true);
  }
  const runningHold = hold.active && hold.seconds > 0;

  function startHold() {
    hold.start(amount);
    onExpandedHoldChange(true);
  }

  function stopHold() {
    const elapsed = amount - hold.remaining();
    if (elapsed > 0) setReps(String(elapsed));
    else hold.clear();
    onExpandedHoldChange(false);
  }

  function record() {
    if (!adjustable && !(optionalReps && !reps && weight.load)) {
      setFailure({ next, message: optionalReps && !reps ? 'Enter reps, hold time, or weight to record a set.'
        : `Enter ${unit.toLowerCase()} from 1 to 600.` });
      return;
    }
    if (weight.load && !validWeight(weight.load)) {
      setFailure({ next, message: 'Enter a weight from 0.01 to 1000 kg or lb, or leave it blank.' });
      return;
    }
    setFailure(null);
    onRecord({ ...(reps && { reps: amount }), ...(weight.load && { load: { value: Number(weight.load.replace(',', '.')), unit: weight.unit } }) });
  }

  return <View style={{ gap: 8 }}>
    <Copy size={13} weight="semibold">{extra ? `Extra set ${next}` : `Set ${next}`}</Copy>
    <View style={[styles.actions, { alignItems: 'flex-end' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5, minWidth: 164, flex: 1 }}>
        <Input label={`${unit} · ${name}`} visibleLabel={unit} value={reps} placeholder={optionalReps ? 'Optional' : undefined} onChangeText={setReps} editable={!runningHold} keyboardType="number-pad" maxLength={3} />
        <IconButton icon={Minus} size={43} label={`Decrease ${unit.toLowerCase()}`} disabled={runningHold || !adjustable || amount <= 1} onPress={() => setReps(String(amount - 1))} />
        <IconButton icon={Plus} size={43} label={`Increase ${unit.toLowerCase()}`} disabled={runningHold || !adjustable || amount >= 600} onPress={() => setReps(String(amount + 1))} />
      </View>
      {exercise?.loadType && <WeightFields label={name} perDumbbell={exercise.loadType === 'per-dumbbell'} set={weight}
        onChange={(fields) => onDraft({ ...weight, ...fields, setNumber: next, reps })} />}
    </View>
    {error && <Notice error>{error}</Notice>}
    {unit === 'Seconds' && <View style={[styles.actions, { alignItems: 'center' }]}>
      {runningHold ? <>
        <Button icon={Timer} compact onPress={() => onExpandedHoldChange(true)}>{`Show hold timer · ${formatCountdown(hold.seconds)}`}</Button>
        <Button compact kind="quiet" onPress={stopHold}>Stop hold timer</Button>
      </> : <Button icon={Timer} compact disabled={!adjustable} onPress={startHold}>Start hold timer</Button>}
      {!expandedHold && hold.active && !runningHold && <Copy role="status" accessibilityLiveRegion="polite" size={13}>Hold complete</Copy>}
      {expandedHold && hold.active && <Countdown kind="Hold" seconds={hold.seconds}
        onMinimize={() => onExpandedHoldChange(false)} onStop={stopHold} onDone={() => {
          hold.clear();
          onExpandedHoldChange(false);
        }} />}
    </View>}
    <Button icon={Check} kind="primary" disabled={runningHold} onPress={record}>Record set</Button>
  </View>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  trainingLayout: { gap: 16 },
  lineup: { minWidth: 0, gap: 10 },
  picker: { gap: 7, borderRadius: 8, padding: 10, backgroundColor: color.canvas },
  sessionProgress: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 },
  active: { padding: 15, borderRadius: 11, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.line, gap: 12 },
  activeHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 7 },
  exerciseTitle: { flexDirection: 'row', alignItems: 'center', minWidth: 0, flexShrink: 1, gap: 8 },
  sessionFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7,
    borderTopWidth: 1, borderColor: color.line, paddingTop: 11 },
  track: { height: 8, borderRadius: 8, backgroundColor: color.soft, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: color.plum, borderRadius: 8 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'space-between', borderTopWidth: 1, borderColor: color.line, paddingVertical: 5 },
});
