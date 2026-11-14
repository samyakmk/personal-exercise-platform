import { spawn } from 'node:child_process';
import { createLiftmorrowServer } from '../server/index.mjs';

const apiPort = Number(process.env.LIFTMORROW_API_PORT ?? 4173);
const webPort = Number(process.env.LIFTMORROW_WEB_PORT ?? 8081);
const expoEnv = Object.fromEntries(Object.keys(process.env)
  .filter((name) => name !== 'CHATGPT_API_KEY')
  .map((name) => [name, process.env[name]]));
const server = createLiftmorrowServer({ webOrigin: `http://localhost:${webPort}` });

server.listen(apiPort, '127.0.0.1', () => {
  const expo = spawn(process.execPath, [
    'node_modules/expo/bin/cli', 'start', '--web', '--localhost', '--port', String(webPort),
  ], {
    stdio: 'inherit',
    env: {
      ...expoEnv,
      EXPO_NO_DOTENV: '1',
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
