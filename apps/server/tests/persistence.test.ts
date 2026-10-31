import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandAck, CommandEnvelope, CommandType, ServerMessage, User } from '@magnav/protocol';
import { AuditChain } from '../src/audit';
import { USERS, publicUser } from '../src/auth';
import { SqliteStore } from '../src/persistence';
import { buildSeedData } from '../src/seed';
import { ConsoleService, type SessionSink } from '../src/service';

const surgeon: User = publicUser(USERS.find((u) => u.id === 'u-surgeon')!);

function makeSink(): SessionSink {
  return {
    sendJson(_message: ServerMessage) {
      /* no-op */
    },
    sendBinary() {
      /* no-op */
    },
  };
}

describe('SQLite persistence and session recovery', () => {
  it('persists cases/plans, restores an active session paused, and keeps the archive', () => {
    const audit = new AuditChain(null);
    const store = new SqliteStore(':memory:');
    const sink = makeSink();
    const service = new ConsoleService(buildSeedData(), audit, store);
    const snapshot = service.createSession('case-1031', 'plan-1031-lad', surgeon);
    sink.sessionId = snapshot.sessionId;
    service.attach(sink, snapshot.sessionId, surgeon);

    let seq = 0;
    const command = (type: CommandType, params: Record<string, unknown> = {}): CommandAck => {
      const session = service.getSession(snapshot.sessionId);
      const envelope: CommandEnvelope = {
        id: `persist-${++seq}`,
        type,
        params,
        issuedBy: surgeon.id,
        issuedAt: Date.now(),
        expectedState: session.phase,
        nonce: `n-${seq}`,
      };
      return service.handleCommand(sink, surgeon, envelope);
    };

    expect(command('START_PRECHECK').ok).toBe(true);
    expect(
      command('ARM', { countersign: { badge: 'M-1087', pin: '1357' } }).ok,
    ).toBe(true);
    expect(command('START_AUTO', { confirm: true }).ok).toBe(true);
    const original = service.getSession(snapshot.sessionId);
    original.engine.sMm = 42;
    expect(command('PRESENCE').ok).toBe(true);

    expect(store.loadCases()).toHaveLength(3);
    expect(store.loadPlans().length).toBeGreaterThanOrEqual(3);
    expect(store.loadSessions().length).toBeGreaterThanOrEqual(2);

    // Simulate a process restart against the same database.
    const restarted = new ConsoleService(buildSeedData(), audit, store);
    const restored = restarted.getSession(snapshot.sessionId);
    expect(restored.phase).toBe('AUTO_PAUSED');
    expect(restored.engine.sMm).toBe(42);
    expect(restored.plan.id).toBe('plan-1031-lad');
    expect(restored.record.id).toBe('case-1031');
    expect(restored.alarms.some((alarm) => alarm.code === 'SERVICE_RESTART')).toBe(true);
    expect(restored.machineEvents.some((event) => event.type === 'START_AUTO')).toBe(true);

    const archive = restarted.getSession('session-case-1033');
    expect(archive.phase).toBe('COMPLETED');
    const report = restarted.getReviewReport('session-case-1033');
    expect(report.frames.length).toBeGreaterThan(100);
    expect(report.stats.outcome).toBe('COMPLETED');
    expect(audit.verify().valid).toBe(true);

    store.close();
  });

  it('reopens a file-backed database and keeps a newly created case', () => {
    const dir = mkdtempSync(join(tmpdir(), 'magnav-store-'));
    const file = join(dir, 'test.sqlite');
    const audit = new AuditChain(null);
    try {
      const store = new SqliteStore(file);
      const service = new ConsoleService(buildSeedData(), audit, store);
      const detail = service.createCase(
        {
          nameMasked: '测*试',
          sex: 'F',
          age: 50,
          diagnosis: '测试病变',
          procedure: '测试术式',
        },
        surgeon,
      );
      const caseId = detail.case.id;
      store.close();

      const reopened = new SqliteStore(file);
      const restarted = new ConsoleService(buildSeedData(), audit, reopened);
      expect(restarted.getCase(caseId).patient.diagnosis).toBe('测试病变');
      expect(restarted.listCases(surgeon).some((c) => c.id === caseId)).toBe(true);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
