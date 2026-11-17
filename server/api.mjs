import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { isTrainingBackupFormat } from '../shared/training-backup.mjs';
import { broadPriorities, buildTodayPlan, checkInReply, isPlannableExercise, starterExerciseIds } from '../shared/today-plan.mjs';
import { AiError, recommendationCandidateLimit } from './ai.mjs';
import { reviewVersion } from './coaching.mjs';
import { archivedExercises, catalog, categories, detailedMuscles, equipment, exercisesById, levels, muscles, recommend } from './catalog.mjs';
import { normalizeClipTrainingContext } from './clip-training-context.mjs';
import { hashBrowserToken, workspaceKeyFor } from './local-profiles.mjs';
import { profileArchiveMaxBytes } from './profile-archive.mjs';
import { profileArchiveInput } from './profile-archive-input.mjs';
import { convertQuickTime } from './quicktime.mjs';
import { maxExercisePicks, refineExercisePicks, refinements, suggestWorkout } from './recommendations.mjs';
import { chatHistoryLimit, chatMessageLimit, chatReplyLimit, lookupTrainingHistory, normalizeTrainingNote } from './training-chat.mjs';
import { hasVideoTrack } from './video-container.mjs';
import { workoutCalendar, workoutHistoryCsv } from './workout-exports.mjs';
import { maxSeriesOccurrences, seriesWorkoutId } from './workout-series.mjs';
import { closeAfterResponse, expectRequestBody, preferredEncoding } from './http.mjs';

const maxVideoBytes = 50 * 1024 * 1024;
const maxBackupBytes = 8 * 1024 * 1024;
const maxBackupWorkouts = 10_000;
const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const browserCookie = 'trainer_plus_browser';
const previousBrowserCookie = 'liftmorrow_browser';
const legacyCookies = ['liftmorrow_workspace', 'repform_workspace'];
const profileHeader = 'x-trainer-plus-profile';
const catalogHeader = 'x-trainer-plus-catalog';
const previousProfileHeader = 'x-liftmorrow-profile';
const profileChanged = 'The active profile changed. Open your profile again and retry.';
const videoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const workspaceResponseVersion = 3;
const compress = promisify(gzip);
const plannableExerciseIds = new Set(catalog.filter(isPlannableExercise).map(({ id }) => id));
const exerciseNames = new Map(catalog.map(({ id, name }) => [id, name]));

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireValue(condition, message, status = 400) {
  if (!condition) throw new ApiError(status, message);
}

function usernameField(value) {
  const username = typeof value === 'string' ? value.trim() : '';
  requireValue(/^[a-z0-9][a-z0-9_-]{2,23}$/i.test(username),
    'Use 3–24 letters, numbers, underscores, or hyphens. Start with a letter or number.');
  return username;
}

function profileDetails({ displayName, trainingGoal, trainingPreferences }) {
  const field = (value, limit, message) => {
    requireValue(typeof value === 'string' && value.trim().length <= limit, message);
    return value.trim().toWellFormed();
  };
  if (trainingPreferences !== undefined) {
    requireValue(trainingPreferences && typeof trainingPreferences === 'object' && !Array.isArray(trainingPreferences), 'Invalid training preferences.');
    const { intake, trainerNotes, experience, priorities, preferred, excluded, instructions } = trainingPreferences;
    requireValue(['completed', 'skipped'].includes(intake), 'Choose whether to finish or skip the intake.');
    requireValue(['', 'new', 'regular'].includes(experience), 'Choose your current training experience.');
    requireValue(optionList(priorities, [...new Set([...muscles, ...detailedMuscles, ...broadPriorities])]), 'Choose priorities from the muscle list.');
    const validExercises = (value) => Array.isArray(value) && value.length <= 20
      && new Set(value).size === value.length && value.every((id) => plannableExerciseIds.has(id));
    requireValue(validExercises(preferred) && validExercises(excluded) && !preferred.some((id) => excluded.includes(id)),
      'Choose up to 20 distinct exercises per list. An exercise cannot be preferred and excluded.');
    if (instructions !== undefined) {
      requireValue(Array.isArray(instructions) && instructions.length <= 20 && instructions.every((item) => item &&
        typeof item.id === 'string' && uuidPattern.test(item.id) && ['cue', 'prefer', 'avoid'].includes(item.kind) &&
        (item.kind === 'cue' ? exercisesById.has(item.exerciseId) : plannableExerciseIds.has(item.exerciseId))), 'Choose valid trainer instructions.');
      requireValue(new Set(instructions.map(({ id }) => id)).size === instructions.length &&
        new Set(instructions.map(({ exerciseId, kind }) => `${exerciseId}/${kind === 'cue' ? 'cue' : 'suggestion'}`)).size === instructions.length,
      'Keep one cue and one suggestion rule per movement.');
    }
    trainingPreferences = { intake, trainerNotes: field(trainerNotes, 1200, 'Keep trainer notes to 1200 characters.'),
      experience, priorities, preferred, excluded, ...(instructions?.length && { instructions: instructions.map(({ id, kind, exerciseId, text }) => {
        const instruction = field(text, 300, 'Keep trainer instructions to 300 characters.');
        requireValue(kind !== 'cue' || instruction, 'Enter the cue you want to see during this exercise.');
        return { id, kind, exerciseId, text: instruction };
      }) }) };
  }
  return {
    displayName: field(displayName, 60, 'Keep your display name to 60 characters.'),
    trainingGoal: field(trainingGoal, 240, 'Keep your training goal to 240 characters.'),
    ...(trainingPreferences !== undefined && { trainingPreferences }),
  };
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function catalogJson(req, res, data, verify) {
  const jsonBody = JSON.stringify(data);
  const encoding = jsonBody.length >= 16 * 1024 && preferredEncoding(req.headers['accept-encoding'], ['gzip']);
  const body = encoding ? await compress(jsonBody, { level: 3 }) : jsonBody;
  if (res.destroyed) return;
  verify();
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) };
  if (encoding) headers['Content-Encoding'] = encoding;
  res.writeHead(200, headers).end(body);
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
  const { name, date, time, status, exercises, notes, effort, source, skippedExerciseIds } = body;
  requireValue(typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 70, 'Enter a workout name of 1–70 characters.');
  requireValue(validDate(date), 'Choose a valid workout date.');
  requireValue(typeof time === 'string' && timePattern.test(time), 'Choose a valid workout time.');
  requireValue(['planned', 'completed'].includes(status), 'Choose a workout status.');
  requireValue(notes === undefined || typeof notes === 'string' && notes.length <= 1200, 'Keep workout notes to 1200 characters.');
  const completed = status === 'completed';
  requireValue(effort === undefined || effort === null || completed && Number.isInteger(effort) && effort >= 1 && effort <= 10,
    'Perceived effort must be a whole number from 1 to 10, or blank.');
  requireValue(source === undefined || ['manual', 'trainer', 'recommended'].includes(source), 'Choose a valid session source.');
  requireValue(skippedExerciseIds === undefined || completed && Array.isArray(skippedExerciseIds) &&
    skippedExerciseIds.length <= exercisesById.size && new Set(skippedExerciseIds).size === skippedExerciseIds.length &&
    skippedExerciseIds.every((id) => exercisesById.has(id)), 'Choose valid skipped exercises.');
  requireValue(Array.isArray(exercises) && exercises.length <= exercisesById.size && (completed || exercises.length > 0),
    'Add at least one exercise.');
  requireValue(exercises.every((entry) => entry && exercisesById.has(entry.exerciseId)), 'Choose an exercise from the library.');
  requireValue(new Set(exercises.map((entry) => entry.exerciseId)).size === exercises.length, 'Use each exercise once per workout.');
  return {
    name: name.trim().toWellFormed(), date, time, status,
    ...(notes !== undefined && { notes: notes.trim().toWellFormed() }),
    ...(effort !== undefined && { effort }),
    ...(source !== undefined && { source }),
    ...(skippedExerciseIds !== undefined && { skippedExerciseIds }),
    exercises: exercises.map((movement) => movementFields(movement, completed)),
  };
}

function movementFields({ exerciseId, sets, reps, load, setDetails, notes, replacesExerciseId }, completed) {
  requireValue(notes === undefined || typeof notes === 'string' && notes.length <= 500, 'Keep exercise notes to 500 characters.');
  const annotation = notes?.trim().toWellFormed();
  requireValue(replacesExerciseId === undefined || replacesExerciseId !== exerciseId && exercisesById.has(replacesExerciseId),
    'Choose a valid original exercise for this substitution.');
  const movement = { exerciseId, ...(annotation && { notes: annotation }), ...(replacesExerciseId && { replacesExerciseId }) };
  const weighted = exercisesById.get(exerciseId).loadType;
  function setFields(item, optionalReps = false) {
    const reps = item?.reps;
    const weight = item?.load;
    requireValue(item && (Number.isInteger(reps) && reps >= 1 && reps <= 600
      || optionalReps && reps === undefined && weight !== undefined), 'Enter valid reps or hold times from 1 to 600.');
    if (weight === undefined) return { reps };
    requireValue(weighted && weight && ['kg', 'lb'].includes(weight.unit) && typeof weight.value === 'number'
      && weight.value > 0 && weight.value <= 1000 && /^\d+(?:\.\d{1,2})?$/.test(String(weight.value)),
      'Use a weight from 0.01 to 1000 kg or lb.');
    return { ...(reps !== undefined && { reps }), load: { value: weight.value, unit: weight.unit } };
  }
  if (setDetails !== undefined) {
    requireValue(Array.isArray(setDetails) && setDetails.length <= 30 && (completed || setDetails.length >= 1),
      'Enter between 1 and 30 sets for each exercise.');
    const details = setDetails.map((set) => setFields(set, completed));
    return { ...movement, sets: details.length, ...details[0], setDetails: details };
  }
  requireValue(Number.isInteger(sets) && sets >= 1 && sets <= 30, 'Enter between 1 and 30 sets for each exercise.');
  return { ...movement, sets, ...setFields({ reps, load }) };
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
    return { ...workout, id: seriesWorkoutId(workout.id, index), date: day };
  });
}

function restoredWorkoutSeries({ id, seriesId, seriesIndex }) {
  if (seriesId === undefined && seriesIndex === undefined) return {};
  requireValue(typeof seriesId === 'string' && uuidPattern.test(seriesId) && Number.isInteger(seriesIndex)
    && seriesIndex >= 0 && seriesIndex < maxSeriesOccurrences && seriesWorkoutId(seriesId, seriesIndex) === id,
  'This backup contains an invalid weekly workout occurrence.');
  return { seriesId, seriesIndex };
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
  requireValue(clip.size > 0, 'This review was restored without its video file.', 404);
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

function recommendationTime(url) {
  const utc = new Date().toISOString();
  const date = url.searchParams.get('today') ?? utc.slice(0, 10);
  const time = url.searchParams.get('now') ?? utc.slice(11, 16);
  requireValue(validDate(date) && timePattern.test(time), 'Choose a valid local date and time.');
  return { date, time };
}

function exerciseHistory(store, workspace, { date, time }) {
  const history = new Map();
  for (const exercises of store.recentWorkouts(workspace, date, time)) {
    for (const { exerciseId, sets, setDetails } of exercises) {
      if ((setDetails?.length ?? sets) > 0) history.set(exerciseId, (history.get(exerciseId) ?? 0) + 1);
    }
  }
  return history;
}

function exerciseSelection(store, workspace, url) {
  const targets = url.searchParams.getAll('muscle');
  const detail = url.searchParams.get('detail');
  const mode = url.searchParams.get('equipment');
  requireValue(optionList(targets, muscles), 'Invalid muscle groups.');
  requireValue(detail === null || detailedMuscles.includes(detail), 'Invalid target muscle.');
  requireValue(mode === 'all' || mode === 'saved' || mode === 'bodyweight', 'Invalid equipment filter.');
  const query = url.searchParams.get('q') ?? '';
  requireValue(query.length <= 100, 'Keep the search to 100 characters.');
  const level = url.searchParams.get('level');
  requireValue(level === null || levels.includes(level), 'Invalid exercise level.');
  const category = url.searchParams.get('category');
  requireValue(category === null || categories.includes(category), 'Invalid exercise type.');
  const video = url.searchParams.get('video');
  requireValue(video === null || video === '1', 'Invalid video filter.');
  const available = mode === 'bodyweight' ? [] : mode === 'saved' ? store.equipment(workspace) : null;
  const history = exerciseHistory(store, workspace, recommendationTime(url));
  return { targets, detail, available, history,
    candidates: recommend({ targets, detail, available, recent: history, query, level, category }) };
}

function sessionCoachFields({ exerciseId, phase, question, setNumber, target }) {
  const exercise = exercisesById.get(exerciseId);
  requireValue(exercise, 'Choose an exercise from the library.');
  requireValue(['setup', 'set', 'rest', 'complete'].includes(phase), 'Choose a valid coaching step.');
  requireValue(Number.isInteger(setNumber) && setNumber >= 1 && setNumber <= 30, 'Choose a set number from 1 to 30.');
  const text = typeof question === 'string' ? question.trim() : '';
  requireValue(text.length > 0 && text.length <= 280, 'Enter a question of 1–280 characters.');
  let planned;
  if (target !== undefined) {
    requireValue(target && typeof target === 'object' && !Array.isArray(target), 'Invalid set target.');
    const { reps, load } = target;
    requireValue(reps === undefined || Number.isInteger(reps) && reps >= 1 && reps <= 600, 'Invalid reps or hold target.');
    requireValue(load === undefined || exercise.loadType && load && ['lb', 'kg'].includes(load.unit)
      && typeof load.value === 'number' && load.value >= 0.01 && load.value <= 1000
      && /^\d+(?:\.\d{1,2})?$/.test(String(load.value)), 'Invalid planned weight.');
    planned = { reps, ...(load && { load: { value: load.value, unit: load.unit } }) };
  }
  return { exercise, phase, question: text.toWellFormed(), setNumber, target: planned };
}

export function createApi(store, {
  webOrigin, secureCookies = false, coaching, convertVideo = convertQuickTime, uploadIdleTimeoutMs = 15_000,
  legacyReadBudgetBytes = 64 * 1024 * 1024,
} = {}) {
  const uploading = new Set();
  let archiveTransfer = false;
  const legacyReads = { used: 0, limit: legacyReadBudgetBytes };
  const workspaceConfig = { catalog, archivedExercises, muscles, equipmentOptions: equipment, exerciseCategories: categories,
    aiAvailable: coaching.available, reviewVersion };
  const workspaceSchema = createHash('sha256').update(JSON.stringify([workspaceResponseVersion, workspaceConfig])).digest('hex');
  const catalogVersion = createHash('sha256').update(JSON.stringify([catalog, archivedExercises])).digest('hex');
  const catalogIds = new Set(catalog.map(({ id }) => id));
  function workspaceCatalog(snapshot, preferences, notes) {
    const ids = new Set([...starterExerciseIds, ...snapshot.bookmarks, ...(preferences?.preferred ?? []), ...(preferences?.excluded ?? []),
      ...(preferences?.instructions ?? []).map(({ exerciseId }) => exerciseId), ...notes.map(({ exerciseId }) => exerciseId)]);
    for (const workout of snapshot.workouts) {
      for (const movement of workout.exercises) {
        ids.add(movement.exerciseId);
        ids.add(movement.replacesExerciseId);
      }
      for (const exerciseId of workout.skippedExerciseIds ?? []) ids.add(exerciseId);
    }
    for (const clip of snapshot.clips) {
      ids.add(clip.exerciseId);
      ids.add(clip.review?.detectedExerciseId);
    }
    return {
      ...workspaceConfig, catalog: catalog.filter(({ id }) => ids.has(id)),
      archivedExercises: [...ids].flatMap((id) => !catalogIds.has(id) && exercisesById.has(id) ? [exercisesById.get(id)] : []),
      catalogVersion,
    };
  }
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
          'Access-Control-Allow-Headers': `Content-Type, X-Clip-Name, ${profileHeader}, ${previousProfileHeader}, ${catalogHeader}, If-None-Match, If-Range, Range`,
        });
        res.end();
        return;
      }

      const [, , resource, id, action, extra] = url.pathname.split('/');
      requireValue(!extra, 'Endpoint not found.', 404);
      const wantsDelta = url.searchParams.get('response') === 'delta';
      const cookies = (req.headers.cookie ?? '').split(';').map((value) => value.trim());
      const readCookie = (name) => cookies.find((value) => value.startsWith(name + '='))?.slice(name.length + 1);
      const currentToken = readCookie(browserCookie);
      const rawToken = currentToken ?? readCookie(previousBrowserCookie);
      const browserId = /^[a-f0-9]{64}$/.test(rawToken ?? '') ? hashBrowserToken(rawToken) : null;
      const legacyCookie = readCookie(legacyCookies[0]) ?? readCookie(legacyCookies[1]);
      const legacy = uuidPattern.test(legacyCookie ?? '') ? legacyCookie : null;
      const workspace = store.profiles.active(browserId);
      const workspaceKey = workspace && workspaceKeyFor(workspace);
      const requestedProfile = req.headers[profileHeader] ?? req.headers[previousProfileHeader];
      const expected = requestedProfile ?? url.searchParams.get('profile');
      const requireCurrent = () => requireValue(store.profiles.active(browserId) === workspace, profileChanged, 409);

      if (resource === 'profiles' && !action) {
        const cookieOptions = `Path=/; HttpOnly; SameSite=Lax${secureCookies ? '; Secure' : ''}`;
        const setBrowserCookie = (token) => `${browserCookie}=${token}; ${cookieOptions}; Max-Age=31536000`;
        const expireCookie = (name) => `${name}=; ${cookieOptions}; Max-Age=0`;
        if (!id && method === 'GET') {
          if (store.profiles.hasBrowser(browserId)) {
            res.setHeader('Set-Cookie', currentToken === undefined
              ? [setBrowserCookie(rawToken), expireCookie(previousBrowserCookie)] : setBrowserCookie(rawToken));
          }
          return json(res, 200, store.profiles.state(browserId, legacy));
        }
        if (!id && method === 'POST') {
          const { username: entered, setup = false } = await readJson(req, res, 2048);
          const username = usernameField(entered);
          requireValue(typeof setup === 'boolean', 'Invalid profile setup option.');
          const knownBrowser = store.profiles.hasBrowser(browserId);
          const token = knownBrowser ? rawToken : randomBytes(32).toString('hex');
          const owner = knownBrowser ? browserId : hashBrowserToken(token);
          const result = store.profiles.create(owner, username, legacy, setup);
          requireValue(result !== 'active', 'Sign out before creating another profile.', 409);
          requireValue(result !== 'duplicate', 'That username already has a profile in this browser.', 409);
          const updates = knownBrowser && currentToken !== undefined ? [] : [setBrowserCookie(token)];
          for (const name of [previousBrowserCookie, ...legacyCookies]) {
            if (readCookie(name) !== undefined) updates.push(expireCookie(name));
          }
          if (updates.length) res.setHeader('Set-Cookie', updates);
          return json(res, 201, store.profiles.state(owner, null));
        }
        if (id === 'login' && method === 'POST') {
          const { username: entered } = await readJson(req, res, 2048);
          const username = usernameField(entered);
          const result = browserId ? store.profiles.signIn(browserId, username) : 'missing';
          requireValue(result !== 'active', 'Sign out before switching profiles.', 409);
          requireValue(result === 'selected', 'This profile was not found in this browser.', 404);
          return json(res, 200, store.profiles.state(browserId, null));
        }
        if (id === 'setup' && method === 'POST') {
          requireValue(workspace && expected === workspaceKey, profileChanged, 409);
          const body = await readJson(req, res, 16 * 1024);
          const details = profileDetails(body);
          const selected = body.equipment;
          requireValue(selected === undefined || selected === null || optionList(selected, equipment), 'Choose equipment from the available options.');
          requireValue(store.profiles.completeSetup(browserId, workspace, details, selected), profileChanged, 409);
          return json(res, 200, store.profiles.state(browserId, null));
        }
        if ((id === 'current' && ['PUT', 'DELETE'].includes(method)) || (id === 'logout' && method === 'POST')) {
          requireValue(workspace && expected === workspaceKey, profileChanged, 409);
          const operation = id === 'logout' ? 'logout' : method === 'PUT' ? 'update' : 'delete';
          const details = operation === 'update' ? profileDetails(await readJson(req, res, 16 * 1024)) : undefined;
          requireValue(store.profiles.changeActive(browserId, workspace, operation, details), profileChanged, 409);
          if (operation === 'delete') coaching.removeWorkspace(workspace);
          return json(res, 200, store.profiles.state(browserId, null));
        }
        throw new ApiError(404, 'Endpoint not found.');
      }

      requireValue(workspace, 'Sign in to open your workspace.', 404);
      requireValue(expected === null || expected === workspaceKey, profileChanged, 409);

      if (resource === 'history-lookup' && method === 'POST' && !id) {
        requireValue(requestedProfile === workspaceKey, profileChanged, 409);
        const query = await readJson(req, res, 4096);
        requireValue((query.kind === 'week' && ['this', 'last'].includes(query.week))
          || (query.kind === 'weight' && ['latest', 'heaviest'].includes(query.weight) && exercisesById.has(query.exerciseId)),
        'Choose a week or an exercise from the library.');
        requireCurrent();
        return json(res, 200, lookupTrainingHistory(store.workouts(workspace), recommendationTime(url), query));
      }

      if (resource === 'chat' && method === 'POST' && !id) {
        requireValue(requestedProfile === workspaceKey, profileChanged, 409);
        const { message, history = [] } = await readJson(req, res, 64 * 1024);
        requireValue(typeof message === 'string' && message.trim().length > 0 && message.length <= chatMessageLimit,
          'Enter a message of 1–1200 characters.');
        requireValue(Array.isArray(history) && history.length <= chatHistoryLimit && history.length % 2 === 0
          && history.every((turn, index) => turn?.role === (index % 2 ? 'assistant' : 'user')
            && typeof turn.text === 'string' && turn.text.trim().length > 0
            && turn.text.length <= (index % 2 ? chatReplyLimit : chatMessageLimit)), 'Invalid conversation history.');
        const current = recommendationTime(url);
        requireCurrent();
        if (res.destroyed) return;
        const controller = new AbortController();
        const disconnected = () => controller.abort();
        res.once('close', disconnected);
        try {
          const reply = await coaching.chat(workspace, {
            current, message: message.trim().toWellFormed(),
            history: history.map(({ role, text }) => ({ role, text: text.trim().toWellFormed() })),
          }, controller.signal);
          if (res.destroyed) return;
          requireCurrent();
          return json(res, 200, reply);
        } finally {
          res.off('close', disconnected);
        }
      }

      if (resource === 'training-notes' && uuidPattern.test(id ?? '') && !action) {
        requireValue(requestedProfile === workspaceKey, profileChanged, 409);
        if (method === 'PUT') {
          const note = normalizeTrainingNote(await readJson(req, res, 8192));
          requireValue(note, 'Enter a valid training note.');
          requireCurrent();
          const trainingNotes = store.saveTrainingNote(workspace, id, note);
          requireValue(trainingNotes !== 'full', 'Your profile has 40 notes. Remove one in Profile before saving more.', 409);
          requireValue(trainingNotes !== 'conflict', 'This note was already saved with different details.', 409);
          return json(res, 200, { trainingNotes });
        }
        if (method === 'DELETE') return json(res, 200, { trainingNotes: store.removeTrainingNote(workspace, id) });
      }

      if (resource === 'session-coach' && method === 'POST' && !id && !action) {
        requireValue(expected === workspaceKey, profileChanged, 409);
        const input = sessionCoachFields(await readJson(req, res, 4096));
        requireCurrent();
        if (res.destroyed) return;
        const controller = new AbortController();
        const disconnected = () => controller.abort();
        res.once('close', disconnected);
        try {
          const reply = await coaching.sessionCoach(workspace, input, controller.signal);
          if (res.destroyed) return;
          requireCurrent();
          return json(res, 200, reply);
        } finally {
          res.off('close', disconnected);
        }
      }

      if (resource === 'companion' && !action) {
        requireValue(expected === workspaceKey, profileChanged, 409);
        if (id === 'profile-history' && method === 'GET') return json(res, 200, store.profiles.history(workspace));
        const day = url.searchParams.get('day');
        requireValue(validDate(day), 'Choose a valid check-in date.');
        if (!id && method === 'GET') return json(res, 200, store.checkIns.state(workspace, day));
        if (!id && method === 'POST') {
          const body = await readJson(req, res, 8192);
          requireValue(typeof body.id === 'string' && uuidPattern.test(body.id), 'Invalid check-in ID.');
          requireValue(typeof body.time === 'string' && timePattern.test(body.time), 'Choose a valid check-in time.');
          requireValue(body.adjustment === undefined || ['easier', 'rest', 'usual'].includes(body.adjustment), 'Choose a valid adjustment.');
          requireValue(typeof body.wantsReply === 'boolean', 'Choose whether to request a reply.');
          requireValue(typeof body.text === 'string' && body.text.length <= 1200 && (body.text.trim() || body.adjustment),
            'Enter a note of up to 1200 characters or choose an adjustment.');
          requireCurrent();
          const entry = { id: body.id, day, text: body.text.trim().toWellFormed(), adjustment: body.adjustment ?? null, wantsReply: body.wantsReply };
          const result = store.checkIns.save(workspace, entry, () => {
            const adjustment = entry.adjustment ?? store.checkIns.state(workspace, day).adjustment;
            const plan = buildTodayPlan({
              current: { date: day, time: body.time }, workouts: store.workouts(workspace), catalog,
              equipment: store.equipment(workspace), preferences: store.profiles.details(workspace).trainingPreferences, adjustment,
              trainingNotes: store.trainingNotes(workspace),
            });
            return checkInReply(entry.text, plan, exerciseNames, entry.adjustment);
          });
          requireValue(result, 'This check-in was already saved with different details.', 409);
          return json(res, 200, result);
        }
        if (id && uuidPattern.test(id) && method === 'DELETE') return json(res, 200, store.checkIns.remove(workspace, id, day));
      }

      if (resource === 'exercise-catalog' && method === 'GET' && !id) {
        requireValue(expected === workspaceKey, profileChanged, 409);
        return await catalogJson(req, res, { catalogVersion, catalog, archivedExercises }, requireCurrent);
      }

      if (resource === 'workspace' && method === 'GET' && !id) {
        const deferCatalog = req.headers[catalogHeader] === 'defer';
        res.setHeader('Vary', [origin && originAllowed && 'Origin', 'Cookie', 'Accept-Encoding', 'X-Trainer-Plus-Catalog'].filter(Boolean).join(', '));
        const { tag, data } = store.readWorkspace(workspace, (revision, liveReviews, now) => {
          requireValue(revision !== undefined, profileChanged, 409);
          const preferences = deferCatalog ? store.profiles.details(workspace).trainingPreferences : null;
          const fingerprint = createHash('sha256').update(JSON.stringify([workspaceSchema, workspaceKey, revision, liveReviews, deferCatalog, preferences])).digest('hex');
          const tag = '"' + fingerprint + '"';
          const matches = revision && matchesWorkspaceTag(req.headers['if-none-match'], tag);
          if (matches) return { tag, data: null };
          const snapshot = coaching.snapshot(workspace, now);
          const trainingNotes = store.trainingNotes(workspace);
          const config = deferCatalog ? workspaceCatalog(snapshot, preferences, trainingNotes) : workspaceConfig;
          return { tag, data: { ...snapshot, ...config, workspaceKey, trainingNotes } };
        });
        res.setHeader('ETag', 'W/' + tag);
        closeAfterResponse(req, res);
        if (!data) return res.writeHead(304).end();
        return await catalogJson(req, res, data, requireCurrent);
      }

      if (resource === 'workspace' && id === 'profile-archive' && !action && ['GET', 'POST'].includes(method)) {
        requireValue(expected === workspaceKey, profileChanged, 409);
        requireValue(!archiveTransfer, 'A profile archive is already transferring. Try again shortly.', 429);
        archiveTransfer = true;
        const release = () => {
          res.off('finish', release);
          res.off('close', release);
          archiveTransfer = false;
        };
        res.once('finish', release);
        res.once('close', release);
        if (method === 'GET') {
          const media = url.searchParams.get('media') ?? 'none';
          requireValue(['none', 'all'].includes(media) || uuidPattern.test(media), 'Choose which video files to include.');
          if (uuidPattern.test(media)) requireValue(store.clip(workspace, media)?.size > 0, 'That video file is unavailable.', 404);
          const archive = store.archive.download(workspace, media);
          requireValue(archive !== null, 'This archive exceeds 96 MiB. Download the profile archive without videos, then choose individual videos.', 413);
          requireCurrent();
          return res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(archive),
            'Content-Disposition': 'attachment; filename="trainer-plus-profile-archive.json"' }).end(archive);
        }
        const mode = url.searchParams.get('mode');
        requireValue(['preview', 'restore'].includes(mode), 'Choose Preview restore or Restore archive.');
        const body = await readJson(req, res, profileArchiveMaxBytes);
        requireCurrent();
        const archive = profileArchiveInput(body, {
          require: requireValue, validDate, validId: (id) => typeof id === 'string' && uuidPattern.test(id),
          validEquipment: (value) => optionList(value, equipment),
          normalizeProfile(details) {
            const { displayName, trainingGoal, trainingPreferences } = details;
            const valid = profileDetails({ displayName: displayName ?? '', trainingGoal: trainingGoal ?? '', trainingPreferences });
            return { ...(displayName !== undefined && { displayName: valid.displayName }), ...(trainingGoal !== undefined && { trainingGoal: valid.trainingGoal }),
              ...(valid.trainingPreferences && { trainingPreferences: valid.trainingPreferences }) };
          },
          normalizeWorkout: (workout) => ({ id: workout.id, ...workoutFields(workout), ...restoredWorkoutSeries(workout) }),
          normalizeNote: normalizeTrainingNote, maxVideoBytes, maxBackupWorkouts,
        });
        return json(res, 200, { records: store.archive.restore(workspace, archive, mode === 'restore', requireCurrent) });
      }

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
            'Content-Disposition': 'attachment; filename="trainer-plus-training-backup.json"', 'Content-Length': Buffer.byteLength(body) });
          return res.end(body);
        }
        if (method === 'POST') {
          const backup = await readJson(req, res, maxBackupBytes);
          requireCurrent();
          requireValue(isTrainingBackupFormat(backup.format) && backup.version === 1,
            'Choose a Trainer Plus training backup in the current format.');
          requireValue(backup.equipment === null || optionList(backup.equipment, equipment), 'This backup contains invalid equipment options.');
          const bookmarks = backup.bookmarks === undefined ? [] : backup.bookmarks;
          requireValue(Array.isArray(bookmarks) && bookmarks.length <= exercisesById.size && new Set(bookmarks).size === bookmarks.length
            && bookmarks.every((id) => exercisesById.has(id)), 'This backup contains invalid saved exercises.');
          requireValue(Array.isArray(backup.workouts) && backup.workouts.length <= maxBackupWorkouts, 'A backup can contain up to 10,000 workouts.');
          const ids = new Set();
          const workouts = backup.workouts.map((workout) => {
            requireValue(workout && typeof workout.id === 'string' && uuidPattern.test(workout.id) && !ids.has(workout.id),
              'This backup contains invalid or duplicate workout IDs.');
            ids.add(workout.id);
            return { id: workout.id, ...workoutFields(workout), ...restoredWorkoutSeries(workout) };
          });
          const restored = store.importTrainingData(workspace, backup.equipment, workouts, bookmarks);
          const response = url.searchParams.get('response') === 'summary' ? { restore: restored }
            : { ...coaching.snapshot(workspace), restore: restored };
          return json(res, 200, response);
        }
      }
      if (resource === 'workspace' && id === 'example-workouts' && method === 'POST' && !action) {
        const { today } = await readJson(req, res);
        requireCurrent();
        requireValue(validDate(today), 'Choose a valid date.');
        store.addExampleWorkouts(workspace, today);
        return json(res, 200, coaching.snapshot(workspace));
      }
      if (resource === 'workspace' && id === 'example-workouts' && method === 'DELETE' && !action) {
        store.removeExampleWorkouts(workspace);
        return json(res, 200, coaching.snapshot(workspace));
      }
      if (resource === 'exercises' && method === 'GET' && !id) {
        res.setHeader('Vary', origin && originAllowed ? 'Origin, Accept-Encoding' : 'Accept-Encoding');
        return await catalogJson(req, res, exerciseSelection(store, workspace, url).candidates, requireCurrent);
      }
      if (resource === 'exercises' && action === 'bookmark' && ['PUT', 'DELETE'].includes(method)) {
        requireValue(exercisesById.has(id), 'Exercise not found.', 404);
        store.setBookmark(workspace, id, method === 'PUT');
        return json(res, 200, wantsDelta ? { bookmarks: store.bookmarks(workspace) } : coaching.snapshot(workspace));
      }
      if (resource === 'exercises' && id === 'recommendations' && method === 'POST' && !action) {
        let request;
        if (Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding']) {
          request = await readJson(req, res, 2048);
          requireCurrent();
          requireValue(refinements.includes(request.adjustment) && Array.isArray(request.previous)
            && request.previous.length > 0 && request.previous.length <= maxExercisePicks
            && new Set(request.previous).size === request.previous.length && request.previous.every((id) => typeof id === 'string'),
          'Choose a valid recommendation adjustment.');
        }
        const selection = exerciseSelection(store, workspace, url);
        const rank = (input) => coaching.recommend(workspace, input);
        let picks;
        if (request) {
          const eligible = new Map(selection.candidates.map((exercise) => [exercise.id, exercise]));
          requireValue(request.previous.every((id) => eligible.has(id)), 'These picks no longer match your filters. Get new recommendations.', 409);
          picks = await refineExercisePicks(rank, selection, request.previous.map((id) => eligible.get(id)), request.adjustment);
        } else {
          picks = await rank({ ...selection, candidates: selection.candidates.slice(0, recommendationCandidateLimit) });
        }
        requireCurrent();
        return json(res, 200, picks);
      }

      if (resource === 'workouts' && id === 'recommendation' && method === 'POST' && !action) {
        requireValue(expected === workspaceKey, profileChanged, 409);
        const current = recommendationTime(url);
        const date = url.searchParams.get('date');
        const time = url.searchParams.get('time');
        const rawMinutes = url.searchParams.get('minutes');
        const minutes = rawMinutes === null ? undefined : Number(rawMinutes);
        const gearOverride = url.searchParams.get('gearOverride');
        const gear = url.searchParams.getAll('gear');
        requireValue(date === null && time === null || validDate(date) && timePattern.test(time), 'Choose a valid scheduled date and time.');
        requireValue(rawMinutes === null || Number.isInteger(minutes) && minutes >= 5 && minutes <= 120, 'Choose between 5 and 120 minutes.');
        requireValue(gearOverride === null && !gear.length || gearOverride === '1' && optionList(gear, equipment), 'Choose from available equipment.');
        const suggestion = await suggestWorkout({ current, scheduled: date ? { date, time } : undefined, minutes,
          available: gearOverride ? gear : store.equipment(workspace),
          rank: coaching.available ? (input) => coaching.recommend(workspace, input) : null,
          history: exerciseHistory(store, workspace, current), preferences: store.profiles.details(workspace).trainingPreferences,
          workouts: store.workouts(workspace),
          trainingNotes: store.trainingNotes(workspace),
        });
        requireCurrent();
        return json(res, 200, suggestion);
      }

      if (resource === 'equipment' && method === 'PUT' && !id) {
        const { selected } = await readJson(req, res);
        requireCurrent();
        requireValue(selected === null || optionList(selected, equipment), 'Choose equipment from the available options.');
        store.setEquipment(workspace, selected);
        return json(res, 200, wantsDelta ? { equipment: store.equipment(workspace) } : coaching.snapshot(workspace));
      }

      if (resource === 'workouts' && id && action === 'series' && method === 'PUT') {
        const body = await readJson(req, res);
        requireCurrent();
        const workout = workoutFields(body);
        const { expected, operationId } = body;
        requireValue(workout.status === 'planned' && typeof operationId === 'string' && uuidPattern.test(operationId)
          && Array.isArray(expected) && expected.length >= 1 && expected.length <= maxSeriesOccurrences
          && expected[0]?.id === id && new Set(expected.map((entry) => entry?.id)).size === expected.length
          && expected.every((entry) => typeof entry?.id === 'string' && uuidPattern.test(entry.id)
            && Number.isSafeInteger(entry.revision) && entry.revision > 0),
        'Choose valid weekly occurrences to update.');
        const result = store.updateWorkoutSeries(workspace, id, workout, expected.map(({ id, revision }) => ({ id, revision })), operationId);
        requireValue(result.error !== 'missing', 'This planned workout is no longer part of a series.', 404);
        requireValue(result.error !== 'conflict', 'The series changed. Reopen the workout to see the latest schedule.', 409);
        requireValue(result.error !== 'date', 'Use dates that keep the entire series within the supported calendar.');
        return json(res, 200, wantsDelta ? { workouts: store.workoutChanges(workspace, result.ids) } : coaching.snapshot(workspace));
      }

      if (resource === 'workouts' && !action) {
        if (method === 'GET' && id === 'history.csv') {
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="trainer-plus-history.csv"',
          });
          return await pipeline(Readable.from(workoutHistoryCsv(store.historyWorkouts(workspace), url.searchParams.get('feedback') === '1'), { objectMode: false }), res);
        }
        if (method === 'GET' && id === 'calendar.ics') {
          const only = url.searchParams.get('workout');
          const workout = only && store.calendarWorkout(workspace, only);
          if (only) requireValue(workout, 'Workout not found.', 404);
          const workouts = workout ? [workout] : store.calendarWorkouts(workspace);
          res.writeHead(200, {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'attachment; filename="trainer-plus-calendar.ics"',
          });
          return await pipeline(Readable.from(workoutCalendar(workouts), { objectMode: false }), res);
        }
        if (method === 'POST' && !id) {
          const body = await readJson(req, res);
          requireCurrent();
          requireValue(typeof body.id === 'string' && uuidPattern.test(body.id), 'Invalid workout ID.');
          const workout = { id: body.id, ...workoutFields(body) };
          const weeks = body.repeatWeeks === undefined ? 1 : body.repeatWeeks;
          requireValue(Number.isInteger(weeks) && weeks >= 1 && weeks <= maxSeriesOccurrences && (weeks === 1 || workout.status === 'planned'),
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
          requireCurrent();
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
          requireCurrent();
          requireValue(exerciseId === '' || exercisesById.has(exerciseId), 'Choose an exercise from the library.');
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
          const exerciseId = url.searchParams.get('exercise') ?? '';
          const rawContext = url.searchParams.get('trainingContext');
          let trainingContext = null;
          if (rawContext !== null) {
            requireValue(rawContext.length <= 512, 'Invalid workout video context.');
            try { trainingContext = normalizeClipTrainingContext(JSON.parse(rawContext)); }
            catch { throw new ApiError(400, 'Invalid workout video context.'); }
            requireValue(trainingContext, 'Invalid workout video context.');
          }
          const rejectDeleted = url.searchParams.get('protectDeleted') === '1';
          const deletedMessage = 'This video was removed in another tab. Choose a file to upload it again.';
          const sourceMime = req.headers['content-type']?.split(';')[0];
          requireValue(exerciseId === '' || exercisesById.has(exerciseId), 'Choose an exercise from the library.');
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
          const validateDetails = (clip) => requireValue(clip.exerciseId === exerciseId && clip.filename === filename && clip.mime === mime
            && clip.training_context === (trainingContext ? JSON.stringify(trainingContext) : null),
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
            requireCurrent();
            requireValue(hasVideoTrack(sourceMime, bytes), 'This file does not contain a supported video track.', 415);
            const digest = createHash('sha256').update(bytes).digest('hex');
            let inserted = false;
            if (!current) {
              const playable = converted ? await convertVideo(bytes, { limit: maxVideoBytes, signal: controller.signal }) : bytes;
              controller.signal.throwIfAborted();
              requireCurrent();
              if (converted) requireValue(hasVideoTrack(mime, playable), 'This MOV could not be converted to a playable video.', 422);
              const added = store.addClip(workspace, { id, exerciseId, filename, mime, bytes: playable, digest, rejectDeleted, trainingContext });
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
            const end = url.searchParams.get('end');
            requireValue(/^\d{1,5}$/.test(offset) && Number(offset) <= 86400, 'Choose a valid video start time.');
            requireValue(end === null || (/^\d{1,5}$/.test(end) && Number(end) <= 86400 && Number(end) > Number(offset)),
              'Choose a valid end time after the start time.');
            const range = { startSeconds: Number(offset), endSeconds: end === null ? undefined : Number(end) };
            const result = coaching.startReview(workspace, id, range, url.searchParams.get('refresh') === '1');
            return json(res, result.reviewStatus.state === 'running' ? 202 : 200, result);
          }
          const controller = new AbortController();
          const disconnected = () => controller.abort();
          res.once('close', disconnected);
          try {
            const review = await coaching.review(workspace, id, controller.signal);
            requireCurrent();
            if (!res.destroyed) return json(res, 200, review);
          } finally {
            res.off('close', disconnected);
          }
          return;
        }
        if ((method === 'GET' || method === 'HEAD') && action === 'video') {
          return await sendVideo(req, res, store, workspace, id, url.searchParams.get('download') === '1', legacyReads);
        }
        if (method === 'GET' && action === 'review-still') {
          requireValue(expected === workspaceKey, profileChanged, 409);
          const sequence = url.searchParams.get('sequence') ?? '';
          requireValue(/^\d+$/.test(sequence) && Number.isSafeInteger(Number(sequence)) && Number(sequence) > 0,
            'Choose a saved review.');
          const still = store.reviewStill(workspace, id, Number(sequence));
          requireValue(still, 'Review still not found.', 404);
          return res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': still.length }).end(still);
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
      if (error instanceof AiError && error.diagnostic) console.warn('Trainer Plus AI request failed:', error.diagnostic);
      else if (!known) console.error('Trainer Plus API request failed:', error.name);
      if (error instanceof AiError && error.retryAfter !== undefined) res.setHeader('Retry-After', String(error.retryAfter));
      json(res, known ? error.status : 500, { error: known ? error.message : 'Something went wrong. Please try again.' });
    }
  };
}
