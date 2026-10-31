import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  FolderKanban,
  History,
  LogOut,
  Settings2,
  Volume2,
  VolumeX,
  Waypoints,
} from 'lucide-react';
import { can, type User } from '@magnav/protocol';
import { useSessionStore } from '../store/session';
import { useDataAge } from '../hooks/useTelemetry';
import { phaseTone, roleLabel } from '../lib/format';
import { PhaseChip, StatusPill } from './ui/Primitives';
import { isMuted, setMuted } from '../services/audio';
import { http } from '../services/http';
import { realtime } from '../services/realtime';

function connectionMeta(state: string) {
  switch (state) {
    case 'live':
      return { tone: 'success', label: '实时链路正常' };
    case 'connecting':
      return { tone: 'info', label: '链路连接中' };
    case 'reconnecting':
      return { tone: 'warn', label: '链路重连中' };
    case 'offline':
      return { tone: 'danger', label: '链路离线' };
    default:
      return { tone: 'neutral', label: '链路未连接' };
  }
}

function UserMenu({ user }: { user: User }) {
  const logout = useSessionStore((s) => s.logout);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <details className="user-menu">
      <summary className="user-menu__trigger">
        <span className="avatar">{user.initials}</span>
        <span className="user-menu__id">
          <span className="user-menu__name">{user.name}</span>
          <span className="user-menu__role">{roleLabel(user.role)}</span>
        </span>
      </summary>
      <div className="user-menu__panel">
        <div className="user-menu__head">
          <span className="avatar avatar--lg">{user.initials}</span>
          <div>
            <strong>{user.name}</strong>
            <div className="muted small">{user.title}</div>
            <div className="mono small muted">工牌 {user.badge}</div>
          </div>
        </div>
        <div className="user-menu__caps">
          <span>权限</span>
          <p>{[...(can(user.role, 'procedure:start') ? ['启动自动'] : []), ...(can(user.role, 'procedure:estop') ? ['急停'] : []), ...(can(user.role, 'plan:approve') ? ['计划审核'] : []), ...(can(user.role, 'admin:view') ? ['设备与审计'] : [])].join(' · ') || '只读'}</p>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm btn--block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await http.logout();
            } catch {
              /* ignore */
            }
            realtime.disconnect();
            logout();
            navigate('/login');
          }}
        >
          <LogOut size={14} />
          退出登录
        </button>
      </div>
    </details>
  );
}

export function TopBar() {
  const user = useSessionStore((s) => s.user);
  const snapshot = useSessionStore((s) => s.snapshot);
  const connection = useSessionStore((s) => s.connection);
  const latency = useSessionStore((s) => s.latencyMs);
  const alarms = useSessionStore((s) => s.snapshot?.alarms ?? []);
  const [muted, setMutedState] = useState(() => isMuted());
  const { ageMs, stale } = useDataAge();
  const navigate = useNavigate();
  const location = useLocation();
  const showDataAge = Boolean(snapshot && !snapshot.endedAt && location.pathname.includes('/procedure'));

  useEffect(() => {
    const onStorage = () => setMutedState(isMuted());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (!user) return null;
  const conn = connectionMeta(connection);
  const activeAlarms = alarms.filter((a) => !a.acknowledged && !a.clearedAt);
  const caseId = snapshot?.case.id;
  const canAdmin = can(user.role, 'admin:view');
  const navItems = [
    { to: '/cases', label: '病例', icon: FolderKanban },
    {
      to: caseId ? `/case/${caseId}/plan` : '/cases',
      label: '规划',
      icon: Waypoints,
      muted: !caseId,
    },
    {
      to: caseId ? `/case/${caseId}/procedure` : '/cases',
      label: '术中',
      icon: Activity,
      muted: !caseId,
    },
    {
      to: caseId ? `/case/${caseId}/review` : '/cases',
      label: '复盘',
      icon: History,
      muted: !caseId,
    },
    ...(canAdmin ? [{ to: '/admin', label: '设备', icon: Settings2 }] : []),
  ];

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={() => navigate('/cases')}>
        <span className="brand__mark" aria-hidden>
          <svg viewBox="0 0 32 32" width="26" height="26">
            <path
              d="M16 2.6 27.2 9v14L16 29.4 4.8 23V9L16 2.6Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              opacity="0.65"
            />
            <path
              d="M16 8.1 22.4 11.8v7.4L16 22.9l-6.4-3.7v-7.4L16 8.1Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.4"
            />
            <circle cx="16" cy="15.5" r="2.1" fill="currentColor" />
            <path d="M16 4v6.4M16 21v6.5M5 9.5l6 3.4M21 18.6l6 3.4" stroke="currentColor" strokeWidth="0.9" opacity="0.55" />
          </svg>
        </span>
        <span className="brand__text">
          <span className="brand__name">MAGNAV</span>
          <span className="brand__sub">SUPERVISORY CONSOLE</span>
        </span>
      </button>

      <nav className="main-nav">
        {navItems.map(({ to, label, icon: Icon, muted: navMuted }) => (
          <NavLink
            key={label}
            to={to}
            className={({ isActive }) =>
              `main-nav__item ${isActive && !navMuted ? 'is-active' : ''} ${navMuted ? 'is-muted' : ''}`
            }
          >
            <Icon size={15} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="topbar__right">
        {snapshot ? (
          <div className="topbar__case">
            <span className="mono">{snapshot.case.code}</span>
            <PhaseChip phase={snapshot.phase} compact />
          </div>
        ) : null}

        {snapshot ? (
          <span className={`link-status link-status--${conn.tone}`} title={conn.label}>
            <span className="dot" />
            <span className="link-status__label">{conn.label}</span>
            <span className="mono">{latency > 0 ? `${Math.round(latency)}ms` : '—'}</span>
          </span>
        ) : (
          <span className={`link-status link-status--${conn.tone}`} title={conn.label}>
            <span className="dot" />
            {conn.label}
          </span>
        )}

        {showDataAge ? (
          <span className={`data-age ${stale ? 'is-stale' : ageMs > 120 ? 'is-warn' : ''}`} title="采集 → 屏幕数据年龄">
            数据年龄 <strong>{Number.isFinite(ageMs) ? `${Math.round(ageMs)} ms` : '—'}</strong>
          </span>
        ) : null}

        <button
          type="button"
          className={`icon-btn icon-btn--badge ${activeAlarms.length > 0 ? 'has-alarm' : ''}`}
          title="告警"
          onClick={() => {
            if (caseId) navigate(`/case/${caseId}/procedure`);
          }}
        >
          <Bell size={17} />
          {activeAlarms.length > 0 ? <span className="badge-count">{activeAlarms.length}</span> : null}
        </button>

        <button
          type="button"
          className="icon-btn"
          title={muted ? '取消静音' : '静音告警声'}
          onClick={() => {
            setMuted(!muted);
            setMutedState(!muted);
          }}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>

        <UserMenu user={user} />
      </div>
    </header>
  );
}
