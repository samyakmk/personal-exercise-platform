import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { AiError } from './ai.mjs';
import { reviewVersion } from './coaching.mjs';
import { catalog, equipment, exercisesById, muscles, recommend } from './catalog.mjs';
import { convertQuickTime } from './quicktime.mjs';
import { hasVideoTrack } from './video-container.mjs';
import { workoutCalendar, workoutHistoryCsv } from './workout-exports.mjs';
import { closeAfterResponse, expectRequestBody, preferredEncoding } from './http.mjs';

const maxVideoBytes = 50 * 1024 * 1024;
const maxBackupBytes = 8 * 1024 * 1024;
const maxBackupWorkouts = 10_000;
const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const cookieName = 'repform_workspace';
const videoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const workspaceResponseVersion = 1;
const compress = promisify(gzip);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireValue(condition, message, status = 400) {
  if (!condition) throw new ApiError(status, message);
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function matchesWorkspaceTag(header, tag) {
  if (!header) return false;
  return header.trim() === '*' || Array.from(header.matchAll(/(?:^|,)\s*(?:W\/)?("[\x21\x23-\x7e\x80-\xff]*")\s*(?=,|$)/g))
    .some(([, candidate]) => candidate === tag);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2199-12-31') return false;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function optionList(value, options) {
  return Array.isArray(value) && value.length <= options.length
    && new Set(value).size === value.length && value.every((item) => options.includes(item));
}

async function readBytes(req, res, limit, onChunk) {
  const declared = Number(req.headers['content-length']);
  requireValue(!(declared > limit), 'This file is too large.', 413);
  expectRequestBody(req, res);
  const buffer = Number.isSafeInteger(declared) && declared >= 0 ? Buffer.allocUnsafe(declared) : null;
  const parts = [];
  let size = 0;
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    const next = size + part.length;
    if (next > limit || (buffer && next > buffer.length)) {
      throw new ApiError(413, 'This file is too large.');
    }
    if (buffer) part.copy(buffer, size);
    else parts.push(part);
    size = next;
    onChunk?.();
  }
  return buffer ? buffer.subarray(0, size) : Buffer.concat(parts, size);
}

async function readJson(req, res, limit = 48 * 1024) {
  requireValue(req.headers['content-type']?.split(';')[0] === 'application/json', 'Use a JSON request.', 415);
  const bytes = await readBytes(req, res, limit);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Invalid request.');
    return value;
  } catch {
    throw new ApiError(400, 'Invalid request.');
  }
}

function workoutFields(body) {
  const { name, date, time, status, exercises, notes } = body;
  requireValue(typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 70, 'Enter a workout name of 1–70 characters.');
  requireValue(validDate(date), 'Choose a valid workout date.');
  requireValue(typeof time === 'string' && timePattern.test(time), 'Choose a valid workout time.');
  requireValue(['planned', 'completed'].includes(status), 'Choose a workout status.');
  requireValue(notes === undefined || typeof notes === 'string' && notes.length <= 1200, 'Keep workout notes to 1200 characters.');
  requireValue(Array.isArray(exercises) && exercises.length > 0 && exercises.length <= catalog.length, 'Add at least one exercise.');
  requireValue(exercises.every((entry) => entry && exercisesById.has(entry.exerciseId)), 'Choose an exercise from the library.');
  requireValue(new Set(exercises.map((entry) => entry.exerciseId)).size === exercises.length, 'Use each exercise once per workout.');
  return {
    name: name.trim().toWellFormed(), date, time, status,
    ...(notes !== undefined && { notes: notes.trim().toWellFormed() }),
    exercises: exercises.map(movementFields),
  };
}

function movementFields({ exerciseId, sets, reps, load, setDetails }) {
  const weighted = exercisesById.get(exerciseId).equipment.includes('Dumbbells');
  function setFields(item) {
    requireValue(item && Number.isInteger(item.reps) && item.reps >= 1 && item.reps <= 600,
      'Enter valid reps or hold times from 1 to 600.');
    const weight = item.load;
    if (weight === undefined) return { reps: item.reps };
    requireValue(weighted && weight && ['kg', 'lb'].includes(weight.unit) && typeof weight.value === 'number'
      && weight.value > 0 && weight.value <= 1000 && /^\d+(?:\.\d{1,2})?$/.test(String(weight.value)),
    'Use a dumbbell weight from 0.01 to 1000 kg or lb.');
    return { reps: item.reps, load: { value: weight.value, unit: weight.unit } };
  }
  if (setDetails !== undefined) {
    requireValue(Array.isArray(setDetails) && setDetails.length >= 1 && setDetails.length <= 30,
      'Enter between 1 and 30 sets for each exercise.');
    const details = setDetails.map(setFields);
    return { exerciseId, sets: details.length, ...details[0], setDetails: details };
  }
  requireValue(Number.isInteger(sets) && sets >= 1 && sets <= 30, 'Enter between 1 and 30 sets for each exercise.');
  return { exerciseId, sets, ...setFields({ reps, load }) };
}

function workoutRevision(value) {
  requireValue(value == null || Number.isSafeInteger(value) && value > 0, 'Invalid workout revision.');
  return value ?? null;
}

function weeklyWorkouts(workout, weeks) {
  const first = new Date(workout.date + 'T12:00:00Z');
  return Array.from({ length: weeks }, (_, index) => {
    if (index === 0) return workout;
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + index * 7);
    const day = date.toISOString().slice(0, 10);
    requireValue(validDate(day), 'Choose a date range that ends by December 2199.');
    const hash = createHash('sha256').update(`repform-weekly:${workout.id}:${index}`).digest('hex');
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    return { ...workout, id, date: day };
  });
}

function videoRange(header, size) {
  if (!header) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const suffix = !match[1];
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = !suffix && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < size ? { start, end } : null;
}

async function sendVideo(req, res, store, workspace, id, download, legacyReads) {
  const clip = store.clip(workspace, id);
  requireValue(clip, 'Video not found.', 404);
  const tag = clip.representation && '"' + clip.representation + '"';
  if (tag) res.setHeader('ETag', tag);
  const ifRange = req.headers['if-range'];
  // Only GET supports Range. A strong ETag is the sole validator issued for video bytes.
  const requestedRange = req.headers.range;
  const rangeHeader = req.method === 'GET' && requestedRange && /^bytes=/i.test(requestedRange)
    && (ifRange === undefined || ifRange === tag) ? requestedRange : undefined;
  const range = videoRange(rangeHeader, clip.size);
  if (!range) {
    res.writeHead(416, { 'Content-Range': `bytes */${clip.size}` });
    res.end();
    return;
  }
  const { start, end } = range;
  const length = end - start + 1;
  const reservation = req.method === 'GET' && !clip.chunked ? length : 0;
  if (reservation && legacyReads.used + reservation > legacyReads.limit) {
    res.setHeader('Retry-After', '2');
    throw new ApiError(429, 'Another video is downloading. Try again in a few seconds.');
  }
  const headers = { 'Content-Type': clip.mime, 'Content-Length': length, 'Accept-Ranges': 'bytes' };
  if (download) {
    const filename = clip.filename ?? 'exercise-video';
    const ascii = filename.replace(/[^\x20-\x7e]|["\\/]/g, '_');
    const encoded = encodeURIComponent(filename.toWellFormed())
      .replace(/['()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase());
    headers['Content-Disposition'] = `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
  }
  if (rangeHeader) headers['Content-Range'] = `bytes ${start}-${end}/${clip.size}`;
  res.writeHead(rangeHeader ? 206 : 200, headers);
  if (req.method === 'HEAD') return res.end();
  legacyReads.used += reservation;
  async function* chunks() {
    let sent = 0;
    const source = store.clipChunks(workspace, id, clip, start, length);
    try {
      while (!res.destroyed) {
        const { value, done } = source.next();
        if (done) break;
        sent += value.length;
        yield value;
      }
      if (!res.destroyed && sent !== length) throw new ApiError(404, 'Video not found.');
    } finally {
      source.return();
    }
  }
  try {
    await pipeline(Readable.from(chunks(), { objectMode: false }), res);
  } finally {
    legacyReads.used -= reservation;
  }
}

function exerciseSelection(store, workspace, url) {
  const targets = url.searchParams.getAll('muscle');
  const mode = url.searchParams.get('equipment');
  requireValue(optionList(targets, muscles), 'Invalid muscle groups.');
  requireValue(mode === 'all' || mode === 'saved' || mode === 'bodyweight', 'Invalid equipment filter.');
  const query = url.searchParams.get('q') ?? '';
  requireValue(query.length <= 100, 'Keep the search to 100 characters.');
  const level = url.searchParams.get('level');
  requireValue(level === null || ['Beginner', 'Intermediate'].includes(level), 'Invalid exercise level.');
  const available = mode === 'bodyweight' ? [] : mode === 'saved' ? store.equipment(workspace) : null;
  const utc = new Date().toISOString();
  const day = url.searchParams.get('today') ?? utc.slice(0, 10);
  const time = url.searchParams.get('now') ?? utc.slice(11, 16);
  requireValue(validDate(day) && timePattern.test(time), 'Choose a valid local date and time.');
  const history = new Map();
  for (const exercises of store.recentWorkouts(workspace, day, time)) {
    for (const { exerciseId } of exercises) history.set(exerciseId, (history.get(exerciseId) ?? 0) + 1);
  }
  return { targets, available, history, candidates: recommend({ targets, available, recent: history, query, level }) };
}

export function createApi(store, {
  webOrigin, secureCookies = false, coaching, convertVideo = convertQuickTime, uploadIdleTimeoutMs = 15_000,
  legacyReadBudgetBytes = 64 * 1024 * 1024,
} = {}) {
  const uploading = new Set();
  const legacyReads = { used: 0, limit: legacyReadBudgetBytes };
  const workspaceConfig = { catalog, muscles, equipmentOptions: equipment, aiAvailable: coaching.available, reviewVersion };
  const workspaceSchema = createHash('sha256').update(JSON.stringify([workspaceResponseVersion, workspaceConfig])).digest('hex');
  return async function api(req, res, url) {
    const method = req.method;
    const origin = req.headers.origin;
    const hostMatches = origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
    const originAllowed = hostMatches || (webOrigin && origin === webOrigin);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (origin && originAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Expose-Headers', 'Retry-After, ETag');
      res.setHeader('Vary', 'Origin');
    }
    try {
      requireValue(!origin || originAllowed, 'This origin is not allowed.', 403);
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Clip-Name, If-None-Match, If-Range, Range',
        });
        res.end();
        return;
      }

      const [, , resource, id, action, extra] = url.pathname.split('/');
      requireValue(!extra, 'Endpoint not found.', 404);
      const wantsDelta = url.searchParams.get('response') === 'delta';
      const cookie = (req.headers.cookie ?? '').split(';').map((value) => value.trim())
        .find((value) => value.startsWith(cookieName + '='));
      let workspace = cookie?.slice(cookieName.length + 1);
      if (workspace && (!uuidPattern.test(workspace) || !store.workspace(workspace))) workspace = undefined;

      if (resource === 'workspace' && method === 'GET' && !id) {
        const existing = Boolean(workspace);
        if (!workspace) {
          workspace = store.createWorkspace();
          res.setHeader('Set-Cookie', `${cookieName}=${workspace}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secureCookies ? '; Secure' : ''}`);
        }
        const workspaceKey = createHash('sha256').update('repform-local-drafts:' + workspace).digest('hex').slice(0, 24);
        res.setHeader('Vary', origin && originAllowed ? 'Origin, Cookie, Accept-Encoding' : 'Cookie, Accept-Encoding');
        const { tag, data } = store.readWorkspace(workspace, (revision, liveReviews, now) => {
          const fingerprint = createHash('sha256').update(JSON.stringify([workspaceSchema, workspaceKey, revision, liveReviews])).digest('hex');
          const tag = '"' + fingerprint + '"';
          const matches = existing && revision && matchesWorkspaceTag(req.headers['if-none-match'], tag);
          return { tag, data: matches ? null : { ...coaching.snapshot(workspace, now), workspaceKey, ...workspaceConfig } };
        });
        res.setHeader('ETag', 'W/' + tag);
        closeAfterResponse(req, res);
        if (!data) return res.writeHead(304).end();
        const jsonBody = JSON.stringify(data);
        const compressible = jsonBody.length >= 16 * 1024 && preferredEncoding(req.headers['accept-encoding'], ['gzip']);
        const body = compressible ? await compress(jsonBody, { level: 3 }) : jsonBody;
        if (res.destroyed) return;
        const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) };
        if (compressible) headers['Content-Encoding'] = compressible;
        return res.writeHead(200, headers).end(body);
      }

      requireValue(workspace, 'Workspace not found. Reload the page and try again.', 404);
      if (resource === 'workspace' && id === 'training-backup' && !action) {
        if (method === 'GET') {
          const from = url.searchParams.get('from');
          const before = url.searchParams.get('before');
          requireValue((from === null || validDate(from)) && (before === null || validDate(before)) &&
            (from === null || before === null || from < before), 'Choose a valid backup date range.');
          const body = store.trainingBackup(workspace, { from: from ?? '', before: before ?? '9999',
            maxBytes: maxBackupBytes, maxWorkouts: maxBackupWorkouts });
          requireValue(body !== null, 'This workspace is too large for a single training backup. Choose a narrower date range.', 413);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': 'attachment; filename="repform-training-backup.json"', 'Content-Length': Buffer.byteLength(body) });
          return res.end(body);
        }
        if (method === 'POST') {
          const backup = await readJson(req, res, maxBackupBytes);
          requireValue(backup.format === 'repform-training' && backup.version === 1,
            'Choose a Repform training backup in the current format.');
          requireValue(backup.equipment === null || optionList(backup.equipment, equipment), 'This backup contains invalid equipment options.');
          const bookmarks = backup.bookmarks === undefined ? [] : backup.bookmarks;
          requireValue(Array.isArray(bookmarks) && bookmarks.length <= catalog.length && new Set(bookmarks).size === bookmarks.length
            && bookmarks.every((id) => exercisesById.has(id)), 'This backup contains invalid saved exercises.');
          requireValue(Array.isArray(backup.workouts) && backup.workouts.length <= maxBackupWorkouts, 'A backup can contain up to 10,000 workouts.');
          const ids = new Set();
          const workouts = backup.workouts.map((workout) => {
            requireValue(workout && typeof workout.id === 'string' && uuidPattern.test(workout.id) && !ids.has(workout.id),
              'This backup contains invalid or duplicate workout IDs.');
            ids.add(workout.id);
            return { id: workout.id, ...workoutFields(workout) };
          });
          const restored = store.importTrainingData(workspace, backup.equipment, workouts, bookmarks);
          const response = url.searchParams.get('response') === 'summary' ? { restore: restored }
            : { ...coaching.snapshot(workspace), restore: restored };
          return json(res, 200, response);
        }
      }
      if (resource === 'workspace' && id === 'example-workouts' && method === 'POST' && !action) {
        const { today } = await readJson(req, res);
        requireValue(validDate(today), 'Choose a valid date.');
        store.addExampleWorkouts(workspace, today);
        return json(res, 200, coaching.snapshot(workspace));
      }
      if (resource === 'workspace' && id === 'example-workouts' && method === 'DELETE' && !action) {
        store.removeExampleWorkouts(workspace);
        return json(res, 200, coaching.snapshot(workspace));
      }
      if (resource === 'exercises' && method === 'GET' && !id) {
        return json(res, 200, exerciseSelection(store, workspace, url).candidates);
      }
      if (resource === 'exercises' && action === 'bookmark' && ['PUT', 'DELETE'].includes(method)) {
        requireValue(exercisesById.has(id), 'Exercise not found.', 404);
        store.setBookmark(workspace, id, method === 'PUT');
        return json(res, 200, wantsDelta ? { bookmarks: store.bookmarks(workspace) } : coaching.snapshot(workspace));
      }
      if (resource === 'exercises' && id === 'recommendations' && method === 'POST' && !action) {
        const selection = exerciseSelection(store, workspace, url);
        return json(res, 200, await coaching.recommend(workspace, selection));
      }

      if (resource === 'equipment' && method === 'PUT' && !id) {
        const { selected } = await readJson(req, res);
        requireValue(selected === null || optionList(selected, equipment), 'Choose equipment from the available options.');
        store.setEquipment(workspace, selected);
        return json(res, 200, wantsDelta ? { equipment: store.equipment(workspace) } : coaching.snapshot(workspace));
      }

      if (resource === 'workouts' && !action) {
        if (method === 'GET' && id === 'history.csv') {
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="repform-history.csv"',
          });
          return await pipeline(Readable.from(workoutHistoryCsv(store.historyWorkouts(workspace)), { objectMode: false }), res);
        }
        if (method === 'GET' && id === 'calendar.ics') {
          const only = url.searchParams.get('workout');
          const workout = only && store.calendarWorkout(workspace, only);
          if (only) requireValue(workout, 'Workout not found.', 404);
          const workouts = workout ? [workout] : store.calendarWorkouts(workspace);
          res.writeHead(200, {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'attachment; filename="repform-calendar.ics"',
          });
          return await pipeline(Readable.from(workoutCalendar(workouts), { objectMode: false }), res);
        }
        if (method === 'POST' && !id) {
          const body = await readJson(req, res);
          requireValue(typeof body.id === 'string' && uuidPattern.test(body.id), 'Invalid workout ID.');
          const workout = { id: body.id, ...workoutFields(body) };
          const weeks = body.repeatWeeks === undefined ? 1 : body.repeatWeeks;
          requireValue(Number.isInteger(weeks) && weeks >= 1 && weeks <= 12 && (weeks === 1 || workout.status === 'planned'),
            'Schedule between 1 and 12 weeks for a planned workout.');
          const series = weeklyWorkouts(workout, weeks);
          const saved = weeks === 1 ? store.insertWorkout(workspace, workout) : store.insertWorkoutSeries(workspace, series);
          requireValue(saved,
            'This workout was already saved with different details. Reopen it to make changes.', 409);
          return json(res, 200, wantsDelta
            ? { workouts: store.workoutChanges(workspace, series.map(({ id }) => id)) } : coaching.snapshot(workspace));
        }
        if (id && method === 'PUT') {
          const body = await readJson(req, res);
          requireValue(body.repeatWeeks === undefined, 'Create a new plan to schedule weekly sessions.');
          const revision = workoutRevision(body.revision);
          const operation = body.operationId;
          requireValue(operation === undefined || revision !== null && typeof operation === 'string' && uuidPattern.test(operation),
            'Use a valid operation ID and workout revision.');
          const outcome = store.updateWorkout(workspace, id, workoutFields(body), revision, operation);
          requireValue(outcome !== 'missing', 'Workout not found.', 404);
          requireValue(outcome !== 'operation_conflict', 'This save was already submitted with different details. Reopen the workout.', 409);
          requireValue(outcome === 'saved', 'This workout changed in another tab. Reopen it to see the latest version.', 409);
          return json(res, 200, wantsDelta ? { workouts: store.workoutChanges(workspace, [id]) } : coaching.snapshot(workspace));
        }
        if (id && method === 'DELETE') {
          const revision = url.searchParams.get('revision');
          const removed = store.removeWorkout(workspace, id, workoutRevision(revision === null ? null : Number(revision)));
          if (!removed.changes && store.workoutRevision(workspace, id)) {
            throw new ApiError(409, 'This workout changed in another tab. Reopen it before deleting.');
          }
          return json(res, 200, wantsDelta ? { workouts: store.workoutChanges(workspace, [id]) } : coaching.snapshot(workspace));
        }
      }

      if (resource === 'clips' && id && uuidPattern.test(id)) {
        if (method === 'GET' && !action) {
          const { upsert: [clip] } = coaching.clipChanges(workspace, id);
          requireValue(clip, 'Video not found.', 404);
          return json(res, 200, clip);
        }
        if (method === 'PUT' && action === 'exercise') {
          const { exerciseId, previousExerciseId } = await readJson(req, res);
          requireValue(exercisesById.has(exerciseId), 'Choose an exercise from the library.');
          const clip = store.clip(workspace, id);
          requireValue(clip, 'Video not found.', 404);
          if (exerciseId !== clip.exerciseId) {
            requireValue(previousExerciseId === clip.exerciseId, 'The exercise selection changed in another tab. Reopen the video to see it.', 409);
            requireValue(coaching.clipReview(workspace, id).reviewStatus.state !== 'running',
              'Cancel the current analysis before changing the exercise.', 409);
            requireValue(store.relabelClip(workspace, id, exerciseId, previousExerciseId),
              'The video changed. Reopen it to see the latest version.', 409);
          }
          return json(res, 200, wantsDelta ? { clips: coaching.clipChanges(workspace, id) } : coaching.snapshot(workspace));
        }
        if (method === 'PUT' && !action) {
          const exerciseId = url.searchParams.get('exercise');
          const rejectDeleted = url.searchParams.get('protectDeleted') === '1';
          const deletedMessage = 'This video was removed in another tab. Choose a file to upload it again.';
          const sourceMime = req.headers['content-type']?.split(';')[0];
          requireValue(exercisesById.has(exerciseId), 'Choose an exercise first.');
          requireValue(videoTypes.has(sourceMime), 'Choose an MP4, WebM, or MOV video.', 415);
          const converted = sourceMime === 'video/quicktime';
          const mime = converted ? 'video/mp4' : sourceMime;
          let filename;
          try {
            filename = decodeURIComponent(req.headers['x-clip-name'] ?? '')
              .replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 120).toWellFormed();
          } catch {
            throw new ApiError(400, 'Invalid file name.');
          }
          requireValue(filename, 'The video needs a file name.');
          if (converted) filename = (filename.replace(/\.mov$/i, '') || 'exercise-video').slice(0, 116).toWellFormed() + '.mp4';
          const current = store.clip(workspace, id);
          if (rejectDeleted && !current) requireValue(!store.wasClipDeleted(workspace, id), deletedMessage, 410);
          const validateDetails = (clip) => requireValue(clip.exerciseId === exerciseId && clip.filename === filename && clip.mime === mime,
            'This video was already saved with different details. Select the file again to upload a new copy.', 409);
          if (current) validateDetails(current);
          if (uploading.has(workspace) || uploading.size >= 3) {
            res.setHeader('Retry-After', '2');
            throw new ApiError(429, 'Another video is uploading. Try again in a few seconds.');
          }
          uploading.add(workspace);
          const controller = new AbortController();
          const disconnected = () => { if (!res.writableFinished) controller.abort(); };
          res.once('close', disconnected);
          let admitted = true;
          const release = () => {
            if (!admitted) return;
            admitted = false;
            uploading.delete(workspace);
          };
          const expire = (message) => {
            if (res.destroyed || res.headersSent) return;
            controller.abort();
            release();
            res.setHeader('Connection', 'close');
            res.once('finish', () => req.destroy());
            json(res, 408, { error: message });
          };
          const idle = setTimeout(expire, uploadIdleTimeoutMs, 'The upload stopped sending data. Check your connection and try again.');
          const deadline = setTimeout(expire, 90_000, 'The upload took too long. Try again.');
          try {
            const bytes = await readBytes(req, res, maxVideoBytes, () => idle.refresh());
            clearTimeout(idle);
            clearTimeout(deadline);
            if (controller.signal.aborted || (req.destroyed && !req.complete)) return;
            requireValue(hasVideoTrack(sourceMime, bytes), 'This file does not contain a supported video track.', 415);
            const digest = createHash('sha256').update(bytes).digest('hex');
            let inserted = false;
            if (!current) {
              const playable = converted ? await convertVideo(bytes, { limit: maxVideoBytes, signal: controller.signal }) : bytes;
              controller.signal.throwIfAborted();
              if (converted) requireValue(hasVideoTrack(mime, playable), 'This MOV could not be converted to a playable video.', 422);
              const added = store.addClip(workspace, { id, exerciseId, filename, mime, bytes: playable, digest, rejectDeleted });
              requireValue(!added.deleted, deletedMessage, 410);
              inserted = Boolean(added.changes);
            }
            if (!inserted) {
              const saved = store.clip(workspace, id);
              if (rejectDeleted && !saved) requireValue(!store.wasClipDeleted(workspace, id), deletedMessage, 410);
              requireValue(saved, 'This video was deleted before the upload finished.', 409);
              validateDetails(saved);
              const savedDigest = store.clipDigest(workspace, id, saved);
              requireValue(digest === savedDigest, 'This video ID was already used. Select the file again to upload a new copy.', 409);
              if (!saved.digest) store.setClipDigest(workspace, id, digest);
            }
          } finally {
            clearTimeout(idle);
            clearTimeout(deadline);
            res.off('close', disconnected);
            release();
          }
          return json(res, 200, wantsDelta ? { clips: coaching.clipChanges(workspace, id) } : coaching.snapshot(workspace));
        }
        if (method === 'DELETE' && !action) {
          coaching.deleteClip(workspace, id);
          return json(res, 200, wantsDelta ? { clips: coaching.clipChanges(workspace, id) } : coaching.snapshot(workspace));
        }
        if (method === 'GET' && action === 'reviews') {
          const reviews = store.reviewHistory(workspace, id);
          requireValue(reviews, 'Video not found.', 404);
          return json(res, 200, { reviews });
        }
        if (action === 'review' && ['GET', 'POST', 'DELETE'].includes(method)) {
          if (method === 'GET') return json(res, 200, coaching.clipReview(workspace, id));
          if (method === 'DELETE') {
            const sequence = url.searchParams.get('sequence');
            requireValue(sequence === null || (/^\d+$/.test(sequence) && Number.isSafeInteger(Number(sequence))
              && Number(sequence) > 0), 'Choose a valid review attempt.');
            return json(res, 200, coaching.cancelReview(workspace, id, sequence === null ? undefined : Number(sequence)));
          }
          if (url.searchParams.get('background') === '1') {
            const offset = url.searchParams.get('start') ?? '0';
            requireValue(/^\d{1,5}$/.test(offset) && Number(offset) <= 86400, 'Choose a valid video start time.');
            const result = coaching.startReview(workspace, id, Number(offset), url.searchParams.get('refresh') === '1');
            return json(res, result.reviewStatus.state === 'running' ? 202 : 200, result);
          }
          const controller = new AbortController();
          const disconnected = () => controller.abort();
          res.once('close', disconnected);
          try {
            const review = await coaching.review(workspace, id, controller.signal);
            if (!res.destroyed) return json(res, 200, review);
          } finally {
            res.off('close', disconnected);
          }
          return;
        }
        if ((method === 'GET' || method === 'HEAD') && action === 'video') {
          return await sendVideo(req, res, store, workspace, id, url.searchParams.get('download') === '1', legacyReads);
        }
      }
      throw new ApiError(404, 'Endpoint not found.');
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      closeAfterResponse(req, res);
      const known = error instanceof ApiError || error instanceof AiError;
      if (error instanceof AiError && error.diagnostic) console.warn('Repform AI request failed:', error.diagnostic);
      else if (!known) console.error('Repform API request failed:', error.name);
      if (error instanceof AiError && error.retryAfter !== undefined) res.setHeader('Retry-After', String(error.retryAfter));
      json(res, known ? error.status : 500, { error: known ? error.message : 'Something went wrong. Please try again.' });
    }
  };
}
