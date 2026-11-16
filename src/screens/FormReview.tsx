import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronUp, Film, LockKeyhole, Pencil, Play, ScanLine, Search, SearchX, Sparkles, Trash2, Upload, X } from 'lucide-react-native';
import { Image, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useActiveSession } from '../activeSession';
import { mediaUrl, RequestError } from '../api';
import { Sheet } from '../components/Sheet';
import { Button, Copy, Empty, IconButton, Input, Loading, Notice, PageTitle, Panel, SectionTitle, Tag } from '../components/ui';
import { dateKey, formatDay, workoutTime } from '../dates';
import { filmingTips } from '../formFilming';
import { CameraRecorder } from '../platform/CameraRecorder';
import { DownloadLink } from '../platform/DownloadLink';
import { ExercisePicker } from '../platform/ExercisePicker';
import { SelectField } from '../platform/fields';
import { VideoPicker } from '../platform/VideoPicker';
import { VideoPlayer } from '../platform/VideoPlayer';
import type { VideoPlayerHandle } from '../platform/videoTypes';
import { useTrainingNavigation } from '../navigation';
import { color } from '../theme';
import { completedWorkouts } from '../trainingProgress';
import type { Clip, Exercise, FormFeedback } from '../types';
import { useVideoUpload } from '../videoUpload';
import { useWorkspace } from '../workspace';

const maxReviewStartSeconds = 24 * 60 * 60;

function clipSize(bytes: number) {
  return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

export function FormReview() {
  const { api, data, exerciseRecords, mutate, announce, startReview, cancelReview } = useWorkspace();
  const { draft, exercise, error, progress, pick, chooseExercise, clear: clearVideo, upload, cancel } = useVideoUpload();
  const { session } = useActiveSession();
  const { intent, clear, open } = useTrainingNavigation();
  const router = useRouter();
  const { clip: requested } = useLocalSearchParams<{ clip?: string }>();
  const [preview, setPreview] = useState<{ id: string; state: 'ready' | 'failed' }>();
  const [clipSearch, setClipSearch] = useState('');
  const [clipLimit, setClipLimit] = useState(10);
  const [uploadOpen, setUploadOpen] = useState(false);
  const mounted = useRef(false);
  const wide = useWindowDimensions().width >= 1100;

  useEffect(() => {
    if (intent?.type !== 'review' || progress !== null) return;
    chooseExercise(intent.exerciseId);
    setUploadOpen(true);
    if (requested) router.setParams({ clip: undefined });
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
  const closeVideo = () => router.setParams({ clip: undefined });
  const busy = progress !== null;
  const showUploader = !data.clips.length || uploadOpen || Boolean(draft) || Boolean(error) || busy;
  const converting = draft?.clip.mime === 'video/quicktime';
  const previewStatus = preview?.id === draft?.id ? preview?.state : undefined;
  const canUpload = converting || previewStatus === 'ready';
  const analyzeOnUpload = data.aiAvailable && !exercise;
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

  async function saveVideo() {
    if (!canUpload) return;
    const id = await upload();
    if (id && mounted.current) {
      router.setParams({ clip: id });
      setClipSearch('');
      setClipLimit(10);
      setUploadOpen(false);
    }
  }

  return <View style={styles.page}>
    <PageTitle title="Form review" summary="Review your technique alongside your video."
      action={data.clips.length > 0 && !draft && !busy && !error
        ? <Button kind={showUploader ? 'quiet' : 'primary'} icon={showUploader ? ChevronUp : Upload}
          aria-expanded={showUploader} onPress={() => setUploadOpen((value) => !value)}>{showUploader ? 'Hide upload' : 'Add a video'}</Button>
        : undefined} />
    {session && <Notice action={<Button compact onPress={() => open({ type: 'resume-session' })}>Resume workout</Button>}>
      {`Workout paused · ${session.plan.name}`}
    </Notice>}
    {requested && !selected && <Notice action={<Button compact kind="quiet" onPress={closeVideo}>Dismiss</Button>}>
      This video is unavailable in this workspace.
    </Notice>}

    {showUploader && <View style={[styles.uploadLayout, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
      <Panel style={[styles.panel, wide && { flex: 1.55 }]}>
        <SectionTitle title="Add a clip" />
        <ExercisePicker label="Exercise in your clip" value={exercise} onChange={chooseExercise} disabled={busy}
          options={[autoDetectOption, ...ordered.map((item) => ({ value: item.id, label: item.name, detail: recent.has(item.id) ? 'Recent' : undefined }))]} />
        {draft ? <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Copy weight="semibold" size={13} style={{ flex: 1 }}>{draft.clip.name} · {clipSize(draft.clip.size)}</Copy>
            {!busy && <IconButton icon={X} label="Remove selected video" onPress={clearVideo} />}
          </View>
          {converting
            ? <Copy size={13} tone={color.muted}>Liftmorrow converts this MOV to MP4 for playback after upload.</Copy>
            : <VideoPlayer key={draft.id} uri={draft.clip.uri} label="Video preview"
              onReady={() => setPreview({ id: draft.id, state: 'ready' })} onError={() => setPreview({ id: draft.id, state: 'failed' })} />}
          {previewStatus === 'failed' && <Copy size={12} tone={color.muted}>Choose a video your browser can play.</Copy>}
          {analyzeOnUpload && <Copy size={12} tone={color.muted}>Liftmorrow sends up to eight still frames per step from the first 20 seconds to OpenAI to identify the exercise and review your form. It may reuse the adjustment frame to match a reference image.</Copy>}
          {progress === null ? <Button icon={Upload} kind="primary" disabled={!canUpload}
            onPress={saveVideo}>{analyzeOnUpload ? 'Upload and analyze' : 'Upload video'}</Button> : <>
            <View accessibilityRole="progressbar" accessibilityLabel="Video upload"
              accessibilityValue={{ min: 0, max: 100, now: progress }}
              style={styles.uploadTrack}>
              <View style={[styles.uploadFill, { width: `${progress}%` }]} />
            </View>
            <View style={styles.uploadActions}>
              <Copy size={13} tone={color.muted}>{progress === 100
                ? converting ? 'Converting video…' : 'Saving video…'
                : `Uploading… ${progress}%`}</Copy>
              {(progress < 100 || converting)
                && <Button kind="quiet" compact onPress={cancel}>Cancel upload</Button>}
            </View>
          </>}
        </View> : <>
          <VideoPicker onSelect={pick} disabled={busy} />
          <CameraRecorder onSelect={pick} disabled={busy} filmingTip={filmingTips[exercise]} />
        </>}
        {error && <Notice error>{error}</Notice>}
        <View style={styles.privacy}>
          <LockKeyhole aria-hidden size={14} color={color.plum} />
          <Copy tone={color.muted} size={12} style={{ flex: 1 }}>Videos are saved in this browser workspace.</Copy>
        </View>
      </Panel>

      <View style={[styles.filming, wide && { flex: 1 }]}>
        <View style={styles.filmingTitle}>
          <ScanLine aria-hidden size={18} color={color.plum} />
          <Copy accessibilityRole="header" aria-level={2} size={16} weight="bold">{data.aiAvailable ? 'For a clear review' : 'Playback only'}</Copy>
        </View>
        <Copy size={13} tone={color.muted}>{data.aiAvailable
          ? filmingTips[exercise] ?? 'Keep your full movement in frame, with good light and a steady camera.'
          : 'AI analysis is unavailable on this server. You can still save and play your videos.'}</Copy>
        {data.aiAvailable && exercise !== '' && <Copy size={13} tone={color.muted}>Include a few complete reps or a steady hold.</Copy>}
      </View>
    </View>}

    <View style={styles.videoHeading}>
      <SectionTitle title="Your videos" />
      {(data.clips.length > 1 || clipSearch !== '') && <View style={styles.search}>
        <Input label="Search your videos" hideLabel icon={Search} value={clipSearch} placeholder="Search your videos" maxLength={120}
          onChangeText={(value) => { setClipSearch(value); setClipLimit(10); }} />
        {clipSearch !== '' && <IconButton icon={X} size={43} label="Clear video search" onPress={() => setClipSearch('')} />}
      </View>}
    </View>
    {data.clips.length === 0 ? <View style={styles.emptyVideos}>
      <Film aria-hidden color={color.plum} size={19} />
      <Copy tone={color.muted} size={13}>Your uploaded videos will appear here.</Copy>
    </View>
      : matching.length === 0 ? <Empty title="No matching videos" message="Try another filename or exercise." icon={SearchX}
        action={<Button compact onPress={() => setClipSearch('')}>Clear search</Button>} />
      : <Panel style={styles.videoList}>{matching.slice(0, clipLimit).map((clip, index) => {
        const date = dateKey(new Date(clip.uploadedAt));
        return <View key={clip.id} style={[styles.videoRow, index > 0 && styles.videoRowBorder]}>
          <View style={styles.videoIcon} aria-hidden><Film color={color.plum} size={19} /></View>
          <View style={{ flex: 1, minWidth: 105, gap: 2 }}>
            <Copy weight="semibold" size={15}>{clipExerciseName(clip) ?? 'Exercise clip'}</Copy>
            <Copy size={12} tone={color.muted} numberOfLines={1}>{clip.filename}</Copy>
          </View>
          {wide && <Copy size={12} tone={color.muted}>{formatDay(date, { month: 'short', day: 'numeric', year: 'numeric' })}</Copy>}
          {(clip.reviewStatus.state !== 'idle' || clip.review) && <Tag>{clip.reviewStatus.state === 'running' ? 'Analyzing'
            : clip.reviewStatus.state === 'failed' ? 'Needs retry'
            : clip.reviewStatus.state === 'cancelled' ? 'Cancelled'
            : 'Reviewed'}</Tag>}
          <Button kind="quiet" end={ArrowUpRight} onPress={() => router.setParams({ clip: clip.id })} compact
            accessibilityLabel={`Open video · ${clip.filename}`}>Open video</Button>
        </View>;
      })}</Panel>}
    {matching.length > clipLimit && <Button onPress={() => setClipLimit((value) => value + 10)}>Show older videos</Button>}

    {selected && <SavedClip key={`${selected.id}:${selected.exerciseId}`} clip={selected} catalog={catalog} autoDetectOption={autoDetectOption}
      title={clipExerciseName(selected) ?? 'Exercise video'}
      canReview={data.aiAvailable} reviewVersion={data.reviewVersion} onClose={closeVideo}
      onReview={(start, refresh) => startReview(selected.id, start, refresh)}
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

function Feedback({ review, detectedExercise, stillUrl, onSeek }: {
  review: FormFeedback; detectedExercise?: string; stillUrl?: string; onSeek: (seconds: number) => void;
}) {
  const title = {
    observations: 'Form observations',
    no_clear_issue: 'No clear correction',
    insufficient_visibility: 'Form could not be assessed',
    different_exercise: review.detectedExerciseId ? 'Exercise match is uncertain' : 'Exercise may differ from selection',
  }[review.verdict];
  return <View style={styles.feedbackContent}>
    <SectionTitle title={title} level={3} />
    {detectedExercise && <Copy size={12} tone={color.muted}>Detected exercise · {detectedExercise}</Copy>}
    {review.summary && <Copy size={15}>{review.summary}</Copy>}
    {review.observations.map(({ timestamp, comparisonTimestamp, kind, observation, cue }, index) => (
      <View key={index} style={styles.observation}>
        <View style={styles.observationHeading}>
          <Copy size={13} weight="bold">{kind === 'strength' ? 'What to keep' : 'Adjustment to try'}</Copy>
          <View style={styles.timestamps}>
            {comparisonTimestamp !== undefined && <Button compact kind="quiet"
              accessibilityLabel={`Compare ${formatTimestamp(comparisonTimestamp)} · Show comparison frame`}
              onPress={() => onSeek(comparisonTimestamp)}>{`Compare ${formatTimestamp(comparisonTimestamp)}`}</Button>}
            <Button icon={Play} compact accessibilityLabel={`${formatTimestamp(timestamp)} · Show observation frame`}
              onPress={() => onSeek(timestamp)}>{formatTimestamp(timestamp)}</Button>
          </View>
        </View>
        <Copy size={13}>{observation}</Copy>
        <Copy size={13} tone={color.muted}>{cue}</Copy>
        {kind === 'adjustment' && stillUrl && <AdjustmentFrames key={stillUrl} stillUrl={stillUrl} timestamp={timestamp}
          reference={review.observationFrame?.reference} />}
      </View>
    ))}
    <View style={styles.reviewContext}>
      {review.limitations && <Copy size={12} tone={color.muted}>{review.limitations}</Copy>}
      <Copy size={12} tone={color.muted}>AI review of {review.framesReviewed} frames from up to {review.windowSeconds} seconds of video, starting at {formatTimestamp(review.startSeconds ?? 0)}.</Copy>
    </View>
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
        <Copy size={11} tone={color.plum} style={{ textDecorationLine: 'underline' }}>
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

function SavedClip({ clip, title, catalog, autoDetectOption, canReview, reviewVersion, onClose, onReview, onCancelReview, onChangeExercise, onDelete }: {
  clip: Clip; title: string; catalog: Exercise[]; autoDetectOption: { value: string; label: string };
  canReview: boolean; reviewVersion: number; onClose: () => void;
  onReview: (startSeconds: number, refresh?: boolean) => Promise<void>; onCancelReview: (sequence: number) => Promise<void>;
  onChangeExercise: (exerciseId: string) => Promise<void>; onDelete: () => Promise<void>;
}) {
  const { api, exerciseRecords } = useWorkspace();
  const [confirm, setConfirm] = useState(false);
  const [editExercise, setEditExercise] = useState(false);
  const [showStart, setShowStart] = useState(false);
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
  const [selectedReviewStart, setSelectedReviewStart] = useState<number | null>(null);
  const [startText, setStartText] = useState(() => String(
    (clip.reviewStatus.state === 'idle' ? undefined : clip.reviewStatus.startSeconds) ?? clip.review?.startSeconds ?? 0,
  ));
  const [duration, setDuration] = useState(0);
  const split = useWindowDimensions().width >= 960;
  const analyzing = starting || clip.reviewStatus.state === 'running';
  const latestStart = clip.review?.startSeconds ?? 0;
  const latestReviewTime = clip.review?.reviewedAt;
  const latestSequence = clip.review?.sequence;
  const startSeconds = /^\d{1,5}$/.test(startText) ? Number(startText) : NaN;
  const validStart = Number.isSafeInteger(startSeconds) && startSeconds <= maxReviewStartSeconds;
  const pastSections = pastReviews.filter((review) => (review.startSeconds ?? 0) !== latestStart);
  const sections = clip.review ? [clip.review, ...pastSections] : [];
  const failure = clip.reviewStatus.state === 'failed' ? clip.reviewStatus : null;
  const cancellation = clip.reviewStatus.state === 'cancelled' ? clip.reviewStatus : null;
  const savedHere = sections.find((review) => (review.startSeconds ?? 0) === startSeconds);
  const viewedReview = selectedReviewStart === null ? clip.review
    : sections.find((review) => (review.startSeconds ?? 0) === selectedReviewStart) ?? clip.review;
  const reviewedHere = savedHere?.version === reviewVersion;
  const failedHere = failure?.startSeconds === startSeconds;
  const cancelledHere = cancellation?.startSeconds === startSeconds;
  const canAnalyzeSection = !reviewedHere || savedHere?.verdict === 'insufficient_visibility'
    || savedHere?.verdict === 'different_exercise' || failedHere || cancelledHere;
  const latestPossibleStart = Number.isFinite(duration) && duration > 0
    ? Math.max(0, Math.min(maxReviewStartSeconds, Math.floor(duration - 1))) : maxReviewStartSeconds;
  const tooLate = validStart && ready && (startSeconds > latestPossibleStart || (duration > 0 && duration < 1));
  const changeStart = (value: string) => { setStartText(value); setError(''); };
  const toggleStartOptions = () => {
    if (showStart && (!validStart || tooLate)) changeStart(String(Math.min(latestPossibleStart, latestStart)));
    setShowStart(!showStart);
  };
  const selectStart = (value: number) => changeStart(String(value));

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
    if (analysisLock.current || !validStart || tooLate || retryAt !== null) return;
    analysisLock.current = true;
    setStarting(true);
    setError('');
    setSelectedReviewStart(null);
    try { await onReview(startSeconds, refresh); }
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
    {!confirm && <View style={split ? styles.reviewColumns : styles.reviewColumn}>
      <View nativeID={split ? 'liftmorrow-review-player' : undefined} style={[styles.reviewColumn, split && { flex: 1.1, alignSelf: 'flex-start' }]}>
        <VideoPlayer key={playbackAttempt} ref={player} uri={api.clipUrl(clip.id)} label="Saved exercise video" detailed
          onReady={() => { setDuration(player.current?.duration() ?? 0); setReady(true); setPlaybackFailed(false); }}
          onError={() => { setReady(false); setPlaybackFailed(true); }} />
        {playbackFailed && <Button compact onPress={() => { setPlaybackFailed(false); setPlaybackAttempt((value) => value + 1); }}>
          Reload video player
        </Button>}
        <View style={styles.uploadActions}>
          <DownloadLink href={api.clipDownloadUrl(clip.id)} label="Download video" compact />
          <Button icon={Pencil} compact disabled={analyzing || cancelling} onPress={() => {
            setExercise(clip.exerciseId); setEditExercise(true); setError('');
          }}>Change exercise</Button>
          <Button icon={Trash2} compact disabled={busy || starting || cancelling}
            onPress={() => setConfirm(true)}>Delete video</Button>
        </View>
      </View>
      <View style={[styles.reviewColumn, split && { flex: 1 }]}>
        {clip.review && <>
          {pastSections.length > 0 && <SelectField label="Saved review section"
            value={viewedReview === clip.review ? '' : String(viewedReview?.startSeconds ?? 0)}
            options={[{ value: '', label: `Latest · ${formatTimestamp(latestStart)}` }, ...pastSections.map((review) => ({
              value: String(review.startSeconds ?? 0), label: formatTimestamp(review.startSeconds ?? 0),
            }))]}
            onChange={(value) => {
              const start = value === '' ? latestStart : Number(value);
              setSelectedReviewStart(value === '' ? null : start);
              selectStart(start);
            }} />}
          {pastReviewError && <Notice error action={<Button compact onPress={() => setHistoryAttempt((value) => value + 1)}>Retry loading sections</Button>}>
            Saved review sections could not be loaded.
          </Notice>}
          {viewedReview && <Feedback review={viewedReview}
            detectedExercise={exerciseRecords.get(viewedReview.detectedExerciseId ?? '')?.name}
            stillUrl={viewedReview.observationFrame && viewedReview.sequence ? api.reviewStillUrl(clip.id, viewedReview.sequence) : undefined}
            onSeek={(seconds) => player.current?.seek(seconds)} />}
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
              ? <Button compact kind="quiet" onPress={() => selectStart(failure.startSeconds)}>Open failed section</Button>
              : undefined}>{failure.error}</Notice>}
            {!clip.exerciseId && (failure || viewedReview?.verdict === 'different_exercise') &&
              <Button icon={Pencil} compact onPress={() => { setExercise(''); setEditExercise(true); setError(''); }}>Choose exercise</Button>}
            {cancellation && <Notice action={!cancelledHere
              ? <Button compact kind="quiet" onPress={() => selectStart(cancellation.startSeconds)}>Open cancelled section</Button>
              : undefined}>Analysis cancelled. Your video is still saved.</Notice>}
            <View style={[styles.window, clip.review && styles.windowAfterReview]}>
              <View style={styles.observationHeading}>
                <Copy size={13} weight="semibold">{validStart ? `Review starts at ${formatTimestamp(startSeconds)}` : 'Choose a valid start time'}</Copy>
                <Button kind="quiet" compact end={showStart ? ChevronUp : ChevronDown} aria-expanded={showStart}
                  onPress={toggleStartOptions}>{showStart ? 'Hide start options' : 'Choose start time'}</Button>
              </View>
              {showStart && <View style={styles.startOptions}>
                <View style={styles.startField}>
                  <Input label="Review start in seconds" value={startText} onChangeText={changeStart}
                    inputMode="numeric" autoComplete="off" autoCorrect={false} spellCheck={false} maxLength={12}
                    aria-invalid={!validStart || tooLate}
                    aria-describedby={!validStart || tooLate ? 'review-start-error' : undefined} />
                </View>
                <View style={styles.uploadActions}>
                  <Button compact disabled={!ready} onPress={() => {
                    selectStart(Math.min(maxReviewStartSeconds, Math.max(0, Math.floor(player.current?.position() ?? 0))));
                  }}>Use current video time</Button>
                  {startText !== '0' && <Button compact kind="quiet" onPress={() => selectStart(0)}>Start at 0:00</Button>}
                </View>
              </View>}
              {canAnalyzeSection ? <>
                {!validStart && <Copy nativeID="review-start-error" size={12} tone={color.danger}>{`Enter a whole number of seconds from 0 to ${maxReviewStartSeconds}.`}</Copy>}
                {tooLate && <View nativeID="review-start-error">
                  <Notice error>Choose a starting point with at least one second of exercise footage remaining.</Notice>
                </View>}
                <Copy size={12} tone={color.muted}>{clip.exerciseId
                  ? 'Liftmorrow sends up to eight still frames from the next 20 seconds to OpenAI. It may reuse the adjustment frame to match a reference image. Audio stays with the saved video.'
                  : 'Liftmorrow sends up to eight still frames per step from the next 20 seconds to OpenAI. It may reuse the adjustment frame to match a reference image. Audio stays with the saved video.'}</Copy>
                <Button kind="primary" icon={Sparkles} disabled={!validStart || tooLate || retryAt !== null} onPress={() => analyze(reviewedHere)}>
                  {retryAt !== null ? 'Retry shortly' : error || failedHere || cancelledHere
                    ? 'Retry analysis' : reviewedHere ? 'Review this section again' : clip.review ? 'Analyze this section' : 'Analyze form'}
                </Button>
              </> : <Copy size={12} tone={color.muted}>This section already has saved feedback.</Copy>}
            </View>
          </>}
        </>}
        {!canReview && !clip.review && <Copy size={13} tone={color.muted}>AI analysis is unavailable on this server.</Copy>}
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

const styles = StyleSheet.create({
  page: { gap: 16 },
  uploadLayout: { gap: 18 },
  search: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, width: 320, maxWidth: '100%' },
  uploadTrack: { backgroundColor: color.soft, borderRadius: 6, height: 7, overflow: 'hidden' },
  uploadFill: { backgroundColor: color.plum, height: '100%' },
  uploadActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  panel: { padding: 19, gap: 13, minWidth: 0 },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  reviewColumns: { flexDirection: 'row', gap: 20, alignItems: 'flex-start' },
  reviewColumn: { gap: 12, minWidth: 0 },
  filming: { gap: 8, padding: 18, backgroundColor: color.tint, borderRadius: 10 },
  filmingTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  videoHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  emptyVideos: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, borderTopWidth: 1, borderColor: color.line },
  videoList: { overflow: 'hidden' },
  videoRow: { paddingHorizontal: 14, paddingVertical: 12, minHeight: 69, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  videoRowBorder: { borderTopWidth: 1, borderColor: color.line },
  videoIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  feedbackContent: { gap: 10 },
  reviewContext: { gap: 4, marginTop: 2, paddingTop: 8, borderTopWidth: 1, borderColor: color.line },
  observation: { gap: 5, backgroundColor: color.tint, borderRadius: 8, padding: 11 },
  timestamps: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  observationHeading: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  frameComparison: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 5 },
  frameColumn: { flex: 1, minWidth: 0, gap: 4 },
  still: { width: '100%', aspectRatio: 4 / 3, maxHeight: 250, borderRadius: 7, backgroundColor: color.ink },
  window: { gap: 9, padding: 13, borderColor: color.line, borderWidth: 1, borderRadius: 9 },
  windowAfterReview: { backgroundColor: color.canvas, borderColor: 'transparent' },
  startOptions: { gap: 7, paddingBottom: 5 },
  startField: { width: '100%', maxWidth: 220, gap: 5 },
});
