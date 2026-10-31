import { useEffect, useState } from 'react';
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Fingerprint, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { DISCLAIMER, ROLE_META, type Role } from '@magnav/protocol';
import { http } from '../services/http';
import { useSessionStore } from '../store/session';
import { Button } from '../components/ui/Button';
import { initAudio } from '../services/audio';
import { realtime } from '../services/realtime';

const DEMO_ACCOUNTS: Array<{ role: Role; name: string; badge: string; pin: string }> = [
  { role: 'surgeon', name: '赵*峰', badge: 'M-1042', pin: '2468' },
  { role: 'assistant', name: '李*婷', badge: 'M-1087', pin: '1357' },
  { role: 'tech', name: '王*磊', badge: 'T-2011', pin: '8642' },
  { role: 'engineer', name: '陈*涛', badge: 'E-3007', pin: '1122' },
  { role: 'reviewer', name: '周*敏', badge: 'Q-4003', pin: '4455' },
];

export function LoginPage() {
  const user = useSessionStore((s) => s.user);
  const setAuth = useSessionStore((s) => s.setAuth);
  const boot = useSessionStore((s) => s.boot);
  const authError = useSessionStore((s) => s.authError);
  const setAuthError = useSessionStore((s) => s.setAuthError);
  const navigate = useNavigate();
  const [badge, setBadge] = useState('M-1042');
  const [pin, setPin] = useState('2468');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    initAudio();
  }, []);

  if (boot === 'ready' && user) return <Navigate to="/cases" replace />;
  if (boot === 'loading') return null;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setAuthError(null);
    try {
      const result = await http.login(badge, pin);
      setAuth(result.user, result.csrfToken);
      realtime.connect();
      navigate('/cases');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '登录失败');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <aside className="login__visual">
        <div className="login__grid" />
        <div className="login__field" aria-hidden>
          <svg viewBox="0 0 800 900" preserveAspectRatio="none">
            <defs>
              <linearGradient id="field-line" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#2dd4bf" stopOpacity="0" />
                <stop offset="0.45" stopColor="#2dd4bf" stopOpacity="0.55" />
                <stop offset="1" stopColor="#58a6ff" stopOpacity="0" />
              </linearGradient>
              <radialGradient id="field-glow">
                <stop offset="0" stopColor="#2dd4bf" stopOpacity="0.35" />
                <stop offset="1" stopColor="#2dd4bf" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="400" cy="430" r="190" fill="url(#field-glow)" />
            {Array.from({ length: 14 }).map((_, index) => {
              const offset = index * 36;
              return (
                <path
                  key={index}
                  d={`M ${120 - offset} 720 C ${240 - offset} 540, ${320 - offset} 380, ${400} ${
                    430 + (index - 7) * 26
                  } S ${560 + offset} 700, ${760 + offset} 840`}
                  stroke="url(#field-line)"
                  strokeWidth="1"
                  fill="none"
                  className="login__field-line"
                  style={{ animationDelay: `${index * -0.9}s` }}
                />
              );
            })}
            <g className="login__coil-ring">
              <ellipse cx="400" cy="430" rx="250" ry="86" />
              <ellipse cx="400" cy="430" rx="200" ry="66" />
              <ellipse cx="400" cy="430" rx="150" ry="46" />
            </g>
            <circle cx="400" cy="430" r="4" fill="#8ef4e8" />
            <circle cx="400" cy="430" r="14" fill="none" stroke="#8ef4e8" strokeOpacity="0.5" />
          </svg>
        </div>

        <div className="login__brand">
          <div className="brand__mark brand__mark--xl">
            <svg viewBox="0 0 32 32" width="42" height="42">
              <path d="M16 2.6 27.2 9v14L16 29.4 4.8 23V9L16 2.6Z" fill="none" stroke="currentColor" strokeWidth="1.1" />
              <path d="M16 8.1 22.4 11.8v7.4L16 22.9l-6.4-3.7v-7.4L16 8.1Z" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.5" />
              <circle cx="16" cy="15.5" r="2" fill="currentColor" />
            </svg>
          </div>
          <div>
            <h1>MAGNAV</h1>
            <p>磁控介入手术机器人 · 监督控制台</p>
          </div>
        </div>

        <div className="login__statement">
          <span className="eyebrow">SUPERVISORY CONTROL · WEB FULL-STACK</span>
          <h2>
            看清楚，
            <br />
            规划好，
            <br />
            管得住。
          </h2>
          <p>
            前端不参与 1 kHz 闭环。所有运动指令都是高层意图，门禁与安全包络由实时层裁决；
            控制台负责毫米级空间关系、磁导航可行性与全程可追溯。
          </p>
        </div>

        <div className="login__features">
          <div>
            <ShieldCheck size={18} />
            <span>双人确认 · 人在环 · 急停与看门狗</span>
          </div>
          <div>
            <Fingerprint size={18} />
            <span>角色权限 · 哈希链审计 · 全量回放</span>
          </div>
          <div>
            <Sparkles size={18} />
            <span>Three.js 场景内核 · 120 Hz 遥测 · Worker 解码</span>
          </div>
        </div>
        <div className="login__version">v0.1 · 研究原型 · NOT FOR CLINICAL USE</div>
      </aside>

      <main className="login__panel">
        <Link to="/" className="login__home">
          ← 返回首页 / 交互演示
        </Link>
        <div className="login__card">
          <div className="login__card-head">
            <span className="eyebrow">SECURE ACCESS</span>
            <h2>登录监督控制台</h2>
            <p>使用工牌与个人口令。会话 8 小时过期，所有操作与告警写入审计链。</p>
          </div>

          <form
            className="login__form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="field">
              <span className="field__label">工牌编号</span>
              <div className="field__control">
                <Fingerprint size={16} />
                <input
                  value={badge}
                  autoComplete="username"
                  onChange={(event) => setBadge(event.target.value.toUpperCase())}
                  placeholder="M-1042"
                  spellCheck={false}
                />
              </div>
            </label>
            <label className="field">
              <span className="field__label">个人口令</span>
              <div className="field__control">
                <LockKeyhole size={16} />
                <input
                  type="password"
                  value={pin}
                  autoComplete="current-password"
                  onChange={(event) => setPin(event.target.value)}
                  placeholder="••••"
                  maxLength={12}
                />
              </div>
            </label>

            {authError ? <div className="login__error">{authError}</div> : null}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              disabled={busy || !badge || !pin}
              trailing={<ArrowRight size={16} />}
            >
              {busy ? '正在验证…' : '进入控制台'}
            </Button>
          </form>

          <div className="login__demo">
            <div className="login__demo-head">
              <span>演示账号</span>
              <span className="muted small">点击填入 · 仅为本地模拟数据</span>
            </div>
            <div className="login__accounts">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.badge}
                  type="button"
                  className={`login__account ${badge === account.badge ? 'is-active' : ''}`}
                  onClick={() => {
                    setBadge(account.badge);
                    setPin(account.pin);
                    setAuthError(null);
                  }}
                >
                  <span className={`role-dot role-dot--${ROLE_META[account.role].tone}`} />
                  <span className="login__account-main">
                    <strong>{ROLE_META[account.role].label}</strong>
                    <span>{account.name}</span>
                  </span>
                  <span className="login__account-code mono">{account.badge}</span>
                  <span className="login__account-pin mono">{account.pin}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="login__disclaimer">{DISCLAIMER}</p>
        </div>

        <footer className="login__footer">
          <span>IEC 62304 · ISO 14971 · IEC 62366-1 设计参考</span>
          <span>本地部署 · 无外部请求 · 数据不出院区</span>
        </footer>
      </main>
    </div>
  );
}
