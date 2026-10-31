import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandAck, CommandEnvelope, CommandType, ServerMessage, User } from '@magnav/protocol';
import { AuditChain } from '../src/audit';
import { AuthService, USERS, publicUser } from '../src/auth';
import { buildSeedData } from '../src/seed';
import { ConsoleService, type SessionSink } from '../src/service';

const surgeon: User = publicUser(USERS.find((u) => u.id === 'u-surgeon')!);
const assistant: User = publicUser(USERS.find((u) => u.id === 'u-assistant')!);
const engineer: User = publicUser(USERS.find((u) => u.id === 'u-engineer')!);

function makeSink(user: User): SessionSink & { messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  return {
    user,
    messages,
    sendJson(message) {
      messages.push(message);
    },
    sendBinary() {
      /* no-op */
    },
  };
}

describe('ConsoleService safety gates', () => {
  let service: ConsoleService;
  let audit: AuditChain;
  let sink: ReturnType<typeof makeSink>;
  let sessionId: string;
  let seq = 0;

  beforeEach(() => {
    audit = new AuditChain(null);
    service = new ConsoleService(buildSeedData(), audit);
    sink = makeSink(surgeon);
    const snapshot = service.createSession('case-1031', 'plan-1031-lad', surgeon);
    sessionId = snapshot.sessionId;
    service.attach(sink, sessionId, surgeon);
  });

  function command(
    type: CommandType,
    params: Record<string, unknown> = {},
    user: User = surgeon,
  ): CommandAck {
    const session = service.getSession(sessionId);
    const envelope: CommandEnvelope = {
      id: `test-${++seq}`,
      type,
      params,
      issuedBy: user.id,
      issuedAt: Date.now(),
      expectedState: session.phase,
      nonce: `n-${seq}`,
    };
    return service.handleCommand(sink, user, envelope);
  }

  function armFlow() {
    expect(command('START_PRECHECK').ok).toBe(true);
    const arm = command('ARM', { countersign: { badge: 'M-1087', pin: '1357' } });
    expect(arm.ok).toBe(true);
    expect(service.getSession(sessionId).phase).toBe('ARMED');
  }

  it('starts in REGISTERED and rejects illegal auto start', () => {
    expect(service.getSession(sessionId).phase).toBe('REGISTERED');
    const ack = command('START_AUTO', { confirm: true });
    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('BAD_STATE');
  });

  it('runs precheck, dual-confirm arm and start auto', () => {
    const precheck = command('START_PRECHECK');
    expect(precheck.ok).toBe(true);
    const session = service.getSession(sessionId);
    expect(session.precheck?.passed).toBe(true);
    expect(session.precheck?.items.length).toBeGreaterThanOrEqual(8);

    const arm = command('ARM', { countersign: { badge: 'M-1087', pin: '1357' } });
    expect(arm.ok).toBe(true);
    expect(service.getSession(sessionId).phase).toBe('ARMED');

    const start = command('START_AUTO', { confirm: true });
    expect(start.ok).toBe(true);
    expect(service.getSession(sessionId).phase).toBe('AUTO_RUNNING');
  });

  it('refuses arm without a valid countersignature', () => {
    command('START_PRECHECK');
    const bad = command('ARM', { countersign: { badge: 'M-1087', pin: '0000' } });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('COUNTERSIGN_INVALID');
    expect(service.getSession(sessionId).phase).toBe('REGISTERED');
  });

  it('refuses arm when the precheck has not run', () => {
    const ack = command('ARM', { countersign: { badge: 'M-1087', pin: '1357' } });
    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('PRECHECK_REQUIRED');
  });

  it('enforces role permissions for auto start', () => {
    command('START_PRECHECK');
    command('ARM', { countersign: { badge: 'M-1087', pin: '1357' } });
    const denied = command('START_AUTO', { confirm: true }, assistant);
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe('ROLE_DENIED');
  });

  it('makes commands idempotent', () => {
    command('START_PRECHECK');
    const session = service.getSession(sessionId);
    const envelope: CommandEnvelope = {
      id: 'fixed-id',
      type: 'PAUSE',
      params: {},
      issuedBy: surgeon.id,
      issuedAt: Date.now(),
      expectedState: session.phase,
      nonce: 'x',
    };
    const first = service.handleCommand(sink, surgeon, envelope);
    const second = service.handleCommand(sink, surgeon, envelope);
    expect(first.ok).toBe(false); // not running yet
    expect(second.code).toBe('IDEMPOTENT');
  });

  it('pauses, resumes, latches e-stop and resets', () => {
    armFlow();
    expect(command('START_AUTO', { confirm: true }).ok).toBe(true);
    expect(command('PAUSE', { reason: 'test' }).ok).toBe(true);
    expect(service.getSession(sessionId).phase).toBe('AUTO_PAUSED');
    expect(command('RESUME').ok).toBe(true);
    expect(service.getSession(sessionId).phase).toBe('AUTO_RUNNING');

    expect(command('ESTOP').ok).toBe(true);
    expect(service.getSession(sessionId).phase).toBe('AUTO_PAUSED');
    expect(service.getSession(sessionId).actor.getSnapshot().context.estopLatched).toBe(true);
    expect(command('RESUME').ok).toBe(false);
    expect(command('RESET_ESTOP', { confirm: true }).ok).toBe(true);
    for (const alarm of service.getSession(sessionId).alarms.filter((a) => !a.acknowledged)) {
      command('ACK_ALARM', { alarmId: alarm.id });
    }
    expect(command('RESUME').ok).toBe(true);
    expect(service.getSession(sessionId).phase).toBe('AUTO_RUNNING');
  });

  it('injects a coil saturation fault and pauses with a high alarm', () => {
    armFlow();
    command('START_AUTO', { confirm: true });
    const snapshot = service.injectFault(sessionId, 'saturation', engineer);
    expect(snapshot.phase).toBe('AUTO_PAUSED');
    expect(snapshot.alarms.some((a) => a.code === 'COIL_SATURATED')).toBe(true);
    const alarm = snapshot.alarms.find((a) => a.code === 'COIL_SATURATED')!;
    expect(command('ACK_ALARM', { alarmId: alarm.id }).ok).toBe(true);
    expect(command('RESUME').ok).toBe(true);
  });

  it('aborts and produces a review report with a valid audit chain', () => {
    armFlow();
    command('START_AUTO', { confirm: true });
    expect(command('ABORT', { confirm: true, reason: 'test' }).ok).toBe(true);
    expect(service.getSession(sessionId).phase).toBe('ABORTED');
    const report = service.getReviewReport(sessionId);
    expect(report.plan.caseId).toBe('case-1031');
    expect(report.audit.every((entry) => entry.subject === 'case-1031')).toBe(true);
    expect(audit.verify().valid).toBe(true);
    expect(audit.verify().count).toBeGreaterThan(3);
  });

  it('requires a fresh precheck after manual takeover', () => {
    armFlow();
    command('START_AUTO', { confirm: true });
    expect(command('TAKEOVER').ok).toBe(true);
    expect(service.getSession(sessionId).phase).toBe('MANUAL');
    // context still has the old countersignature and precheck; service insists on re-running
    const ack = command('ARM', { countersign: { badge: 'M-1087', pin: '1357' } });
    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('PRECHECK_REQUIRED');
    expect(command('START_PRECHECK').ok).toBe(true);
    const rearm = command('ARM', { countersign: { badge: 'M-1087', pin: '1357' } });
    expect(rearm.ok).toBe(true);
    expect(service.getSession(sessionId).phase).toBe('ARMED');
  });

  it('validates login credentials', () => {
    const auth = new AuthService();
    expect(auth.login('M-1042', '2468')).not.toBeNull();
    expect(auth.login('M-1042', '0000')).toBeNull();
    const login = auth.login('M-1042', '2468')!;
    const resolved = auth.resolve(login.token);
    expect(resolved?.user.role).toBe('surgeon');
  });

  it('resumes the same homepage demo session instead of creating duplicates', () => {
    const demo = new ConsoleService(buildSeedData(), new AuditChain(null));
    const first = demo.startDemo(surgeon);
    expect(first.phase).toBe('REGISTERED');
    const second = demo.startDemo(surgeon);
    expect(second.sessionId).toBe(first.sessionId);
    expect(demo.listSessionsForCase('case-1031')).toHaveLength(1);
  });
});
