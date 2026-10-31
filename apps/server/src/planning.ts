import {
  COIL_SPECS,
  LIMITS,
  V,
  buildVesselGraph,
  curvatureProfile,
  fieldAt,
  gradientAlong,
  nearestNode,
  pointAtS,
  polylineLength,
  quatAlong,
  radiusAlongPath,
  resamplePolyline,
  shortestPath,
  solveCoilCurrents,
  tipTorqueMilliNm,
} from '@magnav/protocol';
import type {
  FeasibilityPoint,
  FeasibilityReport,
  Plan,
  PlanSegment,
  RegistrationInfo,
  Vec3,
  VesselTree,
} from '@magnav/protocol';

export interface ComposePlanInput {
  caseId: string;
  tree: VesselTree;
  name: string;
  createdBy: string;
  target: { branchId?: string; index?: number; point?: Vec3 };
  approvedBy?: string;
  approvedAt?: number;
  note?: string;
}

/** Simulated servo lag between field direction and tip moment — produces torque. */
function momentDirection(tangent: Vec3): Vec3 {
  const helper: Vec3 = Math.abs(tangent[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const side = V.normalize(V.cross(tangent, helper));
  return V.normalize(V.add(tangent, V.scale(side, 0.36)));
}

function assessFeasibility(
  path: Vec3[],
  curvature: number[],
): FeasibilityReport {
  const total = polylineLength(path);
  const sampleStep = 4;
  const count = Math.max(8, Math.min(120, Math.ceil(total / sampleStep)));
  const points: FeasibilityPoint[] = [];
  let maxB = 0;
  let maxGrad = 0;
  let maxTorque = 0;
  let maxCurvature = 0;
  let minMargin = 1;

  for (let i = 0; i < count; i += 1) {
    const s = (i / (count - 1)) * total;
    const { point, tangent, index } = pointAtS(path, s);
    // project the sample's curvature from the nearest path index
    const curv = curvature[index] ?? 0;
    const currents = solveCoilCurrents(point, tangent, LIMITS.fieldNominalMilliTesla);
    const b = fieldAt(point, currents);
    const bMag = V.len(b);
    const grad = gradientAlong(point, tangent, currents);
    const torque = tipTorqueMilliNm(momentDirection(tangent), b);
    const saturated = currents.some((c) => Math.abs(c) >= COIL_SPECS[0]!.maxCurrentA * 0.96);
    const margin = Math.min(
      (LIMITS.gradMax - grad) / LIMITS.gradMax,
      (LIMITS.torqueMax - torque) / LIMITS.torqueMax,
      (LIMITS.curvatureMax - curv) / LIMITS.curvatureMax,
      (LIMITS.fieldMaxMilliTesla - bMag) / LIMITS.fieldMaxMilliTesla,
    );
    maxB = Math.max(maxB, bMag);
    maxGrad = Math.max(maxGrad, grad);
    maxTorque = Math.max(maxTorque, torque);
    maxCurvature = Math.max(maxCurvature, curv);
    minMargin = Math.min(minMargin, margin);
    points.push({
      sMm: Number(s.toFixed(1)),
      bMilliTesla: Number(bMag.toFixed(2)),
      gradTeslaPerM: Number(grad.toFixed(3)),
      torqueMilliNm: Number(torque.toFixed(3)),
      curvature: Number(curv.toFixed(5)),
      margin: Number(margin.toFixed(4)),
      saturated,
    });
  }

  const warnings: string[] = [];
  if (maxGrad > LIMITS.gradWarn) warnings.push('路径局部梯度接近上限，建议降低推进速度');
  if (maxTorque > LIMITS.torqueWarn) warnings.push('磁力矩接近上限，注意器械姿态稳定性');
  if (maxCurvature > LIMITS.curvatureMax * 0.8) warnings.push('目标血管曲率较大，建议分段减速');
  if (points.some((p) => p.saturated)) warnings.push('存在线圈饱和风险，需降低场强需求');
  if (warnings.length === 0) warnings.push('全路径磁导航可行性余量充足');

  const passed =
    maxGrad <= LIMITS.gradMax &&
    maxTorque <= LIMITS.torqueMax &&
    maxCurvature <= LIMITS.curvatureMax &&
    maxB <= LIMITS.fieldMaxMilliTesla &&
    !points.some((p) => p.saturated);

  return {
    passed,
    model: 'dipole-v1',
    maxB: Number(maxB.toFixed(2)),
    maxGrad: Number(maxGrad.toFixed(3)),
    maxTorque: Number(maxTorque.toFixed(3)),
    maxCurvature: Number(maxCurvature.toFixed(5)),
    minMargin: Number(minMargin.toFixed(4)),
    targetB: LIMITS.fieldNominalMilliTesla,
    points,
    warnings,
    computedAt: Date.now(),
  };
}

function buildSegments(
  path: Vec3[],
  curvature: number[],
  tree: VesselTree,
  targetBranchId: string,
  nodeIds: string[],
): PlanSegment[] {
  const total = polylineLength(path);
  const targetBranch = tree.branches.find((b) => b.id === targetBranchId);
  const branchStartNodeIndex = nodeIds.findIndex((id) => id.startsWith(`${targetBranchId}:`));
  const branchStartS =
    branchStartNodeIndex > 0
      ? (branchStartNodeIndex / Math.max(1, nodeIds.length - 1)) * total
      : total * 0.7;

  const boundaries = [0, Math.min(total * 0.45, branchStartS * 0.92), branchStartS, total]
    .map((v) => Math.max(0, Math.min(total, v)))
    .sort((a, b) => a - b);
  const unique = boundaries.filter((v, i, arr) => i === 0 || v - arr[i - 1]! > total * 0.05);
  if (unique[unique.length - 1] !== total) unique.push(total);
  if (unique.length < 3) {
    unique.splice(0, unique.length, 0, total * 0.5, total);
  }

  const names = ['主动脉逆行段', '主动脉根 / 开口段', `${targetBranch?.name ?? '目标血管'} 目标段`];
  const segments: PlanSegment[] = [];
  for (let i = 0; i < unique.length - 1 && i < 4; i += 1) {
    const startS = unique[i]!;
    const endS = unique[i + 1]!;
    const mid = (startS + endS) / 2;
    const sample = pointAtS(path, mid);
    const localCurv = curvature[sample.index] ?? 0;
    const baseSpeed = 6.4;
    const speed = Math.max(
      2.6,
      Math.min(6.4, baseSpeed - localCurv * 55 - (targetBranch?.stenosis ? 0.8 : 0)),
    );
    const lengthMm = endS - startS;
    segments.push({
      index: i,
      name: names[Math.min(i, names.length - 1)]!,
      startS: Number(startS.toFixed(1)),
      endS: Number(endS.toFixed(1)),
      lengthMm: Number(lengthMm.toFixed(1)),
      maxCurvature: Number(localCurv.toFixed(5)),
      nominalSpeedMmS: Number(speed.toFixed(2)),
      etaSeconds: Math.ceil(lengthMm / speed),
      risk: localCurv > LIMITS.curvatureMax * 0.75 ? 'high' : localCurv > 0.02 ? 'medium' : 'low',
    });
  }
  return segments;
}

export function composePlan(input: ComposePlanInput): Plan {
  const graph = buildVesselGraph(input.tree);
  let goalId: string | null = null;
  if (input.target.branchId) {
    const ids = graph.byBranch.get(input.target.branchId);
    if (!ids || ids.length === 0) throw Object.assign(new Error('unknown branch'), { code: 'BAD_TARGET' });
    const index = Math.min(
      ids.length - 1,
      Math.max(1, input.target.index ?? Math.floor(ids.length * 0.7)),
    );
    goalId = ids[index]!;
  } else if (input.target.point) {
    const node = nearestNode(graph, input.target.point);
    goalId = node?.id ?? null;
  }
  if (!goalId) throw Object.assign(new Error('no target'), { code: 'BAD_TARGET' });

  const nodeIds = shortestPath(graph, graph.rootId, goalId);
  if (nodeIds.length < 2) {
    throw Object.assign(new Error('no path to target'), { code: 'NO_PATH' });
  }

  const raw = nodeIds.map((id) => graph.nodes.get(id)!.point);
  const path = resamplePolyline(raw, 1.5);
  const radii = radiusAlongPath(graph, nodeIds, path);
  const curvature = curvatureProfile(path);
  const totalLengthMm = polylineLength(path);
  if (totalLengthMm < 20) {
    throw Object.assign(new Error('path too short'), { code: 'PATH_TOO_SHORT' });
  }

  const feasibility = assessFeasibility(path, curvature);
  if (!feasibility.passed) {
    throw Object.assign(new Error('plan fails magnetic feasibility'), {
      code: 'PLAN_INFEASIBLE',
      detail: feasibility.warnings.join('；'),
    });
  }

  const targetBranchId = nodeIds[nodeIds.length - 1]!.split(':')[0]!;
  const segments = buildSegments(path, curvature, input.tree, targetBranchId, nodeIds);
  const etaSeconds = segments.reduce((acc, s) => acc + s.etaSeconds, 0);
  const target = path[path.length - 1]!;
  const targetBranch = input.tree.branches.find((b) => b.id === targetBranchId);

  const plan: Plan = {
    id: `plan-${input.caseId}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)
      .toString(36)
      .padStart(2, '0')}`,
    caseId: input.caseId,
    name: input.name,
    approach: '经股动脉 · 磁导航自动推进',
    targetBranchId,
    targetS: totalLengthMm,
    target,
    path,
    radii,
    totalLengthMm: Number(totalLengthMm.toFixed(1)),
    etaSeconds,
    segments,
    feasibility,
    status: input.approvedBy ? 'approved' : 'simulated',
    createdBy: input.createdBy,
    createdAt: Date.now(),
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt,
    note: input.note ?? targetBranch?.stenosis?.label,
  };
  return plan;
}

export function defaultRegistration(caseId: string, treMm: number, verifiedBy = 'u-tech'): RegistrationInfo {
  const matrix = [
    0.9992, -0.031, 0.024, 2.1,
    0.031, 0.9995, -0.012, -1.4,
    -0.024, 0.013, 0.9996, 0.8,
    0, 0, 0, 1,
  ];
  const residualMap = [
    { t: [0, 0, 0] as Vec3, errorMm: Number((treMm * 0.92).toFixed(2)) },
    { t: [-40, -30, 50] as Vec3, errorMm: Number((treMm * 1.08).toFixed(2)) },
    { t: [45, -30, 40] as Vec3, errorMm: Number((treMm * 0.84).toFixed(2)) },
    { t: [38, 55, 0] as Vec3, errorMm: Number((treMm * 1.12).toFixed(2)) },
    { t: [-55, -60, 80] as Vec3, errorMm: Number((treMm * 1.2).toFixed(2)) },
    { t: [10, 110, -180] as Vec3, errorMm: Number((treMm * 0.55).toFixed(2)) },
  ];
  return {
    caseId,
    treMm,
    targetTreMm: LIMITS.treMaxMm,
    confidence: Math.max(0.55, Math.min(0.99, 1 - treMm * 0.09)),
    matrix,
    method: 'FUSION',
    verifiedAt: Date.now(),
    verifiedBy,
    residualMap,
  };
}

export interface PrecheckInput {
  treMm: number;
  plan: Plan;
  coilTemps: number[];
  coilsEnabled: number;
  estopClosed: boolean;
  latencyP95Ms: number;
}

export function buildPrecheck(input: PrecheckInput) {
  const items = [
    {
      id: 'imaging',
      label: '影像序列',
      detail: 'DSA 序列完整，旋转造影已重建（模拟）',
      passed: true,
      value: '152 帧 · 3D 重建',
      limit: '序列完整',
      severity: 'required' as const,
    },
    {
      id: 'registration',
      label: '配准残差',
      detail: 'DSA-3D 融合配准，残差映射已加载',
      passed: input.treMm <= LIMITS.treMaxMm,
      value: `${input.treMm.toFixed(1)} mm`,
      limit: `≤ ${LIMITS.treMaxMm.toFixed(1)} mm`,
      severity: 'required' as const,
    },
    {
      id: 'plan',
      label: '导航计划',
      detail: input.plan.note ?? '计划已通过审核',
      passed: input.plan.status === 'approved',
      value: `${input.plan.segments.length} 段 · ${input.plan.totalLengthMm.toFixed(0)} mm`,
      limit: '已审核签字',
      severity: 'required' as const,
    },
    {
      id: 'feasibility',
      label: '磁可行性',
      detail: '沿路径场强 / 梯度 / 力矩校验（偶极子模型）',
      passed: input.plan.feasibility.passed,
      value: `梯度峰值 ${input.plan.feasibility.maxGrad.toFixed(2)} T/m`,
      limit: `≤ ${LIMITS.gradMax.toFixed(1)} T/m`,
      severity: 'required' as const,
    },
    {
      id: 'coils',
      label: '线圈阵列',
      detail: `${input.coilsEnabled}/${COIL_SPECS.length} 路线圈自检通过`,
      passed: input.coilsEnabled === COIL_SPECS.length,
      value: `${input.coilsEnabled}/${COIL_SPECS.length} 在线`,
      limit: '全部在线',
      severity: 'required' as const,
    },
    {
      id: 'coil-temp',
      label: '线圈温升',
      detail: '冷却回路正常，最热线圈温度',
      passed: Math.max(...input.coilTemps) < LIMITS.coilTempMax,
      value: `${Math.max(...input.coilTemps).toFixed(1)} °C`,
      limit: `< ${LIMITS.coilTempMax} °C`,
      severity: 'required' as const,
    },
    {
      id: 'estop',
      label: '急停回路',
      detail: '硬件急停回路闭环，软件急停可用',
      passed: input.estopClosed,
      value: input.estopClosed ? '闭环' : '断开',
      limit: '闭环',
      severity: 'required' as const,
    },
    {
      id: 'latency',
      label: '通信延迟',
      detail: '实时层 → 控制台 P95 延迟',
      passed: input.latencyP95Ms <= LIMITS.latencyP95MaxMs,
      value: `${input.latencyP95Ms.toFixed(0)} ms`,
      limit: `≤ ${LIMITS.latencyP95MaxMs} ms`,
      severity: 'advisory' as const,
    },
    {
      id: 'storage',
      label: '本地存储',
      detail: '术中录像与审计日志剩余空间（模拟）',
      passed: true,
      value: '82 GB',
      limit: '> 10 GB',
      severity: 'advisory' as const,
    },
  ];
  return { items, passed: items.every((i) => i.passed) };
}

/** Utility for the planning UI: risk colour keyed to worst margin. */
export function feasibilityTone(report: FeasibilityReport): 'ok' | 'warn' | 'danger' {
  if (!report.passed) return 'danger';
  if (report.minMargin < 0.25) return 'warn';
  return 'ok';
}

export function planSummaryCurvature(plan: Plan): number {
  return plan.feasibility.maxCurvature;
}

export function planQuaternionAtEnd(plan: Plan) {
  const end = plan.path[plan.path.length - 1]!;
  const prev = plan.path[Math.max(0, plan.path.length - 2)]!;
  return { point: end, quaternion: quatAlong(V.normalize(V.sub(end, prev))) };
}
