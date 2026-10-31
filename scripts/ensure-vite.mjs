/**
 * Pre-launch helper for the "Console · Chrome" VS Code configuration.
 * If Vite is already serving on 5173 (e.g. the F5 full-stack session is
 * running), exit immediately. Otherwise start Vite detached and wait for it.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = 'http://127.0.0.1:5173/';
const ROOT = process.cwd();

const sleep = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function isUp() {
  try {
    const response = await fetch(URL, { signal: AbortSignal.timeout(1200) });
    return response.status < 500;
  } catch {
    return false;
  }
}

if (await isUp()) {
  console.log('[vite] already running at http://127.0.0.1:5173');
  process.exit(0);
}

const viteBin = resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(viteBin)) {
  console.error(`[vite] binary not found: ${viteBin}`);
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [viteBin, '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
  {
    cwd: resolve(ROOT, 'apps', 'console'),
    env: { ...process.env },
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  },
);
child.unref();

for (let i = 0; i < 80; i += 1) {
  await sleep(250);
  if (await isUp()) {
    console.log('[vite] started at http://127.0.0.1:5173');
    process.exit(0);
  }
}

console.error('[vite] failed to start within 20 s');
process.exit(1);
