import { randomBytes, randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { hashBrowserToken } from './local-profiles.mjs';

export const googleSessionSeconds = 7 * 24 * 60 * 60;
export const googleChallengeSeconds = 300;
export const newGoogleToken = () => randomBytes(32).toString('hex');
export const googleTokenPattern = /^[a-f0-9]{64}$/;

export const googleProfileSchema = `
  CREATE TABLE IF NOT EXISTS google_account (
    subject TEXT PRIMARY KEY,
    browser_id TEXT NOT NULL UNIQUE REFERENCES local_browser(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS google_session (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL REFERENCES google_account(subject) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS google_session_expiry ON google_session (expires_at);
  CREATE TABLE IF NOT EXISTS google_challenge (
    id TEXT PRIMARY KEY,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS google_challenge_expiry ON google_challenge (expires_at);
`;

export function googleIdentity(clientId, allowedEmails = '') {
  if (!clientId) return;
  if (!/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('Set a valid Google sign-in client ID.');
  }
  const allowlist = new Set(allowedEmails.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (!allowlist.size) throw new Error('Set at least one allowed Google account.');
  const google = new OAuth2Client();
  return {
    clientId,
    async verify(credential, nonce) {
      const ticket = await google.verifyIdToken({ idToken: credential, audience: clientId });
      const claims = ticket.getPayload();
      if (!claims?.sub || claims.nonce !== nonce || claims.email_verified !== true || typeof claims.email !== 'string') return null;
      // Google can verify control of Gmail and Workspace addresses as the account provider.
      const email = claims.email.toLowerCase();
      if (!(email.endsWith('@gmail.com') || claims.hd) || !allowlist.has(email)) return null;
      return { subject: claims.sub, email, name: claims.name };
    },
  };
}

export function createGoogleProfiles(db, profiles, now = Date.now) {
  const readSession = db.prepare(`SELECT account.browser_id AS owner, session.expires_at AS "expiresAt"
    FROM google_session AS session JOIN google_account AS account ON account.subject = session.subject
    WHERE session.id = ? AND session.expires_at > ?`);
  const addSession = db.prepare('INSERT INTO google_session (id, subject, expires_at) VALUES (?, ?, ?)');
  const removeSession = db.prepare('DELETE FROM google_session WHERE id = ?');
  const pruneSessions = db.prepare('DELETE FROM google_session WHERE expires_at <= ?');
  const addChallenge = db.prepare('INSERT INTO google_challenge (id, expires_at) VALUES (?, ?)');
  const consumeChallenge = db.prepare('DELETE FROM google_challenge WHERE id = ? AND expires_at > ?');
  const pruneChallenges = db.prepare('DELETE FROM google_challenge WHERE expires_at <= ?');
  const account = db.prepare('SELECT browser_id AS owner FROM google_account WHERE subject = ?');
  const addAccount = db.prepare('INSERT INTO google_account (subject, browser_id) VALUES (?, ?)');
  const removeBrowser = db.prepare('DELETE FROM local_browser WHERE id = ?');
  const setDisplayName = db.prepare('UPDATE local_profile SET details = ? WHERE browser_id = ?');

  return {
    session: (id) => id ? readSession.get(id, now()) : undefined,
    async challenge(nonce) {
      const stamp = now();
      await pruneChallenges.run(stamp);
      await addChallenge.run(hashBrowserToken(nonce), stamp + googleChallengeSeconds * 1000);
    },
    async login(id, previous, nonce, identity) {
      return db.transaction(true, async () => {
        const stamp = now();
        if (!(await consumeChallenge.run(hashBrowserToken(nonce), stamp)).changes) return null;
        const { subject, email, name } = identity;
        let owner = (await account.get(subject))?.owner;
        if (!owner) {
          owner = hashBrowserToken(randomUUID());
          const username = email.split('@')[0].replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'trainer';
          const result = await profiles.create(owner, username, null, true);
          if (result !== 'created') throw new Error('Google account creation failed.');
          const displayName = typeof name === 'string' ? name.replace(/\0/g, '').trim().slice(0, 60).toWellFormed() : '';
          if (displayName) await setDisplayName.run(JSON.stringify({ displayName }), owner);
          await addAccount.run(subject, owner);
        }
        await pruneSessions.run(stamp);
        if (previous) await removeSession.run(previous);
        const expiresAt = stamp + googleSessionSeconds * 1000;
        await addSession.run(id, subject, expiresAt);
        return { owner, expiresAt };
      });
    },
    logout: (id) => removeSession.run(id),
    async update(id, workspace, operation, details) {
      return db.transaction(true, async () => {
        const session = await readSession.get(id, now());
        if (!session || await profiles.active(session.owner) !== workspace) return false;
        if (operation === 'logout') await removeSession.run(id);
        else {
          await profiles.changeActive(session.owner, workspace, operation, details);
          if (operation === 'delete') await removeBrowser.run(session.owner);
        }
        return true;
      });
    },
  };
}
