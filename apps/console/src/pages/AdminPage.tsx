import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  Cable,
  CheckCircle2,
  Cpu,
  Download,
  Gauge,
  History,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Siren,
  ThermometerSnowflake,
  Users,
  Zap,
} from 'lucide-react';
import {
  APP_NAME,
  DISCLAIMER,
  ROLE_CAPS,
  ROLE_CAPABILITY_LABELS,
  ROLE_META,
  can,
  type Role,
} from '@magnav/protocol';
import { http } from '../services/http';
import { useSessionStore } from '../store/session';
import { fmtClock, fmtDateTime, fmtInt, fmtPct, shortHash } from '../lib/format';
import { Button } from '../components/ui/Button';
import { EmptyState, Metric, Panel, StatusPill } from '../components/ui/Primitives';

type Tab = 'devices' | 'audit' | 'roles' | 'faults' | 'system';

const TABS: Array<{ id: Tab; label: string; icon: typeof Cpu }> = [
  { id: 'devices', label: '设备与线圈', icon: Cpu },
  { id: 'audit', label: '审计哈希链', icon: History },
  { id: 'roles', label: '角色与权限', icon: Users },
  { id: 'faults', label: '故障注入', icon: Siren },
  { id: 'system', label: '系统信息', icon: Boxes },
];

const ROLE_ORDER: Role[] = ['surgeon', 'assistant', 'tech', 'engineer', 'reviewer'];

export function AdminPage() {
  const user = useSessionStore((s) => s.user);
  const snapshot = useSessionStore((s) => s.snapshot);
  const pushToast = useSessionStore((s) => s.pushToast);
  const [tab, setTab] = useState<Tab>('devices');

  const canView = user ? can(user.role, 'admin:view') : false;
  const canInject = user?.role === 'engineer' || user?.role === 'surgeon';

  const devicesQuery = useQuery({
    queryKey: ['devices', snapshot?.sessionId],
    queryFn: () => http.devices(snapshot?.sessionId),
    refetchInterval: 2000,
    enabled: canView,
  });
  const auditQuery = useQuery({
    queryKey: ['audit'],
    queryFn: () => http.audit(100),
    enabled: canView,
    refetchInterval: 5000,
  });
  const devices = snapshot?.devices ?? devicesQuery.data ?? null;

  const selfTest = useMutation({
    mutationFn: () => http.selfTest(),
    onSuccess: () => {
      void devicesQuery.refetch();
      pushToast({ tone: 'success', title: '线圈阵列自检通过', message: '12/12 通道在线，温升正常' });
    },
    onError: () => pushToast({ tone: 'danger', title: '自检失败' }),
  });

  const fault = useMutation({
    mutationFn: (type: 'tre' | 'force' | 'saturation' | 'gradient' | 'link' | 'clear') =>
      http.injectFault(snapshot!.sessionId, type),
    onSuccess: (result) => {
      const store = useSessionStore.getState();
      store.setSnapshot(result);
      pushToast({ tone: 'warn', title: '故障注入已执行', message: '请返回术中控制台观察安全响应' });
    },
    onError: (error) => {
      pushToast({ tone: 'danger', title: '故障注入失败', message: error instanceof Error ? error.message : '需要进行中的会话' });
    },
  });

  const audit = auditQuery.data;
  const verify = audit?.verify;
  const activeAlarms = (snapshot?.alarms ?? []).filter((a) => !a.clearedAt && !a.acknowledged);

  const systemMetrics = useMemo(
    () => [
      { label: '遥测帧率', value: '120', unit: 'Hz' },
      { label: '解码', value: 'Worker', unit: '' },
      { label: '渲染延迟缓冲', value: '40', unit: 'ms' },
      { label: '位姿冻结阈值', value: '200', unit: 'ms' },
    ],
    [],
  );

  if (!canView) {
    return (
      <div className="page admin-page">
        <EmptyState
          icon={<ShieldCheck size={30} />}
          title="无设备与审计权限"
          description="该区域仅对临床工程师、质控审核与术者开放。"
          action={
            <Link to="/cases">
              <Button variant="primary">返回病例</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page admin-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">SYSTEM & COMPLIANCE</span>
          <h1>设备与审计</h1>
          <p>线圈标定、设备自检、哈希链审计与演示故障注入。所有操作写入审计。</p>
        </div>
        <div className="page-head__actions">
          <Button variant="ghost" icon={<RefreshCw size={15} />} onClick={() => void auditQuery.refetch()}>
            刷新
          </Button>
          <Button variant="primary" icon={<Download size={15} />} onClick={() => window.open('/api/v1/audit/export', '_blank')}>
            导出审计包
          </Button>
        </div>
      </header>

      <div className="admin-tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`admin-tabs__item ${tab === id ? 'is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {label}
            {id === 'faults' && activeAlarms.length > 0 ? <span className="badge badge--warn">{activeAlarms.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'devices' ? (
        <div className="admin-grid">
          <div className="admin-col">
            <div className="device-stat-row">
              <div className={`device-stat ${devices?.tracker.status === 'ok' ? 'is-ok' : 'is-warn'}`}>
                <span className="device-stat__icon"><Cable size={17} /></span>
                <div>
                  <span>电磁跟踪器</span>
                  <strong>{devices?.tracker.status.toUpperCase() ?? '—'}</strong>
                  <small>{devices?.tracker.rateHz ?? 0} Hz · {devices?.tracker.latencyMs ?? 0} ms · 质量 {fmtPct(devices?.tracker.quality ?? 0, 0)}</small>
                </div>
              </div>
              <div className="device-stat is-ok">
                <span className="device-stat__icon"><ThermometerSnowflake size={17} /></span>
                <div>
                  <span>冷却回路</span>
                  <strong>{devices?.fieldGenerator.cooling.toFixed(0) ?? '—'}%</strong>
                  <small>场发生器 {devices?.fieldGenerator.status ?? '—'} · 占空 {devices?.fieldGenerator.dutyPct.toFixed(0) ?? 0}%</small>
                </div>
              </div>
              <div className={`device-stat ${devices?.estop.circuitClosed ? 'is-ok' : 'is-danger'}`}>
                <span className="device-stat__icon"><ShieldCheck size={17} /></span>
                <div>
                  <span>急停回路</span>
                  <strong>{devices?.estop.circuitClosed ? '闭环' : '断开'}</strong>
                  <small>软件锁存 {devices?.estop.softwareLatched ? '是' : '否'} · 上次测试 {fmtClock(devices?.estop.lastTestAt)}</small>
                </div>
              </div>
              <div className="device-stat">
                <span className="device-stat__icon"><Gauge size={17} /></span>
                <div>
                  <span>控制台链路</span>
                  <strong>{devices?.network.latencyMs ?? '—'} ms</strong>
                  <small>抖动 {devices?.network.jitterMs ?? 0} ms · 心跳 {devices?.network.heartbeatAgeMs ?? 0} ms</small>
                </div>
              </div>
            </div>

            <Panel
              title="线圈阵列"
              subtitle="12 通道 · 温度 / 电流 / 负载"
              actions={
                <Button size="sm" variant="ghost" icon={<Cpu size={13} />} disabled={selfTest.isPending} onClick={() => selfTest.mutate()}>
                  {selfTest.isPending ? '自检中…' : '运行自检'}
                </Button>
              }
            >
              <div className="admin-coil-grid">
                {(devices?.coils ?? []).map((coil) => (
                  <div key={coil.id} className={`admin-coil ${coil.saturated ? 'is-danger' : coil.temperatureC > 56 ? 'is-warn' : ''}`}>
                    <div className="admin-coil__head">
                      <strong>{coil.label}</strong>
                      {coil.enabled ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    </div>
                    <div className="admin-coil__value mono">{coil.currentA.toFixed(1)}<small>A</small></div>
                    <div className="admin-coil__bar">
                      <span style={{ width: `${Math.min(100, coil.loadPct * 100)}%` }} />
                    </div>
                    <div className="admin-coil__foot">
                      <span>{Math.round(coil.loadPct * 100)}%</span>
                      <span className="mono">{coil.temperatureC.toFixed(1)}°C</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="footnote">线圈电流采用最小范数求解，支持双极性。温度与负载为模拟数据，不用于剂量学判断。</p>
            </Panel>
          </div>

          <div className="admin-col admin-col--narrow">
            <Panel title="实时链路" dense>
              <div className="kv">
                <div><dt>会话</dt><dd className="mono">{snapshot?.sessionId ?? '—'}</dd></div>
                <div><dt>阶段</dt><dd>{snapshot?.phase ?? '—'}</dd></div>
                <div><dt>告警</dt><dd>{activeAlarms.length} 活动</dd></div>
                <div><dt>遥测</dt><dd className="mono">120 Hz · {"1.3 KB/frame"}</dd></div>
              </div>
            </Panel>
            <Panel title="协议" dense>
              <div className="kv">
                <div><dt>帧头</dt><dd className="mono">magic|ver|type|seq|ts|len</dd></div>
                <div><dt>遥测</dt><dd className="mono">二进制 · Worker 解码</dd></div>
                <div><dt>事件</dt><dd className="mono">JSON · 必达</dd></div>
                <div><dt>命令</dt><dd className="mono">WS · 幂等 + ack</dd></div>
              </div>
            </Panel>
            <div className="disclaimer-card">
              <AlertTriangle size={14} />
              <p>{DISCLAIMER}</p>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'audit' ? (
        <div className="admin-grid admin-grid--wide">
          <Panel
            title="审计记录"
            subtitle="Append-only hash chain · SHA-256"
            actions={
              <div className="inline-actions">
                {verify ? (
                  <StatusPill tone={verify.valid ? 'success' : 'danger'}>
                    {verify.valid ? '链校验通过' : `断点 #${verify.brokenAt}`}
                  </StatusPill>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ShieldCheck size={13} />}
                  onClick={async () => {
                    const result = await http.verifyAudit();
                    pushToast({
                      tone: result.valid ? 'success' : 'danger',
                      title: result.valid ? '审计链有效' : '审计链被破坏',
                      message: `${result.count} 条记录${result.brokenAt ? ` · #${result.brokenAt}` : ''}`,
                    });
                  }}
                >
                  重新校验
                </Button>
              </div>
            }
          >
            <div className="table-wrap">
              <table className="table audit-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>时间</th>
                    <th>操作者</th>
                    <th>动作</th>
                    <th>详情</th>
                    <th>前序哈希</th>
                    <th>哈希</th>
                  </tr>
                </thead>
                <tbody>
                  {(audit?.entries ?? []).map((entry) => (
                    <tr key={entry.seq}>
                      <td className="mono">{entry.seq}</td>
                      <td className="mono">{fmtDateTime(entry.ts)}</td>
                      <td>{entry.actorName}<span className="muted small"> · {entry.role}</span></td>
                      <td><span className="audit-action">{entry.action}</span></td>
                      <td className="audit-detail">{entry.detail}</td>
                      <td className="mono muted">{shortHash(entry.prevHash)}</td>
                      <td className="mono">{shortHash(entry.hash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <div className="admin-col admin-col--narrow">
            <Panel title="完整性" dense>
              <div className="audit-verify">
                <ShieldCheck size={30} className={verify?.valid ? 'tone-ok' : 'tone-danger'} />
                <strong>{verify?.valid ? '哈希链完整' : '校验失败'}</strong>
                <p>{verify?.count ?? 0} 条记录，逐条验证前序哈希。导出包为只读 NDJSON。</p>
                <Button size="sm" variant="ghost" icon={<Download size={13} />} onClick={() => window.open('/api/v1/audit/export', '_blank')}>
                  导出
                </Button>
              </div>
            </Panel>
            <Panel title="记录范围" dense>
              <div className="kv">
                <div><dt>登录 / 登出</dt><dd>是</dd></div>
                <div><dt>计划签字</dt><dd>是</dd></div>
                <div><dt>武装 / 启动 / 中止</dt><dd>是</dd></div>
                <div><dt>急停 / 复位</dt><dd>是</dd></div>
                <div><dt>故障注入</dt><dd>是</dd></div>
              </div>
            </Panel>
          </div>
        </div>
      ) : null}

      {tab === 'roles' ? (
        <div className="roles-grid">
          {ROLE_ORDER.map((role) => (
            <Panel key={role} title={ROLE_META[role].label} subtitle={ROLE_META[role].description} dense>
              <div className="role-card">
                <div className={`role-card__icon role-card__icon--${ROLE_META[role].tone}`}>
                  <Users size={18} />
                </div>
                <div className="role-card__caps">
                  {ROLE_CAPS[role].map((cap) => (
                    <span key={cap} className="cap-chip">{ROLE_CAPABILITY_LABELS[cap]}</span>
                  ))}
                </div>
              </div>
            </Panel>
          ))}
          <Panel title="演示凭证" subtitle="本地研究原型" dense>
            <div className="kv">
              <div><dt>术者</dt><dd className="mono">M-1042 / 2468</dd></div>
              <div><dt>助手</dt><dd className="mono">M-1087 / 1357</dd></div>
              <div><dt>影像技师</dt><dd className="mono">T-2011 / 8642</dd></div>
              <div><dt>临床工程师</dt><dd className="mono">E-3007 / 1122</dd></div>
              <div><dt>质控审核</dt><dd className="mono">Q-4003 / 4455</dd></div>
            </div>
            <p className="footnote">口令仅用于本地演示；生产部署需接入医院身份与双因素。</p>
          </Panel>
        </div>
      ) : null}

      {tab === 'faults' ? (
        <div className="admin-grid">
          <Panel title="故障注入" subtitle="仅影响模拟会话 · 每次操作写入审计">
            {!snapshot ? (
              <EmptyState
                icon={<Siren size={26} />}
                title="无进行中的会话"
                description="请先进入一个病例的术中控制台，再回到此处注入故障。"
                action={<Link to="/cases"><Button variant="primary">选择病例</Button></Link>}
              />
            ) : (
              <div className="fault-grid">
                {[
                  { type: 'tre' as const, title: '配准残差超限', detail: '将 TRE 设为 2.4 mm，触发高危告警并自动暂停', icon: AlertTriangle, tone: 'danger' },
                  { type: 'force' as const, title: '侧向力超限', detail: '将侧向接触力抬升至 0.62 N，触发暂停', icon: Zap, tone: 'warn' },
                  { type: 'saturation' as const, title: '线圈饱和', detail: '强制 C7 及其对侧线圈达到限值，触发暂停', icon: Cpu, tone: 'danger' },
                  { type: 'gradient' as const, title: '梯度接近上限', detail: '注入梯度扰动，仅告警，不自动暂停', icon: Gauge, tone: 'warn' },
                  { type: 'link' as const, title: '控制台链路中断', detail: '模拟链路丢失，实时层暂停并保持位置', icon: Cable, tone: 'danger' },
                  { type: 'clear' as const, title: '清除注入', detail: '清除全部注入状态并确认相关告警', icon: RefreshCw, tone: 'ok' },
                ].map(({ type, title, detail, icon: Icon, tone }) => (
                  <button
                    key={type}
                    type="button"
                    className={`fault-card fault-card--${tone}`}
                    disabled={!canInject || fault.isPending}
                    onClick={() => fault.mutate(type)}
                  >
                    <Icon size={19} />
                    <strong>{title}</strong>
                    <p>{detail}</p>
                  </button>
                ))}
              </div>
            )}
            <div className="fault-note">
              <AlertTriangle size={15} />
              <p>
                {canInject
                  ? '故障注入只改变前端/模拟器状态，不涉及真实硬件。生产系统需在硬件在环台架执行故障注入测试，并覆盖拔网线、杀进程、断电与传感器丢帧。'
                  : '当前角色为只读：故障注入仅限临床工程师或术者。'}
              </p>
            </div>
          </Panel>
          <div className="admin-col admin-col--narrow">
            <Panel title="当前会话" dense>
              <div className="kv">
                <div><dt>会话</dt><dd className="mono">{snapshot?.sessionId ?? '—'}</dd></div>
                <div><dt>病例</dt><dd>{snapshot?.case.code ?? '—'}</dd></div>
                <div><dt>阶段</dt><dd>{snapshot?.phase ?? '—'}</dd></div>
                <div><dt>告警</dt><dd>{activeAlarms.length}</dd></div>
                <div><dt>急停</dt><dd>{snapshot?.context.estopLatched ? '锁定' : '正常'}</dd></div>
              </div>
            </Panel>
            <Panel title="活动告警" dense>
              {activeAlarms.length === 0 ? (
                <p className="muted small">无活动告警</p>
              ) : (
                <div className="fault-alarm-list">
                  {activeAlarms.map((alarm) => (
                    <div key={alarm.id} className="fault-alarm">
                      <span className={`pill pill--${alarm.severity === 'high' ? 'danger' : alarm.severity === 'medium' ? 'warn' : 'info'}`}>
                        {alarm.severity}
                      </span>
                      <span>{alarm.title}</span>
                      <span className="muted small">{fmtClock(alarm.ts)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      ) : null}

      {tab === 'system' ? (
        <div className="admin-grid">
          <Panel title="架构" subtitle="Web 全栈 · 无 Electron 桌面壳" dense>
            <div className="system-intro">
              <div className="system-intro__mark">
                <span>{APP_NAME}</span>
                <strong>v0.1</strong>
              </div>
              <p>
                控制台通过 HTTPS + WebSocket 连接实时服务。遥测帧以二进制传输并在 Worker 中解码，
                高频数据不进入 React 状态；3D 场景在 <code>useFrame</code> 中直接读取环形缓冲。
                服务端运行权威状态机、安全门禁、模拟器与哈希链审计。
              </p>
            </div>
            <div className="metric-row">
              {systemMetrics.map((metric) => (
                <Metric key={metric.label} label={metric.label} value={metric.value} unit={metric.unit} size="sm" />
              ))}
            </div>
            <div className="system-diagram">
              <div><strong>Console</strong><span>React 18 · R3F · Zustand · xstate</span></div>
              <i>⇄</i>
              <div><strong>Realtime</strong><span>Fastify · ws · 权威 FSM · 模拟器</span></div>
              <i>⇄</i>
              <div><strong>Audit</strong><span>SHA-256 哈希链 · JSONL</span></div>
            </div>
          </Panel>
          <div className="admin-col admin-col--narrow">
            <Panel title="版本与运行" dense>
              <div className="kv">
                <div><dt>前端</dt><dd className="mono">@magnav/console 0.1.0</dd></div>
                <div><dt>协议</dt><dd className="mono">v1 · 120 Hz</dd></div>
                <div><dt>状态机</dt><dd className="mono">xstate v5（服务端权威）</dd></div>
                <div><dt>审计</dt><dd className="mono">{verify?.count ?? 0} 条 · {verify?.valid ? '有效' : '异常'}</dd></div>
                <div><dt>部署</dt><dd>本地 / 院区内网</dd></div>
              </div>
            </Panel>
            <Panel title="安全边界" dense>
              <ul className="safety-list">
                <li>前端不参与 1 kHz 闭环，不发送原始线圈电流。</li>
                <li>所有运动指令为高层意图，服务端按阶段与角色裁决。</li>
                <li>链路丢失 5 s 自动暂停；位姿 200 ms 冻结显示。</li>
                <li>审计日志只追加，导出为只读 NDJSON。</li>
              </ul>
            </Panel>
            <div className="disclaimer-card">
              <AlertTriangle size={14} />
              <p>{DISCLAIMER}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
