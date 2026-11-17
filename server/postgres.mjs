import pg from 'pg';
import { checkInSchema } from './check-ins.mjs';
import { postgresQueries } from './database.mjs';
import { googleProfileSchema } from './google-profiles.mjs';
import { localProfileSchema } from './local-profiles.mjs';
import { addedColumns, coreIndexes, coreSchema, createDataStore } from './store.mjs';

const workspaceRevision = "replace(gen_random_uuid()::text, '-', '')";
const snapshotColumns = {
  workout: 'workspace_id, id, name, date, time, status, exercises, notes, is_example, revision, effort, source',
  exercise_bookmark: 'workspace_id, exercise_id',
  clip: 'workspace_id, id, exerciseId, filename, mime, size, uploadedAt',
  clip_review: 'workspace_id, clip_id, review',
  clip_review_attempt: 'workspace_id, clip_id, version, sequence, start_seconds, error, lease_owner',
  training_note: 'workspace_id, id, text, kind, exercise_id, saved_at',
};

const schema = coreSchema.replaceAll(' BLOB', ' BYTEA').replace('lease_until INTEGER', 'lease_until BIGINT')
  + addedColumns.map(([table, column, type]) => `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${column === 'lease_until' ? 'BIGINT' : type};`).join('\n')
  + coreIndexes + localProfileSchema.replace(' COLLATE NOCASE', '').replace('id INTEGER PRIMARY KEY,', 'id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,')
  + checkInSchema + googleProfileSchema + `
    ALTER TABLE training_check_in ADD COLUMN IF NOT EXISTS rowid BIGINT GENERATED ALWAYS AS IDENTITY;
    ALTER TABLE training_note ADD COLUMN IF NOT EXISTS rowid BIGINT GENERATED ALWAYS AS IDENTITY;
    ALTER TABLE workspace ALTER COLUMN snapshot_revision SET DEFAULT ${workspaceRevision};
    CREATE FUNCTION trainer_plus_equipment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.equipment IS DISTINCT FROM NEW.equipment THEN
        NEW.snapshot_revision := ${workspaceRevision};
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER workspace_equipment_revision BEFORE UPDATE OF equipment ON workspace
      FOR EACH ROW EXECUTE FUNCTION trainer_plus_equipment_revision();
    CREATE FUNCTION trainer_plus_touch_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        UPDATE workspace SET snapshot_revision = ${workspaceRevision} WHERE id = OLD.workspace_id;
      ELSE
        UPDATE workspace SET snapshot_revision = ${workspaceRevision} WHERE id = NEW.workspace_id;
      END IF;
      RETURN NULL;
    END;
    $$;
    ${Object.entries(snapshotColumns).map(([table, columns]) => `
      CREATE TRIGGER ${table}_snapshot AFTER INSERT OR UPDATE OF ${columns} OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION trainer_plus_touch_workspace();
    `).join('\n')}
    CREATE TABLE IF NOT EXISTS media_deletion (
      key TEXT PRIMARY KEY
    );
    CREATE FUNCTION trainer_plus_delete_media() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.size > 0 AND OLD.representation IS NOT NULL THEN
        INSERT INTO media_deletion (key) VALUES (OLD.workspace_id || '/' || OLD.id || '/' || OLD.representation)
          ON CONFLICT DO NOTHING;
      END IF;
      RETURN NULL;
    END;
    $$;
    CREATE TRIGGER clip_storage_cleanup AFTER DELETE ON clip
      FOR EACH ROW EXECUTE FUNCTION trainer_plus_delete_media();
  `;

export async function openPostgresStore(options, media) {
  const pool = new pg.Pool({
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 90_000,
    types: { getTypeParser: (oid, format) => oid === 20 && format === 'text' ? Number : pg.types.getTypeParser(oid, format) },
    ...options,
  });
  pool.on('error', () => console.error('A background database connection was closed.'));
  const db = postgresQueries(pool);
  try {
    await db.transaction(true, async () => {
      await db.query((connection) => connection.exec('CREATE TABLE IF NOT EXISTS trainer_plus_schema (version INTEGER PRIMARY KEY)'));
      const version = await db.prepare('SELECT version FROM trainer_plus_schema WHERE version = 1').get();
      if (version) return;
      await db.query((connection) => connection.exec(schema));
      await db.prepare('INSERT INTO trainer_plus_schema (version) VALUES (1)').run();
    });
    return createDataStore(db, media);
  } catch (error) {
    await pool.end();
    throw error;
  }
}
