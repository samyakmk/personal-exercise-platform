import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export async function createTestProfile(call, legacyCookie) {
  const response = await call('profiles', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(legacyCookie && { Cookie: legacyCookie }) },
    body: JSON.stringify({ username: 'test-user' }),
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.getSetCookie()[0].split(';')[0];
  await response.arrayBuffer();
  return cookie;
}

export function activeWorkspaceId(db, cookie) {
  const tokenHash = createHash('sha256').update(cookie.split('=')[1]).digest('hex');
  return db.prepare('SELECT active_workspace FROM local_browser WHERE id = ?').get(tokenHash).active_workspace;
}
