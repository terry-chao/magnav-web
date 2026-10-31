import type {
  Capability,
  CoilSpec,
  CommandType,
  PhaseMeta,
  ProcedurePhase,
  Role,
  Vec3,
} from './types';
import { PHASE_META } from './types';

export const APP_NAME = 'MAGNAV';
export const APP_SUBTITLE = '磁控介入手术机器人 · 监督控制台';
export const PROTOCOL_VERSION = 1;

export const LIMITS = {
  /** mm — registration TRE gate for ARMED */
  treMaxMm: 1.5,
  /** mm — hard stop for any motion */
  treHardMaxMm: 2.5,
  /** mT at tip */
  fieldMaxMilliTesla: 60,
  fieldNominalMilliTesla: 42,
  /** T/m */
  gradMax: 1.2,
  gradWarn: 0.95,
  /** mN·m */
  torqueMax: 2.0,
  torqueWarn: 1.6,
  /** N */
  lateralForceMax: 0.5,
  lateralForceWarn: 0.35,
  axialForceWarn: 0.4,
  /** °C */
  coilTempMax: 65,
  coilTempWarn: 56,
  /** 1/mm */
  curvatureMax: 0.08,
  /** ms */
  stalePoseMs: 200,
  renderDelayMs: 40,
  latencyP95MaxMs: 120,
  commandAckTimeoutMs: 2000,
  /** ms — presence confirmation cadence while AUTO_RUNNING */
  deadmanIntervalMs: 40_000,
  deadmanGraceMs: 10_000,
  /** ms — WS heartbeat */
  heartbeatMs: 1000,
  linkLostMs: 3000,
} as const;

export const TELEMETRY = {
  hz: 120,
  /** fixed shape samples in every frame */
  shapePoints: 96,
  coilCount: 12,
  recordHz: 10,
  /** demo playback speed multiplier for review */
  reviewSpeeds: [0.5, 1, 2, 4] as const,
} as const;

export const MAGNETIC_MODEL = {
  /** A·m² per amp per coil */
  coilMomentPerAmp: 45,
  /** A·m² — catheter tip magnetic moment */
  tipMomentAmpM2: 0.06,
  /** 1e-7 T·m/A (μ0 / 4π) */
  mu0Over4Pi: 1e-7,
  /** field lines visualisation */
  lineCount: 10,
  lineSteps: 44,
  lineStepMm: 6,
} as const;

export const DISCLAIMER =
  '研究用原型，非医疗器械。所有磁场、影像与机器人行为均为确定性模拟，不得用于临床诊断或治疗。';

export const ROLE_META: Record<Role, { label: string; tone: string; description: string }> = {
  surgeon: { label: '术者', tone: 'surgeon', description: '审核计划、武装、启动自动、接管与中止' },
  assistant: { label: '助手', tone: 'assistant', description: '协助双人确认、观察进度、可暂停与急停' },
  tech: { label: '影像技师', tone: 'tech', description: '采集影像、确认配准，不可下发运动指令' },
  engineer: { label: '临床工程师', tone: 'engineer', description: '设备自检、标定、日志与故障注入' },
  reviewer: { label: '质控审核', tone: 'reviewer', description: '术后复盘、偏差与审计查阅' },
};

export const ROLE_CAPABILITY_LABELS: Record<Capability, string> = {
  'case:create': '新建病例',
  'plan:compose': '路径规划',
  'plan:approve': '计划审核',
  'procedure:prepare': '术前准备',
  'procedure:arm': '武装',
  'procedure:countersign': '双人确认',
  'procedure:start': '启动自动',
  'procedure:control': '运行控制',
  'procedure:estop': '急停',
  'review:view': '复盘查阅',
  'admin:view': '设备与审计',
};

/** Commands the UI (and server) may offer in each phase. Role checks apply on top. */
export const PHASE_COMMANDS: Record<ProcedurePhase, readonly CommandType[]> = {
  IDLE: ['ACK_ALARM'],
  CASE_READY: ['ACK_ALARM'],
  SEGMENTED: ['ACK_ALARM'],
  PLAN_READY: ['ACK_ALARM'],
  REGISTERED: ['START_PRECHECK', 'ARM', 'ABORT', 'ACK_ALARM', 'ESTOP'],
  ARMED: ['START_AUTO', 'DISARM', 'ABORT', 'PRESENCE', 'ACK_ALARM', 'ESTOP', 'RESET_ESTOP'],
  AUTO_RUNNING: ['PAUSE', 'TAKEOVER', 'ABORT', 'PRESENCE', 'ESTOP', 'ACK_ALARM'],
  AUTO_PAUSED: ['RESUME', 'TAKEOVER', 'ABORT', 'PRESENCE', 'ESTOP', 'RESET_ESTOP', 'ACK_ALARM'],
  MANUAL: ['START_PRECHECK', 'ARM', 'ABORT', 'ESTOP', 'RESET_ESTOP', 'PRESENCE', 'ACK_ALARM'],
  ABORTING: ['ESTOP', 'ACK_ALARM'],
  ABORTED: ['ACK_ALARM'],
  COMPLETED: ['ACK_ALARM'],
};

export const COMMAND_ROLE: Record<CommandType, Role[]> = {
  START_PRECHECK: ['surgeon', 'assistant', 'tech'],
  ARM: ['surgeon'],
  DISARM: ['surgeon'],
  START_AUTO: ['surgeon'],
  PAUSE: ['surgeon', 'assistant'],
  RESUME: ['surgeon'],
  TAKEOVER: ['surgeon'],
  ABORT: ['surgeon', 'assistant'],
  ESTOP: ['surgeon', 'assistant', 'tech'],
  RESET_ESTOP: ['surgeon'],
  ACK_ALARM: ['surgeon', 'assistant', 'tech', 'engineer', 'reviewer'],
  PRESENCE: ['surgeon', 'assistant'],
};

export const PHASE_ORDER: readonly ProcedurePhase[] = [
  'CASE_READY',
  'SEGMENTED',
  'PLAN_READY',
  'REGISTERED',
  'ARMED',
  'AUTO_RUNNING',
  'COMPLETED',
];

export const GATE_STEPS: ReadonlyArray<{ phase: ProcedurePhase; label: string }> = [
  { phase: 'CASE_READY', label: '病例' },
  { phase: 'SEGMENTED', label: '分割' },
  { phase: 'PLAN_READY', label: '计划' },
  { phase: 'REGISTERED', label: '配准' },
  { phase: 'ARMED', label: '武装' },
  { phase: 'AUTO_RUNNING', label: '自动' },
];

export function phaseMeta(phase: ProcedurePhase): PhaseMeta {
  return PHASE_META[phase];
}

export const REJECTION_MESSAGES: Record<string, string> = {
  BAD_STATE: '当前阶段不允许该操作',
  ROLE_DENIED: '当前角色无此操作权限',
  UNKNOWN_COMMAND: '未知指令',
  SESSION_NOT_FOUND: '会话不存在或已结束',
  ESTOP_LATCHED: '急停已锁定，请先复位',
  PRECHECK_REQUIRED: '请先完成飞行前预检',
  PRECHECK_FAILED: '预检未通过，禁止武装',
  COUNTERSIGN_REQUIRED: '需要第二人（助手）确认',
  COUNTERSIGN_INVALID: '第二人确认失败：工牌或口令错误',
  PLAN_NOT_APPROVED: '计划尚未审核签字',
  PLAN_INFEASIBLE: '计划未通过磁导航可行性校验',
  TRE_EXCEEDED: '配准残差超过 1.5 mm',
  DEADMAN_OVERDUE: '人在环确认超时，请先确认在场',
  DEADMAN_REQUIRED: '自动模式需定期确认术者在场',
  IDEMPOTENT: '重复指令（已处理）',
  ALARM_NOT_FOUND: '告警不存在',
  ALARM_PENDING: '存在未确认的高等级告警，请先确认',
  CONFIRM_REQUIRED: '该操作需要二次确认',
  ALREADY_LATCHED: '急停已处于锁定状态',
  NO_ACTIVE_SESSION: '当前没有进行中的手术会话',
  BAD_TARGET: '目标点无效',
  NO_PATH: '无法生成到达目标点的路径',
  PATH_TOO_SHORT: '目标距离入口过近，无法生成计划',
  AUTH_REQUIRED: '登录已失效',
  FORBIDDEN: '无权限',
  INTERNAL: '服务内部错误',
  ABORT_IN_PROGRESS: '正在回撤，无法执行该操作',
  TARGET_REACHED: '目标已到达',
};

export function rejectionMessage(code: string): string {
  return REJECTION_MESSAGES[code] ?? '指令被拒绝';
}

/* ------------------------------------------------------------------ */
/* Coil array — 3 rings × 4 coils around the cardiac isocentre         */
/* ------------------------------------------------------------------ */

function normalize([x, y, z]: Vec3): Vec3 {
  const n = Math.hypot(x, y, z) || 1;
  return [x / n, y / n, z / n];
}

function buildCoilArray(): CoilSpec[] {
  const coils: CoilSpec[] = [];
  const rings = [-110, 0, 110];
  const radius = 255;
  let n = 0;
  rings.forEach((z, ringIndex) => {
    for (let i = 0; i < 4; i += 1) {
      const angle = (Math.PI / 4) + (Math.PI / 2) * i + ringIndex * (Math.PI / 8);
      const position: Vec3 = [
        Math.round(Math.cos(angle) * radius * 10) / 10,
        Math.round(Math.sin(angle) * radius * 10) / 10,
        z,
      ];
      n += 1;
      coils.push({
        id: `coil-${n}`,
        label: `C${n}`,
        position,
        axis: normalize([-position[0], -position[1], -position[2]]),
        maxCurrentA: 120,
        ring: ringIndex,
      });
    }
  });
  return coils;
}

export const COIL_SPECS: readonly CoilSpec[] = buildCoilArray();

export const DEFAULT_PLAN_NAME = '自动导航计划';
export const ENTRY_LABEL = '股动脉 · 主动脉根入口';
