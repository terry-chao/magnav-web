import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const base = process.env.PAGES_BASE ?? '/magnav-web/';
const env = {
  ...process.env,
  GITHUB_PAGES: '1',
  PAGES_BASE: base.endsWith('/') ? base : `${base}/`,
};
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const result = spawnSync(
  npx,
  ['vite', 'preview', '--port', '4173', '--host', '127.0.0.1'],
  { cwd: resolve('apps/console'), stdio: 'inherit', env, shell: true },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
