import { detectExercise, reviewExercise } from './ai.mjs';
import { extractFrames, movementPhaseTimes, selectReviewFrames } from './frames.mjs';
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

export async function prepareClipReview(source, {
  exercise, mime, signal, sampleFrames = extractFrames, estimate, startSeconds = 0,
}) {
  const samples = await sampleFrames(source, { mime, signal, startSeconds, sampleRate: reviewSampleRate(exercise.id) });
  return prepareSampledReview(samples, { exercise, signal, estimate, startSeconds });
}

async function prepareSampledReview(samples, { exercise, signal, estimate = estimatePoses, startSeconds = 0 }) {
  const assess = assessments[exercise.id];
  const lunge = exercise.id === 'reverse-lunge';
  const core = exercise.id === 'dead-bug';
  const trackPose = reviewSampleRate(exercise.id) === 4;
  let poses = null;
  if (trackPose && samples.length >= (exercise.id === 'pull-up' ? 5 : 8)) {
    try {
      poses = (await estimate(samples, signal))?.map((pose) => ({
        ...pose, timestamp: pose.timestamp - startSeconds,
      }));
    }
    catch (error) {
      if (signal?.aborted) throw error;
      console.warn('Liftmorrow pose estimates unavailable for this clip.');
    }
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
    evidence, coverage: localCoverage, lungeMotion: lungeMotion?.variant, coreMotion: coreMotion?.variant };
}

async function prepareDetectedReview(respond, source, options) {
  const { mime, signal, sampleFrames = extractFrames, startSeconds = 0 } = options;
  const samples = await sampleFrames(source, { mime, signal, startSeconds, sampleRate: 4 });
  const exercise = await detectExercise(respond, { frames: selectReviewFrames(samples), signal });
  const reviewSamples = reviewSampleRate(exercise.id) === 4 ? samples : samples.filter((_, index) => index % 2 === 0);
  return prepareSampledReview(reviewSamples, { ...options, exercise });
}

export async function analyzeClip(respond, source, options) {
  const prepared = options.exercise ? await prepareClipReview(source, options) : await prepareDetectedReview(respond, source, options);
  const result = await reviewExercise(respond, prepared);
  const adjustment = result.observations.find(({ kind }) => kind === 'adjustment');
  const image = adjustment && prepared.frames.find(({ timestamp }) => timestamp === adjustment.timestamp)?.image;
  const hasStill = Buffer.isBuffer(image) && image.length <= 192 * 1024 && image[0] === 0xff && image[1] === 0xd8;
  const reference = hasStill ? await matchReferenceStill(respond, { ...prepared, adjustment, image }) : null;
  return {
    ...result,
    ...(!options.exercise && { detectedExerciseId: prepared.exercise.id }),
    ...(hasStill && { observationFrame: reference ? { reference } : {}, reviewStill: image.toString('base64') }),
  };
}
