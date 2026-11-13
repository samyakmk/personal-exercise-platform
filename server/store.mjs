import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

function relativeDay(day, offset) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const movement = (exerciseId, reps = 10) => ({ exerciseId, sets: 3, reps });

export function createStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS workspace (
      id TEXT PRIMARY KEY,
      equipment TEXT
    );
    CREATE TABLE IF NOT EXISTS workout (
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('planned', 'completed')),
      exercises TEXT NOT NULL,
      PRIMARY KEY (workspace_id, id)
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
      PRIMARY KEY (workspace_id, id)
    );
  `);

  const statements = {
    workspace: db.prepare('SELECT * FROM workspace WHERE id = ?'),
    create: db.prepare('INSERT INTO workspace (id) VALUES (?)'),
    equipment: db.prepare('UPDATE workspace SET equipment = ? WHERE id = ?'),
    workouts: db.prepare('SELECT id, name, date, time, status, exercises FROM workout WHERE workspace_id = ? ORDER BY date, time, id'),
    insertWorkout: db.prepare('INSERT INTO workout VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, id) DO NOTHING'),
    updateWorkout: db.prepare('UPDATE workout SET name = ?, date = ?, time = ?, status = ?, exercises = ? WHERE workspace_id = ? AND id = ?'),
    removeWorkout: db.prepare('DELETE FROM workout WHERE workspace_id = ? AND id = ?'),
    clips: db.prepare('SELECT id, exerciseId, filename, mime, size, uploadedAt FROM clip WHERE workspace_id = ? ORDER BY uploadedAt DESC'),
    clip: db.prepare('SELECT mime, size FROM clip WHERE workspace_id = ? AND id = ?'),
    clipBytes: db.prepare('SELECT substr(bytes, ?, ?) AS bytes FROM clip WHERE workspace_id = ? AND id = ?'),
    addClip: db.prepare('INSERT INTO clip VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, id) DO NOTHING'),
    removeClip: db.prepare('DELETE FROM clip WHERE workspace_id = ? AND id = ?'),
  };

  function createWorkspace(today) {
    const id = randomUUID();
    db.exec('BEGIN');
    try {
      statements.create.run(id);
      const examples = [
        [0, '17:30', 'Upper Body Strength', 'planned', [movement('dumbbell-bench-press'), movement('dumbbell-row', 12), movement('push-up')]],
        [2, '08:00', 'Lower Body Strength', 'planned', [movement('goblet-squat', 12), movement('reverse-lunge')]],
        [-1, '18:00', 'Full Body Foundations', 'completed', [movement('goblet-squat'), movement('push-up'), movement('forearm-plank', 30)]],
        [-3, '17:30', 'Upper Body Strength', 'completed', [movement('dumbbell-bench-press'), movement('dumbbell-row')]],
        [-5, '08:00', 'Core & Stability', 'completed', [movement('forearm-plank', 30), movement('reverse-lunge')]],
      ];
      for (const [offset, time, name, status, exercises] of examples) {
        statements.insertWorkout.run(id, randomUUID(), name, relativeDay(today, offset), time, status, JSON.stringify(exercises));
      }
      db.exec('COMMIT');
      return id;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    createWorkspace,
    workspace: (id) => statements.workspace.get(id),
    snapshot(id) {
      const { equipment } = statements.workspace.get(id);
      return {
        equipment: JSON.parse(equipment),
        workouts: statements.workouts.all(id).map((row) => ({ ...row, exercises: JSON.parse(row.exercises) })),
        clips: statements.clips.all(id),
      };
    },
    setEquipment: (id, value) => statements.equipment.run(JSON.stringify(value), id),
    insertWorkout: (workspace, { id, name, date, time, status, exercises }) => (
      statements.insertWorkout.run(workspace, id, name, date, time, status, JSON.stringify(exercises))
    ),
    updateWorkout: (workspace, id, { name, date, time, status, exercises }) => (
      statements.updateWorkout.run(name, date, time, status, JSON.stringify(exercises), workspace, id)
    ),
    removeWorkout: (workspace, id) => statements.removeWorkout.run(workspace, id),
    clip: (workspace, id) => statements.clip.get(workspace, id),
    clipBytes: (workspace, id, start, length) => statements.clipBytes.get(start + 1, length, workspace, id).bytes,
    addClip: (workspace, { id, exerciseId, filename, mime, bytes }) => (
      statements.addClip.run(workspace, id, exerciseId, filename, mime, bytes.length, new Date().toISOString(), bytes)
    ),
    removeClip: (workspace, id) => statements.removeClip.run(workspace, id),
    close: () => db.close(),
  };
}
