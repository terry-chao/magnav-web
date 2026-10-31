/**
 * MAGNAV shared protocol
 * ------------------------------------------------------------------
 * Single source of truth for the wire protocol and domain model shared
 * by the console (browser) and the realtime service (Node).
 *
 * Units are explicit everywhere:
 *   positions  mm, patient LPS (+X left, +Y posterior, +Z superior)
 *   time       ms, server wall clock (Unix epoch) unless suffixed
 *   field      mT at the catheter tip
 *   gradient   T/m
 *   torque     mN·m
 *   force      N
 */

export type Vec3 = readonly [number, number, number];
/** x, y, z, w */
export type Quat = readonly [number, number, number, number];

export interface Pose {
  /** mm, patient LPS */
  readonly t: Vec3;
  /** unit quaternion */
  readonly q: Quat;
  /** ms, server clock */
  readonly ts: number;
}

/* ------------------------------------------------------------------ */
/* Identity & access                                                   */
/* ------------------------------------------------------------------ */

export type Role = 'surgeon' | 'assistant' | 'tech' | 'engineer' | 'reviewer';

export interface User {
  id: string;
  badge: string;
  name: string;
  role: Role;
  title: string;
  initials: string;
}

export type Capability =
  | 'case:create'
  | 'plan:compose'
  | 'plan:approve'
  | 'procedure:prepare'
  | 'procedure:arm'
  | 'procedure:countersign'
  | 'procedure:start'
  | 'procedure:control'
  | 'procedure:estop'
  | 'review:view'
  | 'admin:view';

export const ROLE_CAPS: Record<Role, readonly Capability[]> = {
  surgeon: [
    'case:create',
    'plan:compose',
    'plan:approve',
    'procedure:prepare',
    'procedure:arm',
    'procedure:start',
    'procedure:control',
    'procedure:estop',
    'review:view',
  ],
  assistant: [
    'case:create',
    'procedure:prepare',
    'procedure:countersign',
    'procedure:control',
    'procedure:estop',
    'review:view',
  ],
  tech: ['procedure:prepare', 'review:view'],
  engineer: ['admin:view', 'review:view'],
  reviewer: ['admin:view', 'review:view'],
};

export function can(role: Role, cap: Capability): boolean {
  return ROLE_CAPS[role].includes(cap);
}

/* ------------------------------------------------------------------ */
/* Clinical domain                                                     */
/* ------------------------------------------------------------------ */

export type CaseStatus = 'planning' | 'plan_ready' | 'in_progress' | 'completed' | 'archived';

export interface Patient {
  id: string;
  /** de-identified: first character + mask */
  nameMasked: string;
  sex: 'M' | 'F';
  age: number;
  mrnMasked: string;
  diagnosis: string;
  procedure: string;
  weightKg: number;
  allergies: string[];
}

export interface CaseRecord {
  id: string;
  code: string;
  patient: Patient;
  status: CaseStatus;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  progressPct: number;
  lastPlanId?: string;
  sessionId?: string;
}

export interface Stenosis {
  /** sample index on the branch */
  atIndex: number;
  severityPct: number;
  label: string;
}

export interface VesselBranch {
  id: string;
  name: string;
  fullName: string;
  parentId: string | null;
  /** resampled centerline, mm LPS, spacing ~2 mm */
  points: Vec3[];
  /** radius per point, mm */
  radii: number[];
  stenosis?: Stenosis;
  /** displayed accent, 0-1 */
  tone: number;
}

export interface VesselTree {
  caseId: string;
  branches: VesselBranch[];
  bounds: { min: Vec3; max: Vec3 };
  stats: { branchCount: number; totalLengthMm: number; minRadiusMm: number };
}

export interface RegistrationInfo {
  caseId: string;
  treMm: number;
  targetTreMm: number;
  confidence: number;
  /** row-major 4x4, tracker → patient LPS */
  matrix: number[];
  method: 'DSA-3D' | 'CT-MR' | 'FUSION';
  verifiedAt: number;
  verifiedBy: string;
  residualMap: Array<{ t: Vec3; errorMm: number }>;
}

export type PlanStatus = 'draft' | 'simulated' | 'approved';

export interface FeasibilityPoint {
  sMm: number;
  bMilliTesla: number;
  gradTeslaPerM: number;
  torqueMilliNm: number;
  curvature: number;
  margin: number;
  saturated: boolean;
}

export interface FeasibilityReport {
  passed: boolean;
  model: 'dipole-v1';
  maxB: number;
  maxGrad: number;
  maxTorque: number;
  maxCurvature: number;
  minMargin: number;
  targetB: number;
  points: FeasibilityPoint[];
  warnings: string[];
  computedAt: number;
}

export interface PlanSegment {
  index: number;
  name: string;
  startS: number;
  endS: number;
  lengthMm: number;
  maxCurvature: number;
  nominalSpeedMmS: number;
  etaSeconds: number;
  risk: 'low' | 'medium' | 'high';
}

export interface Plan {
  id: string;
  caseId: string;
  name: string;
  approach: string;
  targetBranchId: string;
  targetS: number;
  target: Vec3;
  /** resampled path from entry to target, ~1.5 mm spacing */
  path: Vec3[];
  radii: number[];
  totalLengthMm: number;
  etaSeconds: number;
  segments: PlanSegment[];
  feasibility: FeasibilityReport;
  status: PlanStatus;
  createdBy: string;
  createdAt: number;
  approvedBy?: string;
  approvedAt?: number;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Procedure phases & state machine                                    */
/* ------------------------------------------------------------------ */

export type ProcedurePhase =
  | 'IDLE'
  | 'CASE_READY'
  | 'SEGMENTED'
  | 'PLAN_READY'
  | 'REGISTERED'
  | 'ARMED'
  | 'AUTO_RUNNING'
  | 'AUTO_PAUSED'
  | 'MANUAL'
  | 'ABORTING'
  | 'ABORTED'
  | 'COMPLETED';

export type PhaseTone = 'neutral' | 'info' | 'planning' | 'success' | 'warn' | 'danger' | 'running';

export interface PhaseMeta {
  label: string;
  short: string;
  tone: PhaseTone;
  /** 0 = not started, 1..5 readiness, 6 = running, 7 = closed */
  step: number;
  hint: string;
}

export const PHASE_META: Record<ProcedurePhase, PhaseMeta> = {
  IDLE: { label: '空闲', short: 'IDLE', tone: 'neutral', step: 0, hint: '未加载病例' },
  CASE_READY: { label: '病例就绪', short: 'CASE READY', tone: 'info', step: 1, hint: '等待影像与分割结果' },
  SEGMENTED: { label: '血管已分割', short: 'SEGMENTED', tone: 'planning', step: 2, hint: '请生成并审核导航计划' },
  PLAN_READY: { label: '计划就绪', short: 'PLAN READY', tone: 'planning', step: 3, hint: '等待配准确认' },
  REGISTERED: { label: '已配准', short: 'REGISTERED', tone: 'info', step: 4, hint: '请运行飞行前预检' },
  ARMED: { label: '已武装', short: 'ARMED', tone: 'warn', step: 5, hint: '已满足启动条件，可启动自动导航' },
  AUTO_RUNNING: { label: '自动运行', short: 'AUTO RUNNING', tone: 'running', step: 6, hint: '监督自动导航，随时可接管' },
  AUTO_PAUSED: { label: '自动暂停', short: 'PAUSED', tone: 'warn', step: 6, hint: '确认原因消除后方可继续' },
  MANUAL: { label: '手动接管', short: 'MANUAL', tone: 'warn', step: 6, hint: '术者已接管，重新预检后可回到武装' },
  ABORTING: { label: '中止中', short: 'ABORTING', tone: 'danger', step: 7, hint: '正在回撤器械，请勿操作' },
  ABORTED: { label: '已中止', short: 'ABORTED', tone: 'danger', step: 7, hint: '流程已安全终止' },
  COMPLETED: { label: '已完成', short: 'COMPLETED', tone: 'success', step: 7, hint: '目标已到达' },
};

export const ACTIVE_PHASES: readonly ProcedurePhase[] = ['ARMED', 'AUTO_RUNNING', 'AUTO_PAUSED', 'MANUAL'];

export type CommandType =
  | 'START_PRECHECK'
  | 'ARM'
  | 'DISARM'
  | 'START_AUTO'
  | 'PAUSE'
  | 'RESUME'
  | 'TAKEOVER'
  | 'ABORT'
  | 'ESTOP'
  | 'RESET_ESTOP'
  | 'ACK_ALARM'
  | 'PRESENCE';

export interface Countersign {
  badge: string;
  pin: string;
}

export interface CommandEnvelope<T = Record<string, unknown>> {
  /** uuid — idempotency key */
  id: string;
  type: CommandType;
  params: T;
  issuedBy: string;
  issuedAt: number;
  expectedState: ProcedurePhase;
  nonce: string;
}

export interface CommandAck {
  id: string;
  ok: boolean;
  code: string;
  message: string;
  serverPhase: ProcedurePhase;
  receivedAt: number;
  detail?: Record<string, unknown>;
}

export interface CommandMeta {
  label: string;
  hint: string;
  /** destructive → 800 ms long press */
  hold?: boolean;
  tone?: 'default' | 'primary' | 'danger' | 'warn';
}

export const COMMAND_META: Record<CommandType, CommandMeta> = {
  START_PRECHECK: { label: '运行预检', hint: '检查影像、配准、线圈、急停与通信', tone: 'primary' },
  ARM: { label: '双人确认武装', hint: '术者 + 助手确认后进入武装态', tone: 'warn' },
  DISARM: { label: '撤防', hint: '退出武装态' },
  START_AUTO: { label: '启动自动导航', hint: '开始执行已审核计划', tone: 'primary' },
  PAUSE: { label: '暂停', hint: '冻结运动，保持当前位置', tone: 'warn' },
  RESUME: { label: '继续', hint: '确认暂停原因已消除后继续', tone: 'primary' },
  TAKEOVER: { label: '接管', hint: '立即由术者手动控制', tone: 'warn' },
  ABORT: { label: '中止并回撤', hint: '中止导航并回撤导管', tone: 'danger', hold: true },
  ESTOP: { label: '急停', hint: '切断运动指令（硬件回路仍生效）', tone: 'danger' },
  RESET_ESTOP: { label: '复位急停', hint: '确认现场安全后复位软件急停' },
  ACK_ALARM: { label: '确认告警', hint: '确认已知悉告警' },
  PRESENCE: { label: '确认在场', hint: '自动模式保持人在环确认' },
};

/* ------------------------------------------------------------------ */
/* Pre-flight, alarms, devices                                         */
/* ------------------------------------------------------------------ */

export interface PrecheckItem {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
  value?: string;
  limit?: string;
  severity: 'required' | 'advisory';
}

export interface PrecheckReport {
  items: PrecheckItem[];
  passed: boolean;
  ranAt: number;
  ranBy: string;
}

export type AlarmSeverity = 'high' | 'medium' | 'low';

export interface Alarm {
  id: string;
  code: string;
  severity: AlarmSeverity;
  title: string;
  detail: string;
  source: string;
  ts: number;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  clearedAt?: number;
}

export interface AlarmDefinition {
  title: string;
  severity: AlarmSeverity;
  action: string;
}

export const ALARM_DEFS: Record<string, AlarmDefinition> = {
  POSE_STALE: { title: '位姿数据中断', severity: 'high', action: '保持原位，检查跟踪器与网络' },
  LINK_LOST: { title: '控制台链路中断', severity: 'high', action: '自动导航已暂停，请恢复链路' },
  GRAD_LIMIT: { title: '磁场梯度接近上限', severity: 'high', action: '降低梯度或暂停推进' },
  COIL_SATURATED: { title: '线圈饱和', severity: 'high', action: '暂停并降低梯度需求' },
  FORCE_LATERAL: { title: '侧向接触力超限', severity: 'high', action: '暂停推进，评估血管壁接触' },
  TRE_EXCEEDED: { title: '配准残差超限', severity: 'high', action: '重新配准后恢复' },
  DEADMAN_TIMEOUT: { title: '人在环确认超时', severity: 'medium', action: '确认术者在场后继续' },
  ESTOP_ACTIVE: { title: '软件急停已触发', severity: 'high', action: '确认现场安全后复位急停' },
  COIL_TEMP: { title: '线圈温升偏高', severity: 'medium', action: '降低负载，观察温升' },
  TRACKER_DEGRADED: { title: '跟踪器质量下降', severity: 'medium', action: '检查传感器与金属干扰' },
  APPROACHING_TARGET: { title: '接近目标点', severity: 'low', action: '准备确认到达' },
  SEGMENT_START: { title: '进入新分段', severity: 'low', action: '监督分段执行' },
};

export interface CoilSpec {
  id: string;
  label: string;
  /** mm LPS */
  position: Vec3;
  /** unit axis pointing toward isocentre */
  axis: Vec3;
  maxCurrentA: number;
  ring: number;
}

export interface CoilRuntime {
  id: string;
  label: string;
  currentA: number;
  loadPct: number;
  temperatureC: number;
  saturated: boolean;
  enabled: boolean;
}

export interface DeviceSnapshot {
  coils: CoilRuntime[];
  tracker: { status: 'ok' | 'degraded' | 'lost'; rateHz: number; latencyMs: number; quality: number };
  estop: { circuitClosed: boolean; softwareLatched: boolean; lastTestAt: number };
  fieldGenerator: { status: 'ok' | 'fault'; cooling: number; dutyPct: number };
  network: { latencyMs: number; jitterMs: number; heartbeatAgeMs: number };
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Telemetry                                                           */
/* ------------------------------------------------------------------ */

export interface FieldSample {
  /** mT */
  b: Vec3;
  /** T/m */
  grad: number;
  /** mN·m */
  torque: number;
}

export interface ForceSample {
  /** N */
  axial: number;
  /** N */
  lateral: number;
}

export interface TelemetryFrame {
  seq: number;
  /** ms, server clock */
  ts: number;
  tip: Pose;
  /** N*3, LPS, resampled catheter centreline */
  shape: Float32Array;
  moment: Vec3;
  coils: Float32Array;
  field: FieldSample;
  force: ForceSample;
  flags: number;
  /** 0..1 along plan */
  progress: number;
  segmentIndex: number;
  speedMmS: number;
}

export const FLAG = {
  SATURATED: 1 << 0,
  GRAD_LIMIT: 1 << 1,
  FORCE_LIMIT: 1 << 2,
  STALE: 1 << 3,
  DEGRADED: 1 << 4,
  NEAR_TARGET: 1 << 5,
  ESTOP: 1 << 6,
} as const;

export function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}

/* ------------------------------------------------------------------ */
/* Realtime envelopes                                                  */
/* ------------------------------------------------------------------ */

export interface ProcedureContextView {
  treMm: number;
  precheckPassed: boolean;
  armedBy?: string;
  countersignedBy?: string;
  pauseReason?: string;
  estopLatched: boolean;
  startedAt?: number;
  completedAt?: number;
  abortReason?: string;
}

export interface DeadmanState {
  intervalMs: number;
  graceMs: number;
  lastConfirmedAt: number;
  dueAt: number;
  remainingMs: number;
  overdue: boolean;
}

export interface SessionSnapshot {
  sessionId: string;
  case: CaseRecord;
  plan: Plan;
  tree: VesselTree;
  registration: RegistrationInfo;
  phase: ProcedurePhase;
  previousPhase: ProcedurePhase;
  phaseChangedAt: number;
  context: ProcedureContextView;
  precheck: PrecheckReport | null;
  alarms: Alarm[];
  devices: DeviceSnapshot;
  deadman: DeadmanState;
  progress: number;
  segmentIndex: number;
  events: ServerEvent[];
  audit: AuditEntry[];
  user: User;
  serverTime: number;
  startedAt: number | null;
  endedAt: number | null;
  simSpeed: number;
}

export type ServerEvent =
  | {
      kind: 'phase';
      seq: number;
      ts: number;
      phase: ProcedurePhase;
      previous: ProcedurePhase;
      reason: string;
      code?: string;
    }
  | { kind: 'alarm'; seq: number; ts: number; alarm: Alarm }
  | { kind: 'alarm_update'; seq: number; ts: number; alarmId: string; patch: Partial<Alarm> }
  | {
      kind: 'segment';
      seq: number;
      ts: number;
      index: number;
      name: string;
      count: number;
    }
  | { kind: 'precheck'; seq: number; ts: number; report: PrecheckReport }
  | { kind: 'deadman'; seq: number; ts: number; deadman: DeadmanState }
  | { kind: 'device'; seq: number; ts: number; devices: DeviceSnapshot }
  | { kind: 'command'; seq: number; ts: number; ack: CommandAck }
  | { kind: 'notice'; seq: number; ts: number; tone: 'info' | 'warn' | 'danger'; message: string }
  | { kind: 'audit'; seq: number; ts: number; entry: AuditEntry }
  | { kind: 'ended'; seq: number; ts: number; outcome: 'COMPLETED' | 'ABORTED' };

export type ClientMessage =
  | { kind: 'ping'; t0: number }
  | { kind: 'command'; command: CommandEnvelope }
  | { kind: 'heartbeat'; t0: number }
  | { kind: 'subscribe'; sessionId: string }
  | { kind: 'unsubscribe' };

export type ServerMessage =
  | { kind: 'hello'; snapshot: SessionSnapshot; serverTime: number; protocol: number }
  | { kind: 'snapshot'; snapshot: SessionSnapshot; serverTime: number }
  | { kind: 'event'; event: ServerEvent }
  | { kind: 'pong'; t0: number; t1: number; serverTime: number }
  | { kind: 'heartbeat_ack'; t0: number; serverTime: number }
  | {
      kind: 'error';
      code: string;
      message: string;
      detail?: string;
    };

/* ------------------------------------------------------------------ */
/* Audit & review                                                      */
/* ------------------------------------------------------------------ */

export interface AuditEntry {
  seq: number;
  ts: number;
  actorId: string;
  actorName: string;
  role: Role;
  action: string;
  detail: string;
  subject: string;
  prevHash: string;
  hash: string;
}

export interface ReviewFrame {
  t: number;
  ts: number;
  tip: Vec3;
  q: Quat;
  progress: number;
  segmentIndex: number;
  b: number;
  grad: number;
  torque: number;
  axial: number;
  lateral: number;
  phase: ProcedurePhase;
}

export interface ReviewStats {
  durationS: number;
  pathLengthMm: number;
  maxLateralForceN: number;
  maxGradient: number;
  maxTorque: number;
  maxProgressDeviationMm: number;
  meanSpeedMmS: number;
  pauseCount: number;
  alarmCount: number;
  highAlarmCount: number;
  segmentsCompleted: number;
  outcome: 'COMPLETED' | 'ABORTED' | 'IN_PROGRESS';
}

export interface ReviewReport {
  sessionId: string;
  case: CaseRecord;
  plan: Plan;
  startedAt: number;
  endedAt: number | null;
  phase: ProcedurePhase;
  phases: Array<{ phase: ProcedurePhase; ts: number }>;
  frames: ReviewFrame[];
  events: ServerEvent[];
  stats: ReviewStats;
  audit: AuditEntry[];
  disclaimer: string;
}

/* ------------------------------------------------------------------ */
/* REST contracts                                                      */
/* ------------------------------------------------------------------ */

export interface LoginResponse {
  user: User;
  sessionExpiresAt: number;
  csrfToken: string;
}

export interface CaseDetail {
  case: CaseRecord;
  registration: RegistrationInfo | null;
  plans: Plan[];
  activeSessionId: string | null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  detail?: string;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  uptimeS: number;
  sessions: number;
  telemetryHz: number;
}
