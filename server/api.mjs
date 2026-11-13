import { catalog, equipment, exercisesById, muscles, recommend } from './catalog.mjs';

const maxVideoBytes = 50 * 1024 * 1024;
const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const cookieName = 'repform_workspace';
const videoTypes = new Set(['video/mp4', 'video/webm']);

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

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2199-12-31') return false;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function optionList(value, options) {
  return Array.isArray(value) && value.length <= options.length
    && new Set(value).size === value.length && value.every((item) => options.includes(item));
}

async function readBytes(req, limit) {
  if (Number(req.headers['content-length']) > limit) {
    req.resume();
    throw new ApiError(413, 'This file is too large.');
  }
  const parts = [];
  let size = 0;
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    size += part.length;
    if (size > limit) {
      req.resume();
      throw new ApiError(413, 'This file is too large.');
    }
    parts.push(part);
  }
  return Buffer.concat(parts, size);
}

async function readJson(req) {
  requireValue(req.headers['content-type']?.split(';')[0] === 'application/json', 'Use a JSON request.', 415);
  const bytes = await readBytes(req, 16 * 1024);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Invalid request.');
    return value;
  } catch {
    throw new ApiError(400, 'Invalid request.');
  }
}

function workoutFields(body) {
  const { name, date, time, status, exercises } = body;
  requireValue(typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 70, 'Enter a workout name of 1–70 characters.');
  requireValue(validDate(date), 'Choose a valid workout date.');
  requireValue(typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time), 'Choose a valid workout time.');
  requireValue(['planned', 'completed'].includes(status), 'Choose a workout status.');
  requireValue(Array.isArray(exercises) && exercises.length > 0 && exercises.length <= catalog.length, 'Add at least one exercise.');
  requireValue(exercises.every((entry) => entry && exercisesById.has(entry.exerciseId)
    && Number.isInteger(entry.sets) && entry.sets >= 1 && entry.sets <= 30
    && Number.isInteger(entry.reps) && entry.reps >= 1 && entry.reps <= 600), 'Enter valid sets and reps or hold times.');
  requireValue(new Set(exercises.map((entry) => entry.exerciseId)).size === exercises.length, 'Use each exercise once per workout.');
  return {
    name: name.trim(), date, time, status,
    exercises: exercises.map(({ exerciseId, sets, reps }) => ({ exerciseId, sets, reps })),
  };
}

function hasVideoSignature(mime, bytes) {
  if (mime === 'video/webm') return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp';
}

function videoRange(header, size) {
  if (!header) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}

function sendVideo(req, res, store, workspace, id) {
  const clip = store.clip(workspace, id);
  requireValue(clip, 'Video not found.', 404);
  const range = videoRange(req.headers.range, clip.size);
  if (!range) {
    res.writeHead(416, { 'Content-Range': `bytes */${clip.size}` });
    res.end();
    return;
  }
  const { start, end } = range;
  const length = end - start + 1;
  const headers = { 'Content-Type': clip.mime, 'Content-Length': length, 'Accept-Ranges': 'bytes' };
  if (req.headers.range) headers['Content-Range'] = `bytes ${start}-${end}/${clip.size}`;
  res.writeHead(req.headers.range ? 206 : 200, headers);
  res.end(req.method === 'HEAD' ? undefined : store.clipBytes(workspace, id, start, length));
}

export function createApi(store, { webOrigin, secureCookies = false } = {}) {
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
      res.setHeader('Vary', 'Origin');
    }
    try {
      requireValue(!origin || originAllowed, 'This origin is not allowed.', 403);
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Clip-Name',
        });
        res.end();
        return;
      }

      const [, , resource, id, action, extra] = url.pathname.split('/');
      requireValue(!extra, 'Endpoint not found.', 404);
      const cookie = (req.headers.cookie ?? '').split(';').map((value) => value.trim())
        .find((value) => value.startsWith(cookieName + '='));
      let workspace = cookie?.slice(cookieName.length + 1);
      if (workspace && (!uuidPattern.test(workspace) || !store.workspace(workspace))) workspace = undefined;

      if (resource === 'workspace' && method === 'GET' && !id) {
        if (!workspace) {
          const today = url.searchParams.get('today');
          workspace = store.createWorkspace(validDate(today) ? today : new Date().toISOString().slice(0, 10));
          res.setHeader('Set-Cookie', `${cookieName}=${workspace}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secureCookies ? '; Secure' : ''}`);
        }
        return json(res, 200, { ...store.snapshot(workspace), catalog, muscles, equipmentOptions: equipment });
      }

      requireValue(workspace, 'Workspace not found. Reload the page and try again.', 404);
      if (resource === 'exercises' && method === 'GET' && !id) {
        const targets = url.searchParams.getAll('muscle');
        const mode = url.searchParams.get('equipment');
        requireValue(optionList(targets, muscles), 'Invalid muscle groups.');
        requireValue(mode === 'all' || mode === 'saved' || mode === 'bodyweight', 'Invalid equipment filter.');
        const snapshot = store.snapshot(workspace);
        const available = mode === 'bodyweight' ? [] : mode === 'saved' ? snapshot.equipment : null;
        const recent = new Set(snapshot.workouts.filter((workout) => workout.status === 'completed')
          .slice(-5).flatMap((workout) => workout.exercises.map((item) => item.exerciseId)));
        return json(res, 200, recommend({ targets, available, recent, query: url.searchParams.get('q') ?? '' }));
      }

      if (resource === 'equipment' && method === 'PUT' && !id) {
        const { selected } = await readJson(req);
        requireValue(selected === null || optionList(selected, equipment), 'Choose equipment from the available options.');
        store.setEquipment(workspace, selected);
        return json(res, 200, store.snapshot(workspace));
      }

      if (resource === 'workouts' && !action) {
        if (method === 'POST' && !id) {
          const body = await readJson(req);
          requireValue(typeof body.id === 'string' && uuidPattern.test(body.id), 'Invalid workout ID.');
          store.insertWorkout(workspace, { id: body.id, ...workoutFields(body) });
          return json(res, 200, store.snapshot(workspace));
        }
        if (id && method === 'PUT') {
          const fields = workoutFields(await readJson(req));
          const update = store.updateWorkout(workspace, id, fields);
          requireValue(update.changes > 0, 'Workout not found.', 404);
          return json(res, 200, store.snapshot(workspace));
        }
        if (id && method === 'DELETE') {
          store.removeWorkout(workspace, id);
          return json(res, 200, store.snapshot(workspace));
        }
      }

      if (resource === 'clips' && id && uuidPattern.test(id)) {
        if (method === 'PUT' && !action) {
          const exerciseId = url.searchParams.get('exercise');
          const mime = req.headers['content-type']?.split(';')[0];
          requireValue(exercisesById.has(exerciseId), 'Choose an exercise first.');
          requireValue(videoTypes.has(mime), 'Choose an MP4 or WebM video.', 415);
          let filename;
          try {
            filename = decodeURIComponent(req.headers['x-clip-name'] ?? '').replace(/[\u0000-\u001f/\\]/g, '').slice(0, 120);
          } catch {
            throw new ApiError(400, 'Invalid file name.');
          }
          requireValue(filename, 'The video needs a file name.');
          const bytes = await readBytes(req, maxVideoBytes);
          requireValue(hasVideoSignature(mime, bytes), 'This file is not a supported video.', 415);
          store.addClip(workspace, { id, exerciseId, filename, mime, bytes });
          return json(res, 200, store.snapshot(workspace));
        }
        if (method === 'DELETE' && !action) {
          store.removeClip(workspace, id);
          return json(res, 200, store.snapshot(workspace));
        }
        if ((method === 'GET' || method === 'HEAD') && action === 'video') {
          return sendVideo(req, res, store, workspace, id);
        }
      }
      throw new ApiError(404, 'Endpoint not found.');
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (!(error instanceof ApiError)) console.error(error);
      json(res, error.status ?? 500, { error: error instanceof ApiError ? error.message : 'Something went wrong. Please try again.' });
    }
  };
}
