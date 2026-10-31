import {
  ArrowRight,
  Check,
  CircleDot,
  FileCheck2,
  Hand,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { ProcedurePhase } from '@magnav/protocol';
import { Button } from './ui/Button';
import './demo-coach.css';

interface DemoCoachProps {
  phase: ProcedurePhase;
  precheckPassed: boolean;
  estopLatched: boolean;
  onRunPrecheck: () => void;
  onArm: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onReview: () => void;
  onExit: () => void;
}

const STEPS = ['运行预检', '双人武装', '长按启动', '观察 / 暂停'];

export function DemoCoach({
  phase,
  precheckPassed,
  estopLatched,
  onRunPrecheck,
  onArm,
  onStart,
  onPause,
  onResume,
  onReview,
  onExit,
}: DemoCoachProps) {
  const ended = phase === 'COMPLETED' || phase === 'ABORTED';
  const aborting = phase === 'ABORTING';
  const step = ended
    ? 4
    : aborting
      ? 3
      : phase === 'AUTO_RUNNING'
        ? 3
        : phase === 'AUTO_PAUSED'
          ? 3
          : phase === 'ARMED'
            ? 2
            : phase === 'MANUAL'
              ? 0
              : precheckPassed
                ? 1
                : 0;

  return (
    <aside className="demo-coach" aria-label="交互演示导览">
      <div className="demo-coach__intro">
        <span className="demo-coach__badge">
          <Sparkles size={11} /> DEMO
        </span>
        <div>
          <strong>{ended ? '演练完成' : '2 分钟安全流程'}</strong>
          <span>C-2026-1031 · LAD</span>
        </div>
      </div>

      <ol className="demo-coach__steps">
        {STEPS.map((title, index) => {
          const done = index < step || (ended && index === 3);
          const current = index === step && !ended;
          return (
            <li key={title} className={done ? 'is-done' : current ? 'is-current' : ''}>
              <span className="demo-coach__mark">{done ? <Check size={10} /> : current ? <CircleDot size={10} /> : index + 1}</span>
              <span>{title}</span>
            </li>
          );
        })}
      </ol>

      <div className="demo-coach__action">
        {step === 0 ? (
          <Button variant="primary" size="sm" icon={<FileCheck2 size={13} />} onClick={onRunPrecheck}>
            运行预检
          </Button>
        ) : null}
        {step === 1 ? (
          <Button variant="warn" size="sm" icon={<ShieldCheck size={13} />} onClick={onArm}>
            双人确认武装
          </Button>
        ) : null}
        {step === 2 ? (
          <Button variant="primary" size="sm" icon={<Play size={13} />} onClick={onStart}>
            启动自动导航
          </Button>
        ) : null}
        {step === 3 && !ended ? (
          aborting ? (
            <span className="demo-coach__hint">正在回撤，请保持观察</span>
          ) : phase === 'AUTO_RUNNING' ? (
            <>
              <Button variant="warn" size="sm" icon={<Hand size={13} />} onClick={onPause}>
                试试暂停
              </Button>
              <span className="demo-coach__hint">急停：按住右下角 0.7 s</span>
            </>
          ) : (
            <>
              <Button variant="primary" size="sm" icon={<RotateCcw size={13} />} onClick={onResume} disabled={estopLatched}>
                {estopLatched ? '请先复位急停' : '继续导航'}
              </Button>
              <span className="demo-coach__hint">
                {estopLatched ? '先在左侧横幅复位急停' : '也可在下方命令栏中止并回撤'}
              </span>
            </>
          )
        ) : null}
        {ended ? (
          <Button variant="primary" size="sm" icon={<ArrowRight size={13} />} onClick={onReview}>
            查看复盘
          </Button>
        ) : null}
      </div>

      <button type="button" className="demo-coach__close" onClick={onExit} aria-label="退出演示">
        <X size={14} />
      </button>
    </aside>
  );
}
