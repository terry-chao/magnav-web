/**
 * VS Code F5 entry point.
 *
 * Runs the Vite dev server and the API/WS server inside one Node process so a
 * single debug session covers both sides. Vite is started through its JS API;
 * the Fastify service is imported dynamically after Vite is listening.
 *
 * Breakpoints:
 *   - server: apps/server/src/**
 *   - client: use the separate "Console: Chrome" launch config, or the
 *     debugWithChrome action triggered by MAGNAV_DEBUG_READY.
 */
import { createServer } from 'vite';
import { resolve } from 'node:path';

const root = process.cwd();
process.env.NODE_ENV ??= 'development';
process.env.HOST ??= '127.0.0.1';
// Kept separate from the production port (8810) so F5 can run alongside an
// already running `npm start` instance.
process.env.PORT ??= '8820';
process.env.MAGNAV_API_PORT ??= process.env.PORT;
// Separate audit log so F5 can run alongside the production instance without
// two processes appending to the same hash chain.
process.env.MAGNAV_AUDIT_PATH ??= resolve(process.cwd(), 'data', 'debug-audit.jsonl');

const DEBUG_VITE_PORT = 5174;

const vite = await createServer({
  root: resolve(root, 'apps/console'),
  configFile: resolve(root, 'apps/console/vite.config.ts'),
  mode: 'development',
  server: {
    host: '127.0.0.1',
    port: DEBUG_VITE_PORT,
    strictPort: true,
  },
});

try {
  await vite.listen();
} catch (error) {
  console.error('[debug] Vite 启动失败：端口 5174 可能已被占用。');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

await import('../apps/server/src/index.ts');

const deadline = Date.now() + 20_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`http://${process.env.HOST}:${process.env.PORT}/api/v1/health`);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // server still booting
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
}

if (!ready) {
  console.error('[debug] API 服务未在 20 s 内就绪，请检查 8820 端口或服务日志。');
  await vite.close();
  process.exit(1);
}

console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log(` MAGNAV DEBUG READY http://127.0.0.1:${DEBUG_VITE_PORT}`);
console.log(` Vite HMR: on · API/WS: http://127.0.0.1:${process.env.PORT}`);
console.log(' 断点：apps/server/src/** · apps/console/src/**（Chrome 配置）');
console.log('══════════════════════════════════════════════════════════════');
console.log('');

const shutdown = async () => {
  try {
    await vite.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
