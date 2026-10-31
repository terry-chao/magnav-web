import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Crosshair,
  GitBranch,
  Info,
  Layers3,
  PlayCircle,
  RefreshCw,
  ScanLine,
  Signature,
  Target,
  Waypoints,
} from 'lucide-react';
import {
  DISCLAIMER,
  LIMITS,
  V,
  can,
  type Plan,
  type RegistrationInfo,
  type Vec3,
  type VesselBranch,
  type VesselTree,
} from '@magnav/protocol';
import { http, ApiError } from '../services/http';
import { useSessionStore } from '../store/session';
import { fmtDateTime, fmtDuration, fmtInt, fmtMm, fmtPct, personLabel } from '../lib/format';
import { Button } from '../components/ui/Button';
import {
  EmptyState,
  Gauge,
  GateRail,
  Metric,
  Panel,
  StatusPill,
} from '../components/ui/Primitives';
import { Modal } from '../components/ui/Modal';
import { SceneCanvas } from '../scene/SceneCanvas';
import { SceneToolbar } from '../components/SceneToolbar';
import type { SceneLayers } from '../scene/SceneContent';
import type { ViewPreset } from '../scene/CameraRig';

function nearestBranch(tree: VesselTree, point: Vec3): { branch: VesselBranch; index: number } {
  let best: { branch: VesselBranch; index: number; distance: number } | null = null;
  for (const branch of tree.branches) {
    for (let i = 0; i < branch.points.length; i += 1) {
      const d = V.dist(branch.points[i]!, point);
      if (!best || d < best.distance) best = { branch, index: i, distance: d };
    }
  }
  return best ? { branch: best.branch, index: best.index } : { branch: tree.branches[0]!, index: 0 };
}

function PlanStatusPill({ plan }: { plan: Plan }) {
  if (plan.status === 'approved') return <StatusPill tone="success">已审核</StatusPill>;
  if (plan.status === 'simulated') return <StatusPill tone="warn">待审核</StatusPill>;
  return <StatusPill tone="neutral">草稿</StatusPill>;
}

function FeasibilityPanel({ plan }: { plan: Plan }) {
  const f = plan.feasibility;
  return (
    <div className="feasibility">
      <div className="feasibility__head">
        <StatusPill tone={f.passed ? 'success' : 'danger'}>{f.passed ? '可行性通过' : '不可行'}</StatusPill>
        <span className="muted small">偶极子模型 · {f.points.length} 采样点</span>
      </div>
      <Gauge label="峰值场强 B" value={f.maxB} limit={LIMITS.fieldMaxMilliTesla} unit="mT" digits={1} />
      <Gauge label="峰值梯度 ∇B" value={f.maxGrad} limit={LIMITS.gradMax} unit="T/m" digits={2} />
      <Gauge label="峰值磁力矩 τ" value={f.maxTorque} limit={LIMITS.torqueMax} unit="mN·m" digits={2} />
      <Gauge
        label="最大曲率 κ"
        value={f.maxCurvature}
        limit={LIMITS.curvatureMax}
        unit="mm⁻¹"
        digits={4}
      />
      <div className="feasibility__margin">
        <span>最小约束余量</span>
        <strong className={f.minMargin < 0.2 ? 'tone-warn' : 'tone-ok'}>{fmtPct(f.minMargin, 0)}</strong>
      </div>
      <ul className="warn-list">
        {f.warnings.map((warning) => (
          <li key={warning}>
            <Info size={13} />
            {warning}
          </li>
        ))}
      </ul>
      <p className="footnote">
        场强 / 梯度为实时层求解的可行性校验值；前端仅可视化，不做控制闭环。
      </p>
    </div>
  );
}

function RegistrationCard({
  registration,
  caseId,
  onVerified,
}: {
  registration: RegistrationInfo | null;
  caseId: string;
  onVerified: () => void;
}) {
  const user = useSessionStore((s) => s.user);
  const pushToast = useSessionStore((s) => s.pushToast);
  const canVerify = user ? can(user.role, 'procedure:prepare') : false;
  const mutation = useMutation({
    mutationFn: () => http.verifyRegistration(caseId),
    onSuccess: (result) => {
      onVerified();
      pushToast({
        tone: result.treMm <= result.targetTreMm ? 'success' : 'warn',
        title: `配准完成 · TRE ${result.treMm.toFixed(1)} mm`,
        message:
          result.treMm <= result.targetTreMm
            ? '配准残差在门限内，可进入预检'
            : '残差超过 1.5 mm，禁止进入武装态',
      });
    },
    onError: () => pushToast({ tone: 'danger', title: '重新配准失败' }),
  });

  if (!registration) {
    return (
      <Panel title="影像配准" dense>
        <EmptyState title="尚未配准" description="加载 DSA 与 3D 血管树后执行配准。" />
      </Panel>
    );
  }
  const ok = registration.treMm <= registration.targetTreMm;
  return (
    <Panel
      title="影像配准"
      subtitle={`${registration.method} · ${fmtDateTime(registration.verifiedAt)}`}
      dense
      actions={
        <StatusPill tone={ok ? 'success' : 'danger'}>{ok ? 'TRE 在限内' : 'TRE 超限'}</StatusPill>
      }
    >
      <div className="registration">
        <div className="registration__tre">
          <span className="registration__label">TRE</span>
          <span className={`registration__value ${ok ? 'tone-ok' : 'tone-danger'}`}>
            {registration.treMm.toFixed(1)}
            <small>mm</small>
          </span>
          <span className="muted small">门限 ≤ {registration.targetTreMm.toFixed(1)} mm</span>
        </div>
        <div className="registration__metrics">
          <Metric label="置信度" value={fmtPct(registration.confidence, 0)} size="sm" />
          <Metric label="验证人" value={personLabel(registration.verifiedBy)} size="sm" />
          <Metric label="残差映射" value={`${registration.residualMap.length} 点`} size="sm" />
        </div>
        <div className="registration__residuals">
          {registration.residualMap.slice(0, 4).map((point, index) => (
            <div key={index} className="residual">
              <span className="mono">
                [{point.t.map((n) => n.toFixed(0)).join(', ')}]
              </span>
              <span className={point.errorMm > registration.targetTreMm ? 'tone-danger' : 'muted'}>
                {point.errorMm.toFixed(2)} mm
              </span>
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<ScanLine size={14} />}
          disabled={!canVerify || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? '配准中…' : '重新配准'}
        </Button>
      </div>
    </Panel>
  );
}

export function PlanningPage() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useSessionStore((s) => s.user);
  const pushToast = useSessionStore((s) => s.pushToast);

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [draftTarget, setDraftTarget] = useState<Vec3 | null>(null);
  const [picking, setPicking] = useState(false);
  const [preset, setPreset] = useState<ViewPreset>('ISO');
  const [layers, setLayers] = useState<SceneLayers>({
    vessels: true,
    path: true,
    coils: true,
    field: false,
    phantom: true,
  });
  const [approveOpen, setApproveOpen] = useState(false);
  const [pin, setPin] = useState('');

  const caseQuery = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => http.caseDetail(caseId),
    enabled: Boolean(caseId),
  });
  const treeQuery = useQuery({
    queryKey: ['tree', caseId],
    queryFn: () => http.vessels(caseId),
    enabled: Boolean(caseId),
  });

  const detail = caseQuery.data;
  const tree = treeQuery.data;
  const plans = detail?.plans ?? [];
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId],
  );

  useEffect(() => {
    if (!selectedPlan && plans.length > 0) setSelectedPlanId(plans[0]!.id);
  }, [plans, selectedPlan]);

  useEffect(() => {
    if (selectedPlan?.targetBranchId) setSelectedBranch(selectedPlan.targetBranchId);
  }, [selectedPlan?.id, selectedPlan?.targetBranchId]);

  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPicking(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);

  const canCompose = user ? can(user.role, 'plan:compose') : false;
  const canApprove = user ? can(user.role, 'plan:approve') : false;

  const createPlan = useMutation({
    mutationFn: () => {
      if (!tree) throw new Error('血管树未加载');
      if (draftTarget) {
        return http.composePlan(caseId, { point: [draftTarget[0], draftTarget[1], draftTarget[2]] });
      }
      const branch = tree.branches.find((b) => b.id === selectedBranch) ?? tree.branches.find((b) => b.id !== 'aorta');
      if (!branch) throw new Error('请选择目标血管');
      return http.composePlan(caseId, {
        branchId: branch.id,
        index: Math.round((branch.points.length - 1) * 0.72),
      });
    },
    onSuccess: async (plan) => {
      await queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      setSelectedPlanId(plan.id);
      setDraftTarget(null);
      setPicking(false);
      pushToast({
        tone: 'success',
        title: `路径已生成 · ${plan.totalLengthMm.toFixed(0)} mm`,
        message: `${plan.segments.length} 段 · 预计 ${fmtDuration(plan.etaSeconds)} · 待审核签字`,
      });
    },
    onError: (error) => {
      const detailMessage = error instanceof ApiError ? error.detail : undefined;
      pushToast({
        tone: 'danger',
        title: error instanceof ApiError ? error.code : '路径生成失败',
        message: detailMessage ?? (error instanceof Error ? error.message : '请调整目标点后重试'),
      });
    },
  });

  const approve = useMutation({
    mutationFn: () => {
      if (!selectedPlan) throw new Error('未选择计划');
      return http.approvePlan(selectedPlan.id, pin);
    },
    onSuccess: async (plan) => {
      await queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      setApproveOpen(false);
      setPin('');
      pushToast({ tone: 'success', title: '计划已审核签字', message: `${plan.name} · 可进入术中` });
    },
    onError: (error) => {
      pushToast({
        tone: 'danger',
        title: '审核失败',
        message: error instanceof ApiError ? error.message : '签名口令错误',
      });
    },
  });

  if (!user) return null;

  const handlePick = (point: Vec3) => {
    if (!tree) return;
    const nearest = nearestBranch(tree, point);
    setDraftTarget(point);
    setSelectedBranch(nearest.branch.id);
    // unmounting the raycast proxy inside its own pointer event can confuse
    // R3F's event pass — leave picking mode on the next frame instead
    window.setTimeout(() => setPicking(false), 80);
    pushToast({
      tone: 'info',
      title: `已选择目标 · ${nearest.branch.name}`,
      message: '点击「生成导航计划」进行磁可行性校验',
    });
  };

  const gatePhase = selectedPlan?.status === 'approved' ? 'REGISTERED' : selectedPlan ? 'PLAN_READY' : 'SEGMENTED';
  const registrationOk = detail?.registration ? detail.registration.treMm <= detail.registration.targetTreMm : false;
  const readyForProcedure = Boolean(selectedPlan?.status === 'approved' && registrationOk);

  const enterProcedure = () => {
    if (!selectedPlan) return;
    navigate(`/case/${caseId}/procedure`, { state: { planId: selectedPlan.id } });
  };

  return (
    <div className="page planning-page">
      <header className="page-head page-head--compact">
        <div className="page-head__left">
          <Link to="/cases" className="back-link">
            <ArrowLeft size={14} /> 病例
          </Link>
          <div>
            <div className="page-head__meta">
              <span className="mono">{detail?.case.code ?? '—'}</span>
              <StatusPill tone="planning">术前规划</StatusPill>
              {detail ? <span className="muted">{fmtDateTime(detail.case.createdAt)}</span> : null}
            </div>
            <h1>
              {detail?.case.patient.nameMasked ?? '加载中'}
              <span className="page-head__sub">
                {detail ? `${detail.case.patient.sex === 'M' ? '男' : '女'} · ${detail.case.patient.age} 岁 · ${detail.case.patient.diagnosis}` : ''}
              </span>
            </h1>
          </div>
        </div>
        <div className="page-head__actions">
          <Button variant="ghost" icon={<RefreshCw size={15} />} onClick={() => void queryClient.invalidateQueries({ queryKey: ['case', caseId] })}>
            刷新
          </Button>
          <Button
            variant="primary"
            icon={<PlayCircle size={16} />}
            disabled={!readyForProcedure}
            title={readyForProcedure ? '进入术中控制台' : '计划需审核签字且 TRE ≤ 1.5 mm'}
            onClick={enterProcedure}
          >
            进入术中
          </Button>
        </div>
      </header>

      <div className="planning-gates">
        <GateRail phase={gatePhase} />
        <div className="planning-gates__hint">
          {selectedPlan?.status === 'approved'
            ? registrationOk
              ? '计划已签字 · 配准在限内 · 可进入术中'
              : '配准残差超限 · 请重新配准'
            : selectedPlan
              ? '计划尚未审核签字'
              : '请选择目标并生成导航计划'}
        </div>
      </div>

      <div className="planning-grid">
        <aside className="planning-left">
          <Panel title="病例" subtitle="脱敏信息" dense>
            <dl className="kv">
              <div>
                <dt>患者</dt>
                <dd>
                  {detail?.case.patient.nameMasked} · {detail?.case.patient.sex === 'M' ? '男' : '女'} · {detail?.case.patient.age}
                </dd>
              </div>
              <div>
                <dt>MRN</dt>
                <dd className="mono">{detail?.case.patient.mrnMasked}</dd>
              </div>
              <div>
                <dt>诊断</dt>
                <dd>{detail?.case.patient.diagnosis}</dd>
              </div>
              <div>
                <dt>术式</dt>
                <dd>{detail?.case.patient.procedure}</dd>
              </div>
              <div>
                <dt>过敏</dt>
                <dd className="tone-warn">{detail?.case.patient.allergies.join(' / ') || '无记录'}</dd>
              </div>
            </dl>
          </Panel>

          <Panel
            title="血管树"
            subtitle={tree ? `${tree.stats.branchCount} 分支 · ${tree.stats.totalLengthMm} mm` : '加载中'}
            dense
            actions={<Button size="sm" variant="subtle" icon={<Crosshair size={13} />} onClick={() => setPicking(true)}>3D 选点</Button>}
          >
            <div className="branch-list">
              {(tree?.branches ?? []).map((branch) => {
                const isActive = selectedBranch === branch.id;
                return (
                  <button
                    key={branch.id}
                    type="button"
                    className={`branch-row ${isActive ? 'is-active' : ''}`}
                    onClick={() => {
                      setSelectedBranch(branch.id);
                      setDraftTarget(null);
                      setPicking(false);
                    }}
                  >
                    <span className={`branch-row__dot branch-row__dot--${Math.round(branch.tone * 10)}`} />
                    <span className="branch-row__main">
                      <span className="branch-row__name">
                        {branch.name}
                        {branch.stenosis ? (
                          <span className="branch-row__stenosis">
                            <AlertTriangle size={11} /> {branch.stenosis.severityPct}%
                          </span>
                        ) : null}
                      </span>
                      <span className="branch-row__detail">{branch.fullName}</span>
                    </span>
                    <span className="branch-row__radius mono">{branch.radii[Math.floor(branch.radii.length / 2)]?.toFixed(1)} mm</span>
                  </button>
                );
              })}
            </div>
            <p className="footnote">点击分支选择目标；也可在 3D 中直接点击血管。半径来自分割结果，未做视觉修饰。</p>
          </Panel>

          <Panel title="导航计划" subtitle={`${plans.length} 个版本`} dense>
            <div className="plan-list">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  className={`plan-row ${selectedPlan?.id === plan.id ? 'is-active' : ''}`}
                  onClick={() => setSelectedPlanId(plan.id)}
                >
                  <span className="plan-row__top">
                    <span className="plan-row__name">{plan.name}</span>
                    <PlanStatusPill plan={plan} />
                  </span>
                  <span className="plan-row__meta mono">
                    {plan.totalLengthMm.toFixed(0)} mm · {plan.segments.length} 段 · {fmtDuration(plan.etaSeconds)}
                  </span>
                </button>
              ))}
              {plans.length === 0 ? (
                <EmptyState
                  icon={<Waypoints size={24} />}
                  title="尚无计划"
                  description="选择目标血管后生成第一条导航路径。"
                />
              ) : null}
            </div>
          </Panel>
        </aside>

        <section className="planning-center">
          <div className="viewport viewport--planning">
            {tree ? (
              <SceneCanvas
                tree={tree}
                plan={selectedPlan}
                mode="planning"
                viewPreset={preset}
                layers={layers}
                selectedBranchId={selectedBranch}
                picking={picking}
                draftTarget={draftTarget}
                onPick={handlePick}
              />            ) : (
              <div className="viewport__loading">正在加载血管树…</div>
            )}

            <SceneToolbar
              preset={preset}
              onPreset={setPreset}
              layers={layers}
              onLayers={setLayers}
              picking={picking}
              onPicking={setPicking}
              extra={
                canCompose ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Waypoints size={14} />}
                    disabled={createPlan.isPending}
                    onClick={() => createPlan.mutate()}
                  >
                    {createPlan.isPending ? '校验中…' : '生成导航计划'}
                  </Button>
                ) : null
              }
            />

            <div className="viewport__corner viewport__corner--tl" />
            <div className="viewport__corner viewport__corner--tr" />
            <div className="viewport__corner viewport__corner--bl" />
            <div className="viewport__corner viewport__corner--br" />

            <div className="viewport__overlay viewport__overlay--top-right">
              <span className="chip"><ScanLine size={12} /> 3D · 1 unit = 1 mm</span>
              <span className="chip chip--muted">{preset}</span>
            </div>

            <div className="viewport__overlay viewport__overlay--bottom-left">
              <div className="legend">
                <span><i className="legend__swatch legend__swatch--vessel" /> 血管中心线</span>
                <span><i className="legend__swatch legend__swatch--path" /> 规划路径</span>
                <span><i className="legend__swatch legend__swatch--target" /> 目标点</span>
                <span><i className="legend__swatch legend__swatch--coil" /> 线圈阵列</span>
              </div>
            </div>

            {picking ? (
              <div className="viewport__overlay viewport__overlay--center">
                <div className="pick-hint">
                  <Crosshair size={18} />
                  在血管上点击以选择目标点
                  <span className="muted">Esc / 再次点击按钮取消</span>
                </div>
              </div>
            ) : null}

            {!selectedPlan ? (
              <div className="viewport__overlay viewport__overlay--center">
                <div className="empty-3d">
                  <Target size={26} />
                  <h3>选择目标血管</h3>
                  <p>点击左侧分支或直接在 3D 血管上选点，生成可审核的导航计划。</p>
                  <Button size="sm" variant="primary" icon={<Waypoints size={14} />} disabled={!canCompose} onClick={() => createPlan.mutate()}>
                    生成导航计划
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="planning-bottom">
            <RegistrationCard
              registration={detail?.registration ?? null}
              caseId={caseId}
              onVerified={() => void queryClient.invalidateQueries({ queryKey: ['case', caseId] })}
            />
            <div className="approval-card">
              <div className="approval-card__head">
                <div>
                  <span className="eyebrow">PLAN RELEASE</span>
                  <h3>计划审核与放行</h3>
                </div>
                {selectedPlan ? <PlanStatusPill plan={selectedPlan} /> : null}
              </div>
              {selectedPlan ? (
                <>
                  <div className="approval-card__meta">
                    <span><Signature size={13} /> {selectedPlan.approvedBy ? '已签字' : '待术者签字'}</span>
                    <span className="mono">{selectedPlan.approvedAt ? fmtDateTime(selectedPlan.approvedAt) : '—'}</span>
                  </div>
                  <p className="footnote">
                    签字表示已核对目标血管、路径、约束余量与备用方案。签字后计划不可静默修改。
                  </p>
                  <div className="approval-card__actions">
                    <Button
                      variant="warn"
                      icon={<Signature size={15} />}
                      disabled={!selectedPlan.feasibility.passed || selectedPlan.status === 'approved' || !canApprove}
                      onClick={() => setApproveOpen(true)}
                    >
                      {selectedPlan.status === 'approved' ? '已审核' : '审核签字'}
                    </Button>
                    <Button
                      variant="primary"
                      icon={<ArrowRight size={15} />}
                      disabled={!readyForProcedure}
                      onClick={enterProcedure}
                    >
                      进入术中
                    </Button>
                  </div>
                </>
              ) : (
                <p className="muted small">先生成导航计划。</p>
              )}
            </div>
          </div>
        </section>

        <aside className="planning-right">
          {selectedPlan ? (
            <>
              <Panel title="计划摘要" subtitle={selectedPlan.name} dense>
                <div className="summary-grid">
                  <Metric label="路径长度" value={fmtInt(selectedPlan.totalLengthMm)} unit="mm" size="sm" />
                  <Metric label="预计用时" value={fmtDuration(selectedPlan.etaSeconds)} size="sm" />
                  <Metric label="分段" value={selectedPlan.segments.length} unit="段" size="sm" />
                  <Metric label="目标分支" value={tree?.branches.find((b) => b.id === selectedPlan.targetBranchId)?.name ?? '—'} size="sm" />
                </div>
                <div className="target-point">
                  <Target size={14} />
                  <span>目标点</span>
                  <span className="mono">
                    [{selectedPlan.target.map((n) => n.toFixed(1)).join(', ')}] mm
                  </span>
                </div>
              </Panel>

              <Panel title="磁导航可行性" actions={<StatusPill tone={selectedPlan.feasibility.passed ? 'success' : 'danger'}>{selectedPlan.feasibility.maxGrad.toFixed(2)} T/m</StatusPill>} dense>
                <FeasibilityPanel plan={selectedPlan} />
              </Panel>

              <Panel title="分段执行计划" subtitle={`${selectedPlan.segments.length} 段`} dense>
                <div className="segment-list">
                  {selectedPlan.segments.map((segment) => (
                    <div key={segment.index} className="segment-row">
                      <span className={`segment-row__index risk-${segment.risk}`}>{segment.index + 1}</span>
                      <div className="segment-row__main">
                        <span className="segment-row__name">{segment.name}</span>
                        <span className="segment-row__meta mono">
                          {segment.lengthMm.toFixed(0)} mm · {segment.nominalSpeedMmS.toFixed(1)} mm/s · κ {segment.maxCurvature.toFixed(3)}
                        </span>
                      </div>
                      <span className="segment-row__eta mono">{fmtDuration(segment.etaSeconds)}</span>
                    </div>
                  ))}
                </div>
                {selectedPlan.note ? (
                  <p className="plan-note"><AlertTriangle size={13} /> {selectedPlan.note}</p>
                ) : null}
              </Panel>
            </>
          ) : (
            <Panel title="计划详情" dense>
              <EmptyState icon={<GitBranch size={26} />} title="等待计划" description="生成或选择一条导航路径。" />
            </Panel>
          )}

          <div className="disclaimer-card">
            <Info size={14} />
            <p>{DISCLAIMER}</p>
          </div>
        </aside>
      </div>

      <Modal
        open={approveOpen}
        title="计划审核签字"
        subtitle={selectedPlan ? `${selectedPlan.name} · ${selectedPlan.totalLengthMm.toFixed(0)} mm · ${selectedPlan.segments.length} 段` : ''}
        onClose={() => setApproveOpen(false)}
        width={480}
        footer={
          <>
            <Button variant="ghost" onClick={() => setApproveOpen(false)}>取消</Button>
            <Button variant="warn" disabled={pin.length < 3 || approve.isPending} onClick={() => approve.mutate()}>
              {approve.isPending ? '签字中…' : '确认签字'}
            </Button>
          </>
        }
      >
        <div className="approve-modal">
          <div className="approve-modal__gate">
            <BadgeCheck size={16} />
            <span>签字前请确认：目标分支、路径分段、约束余量与配准状态均已核对。</span>
          </div>
          <label className="field">
            <span className="field__label">术者签名口令</span>
            <input
              type="password"
              value={pin}
              autoFocus
              onChange={(event) => setPin(event.target.value)}
              placeholder="输入个人口令"
            />
          </label>
          <p className="hint">演示环境：赵*峰的口令为 <span className="mono">2468</span>。签字信息写入哈希链审计日志。</p>
        </div>
      </Modal>
    </div>
  );
}
