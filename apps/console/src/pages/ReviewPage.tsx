import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  BarChart3,
  ClipboardCopy,
  Download,
  FileCheck2,
  History,
  Pause,
  Play,
  Printer,
  RotateCcw,
  ShieldCheck,
  SkipBack,
} from 'lucide-react';
import { DISCLAIMER, Q, shapeUpToS, type ReviewFrame } from '@magnav/protocol';
import { http } from '../services/http';
import { useSessionStore } from '../store/session';
import { fmtClock, fmtDateTime, fmtDuration, fmtInt, fmtPct } from '../lib/format';
import { Button } from '../components/ui/Button';
import { EmptyState, Metric, Panel, StatusPill } from '../components/ui/Primitives';
import { Sparkline } from '../components/ui/Sparkline';
import { SceneCanvas } from '../scene/SceneCanvas';
import type { SceneLayers } from '../scene/SceneContent';
import type { PlaybackFrame } from '../scene/objects/Catheter';
import { DsaPanel } from '../components/procedure/DsaPanel';

const SPEEDS = [0.5, 1, 2, 4] as const;

function frameAt(frames: ReviewFrame[], t: number): ReviewFrame | null {
  if (frames.length === 0) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (frames[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  return frames[lo] ?? frames[frames.length - 1]!;
}

export function ReviewPage() {
  const { caseId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const pushToast = useSessionStore((s) => s.pushToast);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [time, setTime] = useState(0);
  const [layers, setLayers] = useState<SceneLayers>({
    vessels: true,
    path: true,
    coils: true,
    field: true,
    phantom: false,
  });

  const sessionsQuery = useQuery({
    queryKey: ['case-sessions', caseId],
    queryFn: () => http.sessionsForCase(caseId),
    enabled: Boolean(caseId),
  });

  const sessions = sessionsQuery.data?.sessions ?? [];
  const querySessionId = searchParams.get('session');
  const chosenSessionId = querySessionId ?? sessions[0]?.id ?? null;

  const reviewQuery = useQuery({
    queryKey: ['review', chosenSessionId],
    queryFn: () => http.review(chosenSessionId!),
    enabled: Boolean(chosenSessionId),
  });
  const treeQuery = useQuery({
    queryKey: ['tree', caseId],
    queryFn: () => http.vessels(caseId),
    enabled: Boolean(caseId),
  });

  const report = reviewQuery.data;
  const tree = treeQuery.data ?? (report ? fallbackTree(report) : null);
  const duration = report?.frames.length ? report.frames[report.frames.length - 1]!.t : 0;

  useEffect(() => {
    setTime(0);
    setPlaying(false);
  }, [chosenSessionId]);

  useEffect(() => {
    if (!playing || !report) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = ((now - last) / 1000) * speed;
      last = now;
      setTime((current) => {
        const next = current + dt;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [playing, speed, duration, report]);

  const currentFrame = useMemo(
    () => (report ? frameAt(report.frames, time) : null),
    [report, time],
  );

  const playback: PlaybackFrame | null = useMemo(() => {
    if (!report || !currentFrame) return null;
    const progress = currentFrame.progress;
    const tipS = progress * report.plan.totalLengthMm;
    const shape = shapeUpToS(report.plan.path, tipS, 150, 96);
    const moment = Q.rotate(currentFrame.q, [0, 0, 1]) as [number, number, number];
    return {
      progress,
      tip: currentFrame.tip,
      q: currentFrame.q,
      moment,
      shape,
    };
  }, [report, currentFrame]);

  const series = useMemo(() => {
    if (!report) {
      return { grad: [], lateral: [], progress: [], b: [] };
    }
    return {
      grad: report.frames.map((f) => f.grad),
      lateral: report.frames.map((f) => f.lateral),
      progress: report.frames.map((f) => f.progress),
      b: report.frames.map((f) => f.b),
    };
  }, [report]);

  const exportReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${report.case.code}-${report.sessionId}-review.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    pushToast({ tone: 'success', title: '复盘报告已导出', message: 'JSON 包含全量帧、事件与审计摘要' });
  };

  const copySummary = async () => {
    if (!report) return;
    const summary = [
      `${report.case.code} · ${report.case.patient.nameMasked}`,
      `计划：${report.plan.name}`,
      `结果：${report.stats.outcome} · 用时 ${fmtDuration(report.stats.durationS)}`,
      `最大梯度 ${report.stats.maxGradient} T/m · 最大侧向力 ${report.stats.maxLateralForceN} N`,
      `最大轨迹偏差 ${report.stats.maxProgressDeviationMm} mm · 告警 ${report.stats.alarmCount}`,
    ].join('\n');
    await navigator.clipboard.writeText(summary);
    pushToast({ tone: 'success', title: '摘要已复制' });
  };

  if (sessionsQuery.isLoading) {
    return <div className="page review-page"><div className="loading-card"><span className="spinner" /><h2>加载复盘数据</h2></div></div>;
  }

  if (!chosenSessionId || !report) {
    return (
      <div className="page review-page">
        <EmptyState
          icon={<History size={30} />}
          title="暂无可复盘的会话"
          description="完成或中止一次手术会话后，全量遥测、事件与审计记录会出现在这里。"
          action={
            <Link to={`/case/${caseId}/procedure`}>
              <Button variant="primary">进入术中</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const startedAt = report.startedAt;
  const timelineEvents = report.events
    .filter((event) =>
      ['phase', 'segment', 'alarm', 'notice', 'ended', 'precheck'].includes(event.kind),
    )
    .slice()
    .reverse();

  return (
    <div className="page review-page">
      <header className="page-head page-head--compact">
        <div className="page-head__left">
          <Link to="/cases" className="back-link">
            <ArrowLeft size={14} /> 病例
          </Link>
          <div>
            <div className="page-head__meta">
              <span className="mono">{report.case.code}</span>
              <StatusPill tone={report.stats.outcome === 'COMPLETED' ? 'success' : report.stats.outcome === 'ABORTED' ? 'danger' : 'warn'}>
                {report.stats.outcome === 'COMPLETED' ? '已完成' : report.stats.outcome === 'ABORTED' ? '已中止' : '进行中'}
              </StatusPill>
              <span className="muted">{fmtDateTime(report.startedAt)}</span>
            </div>
            <h1>
              {report.case.patient.nameMasked}
              <span className="page-head__sub">{report.case.patient.diagnosis}</span>
            </h1>
          </div>
        </div>
        <div className="page-head__actions">
          {sessions.length > 1 ? (
            <select
              className="select"
              value={chosenSessionId}
              onChange={(event) => setSearchParams({ session: event.target.value })}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.id.slice(0, 18)} · {session.outcome}
                </option>
              ))}
            </select>
          ) : null}
          <Button variant="ghost" icon={<ClipboardCopy size={15} />} onClick={() => void copySummary()}>
            复制摘要
          </Button>
          <Button variant="ghost" icon={<Printer size={15} />} onClick={() => window.print()}>
            打印
          </Button>
          <Button variant="primary" icon={<Download size={15} />} onClick={exportReport}>
            导出 JSON
          </Button>
        </div>
      </header>

      <div className="review-kpis">
        <Metric label="总用时" value={fmtDuration(report.stats.durationS)} tone="accent" />
        <Metric label="路径长度" value={fmtInt(report.stats.pathLengthMm)} unit="mm" />
        <Metric label="最大梯度" value={report.stats.maxGradient.toFixed(2)} unit="T/m" />
        <Metric label="最大侧向力" value={report.stats.maxLateralForceN.toFixed(3)} unit="N" />
        <Metric label="轨迹偏差" value={report.stats.maxProgressDeviationMm.toFixed(2)} unit="mm" />
        <Metric label="暂停 / 告警" value={`${report.stats.pauseCount} / ${report.stats.alarmCount}`} />
      </div>

      <div className="review-grid">
        <main className="review-main">
          <div className="viewport viewport--review">
            <SceneCanvas
              tree={tree ?? fallbackTree(report)}
              plan={report.plan}
              mode="review"
              viewPreset="ISO"
              layers={layers}
              playback={playback}
              frozen
            />
            <div className="review-overlay">
              <span className="chip">REPLAY</span>
              <span className="chip chip--muted">{fmtDuration(time)} / {fmtDuration(duration)}</span>
              <span className="chip">{report.stats.outcome}</span>
            </div>
            <div className="review-dsa">
              <DsaPanel
                tree={tree ?? fallbackTree(report)}
                plan={report.plan}
                playback={playback}
                stale={false}
                replay
              />
            </div>
          </div>

          <div className="playback">
            <div className="playback__control">
              <button
                type="button"
                className="playback__play"
                onClick={() => {
                  if (time >= duration) setTime(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button type="button" className="playback__skip" onClick={() => setTime(0)} title="回到开始">
                <SkipBack size={15} />
              </button>
              <div className="playback__time mono">
                {fmtDuration(time)} <span className="muted">/ {fmtDuration(duration)}</span>
              </div>
              <div className="playback__speeds">
                {SPEEDS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={speed === value ? 'is-active' : ''}
                    onClick={() => setSpeed(value)}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            </div>
            <input
              className="timeline-range"
              type="range"
              min={0}
              max={Math.max(0.1, duration)}
              step={0.05}
              value={time}
              onChange={(event) => {
                setPlaying(false);
                setTime(Number(event.target.value));
              }}
            />
            <div className="playback__events">
              {report.events
                .filter((event) => ['phase', 'segment', 'alarm'].includes(event.kind))
                .map((event, index) => {
                  const ts = 'ts' in event ? event.ts : startedAt;
                  const ratio = duration > 0 ? Math.min(1, Math.max(0, (ts - startedAt) / 1000 / duration)) : 0;
                  return (
                    <button
                      key={index}
                      type="button"
                      className={`playback__event playback__event--${event.kind}`}
                      style={{ left: `${ratio * 100}%` }}
                      title={`${fmtClock(ts)} · ${event.kind}`}
                      onClick={() => {
                        setPlaying(false);
                        setTime((ts - startedAt) / 1000);
                      }}
                    />
                  );
                })}
            </div>
          </div>

          <Panel title="遥测曲线" subtitle="10 Hz 记录 · 拖动时间轴联动" dense>
            <div className="review-charts">
              <div className="chart-row">
                <div className="chart-row__head">
                  <span>梯度 ∇B</span>
                  <span className="mono">{(currentFrame?.grad ?? 0).toFixed(2)} T/m</span>
                </div>
                <Sparkline values={series.grad} height={48} color="#4de2d0" min={0} max={1.2} marker={duration ? time / duration : 0} />
              </div>
              <div className="chart-row">
                <div className="chart-row__head">
                  <span>侧向接触力</span>
                  <span className="mono">{(currentFrame?.lateral ?? 0).toFixed(3)} N</span>
                </div>
                <Sparkline values={series.lateral} height={48} color="#ffb454" min={0} max={0.6} marker={duration ? time / duration : 0} />
              </div>
              <div className="chart-row">
                <div className="chart-row__head">
                  <span>路径进度</span>
                  <span className="mono">{fmtPct(currentFrame?.progress ?? 0, 1)}</span>
                </div>
                <Sparkline values={series.progress} height={48} color="#58a6ff" min={0} max={1} marker={duration ? time / duration : 0} />
              </div>
            </div>
          </Panel>
        </main>

        <aside className="review-side">
          <Panel title="会话摘要" dense>
            <div className="summary-grid summary-grid--2">
              <Metric label="计划" value={report.plan.name} size="sm" />
              <Metric label="分段" value={report.plan.segments.length} unit="段" size="sm" />
              <Metric label="平均速度" value={report.stats.meanSpeedMmS.toFixed(2)} unit="mm/s" size="sm" />
              <Metric label="完成分段" value={report.stats.segmentsCompleted} unit="段" size="sm" />
              <Metric label="高危告警" value={report.stats.highAlarmCount} size="sm" tone={report.stats.highAlarmCount > 0 ? 'warn' : 'default'} />
              <Metric label="当前帧" value={fmtClock(currentFrame?.ts ?? startedAt)} size="sm" />
            </div>
          </Panel>

          <Panel title="事件时间轴" dense scroll>
            <div className="event-feed event-feed--review">
              {timelineEvents.length === 0 ? <div className="event-feed__empty">无事件记录</div> : null}
              {timelineEvents.map((event, index) => {
                const ts = 'ts' in event ? event.ts : startedAt;
                const relative = Math.max(0, (ts - startedAt) / 1000);
                const text =
                  event.kind === 'phase'
                    ? `阶段 ${event.phase} · ${event.reason}`
                    : event.kind === 'segment'
                      ? `第 ${event.index + 1}/${event.count} 段 · ${event.name}`
                      : event.kind === 'alarm'
                        ? `告警 · ${event.alarm.title}`
                        : event.kind === 'precheck'
                          ? `预检${event.report.passed ? '通过' : '未通过'}`
                          : event.kind === 'notice'
                            ? event.message
                            : event.kind === 'ended'
                              ? `会话结束 · ${event.outcome}`
                              : '会话事件';
                return (
                  <button
                    key={index}
                    type="button"
                    className={`event-row event-row--${event.kind === 'alarm' ? 'high' : 'phase'}`}
                    onClick={() => {
                      setPlaying(false);
                      setTime(relative);
                    }}
                  >
                    <span className="event-row__time mono">{fmtDuration(relative)}</span>
                    <span className="event-row__dot" />
                    <span className="event-row__text">{text}</span>
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel
            title="审计与合规"
            dense
            actions={<StatusPill tone="success"><ShieldCheck size={11} /> 哈希链</StatusPill>}
          >
            <div className="audit-summary">
              <div>
                <FileCheck2 size={18} />
                <div>
                  <strong>{report.audit.length} 条审计记录</strong>
                  <p>每一条记录包含前序哈希，任何回溯修改都会破坏链。</p>
                </div>
              </div>
              <div className="audit-hashes">
                {report.audit.slice(-4).reverse().map((entry) => (
                  <div key={entry.seq} className="audit-hash">
                    <span className="mono">#{entry.seq}</span>
                    <span>{entry.action}</span>
                    <span className="mono muted">{entry.hash.slice(0, 10)}…</span>
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<BarChart3 size={13} />}
                onClick={async () => {
                  const result = await http.verifyAudit();
                  pushToast({
                    tone: result.valid ? 'success' : 'danger',
                    title: result.valid ? '审计链校验通过' : '审计链校验失败',
                    message: `${result.count} 条记录${result.brokenAt ? ` · 断点 #${result.brokenAt}` : ''}`,
                  });
                }}
              >
                校验审计链
              </Button>
            </div>
            <p className="disclaimer-inline">{DISCLAIMER}</p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function fallbackTree(report: import('@magnav/protocol').ReviewReport): import('@magnav/protocol').VesselTree {
  return {
    caseId: report.case.id,
    branches: [
      {
        id: 'plan-path',
        name: 'PATH',
        fullName: '规划路径',
        parentId: null,
        points: report.plan.path,
        radii: report.plan.radii,
        tone: 0.4,
      },
    ],
    bounds: {
      min: [
        Math.min(...report.plan.path.map((p) => p[0])),
        Math.min(...report.plan.path.map((p) => p[1])),
        Math.min(...report.plan.path.map((p) => p[2])),
      ],
      max: [
        Math.max(...report.plan.path.map((p) => p[0])),
        Math.max(...report.plan.path.map((p) => p[1])),
        Math.max(...report.plan.path.map((p) => p[2])),
      ],
    },
    stats: {
      branchCount: 1,
      totalLengthMm: Math.round(report.plan.totalLengthMm),
      minRadiusMm: Math.min(...report.plan.radii),
    },
  };
}
