import { useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Dumbbell, Minus, Plus, RotateCcw, Timer, Video } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { RequestError } from '../api';
import { Demonstration } from '../platform/Demonstration';
import { ExercisePicker } from '../platform/ExercisePicker';
import { color } from '../theme';
import { movementSummary, performedSetSummary, trainingLog } from '../trainingProgress';
import type { Exercise, ExerciseSet, TrainingSession as Session, TrainingSetDraft, Workout } from '../types';
import { useRestTimer } from '../useRestTimer';
import { useWorkspace } from '../workspace';
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

export function TrainingSession({ session, catalog, recentMovements, planCurrent, onChange, onClose, onSave }: Props) {
  const { exerciseRecords } = useWorkspace();
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
  const recent = recentMovements.get(exerciseId);
  const showDemonstration = demonstrating === exerciseId;
  const liveLog = Boolean(session.logTime);
  const total = movements.reduce((count, { sets }) => count + sets, 0);
  const logged = Object.values(session.sets).reduce((count, sets) => count + sets.length, 0);
  const canFinish = liveLog || logged > 0;
  const plannedDone = movements.reduce((count, { exerciseId, sets }) => count + Math.min(sets, session.sets[exerciseId]?.length ?? 0), 0);
  const separateLog = !planCurrent || conflict;
  const available = catalog.filter(({ id }) => !movements.some(({ exerciseId }) => exerciseId === id));

  function addExercise() {
    const exercise = available.find(({ id }) => id === choice);
    if (!exercise) return;
    const movement = { exerciseId: exercise.id, sets: 3, reps: exercise.unit === 'seconds' ? 30 : 10 };
    onChange({ ...session, activeExercise: exercise.id, suggestedExercise: undefined,
      plan: { ...session.plan, exercises: [...movements, movement] } });
    setDemonstrating(null);
    setAdding(false);
    setChoice('');
  }

  const restTimer = <RestTimer deadline={session.restDeadline ?? null}
    onDeadlineChange={(restDeadline) => onChange({ ...session, restDeadline })} />;

  function updateSets(sets: ExerciseSet[]) {
    const setDrafts = { ...session.setDrafts };
    delete setDrafts[exerciseId];
    onChange({ ...session, activeExercise: exerciseId, setDrafts,
      hold: session.hold?.exerciseId === exerciseId ? undefined : session.hold,
      sets: { ...session.sets, [exerciseId]: sets } });
  }

  function moveTo(index: number) {
    setDemonstrating(null);
    onChange({ ...session, activeExercise: movements[index].exerciseId });
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

  return <Sheet title={session.plan.name} detail={finish ? 'Review what you recorded before saving.'
    : current ? 'Record each set as you finish it.' : 'Add an exercise to start recording sets.'}
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
        <View style={[styles.lineup, split && { flex: 0.8 }]}>
          <SectionTitle title="Exercises" level={3} />
          <View style={styles.actions}>
            {movements.map(({ exerciseId, sets }, index) => <Chip key={exerciseId}
              label={`${exerciseRecords.get(exerciseId)?.name ?? exerciseId} · ${session.sets[exerciseId]?.length ?? 0}${liveLog ? '' : `/${sets}`}`}
              selected={position === index} onPress={() => moveTo(index)} />)}
          </View>
          {available.length > 0 && <Button compact kind="quiet" icon={Plus} aria-expanded={adding}
            onPress={() => setAdding(!adding)}>{adding ? 'Hide exercise picker' : 'Add exercise'}</Button>}
          {adding && <View style={styles.picker}>
            <ExercisePicker label="Exercise to add" value={choice} onChange={setChoice}
              options={available.map(({ id, name }) => ({ value: id, label: name }))} />
            <Button compact disabled={!choice} onPress={addExercise}>Add to session</Button>
          </View>}
          {split && restTimer}
        </View>
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
          {performed.length < 30 && <SetInput key={current.exerciseId} exercise={exercise} name={name}
            planned={current.setDetails?.[performed.length] ?? performed.at(-1) ?? (liveLog ? undefined : current)} next={performed.length + 1}
            optionalReps={Boolean(session.adHoc)}
            draft={session.setDrafts?.[current.exerciseId]}
            holdDeadline={session.hold?.exerciseId === current.exerciseId && session.hold.setNumber === performed.length + 1
              ? session.hold.deadline : null}
            onHold={(deadline) => onChange({ ...session, activeExercise: current.exerciseId,
              hold: deadline === null ? undefined : { exerciseId: current.exerciseId, setNumber: performed.length + 1, deadline } })}
            onDraft={(fields, resetHold) => onChange({ ...session, activeExercise: current.exerciseId,
              setDrafts: { ...session.setDrafts, [current.exerciseId]: fields },
              hold: resetHold && session.hold?.exerciseId === current.exerciseId ? undefined : session.hold })}
            extra={!liveLog && performed.length >= current.sets} onRecord={(set) => updateSets([...performed, set])} />}
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
      </View>
      {!split && restTimer}
      <View style={styles.sessionFooter}>
        {position < movements.length - 1 && <Button end={ChevronRight} onPress={() => moveTo(position + 1)}>Next exercise</Button>}
        <Button icon={Check} kind="dark" disabled={!canFinish} onPress={() => setFinish(true)}>Finish session</Button>
        <Button kind="quiet" onPress={onClose}>Pause session</Button>
      </View>
    </>}
  </Sheet>;
}

function SetInput({ exercise, name, planned, next, draft, holdDeadline, onHold, onDraft, extra, optionalReps, onRecord }: {
  exercise?: Exercise; name: string; planned?: ExerciseSet; next: number; draft?: TrainingSetDraft;
  holdDeadline: number | null; onHold: (deadline: number | null) => void;
  onDraft: (draft: TrainingSetDraft, resetHold?: boolean) => void; extra: boolean; optionalReps: boolean; onRecord: (set: ExerciseSet) => void;
}) {
  const [failure, setFailure] = useState<{ next: number; message: string } | null>(null);
  const hold = useRestTimer(holdDeadline, onHold);
  const { reps, load, unit: weightUnit } = draft?.setNumber === next ? draft : {
    reps: planned?.reps === undefined ? '' : String(planned.reps), load: planned?.load ? String(planned.load.value) : '', unit: planned?.load?.unit ?? 'lb',
  };
  const weight = { load, unit: weightUnit };
  const error = failure?.next === next ? failure.message : '';
  const amount = Number(reps);
  const adjustable = /^\d+$/.test(reps) && amount >= 1 && amount <= 600;
  const unit = exercise?.unit === 'seconds' ? 'Seconds' : 'Reps';
  function setReps(value: string) {
    onDraft({ ...weight, setNumber: next, reps: value }, true);
  }
  const runningHold = hold.active && hold.seconds > 0;

  function toggleHold() {
    if (!runningHold) {
      hold.start(amount);
      return;
    }
    const elapsed = amount - hold.remaining();
    if (elapsed > 0) setReps(String(elapsed));
    else hold.clear();
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
      <Button icon={Timer} compact disabled={!adjustable && !runningHold} onPress={toggleHold}>
        {runningHold ? 'Stop hold timer' : 'Start hold timer'}
      </Button>
      {runningHold && <Copy size={13} weight="bold" tone={color.plum}>{`${hold.seconds}s left`}</Copy>}
      {hold.active && hold.seconds === 0 && <Copy role="status" accessibilityLiveRegion="polite" size={13}>Hold complete</Copy>}
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
