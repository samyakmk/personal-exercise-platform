import { useRouter } from 'expo-router';
import { type Ref, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Check, ChevronLeft, ChevronRight, Dumbbell, Mic, MicOff, Minus, Pause, Plus, RotateCcw, Timer, Video } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { isPlannableExercise } from '../../shared/today-plan.mjs';
import { useActiveSession } from '../activeSession';
import { RequestError } from '../api';
import { formatDay, workoutTime } from '../dates';
import { filmingTips } from '../formFilming';
import { useTrainingNavigation } from '../navigation';
import { CameraRecorder } from '../platform/CameraRecorder';
import { Demonstration } from '../platform/Demonstration';
import { ExercisePicker } from '../platform/ExercisePicker';
import { SelectField } from '../platform/fields';
import { useVoiceCommands } from '../platform/useVoiceCommands';
import { VideoPicker } from '../platform/VideoPicker';
import { useProfiles } from '../profiles';
import { color, radius } from '../theme';
import { completedWorkouts, exerciseLogs, performedSetSummary } from '../trainingProgress';
import type { Exercise, ExerciseLoad, ExerciseSet, Movement, SelectedVideo, SessionCoachState,
  TrainingSession as Session, TrainingSetDraft, Workout } from '../types';
import { useRestTimer } from '../useRestTimer';
import { useVideoUpload } from '../videoUpload';
import { useWorkspace } from '../workspace';
import { type SetVoiceCommand, workoutVoiceCommand } from '../workoutVoiceCommands';
import { Countdown, formatCountdown } from './Countdown';
import { SessionCoach } from './SessionCoach';
import { RestTimer } from './RestTimer';
import { Sheet } from './Sheet';
import { TechniqueTips } from './TechniqueTips';
import { TrainerExerciseCue } from './TrainerExerciseCue';
import { EffortField } from './SessionFeedback';
import { Button, Chip, Copy, IconButton, Input, Notice, SectionTitle } from './ui';
import { validWeight, WeightFields } from './WeightFields';

type Props = {
  session: Session;
  catalog: Exercise[];
  planCurrent: boolean;
  onChange: (session: Session) => void;
  onClose: () => void;
  onSave: (workout: Workout, sync: 'synced' | 'queued') => void;
};

const restOptions = [0, 30, 45, 60, 90, 120, 180, 240, 300].map((seconds) => ({
  value: String(seconds), label: seconds ? `${seconds} seconds` : 'Off',
}));
const restExtension = 30_000;
const maxRest = 300_000;

export function TrainingSession({ session, catalog, planCurrent, onChange, onClose, onSave }: Props) {
  const { data, exerciseRecords } = useWorkspace();
  const { state } = useProfiles();
  const { saveSession, storageError } = useActiveSession();
  const { draft: videoDraft, error: videoError, progress: videoProgress, pick: pickVideo } = useVideoUpload();
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
  const [videoRejected, setVideoRejected] = useState(false);
  const [adding, setAdding] = useState(!movements.length);
  const [choice, setChoice] = useState(session.suggestedExercise ?? '');
  const [swap, setSwap] = useState<{ exerciseId: string; blocked: string[] }>();
  const [restSettings, setRestSettings] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState('');
  const [voiceHelp, setVoiceHelp] = useState(false);
  const coachMessage = useRef<(question?: string) => void>(null);
  const speakReadback = useRef<(text: string) => void>(null);
  const setCommand = useRef<(command: SetVoiceCommand) => string | void>(null);
  const voice = useVoiceCommands((transcript) => {
    const command = workoutVoiceCommand(transcript);
    if (!command) return;
    const result = runVoiceCommand(command);
    setVoiceFeedback(result ?? '');
    if (result && ['report', 'weight', 'use last load'].includes(command.action)) speakReadback.current?.(result);
  });
  const { width } = useWindowDimensions();
  const split = width >= 1000;
  const docked = width < 690;
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
  const history = data?.workouts;
  const recent = useMemo(() => history && exerciseLogs(completedWorkouts(history, workoutTime(new Date(session.startedAt))), exerciseId)
    .find(({ movement }) => actualSets(movement).length > 0), [exerciseId, history, session.startedAt]);
  const previousSets = recent ? actualSets(recent.movement) : [];
  const lastLoad = previousSets.findLast(({ load }) => load)?.load;
  const showDemonstration = demonstrating === exerciseId;
  const liveLog = Boolean(session.logTime);
  const total = movements.reduce((count, { sets }) => count + sets, 0);
  const logged = Object.values(session.sets).reduce((count, sets) => count + sets.length, 0);
  const coach = liveLog ? undefined : session.coach;
  const skipped = session.skippedExerciseIds ?? coach?.skipped ?? [];
  const restDuration = (session.restSeconds ?? 60) * 1000;
  const target = current?.setDetails?.[performed.length] ?? current;
  const guidedSet = target && { ...target, load: target.load ?? (!current.setDetails ? performed.at(-1)?.load : undefined) };
  const movementDone = Boolean(current && (performed.length >= current.sets || skipped.includes(exerciseId)));
  const phase = coach && (coach.stage === 'rest' ? 'rest' : movementDone ? 'complete' : coach.stage);
  const nextPosition = movementDone ? nextPending(session.sets, skipped) : -1;
  const nextExerciseId = movements[nextPosition]?.exerciseId;
  const nextName = nextExerciseId && (exerciseRecords.get(nextExerciseId)?.name ?? nextExerciseId);
  const canFinish = liveLog || logged > 0;
  const saveLabel = session.adHoc ? 'Save session' : !planCurrent || conflict ? 'Save separate log' : 'Save workout log';
  const plannedDone = movements.reduce((count, { exerciseId, sets }) => count + Math.min(sets, session.sets[exerciseId]?.length ?? 0), 0);
  const separateLog = !planCurrent || conflict;
  const available = catalog.filter(({ id }) => !movements.some(({ exerciseId }) => exerciseId === id));
  const preferences = state?.active?.details.trainingPreferences;
  const swapOpen = swap?.exerciseId === exerciseId;
  const alternatives = swapOpen && exercise ? available.flatMap((candidate) => {
    if (!isPlannableExercise(candidate) || candidate.unit !== exercise.unit
      || preferences?.excluded?.includes(candidate.id) || preferences?.instructions?.some((item) => item.kind === 'avoid' && item.exerciseId === candidate.id)
      || data?.trainingNotes?.some((note) => note.kind === 'avoid' && note.exerciseId === candidate.id)
      || candidate.equipment.some((gear) => swap.blocked.includes(gear) || (data?.equipment && !data.equipment.includes(gear)))) return [];
    const overlap = candidate.primaryMuscles?.filter((muscle) => exercise.primaryMuscles?.includes(muscle)).length ?? 0;
    return overlap ? [{ candidate, rank: overlap * 4 + Number(candidate.level === exercise.level) + Number(!candidate.equipment.length) }] : [];
  }).sort((a, b) => b.rank - a.rank).slice(0, 5).map(({ candidate }) => candidate) : [];
  const coachRest = useRestTimer(coach?.restUntil ?? null);
  const holdIsRunning = useRestTimer(docked ? holdDeadline : null).seconds > 0;
  const restSeconds = Math.min(coachRest.seconds, coachRest.remaining());

  function reviewVideo(clip: SelectedVideo) {
    if (!pickVideo(clip, exerciseId, {
      sessionId: session.logId, exerciseId, setNumber: Math.min(current.sets, performed.length + 1, 30),
      ...(!session.adHoc && { workoutId: session.plan.id }),
    })) {
      setVideoRejected(true);
      return;
    }
    onClose();
    navigation.open({ type: 'review', exerciseId });
  }

  function substitute(replacement: Exercise) {
    if (!current || movementDone) return;
    const note = session.exerciseNotes?.[exerciseId]?.trim();
    const completedSets = performed.length;
    const keptCount = completedSets || (note ? 1 : 0);
    const retained = keptCount ? [{ ...current, sets: keptCount, setDetails: current.setDetails?.slice(0, keptCount) }] : [];
    const next: Movement = { exerciseId: replacement.id, replacesExerciseId: current.replacesExerciseId ?? exerciseId,
      sets: current.sets - completedSets, reps: target?.reps ?? (replacement.unit === 'seconds' ? 30 : 10) };
    const setDrafts = { ...session.setDrafts };
    delete setDrafts[exerciseId];
    const exerciseNotes = { ...session.exerciseNotes };
    if (!keptCount) delete exerciseNotes[exerciseId];
    const omitted = skipped.filter((id) => id !== exerciseId);
    if (note && !completedSets) omitted.push(exerciseId);
    onChange({ ...session, setDrafts, exerciseNotes, activeExercise: replacement.id, hold: undefined, restDeadline: null,
      skippedExerciseIds: omitted,
      ...(coach && { coach: { stage: 'setup', skipped: omitted } }),
      plan: { ...session.plan, exercises: [...movements.slice(0, position), ...retained, next, ...movements.slice(position + 1)] } });
    setSwap(undefined);
    setNoting(null);
    setDemonstrating(null);
  }

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
    const restNeeded = coach && restDuration > 0 && sets.length > performed.length
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
    const result = setCommand.current?.({ action: 'report', amount, unit: exercise?.unit === 'seconds' ? 'seconds' : 'reps' });
    return result ?? 'The set is unavailable for recording.';
  }

  function moveTo(index: number, omitted = skipped) {
    const id = movements[index].exerciseId;
    const stillSkipped = omitted.filter((item) => item !== id);
    setDemonstrating(null);
    onChange({ ...session, activeExercise: id, skippedExerciseIds: stillSkipped,
      ...(coach && { coach: { stage: 'setup', skipped: stillSkipped }, hold: undefined }) });
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
    if (restUntil > now + maxRest) return false;
    changeCoach({ stage: 'rest', restUntil, skipped });
    return true;
  }

  function skipExercise() {
    const omitted = [...skipped, exerciseId];
    const next = nextPending(session.sets, omitted);
    if (next >= 0) moveTo(next, omitted);
    else onChange({ ...session, activeExercise: exerciseId, hold: undefined, skippedExerciseIds: omitted,
      coach: { stage: 'setup', skipped: omitted } });
  }

  function toggleCoach() {
    setExpandedTimer(null);
    onChange({ ...session, activeExercise: exerciseId, hold: undefined, restDeadline: null, skippedExerciseIds: skipped,
      coach: coach ? undefined : { stage: 'setup', skipped } });
  }

  function changeRest(seconds: number) {
    onChange({ ...session, restSeconds: seconds, ...(phase === 'rest' && { coach: seconds
      ? { stage: 'rest', skipped, restUntil: Date.now() + seconds * 1000 } : { stage: 'set', skipped } }) });
  }

  async function save() {
    if (saving.current || !canFinish) return;
    saving.current = true;
    setError('');
    setBusy(true);
    try {
      const { workout, sync } = await saveSession(session, separateLog);
      onSave(workout, sync);
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

  const close = () => {
    if (saving.current) return;
    voice.stop();
    onClose();
  };

  function runVoiceCommand(command: NonNullable<ReturnType<typeof workoutVoiceCommand>>): string | void {
    if (command.action === 'turn off voice commands') return voice.stop();
    if (saving.current) return;
    if (command.action === 'pause session' && !finish) return close();
    if (finish) {
      if (command.action === 'back to session') return setFinish(false);
      if (command.action === saveLabel.toLowerCase() && canFinish) {
        void save();
        return;
      }
      return `Say “${saveLabel.toLowerCase()}” or “back to session.”`;
    }

    const resting = phase === 'rest' && (coach?.restUntil ?? 0) > Date.now();
    switch (command.action) {
      case 'ready':
        if (phase === 'setup' || phase === 'rest' && !resting) return continueCoach();
        if (resting) return 'Say “skip rest” to continue before the timer ends.';
        break;
      case 'skip rest':
        if (phase === 'rest') return continueCoach();
        if (!coach && session.restDeadline != null) {
          setExpandedTimer(null);
          return onChange({ ...session, restDeadline: null });
        }
        break;
      case 'start rest timer':
        if (!coach && (session.restDeadline ?? 0) <= Date.now()) {
          if (!restDuration) return 'Choose a rest duration first.';
          setExpandedTimer('rest');
          return onChange({ ...session, restDeadline: Date.now() + restDuration });
        }
        break;
      case 'add 30 seconds':
        if (phase === 'rest') return extendRest() ? 'Added 30 seconds.' : 'The countdown already has close to five minutes left.';
        break;
      case 'skip exercise':
        if (phase === 'setup' || phase === 'set') return skipExercise();
        break;
      case 'next exercise':
        if (nextName && (phase === 'complete' || phase === 'rest' && !resting)) return continueCoach();
        if (!coach && position < movements.length - 1) return moveTo(position + 1);
        break;
      case 'message':
        if (!coachMessage.current) break;
        coachMessage.current(command.question);
        if (!command.question) return 'Say “message coach” followed by your question.';
        return;
      case 'undo last set':
        if (performed.length) return updateSets(performed.slice(0, -1));
        break;
      case 'finish session':
        if (canFinish) return setFinish(true);
        break;
      case 'record set':
      case 'report':
      case 'weight':
      case 'use last load':
      case 'start hold timer':
      case 'stop hold timer':
        if (setCommand.current) return setCommand.current(command);
        break;
    }
    return 'That command isn’t available at this step.';
  }

  const firstStep = phase === 'setup';
  const technique = exercise && (exercise.demonstration || exercise.cues.length > 0) && <Button compact kind="quiet" icon={Video}
    aria-expanded={showDemonstration} onPress={() => setDemonstrating(showDemonstration ? null : exercise.id)}>
    {showDemonstration ? 'Hide technique' : 'Show technique'}
  </Button>;
  const exerciseDetails = <>
    {(!firstStep || technique) && <View style={styles.activeHead}>
      {!firstStep && <View style={styles.exerciseTitle}>
        <Dumbbell aria-hidden size={20} color={color.forest} />
        <Copy accessibilityRole="header" aria-level={3} size={19} weight="bold" style={{ flexShrink: 1 }}>{name}</Copy>
      </View>}
      {technique}
    </View>}
    {current?.replacesExerciseId && <Copy size={12} tone={color.muted}>
      Replaces {exerciseRecords.get(current.replacesExerciseId)?.name ?? current.replacesExerciseId}
    </Copy>}
    {recent && <View style={styles.lastSession}>
      <Copy size={12} weight="semibold">Last session · {formatDay(recent.workout.date, { month: 'short', day: 'numeric', year: 'numeric' })}</Copy>
      <Copy size={12} tone={color.muted}>{lastSetsSummary(exercise, previousSets)}</Copy>
      {recent.movement.notes && <Copy size={12} tone={color.muted}>Last exercise note · {recent.movement.notes}</Copy>}
    </View>}
    {exerciseId && <TrainerExerciseCue exerciseId={exerciseId} />}
    {session.formCue?.exerciseId === exerciseId && <Notice action={<View style={styles.actions}>
      <Button compact kind="quiet" onPress={() => { onClose(); router.navigate({ pathname: '/form-review', params: { clip: session.formCue!.clipId } }); }}>View clip</Button>
      <Button compact kind="quiet" onPress={() => onChange({ ...session, formCue: undefined })}>Clear form cue</Button>
    </View>}>{'Cue to try next set · ' + session.formCue.text}</Notice>}
    {exercise && showDemonstration && <View style={{ gap: 8 }}>
      <Demonstration exercise={exercise} />
      {exercise.cues.map((cue) => <Copy key={cue} tone={color.muted} size={13}>{cue}</Copy>)}
      <TechniqueTips exercise={exercise} />
    </View>}
  </>;

  const setInput = current && performed.length < 30 && (!coach || phase === 'set') && <SetInput key={current.exerciseId}
    exercise={exercise} name={name}
    planned={coach ? guidedSet : current.setDetails?.[performed.length] ?? performed.at(-1) ?? (liveLog ? undefined : current)}
    next={performed.length + 1} commandRef={setCommand} optionalReps={Boolean(session.adHoc)}
    draft={session.setDrafts?.[current.exerciseId]} lastLoad={lastLoad} docked={docked}
    holdDeadline={holdDeadline} expandedHold={expandedTimer === 'hold'}
    onExpandedHoldChange={(expanded) => setExpandedTimer(expanded ? 'hold' : null)}
    onHold={(deadline) => onChange({ ...session, activeExercise: current.exerciseId,
      hold: deadline === null ? undefined : { exerciseId: current.exerciseId, setNumber: performed.length + 1, deadline } })}
    onDraft={draftSet} extra={!liveLog && performed.length >= current.sets}
    onRecord={(set) => updateSets([...performed, set])} />;

  let primaryLabel = 'Finish session';
  let primaryDisabled = !canFinish;
  let primaryAction = () => setFinish(true);
  if (finish) {
    primaryLabel = busy ? 'Saving…' : saveLabel;
    primaryDisabled = busy || !canFinish;
    primaryAction = () => void save();
  } else if (phase === 'setup' || phase === 'rest' || (phase === 'complete' && nextName)) {
    primaryLabel = phase === 'rest' && restSeconds > 0 ? 'Skip rest' : phase !== 'setup' && nextName ? 'Next exercise' : 'I’m ready';
    primaryDisabled = false;
    primaryAction = continueCoach;
  } else if (current && performed.length < 30 && (!coach || phase === 'set')) {
    primaryLabel = 'Record set';
    primaryDisabled = holdIsRunning;
    primaryAction = () => { setCommand.current?.({ action: 'record set' }); };
  }
  const footer = docked && (finish || current) ? <View style={styles.primaryDock}>
    {!finish && <View style={styles.dockContext}>
      <View style={{ flexShrink: 1 }}>
        <Copy size={13} weight="semibold" numberOfLines={1}>{name}</Copy>
        {(phase !== 'complete' || nextName) && <Copy size={12} tone={color.muted} numberOfLines={1}>
          {nextName ? 'Next · ' + nextName
            : `Set ${Math.min(performed.length + 1, current.sets)}${target ? ' · ' + performedSetSummary(exercise, target) : ''}`}
        </Copy>}
      </View>
      {phase === 'rest' && <Copy role="timer" size={22} weight="bold" style={styles.timerDigits}>{formatCountdown(restSeconds)}</Copy>}
    </View>}
    <Button icon={primaryLabel.startsWith('Save') || primaryLabel === 'Record set' ? Check : undefined}
      kind="primary" style={styles.phaseAction} disabled={primaryDisabled} onPress={primaryAction}>{primaryLabel}</Button>
  </View> : undefined;

  return <Sheet title={session.plan.name} detail={finish ? 'Review what you recorded before saving.'
    : current ? coach ? undefined : 'Record each set as you finish it.' : 'Add an exercise to start recording sets.'}
    wide={!finish && split} onClose={close} footer={footer}
    closeAction={!finish ? <Button compact icon={Pause} accessibilityLabel="Pause session" onPress={close}>Pause</Button> : undefined}>
    {storageError && <Notice error>Device storage is unavailable. Keep this workout open until you can sync it.</Notice>}
    {voice.available && current && <View style={styles.voice}>
      <View style={styles.voiceControls}>
        <Button compact icon={voice.enabled ? Mic : MicOff} kind={voice.enabled ? 'primary' : 'outline'}
          aria-pressed={voice.enabled} onPress={() => { setVoiceFeedback(''); voice.toggle(); }}>
          {voice.enabled ? 'Voice commands on' : 'Voice commands off'}
        </Button>
        <Button compact kind="quiet" aria-expanded={voiceHelp} onPress={() => setVoiceHelp(!voiceHelp)}>
          {voiceHelp ? 'Hide voice help' : 'Voice help'}
        </Button>
      </View>
      <Copy size={12} tone={color.muted} role="status" accessibilityLiveRegion="polite">{voice.status ||
        'Your browser may send microphone audio to its speech service.'}</Copy>
      {voice.enabled && (voiceFeedback || !voiceHelp) && <Copy size={12} role="status" accessibilityLiveRegion="polite">
        {voiceFeedback || (finish ? `Say “${saveLabel.toLowerCase()}” to save.` :
          phase === 'setup' ? 'Say “I’m ready” to start the set.' :
          phase === 'rest' ? 'Say “skip rest,” “add 30 seconds,” or “I’m ready” when rest ends.' :
          phase === 'complete' ? nextName ? 'Say “next exercise” to continue.' : 'Say “finish session” to review your log.' :
          'Say “I did 8 reps” or “I held for 30 seconds,” then “record set.”')}
      </Copy>}
      {(voiceHelp || voice.enabled) && data?.aiAvailable && coach && !finish &&
        <Copy size={12} tone={color.muted}>Some coach questions are sent to OpenAI for a reply.</Copy>}
      {voiceHelp && <View style={{ gap: 3 }}>
        <Copy size={12}>Say “I did 8 reps,” “I held for 30 seconds,” “weight 15 pounds,” “use last load,” or “record set.” For holds, say “start hold timer” or “stop hold timer.”</Copy>
        {coach ? <Copy size={12}>Say “I’m ready,” “skip rest,” “add 30 seconds,” “skip exercise,” or “message coach” followed by your question.</Copy>
          : <Copy size={12}>Say “start rest timer” for a one-minute rest or “skip rest” to stop it.</Copy>}
        <Copy size={12}>Say “next exercise,” “undo last set,” “pause session,” or “finish session.” On the review screen, say “{saveLabel.toLowerCase()}” or “back to session.” Say “turn off voice commands” to stop listening.</Copy>
      </View>}
    </View>}
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
        {!docked && <Button icon={Check} kind="primary" disabled={busy || !canFinish} onPress={() => void save()}>
          {busy ? 'Saving…' : saveLabel}
        </Button>}
        <Button icon={ChevronLeft} disabled={busy} onPress={() => setFinish(false)}>Back to session</Button>
      </View>
    </> : <>
      {!!movements.length && <View style={{ gap: 7 }}>
        <View style={styles.sessionProgress}>
          <Copy size={13} weight="semibold" tone={color.forest}>{`Exercise ${position + 1} of ${movements.length}`}</Copy>
          <Copy size={13} tone={color.muted} role="status" accessibilityLiveRegion="polite">{liveLog ? `${logged} ${logged === 1 ? 'set' : 'sets'} recorded` : `${plannedDone} of ${total} planned sets recorded`}</Copy>
        </View>
        {logged > 0 && !storageError && <Copy size={12} tone={color.muted}>Sets saved on this device</Copy>}
        {!liveLog && <View aria-hidden style={styles.track}><View style={[styles.fill, { width: `${100 * plannedDone / total}%` }]} /></View>}
      </View>}
      <View style={[styles.trainingLayout, split && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        {split && lineup}
        {current && <View style={[styles.active, split && { flex: 1.55 }]}>
          {docked && setInput}
          {!firstStep && exerciseDetails}
          {phase && <SessionCoach phase={phase} exercise={exercise} name={name} target={movementDone ? undefined : target}
            setNumber={performed.length + 1} setCount={current.sets} restSeconds={restSeconds} nextName={nextName} canFinish={canFinish}
            lastRecorded={performed.at(-1)} docked={docked}
            onContinue={continueCoach} onExtendRest={extendRest} onSkip={skipExercise} onReport={reportAmount}
            messageRef={coachMessage} readbackRef={speakReadback} setSpeaking={voice.setSpeaking} />}
          {firstStep && exerciseDetails}
          {!docked && setInput}
          {exercise && !liveLog && !movementDone && <Button compact kind="quiet" icon={ArrowLeftRight}
            aria-expanded={swapOpen} onPress={() => setSwap(swapOpen ? undefined : { exerciseId, blocked: [...exercise.equipment] })}>
            {swapOpen ? 'Hide substitutions' : 'Swap exercise'}
          </Button>}
          {swapOpen && exercise && <View style={styles.picker}>
            {exercise.equipment.length > 0 && <View style={styles.actions} role="group" accessibilityLabel="Equipment to avoid">
              {exercise.equipment.map((gear) => <Chip key={gear} label={`Avoid ${gear}`} selected={swap.blocked.includes(gear)}
                onPress={() => setSwap({ ...swap, blocked: swap.blocked.includes(gear)
                  ? swap.blocked.filter((item) => item !== gear) : [...swap.blocked, gear] })} />)}
            </View>}
            {alternatives.length ? <>
              <Copy size={12} tone={color.muted}>Similar muscles. Your recorded sets stay in this session.</Copy>
              {alternatives.map((sub) => <View key={sub.id} style={styles.substitution}>
                <Button compact onPress={() => substitute(sub)}>{'Swap to ' + sub.name}</Button>
                <Copy size={12} tone={color.muted}>{sub.equipment.join(' · ') || 'No equipment'}</Copy>
              </View>)}
            </> : <Copy size={12}>No substitutions fit this equipment and movement. Try changing which equipment to avoid.</Copy>}
          </View>}
          {exercise && !skipped.includes(exerciseId) && (videoDraft || videoProgress !== null
            ? <Button compact kind="quiet" icon={Video} onPress={() => { onClose(); router.navigate('/form-review'); }}>Open video draft</Button>
            : <>
              <CameraRecorder key={exerciseId} filmingTip={filmingTips[exerciseId]}
                selectionLabel="Continue to form review" onSelect={reviewVideo}
                alternateAction={<VideoPicker compact label="Upload recording" onSelect={reviewVideo} />} />
              {videoRejected && videoError && <Notice error>{videoError}</Notice>}
            </>)}
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
        {(!docked || primaryLabel !== 'Finish session') && <Button icon={Check} kind={phase === 'complete' && !nextName ? 'primary' : 'outline'} disabled={!canFinish}
          onPress={() => setFinish(true)}>Finish session</Button>}
        {current && !liveLog && <Button kind="quiet" aria-expanded={restSettings} onPress={() => setRestSettings(!restSettings)}>
          {restSettings ? 'Close rest settings' : 'Rest settings'}
        </Button>}
        {current && !liveLog && <Button kind="quiet" onPress={toggleCoach}>{coach ? 'Switch to manual' : 'Turn on coach'}</Button>}
      </View>
      {restSettings && <SelectField label="Rest between sets for this workout" value={String(restDuration / 1000)}
        options={restOptions} onChange={(value) => changeRest(Number(value))} />}
    </>}
  </Sheet>;
}

function setFields(planned: ExerciseSet | undefined, setNumber: number, draft?: TrainingSetDraft): TrainingSetDraft {
  if (draft?.setNumber === setNumber) return draft;
  return { setNumber, reps: planned?.reps === undefined ? '' : String(planned.reps),
    load: planned?.load ? String(planned.load.value) : '', unit: planned?.load?.unit ?? 'lb' };
}

function actualSets(movement: Movement) {
  if (movement.setDetails) return movement.setDetails;
  const { reps, load } = movement;
  return reps !== undefined || load ? Array.from({ length: movement.sets }, () => ({ reps, load })) : [];
}

function lastSetsSummary(exercise: Exercise | undefined, sets: ExerciseSet[]) {
  const groups = new Map<string, number>();
  for (const set of sets) {
    const summary = performedSetSummary(exercise, set);
    groups.set(summary, (groups.get(summary) ?? 0) + 1);
  }
  return Array.from(groups, ([summary, count]) => count === 1 ? summary : `${count} × ${summary}`).join(' / ');
}

function SetInput({ exercise, name, planned, next, draft, lastLoad, docked, holdDeadline, expandedHold, onExpandedHoldChange, onHold, onDraft, extra, optionalReps, onRecord, commandRef }: {
  exercise?: Exercise; name: string; planned?: ExerciseSet; next: number; draft?: TrainingSetDraft;
  lastLoad?: ExerciseLoad; docked: boolean;
  holdDeadline: number | null; expandedHold: boolean; onExpandedHoldChange: (expanded: boolean) => void;
  onHold: (deadline: number | null) => void;
  onDraft: (draft: TrainingSetDraft, resetHold?: boolean) => void; extra: boolean; optionalReps: boolean; onRecord: (set: ExerciseSet) => void;
  commandRef: Ref<(command: SetVoiceCommand) => string | void>;
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
      const message = optionalReps && !reps ? 'Enter reps, hold time, or weight to record a set.'
        : `Enter ${unit.toLowerCase()} from 1 to 600.`;
      setFailure({ next, message });
      return message;
    }
    if (weight.load && !validWeight(weight.load)) {
      const message = 'Enter a weight from 0.01 to 1000 kg or lb, or leave it blank.';
      setFailure({ next, message });
      return message;
    }
    setFailure(null);
    const set = { ...(reps && { reps: amount }), ...(weight.load && { load: { value: Number(weight.load.replace(',', '.')), unit: weight.unit } }) };
    onRecord(set);
    return `Recorded ${performedSetSummary(exercise, set)}.`;
  }

  function useLastLoad() {
    if (!lastLoad || !exercise?.loadType) return 'There is no recorded load for this exercise.';
    onDraft({ load: String(lastLoad.value), unit: lastLoad.unit, setNumber: next, reps });
    return `Entered ${performedSetSummary(exercise, { load: lastLoad })} from your last session. Say “record set” to confirm.`;
  }

  useImperativeHandle(commandRef, () => (command: SetVoiceCommand) => {
    const holdRunning = hold.remaining() > 0;
    switch (command.action) {
      case 'record set':
        return holdRunning ? 'Wait for the hold timer or say “stop hold timer” before recording.' : record();
      case 'start hold timer':
        if (unit === 'Seconds' && adjustable && !holdRunning) return startHold();
        return 'You can start the hold timer when a hold time is entered and the timer is stopped.';
      case 'stop hold timer':
        if (unit === 'Seconds' && hold.active) return stopHold();
        return 'There’s no hold timer to stop.';
      case 'report':
        if (holdRunning) return 'Wait for the hold timer or say “stop hold timer” before reporting your time.';
        if (command.unit !== unit.toLowerCase()) return `Report this set in ${unit.toLowerCase()}.`;
        if (!Number.isInteger(command.amount) || command.amount < 1 || command.amount > 600) return 'Enter a number from 1 to 600.';
        setReps(String(command.amount));
        return `I entered ${command.amount} ${command.amount === 1 ? command.unit.slice(0, -1) : command.unit}. Record the set when you’re ready.`;
      case 'weight':
        if (!exercise?.loadType) return 'This exercise doesn’t have a weight field.';
        if (!validWeight(command.load)) return 'Enter a weight from 0.01 to 1000 kg or lb.';
        onDraft({ load: command.load, unit: command.unit, setNumber: next, reps });
        return `Entered ${performedSetSummary(exercise, { load: { value: Number(command.load.replace(',', '.')), unit: command.unit } })}. Say “record set” to confirm.`;
      case 'use last load':
        return useLastLoad();
    }
  });

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
    {lastLoad && exercise?.loadType && <Button compact kind="quiet" accessibilityHint={performedSetSummary(exercise, { load: lastLoad })}
      style={{ alignSelf: 'flex-start' }} onPress={useLastLoad}>Use last load</Button>}
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
    {!docked && <Button icon={Check} kind="primary" disabled={runningHold} onPress={record}>Record set</Button>}
  </View>;
}

const styles = StyleSheet.create({
  voice: { gap: 5 },
  voiceControls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  trainingLayout: { gap: 16 },
  lineup: { minWidth: 0, gap: 10 },
  picker: { gap: 7, borderRadius: 8, padding: 10, backgroundColor: color.canvas },
  sessionProgress: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 },
  active: { padding: 15, borderRadius: radius.panel, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.line, gap: 12 },
  activeHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 7 },
  exerciseTitle: { flexDirection: 'row', alignItems: 'center', minWidth: 0, flexShrink: 1, gap: 8 },
  sessionFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7,
    borderTopWidth: 1, borderColor: color.line, paddingTop: 11 },
  track: { height: 8, borderRadius: 8, backgroundColor: color.soft, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: color.forest, borderRadius: 8 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'space-between', borderTopWidth: 1, borderColor: color.line, paddingVertical: 5 },
  lastSession: { gap: 3, paddingLeft: 9, borderLeftWidth: 2, borderColor: color.control },
  substitution: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  primaryDock: { borderTopWidth: 1, borderColor: color.line, backgroundColor: color.surface, gap: 7, padding: 12 },
  dockContext: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'center' },
  phaseAction: { minHeight: 50 },
  timerDigits: { fontVariant: ['tabular-nums'] },
});
