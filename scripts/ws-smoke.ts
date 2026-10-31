/**
 * End-to-end WebSocket smoke test (no browser).
 *   npx tsx scripts/ws-smoke.ts
 *
 * Exercises: auth → session create → precheck → dual-confirm arm →
 * start → telemetry decode → pause/resume → e-stop/reset → review.
 */
import WebSocket from 'ws';
import { decodeTelemetry } from '../packages/protocol/src/telemetry';
import type {
  CommandAck,
  CommandEnvelope,
  CommandType,
  ProcedurePhase,
  ServerMessage,
  TelemetryFrame,
} from '../packages/protocol/src/types';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8810';
const WS_URL = BASE.replace('http', 'ws') + '/ws/v1';

async function main() {
  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ badge: 'M-1042', pin: '2468' }),
  });
  if (!loginRes.ok) throw new Error(`login failed ${loginRes.status}`);
  const login = (await loginRes.json()) as { csrfToken: string; user: { id: string } };
  const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]!;
  console.log('login ok', login.user.id);

  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        cookie,
        'x-csrf-token': login.csrfToken,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
    return res;
  };

  const sessRes = await api('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({ caseId: 'case-1031', planId: 'plan-1031-lad' }),
  });
  const snapshot = (await sessRes.json()) as any;
  console.log('session', snapshot.sessionId, snapshot.phase);

  const ws = new WebSocket(WS_URL, { headers: { cookie } });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  let currentPhase: ProcedurePhase = snapshot.phase;
  let frames = 0;
  let lastFrame: TelemetryFrame | null = null;
  const acks = new Map<string, (ack: CommandAck) => void>();
  const phaseWaiters: Array<(phase: ProcedurePhase) => void> = [];
  const events: ServerMessage[] = [];

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      lastFrame = decodeTelemetry(buffer as ArrayBuffer);
      frames += 1;
      return;
    }
    const message = JSON.parse(data.toString()) as ServerMessage;
    events.push(message);
    if (message.kind === 'hello' || message.kind === 'snapshot') {
      currentPhase = message.snapshot.phase;
    }
    if (message.kind === 'event') {
      if (message.event.kind === 'phase') {
        currentPhase = message.event.phase;
        for (const waiter of phaseWaiters.splice(0)) waiter(currentPhase);
      }
      if (message.event.kind === 'command') {
        acks.get(message.event.ack.id)?.(message.event.ack);
        acks.delete(message.event.ack.id);
      }
    }
  });

  const helloPromise = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('hello timeout')), 5000);
    const handler = (data: any, isBinary: boolean) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      if (msg.kind === 'hello') {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg.snapshot);
      }
    };
    ws.on('message', handler);
  });
  ws.send(JSON.stringify({ kind: 'subscribe', sessionId: snapshot.sessionId }));
  const hello = await helloPromise;
  currentPhase = hello.phase;
  console.log('hello phase', hello.phase);

  const heartbeat = setInterval(() => {
    ws.send(JSON.stringify({ kind: 'heartbeat', t0: Date.now() }));
  }, 1000);

  let commandSeq = 0;
  const send = (type: CommandType, params: Record<string, unknown> = {}) => {
    const command: CommandEnvelope = {
      id: `cmd-${++commandSeq}-${Date.now()}`,
      type,
      params,
      issuedBy: login.user.id,
      issuedAt: Date.now(),
      expectedState: currentPhase,
      nonce: `n-${commandSeq}`,
    };
    const promise = new Promise<CommandAck>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${type} ack timeout`)), 5000);
      acks.set(command.id, (ack) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
    ws.send(JSON.stringify({ kind: 'command', command }));
    return promise;
  };

  const waitPhase = (phase: ProcedurePhase, timeoutMs = 5000) =>
    new Promise<void>((resolve, reject) => {
      if (currentPhase === phase) return resolve();
      const timer = setTimeout(() => reject(new Error(`timeout waiting phase ${phase}`)), timeoutMs);
      const check = (p: ProcedurePhase) => {
        if (p === phase) {
          clearTimeout(timer);
          resolve();
        }
      };
      phaseWaiters.push(check);
    });

  const ok = async (label: string, type: CommandType, params: Record<string, unknown> = {}) => {
    const ack = await send(type, params);
    console.log(`${label}:`, ack.ok ? 'OK' : 'REJECTED', ack.code, ack.serverPhase, '-', ack.message);
    if (!ack.ok) throw new Error(`${label} rejected: ${ack.code} ${ack.message}`);
    return ack;
  };

  await ok('PRECHECK', 'START_PRECHECK');
  await new Promise((r) => setTimeout(r, 200));

  await ok('ARM', 'ARM', { countersign: { badge: 'M-1087', pin: '1357' } });
  await waitPhase('ARMED');

  await ok('START_AUTO', 'START_AUTO', { confirm: true });
  await waitPhase('AUTO_RUNNING');
  await new Promise((r) => setTimeout(r, 2500));
  console.log(
    'telemetry frames',
    frames,
    'progress',
    lastFrame?.progress.toFixed(3),
    'coils',
    lastFrame?.coils.length,
    'b',
    lastFrame ? Math.hypot(...lastFrame.field.b).toFixed(1) : '-',
    'mT',
  );
  if (frames < 10) throw new Error('too few telemetry frames');
  if (!lastFrame || lastFrame.shape.length !== 288) throw new Error('bad shape payload');

  await ok('PAUSE', 'PAUSE', { reason: 'smoke test' });
  await waitPhase('AUTO_PAUSED');

  const beforeResume = events.filter((m) => m.kind === 'event' && m.event.kind === 'alarm').length;
  if (beforeResume === 0) {
    await ok('RESUME', 'RESUME');
    await waitPhase('AUTO_RUNNING');
  }

  await ok('ESTOP', 'ESTOP');
  await waitPhase('AUTO_PAUSED');
  await ok('RESET_ESTOP', 'RESET_ESTOP', { confirm: true });

  const review = (await (await api(`/api/v1/sessions/${snapshot.sessionId}/review`)).json()) as any;
  console.log(
    'review frames',
    review.frames.length,
    'phase',
    review.phase,
    'maxGrad',
    review.stats.maxGradient,
    'maxForce',
    review.stats.maxLateralForceN,
  );

  const audit = (await (await api('/api/v1/audit/verify')).json()) as any;
  console.log('audit chain', audit);

  clearInterval(heartbeat);
  ws.close();
  console.log('\nSMOKE OK');
}

main().catch((error) => {
  console.error('SMOKE FAILED', error);
  process.exit(1);
});
