import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarClock,
  CircleDot,
  ClipboardPlus,
  FileSearch,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  Waypoints,
} from 'lucide-react';
import { can, type CaseRecord, type CaseStatus } from '@magnav/protocol';
import { http, ApiError } from '../services/http';
import { useSessionStore } from '../store/session';
import { fmtDateTime, fmtInt } from '../lib/format';
import { Button } from '../components/ui/Button';
import { EmptyState, Metric, Panel, StatusPill } from '../components/ui/Primitives';
import { Modal } from '../components/ui/Modal';

const STATUS_META: Record<CaseStatus, { label: string; tone: string }> = {
  planning: { label: '规划中', tone: 'info' },
  plan_ready: { label: '计划就绪', tone: 'planning' },
  in_progress: { label: '术中', tone: 'running' },
  completed: { label: '已完成', tone: 'success' },
  archived: { label: '已归档', tone: 'neutral' },
};

const FILTERS: Array<{ key: 'all' | CaseStatus; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'planning', label: '规划中' },
  { key: 'plan_ready', label: '计划就绪' },
  { key: 'in_progress', label: '术中' },
  { key: 'completed', label: '已完成' },
];

export function CasesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useSessionStore((s) => s.user);
  const pushToast = useSessionStore((s) => s.pushToast);
  const [filter, setFilter] = useState<'all' | CaseStatus>('all');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    nameMasked: '',
    sex: 'M' as 'M' | 'F',
    age: 62,
    diagnosis: '',
    procedure: '',
  });

  const casesQuery = useQuery({
    queryKey: ['cases'],
    queryFn: async () => (await http.listCases()).cases,
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: () => http.createCase({ ...form, age: Number(form.age) }),
    onSuccess: (detail) => {
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
      navigate(`/case/${detail.case.id}/plan`);
    },
    onError: (error) => {
      pushToast({
        tone: 'danger',
        title: '新建病例失败',
        message: error instanceof ApiError ? error.message : '请稍后重试',
      });
    },
  });

  const cases = casesQuery.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases.filter((record) => {
      if (filter !== 'all' && record.status !== filter) return false;
      if (!q) return true;
      return (
        record.code.toLowerCase().includes(q) ||
        record.patient.nameMasked.includes(q) ||
        record.patient.diagnosis.includes(q) ||
        record.patient.procedure.includes(q)
      );
    });
  }, [cases, filter, search]);

  const counts = useMemo(() => {
    const active = cases.filter((c) => c.status === 'in_progress').length;
    const ready = cases.filter((c) => c.status === 'plan_ready').length;
    const planning = cases.filter((c) => c.status === 'planning').length;
    const done = cases.filter((c) => c.status === 'completed').length;
    return { active, ready, planning, done };
  }, [cases]);

  const canCreate = user ? can(user.role, 'case:create') : false;

  const openCase = (record: CaseRecord) => {
    if (record.status === 'completed') navigate(`/case/${record.id}/review`);
    else if (record.status === 'in_progress') navigate(`/case/${record.id}/procedure`);
    else navigate(`/case/${record.id}/plan`);
  };

  return (
    <div className="page cases-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">CASE WORKSPACE</span>
          <h1>病例工作台</h1>
          <p>脱敏病例、影像与导航计划。进入术中前，计划必须完成审核签字与飞行前预检。</p>
        </div>
        <div className="page-head__actions">
          <Button
            variant="ghost"
            icon={<RefreshCw size={15} className={casesQuery.isFetching ? 'spin' : ''} />}
            onClick={() => void casesQuery.refetch()}
          >
            刷新
          </Button>
          {canCreate ? (
            <Button variant="primary" icon={<ClipboardPlus size={16} />} onClick={() => setCreateOpen(true)}>
              新建病例
            </Button>
          ) : null}
        </div>
      </header>

      <div className="stat-row">
        <Metric label="待规划" value={fmtInt(counts.planning)} unit="例" tone="accent" size="sm" hint="影像 / 路径 / 审核" />
        <Metric label="计划就绪" value={fmtInt(counts.ready)} unit="例" tone="warn" size="sm" hint="等待配准与预检" />
        <Metric label="术中" value={fmtInt(counts.active)} unit="例" tone="danger" size="sm" hint="监督控制中" />
        <Metric label="已完成" value={fmtInt(counts.done)} unit="例" tone="success" size="sm" hint="可复盘与导出" />
        <div className="stat-row__spacer" />
        <div className="stat-row__note">
          <ShieldAlert size={15} />
          <span>
            安全默认：断连即冻结显示，所有运动指令需实时层确认。
          </span>
        </div>
      </div>

      <Panel className="cases-panel">
        <div className="toolbar">
          <div className="tabs">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`tabs__item ${filter === item.key ? 'is-active' : ''}`}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
                <span className="tabs__count">
                  {item.key === 'all'
                    ? cases.length
                    : cases.filter((c) => c.status === item.key).length}
                </span>
              </button>
            ))}
          </div>
          <div className="toolbar__right">
            <label className="search">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索病例号、患者、诊断…"
              />
            </label>
            <span className="toolbar__meta">
              <Filter size={14} /> {filtered.length} / {cases.length}
            </span>
          </div>
        </div>

        {casesQuery.isLoading ? (
          <div className="cases-skeleton">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="skeleton-row" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FileSearch size={30} />}
            title="没有匹配的病例"
            description={search ? '尝试调整搜索关键词或状态筛选。' : '新建一个病例开始规划。'}
            action={
              canCreate ? (
                <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                  新建病例
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table cases-table">
              <thead>
                <tr>
                  <th>病例 / 患者</th>
                  <th>诊断与术式</th>
                  <th>状态</th>
                  <th>更新</th>
                  <th className="is-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => {
                  const meta = STATUS_META[record.status];
                  return (
                    <tr key={record.id} onClick={() => openCase(record)}>
                      <td>
                        <div className="case-cell">
                          <span className="case-cell__avatar">{record.patient.nameMasked.slice(0, 1)}</span>
                          <div>
                            <div className="case-cell__code mono">{record.code}</div>
                            <div className="case-cell__name">
                              {record.patient.nameMasked}
                              <span className="muted">
                                {' '}
                                {record.patient.sex === 'M' ? '男' : '女'} · {record.patient.age}
                              </span>
                            </div>
                            <div className="case-cell__mrn mono">{record.patient.mrnMasked}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="diagnosis">{record.patient.diagnosis}</div>
                        <div className="muted small">{record.patient.procedure}</div>
                      </td>
                      <td>
                        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                        <div className="case-cell__progress">
                          <span style={{ width: `${record.progressPct}%` }} />
                        </div>
                      </td>
                      <td>
                        <div className="mono small">{fmtDateTime(record.updatedAt)}</div>
                        <div className="muted small">
                          <CalendarClock size={12} /> 创建 {fmtDateTime(record.createdAt).slice(5, 10)}
                        </div>
                      </td>
                      <td className="is-right">
                        <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                          {record.status === 'completed' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<FileSearch size={14} />}
                              onClick={() => navigate(`/case/${record.id}/review`)}
                            >
                              复盘
                            </Button>
                          ) : record.status === 'in_progress' ? (
                            <Button
                              size="sm"
                              variant="primary"
                              icon={<CircleDot size={14} />}
                              onClick={() => navigate(`/case/${record.id}/procedure`)}
                            >
                              进入术中
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Waypoints size={14} />}
                                onClick={() => navigate(`/case/${record.id}/plan`)}
                              >
                                规划
                              </Button>
                              {record.status === 'plan_ready' ? (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  icon={<CircleDot size={14} />}
                                  onClick={() => navigate(`/case/${record.id}/procedure`)}
                                >
                                  术中
                                </Button>
                              ) : null}
                              {record.status === 'plan_ready' && record.sessionId ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  icon={<FileSearch size={14} />}
                                  onClick={() => navigate(`/case/${record.id}/review`)}
                                >
                                  复盘
                                </Button>
                              ) : null}
                            </>
                          )}
                          <ArrowRight size={14} className="row-arrow" />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={createOpen}
        title="新建病例"
        subtitle="自动脱敏：仅保留姓名首字与掩码 MRN。新病例会生成模拟血管树与配准数据。"
        onClose={() => setCreateOpen(false)}
        width={560}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={createMutation.isPending || !form.nameMasked || !form.diagnosis}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? '创建中…' : '创建并进入规划'}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <label className="field">
            <span className="field__label">患者姓名（脱敏）</span>
            <input
              value={form.nameMasked}
              onChange={(event) => setForm({ ...form, nameMasked: event.target.value })}
              placeholder="例：张*明"
            />
          </label>
          <label className="field">
            <span className="field__label">性别</span>
            <select
              value={form.sex}
              onChange={(event) => setForm({ ...form, sex: event.target.value as 'M' | 'F' })}
            >
              <option value="M">男</option>
              <option value="F">女</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">年龄</span>
            <input
              type="number"
              value={form.age}
              min={1}
              max={120}
              onChange={(event) => setForm({ ...form, age: Number(event.target.value) })}
            />
          </label>
          <label className="field field--wide">
            <span className="field__label">诊断</span>
            <input
              value={form.diagnosis}
              onChange={(event) => setForm({ ...form, diagnosis: event.target.value })}
              placeholder="例：LAD 中段重度狭窄"
            />
          </label>
          <label className="field field--wide">
            <span className="field__label">拟行术式</span>
            <input
              value={form.procedure}
              onChange={(event) => setForm({ ...form, procedure: event.target.value })}
              placeholder="例：LAD 中段 PCI"
            />
          </label>
        </div>
        <p className="hint">
          创建后将进入规划页：选择目标血管 → 生成路径 → 磁可行性仿真 → 审核签字 → 配准确认。
        </p>
      </Modal>
    </div>
  );
}
