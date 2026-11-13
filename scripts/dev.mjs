import { spawn } from 'node:child_process';
import { createRepformServer } from '../server/index.mjs';

const apiPort = Number(process.env.REPFORM_API_PORT ?? 4173);
const webPort = Number(process.env.REPFORM_WEB_PORT ?? 8081);
const server = createRepformServer({ webOrigin: `http://localhost:${webPort}` });

server.listen(apiPort, '127.0.0.1', () => {
  const expo = spawn(process.execPath, [
    'node_modules/expo/bin/cli', 'start', '--web', '--localhost', '--port', String(webPort),
  ], {
    stdio: 'inherit',
    env: {
      ...process.env,
      BROWSER: 'none',
      EXPO_PUBLIC_API_ORIGIN: `http://localhost:${apiPort}`,
    },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => expo.kill(signal));
  }
  expo.on('exit', (code) => {
    server.close();
    process.exitCode = code ?? 0;
  });
});
