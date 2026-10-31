/** Server-only VS Code debug entry. Run with: node --import tsx scripts/debug-server.ts */
import { resolve } from 'node:path';

process.env.NODE_ENV ??= 'development';
process.env.HOST ??= '127.0.0.1';
// Debug-only port; production uses 8810.
process.env.PORT ??= '8820';
process.env.MAGNAV_AUDIT_PATH ??= resolve(process.cwd(), 'data', 'debug-audit.jsonl');
process.env.MAGNAV_DB_PATH ??= resolve(process.cwd(), 'data', 'debug.sqlite');

await import('../apps/server/src/index.ts');
