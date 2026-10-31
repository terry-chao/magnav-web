import type {
  CaseRecord,
  Patient,
  Plan,
  RegistrationInfo,
  User,
  VesselTree,
} from '@magnav/protocol';
import { composePlan, defaultRegistration } from '../planning';
import { createVesselTree } from './vessels';

export interface SeedData {
  cases: CaseRecord[];
  trees: Map<string, VesselTree>;
  registrations: Map<string, RegistrationInfo>;
  plans: Map<string, Plan>;
}

const now = Date.now();
const day = 24 * 60 * 60 * 1000;

function patient(
  id: string,
  nameMasked: string,
  sex: 'M' | 'F',
  age: number,
  diagnosis: string,
  procedure: string,
  mrnMasked: string,
): Patient {
  return {
    id,
    nameMasked,
    sex,
    age,
    mrnMasked,
    diagnosis,
    procedure,
    weightKg: sex === 'M' ? 74 : 58,
    allergies: ['碘对比剂（轻度）'],
  };
}

const PATIENTS: Patient[] = [
  patient('p-1031', '张*明', 'M', 62, '冠状动脉粥样硬化性心脏病 · LAD 中段重度狭窄', 'LAD 中段 PCI', 'MRN-****-1031'),
  patient('p-1032', '李*华', 'F', 55, '不稳定型心绞痛 · LCX 分支病变', 'LCX 分支 PCI', 'MRN-****-1032'),
  patient('p-1033', '王*国', 'M', 68, 'RCA 慢性完全闭塞（CTO）', 'RCA 再通', 'MRN-****-1033'),
];

const surgeon: Pick<User, 'id'> = { id: 'u-surgeon' };
const tech = 'u-tech';

export function buildSeedData(): SeedData {
  const cases: CaseRecord[] = [];
  const trees = new Map<string, VesselTree>();
  const registrations = new Map<string, RegistrationInfo>();
  const plans = new Map<string, Plan>();

  const definitions = [
    {
      id: 'case-1031',
      code: 'C-2026-1031',
      patient: PATIENTS[0]!,
      variant: { rotationDeg: -3, scale: 1.0, zOffset: 0 },
      tre: 0.9,
      branchId: 'lad',
      targetFraction: 0.72,
      planId: 'plan-1031-lad',
      planName: 'LAD 中段 · 自动导航计划 A',
      approved: true,
      status: 'plan_ready' as const,
      createdAt: now - 2 * day,
    },
    {
      id: 'case-1032',
      code: 'C-2026-1032',
      patient: PATIENTS[1]!,
      variant: { rotationDeg: 4, scale: 0.96, zOffset: 4 },
      tre: 1.1,
      branchId: 'lcx',
      targetFraction: 0.8,
      planId: 'plan-1032-lcx',
      planName: 'LCX 分支 · 自动导航计划 B',
      approved: false,
      status: 'planning' as const,
      createdAt: now - 1 * day,
    },
    {
      id: 'case-1033',
      code: 'C-2026-1033',
      patient: PATIENTS[2]!,
      variant: { rotationDeg: 1.5, scale: 1.03, zOffset: -3 },
      tre: 0.7,
      branchId: 'rca',
      targetFraction: 0.76,
      planId: 'plan-1033-rca',
      planName: 'RCA 再通 · 自动导航计划 C',
      approved: true,
      status: 'completed' as const,
      createdAt: now - 5 * day,
    },
  ];

  for (const def of definitions) {
    const tree = createVesselTree(def.id, def.variant);
    trees.set(def.id, tree);
    const registration = defaultRegistration(def.id, def.tre, tech);
    registration.verifiedAt = def.createdAt + 3600_000;
    registrations.set(def.id, registration);

    const branch = tree.branches.find((b) => b.id === def.branchId)!;
    const index = Math.round(def.targetFraction * (branch.points.length - 1));
    const plan = composePlan({
      caseId: def.id,
      tree,
      name: def.planName,
      createdBy: 'u-surgeon',
      target: { branchId: def.branchId, index },
      note: branch.stenosis?.label ?? '目标血管段',
    });
    plan.id = def.planId;
    plan.createdAt = def.createdAt + 2 * 3600_000;
    if (def.approved) {
      plan.status = 'approved';
      plan.approvedBy = 'u-surgeon';
      plan.approvedAt = def.createdAt + 3 * 3600_000;
    } else {
      plan.status = 'simulated';
    }
    plans.set(plan.id, plan);

    cases.push({
      id: def.id,
      code: def.code,
      patient: def.patient,
      status: def.status,
      createdAt: def.createdAt,
      updatedAt: def.createdAt + 3 * 3600_000,
      createdBy: 'u-surgeon',
      progressPct: def.status === 'completed' ? 100 : 0,
      lastPlanId: plan.id,
      sessionId: def.status === 'completed' ? `session-${def.id}` : undefined,
    });
  }

  return { cases, trees, registrations, plans };
}

export { surgeon };
