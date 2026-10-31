import type { Vec3, VesselBranch, VesselTree } from '@magnav/protocol';
import { interpolateRadii, smoothVessel, V } from '@magnav/protocol';

interface BranchSpec {
  id: string;
  name: string;
  fullName: string;
  parentId: string | null;
  control: Vec3[];
  radii: number[];
  stenosis?: { at: number; severityPct: number; label: string };
  tone: number;
}

const BRANCHES: BranchSpec[] = [
  {
    id: 'aorta',
    name: '主动脉',
    fullName: '主动脉 · 股动脉入口至主动脉根',
    parentId: null,
    control: [
      [10, 120, -195],
      [8, 96, -168],
      [4, 70, -140],
      [0, 40, -108],
      [0, 12, -76],
      [0, -4, -40],
      [0, -2, -12],
      [0, 0, 0],
    ],
    radii: [6.2, 5.8, 5.2, 4.6, 4.2, 4.0, 3.8, 3.6],
    tone: 0.12,
  },
  {
    id: 'lad',
    name: 'LAD',
    fullName: '左前降支（LAD）· 中段至远端',
    parentId: 'aorta',
    control: [
      [0, 0, 0],
      [0, 3, 16],
      [-6, 0, 32],
      [-20, -10, 48],
      [-38, -28, 64],
      [-54, -50, 78],
      [-66, -74, 88],
    ],
    radii: [3.4, 3.2, 2.9, 2.5, 2.1, 1.7, 1.4],
    stenosis: { at: 0.64, severityPct: 68, label: 'LAD 中段重度狭窄 68%' },
    tone: 0.32,
  },
  {
    id: 'lcx',
    name: 'LCX',
    fullName: '左回旋支（LCX）· 近段至远端',
    parentId: 'aorta',
    control: [
      [0, 0, 0],
      [0, 3, 16],
      [8, 1, 32],
      [22, -6, 46],
      [42, -18, 56],
      [60, -36, 62],
      [72, -58, 64],
    ],
    radii: [3.2, 3.0, 2.7, 2.4, 2.0, 1.7, 1.4],
    tone: 0.52,
  },
  {
    id: 'rca',
    name: 'RCA',
    fullName: '右冠状动脉（RCA）· 近段至远端',
    parentId: 'aorta',
    control: [
      [0, 0, 0],
      [0, 3, 16],
      [5, 12, 24],
      [20, 28, 24],
      [36, 48, 16],
      [46, 70, 4],
      [50, 92, -10],
    ],
    radii: [3.6, 3.3, 3.0, 2.7, 2.2, 1.8, 1.5],
    stenosis: { at: 0.55, severityPct: 54, label: 'RCA 近中段狭窄 54%' },
    tone: 0.72,
  },
  {
    id: 'lad-septal',
    name: 'S1',
    fullName: 'LAD 第一间隔支',
    parentId: 'lad',
    control: [
      [-34, -32, 50],
      [-36, -44, 64],
      [-36, -58, 76],
    ],
    radii: [1.9, 1.5, 1.2],
    tone: 0.4,
  },
  {
    id: 'lad-diag',
    name: 'D1',
    fullName: 'LAD 第一对角支',
    parentId: 'lad',
    control: [
      [-18, -14, 32],
      [-8, -28, 46],
      [0, -42, 58],
    ],
    radii: [1.7, 1.3, 1.0],
    tone: 0.36,
  },
  {
    id: 'lcx-om',
    name: 'OM1',
    fullName: 'LCX 第一钝缘支',
    parentId: 'lcx',
    control: [
      [44, -26, 42],
      [58, -36, 52],
      [68, -50, 62],
    ],
    radii: [1.8, 1.4, 1.1],
    tone: 0.6,
  },
  {
    id: 'rca-pda',
    name: 'PDA',
    fullName: 'RCA 后降支',
    parentId: 'rca',
    control: [
      [34, 42, 8],
      [32, 58, 20],
      [28, 76, 30],
    ],
    radii: [1.8, 1.4, 1.1],
    tone: 0.8,
  },
];

function rotateZ(point: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [point[0] * c - point[1] * s, point[0] * s + point[1] * c, point[2]];
}

export interface VesselVariant {
  rotationDeg?: number;
  scale?: number;
  zOffset?: number;
}

/**
 * Procedural coronary tree used by the simulator. Deterministic, de-identified,
 * approximating the geometry of a left/right coronary system in patient LPS.
 */
export function createVesselTree(caseId: string, variant: VesselVariant = {}): VesselTree {
  const rotation = ((variant.rotationDeg ?? 0) * Math.PI) / 180;
  const scale = variant.scale ?? 1;
  const zOffset = variant.zOffset ?? 0;

  const branches: VesselBranch[] = BRANCHES.map((spec) => {
    const control = spec.control.map((p) => {
      const scaled: Vec3 = [p[0] * scale, p[1] * scale, p[2] * scale + zOffset];
      return rotateZ(scaled, rotation);
    });
    const points = smoothVessel(control, 2);
    let radii = interpolateRadii(spec.radii, points.length).map((r) => r * scale);
    let stenosis: VesselBranch['stenosis'];
    if (spec.stenosis) {
      const center = Math.round(spec.stenosis.at * (points.length - 1));
      const width = Math.max(3, points.length * 0.08);
      const severity = spec.stenosis.severityPct / 100;
      radii = radii.map((r, i) => {
        const w = Math.exp(-((i - center) ** 2) / (2 * width * width));
        return r * (1 - severity * w * 0.9);
      });
      stenosis = {
        atIndex: center,
        severityPct: spec.stenosis.severityPct,
        label: spec.stenosis.label,
      };
    }
    return {
      id: spec.id,
      name: spec.name,
      fullName: spec.fullName,
      parentId: spec.parentId,
      points,
      radii,
      stenosis,
      tone: spec.tone,
    };
  });

  const all = branches.flatMap((b) => b.points);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of all) {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i], p[i]!);
      max[i] = Math.max(max[i], p[i]!);
    }
  }

  const totalLengthMm = branches.reduce((acc, b) => {
    let len = 0;
    for (let i = 1; i < b.points.length; i += 1) len += V.dist(b.points[i - 1]!, b.points[i]!);
    return acc + len;
  }, 0);

  return {
    caseId,
    branches,
    bounds: { min, max },
    stats: {
      branchCount: branches.length,
      totalLengthMm: Math.round(totalLengthMm),
      minRadiusMm: Math.min(...branches.flatMap((b) => b.radii)),
    },
  };
}

export function branchPointAt(tree: VesselTree, branchId: string, fraction: number): Vec3 {
  const branch = tree.branches.find((b) => b.id === branchId);
  if (!branch) return [0, 0, 0];
  const index = Math.min(
    branch.points.length - 1,
    Math.max(0, Math.round(fraction * (branch.points.length - 1))),
  );
  return branch.points[index]!;
}
