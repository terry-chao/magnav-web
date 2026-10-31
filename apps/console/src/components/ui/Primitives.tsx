import type { ReactNode } from 'react';
import { GATE_STEPS, PHASE_META, type ProcedurePhase } from '@magnav/protocol';
import { phaseLabel, phaseTone } from '../../lib/format';

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
  dense = false,
  scroll = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  dense?: boolean;
  scroll?: boolean;
}) {
  return (
    <section className={`panel ${dense ? 'panel--dense' : ''} ${scroll ? 'panel--scroll' : ''} ${className}`}>
      {title || actions ? (
        <header className="panel__head">
          <div className="panel__titles">
            {title ? <h2 className="panel__title">{title}</h2> : null}
            {subtitle ? <span className="panel__subtitle">{subtitle}</span> : null}
          </div>
          {actions ? <div className="panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="panel__body">{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  unit,
  hint,
  tone = 'default',
  size = 'md',
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: 'default' | 'accent' | 'warn' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <div className={`metric metric--${size} tone-${tone}`}>
      <span className="metric__label">{label}</span>
      <span className="metric__value">
        {value}
        {unit ? <span className="metric__unit">{unit}</span> : null}
      </span>
      {hint ? <span className="metric__hint">{hint}</span> : null}
    </div>
  );
}

export function Gauge({
  label,
  value,
  limit,
  max,
  unit,
  digits = 2,
  dangerAt = 0.95,
  warnAt = 0.8,
  hint,
}: {
  label: string;
  value: number;
  limit: number;
  max?: number;
  unit?: string;
  digits?: number;
  dangerAt?: number;
  warnAt?: number;
  hint?: string;
}) {
  const ceiling = max ?? limit * 1.1;
  const ratio = Math.max(0, Math.min(1, value / ceiling));
  const utilization = limit > 0 ? value / limit : 0;
  const tone = utilization >= dangerAt ? 'danger' : utilization >= warnAt ? 'warn' : 'ok';
  const limitRatio = Math.max(0, Math.min(1, limit / ceiling));
  return (
    <div className={`gauge gauge--${tone}`}>
      <div className="gauge__meta">
        <span className="gauge__label">{label}</span>
        <span className="gauge__value">
          {value.toFixed(digits)}
          {unit ? <span className="gauge__unit"> {unit}</span> : null}
          <span className="gauge__limit">
            {' '}
            / {limit.toFixed(digits)} {unit}
          </span>
        </span>
      </div>
      <div className="gauge__track">
        <div className="gauge__fill" style={{ width: `${ratio * 100}%` }} />
        <div className="gauge__limit-mark" style={{ left: `${limitRatio * 100}%` }} />
      </div>
      {hint ? <span className="gauge__hint">{hint}</span> : null}
    </div>
  );
}

export function StatusPill({
  tone = 'neutral',
  children,
  pulse = false,
  dot = true,
}: {
  tone?: string;
  children: ReactNode;
  pulse?: boolean;
  dot?: boolean;
}) {
  return (
    <span className={`pill pill--${tone} ${pulse ? 'pill--pulse' : ''}`}>
      {dot ? <span className="pill__dot" /> : null}
      {children}
    </span>
  );
}

export function PhaseChip({ phase, compact = false }: { phase: ProcedurePhase; compact?: boolean }) {
  const meta = PHASE_META[phase];
  return (
    <span
      className={`phase-chip phase-chip--${meta.tone} ${compact ? 'phase-chip--compact' : ''}`}
      title={meta.hint}
    >
      <span className="phase-chip__dot" />
      <span className="phase-chip__label">{phaseLabel(phase)}</span>
      <span className="phase-chip__code">{meta.short}</span>
    </span>
  );
}

export function GateRail({ phase }: { phase: ProcedurePhase }) {
  const meta = PHASE_META[phase];
  const finalDone = phase === 'COMPLETED';
  const aborted = phase === 'ABORTED' || phase === 'ABORTING';
  return (
    <ol className={`gate-rail ${aborted ? 'gate-rail--aborted' : ''}`}>
      {GATE_STEPS.map((step, index) => {
        const stepNo = index + 1;
        const done = finalDone || meta.step > stepNo;
        const current = !finalDone && meta.step === stepNo;
        return (
          <li
            key={step.phase}
            className={`gate-rail__item ${done ? 'is-done' : ''} ${current ? 'is-current' : ''}`}
          >
            <span className="gate-rail__marker">{done ? '✓' : stepNo}</span>
            <span className="gate-rail__label">{step.label}</span>
            {index < GATE_STEPS.length - 1 ? <span className="gate-rail__line" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-state__icon">{icon}</div> : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__text">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

export function KeyHint({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
