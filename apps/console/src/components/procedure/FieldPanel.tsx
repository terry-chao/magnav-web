import { AlertTriangle, BellRing, Check, Cpu, Gauge as GaugeIcon, Radio, ThermometerSnowflake, Zap } from 'lucide-react';
import { COIL_SPECS, LIMITS, V, type Alarm, type DeviceSnapshot, type Plan, type ServerEvent, type TelemetryFrame } from '@magnav/protocol';
import { fmtClock, fmtPct, severityLabel } from '../../lib/format';
import { Sparkline } from '../ui/Sparkline';

export function FieldPanel({
  frame,
  plan,
  bHistory,
}: {
  frame: TelemetryFrame | null;
  plan: Plan;
  bHistory: readonly number[];
}) {
  const b = frame ? V.len(frame.field.b) : 0;
  const grad = frame?.field.grad ?? 0;
  const torque = frame?.field.torque ?? 0;
  const lateral = frame?.force.lateral ?? 0;
  const axial = frame?.force.axial ?? 0;
  return (
    <div className="field-panel">
      <div className="field-panel__b">
        <div className="field-panel__b-head">
          <span className="eyebrow">MAGNETIC FIELD @ TIP</span>
          <span className="field-panel__b-state">{frame ? (b > 0 ? '闭环稳定' : '待机') : '等待遥测'}</span>
        </div>
        <div className="field-panel__b-value">
          {b.toFixed(1)}
          <span>mT</span>
        </div>
        <Sparkline values={bHistory.length > 1 ? bHistory : [b, b]} height={42} color="#4de2d0" min={0} max={LIMITS.fieldMaxMilliTesla} />
        <div className="field-panel__vector mono">
          B = [{frame ? frame.field.b.map((n) => n.toFixed(1)).join(', ') : '—'}]
        </div>
      </div>

      <div className="readout-grid">
        <div className="readout">
          <span className="readout__label"><GaugeIcon size={12} /> 梯度 ∇B</span>
          <span className="readout__value">{grad.toFixed(2)}<small>T/m</small></span>
          <div className="mini-bar">
            <span style={{ width: `${Math.min(100, (grad / LIMITS.gradMax) * 100)}%` }} className={grad > LIMITS.gradWarn ? 'is-warn' : ''} />
            <i style={{ left: `${(LIMITS.gradWarn / LIMITS.gradMax) * 100}%` }} />
          </div>
        </div>
        <div className="readout">
          <span className="readout__label"><Zap size={12} /> 磁力矩 τ</span>
          <span className="readout__value">{torque.toFixed(2)}<small>mN·m</small></span>
          <div className="mini-bar">
            <span style={{ width: `${Math.min(100, (torque / LIMITS.torqueMax) * 100)}%` }} className={torque > LIMITS.torqueWarn ? 'is-warn' : ''} />
            <i style={{ left: `${(LIMITS.torqueWarn / LIMITS.torqueMax) * 100}%` }} />
          </div>
        </div>
        <div className="readout">
          <span className="readout__label">轴向力</span>
          <span className="readout__value">{axial.toFixed(2)}<small>N</small></span>
          <span className="readout__hint">门限 {LIMITS.axialForceWarn.toFixed(1)} N</span>
        </div>
        <div className="readout">
          <span className="readout__label">侧向力</span>
          <span className={`readout__value ${lateral > LIMITS.lateralForceWarn ? 'tone-warn' : ''}`}>
            {lateral.toFixed(2)}<small>N</small>
          </span>
          <span className="readout__hint">门限 {LIMITS.lateralForceMax.toFixed(1)} N</span>
        </div>
      </div>

      <div className="field-panel__target">
        <span><Radio size={12} /> 目标场强</span>
        <span className="mono">{LIMITS.fieldNominalMilliTesla.toFixed(1)} mT</span>
        <span>·</span>
        <span className="mono">{plan.segments.length} 段</span>
      </div>
    </div>
  );
}

export function CoilPanel({
  frame,
  devices,
}: {
  frame: TelemetryFrame | null;
  devices: DeviceSnapshot | null;
}) {
  const coils = devices?.coils ?? [];
  return (
    <div className="coil-panel">
      <div className="coil-panel__head">
        <span className="eyebrow">COIL ARRAY · 12 CH</span>
        <span className="muted small">
          <ThermometerSnowflake size={12} /> 冷却 {devices?.fieldGenerator.cooling.toFixed(0) ?? '—'}%
        </span>
      </div>
      <div className="coil-list">
        {COIL_SPECS.map((spec, index) => {
          const runtime = coils[index];
          const current = runtime?.currentA ?? frame?.coils[index] ?? 0;
          const load = runtime?.loadPct ?? Math.min(1, Math.abs(current) / spec.maxCurrentA);
          const temperature = runtime?.temperatureC ?? 32;
          const saturated = runtime?.saturated ?? false;
          const hot = temperature > LIMITS.coilTempWarn;
          return (
            <div key={spec.id} className={`coil-row ${saturated ? 'is-saturated' : ''}`}>
              <span className="coil-row__id mono">{spec.label}</span>
              <div className="coil-row__bar">
                <span
                  className={`${saturated ? 'is-danger' : hot ? 'is-warn' : ''}`}
                  style={{ width: `${Math.min(100, load * 100)}%` }}
                />
              </div>
              <span className="coil-row__pct mono">{Math.round(load * 100)}%</span>
              <span className="coil-row__amp mono">
                {current >= 0 ? '+' : ''}
                {current.toFixed(0)}A
              </span>
              <span className={`coil-row__temp mono ${hot ? 'tone-warn' : ''}`}>{temperature.toFixed(0)}°</span>
            </div>
          );
        })}
      </div>
      <div className="coil-panel__foot">
        <span><Cpu size={12} /> 场发生器 {devices?.fieldGenerator.status === 'ok' ? '正常' : '故障'}</span>
        <span>占空比 {devices?.fieldGenerator.dutyPct.toFixed(0) ?? '—'}%</span>
      </div>
    </div>
  );
}

function eventText(event: ServerEvent): { text: string; tone: string } | null {
  switch (event.kind) {
    case 'phase':
      return { text: `阶段 → ${event.phase} · ${event.reason}`, tone: 'phase' };
    case 'segment':
      return { text: `第 ${event.index + 1}/${event.count} 段 · ${event.name}`, tone: 'segment' };
    case 'alarm':
      return { text: `${severityLabel(event.alarm.severity)}级告警 · ${event.alarm.title}`, tone: event.alarm.severity };
    case 'alarm_update':
      return event.patch.clearedAt
        ? { text: `告警已消除 · ${event.alarmId}`, tone: 'muted' }
        : event.patch.acknowledged
          ? { text: `告警已确认 · ${event.alarmId}`, tone: 'muted' }
          : null;
    case 'notice':
      return { text: event.message, tone: event.tone };
    case 'precheck':
      return {
        text: `飞行前预检${event.report.passed ? '通过' : '未通过'}`,
        tone: event.report.passed ? 'low' : 'high',
      };
    case 'ended':
      return { text: `会话结束 · ${event.outcome}`, tone: 'phase' };
    case 'command':
      return event.ack.ok ? null : { text: `指令被拒绝 · ${event.ack.message}`, tone: 'high' };
    default:
      return null;
  }
}

export function EventFeed({ events }: { events: ServerEvent[] }) {
  const items = events
    .map((event) => ({ event, parsed: eventText(event) }))
    .filter((item): item is { event: ServerEvent; parsed: { text: string; tone: string } } => Boolean(item.parsed))
    .reverse()
    .slice(0, 40);
  return (
    <div className="event-feed">
      {items.length === 0 ? <div className="event-feed__empty">等待事件…</div> : null}
      {items.map(({ event, parsed }) => (
        <div key={`${event.kind}-${event.seq}`} className={`event-row event-row--${parsed.tone}`}>
          <span className="event-row__time mono">{fmtClock(event.ts)}</span>
          <span className="event-row__dot" />
          <span className="event-row__text">{parsed.text}</span>
        </div>
      ))}
    </div>
  );
}

export function AlarmStack({
  alarms,
  onAck,
  disabled,
}: {
  alarms: Alarm[];
  onAck: (alarmId: string) => void;
  disabled?: boolean;
}) {
  const active = alarms.filter((a) => !a.clearedAt).slice().reverse();
  if (active.length === 0) {
    return (
      <div className="alarm-empty">
        <Check size={15} /> 无活动告警
      </div>
    );
  }
  return (
    <div className="alarm-stack">
      {active.map((alarm) => (
        <div key={alarm.id} className={`alarm-row alarm-row--${alarm.severity} ${alarm.acknowledged ? 'is-ack' : ''}`}>
          <span className="alarm-row__icon">
            {alarm.severity === 'high' ? <BellRing size={15} /> : <AlertTriangle size={15} />}
          </span>
          <div className="alarm-row__body">
            <div className="alarm-row__head">
              <strong>{alarm.title}</strong>
              <span className={`pill pill--${alarm.severity === 'high' ? 'danger' : alarm.severity === 'medium' ? 'warn' : 'info'}`}>
                {severityLabel(alarm.severity)}
              </span>
            </div>
            <p>{alarm.detail}</p>
            <div className="alarm-row__foot">
              <span className="mono">{fmtClock(alarm.ts)}</span>
              {alarm.acknowledged ? (
                <span>已确认 · {fmtClock(alarm.acknowledgedAt)}</span>
              ) : (
                <button type="button" className="alarm-row__ack" disabled={disabled} onClick={() => onAck(alarm.id)}>
                  确认
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CoilSummary({ devices }: { devices: DeviceSnapshot | null }) {
  const temps = devices?.coils.map((c) => c.temperatureC) ?? [];
  const maxTemp = temps.length > 0 ? Math.max(...temps) : 0;
  return (
    <div className="coil-summary">
      <span><ThermometerSnowflake size={13} /> 最高温 {maxTemp.toFixed(1)} °C</span>
      <span><Cpu size={13} /> {devices?.coils.filter((c) => c.enabled).length ?? 0}/12 在线</span>
      <span className="mono">{fmtPct((devices?.fieldGenerator.dutyPct ?? 0) / 100, 0)} 占空</span>
    </div>
  );
}
