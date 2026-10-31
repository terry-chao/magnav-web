/**
 * Build the GitHub Pages artifact.
 *
 * Pages can only host static files, so this build enables the browser-only
 * demo (`/demo`) and the `/magnav-web/` base path, then adds a 404 fallback so
 * direct links to `/demo` work with BrowserRouter.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.env.PAGES_BASE ?? '/magnav-web/';
const env = {
  ...process.env,
  GITHUB_PAGES: '1',
  VITE_STATIC_DEMO: '1',
  PAGES_BASE: base.endsWith('/') ? base : `${base}/`,
};

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', 'build', '-w', '@magnav/console'], {
  stdio: 'inherit',
  env,
  shell: true,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const dist = resolve('apps/console/dist-pages');
copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'));
writeFileSync(resolve(dist, '.nojekyll'), '');
console.log(`[pages] static demo ready at ${env.PAGES_BASE}`);
