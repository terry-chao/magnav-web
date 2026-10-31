import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Database,
  FileCheck2,
  Fingerprint,
  GitBranch,
  Github,
  HeartPulse,
  LockKeyhole,
  Play,
  Radio,
  ScanLine,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { http } from '../services/http';
import { useSessionStore } from '../store/session';
import './home.css';

function HeroConsole() {
  return (
    <div className="home-console" aria-label="MAGNAV 术中控制台预览">
      <div className="home-console__chrome">
        <span className="home-console__dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="home-console__chrome-title">
          MAGNAV <b>/</b> C-2026-1031
        </span>
        <span className="home-console__live">
          <i /> LIVE SIM
        </span>
      </div>

      <div className="home-console__stage">
        <svg viewBox="0 0 640 480" role="img" aria-label="血管树、导管与目标点示意">
          <defs>
            <pattern id="home-grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(120,170,180,.10)" strokeWidth="1" />
            </pattern>
            <linearGradient id="home-vessel" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#b8e5d0" stopOpacity=".22" />
              <stop offset=".55" stopColor="#5ad9c6" stopOpacity=".72" />
              <stop offset="1" stopColor="#ffcf7a" stopOpacity=".85" />
            </linearGradient>
            <linearGradient id="home-route" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#4de2d0" stopOpacity=".15" />
              <stop offset=".7" stopColor="#4de2d0" />
              <stop offset="1" stopColor="#ffcf7a" />
            </linearGradient>
            <radialGradient id="home-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#4de2d0" stopOpacity=".45" />
              <stop offset="1" stopColor="#4de2d0" stopOpacity="0" />
            </radialGradient>
            <filter id="home-blur" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
          </defs>

          <rect width="640" height="480" fill="url(#home-grid)" />
          <circle cx="430" cy="235" r="115" fill="url(#home-glow)" opacity=".45" />

          <g className="home-console__vessels">
            <path d="M320 445 C315 390 286 352 302 305 C318 258 274 220 290 170 C302 132 330 116 342 82" />
            <path d="M302 305 C350 292 388 264 430 235" />
            <path d="M302 305 C253 292 220 255 178 240" />
            <path d="M342 82 C360 58 390 48 414 38" />
            <path d="M290 170 C258 158 230 165 202 150" />
            <path d="M178 240 C155 225 140 205 120 198" />
            <path d="M430 235 C468 222 490 200 512 180" />
          </g>

          <g className="home-console__field" aria-hidden>
            <ellipse cx="430" cy="235" rx="74" ry="44" transform="rotate(-18 430 235)" />
            <ellipse cx="430" cy="235" rx="98" ry="62" transform="rotate(-18 430 235)" />
            <ellipse cx="430" cy="235" rx="122" ry="80" transform="rotate(-18 430 235)" />
          </g>

          <g className="home-console__route">
            <path d="M320 445 C315 390 286 352 302 305 C350 292 388 264 430 235" />
          </g>

          <g className="home-console__target">
            <circle cx="430" cy="235" r="22" className="home-console__target-halo" />
            <circle cx="430" cy="235" r="10" />
            <circle cx="430" cy="235" r="3.5" />
            <path d="M430 203 V 193 M430 267 V 277 M398 235 H 388 M462 235 H 472" />
          </g>

          <g className="home-console__coils" aria-hidden>
            {[
              [76, 88],
              [148, 52],
              [226, 34],
              [306, 28],
              [386, 34],
              [464, 58],
              [538, 100],
              [566, 176],
              [552, 260],
              [504, 332],
              [420, 384],
              [326, 408],
            ].map(([cx, cy], i) => (
              <g key={i}>
                <circle cx={cx} cy={cy} r="5" />
                <circle cx={cx} cy={cy} r="11" className="home-console__coil-ring" />
              </g>
            ))}
          </g>

          <g className="home-console__catheter">
            <path d="M320 445 C315 390 286 352 302 305 C350 292 388 264 430 235" />
            <circle cx="430" cy="235" r="6" />
            <circle cx="430" cy="235" r="16" className="home-console__tip-halo" filter="url(#home-blur)" />
          </g>

          <g className="home-console__labels">
            <text x="338" y="74">LAD · TARGET PATH</text>
            <text x="448" y="226">TARGET</text>
            <text x="332" y="462">CATHETER TIP · 96 PT</text>
            <text x="64" y="110">C1</text>
            <text x="532" y="108">C7</text>
          </g>
        </svg>

        <div className="home-console__hud">
          <div>
            <span>场强 |B|</span>
            <strong>
              21.4 <small>mT</small>
            </strong>
          </div>
          <div>
            <span>梯度 |∇B|</span>
            <strong>
              0.21 <small>T/m</small>
            </strong>
          </div>
          <div>
            <span>侧向力</span>
            <strong>
              0.09 <small>N</small>
            </strong>
          </div>
          <div>
            <span>遥测</span>
            <strong>
              120 <small>Hz</small>
            </strong>
          </div>
        </div>
      </div>

      <div className="home-console__foot">
        <span className="home-console__phase">
          <i /> 自动运行
        </span>
        <span className="home-console__case">
          <Fingerprint size={13} /> 赵*峰 · 术者
        </span>
        <span className="home-console__controls">
          <b>暂停</b>
          <b>急停</b>
        </span>
      </div>
    </div>
  );
}

const DEMO_STEPS = [
  {
    n: '01',
    title: '装载病例',
    body: '预置 LAD 病例、已签字计划与配准数据自动进入术中页。',
  },
  {
    n: '02',
    title: '双人确认',
    body: '术者登录后，由助手输入工牌与口令，进入 ARMED。',
  },
  {
    n: '03',
    title: '长按启动',
    body: '勾选现场确认，按住 0.8 s 才进入自动导航。',
  },
  {
    n: '04',
    title: '暂停 / 急停',
    body: '随时暂停、接管或急停；复位后保持暂停，不会自动复跑。',
  },
];

const CAPABILITIES = [
  {
    icon: ScanLine,
    tag: '01 / NAVIGATION',
    title: '三维导航，\n不是一张图。',
    body: '血管树、96 点导管形状、目标路径与场线在同一场景里；LPS 与 Three.js 坐标严格互转，复盘可逐帧回放。',
    note: 'R3F · Three.js · 120 Hz',
  },
  {
    icon: ShieldCheck,
    tag: '02 / AUTHORITY',
    title: '服务端权威，\n前端只发意图。',
    body: 'xstate 状态机在服务端唯一运行：预检、双人武装、长按启动、40 s 人在环、5 s 看门狗、急停锁存。',
    note: 'xstate v5 · 角色门禁 · 幂等',
  },
  {
    icon: FileCheck2,
    tag: '03 / AUDIT',
    title: '每个动作，\n都能被复盘。',
    body: '10 Hz 轨迹记录、事件时间轴、告警与哈希链审计；JSON 导出后仍可逐条校验。',
    note: 'SHA-256 · NDJSON · 全量回放',
  },
];

const STACK = [
  {
    icon: Database,
    title: 'SQLite 持久化',
    body: '病例、计划、会话与复盘落库；重启恢复但强制保持暂停。',
    meta: 'data/magnav.sqlite',
  },
  {
    icon: GitBranch,
    title: 'RobotGateway',
    body: '模拟器只是默认实现；真实 1 kHz 实时层按同一契约接入。',
    meta: 'simulated / external',
  },
  {
    icon: Activity,
    title: '51 + 5 项验证',
    body: '协议、状态机、门禁、持久化、网关单测，加上 Playwright 首页与主流程。',
    meta: 'Vitest · Playwright · CI',
  },
  {
    icon: Play,
    title: 'F5 全栈调试',
    body: '一个快捷键同时启动 Vite 与 API，服务端和前端断点都可下。',
    meta: 'VS Code · tsx · Chrome',
  },
];

export function HomePage() {
  const navigate = useNavigate();
  const staticDemo = import.meta.env.VITE_STATIC_DEMO === '1';
  const user = useSessionStore((s) => s.user);
  const setAuth = useSessionStore((s) => s.setAuth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startDemo = async () => {
    if (busy) return;
    if (staticDemo) {
      navigate('/demo');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const auth = await http.login('M-1042', '2468');
      setAuth(auth.user, auth.csrfToken);
      await http.startDemo();
      navigate('/case/case-1031/procedure?demo=1');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '演示装载失败，请确认服务已启动。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <header className="home-nav">
        <Link to="/" className="home-logo" aria-label="MAGNAV 首页">
          <span className="home-logo__mark">
            <i />
            M
          </span>
          <span className="home-logo__text">
            <strong>MAGNAV</strong>
            <small>SUPERVISORY CONSOLE</small>
          </span>
        </Link>

        <nav className="home-nav__links" aria-label="首页导航">
          <a href="#capabilities">能力</a>
          <a href="#demo">演示</a>
          <a href="#stack">工程</a>
          <a href="#safety">安全</a>
          <a href="https://github.com/terry-chao/magnav-web" target="_blank" rel="noreferrer">
            GitHub <Github size={13} />
          </a>
        </nav>

        <div className="home-nav__actions">
          {!staticDemo ? (
            <>
              {user ? (
                <Link to="/cases" className="home-btn home-btn--ghost home-btn--sm">
                  控制台
                </Link>
              ) : (
                <Link to="/login" className="home-btn home-btn--ghost home-btn--sm">
                  登录
                </Link>
              )}
            </>
          ) : null}
          <button type="button" className="home-btn home-btn--primary home-btn--sm" onClick={() => void startDemo()} disabled={busy}>
            {busy ? '装载中…' : staticDemo ? '开始演示' : '进入演示'}
            <ArrowRight size={15} />
          </button>
        </div>
      </header>

      {staticDemo ? (
        <div className="home-static-banner">
          <span>
            <Github size={13} /> GITHUB PAGES 静态版
          </span>
          <span>浏览器内运行共享状态机 + 模拟器 · 无登录 / 无服务端连接</span>
          <a href="https://github.com/terry-chao/magnav-web" target="_blank" rel="noreferrer">
            查看完整版
          </a>
        </div>
      ) : null}

      <main>
        <section className="home-hero">
          <div className="home-hero__copy">
            <div className="home-kicker">
              <i />
              {staticDemo ? 'GITHUB PAGES · STATIC DEMO' : 'WEB FULL-STACK · RESEARCH PROTOTYPE'}
            </div>
            <h1>
              看得见导管，
              <br />
              <span>控得住磁场。</span>
            </h1>
            <p className="home-lede">
              MAGNAV 是磁控介入手术机器人的监督控制台。从 3D 血管路径、120 Hz 遥测，到双人确认、急停与全量复盘，
              一条链路完成。
            </p>

            <div className="home-actions">
              <button type="button" className="home-btn home-btn--primary home-btn--lg" onClick={() => void startDemo()} disabled={busy}>
                {busy ? '正在装载病例…' : staticDemo ? '进入浏览器演示' : '进入 2 分钟实操'}
                <ArrowRight size={18} />
              </button>
              <a className="home-btn home-btn--ghost home-btn--lg" href="#capabilities">
                先看能力
                <ChevronDown size={17} />
              </a>
            </div>

            {error ? (
              <div className="home-error" role="alert">
                {error}
              </div>
            ) : null}

            <div className="home-note">
              <CheckCircle2 size={14} />
              {staticDemo
                ? '浏览器内运行 · 无需注册 · 演示数据不离开本机'
                : '预置 LAD 病例 · 无需注册 · 操作写入本地审计'}
            </div>
          </div>

          <div className="home-hero__visual">
            <div className="home-hero__orbit home-hero__orbit--one" />
            <div className="home-hero__orbit home-hero__orbit--two" />
            <HeroConsole />
            <div className="home-hero__caption">
              <span>INTERFACE PREVIEW</span>
              <span>3D · TELEMETRY · COMMAND</span>
            </div>
          </div>
        </section>

        <section className="home-proof" aria-label="关键指标">
          <div>
            <strong>120 <small>Hz</small></strong>
            <span>遥测帧率</span>
          </div>
          <div>
            <strong>96 <small>PT</small></strong>
            <span>导管形状点</span>
          </div>
          <div>
            <strong>12 <small>COILS</small></strong>
            <span>磁场线圈</span>
          </div>
          <div>
            <strong>5 <small>s</small></strong>
            <span>链路看门狗</span>
          </div>
          <div>
            <strong>100<small>%</small></strong>
            <span>审计覆盖</span>
          </div>
        </section>

        <section id="demo" className="home-section home-demo">
          <div className="home-section__head">
            <span className="home-kicker">
              <i />
              01 / HANDS-ON
            </span>
            <h2>
              不是录屏，
              <br />
              是现在就能操作的病例。
            </h2>
            <p>
              {staticDemo
                ? '点击「进入浏览器演示」，会直接打开一个在浏览器内运行的真实状态机 + 运动学模拟器。没有服务端，也没有录屏。'
                : '点击「进入 2 分钟实操」，系统会以演示术者登录、装载预置 LAD 病例并打开真实术中控制台。每一步都是实际命令，不是前端动画。'}
            </p>
          </div>

          <div className="home-demo__grid">
            <ol className="home-steps">
              {DEMO_STEPS.map((step) => (
                <li key={step.n}>
                  <span className="home-steps__n">{step.n}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="home-mission">
              <div className="home-mission__head">
                <span>
                  <Radio size={14} /> DEMO MISSION
                </span>
                <span className="home-mission__eta">≈ 2 MIN</span>
              </div>
              <h3>把一次介入，走成一条可验证的链路。</h3>
              <ul>
                <li>
                  <CheckCircle2 size={15} /> 运行 9 项术前预检
                </li>
                <li>
                  <CheckCircle2 size={15} /> 术者 + 助手双人确认
                </li>
                <li>
                  <CheckCircle2 size={15} /> 长按启动，观察实时遥测
                </li>
                <li>
                  <CheckCircle2 size={15} /> 暂停 / 急停 / 复盘
                </li>
              </ul>
              <button type="button" className="home-btn home-btn--primary home-btn--lg" onClick={() => void startDemo()} disabled={busy}>
                {busy ? '正在装载病例…' : staticDemo ? '开始浏览器演练' : '开始这次演练'}
                <ArrowRight size={18} />
              </button>
              <p className="home-mission__foot">
                <LockKeyhole size={13} /> 演示账号只使用合成数据；不连接真实设备。
              </p>
            </div>
          </div>
        </section>

        <section id="capabilities" className="home-section home-capabilities">
          <div className="home-section__head home-section__head--row">
            <div>
              <span className="home-kicker">
                <i />
                02 / CAPABILITIES
              </span>
              <h2>
                一个控制台，
                <br />
                三层可信。
              </h2>
            </div>
            <p>
              视觉上看到的是导管和磁场；背后是服务端状态机、严格门禁与可校验的记录。
              这不是一个好看的前端，而是一条能解释「为什么现在能动」的链路。
            </p>
          </div>

          <div className="home-card-grid">
            {CAPABILITIES.map((item) => {
              const Icon = item.icon;
              return (
                <article className="home-card" key={item.tag}>
                  <div className="home-card__top">
                    <span className="home-card__icon">
                      <Icon size={19} />
                    </span>
                    <span className="home-card__tag">{item.tag}</span>
                  </div>
                  <h3>
                    {item.title.split('\n').map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </h3>
                  <p>{item.body}</p>
                  <span className="home-card__note">{item.note}</span>
                </article>
              );
            })}
          </div>
        </section>

        <section className="home-section home-showcase">
          <figure className="home-shot">
            <div className="home-shot__bar">
              <span>
                <i />
                <i />
                <i />
              </span>
              <span>实际运行 · C-2026-1031 · AUTO RUNNING</span>
              <span>1600 × 1000</span>
            </div>
              <img
                src={`${import.meta.env.BASE_URL}showcase/procedure.png`}
                alt="MAGNAV 术中控制台实际运行截图：3D 血管树、遥测曲线、线圈状态与命令栏"
                width={1600}
                height={1050}
              />
            <figcaption>
              <span>真实运行截图，不是效果图。</span>
              <span>3D 血管树 · 96 点导管 · 12 路线圈 · 10 Hz 回顾记录</span>
            </figcaption>
          </figure>
        </section>

        <section id="stack" className="home-section home-stack">
          <div className="home-section__head">
            <span className="home-kicker">
              <i />
              03 / FOUNDATION
            </span>
            <h2>
              能演示，
              <br />
              也能继续长。
            </h2>
            <p>
              从浏览器到 SQLite，从模拟器到真实实时层，中间是一个明确的网关边界。
              这套仓库先保证今天能跑，再保证明天能换。
            </p>
          </div>

          <div className="home-stack__grid">
            {STACK.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="home-stack__item">
                  <Icon size={18} />
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <span>{item.meta}</span>
                </article>
              );
            })}
          </div>
        </section>

        <section id="safety" className="home-section home-safety">
          <div className="home-safety__copy">
            <span className="home-kicker">
              <i />
              04 / SAFETY BY DEFAULT
            </span>
            <h2>
              默认不动，
              <br />
              才敢让人动。
            </h2>
            <p>
              链路丢失、位姿过期、人在环超时、急停未复位、计划未签字——任何一个条件不满足，
              系统都选择停止或拒绝，而不是猜测。
            </p>
            <div className="home-safety__tags">
              <span>
                <HeartPulse size={13} /> 40 s 人在环
              </span>
              <span>
                <Zap size={13} /> 0.8 s 长按启动
              </span>
              <span>
                <LockKeyhole size={13} /> 急停锁存
              </span>
              <span>
                <FileCheck2 size={13} /> 哈希链审计
              </span>
            </div>
          </div>
          <div className="home-safety__metrics">
            <div>
              <strong>5 <small>s</small></strong>
              <span>链路看门狗 → 自动暂停</span>
            </div>
            <div>
              <strong>200 <small>ms</small></strong>
              <span>位姿过期 → 3D 冻结</span>
            </div>
            <div>
              <strong>800 <small>ms</small></strong>
              <span>启动 / 中止长按确认</span>
            </div>
            <div>
              <strong>SHA-256</strong>
              <span>逐条审计链校验</span>
            </div>
          </div>
        </section>

        <section className="home-final">
          <div>
            <span className="home-kicker">
              <i />
              READY WHEN YOU ARE
            </span>
            <h2>把第一个病例，跑起来。</h2>
            <p>不用注册，不用装客户端。预置病例已经在等你了。</p>
          </div>
          <div className="home-final__actions">
            <button type="button" className="home-btn home-btn--primary home-btn--lg" onClick={() => void startDemo()} disabled={busy}>
              {busy ? '正在装载病例…' : staticDemo ? '进入静态演示' : '进入交互演示'}
              <ArrowRight size={18} />
            </button>
            <a className="home-btn home-btn--ghost home-btn--lg" href="https://github.com/terry-chao/magnav-web" target="_blank" rel="noreferrer">
              <Github size={17} /> 查看源码
            </a>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-footer__brand">
          <span className="home-logo__mark home-logo__mark--sm">M</span>
          <div>
            <strong>MAGNAV</strong>
            <span>磁控介入手术机器人 · 监督控制台</span>
          </div>
        </div>
        <p>
          研究用原型，非医疗器械。所有患者、影像、磁场、机器人与告警均为确定性模拟数据，不得用于临床诊断或治疗。
        </p>
        <div className="home-footer__links">
          <a href="#demo">交互演示</a>
          <a href="#stack">技术底座</a>
          <a href="https://github.com/terry-chao/magnav-web" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <span>© 2026 MAGNAV · LOCAL-FIRST</span>
        </div>
      </footer>
    </div>
  );
}
