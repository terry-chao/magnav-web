import type { AlarmSeverity, ProcedurePhase, Role } from '@magnav/protocol';
import { PHASE_META, ROLE_META } from '@magnav/protocol';

export function fmt(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

export function fmtPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtMm(value: number | null | undefined, digits = 1): string {
  return `${fmt(value, digits)} mm`;
}

export function fmtClock(ts: number | null | undefined): string {
  if (!ts || !Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts || !Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${fmtClock(ts)}`;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}:${String(rem).padStart(2, '0')}` : `${rem}s`;
}

export function fmtAge(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function phaseLabel(phase: ProcedurePhase | null | undefined): string {
  return phase ? PHASE_META[phase].label : '—';
}

export function phaseTone(phase: ProcedurePhase | null | undefined): string {
  return phase ? PHASE_META[phase].tone : 'neutral';
}

export function roleLabel(role: Role | null | undefined): string {
  return role ? ROLE_META[role].label : '—';
}

export function severityLabel(severity: AlarmSeverity): string {
  return severity === 'high' ? '高' : severity === 'medium' ? '中' : '低';
}

export function shortHash(hash: string | undefined): string {
  if (!hash) return '—';
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

const PERSON_LABELS: Record<string, string> = {
  'u-surgeon': '赵*峰',
  'u-assistant': '李*婷',
  'u-tech': '王*磊',
  'u-engineer': '陈*涛',
  'u-reviewer': '周*敏',
};

export function personLabel(id: string | null | undefined): string {
  if (!id) return '—';
  return PERSON_LABELS[id] ?? id.replace(/^u-/, '');
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
