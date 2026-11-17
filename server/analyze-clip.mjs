import { detectExercise, reviewExercise } from './ai.mjs';
import { extractFrames, movementPhaseTimes, reviewWindowSeconds, selectReviewFrames } from './frames.mjs';
import { matchReferenceStill } from './reference-stills.mjs';
import { estimatePoses } from './pose.mjs';
import { assessBirdTurn, assessCoreMotion } from './core-motion.mjs';
import { assessBridge } from './bridge.mjs';
import { assessCurl } from './curl.mjs';
import { assessLunge } from './lunge.mjs';
import { assessPlank } from './plank.mjs';
import { assessPullUp } from './pull-up.mjs';
import { assessPushUp } from './push-up.mjs';
import { assessRow } from './row.mjs';
import { assessShoulderPress } from './shoulder-press.mjs';
import { assessSquat } from './squat.mjs';

const assessments = {
  'push-up': assessPushUp,
  'bodyweight-squat': assessSquat,
  'goblet-squat': assessSquat,
  'dumbbell-shoulder-press': assessShoulderPress,
  'forearm-plank': assessPlank,
  'dumbbell-curl': assessCurl,
  'pull-up': assessPullUp,
  'glute-bridge': assessBridge,
  'bird-dog': assessBird,
  'dumbbell-row': assessRow,
};

const phaseJoints = {
  'bodyweight-squat': [11, 13, 15],
  'goblet-squat': [11, 13, 15],
  'dumbbell-bench-press': [5, 7, 9],
  'dumbbell-shoulder-press': [5, 7, 9],
  'dumbbell-curl': [5, 7, 9],
};

function assessBird(poses) {
  const evidence = assessBirdTurn(poses);
  const visibleMotion = assessCoreMotion('bird-dog', poses);
  const validPoses = poses.filter(({ points }) => [5, 6, 11, 12].every((id) => points[id].confidence >= 0.35));
  return { coverage: validPoses.length >= 8 ? 'measured' : 'limited',
    evidence: evidence ? [evidence] : [], coreMotion: visibleMotion };
}

export function hasLocalAssessment(exerciseId) {
  return Object.hasOwn(assessments, exerciseId);
}

function reviewSampleRate(exerciseId) {
  return hasLocalAssessment(exerciseId) || Object.hasOwn(phaseJoints, exerciseId)
    || exerciseId === 'reverse-lunge' || exerciseId === 'dead-bug' ? 4 : 2;
}

function canTrackRange(startSeconds, endSeconds) {
  // Local movement checks are calibrated for the regular sampling cadence.
  return endSeconds === undefined || endSeconds - startSeconds <= reviewWindowSeconds;
}

async function trackSamples(samples, estimate = estimatePoses, signal) {
  try {
    return (await estimate(samples, signal)) ?? null;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('Trainer Plus pose estimates unavailable for this clip.');
    return null;
  }
}

export async function prepareClipReview(source, {
  exercise, mime, signal, sampleFrames = extractFrames, estimate, startSeconds = 0, endSeconds,
}) {
  const samples = await sampleFrames(source, { mime, signal, startSeconds, endSeconds, sampleRate: reviewSampleRate(exercise.id) });
  return prepareSampledReview(samples, { exercise, signal, estimate, startSeconds, endSeconds });
}

async function prepareSampledReview(samples, { exercise, signal, estimate, startSeconds = 0, endSeconds, trackedPoses }) {
  const assess = assessments[exercise.id];
  const lunge = exercise.id === 'reverse-lunge';
  const core = exercise.id === 'dead-bug';
  const trackPose = reviewSampleRate(exercise.id) === 4 && canTrackRange(startSeconds, endSeconds);
  let poses = null;
  if (trackPose && samples.length >= (exercise.id === 'pull-up' ? 5 : 8)) {
    const tracked = trackedPoses === undefined ? await trackSamples(samples, estimate, signal) : trackedPoses;
    poses = tracked?.map((pose) => ({ ...pose, timestamp: pose.timestamp - startSeconds }));
  }
  signal?.throwIfAborted();
  const result = poses && assess ? assess(poses) : { coverage: 'unavailable', evidence: [] };
  const lungeMotion = poses && lunge ? assessLunge(poses) : null;
  const coreMotion = result.coreMotion ?? (poses && core ? assessCoreMotion(exercise.id, poses) : null);
  const localCoverage = assess && exercise.id !== 'pull-up' && samples.length < 12 && result.coverage !== 'measured'
    ? 'short_window' : result.coverage;
  const absoluteTime = (time) => Math.round((time + startSeconds) * 1000) / 1000;
  const evidence = result.evidence.map((item) => ({
    ...item, timestamp: absoluteTime(item.timestamp),
    ...(item.comparisonTimestamp !== undefined && { comparisonTimestamp: absoluteTime(item.comparisonTimestamp) }),
  }));
  const verificationTimes = result.verificationTimes ?? lungeMotion?.verificationTimes ?? coreMotion?.verificationTimes ?? [];
  const joints = phaseJoints[exercise.id];
  const phaseTimes = poses && joints ? movementPhaseTimes(poses, joints) : [];
  const verificationFrames = [...verificationTimes, ...phaseTimes].map((time) => ({ timestamp: absoluteTime(time) }));
  return { exercise, frames: selectReviewFrames(samples, [...evidence, ...verificationFrames]), signal,
    evidence, coverage: localCoverage, assessed: result.assessed, lungeMotion: lungeMotion?.variant, coreMotion: coreMotion?.variant };
}

async function prepareDetectedReview(respond, source, options) {
  const { mime, signal, sampleFrames = extractFrames, estimate, startSeconds = 0, endSeconds } = options;
  const samples = await sampleFrames(source, { mime, signal, startSeconds, endSeconds, sampleRate: 4 });
  const trackedPoses = samples.length >= 5 && canTrackRange(startSeconds, endSeconds) ? await trackSamples(samples, estimate, signal) : null;
  const phasePairs = trackedPoses ? [phaseJoints['bodyweight-squat'], phaseJoints['dumbbell-bench-press']]
    .map((joints) => movementPhaseTimes(trackedPoses, joints)).filter(({ length }) => length) : [];
  // Leave half the image budget available for the rest of the window, including static holds.
  const phaseFrames = phasePairs.flatMap((times) => times.slice(0, phasePairs.length === 2 ? 2 : 4))
    .map((timestamp) => ({ timestamp }));
  const exercise = await detectExercise(respond, { frames: selectReviewFrames(samples, phaseFrames), signal });
  const reviewSamples = reviewSampleRate(exercise.id) === 4 ? samples : samples.filter((_, index) => index % 2 === 0);
  return prepareSampledReview(reviewSamples, { ...options, exercise, trackedPoses });
}

export async function analyzeClip(respond, source, options) {
  const prepared = options.exercise ? await prepareClipReview(source, options) : await prepareDetectedReview(respond, source, options);
  let visuallyReviewed = false;
  const result = await reviewExercise((input) => {
    visuallyReviewed = true;
    return respond(input);
  }, prepared);
  const adjustment = result.observations.find(({ kind }) => kind === 'adjustment');
  const image = adjustment && prepared.frames.find(({ timestamp }) => timestamp === adjustment.timestamp)?.image;
  const hasStill = Buffer.isBuffer(image) && image.length <= 192 * 1024 && image[0] === 0xff && image[1] === 0xd8;
  const reference = hasStill ? await matchReferenceStill(respond, { ...prepared, adjustment, image }) : null;
  return {
    ...result,
    coverage: describeReviewCoverage(prepared, result, visuallyReviewed),
    ...(respond.formConfiguration && { modelConfiguration: respond.formConfiguration }),
    ...(!options.exercise && { detectedExerciseId: prepared.exercise.id }),
    ...(hasStill && { observationFrame: reference ? { reference } : {}, reviewStill: image.toString('base64') }),
  };
}

const trackingScope = {
  'push-up': 'Hip alignment and descent in visible repetitions',
  'bodyweight-squat': 'Depth in visible repetitions',
  'goblet-squat': 'Depth in visible repetitions',
  'dumbbell-shoulder-press': 'Descent of the visible working arm',
  'forearm-plank': 'Hip position during the sampled hold',
  'dumbbell-curl': 'Repeated torso rocking',
  'pull-up': 'Bottom reversal and repeated leg swing in visible positions',
  'glute-bridge': 'Repeated high hip position',
  'bird-dog': 'Trunk rotation between visible reaches',
  'dumbbell-row': 'Torso rotation during visible pulls',
};

function describeReviewCoverage(prepared, result, visuallyReviewed) {
  const { exercise, coverage, lungeMotion, coreMotion } = prepared;
  const tracked = coverage === 'measured' && trackingScope[exercise.id];
  const assessments = [];
  if (result.verdict === 'different_exercise') assessments.push('Visible movement and exercise identity');
  else if (result.verdict !== 'insufficient_visibility') {
    if (tracked) assessments.push(...(prepared.assessed ?? [tracked]));
    if (lungeMotion === 'reverse_lunge') assessments.push('Step direction through the visible lunge');
    if (visuallyReviewed && result.observations.length && !assessments.length) assessments.push('The visible positions cited with the cue');
  }
  return {
    source: !visuallyReviewed ? 'measured' : tracked || lungeMotion || coreMotion ? 'combined' : 'visual',
    assessed: assessments,
    limits: ['This review covers the visible positions in one sampled section.'],
    ...(result.verdict === 'insufficient_visibility' && { next: result.summary }),
  };
}
