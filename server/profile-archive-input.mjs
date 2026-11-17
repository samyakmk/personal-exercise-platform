import { createHash } from 'node:crypto';
import { normalizeClipTrainingContext } from './clip-training-context.mjs';
import { exercisesById } from './catalog.mjs';
import { profileArchiveFormat } from './profile-archive.mjs';
import { hasVideoTrack } from './video-container.mjs';

const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value, max) => typeof value === 'string' && value.length <= max;
const nullableText = (value, max) => value === null || text(value, max);
const dateTime = (value) => text(value, 40) && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const number = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high) => Number.isInteger(value) && number(value, low, high);
const optional = (value, verify) => value === undefined || verify(value);
const exerciseId = (value) => exercisesById.has(value);
const videoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const verdicts = new Set(['observations', 'no_clear_issue', 'insufficient_visibility', 'different_exercise']);
const smallList = (value) => Array.isArray(value) && value.length <= 16 && value.every((item) => text(item, 1000));
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function validReference(reference) {
  return isObject(reference) && typeof reference.path === 'string' && /^\/form-reference\/[\w.-]+\.(?:jpeg|jpg|png)$/i.test(reference.path)
    && text(reference.phase, 250) && text(reference.source, 1500) && /^https?:\/\//i.test(reference.source)
    && text(reference.credit, 1000) && optional(reference.time, (value) => number(value, 0, 86_420));
}

function validateReview(value, require) {
  if (value === null) return null;
  require(isObject(value) && verdicts.has(value.verdict) && text(value.summary, 4000) && text(value.limitations, 4000)
    && dateTime(value.reviewedAt) && integer(value.framesReviewed, 0, 120), 'A saved form review has invalid details.');
  const { verdict, summary, limitations, reviewedAt, framesReviewed, windowSeconds, observations,
    startSeconds, endSeconds, sequence, version, detectedExerciseId, observationFrame, reviewStill, coverage, modelConfiguration } = value;
  require(Array.isArray(observations) && observations.length <= 20 && observations.every((item) => isObject(item)
    && ['strength', 'adjustment'].includes(item.kind) && number(item.timestamp, 0, 86_520)
    && optional(item.comparisonTimestamp, (time) => number(time, 0, 86_520)) && text(item.observation, 4000) && text(item.cue, 4000)),
  'A saved form review has invalid cue timestamps or text.');
  require(optional(startSeconds, (start) => integer(start, 0, 86_400)) && optional(sequence, (seq) => integer(seq, 0, 1_000_000_000))
    && optional(version, (ver) => integer(ver, 0, 1_000_000_000)) && optional(detectedExerciseId, exerciseId)
    && (endSeconds === undefined ? number(windowSeconds, 0, 120)
      : integer(endSeconds, (startSeconds ?? 0) + 1, 86_400) && windowSeconds === endSeconds - (startSeconds ?? 0)),
  'A saved review has an invalid section.');
  require(optional(observationFrame, (frame) => isObject(frame) && optional(frame.reference, validReference)), 'A review reference is invalid.');
  if (reviewStill !== undefined) {
    require(text(reviewStill, 3 * 1024 * 1024), 'A saved review image is too large.');
    const still = Buffer.from(reviewStill, 'base64');
    require(still[0] === 0xff && still[1] === 0xd8 && still.at(-2) === 0xff && still.at(-1) === 0xd9, 'A saved review image is invalid.');
  }
  require(optional(coverage, (scope) => isObject(scope) && ['measured', 'visual', 'combined'].includes(scope.source)
    && smallList(scope.assessed) && smallList(scope.limits) && optional(scope.next, (next) => text(next, 4000))), 'A saved review has invalid coverage.');
  require(optional(modelConfiguration, (models) => isObject(models) && ['critique', 'detection', 'reference'].every((key) => text(models[key], 180))),
    'A saved review has an invalid model configuration.');
  const points = observations.map(({ timestamp, comparisonTimestamp, kind, observation, cue }) => ({
    timestamp, kind, observation, cue, ...(comparisonTimestamp !== undefined && { comparisonTimestamp }),
  }));
  const reference = observationFrame?.reference;
  const cleanFrame = observationFrame && (reference ? { reference: { path: reference.path, source: reference.source,
    phase: reference.phase, credit: reference.credit, ...(reference.time !== undefined && { time: reference.time }) } } : {});
  const cleanCoverage = coverage && { source: coverage.source, assessed: coverage.assessed, limits: coverage.limits,
    ...(coverage.next !== undefined && { next: coverage.next }) };
  const cleanConfiguration = modelConfiguration && { critique: modelConfiguration.critique,
    detection: modelConfiguration.detection, reference: modelConfiguration.reference };
  return Object.fromEntries(Object.entries({ verdict, summary, limitations, reviewedAt, framesReviewed, windowSeconds, observations: points,
    startSeconds, endSeconds, sequence, version, detectedExerciseId, observationFrame: cleanFrame, reviewStill,
    coverage: cleanCoverage, modelConfiguration: cleanConfiguration }).filter(([, field]) => field !== undefined));
}

export function profileArchiveInput(body, {
  require, validDate, validId, validEquipment, normalizeProfile, normalizeWorkout, normalizeNote, maxVideoBytes, maxBackupWorkouts,
}) {
  require(body.format === profileArchiveFormat && body.version === 1, 'Choose a Trainer Plus profile archive.');
  const rows = (items, limit, message) => {
    require(Array.isArray(items) && items.length <= limit && items.every(isObject), message);
    return items;
  };
  const ids = (items, limit, message) => {
    const list = rows(items, limit, message);
    require(new Set(list.map(({ id }) => id)).size === list.length && list.every(({ id }) => validId(id)), message);
    return list;
  };
  const profile = (details) => {
    require(isObject(details), 'The archive contains invalid profile details.');
    return normalizeProfile(details);
  };
  require(body.equipment === null || validEquipment(body.equipment), 'The archive contains invalid equipment settings.');
  require(Array.isArray(body.bookmarks) && new Set(body.bookmarks).size === body.bookmarks.length && body.bookmarks.every(exerciseId),
    'The archive contains invalid saved exercises.');
  const workouts = ids(body.workouts, maxBackupWorkouts, 'The archive contains invalid or duplicate workouts.').map(normalizeWorkout);
  const uniqueOccurrences = new Set(workouts.filter(({ seriesId }) => seriesId).map(({ seriesId, seriesIndex }) => `${seriesId}/${seriesIndex}`));
  require(uniqueOccurrences.size === workouts.filter(({ seriesId }) => seriesId).length, 'The archive contains duplicate workout occurrences.');
  const revisions = rows(body.revisions, 30_000, 'The archive contains invalid profile history.').map(({ savedAt, details }) => {
    require(dateTime(savedAt), 'A saved profile update has an invalid date.');
    return { savedAt, details: profile(details) };
  });
  const trainingNotes = ids(body.trainingNotes, 10_000, 'The archive contains invalid training notes.').map(({ id, savedAt, ...entry }) => {
    const note = normalizeNote(entry);
    require(note && dateTime(savedAt), 'The archive contains an invalid training note.');
    return { id, ...note, savedAt };
  });
  const checkIns = ids(body.checkIns, 30_000, 'The archive contains invalid check-ins.').map(({ id, day, text: entry, adjustment, wantsReply, reply, savedAt }) => {
    require(validDate(day) && text(entry, 1200) && [null, 'easier', 'usual', 'rest'].includes(adjustment) && [0, 1].includes(wantsReply)
      && nullableText(reply, 8000) && dateTime(savedAt), 'The archive contains an invalid check-in.');
    return { id, day, text: entry, adjustment, wantsReply, reply, savedAt };
  });
  const clips = ids(body.clips, 10_000, 'The archive contains invalid video records.').map(({ id, exerciseId: exercise, filename, mime, size,
    uploadedAt, data, digest, trainingContext: context, review: critique, history }) => {
    require((exercise === '' || exerciseId(exercise)) && text(filename, 120) && filename.trim() && !/[\u0000-\u001f\u007f/\\]/.test(filename)
      && videoTypes.has(mime) && integer(size, 0, maxVideoBytes) && dateTime(uploadedAt) && (digest === null || sha(digest)),
    'The archive contains invalid video metadata.');
    const trainingContext = context === null ? null : normalizeClipTrainingContext(context);
    require(context === null || trainingContext, 'The archive contains invalid workout video links.');
    const review = validateReview(critique, require);
    const sections = rows(history, 9, 'The archive contains too many saved review sections.').map((section) => {
      require(integer(section.startSeconds, 0, 86_400) && integer(section.sequence, 0, 1_000_000_000) && section.review,
        'The archive contains an invalid saved review section.');
      const reviewed = validateReview(section.review, require);
      require((reviewed.startSeconds ?? 0) === section.startSeconds && (reviewed.sequence ?? 0) === section.sequence,
        'A saved review section does not match its timestamps.');
      return { startSeconds: section.startSeconds, sequence: section.sequence, review: reviewed };
    });
    const allReviews = [...sections.map((section) => section.review), ...(review ? [review] : [])];
    const ranges = new Set(allReviews.map(({ startSeconds, endSeconds }) => (startSeconds ?? 0) + ':' + (endSeconds ?? '')));
    require(ranges.size === allReviews.length, 'The archive has duplicate review sections.');
    let bytes;
    if (data !== undefined) {
      require(size > 0 && typeof data === 'string' && data.length === 4 * Math.ceil(size / 3) && sha(digest), 'The archive contains invalid video data.');
      bytes = Buffer.from(data, 'base64');
      require(bytes.length === size && createHash('sha256').update(bytes).digest('hex') === digest && hasVideoTrack(mime, bytes),
        'The archived video is damaged or has an unsupported video track.');
    }
    return { id, exerciseId: exercise, filename, mime, size, uploadedAt, digest, trainingContext, review, history: sections, bytes };
  });
  return { profile: profile(body.profile), equipment: body.equipment, bookmarks: body.bookmarks, workouts, revisions, trainingNotes, checkIns, clips };
}
