/**
 * E2E server: build output is served on 8890 with an isolated SQLite database
 * and audit log. It deletes the previous E2E data before booting, so every
 * Playwright run starts from the three seeded cases.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dataDir = resolve(root, 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = resolve(dataDir, 'e2e.sqlite');
const auditPath = resolve(dataDir, 'e2e-audit.jsonl');
for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, auditPath]) {
  rmSync(file, { force: true });
}

process.env.NODE_ENV = 'test';
process.env.HOST = '127.0.0.1';
process.env.PORT = '8890';
process.env.MAGNAV_DB_PATH = dbPath;
process.env.MAGNAV_AUDIT_PATH = auditPath;

await import('../apps/server/dist/index.js');
