import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlarmClock,
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Crosshair,
  Gauge,
  Hand,
  HeartPulse,
  ListChecks,
  LockKeyhole,
  OctagonAlert,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Siren,
  Target,
  UserCheck,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  LIMITS,
  PHASE_META,
  V,
  can,
  type Alarm,
  type CommandAck,
  type ProcedurePhase,
  type SessionSnapshot,
  type TelemetryFrame,
} from '@magnav/protocol';
import { http, ApiError } from '../services/http';
import { realtime } from '../services/realtime';
import { useSessionStore } from '../store/session';
import { useDataAge, useHotFrame, useNow, useRunCommand } from '../hooks/useTelemetry';
import { useFps } from '../hooks/useFps';
import { fmtClock, fmtDuration, fmtInt, fmtMm, fmtPct } from '../lib/format';
import { serverNow } from '../services/clock';
import { Button, HoldButton } from '../components/ui/Button';
import {
  Gauge as GaugeBar,
  Metric,
  Panel,
  PhaseChip,
  StatusPill,
} from '../components/ui/Primitives';
import { Modal } from '../components/ui/Modal';
import { Sparkline } from '../components/ui/Sparkline';
import { SceneCanvas } from '../scene/SceneCanvas';
import { SceneToolbar } from '../components/SceneToolbar';
import type { SceneLayers } from '../scene/SceneContent';
import type { ViewPreset } from '../scene/CameraRig';
import { DsaPanel } from '../components/procedure/DsaPanel';
import { DemoCoach } from '../components/DemoCoach';
import {
  AlarmStack,
  CoilPanel,
  EventFeed,
  FieldPanel,
} from '../components/procedure/FieldPanel';
import { EmptyState } from '../components/ui/Primitives';

function useTelemetryHistory(frame: TelemetryFrame | null) {
  const ref = useRef({ b: [] as number[], grad: [] as number[], lateral: [] as number[], progress: [] as number[] });
  const [tick, setTick] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    if (!frame) return;
    const h = ref.current;
    h.b.push(V.len(frame.field.b));
    h.grad.push(frame.field.grad);
    h.lateral.push(frame.force.lateral);
    h.progress.push(frame.progress);
    for (const key of ['b', 'grad', 'lateral', 'progress'] as const) {
      if (h[key].length > 160) h[key].shift();
    }
    const now = performance.now();
    if (now - last.current > 350) {
      last.current = now;
      setTick((value) => value + 1);
    }
  }, [frame]);
  void tick;
  return {
    b: [...ref.current.b],
    grad: [...ref.current.grad],
    lateral: [...ref.current.lateral],
    progress: [...ref.current.progress],
  };
}

function bootstrapErrorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : '无法载入手术会话';
}

export function ProcedurePage() {
  const { caseId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const demoMode = searchParams.get('demo') === '1';
  const location = useLocation();
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const snapshot = useSessionStore((s) => s.snapshot);
  const connection = useSessionStore((s) => s.connection);
  const events = useSessionStore((s) => s.events);
  const setSnapshot = useSessionStore((s) => s.setSnapshot);
  const clearSession = useSessionStore((s) => s.clearSession);
  const pushToast = useSessionStore((s) => s.pushToast);

  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [preset, setPreset] = useState<ViewPreset>('ISO');
  const [layers, setLayers] = useState<SceneLayers>({
    vessels: true,
    path: true,
    coils: true,
    field: true,
    phantom: true,
  });
  const [armOpen, setArmOpen] = useState(false);
  const [assistantBadge, setAssistantBadge] = useState('M-1087');
  const [assistantPin, setAssistantPin] = useState('');
  const [startOpen, setStartOpen] = useState(false);
  const [startChecked, setStartChecked] = useState(false);
  const [abortOpen, setAbortOpen] = useState(false);
  const [abortReason, setAbortReason] = useState('术者判断需要中止');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetChecked, setResetChecked] = useState(false);
  const planIdFromState = (location.state as { planId?: string } | null)?.planId;

  const { run, pending } = useRunCommand();
  const frame = useHotFrame();
  const { ageMs, stale } = useDataAge();
  const fps = useFps();
  const now = useNow(500);
  const history = useTelemetryHistory(frame);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      setLoading(true);
      setBootError(null);
      try {
        const current = useSessionStore.getState().snapshot;
        if (current && current.case.id === caseId && !current.endedAt) {
          realtime.subscribe(current.sessionId);
          if (!cancelled) setLoading(false);
          return;
        }
        const detail = await http.caseDetail(caseId);
        if (detail.case.status === 'completed') {
          const target = detail.activeSessionId ?? detail.case.sessionId;
          if (target) {
            navigate(`/case/${caseId}/review?session=${target}`, { replace: true });
            return;
          }
        }
        let next: SessionSnapshot;
        if (detail.activeSessionId) {
          next = await http.session(detail.activeSessionId);
        } else {
          const plan =
            detail.plans.find((p) => p.id === planIdFromState) ??
            detail.plans.find((p) => p.status === 'approved') ??
            detail.plans[0];
          if (!plan) {
            throw new Error('该病例尚无导航计划，请先在规划页生成并审核。');
          }
          if (plan.status !== 'approved') {
            throw new Error('导航计划尚未审核签字，无法进入术中。');
          }
          if (!detail.registration || detail.registration.treMm > LIMITS.treMaxMm) {
            throw new Error('配准残差超限，请先在规划页重新配准。');
          }
          if (!user || !['surgeon', 'assistant'].includes(user.role)) {
            throw new Error('当前角色无法开启手术会话，请由术者进入。');
          }
          next = await http.createSession(caseId, plan.id);
        }
        if (cancelled) return;
        setSnapshot(next);
        realtime.subscribe(next.sessionId);
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        setBootError(bootstrapErrorText(error));
        setLoading(false);
      }
    };
    void boot();
    return () => {
      cancelled = true;
      realtime.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, planIdFromState, user?.id]);

  useEffect(() => {
    if (!armOpen) return;
    setAssistantBadge('M-1087');
    setAssistantPin('');
  }, [armOpen]);

  const phase: ProcedurePhase = snapshot?.phase ?? 'IDLE';
  const plan = snapshot?.plan;
  const registration = snapshot?.registration;
  const activeAlarms = (snapshot?.alarms ?? []).filter((alarm) => !alarm.clearedAt);
  const unackedHigh = activeAlarms.filter((alarm) => alarm.severity === 'high' && !alarm.acknowledged);
  const estopLatched = Boolean(snapshot?.context.estopLatched);
  const segmentIndex = frame?.segmentIndex ?? snapshot?.segmentIndex ?? 0;
  const progress = frame?.progress ?? snapshot?.progress ?? 0;
  const currentSegment = plan?.segments[Math.min(segmentIndex, (plan?.segments.length ?? 1) - 1)] ?? null;
  const elapsed = snapshot?.startedAt ? (now - snapshot.startedAt) / 1000 : 0;
  const remaining = plan ? Math.max(0, plan.etaSeconds * (1 - progress)) : 0;
  const deadmanRemaining = snapshot ? Math.max(0, snapshot.deadman.dueAt - now) : 0;
  const deadmanActive = phase === 'AUTO_RUNNING' || phase === 'AUTO_PAUSED';
  const deadmanRatio = snapshot ? Math.min(1, deadmanRemaining / Math.max(1, snapshot.deadman.intervalMs)) : 1;
  const isLive = connection === 'live';
  const readOnly = user ? !can(user.role, 'procedure:control') : true;
  const canPrepare = user ? can(user.role, 'procedure:prepare') : false;
  const canArm = user ? can(user.role, 'procedure:arm') : false;
  const canStart = user ? can(user.role, 'procedure:start') : false;
  const canControl = user ? can(user.role, 'procedure:control') : false;
  const canEstop = user ? can(user.role, 'procedure:estop') : false;
  const canReset = user?.role === 'surgeon';
  const precheckPassed = Boolean(snapshot?.precheck?.passed);
  const manualNeedsRecheck =
    phase === 'MANUAL' && (!snapshot?.precheck || snapshot.precheck.ranAt < (snapshot?.phaseChangedAt ?? 0));

  const phaseHint = PHASE_META[phase].hint;
  const nextAction =
    phase === 'REGISTERED'
      ? precheckPassed
        ? '预检通过 · 等待术者与助手双人确认武装'
        : '运行飞行前预检，全部通过后方可武装'
      : phase === 'MANUAL'
        ? manualNeedsRecheck
          ? '接管后需重新预检，再双人确认武装'
          : '可重新武装，或中止并回撤'
        : phase === 'ARMED'
          ? '已武装 · 启动自动导航前请再次确认现场安全'
          : phase === 'AUTO_RUNNING'
            ? '自动导航中 · 持续监督，随时可暂停或接管'
            : phase === 'AUTO_PAUSED'
              ? snapshot?.context.pauseReason ?? '自动导航已暂停 · 确认原因后继续'
              : phase === 'COMPLETED'
                ? '目标点已到达 · 可进入复盘'
                : phase === 'ABORTED'
                  ? '流程已中止 · 器械已回撤'
                  : phaseHint;

  const enterReview = () => {
    if (!snapshot) return;
    navigate(`/case/${caseId}/review?session=${snapshot.sessionId}`);
  };

  const send = async (type: Parameters<typeof run>[0], params: Record<string, unknown> = {}) => {
    return run(type, params);
  };

  const handleArm = async () => {
    const ack = await run('ARM', {
      countersign: { badge: assistantBadge, pin: assistantPin },
    });
    if (ack?.ok) {
      setArmOpen(false);
      setAssistantPin('');
    }
  };

  const handleStart = async () => {
    const ack = await run('START_AUTO', { confirm: true });
    if (ack?.ok) {
      setStartOpen(false);
      setStartChecked(false);
    }
  };

  const handleAbort = async () => {
    const ack = await run('ABORT', { confirm: true, reason: abortReason });
    if (ack?.ok) {
      setAbortOpen(false);
    }
  };

  const handleResetEstop = async () => {
    const ack = await run('RESET_ESTOP', { confirm: true });
    if (ack?.ok) {
      setResetOpen(false);
      setResetChecked(false);
    }
  };

  const ackAlarm = (alarmId: string) => {
    void run('ACK_ALARM', { alarmId });
  };

  if (loading) {
    return (
      <div className="page procedure-page procedure-page--loading">
        <div className="loading-card">
          <span className="spinner" />
          <div>
            <h2>正在建立术中会话</h2>
            <p>校验计划、配准与实时链路，加载遥测与设备状态…</p>
          </div>
        </div>
      </div>
    );
  }

  if (bootError || !snapshot || !plan || !registration) {
    return (
      <div className="page procedure-page">
        <EmptyState
          icon={<AlertTriangle size={30} />}
          title="无法进入术中控制台"
          description={bootError ?? '会话或计划不可用'}
          action={
            <div className="inline-actions">
              <Link to={`/case/${caseId}/plan`}>
                <Button variant="primary">返回规划</Button>
              </Link>
              <Link to="/cases">
                <Button variant="ghost">病例列表</Button>
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const isRunning = phase === 'AUTO_RUNNING';
  const isPaused = phase === 'AUTO_PAUSED';
  const isArmed = phase === 'ARMED';
  const isActive = ['ARMED', 'AUTO_RUNNING', 'AUTO_PAUSED', 'MANUAL'].includes(phase);
  const isClosed = phase === 'COMPLETED' || phase === 'ABORTED';
  const canResume =
    isPaused && !estopLatched && unackedHigh.length === 0 && canStart;
  const canArmNow =
    (phase === 'REGISTERED' || phase === 'MANUAL') &&
    precheckPassed &&
    !manualNeedsRecheck &&
    canArm &&
    !estopLatched;
  const canStartNow = isArmed && canStart && !estopLatched;

  const resumeTitle = estopLatched
    ? '急停锁定，需先复位'
    : unackedHigh.length > 0
      ? `存在 ${unackedHigh.length} 条未确认高危告警`
      : !canStart
        ? '当前角色无权继续'
        : '继续自动导航';

  return (
    <div className="page procedure-page">
      <header className="procedure-head">
        <div className="procedure-head__left">
          <Link to="/cases" className="back-link">
            <ArrowLeft size={14} /> 病例
          </Link>
          <span className="procedure-head__code mono">{snapshot.case.code}</span>
          <div className="procedure-head__patient">
            <strong>{snapshot.case.patient.nameMasked}</strong>
            <span>{snapshot.case.patient.sex === 'M' ? '男' : '女'} · {snapshot.case.patient.age} 岁</span>
          </div>
          <PhaseChip phase={phase} />
          {readOnly ? <StatusPill tone="warn">只读观察</StatusPill> : null}
        </div>
        <div className="procedure-head__stats">
          <div className="head-stat">
            <span>分段</span>
            <strong className="mono">
              {segmentIndex + 1}/{plan.segments.length}
            </strong>
          </div>
          <div className="head-stat">
            <span>完成</span>
            <strong className="mono">{fmtPct(progress, 0)}</strong>
          </div>
          <div className="head-stat">
            <span>已运行</span>
            <strong className="mono">{fmtDuration(elapsed)}</strong>
          </div>
          <div className="head-stat">
            <span>预计剩余</span>
            <strong className="mono">{fmtDuration(remaining)}</strong>
          </div>
          <div className={`head-stat ${stale ? 'is-danger' : ''}`}>
            <span>数据年龄</span>
            <strong className="mono">{Number.isFinite(ageMs) ? `${Math.round(ageMs)} ms` : '—'}</strong>
          </div>
          <div className="head-stat">
            <span>告警</span>
            <strong className={`mono ${activeAlarms.length > 0 ? 'tone-warn' : ''}`}>{activeAlarms.length}</strong>
          </div>
        </div>
      </header>

      {demoMode ? (
        <DemoCoach
          phase={phase}
          precheckPassed={Boolean(snapshot.precheck?.passed)}
          estopLatched={estopLatched}
          onRunPrecheck={() => void send('START_PRECHECK')}
          onArm={() => setArmOpen(true)}
          onStart={() => setStartOpen(true)}
          onPause={() => void send('PAUSE', { reason: '演示：术者暂停' })}
          onResume={() => void send('RESUME')}
          onReview={enterReview}
          onExit={() => navigate('/')}
        />
      ) : null}

      <div className="procedure-grid">
        <aside className="procedure-side procedure-left">
          <Panel title="计划摘要" subtitle={plan.name} dense>
            <div className="plan-progress">
              <div className="plan-progress__head">
                <span className="mono">{plan.totalLengthMm.toFixed(0)} mm</span>
                <span className="mono">{fmtPct(progress, 1)}</span>
              </div>
              <div className="plan-progress__track">
                <span className="plan-progress__fill" style={{ width: `${progress * 100}%` }} />
                {plan.segments.map((segment) => (
                  <i
                    key={segment.index}
                    style={{ left: `${(segment.startS / plan.totalLengthMm) * 100}%` }}
                    title={segment.name}
                  />
                ))}
              </div>
              <div className="plan-progress__segments">
                {plan.segments.map((segment) => (
                  <span
                    key={segment.index}
                    className={`plan-progress__dot ${segment.index < segmentIndex ? 'is-done' : ''} ${
                      segment.index === segmentIndex ? 'is-current' : ''
                    }`}
                  />
                ))}
              </div>
            </div>
            <div className="summary-grid summary-grid--2">
              <Metric label="当前分段" value={currentSegment?.name ?? '—'} size="sm" />
              <Metric label="当前速度" value={(frame?.speedMmS ?? 0).toFixed(1)} unit="mm/s" size="sm" />
              <Metric label="目标分支" value={plan.targetBranchId.toUpperCase()} size="sm" />
              <Metric label="计划用时" value={fmtDuration(plan.etaSeconds)} size="sm" />
            </div>
            <div className="target-point">
              <Target size={13} />
              <span>目标</span>
              <span className="mono">[{plan.target.map((n) => n.toFixed(0)).join(', ')}] mm</span>
            </div>
          </Panel>

          <Panel title="约束余量" dense>
            <div className="constraint-list">
              <GaugeBar
                label="当前段曲率 κ"
                value={currentSegment?.maxCurvature ?? 0}
                limit={LIMITS.curvatureMax}
                unit="mm⁻¹"
                digits={4}
                warnAt={0.75}
                dangerAt={0.95}
              />
              <div className="constraint-row">
                <span>目标狭窄</span>
                <strong className={snapshot.tree.branches.find((b) => b.id === plan.targetBranchId)?.stenosis ? 'tone-warn' : ''}>
                  {snapshot.tree.branches.find((b) => b.id === plan.targetBranchId)?.stenosis?.severityPct ?? 0}%
                </strong>
              </div>
              <div className="constraint-row">
                <span>配准 TRE</span>
                <strong className={registration.treMm > LIMITS.treMaxMm ? 'tone-danger' : 'tone-ok'}>
                  {registration.treMm.toFixed(1)} mm
                </strong>
              </div>
              <div className="constraint-row">
                <span>配准置信度</span>
                <strong>{fmtPct(registration.confidence, 0)}</strong>
              </div>
            </div>
          </Panel>

          {snapshot.startedAt ? (
          <Panel title="力 / 接触" dense>
            <div className="force-grid">
              <Metric label="轴向力" value={(frame?.force.axial ?? 0).toFixed(2)} unit="N" size="sm" />
              <Metric
                label="侧向力"
                value={(frame?.force.lateral ?? 0).toFixed(2)}
                unit="N"
                size="sm"
                tone={(frame?.force.lateral ?? 0) > LIMITS.lateralForceWarn ? 'warn' : 'default'}
              />
            </div>
            <Sparkline values={history.lateral.length > 1 ? history.lateral : [0, 0]} height={46} color="#ffb454" min={0} max={LIMITS.lateralForceMax} />
            <div className="sparkline__caption">
              <span>侧向力趋势</span>
              <span className="mono">限 {LIMITS.lateralForceMax.toFixed(1)} N</span>
            </div>
          </Panel>
          ) : null}

          {phase === 'REGISTERED' || phase === 'MANUAL' ? (
            <Panel title="飞行前预检" dense actions={
              <Button size="sm" variant="ghost" icon={<ListChecks size={13} />} disabled={!canPrepare || pending === 'START_PRECHECK'} onClick={() => void send('START_PRECHECK')}>
                {pending === 'START_PRECHECK' ? '检查中…' : snapshot.precheck ? '重新预检' : '运行预检'}
              </Button>
            }>
              {snapshot.precheck ? (
                <div className="precheck-list">
                  {snapshot.precheck.items.map((item) => (
                    <div key={item.id} className={`precheck-row ${item.passed ? 'is-pass' : 'is-fail'}`}>
                      <span className="precheck-row__mark">{item.passed ? '✓' : '✕'}</span>
                      <span className="precheck-row__label">{item.label}</span>
                      <span className="precheck-row__value mono">{item.value}</span>
                    </div>
                  ))}
                  <div className={`precheck-summary ${snapshot.precheck.passed ? 'is-pass' : 'is-fail'}`}>
                    {snapshot.precheck.passed ? '全部通过 · 可双人确认武装' : '存在未通过项 · 禁止武装'}
                  </div>
                </div>
              ) : (
                <p className="muted small">尚未运行预检。检查影像、配准、计划、磁可行性、线圈、急停与通信。</p>
              )}
            </Panel>
          ) : null}

          {isActive ? (
          <Panel title="人在环" dense>
            <div className="deadman">
              <div
                className={`deadman__ring ${deadmanRatio < 0.25 ? 'is-warn' : ''}`}
                style={{ ['--deadman' as string]: `${deadmanRatio * 100}%` }}
              >
                <span className="deadman__seconds mono">
                  {deadmanActive ? Math.ceil(deadmanRemaining / 1000) : '—'}
                  <small>{deadmanActive ? 's' : ''}</small>
                </span>
              </div>
              <div className="deadman__body">
                <strong>术者在场确认</strong>
                <p>
                  {deadmanActive
                    ? `每 ${Math.round(snapshot.deadman.intervalMs / 1000)} s 一次；超时 ${Math.round(snapshot.deadman.graceMs / 1000)} s 自动暂停。`
                    : '启动自动导航后开始计时；超时自动暂停。'}
                </p>
                <Button
                  size="sm"
                  variant={deadmanRatio < 0.25 ? 'warn' : 'default'}
                  icon={<UserCheck size={14} />}
                  disabled={!canControl || !isActive || pending === 'PRESENCE'}
                  onClick={() => void send('PRESENCE')}
                >
                  确认在场
                </Button>
              </div>
            </div>
            {snapshot.deadman.overdue ? <div className="inline-warning">确认已超时，将自动暂停。</div> : null}
          </Panel>
          ) : null}
        </aside>

        <section className="procedure-center">
          <div className="viewport viewport--procedure">
            <SceneCanvas
              tree={snapshot.tree}
              plan={plan}
              mode="procedure"
              viewPreset={preset}
              layers={layers}
              selectedBranchId={null}
              frozen={stale}
            />

            <div className="procedure-overlay-top">
              <div className={`live-badge ${isRunning ? 'is-running' : ''}`}>
                <span className="live-badge__dot" />
                {isRunning ? 'AUTO NAVIGATION' : PHASE_META[phase].short}
                {isRunning ? <span className="live-badge__seg mono">SEG {segmentIndex + 1}</span> : null}
              </div>
              <div className="procedure-overlay-top__right">
                {stale ? (
                  <span className="chip chip--danger">
                    <AlertTriangle size={12} /> 位姿数据中断 · 已冻结
                  </span>
                ) : (
                  <span className="chip">
                    <Activity size={12} /> {fps} FPS
                  </span>
                )}
                <span className="chip chip--muted">{preset}</span>
              </div>
            </div>

            <div className="procedure-overlay-scale">
              <span />
              20 mm
            </div>

            {estopLatched ? (
              <div className="banner banner--danger">
                <OctagonAlert size={17} />
                <div>
                  <strong>软件急停已锁定</strong>
                  <span>所有运动指令已被阻断。确认现场安全后复位，复位后保持暂停状态。</span>
                </div>
                {canReset ? (
                  <Button size="sm" variant="danger" onClick={() => setResetOpen(true)}>
                    复位急停
                  </Button>
                ) : null}
              </div>
            ) : null}

            {!estopLatched && isPaused ? (
              <div className="banner banner--warn">
                <Pause size={17} />
                <div>
                  <strong>自动导航已暂停</strong>
                  <span>{snapshot.context.pauseReason ?? '等待原因确认'}</span>
                </div>
                {activeAlarms.some((alarm) => !alarm.acknowledged) ? (
                  <span className="banner__note">请先确认告警</span>
                ) : null}
              </div>
            ) : null}

            {!estopLatched && registration.treMm > LIMITS.treMaxMm ? (
              <div className="banner banner--warn">
                <AlertTriangle size={17} />
                <div>
                  <strong>配准残差超限</strong>
                  <span>TRE {registration.treMm.toFixed(1)} mm {'>'} {LIMITS.treMaxMm.toFixed(1)} mm，禁止进入武装态。</span>
                </div>
              </div>
            ) : null}

            {connection !== 'live' ? (
              <div className="link-overlay">
                <span className="spinner" />
                <strong>{connection === 'reconnecting' ? '正在重连实时链路' : '实时链路未连接'}</strong>
                <p>3D 已冻结，禁止所有运动指令；状态以服务端恢复后的快照为准。</p>
              </div>
            ) : null}

            {isClosed ? (
              <div className="completion-overlay">
                <div className={`completion-card ${phase === 'COMPLETED' ? 'is-success' : 'is-danger'}`}>
                  {phase === 'COMPLETED' ? <CheckCircle2 size={34} /> : <XCircle size={34} />}
                  <h2>{phase === 'COMPLETED' ? '目标点已到达' : '流程已中止'}</h2>
                  <p>
                    {phase === 'COMPLETED'
                      ? '自动导航已完成，器械保持在目标位置。请确认后撤出并进入复盘。'
                      : '器械已回撤至入口，流程安全终止。请查阅事件与审计记录。'}
                  </p>
                  <div className="completion-card__stats">
                    <Metric label="用时" value={fmtDuration(elapsed)} size="sm" />
                    <Metric label="完成度" value={fmtPct(progress, 0)} size="sm" />
                    <Metric label="告警" value={activeAlarms.length} size="sm" />
                  </div>
                  <div className="inline-actions">
                    <Button variant="primary" onClick={enterReview} icon={<ArrowRight size={15} />}>
                      进入复盘
                    </Button>
                    <Link to="/cases">
                      <Button variant="ghost">返回病例</Button>
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="procedure-dsa">
              <DsaPanel
                tree={snapshot.tree}
                plan={plan}
                viewPreset={preset}
                stale={stale || !isLive}
              />
            </div>

            <div className="procedure-legend">
              <span><i className="legend__swatch legend__swatch--vessel" /> 血管</span>
              <span><i className="legend__swatch legend__swatch--path" /> 规划路径</span>
              <span><i className="legend__swatch legend__swatch--target" /> 目标</span>
              <span><i className="legend__swatch legend__swatch--coil" /> 线圈</span>
            </div>

            <SceneToolbar
              preset={preset}
              onPreset={setPreset}
              layers={layers}
              onLayers={setLayers}
            />
          </div>

          <div className="command-bar">
            <div className="command-bar__hint">
              <span className="eyebrow">NEXT ACTION</span>
              <strong>{nextAction}</strong>
              <span className="muted small">
                {readOnly ? '只读观察 · 运动指令需术者/助手权限' : (user?.role === 'surgeon' ? '术者权限 · 可启动、暂停、接管与中止' : '助手权限 · 可暂停、确认告警与急停')}
              </span>
            </div>

            <div className="command-bar__actions">
              {phase === 'REGISTERED' || phase === 'MANUAL' ? (
                <>
                  <Button
                    variant="default"
                    size="lg"
                    icon={<ListChecks size={17} />}
                    disabled={!canPrepare || pending === 'START_PRECHECK'}
                    onClick={() => void send('START_PRECHECK')}
                  >
                    运行预检
                  </Button>
                  <Button
                    variant="warn"
                    size="lg"
                    icon={<ShieldCheck size={17} />}
                    disabled={!canArmNow}
                    title={
                      estopLatched
                        ? '急停锁定'
                        : manualNeedsRecheck
                          ? '接管后需重新预检'
                          : !precheckPassed
                            ? '预检未通过'
                            : '双人确认武装'
                    }
                    onClick={() => setArmOpen(true)}
                  >
                    双人确认武装
                  </Button>
                </>
              ) : null}

              {isArmed ? (
                <>
                  <Button
                    variant="primary"
                    size="lg"
                    icon={<Play size={17} />}
                    disabled={!canStartNow}
                    onClick={() => setStartOpen(true)}
                  >
                    启动自动导航
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    disabled={!canArm}
                    onClick={() => void send('DISARM')}
                  >
                    撤防
                  </Button>
                </>
              ) : null}

              {isRunning ? (
                <>
                  <Button
                    variant="warn"
                    size="lg"
                    icon={<Pause size={17} />}
                    disabled={!canControl}
                    onClick={() => void send('PAUSE', { reason: '术者暂停' })}
                  >
                    暂停
                  </Button>
                  <Button
                    variant="default"
                    size="lg"
                    icon={<Hand size={17} />}
                    disabled={!canControl}
                    onClick={() => void send('TAKEOVER')}
                  >
                    接管
                  </Button>
                </>
              ) : null}

              {isPaused ? (
                <>
                  <Button
                    variant="primary"
                    size="lg"
                    icon={<Play size={17} />}
                    disabled={!canResume}
                    title={resumeTitle}
                    onClick={() => void send('RESUME')}
                  >
                    继续
                  </Button>
                  <Button
                    variant="default"
                    size="lg"
                    icon={<Hand size={17} />}
                    disabled={!canControl}
                    onClick={() => void send('TAKEOVER')}
                  >
                    接管
                  </Button>
                </>
              ) : null}

              {isActive ? (
                <Button
                  variant="danger"
                  size="lg"
                  icon={<RotateCcw size={17} />}
                  disabled={!canControl}
                  onClick={() => setAbortOpen(true)}
                >
                  中止并回撤
                </Button>
              ) : null}

              {isClosed ? (
                <Button variant="primary" size="lg" icon={<ArrowRight size={17} />} onClick={enterReview}>
                  查看复盘
                </Button>
              ) : null}

              {isActive && canControl ? (
                <Button
                  variant="subtle"
                  size="lg"
                  icon={<AlarmClock size={17} />}
                  disabled={pending === 'PRESENCE'}
                  onClick={() => void send('PRESENCE')}
                >
                  确认在场
                </Button>
              ) : null}
            </div>

            <div className="command-bar__meta">
              <div className={`latency ${stale ? 'is-danger' : ''}`}>
                <span className="latency__label">数据延迟</span>
                <span className="latency__value mono">{Number.isFinite(ageMs) ? `${Math.round(ageMs)} ms` : '—'}</span>
              </div>
              <div className="deadman-mini">
                <Clock3 size={13} />
                <span>在场确认</span>
                <strong className="mono">{isClosed ? '已结束' : deadmanActive ? `${Math.ceil(deadmanRemaining / 1000)}s` : '待启动'}</strong>
              </div>
              {snapshot.deadman.overdue ? <span className="badge badge--danger">超时</span> : null}
            </div>
          </div>
        </section>

        <aside className="procedure-side procedure-right">
          <Panel title="磁场" subtitle="偶极子模型 · 示意" dense>
            <FieldPanel frame={frame} plan={plan} bHistory={history.b} />
          </Panel>

          <Panel
            title="线圈阵列"
            dense
            actions={<StatusPill tone="info">12 CH</StatusPill>}
          >
            <CoilPanel frame={frame} devices={snapshot.devices} />
          </Panel>

          <Panel title="告警" dense actions={<span className="mono small muted">{activeAlarms.length}</span>}>
            <AlarmStack alarms={snapshot.alarms} onAck={ackAlarm} disabled={readOnly} />
          </Panel>

          <Panel title="事件流" dense scroll>
            <EventFeed events={events} />
          </Panel>
        </aside>
      </div>

      {canEstop ? (
        <div className="estop-fab">
          <HoldButton
            variant="danger"
            className="estop-fab__button"
            holdMs={700}
            holdLabel="按住 0.7 s 急停"
            progressLabel="保持按住…"
            disabled={!isLive || isClosed || phase === 'ABORTING'}
            onConfirm={() => void send('ESTOP')}
          >
            <OctagonAlert size={19} />
            <span>
              急停
              <small>HOLD</small>
            </span>
          </HoldButton>
        </div>
      ) : null}

      <Modal
        open={armOpen}
        title="双人确认武装"
        subtitle="术者 + 助手确认后进入 ARMED。武装不等于运动，启动自动仍需单独确认。"
        onClose={() => setArmOpen(false)}
        width={520}
        tone="warn"
        footer={
          <>
            <Button variant="ghost" onClick={() => setArmOpen(false)}>取消</Button>
            <Button variant="warn" disabled={assistantPin.length < 3 || pending === 'ARM'} onClick={() => void handleArm()}>
              {pending === 'ARM' ? '确认中…' : '确认武装'}
            </Button>
          </>
        }
      >
        <div className="arm-modal">
          <div className="arm-modal__row">
            <span className="avatar">{user?.initials}</span>
            <div>
              <strong>{user?.name} · 术者</strong>
              <p>已登录，二次确认口令由助手输入。</p>
            </div>
            <ShieldCheck size={18} className="tone-ok" />
          </div>
          <div className="arm-modal__divider" />
          <div className="arm-modal__row arm-modal__row--assistant">
            <span className="avatar avatar--ghost"><UserCheck size={16} /></span>
            <div className="arm-modal__fields">
              <label className="field">
                <span className="field__label">助手工牌</span>
                <input value={assistantBadge} onChange={(event) => setAssistantBadge(event.target.value.toUpperCase())} />
              </label>
              <label className="field">
                <span className="field__label">助手口令</span>
                <input
                  type="password"
                  value={assistantPin}
                  autoFocus
                  onChange={(event) => setAssistantPin(event.target.value)}
                  placeholder="••••"
                  maxLength={12}
                />
              </label>
            </div>
          </div>
          <p className="hint">
            演示环境：李*婷 · M-1087 · 口令 <span className="mono">1357</span>。双人确认记录写入审计链。
          </p>
          <div className="gate-checks">
            <span className={precheckPassed ? 'is-pass' : 'is-fail'}>预检 {precheckPassed ? '通过' : '未通过'}</span>
            <span className={registration.treMm <= LIMITS.treMaxMm ? 'is-pass' : 'is-fail'}>
              TRE {registration.treMm.toFixed(1)} mm
            </span>
            <span className={plan.status === 'approved' ? 'is-pass' : 'is-fail'}>计划已签字</span>
            <span className={!estopLatched ? 'is-pass' : 'is-fail'}>急停未锁定</span>
          </div>
        </div>
      </Modal>

      <Modal
        open={startOpen}
        title="启动自动导航"
        subtitle="高后果操作。启动前请确认患者、计划、配准、现场与急停回路。"
        onClose={() => setStartOpen(false)}
        width={520}
        tone="danger"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStartOpen(false)}>取消</Button>
            <HoldButton
              variant="primary"
              holdMs={800}
              disabled={!startChecked || pending === 'START_AUTO'}
              onConfirm={() => void handleStart()}
            >
              按住 0.8 s 启动
            </HoldButton>
          </>
        }
      >
        <div className="start-modal">
          <div className="start-modal__summary">
            <Metric label="计划" value={plan.name} size="sm" />
            <Metric label="路径" value={`${plan.totalLengthMm.toFixed(0)} mm`} size="sm" />
            <Metric label="预计" value={fmtDuration(plan.etaSeconds)} size="sm" />
            <Metric label="目标" value={plan.targetBranchId.toUpperCase()} size="sm" />
          </div>
          <label className="check-row">
            <input type="checkbox" checked={startChecked} onChange={(event) => setStartChecked(event.target.checked)} />
            <span>我已确认患者身份、导航计划、配准状态与现场安全，急停回路可用，并准备随时接管。</span>
          </label>
          <div className="start-modal__note">
            <Siren size={15} />
            启动后系统将以 {LIMITS.deadmanIntervalMs / 1000}s 间隔要求在场确认；超时或链路中断将自动暂停。
          </div>
        </div>
      </Modal>

      <Modal
        open={abortOpen}
        title="中止并回撤"
        subtitle="将中止导航并沿原路径回撤导管至入口。该动作不可撤销。"
        onClose={() => setAbortOpen(false)}
        width={520}
        tone="danger"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAbortOpen(false)}>取消</Button>
            <HoldButton
              variant="danger"
              holdMs={800}
              disabled={pending === 'ABORT'}
              onConfirm={() => void handleAbort()}
            >
              按住 0.8 s 中止
            </HoldButton>
          </>
        }
      >
        <div className="abort-modal">
          <div className="abort-modal__consequence">
            <AlertOctagon size={18} />
            <div>
              <strong>具体后果</strong>
              <p>
                立即停止推进；以 14 mm/s 回撤至主动脉根入口（约{' '}
                {(progress * plan.totalLengthMm / 14).toFixed(0)} s）。回撤期间除硬件急停外不可执行其他运动指令。
              </p>
            </div>
          </div>
          <label className="field">
            <span className="field__label">中止原因（写入审计）</span>
            <select value={abortReason} onChange={(event) => setAbortReason(event.target.value)}>
              <option>术者判断需要中止</option>
              <option>患者生命体征变化</option>
              <option>血管壁接触/夹层风险</option>
              <option>影像或配准异常</option>
              <option>设备/链路异常</option>
            </select>
          </label>
        </div>
      </Modal>

      <Modal
        open={resetOpen}
        title="复位软件急停"
        subtitle="仅复位软件锁存，不会让器械自动恢复运动。"
        onClose={() => setResetOpen(false)}
        width={460}
        tone="warn"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>取消</Button>
            <Button variant="warn" disabled={!resetChecked || pending === 'RESET_ESTOP'} onClick={() => void handleResetEstop()}>
              确认复位
            </Button>
          </>
        }
      >
        <label className="check-row">
          <input type="checkbox" checked={resetChecked} onChange={(event) => setResetChecked(event.target.checked)} />
          <span>我已确认现场安全，运动部件周围无人，且已核实急停触发原因。</span>
        </label>
      </Modal>
    </div>
  );
}
