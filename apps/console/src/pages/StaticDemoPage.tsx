import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createActor } from 'xstate';
import {
  LIMITS,
  V,
  phaseOf,
  procedureMachine,
  type PrecheckReport,
  type ProcedureEvent,
  type ProcedurePhase,
  type TelemetryFrame,
} from '@magnav/protocol';
import { buildSeedData } from '../../../server/src/seed/index';
import { buildPrecheck } from '../../../server/src/planning';
import { RobotEngine } from '../../../server/src/simulator';
import { SceneCanvas } from '../scene/SceneCanvas';
import type { PlaybackFrame } from '../scene/objects/Catheter';
import { Button, HoldButton } from '../components/ui/Button';
import { Metric, Panel, PhaseChip } from '../components/ui/Primitives';
import './static-demo.css';

type DemoPhase = ProcedurePhase;

const ACTIVE: DemoPhase[] = ['ARMED', 'AUTO_RUNNING', 'AUTO_PAUSED', 'MANUAL', 'ABORTING'];

function nextHint(phase: DemoPhase, precheckPassed: boolean): string {
  if (phase === 'REGISTERED' || phase === 'MANUAL') {
    return precheckPassed ? '预检已通过 · 进行双人确认武装' : '先运行飞行前预检';
  }
  if (phase === 'ARMED') return '已武装 · 勾选确认并长按启动';
  if (phase === 'AUTO_RUNNING') return '自动导航中 · 可暂停 / 接管 / 急停 / 中止';
  if (phase === 'AUTO_PAUSED') return '已暂停 · 确认现场后可继续或中止';
  if (phase === 'ABORTING') return '正在沿原路径回撤';
  if (phase === 'COMPLETED') return '目标点已到达 · 查看本次事件与遥测';
  if (phase === 'ABORTED') return '流程已中止 · 可重新开始';
  return '等待操作';
}

export function StaticDemoPage() {
  const data = useMemo(() => {
    const seed = buildSeedData();
    const record = seed.cases.find((item) => item.id === 'case-1031')!;
    const plan = seed.plans.get('plan-1031-lad')!;
    const tree = seed.trees.get('case-1031')!;
    const registration = seed.registrations.get('case-1031')!;
    return { record, plan, tree, registration };
  }, []);

  const actor = useMemo(() => {
    const next = createActor(procedureMachine, { input: { treMaxMm: LIMITS.treMaxMm } });
    next.start();
    const bootstrap: ProcedureEvent[] = [
      { type: 'SET_TRE', treMm: data.registration.treMm },
      { type: 'SET_PLAN', approved: true, feasible: data.plan.feasibility.passed },
      { type: 'LOAD_CASE' },
      { type: 'IMAGES_READY' },
      { type: 'PLAN_CONFIRMED' },
      { type: 'REGISTERED' },
    ];
    for (const event of bootstrap) next.send(event);
    return next;
  }, [data]);

  const engine = useMemo(() => new RobotEngine(data.plan), [data]);
  const [phase, setPhase] = useState<DemoPhase>(() => phaseOf(actor.getSnapshot().value));
  const [frame, setFrame] = useState<TelemetryFrame>(() => engine.frame(Date.now()));
  const [precheck, setPrecheck] = useState<PrecheckReport | null>(null);
  const [estopLatched, setEstopLatched] = useState(false);
  const [notice, setNotice] = useState('浏览器内静态演示：共享状态机 + 确定性模拟器，不连接服务端。');

  const sync = useCallback(() => {
    const snap = actor.getSnapshot();
    setPhase(phaseOf(snap.value));
    setEstopLatched(Boolean(snap.context.estopLatched));
  }, [actor]);

  const runPrecheck = () => {
    const report = buildPrecheck({
      treMm: data.registration.treMm,
      plan: data.plan,
      coilTemps: Array.from({ length: 12 }, (_, i) => 32.4 + (i % 4) * 0.6),
      coilsEnabled: 12,
      estopClosed: true,
      latencyP95Ms: 42,
    });
    const full: PrecheckReport = {
      ...report,
      ranAt: Date.now(),
      ranBy: 'static-demo',
    };
    setPrecheck(full);
    actor.send({ type: 'PRECHECK_UPDATED', items: full.items });
    sync();
    setNotice(full.passed ? '预检通过 · 可以双人确认武装' : '预检未通过 · 请检查未通过项');
  };

  const arm = () => {
    actor.send({
      type: 'SET_COUNTERSIGN',
      armedBy: 'u-surgeon',
      countersignedBy: 'u-assistant',
    });
    actor.send({ type: 'PRECHECK_PASSED' });
    sync();
    setNotice('双人确认完成 · 已进入 ARMED；武装不等于运动。');
  };

  const start = () => {
    actor.send({ type: 'START_AUTO' });
    const snap = actor.getSnapshot();
    setPhase(phaseOf(snap.value));
    setEstopLatched(Boolean(snap.context.estopLatched));
    if (phaseOf(snap.value) === 'AUTO_RUNNING') {
      engine.start();
      setNotice('自动导航已启动 · 演示以 5× 速度推进');
    }
  };

  const pause = () => {
    actor.send({ type: 'PAUSE', reason: '静态演示：术者暂停' });
    engine.hold();
    sync();
    setNotice('已暂停 · 位置保持');
  };

  const resume = () => {
    actor.send({ type: 'RESUME' });
    if (phaseOf(actor.getSnapshot().value) === 'AUTO_RUNNING') {
      engine.resume();
      setNotice('继续自动导航');
    }
    sync();
  };

  const estop = () => {
    actor.send({ type: 'ESTOP' });
    engine.hold();
    sync();
    setNotice('软件急停已触发 · 运动指令阻断');
  };

  const resetEstop = () => {
    actor.send({ type: 'RESET_ESTOP' });
    sync();
    setNotice('软件急停已复位 · 保持暂停，确认现场后再继续');
  };

  const abort = () => {
    actor.send({ type: 'ABORT', reason: '静态演示中止' });
    engine.abort();
    sync();
    setNotice('中止并回撤 · 正在沿原路径撤回入口');
  };

  useEffect(() => {
    if (phase !== 'AUTO_RUNNING' && phase !== 'ABORTING') return;
    const id = window.setInterval(() => {
      engine.step(0.25);
      const effects = engine.effects.splice(0);
      let done = false;
      for (const effect of effects) {
        if (effect.type === 'arrived' && phase === 'AUTO_RUNNING') {
          actor.send({ type: 'TARGET_REACHED' });
          done = true;
        }
        if (effect.type === 'abort_done' && phase === 'ABORTING') {
          actor.send({ type: 'ABORT_DONE' });
          done = true;
        }
        if (effect.type === 'alarm') setNotice(effect.detail);
      }
      if (done) {
        engine.hold();
        sync();
      }
      setFrame(engine.frame(Date.now()));
    }, 40);
    return () => window.clearInterval(id);
  }, [actor, engine, phase, sync]);

  const playback = useMemo<PlaybackFrame>(
    () => ({
      progress: frame.progress,
      tip: frame.tip.t,
      q: frame.tip.q,
      moment: frame.moment,
      shape: frame.shape,
    }),
    [frame],
  );

  const precheckPassed = Boolean(precheck?.passed);
  const active = ACTIVE.includes(phase);
  const ended = phase === 'COMPLETED' || phase === 'ABORTED';
  const canStart = phase === 'ARMED' && precheckPassed && !estopLatched;
  const canResume = phase === 'AUTO_PAUSED' && !estopLatched;

  return (
    <div className="static-demo">
      <header className="static-demo__top">
        <Link to="/" className="static-demo__back">
          ← 首页
        </Link>
        <div className="static-demo__brand">
          <span className="static-demo__mark">M</span>
          <div>
            <strong>MAGNAV</strong>
            <span>STATIC DEMO · BROWSER ONLY</span>
          </div>
        </div>
        <span className="static-demo__status">
          <i /> 共享状态机 + 运动学模拟器
        </span>
        <a
          className="static-demo__github"
          href="https://github.com/terry-chao/magnav-web"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </header>

      <div className="static-demo__grid">
        <aside className="static-demo__side">
          <Panel title="病例" subtitle={data.record.code} dense>
            <div className="static-demo__case">
              <strong>{data.record.patient.nameMasked}</strong>
              <span>
                {data.record.patient.sex === 'M' ? '男' : '女'} · {data.record.patient.age} 岁 ·{' '}
                {data.record.patient.diagnosis}
              </span>
              <span className="mono">TRE {data.registration.treMm.toFixed(1)} mm</span>
            </div>
          </Panel>

          <Panel
            title="飞行前预检"
            dense
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={runPrecheck}
                disabled={!['REGISTERED', 'MANUAL'].includes(phase)}
              >
                {precheck ? '重新预检' : '运行预检'}
              </Button>
            }
          >
            {precheck ? (
              <div className="static-demo__precheck">
                {precheck.items.map((item) => (
                  <div key={item.id} className={item.passed ? 'is-pass' : 'is-fail'}>
                    <span>{item.passed ? '✓' : '×'}</span>
                    <span>{item.label}</span>
                    <span className="mono">{item.value}</span>
                  </div>
                ))}
                <div className={`static-demo__precheck-summary ${precheck.passed ? 'is-pass' : 'is-fail'}`}>
                  {precheck.passed ? '全部通过' : '存在未通过项'}
                </div>
              </div>
            ) : (
              <p className="static-demo__empty">运行 9 项预检，检查影像、配准、计划、磁可行性、线圈、急停与通信。</p>
            )}
          </Panel>

          <Panel title="演示提示" dense>
            <p className="static-demo__notice">{notice}</p>
            <div className="static-demo__next">
              <span>NEXT</span>
              <strong>{nextHint(phase, precheckPassed)}</strong>
            </div>
          </Panel>
        </aside>

        <section className="static-demo__stage">
          <SceneCanvas
            tree={data.tree}
            plan={data.plan}
            mode="procedure"
            viewPreset="ISO"
            playback={playback}
            frozen={phase !== 'AUTO_RUNNING' && phase !== 'ABORTING'}
            layers={{ vessels: true, path: true, coils: true, field: true, phantom: true }}
          />
          <div className="static-demo__overlay">
            <PhaseChip phase={phase} />
            <span className="static-demo__badge">STATIC</span>
            <span className="static-demo__speed">5× SIM</span>
          </div>
          <div className="static-demo__progress">
            <span style={{ width: `${(frame.progress * 100).toFixed(2)}%` }} />
          </div>
          <div className="static-demo__legend">
            <span>
              <i className="is-vessel" /> 血管
            </span>
            <span>
              <i className="is-path" /> 计划路径
            </span>
            <span>
              <i className="is-catheter" /> 导管
            </span>
            <span>
              <i className="is-target" /> 目标
            </span>
          </div>
        </section>

        <aside className="static-demo__side">
          <Panel title="实时遥测" dense>
            <div className="static-demo__metrics">
              <Metric label="场强 |B|" value={V.len(frame.field.b).toFixed(1)} unit="mT" size="sm" />
              <Metric label="梯度 |∇B|" value={frame.field.grad.toFixed(2)} unit="T/m" size="sm" />
              <Metric label="侧向力" value={frame.force.lateral.toFixed(2)} unit="N" size="sm" />
              <Metric label="进度" value={(frame.progress * 100).toFixed(1)} unit="%" size="sm" />
              <Metric label="速度" value={frame.speedMmS.toFixed(1)} unit="mm/s" size="sm" />
              <Metric label="分段" value={frame.segmentIndex + 1} unit="/ 3" size="sm" />
            </div>
            <div className="static-demo__path">
              <div>
                <span>计划</span>
                <strong>{data.plan.name}</strong>
              </div>
              <div>
                <span>路径</span>
                <strong className="mono">{data.plan.totalLengthMm.toFixed(0)} mm</strong>
              </div>
              <div>
                <span>预计</span>
                <strong className="mono">{data.plan.etaSeconds.toFixed(0)} s</strong>
              </div>
            </div>
          </Panel>

          <Panel title="安全状态" dense>
            <div className="static-demo__gates">
              <span className={precheckPassed ? 'is-pass' : 'is-fail'}>预检 {precheckPassed ? '通过' : '未通过'}</span>
              <span className={phase === 'ARMED' || active ? 'is-pass' : 'is-fail'}>武装 {phase === 'ARMED' || active ? '完成' : '未完成'}</span>
              <span className={!estopLatched ? 'is-pass' : 'is-fail'}>急停 {estopLatched ? '锁定' : '未锁定'}</span>
              <span className="is-pass">审计 本地模拟</span>
            </div>
          </Panel>

          <Panel title="为什么是静态版" dense>
            <p className="static-demo__empty">
              GitHub Pages 只能托管静态文件。这个页面在浏览器里运行共享状态机与模拟器；
              登录、SQLite 持久化、WebSocket 与多人同步需要 Node 服务端。
            </p>
          </Panel>
        </aside>
      </div>

      <footer className="static-demo__command">
        <div className="static-demo__hint">
          <span className="eyebrow">NEXT ACTION</span>
          <strong>{nextHint(phase, precheckPassed)}</strong>
          <span className="static-demo__sub">静态演示 · 所有操作只改变本页内存状态</span>
        </div>

        <div className="static-demo__actions">
          {phase === 'REGISTERED' || phase === 'MANUAL' ? (
            <>
              <Button variant="default" size="lg" onClick={runPrecheck}>
                运行预检
              </Button>
              <Button
                variant="warn"
                size="lg"
                disabled={!precheckPassed || phase !== 'REGISTERED'}
                onClick={arm}
              >
                双人确认武装
              </Button>
            </>
          ) : null}

          {canStart ? (
            <HoldButton variant="primary" holdMs={800} onConfirm={start}>
              按住 0.8 s 启动
            </HoldButton>
          ) : null}

          {phase === 'AUTO_RUNNING' ? (
            <>
              <Button variant="warn" size="lg" onClick={pause}>
                暂停
              </Button>
              <HoldButton variant="danger" holdMs={700} onConfirm={estop}>
                按住 0.7 s 急停
              </HoldButton>
            </>
          ) : null}

          {phase === 'AUTO_PAUSED' ? (
            <>
              <Button variant="primary" size="lg" disabled={!canResume} onClick={resume}>
                {estopLatched ? '先复位急停' : '继续'}
              </Button>
              <Button variant="default" size="lg" disabled={!estopLatched} onClick={resetEstop}>
                复位急停
              </Button>
            </>
          ) : null}

          {active || phase === 'ABORTING' ? (
            <HoldButton variant="danger" holdMs={800} onConfirm={abort} disabled={phase === 'ABORTING'}>
              按住 0.8 s 中止
            </HoldButton>
          ) : null}

          {ended ? (
            <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
              重新开始
            </Button>
          ) : null}
        </div>
      </footer>

      <p className="static-demo__disclaimer">
        研究用原型，非医疗器械。所有患者、影像、磁场、机器人与告警均为确定性模拟数据，不得用于临床诊断或治疗。
        GitHub Pages 静态版不连接真实设备，也不提供登录与持久化。
      </p>
    </div>
  );
}
