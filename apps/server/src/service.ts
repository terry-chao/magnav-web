import { randomUUID } from 'node:crypto';
import { createActor, type Actor } from 'xstate';
import {
  ALARM_DEFS,
  COIL_SPECS,
  COMMAND_META,
  COMMAND_ROLE,
  DISCLAIMER,
  LIMITS,
  PHASE_COMMANDS,
  TELEMETRY,
  V,
  can,
  encodeTelemetry,
  nearestOnPolyline,
  phaseOf,
  procedureMachine,
  rejectionMessage,
} from '@magnav/protocol';
import type {
  Alarm,
  CaseDetail,
  CaseRecord,
  CoilRuntime,
  CommandAck,
  CommandEnvelope,
  Countersign,
  DeadmanState,
  DeviceSnapshot,
  Plan,
  PrecheckReport,
  ProcedureEvent,
  ProcedurePhase,
  RegistrationInfo,
  ReviewFrame,
  ReviewReport,
  ReviewStats,
  ServerEvent,
  ServerMessage,
  SessionSnapshot,
  User,
  VesselTree,
} from '@magnav/protocol';
import { userByBadge, userById, verifyPin, type StoredUser } from './auth';
import type { AuditChain } from './audit';
import { buildPrecheck, composePlan, defaultRegistration } from './planning';
import {
  createSimulatedGateway,
  type GatewayFactory,
  type RobotGateway,
} from './gateway';
import type { SeedData } from './seed';
import { createVesselTree } from './seed/vessels';
import { SqliteStore, type PersistedSessionData } from './persistence';

export interface SessionSink {
  sessionId?: string;
  user?: User;
  sendJson(message: ServerMessage): void;
  sendBinary(buffer: ArrayBuffer): void;
  close?(): void;
}

export class ServiceError extends Error {
  readonly code: string;
  readonly detail?: string;
  readonly status: number;
  constructor(code: string, message?: string, detail?: string, status = 400) {
    super(message ?? rejectionMessage(code));
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

export interface SessionRuntime {
  id: string;
  caseId: string;
  planId: string;
  record: CaseRecord;
  plan: Plan;
  tree: VesselTree;
  registration: RegistrationInfo;
  actor: Actor<typeof procedureMachine>;
  phase: ProcedurePhase;
  previousPhase: ProcedurePhase;
  phaseChangedAt: number;
  precheck: PrecheckReport | null;
  precheckPhase: ProcedurePhase | null;
  alarms: Alarm[];
  alarmSeq: number;
  devices: DeviceSnapshot;
  events: ServerEvent[];
  eventSeq: number;
  phases: Array<{ phase: ProcedurePhase; ts: number }>;
  engine: RobotGateway;
  sinks: Set<SessionSink>;
  createdAt: number;
  createdBy: string;
  startedAt: number | null;
  endedAt: number | null;
  lastPresenceAt: number;
  lastClientAt: number;
  lastDeviceAt: number;
  lastRecordAt: number;
  lastTelemetryAt: number;
  trace: ReviewFrame[];
  processedCommands: Map<string, CommandAck>;
  commandOrder: string[];
  lastFrame: ReturnType<RobotGateway['frame']> | null;
  archived: boolean;
  machineEvents: ProcedureEvent[];
  lastPersistAt: number;
}

const SYSTEM_ACTOR = { id: 'system', name: '系统', role: 'engineer' as const };
const ARCHIVE_SESSION_ID = 'session-case-1033';

export class ConsoleService {
  private cases = new Map<string, CaseRecord>();
  private trees = new Map<string, VesselTree>();
  private registrations = new Map<string, RegistrationInfo>();
  private plans = new Map<string, Plan>();
  private sessions = new Map<string, SessionRuntime>();
  private timer: NodeJS.Timeout | null = null;
  private lastTick = Date.now();
  private caseSeq = 1034;
  private readonly store: SqliteStore | null;
  private readonly gatewayFactory: GatewayFactory;
  readonly audit: AuditChain;

  constructor(
    seed: SeedData,
    audit: AuditChain,
    store: SqliteStore | null = null,
    gatewayFactory: GatewayFactory = createSimulatedGateway,
  ) {
    this.audit = audit;
    this.store = store;
    this.gatewayFactory = gatewayFactory;

    if (store && !store.isEmpty()) {
      this.restoreFromStore(store);
      return;
    }

    for (const record of seed.cases) this.cases.set(record.id, record);
    for (const [id, tree] of seed.trees) this.trees.set(id, tree);
    for (const [id, reg] of seed.registrations) this.registrations.set(id, reg);
    for (const [id, plan] of seed.plans) this.plans.set(id, plan);
    this.caseSeq = Math.max(
      1034,
      ...[...this.cases.keys()]
        .map((id) => Number(id.replace('case-', '')))
        .filter((n) => Number.isFinite(n)),
    );
    this.persistSeed();
    this.seedArchivedSession();
  }

  private persistSeed(): void {
    if (!this.store) return;
    for (const record of this.cases.values()) this.store.saveCase(record);
    for (const tree of this.trees.values()) this.store.saveTree(tree);
    for (const registration of this.registrations.values()) {
      this.store.saveRegistration(registration);
    }
    for (const plan of this.plans.values()) this.store.savePlan(plan);
  }

  private restoreFromStore(store: SqliteStore): void {
    for (const record of store.loadCases()) this.cases.set(record.id, record);
    for (const tree of store.loadTrees()) this.trees.set(tree.caseId, tree);
    for (const registration of store.loadRegistrations()) {
      this.registrations.set(registration.caseId, registration);
    }
    for (const plan of store.loadPlans()) this.plans.set(plan.id, plan);
    this.caseSeq = Math.max(
      1034,
      ...[...this.cases.keys()]
        .map((id) => Number(id.replace('case-', '')))
        .filter((n) => Number.isFinite(n)),
    );
    for (const data of store.loadSessions()) this.restoreSession(data);
  }

  /* ---------------------------------------------------------------- */
  /* lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  start(): void {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(Date.now()), 8);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /* ---------------------------------------------------------------- */
  /* read models                                                       */
  /* ---------------------------------------------------------------- */

  listCases(user: User): CaseRecord[] {
    return [...this.cases.values()]
      .filter((c) => (user.role === 'reviewer' ? true : c.status !== 'archived'))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getCase(caseId: string): CaseRecord {
    const record = this.cases.get(caseId);
    if (!record) throw new ServiceError('CASE_NOT_FOUND', '病例不存在', undefined, 404);
    return record;
  }

  getCaseDetail(caseId: string, _user: User): CaseDetail {
    const record = this.getCase(caseId);
    const plans = [...this.plans.values()]
      .filter((p) => p.caseId === caseId)
      .sort((a, b) => b.createdAt - a.createdAt);
    const active = [...this.sessions.values()].find(
      (s) => s.caseId === caseId && !s.endedAt,
    );
    return {
      case: record,
      registration: this.registrations.get(caseId) ?? null,
      plans,
      activeSessionId: active?.id ?? null,
    };
  }

  getTree(caseId: string): VesselTree {
    const tree = this.trees.get(caseId);
    if (!tree) throw new ServiceError('TREE_NOT_FOUND', '血管树不存在', undefined, 404);
    return tree;
  }

  getRegistration(caseId: string): RegistrationInfo {
    this.getCase(caseId);
    const reg = this.registrations.get(caseId);
    if (!reg) throw new ServiceError('REGISTRATION_NOT_FOUND', '配准信息不存在', undefined, 404);
    return reg;
  }

  getPlan(planId: string): Plan {
    const plan = this.plans.get(planId);
    if (!plan) throw new ServiceError('PLAN_NOT_FOUND', '计划不存在', undefined, 404);
    return plan;
  }

  getSession(sessionId: string): SessionRuntime {
    const session = this.sessions.get(sessionId);
    if (!session) throw new ServiceError('SESSION_NOT_FOUND', '会话不存在', undefined, 404);
    return session;
  }

  listPlans(caseId: string): Plan[] {
    return [...this.plans.values()]
      .filter((p) => p.caseId === caseId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getActiveSessionForCase(caseId: string): SessionRuntime | null {
    return (
      [...this.sessions.values()].find((s) => s.caseId === caseId && !s.endedAt) ?? null
    );
  }

  listSessionsForCase(caseId: string) {
    return [...this.sessions.values()]
      .filter((s) => s.caseId === caseId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        id: s.id,
        planId: s.planId,
        phase: s.phase,
        createdAt: s.createdAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        outcome: s.phase === 'COMPLETED' ? 'COMPLETED' : s.phase === 'ABORTED' ? 'ABORTED' : 'IN_PROGRESS',
      }));
  }

  getDevices(sessionId?: string): DeviceSnapshot {
    if (sessionId) return this.getSession(sessionId).devices;
    return this.initialDevices();
  }

  countSessions(): number {
    return this.sessions.size;
  }

  snapshot(sessionId: string, user: User): SessionSnapshot {
    const session = this.getSession(sessionId);
    return this.buildSnapshot(session, user, Date.now());
  }

  /* ---------------------------------------------------------------- */
  /* sessions                                                          */
  /* ---------------------------------------------------------------- */

  createSession(caseId: string, planId: string, user: User): SessionSnapshot {
    const record = this.getCase(caseId);
    const plan = this.getPlan(planId);
    if (plan.caseId !== caseId) throw new ServiceError('BAD_STATE', '计划不属于该病例');
    if (plan.status !== 'approved') {
      throw new ServiceError('PLAN_NOT_APPROVED', '计划尚未审核签字，无法进入术中阶段');
    }
    if (!plan.feasibility.passed) {
      throw new ServiceError('PLAN_INFEASIBLE', '计划未通过磁导航可行性校验');
    }
    const existing = this.getActiveSessionForCase(caseId);
    if (existing) return this.buildSnapshot(existing, user, Date.now());

    const tree = this.getTree(caseId);
    const registration = this.getRegistration(caseId);
    const bootstrap = this.bootstrapMachine(plan, registration);
    const { actor, phase } = bootstrap;
    const now = Date.now();
    const session: SessionRuntime = {
      id: `session-${caseId}-${randomUUID().slice(0, 8)}`,
      caseId,
      planId,
      record,
      plan,
      tree,
      registration,
      actor,
      phase,
      previousPhase: 'IDLE',
      phaseChangedAt: now,
      precheck: null,
      precheckPhase: null,
      alarms: [],
      alarmSeq: 0,
      devices: this.initialDevices(),
      events: [],
      eventSeq: 0,
      phases: [{ phase, ts: now }],
      engine: this.gatewayFactory(plan),
      sinks: new Set(),
      createdAt: now,
      createdBy: user.id,
      startedAt: null,
      endedAt: null,
      lastPresenceAt: now,
      lastClientAt: now,
      lastDeviceAt: now,
      lastRecordAt: 0,
      lastTelemetryAt: 0,
      trace: [],
      processedCommands: new Map(),
      commandOrder: [],
      lastFrame: null,
      archived: false,
      machineEvents: bootstrap.events,
      lastPersistAt: 0,
    };
    this.sessions.set(session.id, session);
    record.status = 'in_progress';
    record.sessionId = session.id;
    record.updatedAt = now;
    this.audit.append(
      user,
      'SESSION_CREATE',
      `创建手术会话 ${session.id} · 计划 ${plan.name}`,
      caseId,
    );
    this.store?.saveCase(record);
    this.persistSession(session);
    this.emitNotice(session, 'info', `手术会话已创建 · ${plan.name} · 当前阶段 ${phase}`);
    this.broadcastSnapshot(session);
    return this.buildSnapshot(session, user, now);
  }

  private createBaseActor(): Actor<typeof procedureMachine> {
    const actor = createActor(procedureMachine, {
      input: { treMaxMm: LIMITS.treMaxMm },
    });
    actor.start();
    return actor;
  }

  private bootstrapMachine(
    plan: Plan,
    registration: RegistrationInfo,
  ): {
    actor: Actor<typeof procedureMachine>;
    events: ProcedureEvent[];
    phase: ProcedurePhase;
  } {
    const actor = this.createBaseActor();
    const events: ProcedureEvent[] = [
      { type: 'SET_TRE', treMm: registration.treMm },
      {
        type: 'SET_PLAN',
        approved: plan.status === 'approved',
        feasible: plan.feasibility.passed,
      },
      { type: 'LOAD_CASE' },
      { type: 'IMAGES_READY' },
    ];
    if (plan.status === 'approved') events.push({ type: 'PLAN_CONFIRMED' });
    if (registration.treMm <= LIMITS.treMaxMm) events.push({ type: 'REGISTERED' });
    for (const event of events) actor.send(event);
    return { actor, events, phase: phaseOf(actor.getSnapshot().value) };
  }

  private sendMachine(session: SessionRuntime, event: ProcedureEvent): void {
    session.machineEvents.push(event);
    session.actor.send(event);
  }

  private persistSession(session: SessionRuntime): void {
    if (!this.store) return;
    this.store.saveSession({
      id: session.id,
      caseId: session.caseId,
      planId: session.planId,
      phase: session.phase,
      createdAt: session.createdAt,
      endedAt: session.endedAt,
      previousPhase: session.previousPhase,
      phaseChangedAt: session.phaseChangedAt,
      precheck: session.precheck,
      precheckPhase: session.precheckPhase,
      alarms: session.alarms,
      alarmSeq: session.alarmSeq,
      events: session.events,
      eventSeq: session.eventSeq,
      phases: session.phases,
      startedAt: session.startedAt,
      createdBy: session.createdBy,
      archived: session.archived,
      lastPresenceAt: session.lastPresenceAt,
      trace: session.trace,
      machineEvents: session.machineEvents,
      processedCommands: [...session.processedCommands.entries()],
      commandOrder: session.commandOrder,
      engineSMm: session.engine.sMm,
    });
    this.store.saveCase(session.record);
    session.lastPersistAt = Date.now();
  }

  private restoreSession(data: PersistedSessionData): void {
    const record = this.cases.get(data.caseId);
    const plan = this.plans.get(data.planId);
    const tree = this.trees.get(data.caseId);
    const registration = this.registrations.get(data.caseId);
    if (!record || !plan || !tree || !registration) {
      console.warn(`[persistence] 跳过无法恢复的会话 ${data.id}（缺少病例/计划/血管/配准）`);
      return;
    }

    const actor = this.createBaseActor();
    for (const event of data.machineEvents) actor.send(event);
    const replayPhase = phaseOf(actor.getSnapshot().value);
    if (replayPhase !== data.phase) {
      console.warn(
        `[persistence] 会话 ${data.id} 重放阶段 ${replayPhase} 与持久化阶段 ${data.phase} 不一致，以重放为准`,
      );
    }

    const engine = this.gatewayFactory(plan);
    engine.sMm = Math.max(0, Math.min(plan.totalLengthMm, data.engineSMm));
    if (replayPhase === 'ABORTING') engine.abort();
    else engine.hold();

    const now = Date.now();
    const session: SessionRuntime = {
      id: data.id,
      caseId: data.caseId,
      planId: data.planId,
      record,
      plan,
      tree,
      registration,
      actor,
      phase: replayPhase,
      previousPhase: data.previousPhase,
      phaseChangedAt: data.phaseChangedAt,
      precheck: data.precheck,
      precheckPhase: data.precheckPhase,
      alarms: data.alarms,
      alarmSeq: data.alarmSeq,
      devices: this.initialDevices(),
      events: data.events,
      eventSeq: data.eventSeq,
      phases: data.phases,
      engine,
      sinks: new Set(),
      createdAt: data.createdAt,
      createdBy: data.createdBy,
      startedAt: data.startedAt,
      endedAt: data.endedAt,
      lastPresenceAt: now,
      lastClientAt: now,
      lastDeviceAt: now,
      lastRecordAt: 0,
      lastTelemetryAt: 0,
      trace: data.trace,
      processedCommands: new Map(data.processedCommands),
      commandOrder: data.commandOrder,
      lastFrame: null,
      archived: data.archived,
      machineEvents: data.machineEvents,
      lastPersistAt: 0,
    };
    this.sessions.set(session.id, session);
    record.sessionId = session.id;
    if (data.archived) {
      this.persistSession(session);
      return;
    }
    this.audit.append(
      SYSTEM_ACTOR,
      'SESSION_RESTORE',
      `恢复会话 ${session.id} · 阶段 ${replayPhase}`,
      session.caseId,
    );
    this.emitNotice(session, 'warn', '服务重启后已恢复会话，运动保持暂停');

    if (replayPhase === 'AUTO_RUNNING') {
      this.applyMachine(
        session,
        { type: 'FAULT', reason: '服务重启，自动导航已暂停' },
        '服务重启，自动导航已暂停',
        'SERVICE_RESTART',
      );
      this.raiseAlarm(session, 'SERVICE_RESTART', '服务进程重启，自动导航已安全暂停并保持位置');
    }
    this.persistSession(session);
  }

  private buildSnapshot(session: SessionRuntime, user: User, now: number): SessionSnapshot {
    const ctx = session.actor.getSnapshot().context;
    const deadman: DeadmanState = {
      intervalMs: LIMITS.deadmanIntervalMs,
      graceMs: LIMITS.deadmanGraceMs,
      lastConfirmedAt: session.lastPresenceAt,
      dueAt: session.lastPresenceAt + LIMITS.deadmanIntervalMs,
      remainingMs: Math.max(
        0,
        session.lastPresenceAt + LIMITS.deadmanIntervalMs - now,
      ),
      overdue: now > session.lastPresenceAt + LIMITS.deadmanIntervalMs + LIMITS.deadmanGraceMs,
    };
    return {
      sessionId: session.id,
      case: session.record,
      plan: session.plan,
      tree: session.tree,
      registration: session.registration,
      phase: session.phase,
      previousPhase: session.previousPhase,
      phaseChangedAt: session.phaseChangedAt,
      context: {
        treMm: ctx.treMm,
        precheckPassed: Boolean(session.precheck?.passed),
        armedBy: ctx.armedBy,
        countersignedBy: ctx.countersignedBy,
        pauseReason: ctx.pauseReason,
        estopLatched: ctx.estopLatched,
        startedAt: session.startedAt ?? undefined,
        completedAt: session.endedAt ?? undefined,
        abortReason: ctx.abortReason,
      },
      precheck: session.precheck,
      alarms: session.alarms.slice(-30),
      devices: session.devices,
      deadman,
      progress: session.engine.progress,
      segmentIndex: session.engine.segmentIndex,
      events: session.events.slice(-100),
      audit: this.audit.tail(60),
      user,
      serverTime: now,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      simSpeed: 1,
    };
  }

  attach(sink: SessionSink, sessionId: string, user: User): void {
    const session = this.getSession(sessionId);
    sink.sessionId = sessionId;
    sink.user = user;
    session.sinks.add(sink);
    session.lastClientAt = Date.now();
    sink.sendJson({
      kind: 'hello',
      snapshot: this.buildSnapshot(session, user, Date.now()),
      serverTime: Date.now(),
      protocol: 1,
    });
  }

  detach(sink: SessionSink): void {
    for (const session of this.sessions.values()) session.sinks.delete(sink);
  }

  heartbeat(sessionId: string | undefined, now = Date.now()): void {
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (session) session.lastClientAt = now;
  }

  /* ---------------------------------------------------------------- */
  /* commands                                                          */
  /* ---------------------------------------------------------------- */

  handleCommand(sink: SessionSink, user: User, command: CommandEnvelope): CommandAck {
    const session = sink.sessionId ? this.sessions.get(sink.sessionId) : undefined;
    if (!session) {
      return this.ack(command, false, 'SESSION_NOT_FOUND', 'IDLE', Date.now());
    }
    const now = Date.now();
    session.lastClientAt = now;
    const replay = session.processedCommands.get(command.id);
    if (replay) {
      return { ...replay, code: 'IDEMPOTENT', message: '重复指令（已处理）' };
    }
    let ack: CommandAck;
    try {
      if (command.issuedBy !== user.id) {
        throw new ServiceError('FORBIDDEN', '操作者与登录会话不一致');
      }
      if (!COMMAND_META[command.type]) throw new ServiceError('UNKNOWN_COMMAND');
      if (command.expectedState !== session.phase) {
        throw new ServiceError(
          'BAD_STATE',
          `指令期望阶段 ${command.expectedState}，当前 ${session.phase}`,
        );
      }
      if (!COMMAND_ROLE[command.type].includes(user.role)) {
        throw new ServiceError(
          'ROLE_DENIED',
          `角色 ${user.role} 无权执行 ${COMMAND_META[command.type].label}`,
        );
      }
      if (!PHASE_COMMANDS[session.phase].includes(command.type)) {
        throw new ServiceError(
          'BAD_STATE',
          `阶段 ${session.phase} 不允许 ${COMMAND_META[command.type].label}`,
        );
      }
      this.dispatch(session, user, command, now);
      ack = this.ack(command, true, 'OK', session.phase, now);
      this.audit.append(
        user,
        `CMD_${command.type}`,
        `${COMMAND_META[command.type].label} · ${session.phase}`,
        session.caseId,
      );
    } catch (error) {
      const serviceError =
        error instanceof ServiceError
          ? error
          : new ServiceError('INTERNAL', error instanceof Error ? error.message : 'unknown');
      ack = this.ack(
        command,
        false,
        serviceError.code,
        session.phase,
        now,
        serviceError.message,
        serviceError.detail,
      );
      this.audit.append(
        user,
        `CMD_REJECTED_${command.type}`,
        `${serviceError.code}: ${serviceError.message}`,
        session.caseId,
      );
    }
    session.processedCommands.set(command.id, ack);
    session.commandOrder.push(command.id);
    if (session.commandOrder.length > 300) {
      const oldest = session.commandOrder.shift();
      if (oldest) session.processedCommands.delete(oldest);
    }
    this.emitCommand(session, ack);
    this.persistSession(session);
    return ack;
  }

  private dispatch(
    session: SessionRuntime,
    user: User,
    command: CommandEnvelope,
    now: number,
  ): void {
    switch (command.type) {
      case 'START_PRECHECK':
        this.runPrecheck(session, user, now);
        return;
      case 'ARM':
        this.arm(session, user, command.params as { countersign?: Countersign }, now);
        return;
      case 'DISARM':
        this.requirePhase(session, ['ARMED']);
        this.applyMachine(session, { type: 'DISARM' }, '撤防');
        session.engine.hold();
        return;
      case 'START_AUTO':
        this.startAuto(session, user, command.params, now);
        return;
      case 'PAUSE':
        this.requirePhase(session, ['AUTO_RUNNING']);
        session.engine.hold();
        this.applyMachine(
          session,
          { type: 'PAUSE', reason: String((command.params as { reason?: string }).reason ?? '术者暂停') },
          '术者暂停',
        );
        return;
      case 'RESUME':
        this.resume(session, user, now);
        return;
      case 'TAKEOVER':
        this.requirePhase(session, ['AUTO_RUNNING', 'AUTO_PAUSED']);
        session.engine.hold();
        this.applyMachine(session, { type: 'TAKEOVER' }, '术者接管');
        this.emitNotice(session, 'warn', '术者已接管控制，自动导航已停止');
        return;
      case 'ABORT':
        this.abort(session, user, command.params, now);
        return;
      case 'ESTOP':
        this.estop(session, user, now);
        return;
      case 'RESET_ESTOP':
        this.resetEstop(session, user, command.params, now);
        return;
      case 'ACK_ALARM': {
        const alarmId = String((command.params as { alarmId?: string }).alarmId ?? '');
        this.ackAlarm(session, alarmId, user);
        return;
      }
      case 'PRESENCE':
        this.presence(session, user, now);
        return;
      default:
        throw new ServiceError('UNKNOWN_COMMAND');
    }
  }

  private runPrecheck(session: SessionRuntime, user: User, now: number): PrecheckReport {
    this.requirePhase(session, ['REGISTERED', 'MANUAL']);
    const devices = session.devices;
    const report = buildPrecheck({
      treMm: session.registration.treMm,
      plan: session.plan,
      coilTemps: devices.coils.map((c) => c.temperatureC),
      coilsEnabled: devices.coils.filter((c) => c.enabled).length,
      estopClosed: devices.estop.circuitClosed,
      latencyP95Ms: devices.network.latencyMs,
    });
    session.precheck = {
      items: report.items,
      passed: report.passed,
      ranAt: now,
      ranBy: user.id,
    };
    session.precheckPhase = session.phase;
    this.sendMachine(session, { type: 'PRECHECK_UPDATED', items: report.items });
    this.emitPrecheck(session, session.precheck);
    this.audit.append(
      user,
      'PRECHECK',
      `${report.passed ? '通过' : '未通过'} · ${report.items.filter((i) => !i.passed).map((i) => i.label).join('、') || '全部项目'}`,
      session.caseId,
    );
    if (!report.passed) {
      const failed = report.items.filter((i) => !i.passed).map((i) => i.label);
      this.emitNotice(session, 'warn', `预检未通过：${failed.join('、')}`);
    }
    this.persistSession(session);
    return session.precheck;
  }

  private arm(
    session: SessionRuntime,
    user: User,
    params: { countersign?: Countersign },
    now: number,
  ): void {
    this.requirePhase(session, ['REGISTERED', 'MANUAL']);
    if (!session.precheck?.passed) {
      throw new ServiceError('PRECHECK_REQUIRED', '请先完成飞行前预检且全部通过');
    }
    if (session.phase === 'MANUAL' && session.precheckPhase !== 'MANUAL') {
      throw new ServiceError('PRECHECK_REQUIRED', '接管后必须重新预检方可再次武装');
    }
    if (session.plan.status !== 'approved') {
      throw new ServiceError('PLAN_NOT_APPROVED', '计划尚未审核签字');
    }
    if (!session.plan.feasibility.passed) {
      throw new ServiceError('PLAN_INFEASIBLE', '计划未通过磁导航可行性校验');
    }
    if (session.registration.treMm > LIMITS.treMaxMm) {
      throw new ServiceError('TRE_EXCEEDED');
    }
    const estopLatched = session.actor.getSnapshot().context.estopLatched;
    if (estopLatched) throw new ServiceError('ESTOP_LATCHED');
    const countersign = params.countersign;
    if (!countersign) throw new ServiceError('COUNTERSIGN_REQUIRED');
    const second = userByBadge(countersign.badge);
    if (
      !second ||
      !second.active ||
      !verifyPin(second, countersign.pin) ||
      second.id === user.id ||
      !can(second.role, 'procedure:countersign')
    ) {
      throw new ServiceError('COUNTERSIGN_INVALID', '第二人确认失败：工牌或口令错误');
    }

    this.sendMachine(session, {
      type: 'SET_COUNTERSIGN',
      armedBy: user.id,
      countersignedBy: second.id,
    });
    this.applyMachine(session, { type: 'PRECHECK_PASSED' }, '双人确认完成，进入武装态');
    if (session.phase !== 'ARMED') {
      throw new ServiceError('PRECHECK_FAILED', '武装条件不满足');
    }
    session.engine.hold();
    session.lastPresenceAt = now;
    this.audit.append(
      user,
      'ARM',
      `术者 ${user.name} + 第二人 ${second.name}（${second.badge}）确认武装`,
      session.caseId,
    );
    this.emitNotice(session, 'warn', `已武装：术者 ${user.name} / 助手 ${second.name}`);
    this.persistSession(session);
  }

  private startAuto(
    session: SessionRuntime,
    user: User,
    params: Record<string, unknown>,
    now: number,
  ): void {
    this.requirePhase(session, ['ARMED']);
    if (params.confirm !== true) throw new ServiceError('CONFIRM_REQUIRED');
    const ctx = session.actor.getSnapshot().context;
    if (ctx.estopLatched) throw new ServiceError('ESTOP_LATCHED');
    if (!session.precheck?.passed) throw new ServiceError('PRECHECK_FAILED');
    if (session.plan.status !== 'approved') throw new ServiceError('PLAN_NOT_APPROVED');
    if (!session.plan.feasibility.passed) throw new ServiceError('PLAN_INFEASIBLE');
    if (session.engine.sMm > 0.5 && session.engine.sMm < session.engine.totalMm) {
      session.engine.resume();
    } else {
      session.engine.start();
    }
    session.startedAt = session.startedAt ?? now;
    session.lastPresenceAt = now;
    session.lastClientAt = now;
    this.applyMachine(session, { type: 'START_AUTO' }, '自动导航开始');
    if (session.phase !== 'AUTO_RUNNING') {
      session.engine.hold();
      throw new ServiceError('BAD_STATE', '状态机拒绝启动自动导航');
    }
    this.audit.append(
      user,
      'START_AUTO',
      `启动自动导航 · ${session.plan.name} · 预计 ${session.plan.etaSeconds}s`,
      session.caseId,
    );
    this.emitNotice(
      session,
      'info',
      `自动导航已启动 · ${session.plan.segments.length} 段 / ${session.plan.totalLengthMm.toFixed(0)} mm`,
    );
    this.emitDeadman(session);
    this.broadcastSnapshot(session);
  }

  private resume(session: SessionRuntime, user: User, now: number): void {
    this.requirePhase(session, ['AUTO_PAUSED']);
    const ctx = session.actor.getSnapshot().context;
    if (ctx.estopLatched) throw new ServiceError('ESTOP_LATCHED');
    const highUnacked = session.alarms.filter(
      (a) => a.severity === 'high' && !a.acknowledged && !a.clearedAt,
    );
    if (highUnacked.length > 0) {
      throw new ServiceError(
        'ALARM_PENDING',
        `存在 ${highUnacked.length} 条未确认的高等级告警`,
        '请先确认告警并检查原因是否消除',
      );
    }
    session.engine.resume();
    session.lastPresenceAt = now;
    session.lastClientAt = now;
    this.applyMachine(session, { type: 'RESUME' }, '暂停原因已确认，继续自动导航');
    if (session.phase !== 'AUTO_RUNNING') {
      session.engine.hold();
      throw new ServiceError('BAD_STATE', '状态机拒绝继续');
    }
    this.audit.append(user, 'RESUME', '继续自动导航', session.caseId);
    this.emitDeadman(session);
  }

  private abort(
    session: SessionRuntime,
    user: User,
    params: Record<string, unknown>,
    now: number,
  ): void {
    this.requirePhase(session, ['ARMED', 'AUTO_RUNNING', 'AUTO_PAUSED', 'MANUAL']);
    if (params.confirm !== true) throw new ServiceError('CONFIRM_REQUIRED');
    const reason = String(params.reason ?? '术者中止');
    this.applyMachine(session, { type: 'ABORT', reason }, reason);
    session.engine.abort();
    this.audit.append(user, 'ABORT', `中止并回撤：${reason}`, session.caseId);
    this.emitNotice(session, 'danger', '中止指令已执行 · 正在回撤器械');
    if (session.engine.sMm <= 0.5) {
      session.engine.effects.length = 0;
      this.applyMachine(session, { type: 'ABORT_DONE' }, '回撤完成');
    }
  }

  private estop(session: SessionRuntime, user: User, now: number): void {
    this.requirePhase(session, ['ARMED', 'AUTO_RUNNING', 'AUTO_PAUSED', 'MANUAL']);
    const ctx = session.actor.getSnapshot().context;
    if (ctx.estopLatched) throw new ServiceError('ALREADY_LATCHED');
    session.engine.hold();
    this.applyMachine(session, { type: 'ESTOP' }, '软件急停触发');
    this.raiseAlarm(session, 'ESTOP_ACTIVE', '软件急停已触发，运动指令已切断；硬件回路状态正常');
    this.audit.append(user, 'ESTOP', '触发软件急停', session.caseId);
    this.emitNotice(session, 'danger', '软件急停已触发 · 所有运动指令被阻断');
    this.broadcastSnapshot(session);
    void now;
  }

  private resetEstop(
    session: SessionRuntime,
    user: User,
    params: Record<string, unknown>,
    now: number,
  ): void {
    this.requirePhase(session, ['AUTO_PAUSED', 'ARMED', 'MANUAL']);
    if (params.confirm !== true) throw new ServiceError('CONFIRM_REQUIRED');
    this.sendMachine(session, { type: 'RESET_ESTOP' });
    const alarm = session.alarms.find((a) => a.code === 'ESTOP_ACTIVE' && !a.clearedAt);
    if (alarm) {
      alarm.acknowledged = true;
      alarm.acknowledgedBy = user.id;
      alarm.acknowledgedAt = now;
      alarm.clearedAt = now;
      this.emitAlarmUpdate(session, alarm);
    }
    this.audit.append(user, 'RESET_ESTOP', '复位软件急停（现场已确认安全）', session.caseId);
    this.emitNotice(session, 'warn', '软件急停已复位 · 继续前请再次确认现场安全');
    this.persistSession(session);
    this.broadcastSnapshot(session);
  }

  private presence(session: SessionRuntime, user: User, now: number): void {
    this.requirePhase(session, ['ARMED', 'AUTO_RUNNING', 'AUTO_PAUSED', 'MANUAL']);
    session.lastPresenceAt = now;
    this.emitDeadman(session);
    this.audit.append(user, 'PRESENCE', '术者确认在场', session.caseId);
    this.persistSession(session);
  }

  private ackAlarm(session: SessionRuntime, alarmId: string, user: User): void {
    const alarm = session.alarms.find((a) => a.id === alarmId);
    if (!alarm) throw new ServiceError('ALARM_NOT_FOUND');
    if (!alarm.acknowledged) {
      alarm.acknowledged = true;
      alarm.acknowledgedBy = user.id;
      alarm.acknowledgedAt = Date.now();
      this.emitAlarmUpdate(session, alarm);
      this.audit.append(user, 'ACK_ALARM', `确认告警 ${alarm.code}`, session.caseId);
      this.persistSession(session);
    }
  }

  private requirePhase(session: SessionRuntime, phases: ProcedurePhase[]): void {
    if (!phases.includes(session.phase)) {
      throw new ServiceError(
        'BAD_STATE',
        `当前阶段 ${session.phase} 不允许该操作`,
      );
    }
  }

  private ack(
    command: CommandEnvelope,
    ok: boolean,
    code: string,
    phase: ProcedurePhase,
    now: number,
    message?: string,
    detail?: string,
  ): CommandAck {
    return {
      id: command.id,
      ok,
      code,
      message: message ?? (ok ? '已执行' : rejectionMessage(code)),
      serverPhase: phase,
      receivedAt: now,
      detail: detail ? { detail } : undefined,
    };
  }

  /* ---------------------------------------------------------------- */
  /* planning / registration / devices                                 */
  /* ---------------------------------------------------------------- */

  createCase(
    input: {
      nameMasked: string;
      sex: 'M' | 'F';
      age: number;
      diagnosis: string;
      procedure: string;
      weightKg?: number;
    },
    user: User,
  ): CaseDetail {
    if (!can(user.role, 'case:create')) throw new ServiceError('FORBIDDEN');
    if (!input.nameMasked?.trim() || !input.diagnosis?.trim()) {
      throw new ServiceError('BAD_STATE', '病例信息不完整');
    }
    this.caseSeq += 1;
    const id = `case-${this.caseSeq}`;
    const code = `C-2026-${this.caseSeq}`;
    const now = Date.now();
    const record: CaseRecord = {
      id,
      code,
      patient: {
        id: `p-${this.caseSeq}`,
        nameMasked: input.nameMasked.trim().slice(0, 4),
        sex: input.sex,
        age: Math.max(1, Math.min(120, Math.round(input.age))),
        mrnMasked: `MRN-****-${this.caseSeq}`,
        diagnosis: input.diagnosis.trim(),
        procedure: input.procedure?.trim() || '磁导航介入',
        weightKg: input.weightKg ?? 65,
        allergies: [],
      },
      status: 'planning',
      createdAt: now,
      updatedAt: now,
      createdBy: user.id,
      progressPct: 0,
    };
    this.cases.set(id, record);
    const tree = createVesselTree(id, {
      rotationDeg: ((this.caseSeq * 7) % 11) - 5,
      scale: 0.98 + (this.caseSeq % 3) * 0.02,
      zOffset: (this.caseSeq % 5) - 2,
    });
    this.trees.set(id, tree);
    const registration = defaultRegistration(id, 0.9, 'u-tech');
    this.registrations.set(id, registration);
    this.store?.saveCase(record);
    this.store?.saveTree(tree);
    this.store?.saveRegistration(registration);
    this.audit.append(
      user,
      'CASE_CREATE',
      `新建病例 ${code} · ${record.patient.nameMasked} · ${record.patient.diagnosis}`,
      id,
    );
    return this.getCaseDetail(id, user);
  }

  composePlanForCase(
    caseId: string,
    target: { branchId?: string; index?: number; point?: [number, number, number] },
    name: string | undefined,
    user: User,
  ): Plan {
    if (!can(user.role, 'plan:compose')) throw new ServiceError('FORBIDDEN');
    const tree = this.getTree(caseId);
    const plan = composePlan({
      caseId,
      tree,
      name: name?.trim() || '自动导航计划',
      createdBy: user.id,
      target,
    });
    this.plans.set(plan.id, plan);
    const record = this.getCase(caseId);
    record.status = 'planning';
    record.updatedAt = Date.now();
    record.lastPlanId = plan.id;
    this.store?.savePlan(plan);
    this.store?.saveCase(record);
    this.audit.append(
      user,
      'PLAN_COMPOSE',
      `${plan.name} · ${plan.segments.length} 段 · ${plan.totalLengthMm.toFixed(0)} mm · 可行性 ${plan.feasibility.passed ? '通过' : '未通过'}`,
      caseId,
    );
    return plan;
  }

  approvePlan(planId: string, user: User, pin: string): Plan {
    if (!can(user.role, 'plan:approve')) throw new ServiceError('FORBIDDEN');
    const stored = userById(user.id);
    if (!stored || !verifyPin(stored, pin)) {
      throw new ServiceError('FORBIDDEN', '签名口令错误');
    }
    const plan = this.getPlan(planId);
    if (!plan.feasibility.passed) throw new ServiceError('PLAN_INFEASIBLE');
    plan.status = 'approved';
    plan.approvedBy = user.id;
    plan.approvedAt = Date.now();
    const record = this.getCase(plan.caseId);
    record.status = 'plan_ready';
    record.updatedAt = Date.now();
    record.lastPlanId = plan.id;
    const session = this.getActiveSessionForCase(plan.caseId);
    if (session) {
      this.sendMachine(session, { type: 'SET_PLAN', approved: true, feasible: true });
      if (session.phase === 'SEGMENTED') {
        this.applyMachine(session, { type: 'PLAN_CONFIRMED' }, '计划已审核签字');
      }
      this.persistSession(session);
    }
    this.store?.savePlan(plan);
    this.store?.saveCase(record);
    this.audit.append(
      user,
      'PLAN_APPROVE',
      `审核签字：${plan.name} · ${plan.totalLengthMm.toFixed(0)} mm`,
      plan.caseId,
    );
    return plan;
  }

  verifyRegistration(caseId: string, user: User): RegistrationInfo {
    if (!can(user.role, 'procedure:prepare')) throw new ServiceError('FORBIDDEN');
    this.getCase(caseId);
    const sequence = [0.7, 0.9, 1.2, 0.8, 1.1, 0.6];
    const tre = sequence[Math.floor(Date.now() / 1000) % sequence.length]!;
    const registration = defaultRegistration(caseId, tre, user.id);
    this.registrations.set(caseId, registration);
    this.store?.saveRegistration(registration);
    const session = this.getActiveSessionForCase(caseId);
    if (session) {
      session.registration = registration;
      this.sendMachine(session, { type: 'SET_TRE', treMm: tre });
      if (tre > LIMITS.treMaxMm) {
        this.raiseAlarm(session, 'TRE_EXCEEDED', `配准残差 ${tre.toFixed(1)} mm 超过 ${LIMITS.treMaxMm} mm`);
      }
      this.persistSession(session);
    }
    this.audit.append(
      user,
      'REGISTRATION_VERIFY',
      `重新配准完成 · TRE ${tre.toFixed(1)} mm · 置信度 ${(registration.confidence * 100).toFixed(0)}%`,
      caseId,
    );
    return registration;
  }

  selfTestCoils(user: User): DeviceSnapshot {
    if (user.role !== 'engineer' && user.role !== 'surgeon') {
      throw new ServiceError('FORBIDDEN');
    }
    const devices = this.initialDevices();
    devices.coils = devices.coils.map((coil, i) => ({
      ...coil,
      temperatureC: Number((32 + (i % 4) * 0.7).toFixed(1)),
      enabled: true,
      saturated: false,
    }));
    this.audit.append(user, 'DEVICE_SELFTEST', '线圈阵列自检 12/12 通过', 'device');
    return devices;
  }

  injectFault(
    sessionId: string,
    type: 'tre' | 'force' | 'saturation' | 'gradient' | 'link' | 'clear',
    user: User,
  ): SessionSnapshot {
    if (user.role !== 'engineer' && user.role !== 'surgeon') {
      throw new ServiceError('FORBIDDEN');
    }
    const session = this.getSession(sessionId);
    const now = Date.now();
    if (type === 'clear') {
      session.engine.injection = { forceSpike: false, saturation: false, gradientSpike: false };
      if (session.registration.treMm > LIMITS.treMaxMm) {
        session.registration.treMm = 0.9;
        this.sendMachine(session, { type: 'SET_TRE', treMm: 0.9 });
      }
      for (const alarm of session.alarms) {
        if (!alarm.clearedAt) {
          alarm.clearedAt = now;
          alarm.acknowledged = true;
          alarm.acknowledgedBy = user.id;
          alarm.acknowledgedAt = now;
          this.emitAlarmUpdate(session, alarm);
        }
      }
      this.emitNotice(session, 'info', '故障注入已清除');
      this.audit.append(user, 'FAULT_CLEAR', '清除故障注入', session.caseId);
      this.persistSession(session);
      return this.buildSnapshot(session, user, now);
    }
    if (type === 'tre') {
      session.registration.treMm = 2.4;
      this.sendMachine(session, { type: 'SET_TRE', treMm: 2.4 });
      this.raiseAlarm(session, 'TRE_EXCEEDED', '注入故障：配准残差 2.4 mm > 1.5 mm');
      this.pauseForFault(session, 'TRE_EXCEEDED', '配准残差 2.4 mm 超限');
    } else if (type === 'force') {
      session.engine.injection.forceSpike = true;
      this.raiseAlarm(session, 'FORCE_LATERAL', '注入故障：侧向接触力 0.62 N > 0.50 N');
      this.pauseForFault(session, 'FORCE_LATERAL', '侧向接触力超限');
    } else if (type === 'saturation') {
      session.engine.injection.saturation = true;
      this.raiseAlarm(session, 'COIL_SATURATED', '注入故障：C7 线圈饱和');
      this.pauseForFault(session, 'COIL_SATURATED', '线圈 C7 饱和');
    } else if (type === 'gradient') {
      session.engine.injection.gradientSpike = true;
      this.raiseAlarm(session, 'GRAD_LIMIT', '注入故障：梯度需求超过 0.95 T/m');
    } else if (type === 'link') {
      this.raiseAlarm(session, 'LINK_LOST', '注入故障：控制台链路中断');
      this.pauseForFault(session, 'LINK_LOST', '控制台链路中断（注入）');
    }
    this.audit.append(user, 'FAULT_INJECT', `注入故障：${type}`, session.caseId);
    this.emitNotice(session, 'warn', `故障注入：${type}`);
    this.persistSession(session);
    return this.buildSnapshot(session, user, now);
  }

  private pauseForFault(session: SessionRuntime, code: string, reason: string): void {
    if (session.phase !== 'AUTO_RUNNING') return;
    session.engine.hold();
    this.applyMachine(session, { type: 'FAULT', reason }, reason, code);
    this.audit.append(SYSTEM_ACTOR, 'AUTO_PAUSE', `${code}: ${reason}`, session.caseId);
  }

  /* ---------------------------------------------------------------- */
  /* review                                                            */
  /* ---------------------------------------------------------------- */

  getReviewReport(sessionId: string): ReviewReport {
    const session = this.getSession(sessionId);
    const frames = session.trace.slice();
    const plan = session.plan;
    const durationS =
      session.startedAt === null
        ? 0
        : ((session.endedAt ?? Date.now()) - session.startedAt) / 1000;

    let maxLateral = 0;
    let maxGrad = 0;
    let maxTorque = 0;
    let maxDeviation = 0;
    let speedSum = 0;
    for (let i = 0; i < frames.length; i += 1) {
      const f = frames[i]!;
      maxLateral = Math.max(maxLateral, f.lateral);
      maxGrad = Math.max(maxGrad, f.grad);
      maxTorque = Math.max(maxTorque, f.torque);
      if (i % 5 === 0) {
        const nearest = nearestOnPolyline(plan.path, f.tip);
        maxDeviation = Math.max(maxDeviation, nearest.distanceMm);
      }
      if (i > 0) {
        const prev = frames[i - 1]!;
        const dt = f.t - prev.t;
        if (dt > 0) speedSum += V.dist(prev.tip, f.tip) / dt;
      }
    }
    const movingSamples = Math.max(1, frames.length - 1);
    const phaseCounts = new Map<ProcedurePhase, number>();
    for (const p of session.phases) {
      phaseCounts.set(p.phase, (phaseCounts.get(p.phase) ?? 0) + 1);
    }
    const stats: ReviewStats = {
      durationS: Number(durationS.toFixed(1)),
      pathLengthMm: Number(plan.totalLengthMm.toFixed(1)),
      maxLateralForceN: Number(maxLateral.toFixed(3)),
      maxGradient: Number(maxGrad.toFixed(3)),
      maxTorque: Number(maxTorque.toFixed(3)),
      maxProgressDeviationMm: Number(maxDeviation.toFixed(2)),
      meanSpeedMmS: Number((speedSum / movingSamples).toFixed(2)),
      pauseCount: phaseCounts.get('AUTO_PAUSED') ?? 0,
      alarmCount: session.alarms.length,
      highAlarmCount: session.alarms.filter((a) => a.severity === 'high').length,
      segmentsCompleted: Math.max(0, ...frames.map((f) => f.segmentIndex)) + 1,
      outcome:
        session.phase === 'COMPLETED'
          ? 'COMPLETED'
          : session.phase === 'ABORTED'
            ? 'ABORTED'
            : 'IN_PROGRESS',
    };

    return {
      sessionId: session.id,
      case: session.record,
      plan,
      startedAt: session.startedAt ?? session.createdAt,
      endedAt: session.endedAt,
      phase: session.phase,
      phases: session.phases.slice(),
      frames,
      events: session.events.slice(-300),
      stats,
      audit: this.audit
        .all()
        .filter((entry) => entry.subject === session.caseId)
        .slice(-80),
      disclaimer: DISCLAIMER,
    };
  }

  /* ---------------------------------------------------------------- */
  /* tick loop                                                         */
  /* ---------------------------------------------------------------- */

  private tick(now: number): void {
    const dt = Math.min(0.25, Math.max(0.001, (now - this.lastTick) / 1000));
    this.lastTick = now;
    for (const session of this.sessions.values()) {
      if (!session.archived) this.checkSafety(session, now);
      const running = session.phase === 'AUTO_RUNNING';

      if (running) {
        // Node timers on Windows tick at ~64 Hz. Sub-stepping keeps the
        // telemetry stream at the specified 120 Hz while integrating physics
        // in small, stable increments.
        const substeps = Math.max(1, Math.min(4, Math.round(dt / 0.008)));
        for (let k = 0; k < substeps; k += 1) {
          const stepTs = now - (substeps - 1 - k) * (dt * 1000) / substeps;
          session.engine.step(dt / substeps);
          this.drainEffects(session, stepTs);
          if (k === substeps - 1 || session.sinks.size > 0) {
            const frame = session.engine.frame(stepTs);
            session.lastFrame = frame;
            if (session.sinks.size > 0) {
              const buffer = this.encodeFrame(frame);
              for (const sink of session.sinks) sink.sendBinary(buffer);
            }
          }
        }
        session.lastTelemetryAt = now;
      } else {
        session.engine.step(dt);
        this.drainEffects(session, now);
        const hz = session.endedAt ? 5 : 30;
        if (now - session.lastTelemetryAt >= (1000 / hz) * 0.9) {
          session.lastTelemetryAt = now;
          const frame = session.engine.frame(now);
          session.lastFrame = frame;
          if (session.sinks.size > 0) {
            const buffer = this.encodeFrame(frame);
            for (const sink of session.sinks) sink.sendBinary(buffer);
          }
        }
      }

      if (now - session.lastDeviceAt >= 1000) {
        this.refreshDevices(session, now);
        session.lastDeviceAt = now;
        this.emitDevice(session);
      }

      if (
        session.startedAt !== null &&
        session.endedAt === null &&
        !session.archived &&
        now - session.lastRecordAt >= 1000 / TELEMETRY.recordHz
      ) {
        session.lastRecordAt = now;
        this.recordReviewFrame(session, now);
      }

      if (this.store && !session.archived && now - session.lastPersistAt >= 2000) {
        this.persistSession(session);
      }
    }
  }

  private checkSafety(session: SessionRuntime, now: number): void {
    if (session.phase !== 'AUTO_RUNNING') return;
    if (now - session.lastPresenceAt > LIMITS.deadmanIntervalMs + LIMITS.deadmanGraceMs) {
      this.raiseAlarm(
        session,
        'DEADMAN_TIMEOUT',
        `超过 ${Math.round((LIMITS.deadmanIntervalMs + LIMITS.deadmanGraceMs) / 1000)} s 未确认在场，自动导航已暂停`,
      );
      this.pauseForFault(session, 'DEADMAN_TIMEOUT', '人在环确认超时');
      this.emitNotice(session, 'warn', '人在环确认超时，自动导航已暂停；确认在场后可继续');
    }
    if (now - session.lastClientAt > 5000) {
      this.raiseAlarm(session, 'LINK_LOST', '控制台心跳丢失超过 5 s，实时层已暂停运动并保持位置');
      this.pauseForFault(session, 'LINK_LOST', '控制台链路中断');
    }
  }

  private drainEffects(session: SessionRuntime, now: number): void {
    if (session.engine.effects.length === 0) return;
    const effects = session.engine.effects.splice(0);
    for (const effect of effects) {
      if (effect.type === 'segment') {
        this.emitSegment(session, effect.index, effect.name, effect.count);
        session.record.progressPct = Math.round(
          (session.engine.sMm / Math.max(1, session.engine.totalMm)) * 100,
        );
        session.record.updatedAt = now;
      } else if (effect.type === 'alarm') {
        this.raiseAlarm(session, effect.code, effect.detail);
      } else if (effect.type === 'arrived') {
        if (session.phase === 'AUTO_RUNNING') {
          this.applyMachine(session, { type: 'TARGET_REACHED' }, '目标点已到达');
          session.record.progressPct = 100;
          session.record.status = 'completed';
          session.record.updatedAt = now;
          this.recordReviewFrame(session, now);
          this.audit.append(SYSTEM_ACTOR, 'TARGET_REACHED', '自动导航到达目标点', session.caseId);
          this.emitNotice(session, 'info', '目标点已到达 · 自动导航完成');
        }
      } else if (effect.type === 'abort_done') {
        if (session.phase === 'ABORTING') {
          this.applyMachine(session, { type: 'ABORT_DONE' }, '器械回撤完成');
          this.emitNotice(session, 'danger', '器械已回撤至入口，流程终止');
        }
      }
    }
  }

  private recordReviewFrame(session: SessionRuntime, now: number): void {
    if (session.startedAt === null) return;
    const frame = session.engine.reviewFrame(session.phase, now);
    const t = (now - session.startedAt) / 1000;
    session.trace.push({ ...frame, t: Number(t.toFixed(2)) });
    if (session.trace.length > 5000) session.trace.shift();
  }

  /* ---------------------------------------------------------------- */
  /* events, alarms, devices                                           */
  /* ---------------------------------------------------------------- */

  private encodeFrame(frame: ReturnType<RobotGateway['frame']>): ArrayBuffer {
    // dynamic import-free: protocol codec is small and synchronous
    return encodeTelemetry(frame);
  }

  private emit(session: SessionRuntime, event: ServerEvent): void {
    session.events.push(event);
    if (session.events.length > 400) session.events.shift();
    this.broadcastJson(session, { kind: 'event', event });
  }

  private emitPhase(
    session: SessionRuntime,
    previous: ProcedurePhase,
    reason: string,
    code?: string,
  ): void {
    this.emit(session, {
      kind: 'phase',
      seq: ++session.eventSeq,
      ts: Date.now(),
      phase: session.phase,
      previous,
      reason,
      code,
    });
  }

  private emitSegment(
    session: SessionRuntime,
    index: number,
    name: string,
    count: number,
  ): void {
    this.emit(session, {
      kind: 'segment',
      seq: ++session.eventSeq,
      ts: Date.now(),
      index,
      name,
      count,
    });
  }

  private emitPrecheck(session: SessionRuntime, report: PrecheckReport): void {
    this.emit(session, {
      kind: 'precheck',
      seq: ++session.eventSeq,
      ts: Date.now(),
      report,
    });
  }

  private emitDevice(session: SessionRuntime): void {
    this.emit(session, {
      kind: 'device',
      seq: ++session.eventSeq,
      ts: Date.now(),
      devices: session.devices,
    });
  }

  private emitDeadman(session: SessionRuntime): void {
    const now = Date.now();
    this.emit(session, {
      kind: 'deadman',
      seq: ++session.eventSeq,
      ts: now,
      deadman: {
        intervalMs: LIMITS.deadmanIntervalMs,
        graceMs: LIMITS.deadmanGraceMs,
        lastConfirmedAt: session.lastPresenceAt,
        dueAt: session.lastPresenceAt + LIMITS.deadmanIntervalMs,
        remainingMs: Math.max(0, session.lastPresenceAt + LIMITS.deadmanIntervalMs - now),
        overdue: now > session.lastPresenceAt + LIMITS.deadmanIntervalMs + LIMITS.deadmanGraceMs,
      },
    });
  }

  private emitNotice(
    session: SessionRuntime,
    tone: 'info' | 'warn' | 'danger',
    message: string,
  ): void {
    this.emit(session, {
      kind: 'notice',
      seq: ++session.eventSeq,
      ts: Date.now(),
      tone,
      message,
    });
  }

  private emitCommand(session: SessionRuntime, ack: CommandAck): void {
    this.emit(session, {
      kind: 'command',
      seq: ++session.eventSeq,
      ts: Date.now(),
      ack,
    });
  }

  raiseAlarm(session: SessionRuntime, code: string, detail: string): Alarm {
    const active = session.alarms.find(
      (a) => a.code === code && !a.clearedAt && !a.acknowledged,
    );
    if (active) return active;
    const def = ALARM_DEFS[code] ?? {
      title: code,
      severity: 'medium' as const,
      action: '请检查设备状态',
    };
    const alarm: Alarm = {
      id: `alarm-${++session.alarmSeq}`,
      code,
      severity: def.severity,
      title: def.title,
      detail,
      source: 'realtime-layer',
      ts: Date.now(),
      acknowledged: false,
    };
    session.alarms.push(alarm);
    if (session.alarms.length > 80) session.alarms.shift();
    this.emit(session, {
      kind: 'alarm',
      seq: ++session.eventSeq,
      ts: alarm.ts,
      alarm,
    });
    return alarm;
  }

  private emitAlarmUpdate(session: SessionRuntime, alarm: Alarm): void {
    this.emit(session, {
      kind: 'alarm_update',
      seq: ++session.eventSeq,
      ts: Date.now(),
      alarmId: alarm.id,
      patch: {
        acknowledged: alarm.acknowledged,
        acknowledgedBy: alarm.acknowledgedBy,
        acknowledgedAt: alarm.acknowledgedAt,
        clearedAt: alarm.clearedAt,
        detail: alarm.detail,
      },
    });
  }

  private applyMachine(
    session: SessionRuntime,
    event: ProcedureEvent,
    reason: string,
    code?: string,
  ): void {
    const previous = session.phase;
    this.sendMachine(session, event);
    const next = phaseOf(session.actor.getSnapshot().value);
    if (next === previous) {
      this.persistSession(session);
      return;
    }
    const now = Date.now();
    session.previousPhase = previous;
    session.phase = next;
    session.phaseChangedAt = now;
    session.phases.push({ phase: next, ts: now });
    this.emitPhase(session, previous, reason, code);

    if (next === 'AUTO_RUNNING') {
      session.startedAt = session.startedAt ?? now;
      session.lastPresenceAt = now;
    }
    if (next === 'MANUAL') {
      // manual takeover invalidates the previous pre-flight run
      session.precheckPhase = null;
    }
    if (next === 'ARMED') {
      session.precheckPhase = 'ARMED';
    }
    if (next === 'COMPLETED' || next === 'ABORTED') {
      session.endedAt = now;
      session.engine.hold();
      session.record.status = next === 'COMPLETED' ? 'completed' : 'plan_ready';
      session.record.updatedAt = now;
      session.record.progressPct = next === 'COMPLETED' ? 100 : session.record.progressPct;
      this.emit(session, {
        kind: 'ended',
        seq: ++session.eventSeq,
        ts: now,
        outcome: next,
      });
      this.broadcastSnapshot(session);
    }
    this.persistSession(session);
  }

  private initialDevices(): DeviceSnapshot {
    const coils: CoilRuntime[] = COIL_SPECS.map((spec, i) => ({
      id: spec.id,
      label: spec.label,
      currentA: 0,
      loadPct: 0,
      temperatureC: Number((32 + (i % 4) * 0.6).toFixed(1)),
      saturated: false,
      enabled: true,
    }));
    return {
      coils,
      tracker: { status: 'ok', rateHz: 120, latencyMs: 4, quality: 0.98 },
      estop: { circuitClosed: true, softwareLatched: false, lastTestAt: Date.now() - 3600_000 },
      fieldGenerator: { status: 'ok', cooling: 92, dutyPct: 0 },
      network: { latencyMs: 42, jitterMs: 6, heartbeatAgeMs: 0 },
      updatedAt: Date.now(),
    };
  }

  private refreshDevices(session: SessionRuntime, now: number): void {
    const currents = session.lastFrame?.coils;
    const ctx = session.actor.getSnapshot().context;
    const coils = session.devices.coils.map((coil, i) => {
      const current = currents?.[i] ?? 0;
      const loadPct = Math.min(1, Math.abs(current) / COIL_SPECS[i]!.maxCurrentA);
      const targetTemp = 32 + loadPct * 26;
      const temperatureC =
        coil.temperatureC + (targetTemp - coil.temperatureC) * 0.18;
      return {
        ...coil,
        currentA: Number(current.toFixed(2)),
        loadPct: Number(loadPct.toFixed(3)),
        temperatureC: Number(temperatureC.toFixed(1)),
        saturated: loadPct >= 0.985,
        enabled: true,
      } satisfies CoilRuntime;
    });
    const load = coils.reduce((acc, c) => acc + c.loadPct, 0) / coils.length;
    session.devices = {
      coils,
      tracker: {
        status: 'ok',
        rateHz: 120,
        latencyMs: 4.2,
        quality: 0.98,
      },
      estop: {
        circuitClosed: true,
        softwareLatched: ctx.estopLatched,
        lastTestAt: session.devices.estop.lastTestAt,
      },
      fieldGenerator: {
        status: 'ok',
        cooling: Math.max(60, 92 - load * 20),
        dutyPct: Number((load * 100).toFixed(1)),
      },
      network: {
        latencyMs: 42 + Math.round(Math.sin(now / 3000) * 3),
        jitterMs: 6,
        heartbeatAgeMs: Math.max(0, now - session.lastClientAt),
      },
      updatedAt: now,
    };
  }

  /* ---------------------------------------------------------------- */
  /* transport helpers                                                 */
  /* ---------------------------------------------------------------- */

  private broadcastJson(session: SessionRuntime, message: ServerMessage): void {
    for (const sink of session.sinks) sink.sendJson(message);
  }

  broadcastSnapshot(session: SessionRuntime): void {
    for (const sink of session.sinks) {
      const user = (sink as SessionSink & { user?: User }).user;
      if (user) {
        sink.sendJson({
          kind: 'snapshot',
          snapshot: this.buildSnapshot(session, user, Date.now()),
          serverTime: Date.now(),
        });
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* archived demo session                                             */
  /* ---------------------------------------------------------------- */

  private seedArchivedSession(): void {
    const record = this.cases.get('case-1033');
    const plan = this.plans.get('plan-1033-rca');
    if (!record || !plan) return;
    const tree = this.trees.get(record.id)!;
    const registration = this.registrations.get(record.id)!;
    const bootstrap = this.bootstrapMachine(plan, registration);
    const actor = bootstrap.actor;
    const session = {
      id: ARCHIVE_SESSION_ID,
      caseId: record.id,
      planId: plan.id,
      record,
      plan,
      tree,
      registration,
      actor,
      phase: 'COMPLETED' as ProcedurePhase,
      previousPhase: 'AUTO_RUNNING' as ProcedurePhase,
      phaseChangedAt: Date.now() - 60_000,
      precheck: null,
      precheckPhase: null,
      alarms: [] as Alarm[],
      alarmSeq: 0,
      devices: this.initialDevices(),
      events: [] as ServerEvent[],
      eventSeq: 0,
      phases: [] as Array<{ phase: ProcedurePhase; ts: number }>,
      engine: this.gatewayFactory(plan),
      sinks: new Set<SessionSink>(),
      createdAt: Date.now() - 3 * 3600_000,
      createdBy: 'u-surgeon',
      startedAt: null as number | null,
      endedAt: null as number | null,
      lastPresenceAt: Date.now(),
      lastClientAt: Date.now(),
      lastDeviceAt: Date.now(),
      lastRecordAt: 0,
      lastTelemetryAt: 0,
      trace: [] as ReviewFrame[],
      processedCommands: new Map<string, CommandAck>(),
      commandOrder: [] as string[],
      lastFrame: null as ReturnType<RobotGateway['frame']> | null,
      archived: true,
      machineEvents: [...bootstrap.events],
      lastPersistAt: 0,
    } as SessionRuntime;

    // Drive the machine through the full happy path (no broadcast).
    const precheck = buildPrecheck({
      treMm: registration.treMm,
      plan,
      coilTemps: session.devices.coils.map((c) => c.temperatureC),
      coilsEnabled: 12,
      estopClosed: true,
      latencyP95Ms: 42,
    });
    session.precheck = {
      items: precheck.items,
      passed: precheck.passed,
      ranAt: Date.now() - 3 * 3600_000 + 60_000,
      ranBy: 'u-surgeon',
    };
    session.precheckPhase = 'REGISTERED';
    this.sendMachine(session, { type: 'PRECHECK_UPDATED', items: precheck.items });
    this.sendMachine(session, { type: 'SET_COUNTERSIGN', armedBy: 'u-surgeon', countersignedBy: 'u-assistant' });
    this.sendMachine(session, { type: 'PRECHECK_PASSED' });
    this.sendMachine(session, { type: 'START_AUTO' });
    this.sendMachine(session, { type: 'TARGET_REACHED' });

    const startTs = Date.now() - 74_000;
    const engine = session.engine;
    engine.demoAlarms = true;
    engine.start();
    const segmentEvents: ServerEvent[] = [];
    let elapsed = 0;
    let arrived = false;
    const trace: ReviewFrame[] = [];
    for (let i = 0; i < 5000 && !arrived; i += 1) {
      engine.step(0.1);
      elapsed += 0.1;
      if (i % 1 === 0) {
        const frame = engine.reviewFrame('AUTO_RUNNING', startTs + elapsed * 1000);
        trace.push({ ...frame, t: Number(elapsed.toFixed(2)) });
      }
      for (const effect of engine.effects) {
        if (effect.type === 'segment') {
          segmentEvents.push({
            kind: 'segment',
            seq: 0,
            ts: startTs + elapsed * 1000,
            index: effect.index,
            name: effect.name,
            count: effect.count,
          });
        }
        if (effect.type === 'arrived') arrived = true;
        if (effect.type === 'alarm') {
          session.alarms.push({
            id: `alarm-archived-${session.alarms.length + 1}`,
            code: effect.code,
            severity: effect.code === 'COIL_TEMP' ? 'medium' : 'low',
            title: effect.code === 'COIL_TEMP' ? '线圈温升偏高' : '接近目标点',
            detail: effect.detail,
            source: 'realtime-layer',
            ts: startTs + elapsed * 1000,
            acknowledged: true,
            acknowledgedBy: 'u-surgeon',
            acknowledgedAt: startTs + elapsed * 1000 + 4000,
          });
        }
      }
      engine.effects.length = 0;
    }
    const endedAt = startTs + elapsed * 1000;
    session.startedAt = startTs;
    session.endedAt = endedAt;
    session.phaseChangedAt = endedAt;
    session.trace = trace;
    session.lastFrame = engine.frame(endedAt);
    session.devices = {
      ...session.devices,
      coils: session.devices.coils.map((c, i) => ({
        ...c,
        currentA: session.lastFrame!.coils[i] ?? 0,
        loadPct: Math.abs(session.lastFrame!.coils[i] ?? 0) / COIL_SPECS[i]!.maxCurrentA,
        temperatureC: 33.5,
      })),
    };
    session.phases = [
      { phase: 'REGISTERED', ts: startTs - 120_000 },
      { phase: 'ARMED', ts: startTs - 90_000 },
      { phase: 'AUTO_RUNNING', ts: startTs },
      { phase: 'COMPLETED', ts: endedAt },
    ];
    session.events = [
      {
        kind: 'phase',
        seq: 1,
        ts: startTs,
        phase: 'AUTO_RUNNING',
        previous: 'ARMED',
        reason: '自动导航开始',
      },
      ...segmentEvents.map((e, i) => ({ ...e, seq: i + 2 })),
      {
        kind: 'phase',
        seq: segmentEvents.length + 2,
        ts: endedAt,
        phase: 'COMPLETED',
        previous: 'AUTO_RUNNING',
        reason: '目标点已到达',
      },
      {
        kind: 'ended',
        seq: segmentEvents.length + 3,
        ts: endedAt,
        outcome: 'COMPLETED',
      },
    ];
    session.eventSeq = session.events.length;
    this.sessions.set(session.id, session);
    record.status = 'completed';
    record.progressPct = 100;
    record.sessionId = session.id;
    record.updatedAt = endedAt;
    this.audit.append(
      { id: 'u-surgeon', name: '赵*峰', role: 'surgeon' },
      'SESSION_CREATE',
      `创建手术会话 ${session.id} · ${plan.name}`,
      record.id,
      startTs - 120_000,
    );
    this.audit.append(
      { id: 'u-surgeon', name: '赵*峰', role: 'surgeon' },
      'PRECHECK',
      '通过 · 全部项目',
      record.id,
      startTs - 110_000,
    );
    this.audit.append(
      { id: 'u-surgeon', name: '赵*峰', role: 'surgeon' },
      'ARM',
      '术者 赵*峰 + 第二人 李*婷（M-1087）确认武装',
      record.id,
      startTs - 90_000,
    );
    this.audit.append(
      { id: 'u-surgeon', name: '赵*峰', role: 'surgeon' },
      'START_AUTO',
      `启动自动导航 · ${plan.name} · 预计 ${plan.etaSeconds}s`,
      record.id,
      startTs,
    );
    this.audit.append(
      SYSTEM_ACTOR,
      'TARGET_REACHED',
      '自动导航到达目标点',
      record.id,
      endedAt,
    );
    this.audit.append(
      { id: 'u-surgeon', name: '赵*峰', role: 'surgeon' },
      'ARCHIVE_IMPORT',
      `演示复盘数据：RCA 自动导航 ${plan.totalLengthMm.toFixed(0)} mm / ${elapsed.toFixed(0)} s`,
      record.id,
      endedAt,
    );
    this.persistSession(session);
  }
}

/** Imported lazily to keep the module graph flat for tests. */
