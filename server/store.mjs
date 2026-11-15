import { DatabaseSync } from 'node:sqlite';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createLocalProfiles } from './local-profiles.mjs';
import { createCheckIns } from './check-ins.mjs';
import { trainingBackupFormat } from '../shared/training-backup.mjs';

const chunkSize = 256 * 1024;
const reviewHistoryLimit = 10;
const leaseClock = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const reviewColumns = `clip_review.review, attempt.version AS attemptVersion, attempt.sequence AS attemptSequence,
  attempt.error AS attemptError, attempt.error_status AS attemptErrorStatus, attempt.start_seconds AS attemptStart,
  attempt.lease_owner AS attemptOwner, attempt.lease_until AS attemptUntil`;
const clipReviewQuery = `FROM clip LEFT JOIN clip_review ON clip.workspace_id = clip_review.workspace_id AND clip.id = clip_review.clip_id
  LEFT JOIN clip_review_attempt AS attempt ON clip.workspace_id = attempt.workspace_id AND clip.id = attempt.clip_id`;
const clipColumns = `clip.id, exerciseId, filename, mime, size, uploadedAt, ${reviewColumns}`;
const revisionValue = 'lower(hex(randomblob(16)))';

function workspaceRevisionTriggers() {
  // Expiry is checked at read time. Lease heartbeats do not change the public snapshot.
  const updateColumns = {
    workout: 'workspace_id, id, name, date, time, status, exercises, notes, is_example, revision, effort, source',
    exercise_bookmark: 'workspace_id, exercise_id',
    clip: 'workspace_id, id, exerciseId, filename, mime, size, uploadedAt',
    clip_review: 'workspace_id, clip_id, review',
    clip_review_attempt: 'workspace_id, clip_id, version, sequence, start_seconds, error, lease_owner',
  };
  return Object.entries(updateColumns).map(([table, columns]) => `
    CREATE TRIGGER IF NOT EXISTS ${table}_snapshot_insert AFTER INSERT ON ${table} BEGIN
      UPDATE workspace SET snapshot_revision = ${revisionValue} WHERE id = NEW.workspace_id;
    END;
    CREATE TRIGGER IF NOT EXISTS ${table}_snapshot_update AFTER UPDATE OF ${columns} ON ${table} BEGIN
      UPDATE workspace SET snapshot_revision = ${revisionValue} WHERE id IN (OLD.workspace_id, NEW.workspace_id);
    END;
    CREATE TRIGGER IF NOT EXISTS ${table}_snapshot_delete AFTER DELETE ON ${table} BEGIN
      UPDATE workspace SET snapshot_revision = ${revisionValue} WHERE id = OLD.workspace_id;
    END;
  `).join('\n');
}

function reviewFields({ review, attemptVersion, attemptSequence, attemptError, attemptErrorStatus, attemptStart, attemptOwner, attemptUntil }) {
  return {
    review: JSON.parse(review),
    attempt: { version: attemptVersion, sequence: attemptSequence, error: attemptError, errorStatus: attemptErrorStatus,
      startSeconds: attemptStart, owner: attemptOwner, until: attemptUntil },
  };
}

function clipRecord(row) {
  const { id, exerciseId, filename, mime, size, uploadedAt } = row;
  return { id, exerciseId, filename, mime, size, uploadedAt, ...reviewFields(row) };
}

function relativeDay(day, offset) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const movement = (exerciseId, reps = 10) => ({ exerciseId, sets: 3, reps });

export function createStore(path) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try { closeSync(openSync(path, 'wx', 0o600)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 2500;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS workspace (
      id TEXT PRIMARY KEY,
      equipment TEXT,
      snapshot_revision TEXT
    );
    CREATE TABLE IF NOT EXISTS workout (
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('planned', 'completed')),
      exercises TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      is_example INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE IF NOT EXISTS workout_series_receipt (
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      digest TEXT NOT NULL,
      PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE IF NOT EXISTS workout_edit_receipt (
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      digest TEXT NOT NULL,
      PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE IF NOT EXISTS exercise_bookmark (
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      exercise_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, exercise_id)
    );
    CREATE TABLE IF NOT EXISTS clip (
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      exerciseId TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploadedAt TEXT NOT NULL,
      bytes BLOB NOT NULL,
      digest TEXT,
      representation TEXT,
      PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE IF NOT EXISTS clip_review (
      workspace_id TEXT NOT NULL,
      clip_id TEXT NOT NULL,
      review TEXT NOT NULL,
      PRIMARY KEY (workspace_id, clip_id),
      FOREIGN KEY (workspace_id, clip_id) REFERENCES clip(workspace_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS clip_deletion (
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE IF NOT EXISTS clip_review_history (
      workspace_id TEXT NOT NULL,
      clip_id TEXT NOT NULL,
      start_seconds INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      review TEXT NOT NULL,
      PRIMARY KEY (workspace_id, clip_id, start_seconds),
      FOREIGN KEY (workspace_id, clip_id) REFERENCES clip(workspace_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS clip_payload (
      workspace_id TEXT NOT NULL,
      clip_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      bytes BLOB NOT NULL,
      PRIMARY KEY (workspace_id, clip_id, position),
      FOREIGN KEY (workspace_id, clip_id) REFERENCES clip(workspace_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS clip_review_attempt (
      workspace_id TEXT NOT NULL,
      clip_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      start_seconds INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      error_status INTEGER,
      lease_owner TEXT,
      lease_until INTEGER,
      PRIMARY KEY (workspace_id, clip_id),
      FOREIGN KEY (workspace_id, clip_id) REFERENCES clip(workspace_id, id) ON DELETE CASCADE
    );
  `);
  const addedColumns = [
    ['workout', 'is_example', 'INTEGER NOT NULL DEFAULT 0'],
    ['workout', 'revision', 'INTEGER NOT NULL DEFAULT 1'],
    ['workout', 'notes', "TEXT NOT NULL DEFAULT ''"],
    ['workout', 'effort', 'INTEGER CHECK (effort IS NULL OR effort BETWEEN 1 AND 10)'],
    ['workout', 'source', "TEXT CHECK (source IS NULL OR source IN ('manual', 'trainer', 'recommended'))"],
    ['clip', 'digest', 'TEXT'],
    ['clip_review_attempt', 'start_seconds', 'INTEGER NOT NULL DEFAULT 0'],
    ['clip_review_attempt', 'error_status', 'INTEGER'],
    ['clip_review_attempt', 'lease_owner', 'TEXT'],
    ['clip_review_attempt', 'lease_until', 'INTEGER'],
  ];
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('PRAGMA table_info(workspace)').all().some(({ name }) => name === 'snapshot_revision')) {
      db.exec(`ALTER TABLE workspace ADD COLUMN snapshot_revision TEXT;
        UPDATE workspace SET snapshot_revision = ${revisionValue};`);
    }
    for (const [table, column, type] of addedColumns) {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some(({ name }) => name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    }
    if (!db.prepare('PRAGMA table_info(clip)').all().some(({ name }) => name === 'representation')) {
      db.exec(`ALTER TABLE clip ADD COLUMN representation TEXT;
        UPDATE clip SET representation = ${revisionValue};`);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS workout_schedule ON workout (workspace_id, date, time, id);
      CREATE INDEX IF NOT EXISTS personal_completed_workout ON workout (workspace_id, date DESC, time DESC, id DESC)
        WHERE status = 'completed' AND is_example = 0;
      CREATE INDEX IF NOT EXISTS clip_upload_order ON clip (workspace_id, uploadedAt DESC, id DESC);
      CREATE INDEX IF NOT EXISTS clip_representation_lookup ON clip (workspace_id, id, representation);
      CREATE INDEX IF NOT EXISTS review_lease_expiry ON clip_review_attempt (lease_until) WHERE lease_until IS NOT NULL;
      CREATE TRIGGER IF NOT EXISTS workspace_snapshot_insert AFTER INSERT ON workspace WHEN NEW.snapshot_revision IS NULL BEGIN
        UPDATE workspace SET snapshot_revision = ${revisionValue} WHERE id = NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS workspace_snapshot_equipment AFTER UPDATE OF equipment ON workspace
      WHEN OLD.equipment IS NOT NEW.equipment BEGIN
        UPDATE workspace SET snapshot_revision = ${revisionValue} WHERE id = NEW.id;
      END;
      ${workspaceRevisionTriggers()}
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }

  const profiles = createLocalProfiles(db);
  const checkIns = createCheckIns(db);
  const statements = {
    workspaceRevision: db.prepare('SELECT snapshot_revision AS revision FROM workspace WHERE id = ?'),
    liveReviewIds: db.prepare('SELECT clip_id AS id FROM clip_review_attempt WHERE lease_until > ? AND workspace_id = ? ORDER BY clip_id'),
    getEquipment: db.prepare('SELECT equipment FROM workspace WHERE id = ?'),
    equipment: db.prepare('UPDATE workspace SET equipment = ? WHERE id = ?'),
    importEquipment: db.prepare('UPDATE workspace SET equipment = ? WHERE id = ? AND equipment IS NULL'),
    bookmarks: db.prepare('SELECT exercise_id AS id FROM exercise_bookmark WHERE workspace_id = ? ORDER BY exercise_id'),
    addBookmark: db.prepare('INSERT OR IGNORE INTO exercise_bookmark (workspace_id, exercise_id) VALUES (?, ?)'),
    removeBookmark: db.prepare('DELETE FROM exercise_bookmark WHERE workspace_id = ? AND exercise_id = ?'),
    workouts: db.prepare('SELECT id, name, date, time, status, notes, exercises, is_example, revision, effort, source FROM workout WHERE workspace_id = ? ORDER BY date, time, id'),
    backupWorkouts: db.prepare(`SELECT id, name, date, time, status, notes, exercises, effort, source FROM workout
      WHERE workspace_id = ? AND is_example = 0 AND date >= ? AND date < ? ORDER BY date, time, id LIMIT ?`),
    workoutsById: db.prepare(`SELECT workout.id, name, date, time, status, notes, exercises, is_example, revision, effort, source
      FROM json_each(?) AS ids CROSS JOIN workout ON workout.workspace_id = ? AND workout.id = ids.value
      ORDER BY date, time, workout.id`),
    workoutRevision: db.prepare('SELECT revision FROM workout WHERE workspace_id = ? AND id = ?'),
    recentWorkouts: db.prepare(`
      SELECT exercises FROM workout WHERE workspace_id = ? AND status = 'completed' AND is_example = 0
      AND (date < ? OR (date = ? AND time <= ?))
      ORDER BY date DESC, time DESC, id DESC LIMIT 5
    `),
    insertWorkout: db.prepare(`
      INSERT INTO workout (workspace_id, id, name, date, time, status, exercises, is_example, notes, effort, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, id) DO NOTHING
    `),
    existingWorkout: db.prepare('SELECT name, date, time, status, notes, exercises, effort, source FROM workout WHERE workspace_id = ? AND id = ?'),
    workoutSeries: db.prepare('SELECT digest FROM workout_series_receipt WHERE workspace_id = ? AND id = ?'),
    addWorkoutSeries: db.prepare('INSERT INTO workout_series_receipt (workspace_id, id, digest) VALUES (?, ?, ?)'),
    workoutEdit: db.prepare('SELECT digest FROM workout_edit_receipt WHERE workspace_id = ? AND id = ?'),
    addWorkoutEdit: db.prepare('INSERT INTO workout_edit_receipt (workspace_id, id, digest) VALUES (?, ?, ?)'),
    updateWorkout: db.prepare(`
      UPDATE workout SET name = ?, date = ?, time = ?, status = ?, exercises = ?, notes = COALESCE(?, notes),
      effort = CASE WHEN ? IS NOT NULL THEN ? WHEN ? = 'planned' THEN NULL ELSE effort END,
      source = COALESCE(?, source), is_example = 0, revision = revision + 1
      WHERE workspace_id = ? AND id = ? AND (revision = ? OR ? IS NULL)
    `),
    removeWorkout: db.prepare('DELETE FROM workout WHERE workspace_id = ? AND id = ? AND (revision = ? OR ? IS NULL)'),
    removeExampleWorkouts: db.prepare('DELETE FROM workout WHERE workspace_id = ? AND is_example = 1'),
    calendarWorkout: db.prepare(`SELECT id, name, date, time, notes, exercises FROM workout
      WHERE workspace_id = ? AND id = ? AND status = 'planned' AND is_example = 0`),
    calendarWorkouts: db.prepare(`SELECT id, name, date, time, notes, exercises FROM workout
      WHERE workspace_id = ? AND status = 'planned' AND is_example = 0 ORDER BY date, time, id`),
    historyWorkouts: db.prepare(`SELECT name, date, time, notes, exercises, effort, source FROM workout
      WHERE workspace_id = ? AND status = 'completed' AND is_example = 0 ORDER BY date DESC, time DESC, id DESC`),
    clips: db.prepare(`
      SELECT ${clipColumns} ${clipReviewQuery}
      WHERE clip.workspace_id = ? ORDER BY uploadedAt DESC, clip.id DESC
    `),
    clipRecord: db.prepare(`SELECT ${clipColumns} ${clipReviewQuery} WHERE clip.workspace_id = ? AND clip.id = ?`),
    clip: db.prepare('SELECT mime, size, exerciseId, filename, digest, representation, length(bytes) = 0 AS chunked FROM clip WHERE workspace_id = ? AND id = ?'),
    deletedClip: db.prepare('SELECT 1 FROM clip_deletion WHERE workspace_id = ? AND id = ?'),
    markDeletedClip: db.prepare('INSERT OR IGNORE INTO clip_deletion (workspace_id, id) VALUES (?, ?)'),
    relabelClip: db.prepare(`UPDATE clip SET exerciseId = ? WHERE workspace_id = ? AND id = ? AND exerciseId = ?
      AND NOT EXISTS (SELECT 1 FROM clip_review_attempt WHERE workspace_id = clip.workspace_id AND clip_id = clip.id AND lease_until > ${leaseClock})`),
    clipBytes: db.prepare('SELECT substr(bytes, ?, ?) AS bytes FROM clip WHERE workspace_id = ? AND id = ? AND representation IS ?'),
    clipRepresentation: db.prepare(`SELECT 1 FROM clip INDEXED BY clip_representation_lookup
      WHERE workspace_id = ? AND id = ? AND representation IS ?`),
    addClip: db.prepare(`
      INSERT INTO clip (workspace_id, id, exerciseId, filename, mime, size, uploadedAt, bytes, digest, representation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${revisionValue}) ON CONFLICT (workspace_id, id) DO NOTHING
    `),
    addClipChunk: db.prepare('INSERT INTO clip_payload (workspace_id, clip_id, position, bytes) VALUES (?, ?, ?, ?)'),
    clipChunk: db.prepare(`SELECT payload.bytes FROM clip_payload AS payload
      JOIN clip ON clip.workspace_id = payload.workspace_id AND clip.id = payload.clip_id
      WHERE payload.workspace_id = ? AND payload.clip_id = ? AND payload.position = ? AND clip.representation IS ?`),
    setClipDigest: db.prepare('UPDATE clip SET digest = ? WHERE workspace_id = ? AND id = ?'),
    reviewState: db.prepare(`SELECT ${reviewColumns} ${clipReviewQuery} WHERE clip.workspace_id = ? AND clip.id = ?`),
    activeReviewCount: db.prepare(`SELECT count(*) AS count FROM clip_review_attempt WHERE lease_until > ${leaseClock}`),
    startReviewAttempt: db.prepare(`
      INSERT INTO clip_review_attempt (workspace_id, clip_id, version, sequence, start_seconds, lease_owner, lease_until)
      VALUES (?, ?, ?, 1, ?, ?, ${leaseClock} + ?)
      ON CONFLICT (workspace_id, clip_id) DO UPDATE SET version = excluded.version,
        sequence = sequence + 1, start_seconds = excluded.start_seconds, error = NULL, error_status = NULL,
        lease_owner = excluded.lease_owner, lease_until = excluded.lease_until
      RETURNING sequence
    `),
    renewReviewLease: db.prepare(`UPDATE clip_review_attempt SET lease_until = ${leaseClock} + ?
      WHERE workspace_id = ? AND clip_id = ? AND sequence = ? AND lease_owner = ? AND lease_until > ${leaseClock}`),
    finishReviewAttempt: db.prepare(`UPDATE clip_review_attempt SET lease_until = NULL, error = ?, error_status = ?
      WHERE workspace_id = ? AND clip_id = ? AND sequence = ? AND lease_owner = ? AND lease_until > ${leaseClock}`),
    abandonReviewAttempt: db.prepare(`UPDATE clip_review_attempt SET lease_until = NULL, error = ?, error_status = 503
      WHERE workspace_id = ? AND clip_id = ? AND sequence = ? AND lease_owner = ? AND lease_until IS NOT NULL
    `),
    resetReviewAttempt: db.prepare(`
      INSERT INTO clip_review_attempt (workspace_id, clip_id, version, sequence) VALUES (?, ?, 0, 1)
      ON CONFLICT (workspace_id, clip_id) DO UPDATE SET version = 0,
        sequence = sequence + 1, start_seconds = 0, error = NULL, error_status = NULL, lease_owner = NULL, lease_until = NULL
    `),
    removeReview: db.prepare('DELETE FROM clip_review WHERE workspace_id = ? AND clip_id = ?'),
    saveReview: db.prepare(`
      INSERT INTO clip_review (workspace_id, clip_id, review) VALUES (?, ?, ?)
      ON CONFLICT (workspace_id, clip_id) DO UPDATE SET review = excluded.review
    `),
    reviewHistory: db.prepare(`
      WITH current AS (
        SELECT clip_review.review FROM clip LEFT JOIN clip_review
        ON clip.workspace_id = clip_review.workspace_id AND clip.id = clip_review.clip_id
        WHERE clip.workspace_id = ? AND clip.id = ?
      )
      SELECT review, 0 AS priority, 0 AS sequence FROM current
      UNION ALL
      SELECT history.review, 1 AS priority, history.sequence FROM clip_review_history AS history CROSS JOIN current
      WHERE history.workspace_id = ? AND history.clip_id = ?
        AND history.start_seconds IS NOT CASE WHEN current.review IS NOT NULL THEN COALESCE(json_extract(current.review, '$.startSeconds'), 0) END
      ORDER BY priority, sequence DESC LIMIT ${reviewHistoryLimit}
    `),
    archivePreviousReview: db.prepare(`
      INSERT INTO clip_review_history (workspace_id, clip_id, start_seconds, sequence, review)
      SELECT workspace_id, clip_id, COALESCE(json_extract(review, '$.startSeconds'), 0), COALESCE(json_extract(review, '$.sequence'), 0), review
      FROM clip_review WHERE workspace_id = ? AND clip_id = ? AND COALESCE(json_extract(review, '$.startSeconds'), 0) <> ?
      ON CONFLICT (workspace_id, clip_id, start_seconds) DO UPDATE SET sequence = excluded.sequence, review = excluded.review
    `),
    removeArchivedSection: db.prepare('DELETE FROM clip_review_history WHERE workspace_id = ? AND clip_id = ? AND start_seconds = ?'),
    trimReviewHistory: db.prepare(`DELETE FROM clip_review_history WHERE workspace_id = ? AND clip_id = ? AND start_seconds IN (
      SELECT start_seconds FROM clip_review_history WHERE workspace_id = ? AND clip_id = ?
      ORDER BY sequence DESC, start_seconds DESC LIMIT -1 OFFSET ${reviewHistoryLimit - 1}
    )`),
    removeReviewHistory: db.prepare('DELETE FROM clip_review_history WHERE workspace_id = ? AND clip_id = ?'),
    removeClip: db.prepare('DELETE FROM clip WHERE workspace_id = ? AND id = ?'),
  };

  function addExampleWorkouts(id, today) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (statements.workouts.get(id)) {
        db.exec('COMMIT');
        return;
      }
      const examples = [
        [0, '17:30', 'Upper Body Strength', 'planned', [movement('dumbbell-bench-press'), movement('dumbbell-row', 12), movement('push-up')]],
        [2, '08:00', 'Lower Body Strength', 'planned', [movement('goblet-squat', 12), movement('reverse-lunge')]],
        [-1, '18:00', 'Full Body Foundations', 'completed', [movement('goblet-squat'), movement('push-up'), movement('forearm-plank', 30)]],
        [-3, '17:30', 'Upper Body Strength', 'completed', [movement('dumbbell-bench-press'), movement('dumbbell-row')]],
        [-5, '08:00', 'Core & Stability', 'completed', [movement('forearm-plank', 30), movement('reverse-lunge')]],
      ];
      for (const [offset, time, name, status, exercises] of examples) {
        statements.insertWorkout.run(id, randomUUID(), name, relativeDay(today, offset), time, status, JSON.stringify(exercises), 1, '', null, null);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function* clipChunks(workspace, id, clip, start, length) {
    const end = start + length;
    if (!clip.chunked) {
      // SQLite can materialize the legacy BLOB even for a small substr(). Read the range once.
      const result = statements.clipBytes.get(start + 1, length, workspace, id, clip.representation);
      if (!result) return;
      for (let offset = 0; offset < result.bytes.length; offset += chunkSize) {
        if (offset && !statements.clipRepresentation.get(workspace, id, clip.representation)) return;
        yield result.bytes.subarray(offset, offset + chunkSize);
      }
      return;
    }
    for (let position = start; position < end;) {
      const index = Math.floor(position / chunkSize);
      const result = statements.clipChunk.get(workspace, id, index, clip.representation);
      if (!result) return;
      const from = position % chunkSize;
      const part = result.bytes.subarray(from, from + end - position);
      if (!part.length) return;
      yield part;
      position += part.length;
    }
  }

  function addClip(workspace, { id, exerciseId, filename, mime, bytes, digest, rejectDeleted }) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (rejectDeleted && statements.deletedClip.get(workspace, id)) {
        db.exec('COMMIT');
        return { changes: 0, deleted: true };
      }
      const result = statements.addClip.run(workspace, id, exerciseId, filename, mime, bytes.length, new Date().toISOString(), Buffer.alloc(0), digest);
      if (result.changes) {
        for (let start = 0; start < bytes.length; start += chunkSize) {
          statements.addClipChunk.run(workspace, id, start / chunkSize, bytes.subarray(start, start + chunkSize));
        }
      }
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function workoutRecord({ is_example, exercises, notes, effort, source, ...row }) {
    return { ...row, exercises: JSON.parse(exercises), ...(notes && { notes }), ...(effort != null && { effort }), ...(source && { source }), ...(is_example ? { example: true } : {}) };
  }

  function workouts(id) {
    return statements.workouts.all(id).map(workoutRecord);
  }

  const bookmarks = (id) => statements.bookmarks.all(id).map((row) => row.id);

  function insertWorkout(workspace, { id, name, date, time, status, exercises, notes = '', effort = null, source = null }) {
    if (statements.workoutSeries.get(workspace, id)) return false;
    const serialized = JSON.stringify(exercises);
    const insert = statements.insertWorkout.run(workspace, id, name, date, time, status, serialized, 0, notes, effort, source);
    if (insert.changes) return true;
    const current = statements.existingWorkout.get(workspace, id);
    return current?.name === name && current.date === date && current.time === time
      && current.status === status && current.exercises === serialized && current.notes === notes && current.effort === effort && current.source === source;
  }

  function updateWorkout(workspace, id, { name, date, time, status, exercises, notes, effort, source }, revision, operationId) {
    const values = [name, date, time, status, JSON.stringify(exercises), notes ?? null];
    const update = () => {
      const result = statements.updateWorkout.run(...values, effort === undefined ? null : 1, effort ?? null, status, source ?? null, workspace, id, revision, revision);
      if (result.changes) return 'saved';
      return statements.workoutRevision.get(workspace, id) ? 'conflict' : 'missing';
    };
    if (!operationId) return update();

    const digest = createHash('sha256').update(JSON.stringify([id, revision, values, ...(effort !== undefined || source !== undefined ? [{ effort, source }] : [])])).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      const receipt = statements.workoutEdit.get(workspace, operationId);
      let outcome;
      if (receipt) {
        outcome = receipt.digest === digest ? 'saved' : 'operation_conflict';
      } else {
        outcome = update();
        if (outcome === 'saved') statements.addWorkoutEdit.run(workspace, operationId, digest);
      }
      db.exec('COMMIT');
      return outcome;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    profiles,
    checkIns,
    addExampleWorkouts,
    removeExampleWorkouts: (id) => statements.removeExampleWorkouts.run(id),
    readWorkspace(id, read) {
      db.exec('BEGIN');
      try {
        const workspace = statements.workspaceRevision.get(id);
        const now = Date.now();
        const liveReviews = workspace ? statements.liveReviewIds.all(now, id).map(({ id }) => id) : [];
        const result = read(workspace?.revision, liveReviews, now);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    equipment: (id) => JSON.parse(statements.getEquipment.get(id).equipment),
    bookmarks,
    recentWorkouts: (id, day, time) => statements.recentWorkouts.all(id, day, day, time).map(({ exercises }) => JSON.parse(exercises)),
    workouts,
    trainingBackup(workspace, { from, before, maxBytes, maxWorkouts }) {
      db.exec('BEGIN');
      try {
        const settings = { format: trainingBackupFormat, version: 1,
          equipment: JSON.parse(statements.getEquipment.get(workspace).equipment), bookmarks: bookmarks(workspace) };
        const parts = [JSON.stringify(settings).slice(0, -1) + ',"workouts":['];
        let length = Buffer.byteLength(parts[0]) + 2;
        let count = 0;
        for (const { id, name, date, time, status, notes, exercises, effort, source } of statements.backupWorkouts.iterate(workspace, from, before, maxWorkouts + 1)) {
          if (++count > maxWorkouts) break;
          const record = { id, name, date, time, status, notes: notes || undefined, exercises: JSON.parse(exercises),
            ...(effort != null && { effort }), ...(source && { source }) };
          const part = (count === 1 ? '' : ',') + JSON.stringify(record);
          length += Buffer.byteLength(part);
          if (length > maxBytes) break;
          parts.push(part);
        }
        db.exec('COMMIT');
        return length <= maxBytes && count <= maxWorkouts ? parts.join('') + ']}' : null;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    workoutChanges(workspace, ids) {
      const upsert = statements.workoutsById.all(JSON.stringify(ids), workspace).map(workoutRecord);
      const existing = new Set(upsert.map(({ id }) => id));
      return { upsert, remove: ids.filter((id) => !existing.has(id)) };
    },
    calendarWorkout(workspace, id) {
      const row = statements.calendarWorkout.get(workspace, id);
      return row && workoutRecord(row);
    },
    *calendarWorkouts(workspace) {
      // Buffer database rows once so a slow download doesn't hold a database reader open.
      for (const row of statements.calendarWorkouts.all(workspace)) yield workoutRecord(row);
    },
    *historyWorkouts(workspace) {
      // Capture one SQL snapshot before sending chunks. A slow download does not hold a database reader open.
      for (const row of statements.historyWorkouts.all(workspace)) yield workoutRecord(row);
    },
    snapshot(id) {
      const { equipment } = statements.getEquipment.get(id);
      return {
        equipment: JSON.parse(equipment),
        bookmarks: bookmarks(id),
        workouts: workouts(id),
        clips: statements.clips.all(id).map(clipRecord),
      };
    },
    setEquipment: (id, value) => statements.equipment.run(JSON.stringify(value), id),
    setBookmark: (id, exerciseId, saved) => (saved ? statements.addBookmark : statements.removeBookmark).run(id, exerciseId),
    insertWorkout,
    insertWorkoutSeries(workspace, series) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const first = series[0];
        const digest = createHash('sha256').update(JSON.stringify([first, series.length])).digest('hex');
        const receipt = statements.workoutSeries.get(workspace, first.id);
        if (receipt) {
          db.exec('COMMIT');
          return receipt.digest === digest;
        }
        const saved = series.every((workout) => !statements.existingWorkout.get(workspace, workout.id) && insertWorkout(workspace, workout));
        if (saved) statements.addWorkoutSeries.run(workspace, first.id, digest);
        db.exec(saved ? 'COMMIT' : 'ROLLBACK');
        return saved;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    importTrainingData(workspace, equipment, workouts, bookmarks) {
      db.exec('BEGIN IMMEDIATE');
      try {
        let added = 0;
        for (const workout of workouts) {
          if (statements.existingWorkout.get(workspace, workout.id)) continue;
          if (insertWorkout(workspace, workout)) added += 1;
        }
        const equipmentImported = equipment !== null && Boolean(statements.importEquipment.run(JSON.stringify(equipment), workspace).changes);
        const savedExercises = bookmarks.reduce((added, id) => added + statements.addBookmark.run(workspace, id).changes, 0);
        db.exec('COMMIT');
        return { added, skipped: workouts.length - added, equipmentImported, savedExercises };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    workoutRevision: (workspace, id) => statements.workoutRevision.get(workspace, id)?.revision,
    updateWorkout,
    removeWorkout: (workspace, id, revision = null) => statements.removeWorkout.run(workspace, id, revision, revision),
    clip: (workspace, id) => statements.clip.get(workspace, id),
    wasClipDeleted: (workspace, id) => Boolean(statements.deletedClip.get(workspace, id)),
    clipRecord(workspace, id) {
      const row = statements.clipRecord.get(workspace, id);
      return row && clipRecord(row);
    },
    relabelClip(workspace, id, exerciseId, previousExerciseId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = statements.relabelClip.run(exerciseId, workspace, id, previousExerciseId);
        if (result.changes) {
          statements.removeReview.run(workspace, id);
          statements.removeReviewHistory.run(workspace, id);
          statements.resetReviewAttempt.run(workspace, id);
        }
        db.exec('COMMIT');
        return Boolean(result.changes);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    clipChunks,
    clipDigest(workspace, id, clip) {
      if (clip.digest) return clip.digest;
      const hash = createHash('sha256');
      for (const chunk of clipChunks(workspace, id, clip, 0, clip.size)) hash.update(chunk);
      return hash.digest('hex');
    },
    addClip,
    setClipDigest: (workspace, id, digest) => statements.setClipDigest.run(digest, workspace, id),
    reviewState(workspace, id) {
      const row = statements.reviewState.get(workspace, id);
      return row && reviewFields(row);
    },
    reviewHistory(workspace, id) {
      const rows = statements.reviewHistory.all(workspace, id, workspace, id);
      if (!rows.length) return null;
      return rows.flatMap(({ review }) => review === null ? [] : [JSON.parse(review)]);
    },
    claimReview(workspace, id, { version, startSeconds, refresh, owner, leaseMs, maxActive, admit }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const clip = statements.clip.get(workspace, id);
        let claim = { state: 'missing' };
        if (clip) {
          const { review, attempt } = reviewFields(statements.reviewState.get(workspace, id));
          // Claim, limit check, and exercise read share the same SQLite write lock.
          if (attempt.until > Date.now()) claim = { state: 'running', review, attempt };
          else if (!refresh && !attempt.error && attempt.until == null && review?.version === version && (review.startSeconds ?? 0) === startSeconds
            && (attempt.sequence == null || (review.sequence ?? attempt.sequence) === attempt.sequence)) claim = { state: 'complete', review, attempt };
          else if (statements.activeReviewCount.get().count >= maxActive) claim = { state: 'busy' };
          else {
            const recordStart = admit();
            const attempt = statements.startReviewAttempt.get(workspace, id, version, startSeconds, owner, leaseMs);
            claim = { state: 'claimed', clip, review, attempt: { ...attempt, startSeconds, owner }, recordStart };
          }
        }
        db.exec('COMMIT');
        return claim;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    renewReviewLease(workspace, id, { sequence, owner }, leaseMs) {
      return Boolean(statements.renewReviewLease.run(leaseMs, workspace, id, sequence, owner).changes);
    },
    failReviewAttempt(workspace, id, { sequence, owner }, error, status) {
      return Boolean(statements.finishReviewAttempt.run(error, status, workspace, id, sequence, owner).changes);
    },
    abandonReviewAttempt(workspace, id, { sequence, owner }, error) {
      statements.abandonReviewAttempt.run(error, workspace, id, sequence, owner);
    },
    saveReview(workspace, id, attempt, review) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const saved = statements.finishReviewAttempt.run(null, null, workspace, id, attempt.sequence, attempt.owner);
        if (saved.changes) {
          statements.archivePreviousReview.run(workspace, id, review.startSeconds);
          statements.removeArchivedSection.run(workspace, id, review.startSeconds);
          statements.trimReviewHistory.run(workspace, id, workspace, id);
          statements.saveReview.run(workspace, id, JSON.stringify(review));
        }
        db.exec('COMMIT');
        return Boolean(saved.changes);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    removeClip(workspace, id) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const owner = statements.reviewState.get(workspace, id)?.attemptOwner;
        if (statements.removeClip.run(workspace, id).changes) statements.markDeletedClip.run(workspace, id);
        db.exec('COMMIT');
        return owner;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close(),
  };
}
