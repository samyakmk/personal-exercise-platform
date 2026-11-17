import { createHash, randomUUID } from 'node:crypto';

export const hashBrowserToken = (token) => createHash('sha256').update(token).digest('hex');

// Keep the original draft and in-progress session keys when adopting an older workspace.
export const workspaceKeyFor = (id) => createHash('sha256').update('repform-local-drafts:' + id).digest('hex').slice(0, 24);

export const localProfileSchema = `
    CREATE TABLE IF NOT EXISTS local_browser (
      id TEXT PRIMARY KEY,
      active_workspace TEXT REFERENCES workspace(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS local_profile (
      workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
      browser_id TEXT NOT NULL REFERENCES local_browser(id),
      username TEXT NOT NULL COLLATE NOCASE,
      details TEXT NOT NULL DEFAULT '{}',
      setup_pending INTEGER NOT NULL DEFAULT 0,
      UNIQUE (browser_id, username)
    );
    CREATE TABLE IF NOT EXISTS profile_revision (
      id INTEGER PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      saved_at TEXT NOT NULL,
      details TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS profile_revision_recent ON profile_revision (workspace_id, id DESC);
`;

export function createLocalProfiles(db) {
  const browser = db.prepare(`SELECT profile.workspace_id AS workspace FROM local_browser AS browser
    LEFT JOIN local_profile AS profile ON profile.browser_id = browser.id AND profile.workspace_id = browser.active_workspace
    WHERE browser.id = ?`);
  const roster = db.prepare(`SELECT workspace_id AS workspace, username, details, setup_pending AS "setupPending"
    FROM local_profile WHERE browser_id = ? ORDER BY username`);
  const byUsername = db.prepare('SELECT workspace_id AS workspace FROM local_profile WHERE browser_id = ? AND username = ?');
  const unclaimed = db.prepare(`SELECT id FROM workspace WHERE id = ?
    AND NOT EXISTS (SELECT 1 FROM local_profile WHERE workspace_id = workspace.id)`);
  const insertBrowser = db.prepare('INSERT INTO local_browser (id) VALUES (?) ON CONFLICT DO NOTHING');
  const insertProfile = db.prepare('INSERT INTO local_profile (workspace_id, browser_id, username, setup_pending) VALUES (?, ?, ?, ?)');
  const insertWorkspace = db.prepare('INSERT INTO workspace (id) VALUES (?)');
  const setActive = db.prepare('UPDATE local_browser SET active_workspace = ? WHERE id = ?');
  const profileDetails = db.prepare('SELECT details, setup_pending AS "setupPending" FROM local_profile WHERE workspace_id = ?');
  const setDetails = db.prepare('UPDATE local_profile SET details = ? WHERE workspace_id = ? AND browser_id = ?');
  const clearSetup = db.prepare('UPDATE local_profile SET setup_pending = 0 WHERE workspace_id = ?');
  const setEquipment = db.prepare('UPDATE workspace SET equipment = ? WHERE id = ?');
  const revisions = db.prepare('SELECT id, saved_at AS "savedAt", details FROM profile_revision WHERE workspace_id = ? ORDER BY id DESC LIMIT 50');
  const lastRevision = db.prepare('SELECT id FROM profile_revision WHERE workspace_id = ? LIMIT 1');
  const addRevision = db.prepare('INSERT INTO profile_revision (workspace_id, saved_at, details) VALUES (?, ?, ?)');
  const deleteWorkspace = db.prepare('DELETE FROM workspace WHERE id = ?');

  const adoptable = async (legacy) => Boolean(legacy && await unclaimed.get(legacy));
  const active = async (id) => id ? (await browser.get(id))?.workspace ?? null : null;

  async function saveDetails(id, workspace, previous, details) {
    const next = JSON.stringify({ ...JSON.parse(previous), ...details });
    if (previous === next) return;
    const savedAt = new Date().toISOString();
    if (previous !== '{}' && !(await lastRevision.get(workspace))) await addRevision.run(workspace, savedAt, previous);
    await setDetails.run(next, workspace, id);
    await addRevision.run(workspace, savedAt, next);
  }

  return {
    hasBrowser: async (id) => Boolean(id && await browser.get(id)),
    active,
    details: async (workspace) => JSON.parse((await profileDetails.get(workspace))?.details ?? '{}'),
    history: async (workspace) => (await revisions.all(workspace)).map(({ details, ...row }) => ({ ...row, details: JSON.parse(details) })),
    state(id, legacy) {
      return db.transaction(false, async () => {
        const selected = await active(id);
        const profiles = id ? await roster.all(id) : [];
        const current = profiles.find(({ workspace }) => workspace === selected);
        return {
          active: current ? {
            workspaceKey: workspaceKeyFor(current.workspace), username: current.username, details: JSON.parse(current.details),
            ...(current.setupPending && { setupPending: true }),
          } : null,
          profiles: profiles.map(({ workspace, username }) => ({ workspaceKey: workspaceKeyFor(workspace), username })),
          canImportLegacy: profiles.length === 0 && await adoptable(legacy),
        };
      });
    },
    create(id, username, legacy, setup = false) {
      return db.transaction(true, async () => {
        if (await active(id)) return 'active';
        if (await byUsername.get(id, username)) return 'duplicate';
        // Claim legacy data at most once. A claimed workspace can never be selected with its old cookie.
        const adopt = (await roster.all(id)).length === 0 && await adoptable(legacy);
        const workspace = adopt ? legacy : randomUUID();
        await insertBrowser.run(id);
        if (!adopt) await insertWorkspace.run(workspace);
        await insertProfile.run(workspace, id, username, Number(setup));
        await setActive.run(workspace, id);
        return 'created';
      });
    },
    signIn(id, username) {
      return db.transaction(true, async () => {
        if (await active(id)) return 'active';
        const profile = await byUsername.get(id, username);
        if (!profile) return 'missing';
        await setActive.run(profile.workspace, id);
        return 'selected';
      });
    },
    completeSetup(id, expected, details, equipment) {
      return db.transaction(true, async () => {
        if (await active(id) !== expected) return false;
        const profile = await profileDetails.get(expected);
        if (!profile.setupPending) return true;
        await saveDetails(id, expected, profile.details, details);
        if (equipment !== undefined) await setEquipment.run(JSON.stringify(equipment), expected);
        await clearSetup.run(expected);
        return true;
      });
    },
    changeActive(id, expected, operation, details) {
      return db.transaction(true, async () => {
        if (await active(id) !== expected) return false;
        if (operation === 'logout') await setActive.run(null, id);
        else if (operation === 'update') await saveDetails(id, expected, (await profileDetails.get(expected)).details, details);
        // Ownership, the active selection, and all user data are removed together by the foreign keys.
        else if (operation === 'delete') await deleteWorkspace.run(expected);
        return true;
      });
    },
  };
}
