import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { test } from 'node:test';
import { createRepformServer } from '../server/index.mjs';

test('rejected uploads close unfinished connections and only admitted uploads receive 100 Continue', { timeout: 5000 }, async (t) => {
  const server = createRepformServer({ database: ':memory:', respond: null });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  const { port } = server.address();
  const host = `127.0.0.1:${port}`;
  const workspace = await fetch('http://' + host + '/api/workspace');
  const cookie = workspace.headers.get('set-cookie').split(';')[0];
  await workspace.arrayBuffer();
  const clip = '/api/clips/' + randomUUID() + '?exercise=push-up';
  const bytes = await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url));

  async function send({ length, requestHost = host, origin, expect = true, body }) {
    const socket = connect(port, '127.0.0.1');
    t.after(() => socket.destroy());
    const closed = once(socket, 'close');
    let response = '';
    let sent = false;
    socket.on('data', (chunk) => {
      response += chunk.toString();
      if (body && !sent && response.includes('HTTP/1.1 100 Continue\r\n\r\n')) {
        sent = true;
        socket.write(body);
      }
    });
    await once(socket, 'connect');
    const headers = [`PUT ${clip} HTTP/1.1`, `Host: ${requestHost}`, `Cookie: ${cookie}`, 'Content-Type: video/mp4',
      'X-Clip-Name: synthetic.mp4', `Content-Length: ${length}`, ...(expect ? ['Expect: 100-continue'] : []),
      ...(origin ? [`Origin: ${origin}`] : [])];
    socket.write(headers.join('\r\n') + '\r\n\r\n');
    await closed;
    return Array.from(response.matchAll(/HTTP\/1\.1 (\d+)/g), ([, status]) => Number(status));
  }

  assert.deepEqual(await send({ length: 60 * 1024 * 1024 }), [413]);
  assert.deepEqual(await send({ length: bytes.length, origin: 'https://untrusted.invalid', expect: false }), [403]);
  assert.deepEqual(await send({ length: bytes.length, requestHost: 'untrusted.invalid' }), [421]);
  assert.deepEqual(await send({ length: bytes.length, body: bytes }), [100, 200]);
});
