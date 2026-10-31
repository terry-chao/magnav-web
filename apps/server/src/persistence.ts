import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type {
  Alarm,
  CaseRecord,
  CommandAck,
  Plan,
  PrecheckReport,
  ProcedureEvent,
  ProcedurePhase,
  RegistrationInfo,
  ReviewFrame,
  ServerEvent,
  VesselTree,
} from '@magnav/protocol';

export interface PersistedSessionData {
  id: string;
  caseId: string;
  planId: string;
  phase: ProcedurePhase;
  createdAt: number;
  endedAt: number | null;
  previousPhase: ProcedurePhase;
  phaseChangedAt: number;
  precheck: PrecheckReport | null;
  precheckPhase: ProcedurePhase | null;
  alarms: Alarm[];
  alarmSeq: number;
  events: ServerEvent[];
  eventSeq: number;
  phases: Array<{ phase: ProcedurePhase; ts: number }>;
  startedAt: number | null;
  createdBy: string;
  archived: boolean;
  lastPresenceAt: number;
  trace: ReviewFrame[];
  machineEvents: ProcedureEvent[];
  processedCommands: Array<[string, CommandAck]>;
  commandOrder: string[];
  engineSMm: number;
}

/**
 * SQLite persistence for the domain state. Uses Node's built-in `node:sqlite`
 * (Node >= 22.13, unflagged) so there is no native build step. The realtime
 * telemetry and in-process sockets are not persisted; sessions are restored
 * paused/holding.
 *
 * `node:sqlite` is loaded through createRequire because Vite 5 (used by the
 * test runner) predates the builtin and tries to resolve `node:sqlite` as a
 * package when it is a static import.
 */
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

export class SqliteStore {
  readonly db: DatabaseSyncType;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      // in-memory databases do not support WAL
    }
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trees (
        case_id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS registrations (
        case_id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS plans_case_idx ON plans(case_id);
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        ended_at INTEGER,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_case_idx ON sessions(case_id);
    `);
  }

  isEmpty(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM cases').get() as { n: number };
    return Number(row.n) === 0;
  }

  saveCase(record: CaseRecord): void {
    this.db
      .prepare(
        `INSERT INTO cases(id, updated_at, data) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data`,
      )
      .run(record.id, record.updatedAt, JSON.stringify(record));
  }

  saveTree(tree: VesselTree): void {
    this.db
      .prepare(
        `INSERT INTO trees(case_id, data) VALUES (?, ?)
         ON CONFLICT(case_id) DO UPDATE SET data = excluded.data`,
      )
      .run(tree.caseId, JSON.stringify(tree));
  }

  saveRegistration(registration: RegistrationInfo): void {
    this.db
      .prepare(
        `INSERT INTO registrations(case_id, data) VALUES (?, ?)
         ON CONFLICT(case_id) DO UPDATE SET data = excluded.data`,
      )
      .run(registration.caseId, JSON.stringify(registration));
  }

  savePlan(plan: Plan): void {
    this.db
      .prepare(
        `INSERT INTO plans(id, case_id, status, created_at, data) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET case_id = excluded.case_id, status = excluded.status,
           created_at = excluded.created_at, data = excluded.data`,
      )
      .run(plan.id, plan.caseId, plan.status, plan.createdAt, JSON.stringify(plan));
  }

  saveSession(data: PersistedSessionData): void {
    this.db
      .prepare(
        `INSERT INTO sessions(id, case_id, plan_id, phase, created_at, ended_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET case_id = excluded.case_id, plan_id = excluded.plan_id,
           phase = excluded.phase, ended_at = excluded.ended_at, data = excluded.data`,
      )
      .run(
        data.id,
        data.caseId,
        data.planId,
        data.phase,
        data.createdAt,
        data.endedAt,
        JSON.stringify(data),
      );
  }

  loadCases(): CaseRecord[] {
    return (this.db.prepare('SELECT data FROM cases').all() as Array<{ data: string }>).map(
      (row) => JSON.parse(row.data) as CaseRecord,
    );
  }

  loadTrees(): VesselTree[] {
    return (this.db.prepare('SELECT data FROM trees').all() as Array<{ data: string }>).map(
      (row) => JSON.parse(row.data) as VesselTree,
    );
  }

  loadRegistrations(): RegistrationInfo[] {
    return (
      this.db.prepare('SELECT data FROM registrations').all() as Array<{ data: string }>
    ).map((row) => JSON.parse(row.data) as RegistrationInfo);
  }

  loadPlans(): Plan[] {
    return (this.db.prepare('SELECT data FROM plans').all() as Array<{ data: string }>).map(
      (row) => JSON.parse(row.data) as Plan,
    );
  }

  loadSessions(): PersistedSessionData[] {
    return (
      this.db
        .prepare('SELECT data FROM sessions ORDER BY created_at ASC')
        .all() as Array<{ data: string }>
    ).map((row) => JSON.parse(row.data) as PersistedSessionData);
  }

  close(): void {
    this.db.close();
  }

  get filePath(): string {
    return this.path;
  }
}
