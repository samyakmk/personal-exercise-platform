import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Film, LockKeyhole, Pencil, Play, Search, SearchX, Sparkles, Trash2, Upload, X } from 'lucide-react-native';
import { Image, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useActiveSession } from '../activeSession';
import { mediaUrl, RequestError } from '../api';
import { Sheet } from '../components/Sheet';
import { Button, Copy, Empty, IconButton, Input, Loading, Notice, PageTitle, Panel, SectionTitle, Tag } from '../components/ui';
import { dateKey, formatDay, formatTime, workoutTime } from '../dates';
import { filmingTips } from '../formFilming';
import { CameraRecorder } from '../platform/CameraRecorder';
import { DownloadLink } from '../platform/DownloadLink';
import { ExercisePicker } from '../platform/ExercisePicker';
import { SelectField } from '../platform/fields';
import { VideoPicker } from '../platform/VideoPicker';
import { VideoPlayer } from '../platform/VideoPlayer';
import type { VideoPlayerHandle } from '../platform/videoTypes';
import { useTrainingNavigation } from '../navigation';
import { color, radius } from '../theme';
import { completedWorkouts } from '../trainingProgress';
import type { Clip, Exercise, FormCue, FormFeedback, ReviewRange, TrainingSessionMovementContext } from '../types';
import { useVideoUpload } from '../videoUpload';
import { useWorkspace } from '../workspace';

const maxReviewTime = 24 * 60 * 60;
const automaticRange = { start: '0', end: '' };

function reviewRange({ start, end }: typeof automaticRange, duration?: number): { value: ReviewRange; error?: string } {
  const startSeconds = /^\d{1,5}$/.test(start) ? Number(start) : NaN;
  const endSeconds = end === '' ? undefined : /^\d{1,5}$/.test(end) ? Number(end) : NaN;
  const value = { startSeconds, endSeconds };
  if (!Number.isFinite(startSeconds) || startSeconds > maxReviewTime
    || (endSeconds !== undefined && (!Number.isFinite(endSeconds) || endSeconds > maxReviewTime))) {
    return { value, error: 'Enter times in whole seconds.' };
  }
  if (endSeconds !== undefined && endSeconds <= startSeconds) {
    return { value, error: 'End time must be after start time.' };
  }
  if (duration && Number.isFinite(duration) && (startSeconds + 1 > duration || (endSeconds ?? 0) > duration)) {
    return { value, error: 'Choose a range within the video with at least one second of footage.' };
  }
  return { value };
}

function rangeKey({ startSeconds = 0, endSeconds }: Partial<ReviewRange>) {
  return startSeconds + ':' + (endSeconds ?? '');
}

function rangeLabel({ startSeconds = 0, endSeconds }: Partial<ReviewRange>) {
  return formatTimestamp(startSeconds) + (endSeconds === undefined ? '' : '–' + formatTimestamp(endSeconds));
}

function TimeRangeOptions({ times, onChange, player, ready, error, errorId }: {
  times: typeof automaticRange; onChange: (times: typeof automaticRange) => void;
  player: RefObject<VideoPlayerHandle | null>; ready: boolean; error?: string; errorId: string;
}) {
  const [open, setOpen] = useState(false);
  const custom = times.start !== '0' || times.end !== '';
  const range = reviewRange(times).value;
  function usePlayhead(field: keyof typeof automaticRange) {
    const position = Math.max(0, Math.min(maxReviewTime, Math.floor(player.current?.position() ?? 0)));
    onChange({ ...times, [field]: String(position) });
  }
  return <View style={styles.rangeOptions}>
    <Button compact kind="quiet" end={open ? ChevronUp : ChevronDown} aria-expanded={open}
      style={{ alignSelf: 'flex-start' }} onPress={() => setOpen(!open)}>
      {custom && !error ? 'Time range · ' + rangeLabel(range) : 'Choose time range'}
    </Button>
    {open && <View style={styles.window}>
      <View style={styles.rangeFields}>
        {(['start', 'end'] as const).map((field) => <View key={field} style={styles.rangeField}>
          <Input label={field === 'start' ? 'Start time (seconds)' : 'End time (seconds)'}
            value={times[field]} placeholder={field === 'end' ? 'Automatic' : undefined}
            onChangeText={(text) => onChange({ ...times, [field]: text })}
            inputMode="numeric" autoComplete="off" autoCorrect={false} spellCheck={false} maxLength={5}
            aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} />
          <Button compact kind="quiet" disabled={!ready} onPress={() => usePlayhead(field)}>{'Use playhead for ' + field}</Button>
        </View>)}
      </View>
      {custom && <Button compact kind="quiet" style={{ alignSelf: 'flex-start' }} onPress={() => onChange(automaticRange)}>Clear time range</Button>}
    </View>}
    {error && <Copy nativeID={errorId} size={12} tone={color.danger}>{error}</Copy>}
  </View>;
}

function clipSize(bytes: number) {
  return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

export function FormReview() {
  const { api, data, exerciseRecords, mutate, announce, startReview, cancelReview } = useWorkspace();
  const { draft, exercise, error, progress, pick, chooseExercise, clear: clearVideo, upload, cancel } = useVideoUpload();
  const { session, applyFormCue } = useActiveSession();
  const { intent, clear, open } = useTrainingNavigation();
  const router = useRouter();
  const { clip: requested, at } = useLocalSearchParams<{ clip?: string; at?: string }>();
  const [preview, setPreview] = useState<{ id: string; state: 'ready' | 'failed' }>();
  const [draftRange, setDraftRange] = useState<{ id: string; times: typeof automaticRange }>();
  const [clipSearch, setClipSearch] = useState('');
  const [clipLimit, setClipLimit] = useState(10);
  const mounted = useRef(false);
  const previewPlayer = useRef<VideoPlayerHandle>(null);
  const wide = useWindowDimensions().width >= 1100;

  useEffect(() => {
    if (intent?.type !== 'review' || progress !== null) return;
    chooseExercise(intent.exerciseId);
    if (requested) router.setParams({ clip: undefined, at: undefined });
    clear();
  }, [intent, clear, chooseExercise, progress, requested, router]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  if (!data) return null;

  const catalog = data.catalog;
  const autoDetectOption = { value: '', label: data.aiAvailable ? 'Detect for me' : 'No exercise selected' };
  const clipExerciseName = (clip: Clip) => exerciseRecords.get(clip.exerciseId || clip.review?.detectedExerciseId || '')?.name;
  const selected = data.clips.find((clip) => clip.id === requested);
  const closeVideo = () => router.setParams({ clip: undefined, at: undefined });
  const busy = progress !== null;
  const converting = draft?.clip.mime === 'video/quicktime';
  const previewStatus = preview?.id === draft?.id ? preview?.state : undefined;
  const canUpload = converting || previewStatus === 'ready';
  const canAnalyzeUpload = data.aiAvailable && previewStatus === 'ready';
  const draftTimes = draftRange?.id === draft?.id ? draftRange?.times ?? automaticRange : automaticRange;
  const previewDuration = previewStatus === 'ready' ? previewPlayer.current?.duration() : undefined;
  const previewRange = reviewRange(draftTimes, previewDuration);
  const resumeWorkout = session ? () => open({ type: 'resume-session' }) : undefined;
  const recent = new Set(completedWorkouts(data.workouts, workoutTime(), 5)
    .flatMap((workout) => workout.exercises.map((entry) => entry.exerciseId)));
  const ordered = [...catalog].sort((a, b) => Number(recent.has(b.id)) - Number(recent.has(a.id)));
  const selectedExercise = exerciseRecords.get(exercise);
  if (selectedExercise && !ordered.some(({ id }) => id === exercise)) ordered.unshift(selectedExercise);
  const terms = clipSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matching = data.clips.filter((clip) => {
    const searchText = `${clip.filename} ${clipExerciseName(clip) ?? ''}`.toLowerCase();
    return terms.every((term) => searchText.includes(term));
  });

  async function saveVideo(range?: ReviewRange) {
    if (!canUpload) return;
    const id = await upload(range);
    if (id && mounted.current) {
      router.setParams({ clip: id, at: undefined });
      setClipSearch('');
      setClipLimit(10);
    }
  }

  return <View nativeID="trainer-plus-add-clip" style={styles.page}>
    <PageTitle title="Form review" />
    {session && <Notice action={<Button compact onPress={resumeWorkout}>Resume workout</Button>}>
      {`Workout in progress · ${session.plan.name}`}
    </Notice>}
    {requested && !selected && <Notice action={<Button compact kind="quiet" onPress={closeVideo}>Dismiss</Button>}>
      This video is unavailable in this workspace.
    </Notice>}

    <Panel style={styles.panel}>
      {data.clips.length > 0 && <SectionTitle title="Add a clip" />}
      {draft ? <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Copy weight="semibold" style={{ flex: 1 }}>{draft.clip.name} · {clipSize(draft.clip.size)}</Copy>
          {!busy && <IconButton icon={X} label="Remove selected video" onPress={clearVideo} />}
        </View>
        <VideoPlayer key={draft.id} ref={previewPlayer} uri={draft.clip.uri} label="Video preview"
          onReady={() => setPreview({ id: draft.id, state: 'ready' })} onError={() => setPreview({ id: draft.id, state: 'failed' })} />
        {converting && previewStatus === 'failed' && <Copy size={13} tone={color.muted}>Upload this video to preview it.</Copy>}
        {previewStatus === 'failed' && !converting && <Notice error>Choose a video your browser can play.</Notice>}
      </View> : <>
        <VideoPicker onSelect={pick} disabled={busy} />
        <CameraRecorder onSelect={pick} disabled={busy} filmingTip={filmingTips[exercise]} />
      </>}
      <ExercisePicker label="Exercise in your clip" value={exercise} onChange={chooseExercise} disabled={busy}
        options={[autoDetectOption, ...ordered.map((item) => ({ value: item.id, label: item.name, detail: recent.has(item.id) ? 'Recent' : undefined }))]} />
      {error && <Notice error>{error}</Notice>}
      {draft && (progress === null ? <>
        <View style={styles.uploadActions}>
          {canAnalyzeUpload && <Button icon={Sparkles} kind="primary" disabled={Boolean(previewRange.error)}
            onPress={() => saveVideo(previewRange.value)}>Upload and analyze</Button>}
          <Button icon={Upload} kind={canAnalyzeUpload ? 'outline' : 'primary'} disabled={!canUpload}
            onPress={() => saveVideo()}>Upload video</Button>
        </View>
        {canAnalyzeUpload && !draft.clip.recorded && <TimeRangeOptions key={draft.id} times={draftTimes}
          onChange={(times) => setDraftRange({ id: draft.id, times })} player={previewPlayer} ready
          error={previewRange.error} errorId="preview-range-error" />}
        {draft.clip.recorded && canAnalyzeUpload && previewRange.error && <Notice error>{previewRange.error}</Notice>}
      </> : <>
        <View accessibilityRole="progressbar" accessibilityLabel="Video upload"
          accessibilityValue={{ min: 0, max: 100, now: progress }}
          style={styles.uploadTrack}>
          <View style={[styles.uploadFill, { width: `${progress}%` }]} />
        </View>
        <View style={styles.uploadActions}>
          <Copy size={13} tone={color.muted}>{progress === 100
            ? converting ? 'Converting video…' : 'Saving video…'
            : `Uploading… ${progress}%`}</Copy>
          {(progress < 100 || converting) && <Button kind="quiet" compact onPress={cancel}>Cancel upload</Button>}
        </View>
      </>)}
      <View style={styles.privacy}>
        <LockKeyhole aria-hidden size={14} color={color.forest} />
        <Copy tone={color.muted} size={12} style={{ flexShrink: 1 }}>Uploading saves the video on the Trainer Plus server for your current workspace.</Copy>
      </View>
      {!data.aiAvailable && <Copy size={13} tone={color.muted}>Form feedback is unavailable. You can still save and play your videos.</Copy>}
      {data.aiAvailable && !draft && <Copy size={12} tone={color.muted}>
        {filmingTips[exercise] ?? 'Keep your full movement in frame, with good light and a steady camera.'} Include a few complete reps or a steady hold.
      </Copy>}
    </Panel>

    {data.clips.length > 0 && <View style={styles.videoHeading}>
      <SectionTitle title="Your videos" />
      {(data.clips.length > 1 || clipSearch !== '') && <View style={styles.search}>
        <Input label="Search your videos" hideLabel icon={Search} value={clipSearch} placeholder="Search your videos" maxLength={120}
          onChangeText={(value) => { setClipSearch(value); setClipLimit(10); }} />
        {clipSearch !== '' && <IconButton icon={X} size={43} label="Clear video search" onPress={() => setClipSearch('')} />}
      </View>}
    </View>}
    {data.clips.length > 0 && (matching.length === 0 ? <Empty title="No matching videos" message="Try another filename or exercise." icon={SearchX}
        action={<Button compact onPress={() => setClipSearch('')}>Clear search</Button>} />
      : <Panel style={styles.videoList}>{matching.slice(0, clipLimit).map((clip, index) => {
        const uploaded = formatDay(dateKey(new Date(clip.uploadedAt)), { month: 'short', day: 'numeric', year: 'numeric' });
        return <Pressable key={clip.id} accessibilityRole="button" accessibilityLabel={`Open video · ${clip.filename}`}
          onPress={() => router.setParams({ clip: clip.id, at: undefined })}
          style={({ hovered }) => [styles.videoRow, index > 0 && styles.videoRowBorder, hovered && styles.videoRowHover]}>
          <View style={styles.videoIcon} aria-hidden><Film color={color.forest} size={19} /></View>
          <View style={{ flex: 1, minWidth: 105, gap: 2 }}>
            <Copy weight="semibold" size={15}>{clipExerciseName(clip) ?? 'Exercise clip'}</Copy>
            <Copy size={12} tone={color.muted} numberOfLines={1}>{clip.filename}</Copy>
            {!wide && <Copy size={12} tone={color.muted}>Uploaded {uploaded}</Copy>}
          </View>
          {wide && <Copy size={12} tone={color.muted}>{uploaded}</Copy>}
          {(clip.reviewStatus.state !== 'idle' || clip.review) && <Tag>{clip.reviewStatus.state === 'running' ? 'Analyzing'
            : clip.reviewStatus.state === 'failed' ? 'Needs retry'
            : clip.reviewStatus.state === 'cancelled' ? 'Cancelled'
            : 'Reviewed'}</Tag>}
          <ChevronRight aria-hidden size={19} color={color.forest} />
        </Pressable>;
      })}</Panel>)}
    {matching.length > clipLimit && <Button onPress={() => setClipLimit((value) => value + 10)}>Show older videos</Button>}

    {selected && <SavedClip key={`${selected.id}:${selected.exerciseId}`} clip={selected} catalog={catalog} autoDetectOption={autoDetectOption}
      title={clipExerciseName(selected) ?? 'Exercise video'}
      canReview={data.aiAvailable && selected.size > 0} reviewVersion={data.reviewVersion} onClose={closeVideo} onResumeWorkout={resumeWorkout}
      activeSessionId={session?.logId} initialPosition={typeof at === 'string' ? Number(at) : undefined}
      onApplyCue={(context, cue) => {
        if (!applyFormCue(context, cue)) return false;
        resumeWorkout?.();
        return true;
      }}
      onOpenClip={(id) => router.setParams({ clip: id, at: undefined })}
      onRecordAgain={draft ? undefined : (id) => {
        chooseExercise(id);
        closeVideo();
        if (Platform.OS === 'web') requestAnimationFrame(() => document.getElementById('trainer-plus-add-clip')?.scrollIntoView({ block: 'start' }));
      }}
      onReview={(range, refresh) => startReview(selected.id, range, refresh)}
      onCancelReview={(sequence) => cancelReview(selected.id, sequence)}
      onChangeExercise={async (exerciseId) => {
        await mutate(() => api.changeClipExercise(selected.id, exerciseId, selected.exerciseId));
        announce('Exercise selection updated.');
      }}
      onDelete={async () => {
        await mutate(() => api.deleteClip(selected.id));
        closeVideo();
        announce('Video deleted.');
      }} />}
  </View>;
}

function Feedback({ review, detectedExercise, stillUrl, onSeek, onCarryCue, onRecordAgain }: {
  review: FormFeedback; detectedExercise?: string; stillUrl?: string; onSeek?: (seconds: number) => void;
  onCarryCue?: (cue: string, timestamp: number) => void; onRecordAgain?: () => void;
}) {
  const coverage = review.coverage;
  const title = {
    observations: 'Form observations',
    no_clear_issue: coverage ? review.observations.length ? 'A visible strength' : 'No specific cue from this section' : 'No clear correction',
    insufficient_visibility: 'Form could not be assessed',
    different_exercise: review.detectedExerciseId ? 'Exercise match is uncertain' : 'Exercise may differ from selection',
  }[review.verdict];
  return <View style={styles.feedbackContent}>
    <SectionTitle title={title} level={3} />
    {detectedExercise && <Copy size={12} tone={color.muted}>Detected exercise · {detectedExercise}</Copy>}
    {(coverage?.next || review.summary) && <Copy size={15}>{coverage?.next || review.summary}</Copy>}
    {review.verdict === 'insufficient_visibility' && onRecordAgain && <Button compact onPress={onRecordAgain}>Record another clip</Button>}
    {review.observations.map(({ timestamp, comparisonTimestamp, kind, observation, cue }, index) => (
      <View key={index} style={styles.observation}>
        <View style={styles.observationHeading}>
          <Copy size={13} weight="bold">{kind === 'strength' ? 'What to keep' : 'Adjustment to try'}</Copy>
          <View style={styles.timestamps}>
            {onSeek && comparisonTimestamp !== undefined && <Button compact kind="quiet"
              accessibilityLabel={`Compare ${formatTimestamp(comparisonTimestamp)} · Show comparison frame`}
              onPress={() => onSeek(comparisonTimestamp)}>{`Compare ${formatTimestamp(comparisonTimestamp)}`}</Button>}
            {onSeek ? <Button icon={Play} compact accessibilityLabel={`${formatTimestamp(timestamp)} · Show observation frame`}
              onPress={() => onSeek(timestamp)}>{formatTimestamp(timestamp)}</Button> : <Copy size={12}>{formatTimestamp(timestamp)}</Copy>}
          </View>
        </View>
        <Copy size={13}>{observation}</Copy>
        <Copy size={13} tone={color.muted}>{cue}</Copy>
        {index === 0 && kind === 'adjustment' && stillUrl && <AdjustmentFrames key={stillUrl} stillUrl={stillUrl} timestamp={timestamp}
          reference={review.observationFrame?.reference} />}
        {kind === 'adjustment' && onCarryCue && <Button compact icon={Play} onPress={() => onCarryCue(cue, timestamp)}>Try this cue next set</Button>}
      </View>
    ))}
    {(Boolean(coverage?.assessed.length) || review.limitations) && <View style={styles.reviewContext}>
      {coverage?.assessed.map((item) => <Copy size={12} key={item}>{item}</Copy>)}
      {review.limitations && <Copy size={12} tone={color.muted}>{review.limitations}</Copy>}
    </View>}
  </View>;
}

function AdjustmentFrames({ stillUrl, timestamp, reference }: {
  stillUrl: string; timestamp: number; reference: NonNullable<FormFeedback['observationFrame']>['reference'];
}) {
  const [clipFailed, setClipFailed] = useState(false);
  const [referenceFailed, setReferenceFailed] = useState(false);
  const time = formatTimestamp(timestamp);
  if (clipFailed) return <Copy size={12} tone={color.muted}>Video still unavailable. Use the timestamp to view this position.</Copy>;
  return <View style={styles.frameComparison}>
    <View style={styles.frameColumn}>
      <Copy size={12} weight="bold">Your form · {time}</Copy>
      <Image source={{ uri: stillUrl }} accessibilityLabel={`Your form at ${time}`}
        resizeMode="contain" style={styles.still} onError={() => setClipFailed(true)} />
    </View>
    {reference && <View style={styles.frameColumn}>
      <Copy size={12} weight="bold">Reference form</Copy>
      {referenceFailed ? <Copy size={12} tone={color.muted}>Reference still unavailable.</Copy> : <>
        <Image source={{ uri: Platform.OS === 'web' ? reference.path : mediaUrl(reference.path) }}
          accessibilityLabel={`Reference form · ${reference.phase}`}
          resizeMode="contain" style={styles.still} onError={() => setReferenceFailed(true)} />
        <Copy size={12}>{reference.phase}</Copy>
      </>}
      <Link href={reference.source} target="_blank" rel="noopener noreferrer">
        <Copy size={11} tone={color.forest} style={{ textDecorationLine: 'underline' }}>
          {reference.credit}{reference.time !== undefined ? ` · ${formatTimestamp(reference.time)}` : ''}
        </Copy>
      </Link>
    </View>}
  </View>;
}

function formatTimestamp(seconds: number) {
  const total = Math.round(seconds * 100);
  const minutes = Math.floor(total / 6000);
  const wholeSeconds = String(Math.floor(total / 100) % 60).padStart(2, '0');
  const fraction = String(total % 100).padStart(2, '0').replace(/0+$/, '');
  return `${minutes}:${wholeSeconds}${fraction ? '.' + fraction : ''}`;
}

function SavedClip({ clip, title, catalog, autoDetectOption, canReview, reviewVersion, onClose, onResumeWorkout, onReview, onCancelReview, onChangeExercise, onDelete,
  initialPosition, activeSessionId, onApplyCue, onRecordAgain, onOpenClip }: {
  clip: Clip; title: string; catalog: Exercise[]; autoDetectOption: { value: string; label: string };
  canReview: boolean; reviewVersion: number; onClose: () => void; onResumeWorkout?: () => void;
  onReview: (range: ReviewRange, refresh?: boolean) => Promise<void>; onCancelReview: (sequence: number) => Promise<void>;
  onChangeExercise: (exerciseId: string) => Promise<void>; onDelete: () => Promise<void>;
  initialPosition?: number; activeSessionId?: string;
  onApplyCue: (context: TrainingSessionMovementContext, cue: FormCue) => boolean;
  onRecordAgain?: (exerciseId: string) => void;
  onOpenClip: (id: string) => void;
}) {
  const { api, data, exerciseRecords } = useWorkspace();
  const [confirm, setConfirm] = useState(false);
  const [editExercise, setEditExercise] = useState(false);
  const [exercise, setExercise] = useState(clip.exerciseId);
  const [starting, setStarting] = useState(false);
  const analysisLock = useRef(false);
  const player = useRef<VideoPlayerHandle>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [pastReviews, setPastReviews] = useState<FormFeedback[]>([]);
  const [pastReviewError, setPastReviewError] = useState('');
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [selectedReviewRange, setSelectedReviewRange] = useState('');
  const [times, setTimes] = useState(() => {
    const range = clip.reviewStatus.state === 'idle' ? clip.review : clip.reviewStatus;
    return { start: String(range?.startSeconds ?? 0), end: String(range?.endSeconds ?? '') };
  });
  const [duration, setDuration] = useState(0);
  const split = useWindowDimensions().width >= 960;
  const analyzing = starting || clip.reviewStatus.state === 'running';
  const latestRange = rangeKey(clip.review ?? {});
  const latestReviewTime = clip.review?.reviewedAt;
  const latestSequence = clip.review?.sequence;
  const range = reviewRange(times, ready ? duration : undefined);
  const activeRange = rangeKey(range.value);
  const pastSections = pastReviews.filter((review) => rangeKey(review) !== latestRange);
  const sections = clip.review ? [clip.review, ...pastSections] : [];
  const failure = clip.reviewStatus.state === 'failed' ? clip.reviewStatus : null;
  const cancellation = clip.reviewStatus.state === 'cancelled' ? clip.reviewStatus : null;
  const savedHere = sections.find((review) => rangeKey(review) === activeRange);
  const viewedReview = pastSections.find((review) => rangeKey(review) === selectedReviewRange) ?? clip.review;
  const reviewedExercise = clip.exerciseId || viewedReview?.detectedExerciseId || '';
  const trainingContext = clip.trainingContext;
  const carriesCue = trainingContext?.sessionId === activeSessionId && trainingContext?.exerciseId === reviewedExercise;
  const linkedSession = trainingContext && data?.workouts.find(({ id, status }) => status === 'completed' && id === trainingContext.sessionId)
    || trainingContext?.workoutId && data?.workouts.find(({ id, status, exercises }) => id === trainingContext.workoutId && status === 'completed'
      && exercises.some(({ exerciseId }) => exerciseId === trainingContext.exerciseId));
  const reviewedHere = savedHere?.version === reviewVersion;
  const failedHere = Boolean(failure && rangeKey(failure) === activeRange);
  const cancelledHere = Boolean(cancellation && rangeKey(cancellation) === activeRange);
  const canAnalyzeSection = !reviewedHere || savedHere?.verdict === 'insufficient_visibility'
    || savedHere?.verdict === 'different_exercise' || failedHere || cancelledHere;
  const changeTimes = (value: typeof automaticRange) => { setTimes(value); setError(''); };
  const selectRange = ({ startSeconds = 0, endSeconds }: Partial<ReviewRange>) =>
    changeTimes({ start: String(startSeconds), end: String(endSeconds ?? '') });

  useEffect(() => {
    if (ready && initialPosition !== undefined && Number.isFinite(initialPosition) && initialPosition >= 0 && initialPosition < duration) {
      player.current?.seek(initialPosition);
    }
  }, [ready, initialPosition, duration]);

  useEffect(() => {
    if (retryAt === null) return;
    const timer = setTimeout(() => setRetryAt(null), Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt]);

  useEffect(() => {
    if (!latestReviewTime) return;
    const controller = new AbortController();
    api.clipReviewHistory(clip.id, controller.signal).then(({ reviews }) => {
      if (!controller.signal.aborted) {
        setPastReviews(reviews);
        setPastReviewError('');
      }
    }, (failure: Error) => {
      if (!controller.signal.aborted) setPastReviewError(failure.message);
    });
    return () => controller.abort();
  }, [clip.id, latestReviewTime, latestSequence, historyAttempt]);

  async function analyze(refresh = false) {
    if (analysisLock.current || range.error || retryAt !== null) return;
    analysisLock.current = true;
    setStarting(true);
    setError('');
    setSelectedReviewRange('');
    try { await onReview(range.value, refresh); }
    catch (failure) {
      setError((failure as Error).message);
      if (failure instanceof RequestError && failure.retryAfter) setRetryAt(Date.now() + Math.min(failure.retryAfter, 300) * 1000);
    }
    finally {
      analysisLock.current = false;
      setStarting(false);
    }
  }

  async function remove() {
    setBusy(true);
    try { await onDelete(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (cancelling || clip.reviewStatus.state !== 'running') return;
    setCancelling(true);
    setError('');
    try { await onCancelReview(clip.reviewStatus.sequence); }
    catch (failure) { setError((failure as Error).message); }
    finally { setCancelling(false); }
  }

  async function saveExercise() {
    if (busy || analyzing || exercise === clip.exerciseId) return;
    setBusy(true);
    setError('');
    try { await onChangeExercise(exercise); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  if (editExercise) return <Sheet title="Change video exercise" detail={clip.filename} onClose={() => {
    if (!busy) { setEditExercise(false); setError(''); }
  }}>
    <ExercisePicker label="New exercise selection" value={exercise} onChange={setExercise} disabled={busy}
      options={[autoDetectOption, ...catalog.map(({ id, name }) => ({ value: id, label: name }))]} />
    {clip.review && <Notice>Saving clears the previous feedback so you can analyze this clip for the new exercise.</Notice>}
    {error && <Notice error>{error}</Notice>}
    <View style={styles.uploadActions}>
      <Button kind="primary" disabled={busy || analyzing || exercise === clip.exerciseId} onPress={() => void saveExercise()}>
        {busy ? 'Saving…' : 'Save exercise selection'}
      </Button>
      <Button disabled={busy} onPress={() => { setEditExercise(false); setError(''); }}>Back to video</Button>
    </View>
  </Sheet>;

  return <Sheet title={confirm ? 'Delete video?' : title}
    detail={confirm ? `“${clip.filename}” and its saved feedback will be removed from your workspace.` : clip.filename}
    wide={!confirm}
    onClose={() => { if (!busy) onClose(); }}>
    {!confirm && onResumeWorkout && <Button compact icon={Play} onPress={onResumeWorkout}>Resume workout</Button>}
    {!confirm && <View style={split ? styles.reviewColumns : styles.reviewColumn}>
      <View nativeID={split ? 'trainer-plus-review-player' : undefined} style={[styles.reviewColumn, split && { flex: 1.1, alignSelf: 'flex-start' }]}>
        {clip.size > 0 ? <VideoPlayer key={playbackAttempt} ref={player} uri={api.clipUrl(clip.id)} label="Saved exercise video" detailed
          onReady={() => {
            setDuration(player.current?.duration() ?? 0);
            setReady(true);
            setPlaybackFailed(false);
          }}
          onError={() => { setReady(false); setPlaybackFailed(true); }} />
          : <Notice>This archive includes saved feedback. Import the original video to play it or review another section.</Notice>}
        {playbackFailed && <Button compact onPress={() => { setPlaybackFailed(false); setPlaybackAttempt((value) => value + 1); }}>
          Reload video player
        </Button>}
        <View role="group" accessibilityLabel="Video actions" style={styles.uploadActions}>
          {clip.size > 0 && <DownloadLink href={api.clipDownloadUrl(clip.id)} label="Download video" compact />}
          {clip.size > 0 && <Button icon={Pencil} compact kind="quiet" disabled={analyzing || cancelling} onPress={() => {
            setExercise(clip.exerciseId); setEditExercise(true); setError('');
          }}>Change exercise</Button>}
          <Button icon={Trash2} compact kind="quiet" disabled={busy || starting || cancelling}
            onPress={() => setConfirm(true)}>Delete video</Button>
        </View>
        {trainingContext && <Copy size={12} tone={color.muted}>
          {`Linked to set ${trainingContext.setNumber} · ${exerciseRecords.get(trainingContext.exerciseId)?.name ?? 'Workout exercise'}`}
        </Copy>}
        {linkedSession && <Link href={{ pathname: '/sessions', params: { session: linkedSession.id } }}>Open linked session</Link>}
      </View>
      <View style={[styles.reviewColumn, split && { flex: 1 }]}>
        {clip.review && <>
          {pastSections.length > 0 && <SelectField label="Saved review section"
            value={viewedReview === clip.review ? '' : selectedReviewRange}
            options={[{ value: '', label: `Latest · ${rangeLabel(clip.review)}` }, ...pastSections.map((review) => ({
              value: rangeKey(review), label: rangeLabel(review),
            }))]}
            onChange={(value) => {
              setSelectedReviewRange(value);
              selectRange(pastSections.find((review) => rangeKey(review) === value) ?? clip.review ?? {});
            }} />}
          {pastReviewError && <Notice error action={<Button compact onPress={() => setHistoryAttempt((value) => value + 1)}>Retry loading sections</Button>}>
            Saved review sections could not be loaded.
          </Notice>}
          {viewedReview && <><Feedback review={viewedReview}
            detectedExercise={exerciseRecords.get(viewedReview.detectedExerciseId ?? '')?.name}
            stillUrl={viewedReview.observationFrame && viewedReview.sequence ? api.reviewStillUrl(clip.id, viewedReview.sequence) : undefined}
            onSeek={clip.size > 0 ? (seconds) => player.current?.seek(seconds) : undefined}
            onRecordAgain={onRecordAgain ? () => onRecordAgain(reviewedExercise) : undefined}
            onCarryCue={carriesCue && trainingContext ? (text, timestamp) => {
              if (!onApplyCue(trainingContext, { exerciseId: reviewedExercise, text, timestamp, clipId: clip.id,
                startSeconds: viewedReview.startSeconds ?? 0 })) setError('The linked workout is no longer in progress.');
            } : undefined} />
            <CompareClips key={viewedReview.sequence} clip={clip} review={viewedReview} exerciseId={reviewedExercise} onOpenClip={onOpenClip} />
          </>}
        </>}
        {canReview && <>
          {analyzing ? <View style={{ gap: 6 }}>
            <Loading label={clip.exerciseId ? 'Analyzing visible form…' : 'Detecting exercise and analyzing form…'} />
            <Copy size={13} tone={color.muted}>You can close this video and return to it while analysis runs.</Copy>
            <Button compact kind="quiet" disabled={starting || cancelling} onPress={cancel}>
              {cancelling ? 'Cancelling…' : 'Cancel analysis'}
            </Button>
          </View> : <>
            {failure && !error && <Notice error action={!failedHere
              ? <Button compact kind="quiet" onPress={() => selectRange(failure)}>Open failed section</Button>
              : undefined}>{failure.error}</Notice>}
            {!clip.exerciseId && (failure || viewedReview?.verdict === 'different_exercise') &&
              <Button icon={Pencil} compact onPress={() => { setExercise(''); setEditExercise(true); setError(''); }}>Choose exercise</Button>}
            {cancellation && <Notice action={!cancelledHere
              ? <Button compact kind="quiet" onPress={() => selectRange(cancellation)}>Open cancelled section</Button>
              : undefined}>Analysis cancelled. Your video is still saved.</Notice>}
            {canAnalyzeSection && <View style={styles.uploadActions}>
              <Button kind="primary" icon={Sparkles} disabled={Boolean(range.error) || retryAt !== null} onPress={() => analyze(reviewedHere)}>
                {retryAt !== null ? 'Retry shortly' : error || failedHere || cancelledHere
                  ? 'Retry analysis' : reviewedHere ? 'Review this section again' : clip.review ? 'Analyze this section' : 'Analyze form'}
              </Button>
            </View>}
            <TimeRangeOptions times={times} onChange={changeTimes} player={player} ready={ready}
              error={range.error} errorId="saved-range-error" />
          </>}
        </>}
        {!canReview && clip.size > 0 && !clip.review && <Copy size={13} tone={color.muted}>Form feedback is unavailable.</Copy>}
      </View>
    </View>}
    {error && <Notice error>{error}</Notice>}
    {confirm && <View style={styles.uploadActions}>
      <Button disabled={busy} onPress={() => { setConfirm(false); setError(''); }}>Keep video</Button>
      <Button kind="danger" icon={Trash2} disabled={busy || starting || cancelling}
        onPress={() => void remove()}>{busy ? 'Deleting…' : 'Delete video'}</Button>
    </View>}
  </Sheet>;
}

function CompareClips({ clip, review, exerciseId, onOpenClip }: {
  clip: Clip; review: FormFeedback; exerciseId: string; onOpenClip: (id: string) => void;
}) {
  const { data } = useWorkspace();
  const [compareId, setCompareId] = useState('');
  const options = exerciseId && review.verdict !== 'different_exercise' ? data?.clips.filter((item) => item.id !== clip.id && item.review
    && item.review.verdict !== 'different_exercise'
    && (item.exerciseId || item.review.detectedExerciseId) === exerciseId).slice(0, 8) ?? [] : [];
  const comparison = options.find(({ id }) => id === compareId);
  if (!options.length) return null;
  return <View style={styles.window}>
    <SelectField label="Compare with another clip" value={compareId} onChange={setCompareId} options={[
      { value: '', label: 'Choose a reviewed clip' }, ...options.map(({ id, filename, uploadedAt, trainingContext }) => {
        const { date, time } = workoutTime(new Date(uploadedAt));
        const set = trainingContext ? ` · Set ${trainingContext.setNumber}` : '';
        const day = formatDay(date, { month: 'short', day: 'numeric' });
        return { value: id, label: `${filename} · ${day}, ${formatTime(time)}${set}` };
      }),
    ]} />
    {comparison?.review && <>
      <Copy size={12} tone={color.muted}>Compare visible positions from a similar camera angle and the same phase of the rep.</Copy>
      <View style={styles.frameComparison}>
        <ComparisonFrame clip={clip} review={review} label="This clip" />
        <ComparisonFrame clip={comparison} review={comparison.review} label="Comparison clip" />
      </View>
      <Button kind="quiet" compact onPress={() => onOpenClip(comparison.id)}>Open comparison clip</Button>
    </>}
  </View>;
}

function ComparisonFrame({ clip, review, label }: { clip: Clip; review: FormFeedback; label: string }) {
  const { api } = useWorkspace();
  const observation = review.observations[0];
  return <View style={styles.frameColumn}>
    <Copy size={12} weight="semibold">{label}{observation && ` · ${formatTimestamp(observation.timestamp)}`}</Copy>
    {review.observationFrame && review.sequence && <Image style={styles.still} resizeMode="contain"
      source={{ uri: api.reviewStillUrl(clip.id, review.sequence) }} accessibilityLabel={`${label} cited frame`} />}
    <Copy size={12}>{observation?.cue || review.summary || 'No cue was recorded for this section.'}</Copy>
  </View>;
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  search: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, width: 320, maxWidth: '100%' },
  uploadTrack: { backgroundColor: color.soft, borderRadius: 6, height: 7, overflow: 'hidden' },
  uploadFill: { backgroundColor: color.forest, height: '100%' },
  uploadActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  panel: { padding: 18, gap: 12, maxWidth: 760 },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  reviewColumns: { flexDirection: 'row', gap: 20, alignItems: 'flex-start' },
  reviewColumn: { gap: 12, minWidth: 0 },
  videoHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  videoList: { overflow: 'hidden' },
  videoRow: { paddingHorizontal: 14, paddingVertical: 12, minHeight: 69, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  videoRowHover: { backgroundColor: color.soft },
  videoRowBorder: { borderTopWidth: 1, borderColor: color.line },
  videoIcon: { width: 40, height: 40, borderRadius: radius.control, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  feedbackContent: { gap: 10 },
  reviewContext: { gap: 4, marginTop: 2, paddingTop: 8, borderTopWidth: 1, borderColor: color.line },
  observation: { gap: 5, backgroundColor: color.tint, borderRadius: radius.control, padding: 11 },
  timestamps: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  observationHeading: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  frameComparison: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 5 },
  frameColumn: { flex: 1, minWidth: 0, gap: 4 },
  still: { width: '100%', aspectRatio: 4 / 3, maxHeight: 250, borderRadius: 7, backgroundColor: color.ink },
  window: { gap: 9, padding: 13, borderColor: color.line, borderWidth: 1, borderRadius: radius.panel },
  rangeOptions: { gap: 5 },
  rangeFields: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rangeField: { flexGrow: 1, minWidth: 140, maxWidth: 220, gap: 3, alignItems: 'stretch' },
});
