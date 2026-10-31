import { COIL_SPECS, LIMITS, MAGNETIC_MODEL } from './constants';
import { V } from './geometry';
import type { CoilSpec, Vec3 } from './types';

/**
 * Dipole approximation of the coil array.
 *
 * Each coil is modelled as a magnetic dipole m = axis · I · k  (A·m²).
 * B(r) = μ0/4π · (3 (m·r̂) r̂ − m) / |r|³      [T]
 *
 * This is deliberately the same model on the server (telemetry synthesis)
 * and in the console (field-line illustration). It is a visualisation /
 * feasibility model — not a dosimetric or therapy-planning model.
 */

const COILS: readonly CoilSpec[] = COIL_SPECS;

export function dipoleFieldTesla(
  pointMm: Vec3,
  coilPositionMm: Vec3,
  momentAmpM2: Vec3,
): Vec3 {
  const r = V.sub(pointMm, coilPositionMm); // vector from coil to point
  const distMm = Math.max(25, V.len(r));
  const rHat = V.normalize(r);
  const scale = MAGNETIC_MODEL.mu0Over4Pi / Math.pow(distMm / 1000, 3);
  const m = momentAmpM2;
  const term = V.sub(V.scale(rHat, 3 * V.dot(m, rHat)), m);
  return V.scale(term, scale);
}

/** Field at a point in mT for the given per-coil currents (A). */
export function fieldAt(
  pointMm: Vec3,
  currents: ArrayLike<number>,
  coils: readonly CoilSpec[] = COILS,
): Vec3 {
  let bx = 0;
  let by = 0;
  let bz = 0;
  for (let i = 0; i < coils.length; i += 1) {
    const coil = coils[i]!;
    const current = currents[i] ?? 0;
    if (current === 0) continue;
    const m = V.scale(coil.axis, current * MAGNETIC_MODEL.coilMomentPerAmp);
    const b = dipoleFieldTesla(pointMm, coil.position, m);
    bx += b[0];
    by += b[1];
    bz += b[2];
  }
  return [bx * 1000, by * 1000, bz * 1000];
}

/** Unit-field matrix: field (mT) at tip per amp, for each coil. */
export function unitFieldVectors(pointMm: Vec3, coils: readonly CoilSpec[] = COILS): Vec3[] {
  return coils.map((coil) => {
    const m = V.scale(coil.axis, MAGNETIC_MODEL.coilMomentPerAmp);
    const b = dipoleFieldTesla(pointMm, coil.position, m);
    return [b[0] * 1000, b[1] * 1000, b[2] * 1000];
  });
}

/**
 * Solve coil currents that produce ~targetMilliTesla along desiredDir at the tip.
 *
 * Minimum-norm least squares: c = Uᵀ (U Uᵀ)⁻¹ T, where U maps amps to the
 * field vector at the tip. This is the lowest-energy coil pattern and keeps
 * currents well inside the hardware envelope. A bounded projected-gradient
 * refinement runs only if the minimum-norm solution violates a coil limit.
 */
export function solveCoilCurrents(
  tipMm: Vec3,
  desiredDir: Vec3,
  targetMilliTesla = LIMITS.fieldNominalMilliTesla,
  coils: readonly CoilSpec[] = COILS,
): Float32Array {
  const units = unitFieldVectors(tipMm, coils);
  const target = V.scale(V.normalize(desiredDir), targetMilliTesla);

  // G = U Uᵀ (3×3)
  const G = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const u of units) {
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        G[r]![c]! += u[r]! * u[c]!;
      }
    }
  }
  const trace = G[0]![0]! + G[1]![1]! + G[2]![2]!;
  for (let i = 0; i < 3; i += 1) G[i]![i]! += Math.max(1e-13, trace * 1e-9);

  const y = solve3x3(G, target);
  const currents = new Float32Array(coils.length);
  if (!y) return currents;
  for (let i = 0; i < coils.length; i += 1) {
    currents[i] = V.dot(units[i]!, y);
  }

  const overLimit = currents.some((c) => Math.abs(c) > coils[0]!.maxCurrentA * 0.995);
  if (!overLimit) return currents;

  // Bounded refinement (only when the minimum-norm solution is not feasible)
  for (let i = 0; i < coils.length; i += 1) {
    const max = coils[i]!.maxCurrentA;
    currents[i] = Math.min(max, Math.max(-max, currents[i]!));
  }
  for (let iter = 0; iter < 200; iter += 1) {
    const b = fieldAt(tipMm, currents, coils);
    const err: Vec3 = [target[0] - b[0], target[1] - b[1], target[2] - b[2]];
    if (V.len(err) < 0.1) break;
    for (let i = 0; i < coils.length; i += 1) {
      const u = units[i]!;
      const denom = V.dot(u, u) || 1;
      const max = coils[i]!.maxCurrentA;
      const step = (V.dot(err, u) / denom) * 0.35;
      currents[i] = Math.min(max, Math.max(-max, currents[i]! + step));
    }
  }
  return currents;
}

function solve3x3(m: number[][], b: Vec3): Vec3 | null {
  const [a, d, g] = m[0]!;
  const [bb, e, h] = m[1]!;
  const [c, f, i] = m[2]!;
  const det = a * (e * i - f * h) - d * (bb * i - f * g) + c * (bb * h - e * g);
  if (Math.abs(det) < 1e-18) return null;
  const invDet = 1 / det;
  const x = (e * i - f * h) * b[0] + (c * h - d * i) * b[1] + (d * f - c * e) * b[2];
  const y = (f * g - bb * i) * b[0] + (a * i - c * g) * b[1] + (c * bb - a * f) * b[2];
  const z = (bb * h - e * g) * b[0] + (d * g - a * h) * b[1] + (a * e - d * bb) * b[2];
  return [x * invDet, y * invDet, z * invDet];
}

/** Magnitude of the spatial field gradient dB/ds along a unit direction, T/m. */
export function gradientAlong(
  pointMm: Vec3,
  dir: Vec3,
  currents: ArrayLike<number>,
  stepMm = 1,
): number {
  const d = V.normalize(dir);
  const a = fieldAt(V.add(pointMm, V.scale(d, stepMm)), currents);
  const b = fieldAt(V.sub(pointMm, V.scale(d, stepMm)), currents);
  // fieldAt() is mT; convert the vector difference to T before dividing by metres
  return (V.len(V.sub(a, b)) * 1e-3) / ((2 * stepMm) / 1000);
}

/** Torque on the tip magnetic moment, mN·m. */
export function tipTorqueMilliNm(momentDir: Vec3, bMilliTesla: Vec3): number {
  const m = V.scale(V.normalize(momentDir), MAGNETIC_MODEL.tipMomentAmpM2);
  const bT = V.scale(bMilliTesla, 1e-3);
  return V.len(V.cross(m, bT)) * 1000;
}

export interface FieldLineOptions {
  count?: number;
  steps?: number;
  stepMm?: number;
  seedRadiusMm?: number;
}

/**
 * Stream lines of a dipole at the tip, in LPS. Returns interleaved line
 * segment endpoints (pairs) for THREE.LineSegments.
 */
export function buildFieldLines(
  tipMm: Vec3,
  momentDir: Vec3,
  options: FieldLineOptions = {},
): Float32Array {
  const count = options.count ?? MAGNETIC_MODEL.lineCount;
  const steps = options.steps ?? MAGNETIC_MODEL.lineSteps;
  const stepMm = options.stepMm ?? MAGNETIC_MODEL.lineStepMm;
  const seedRadius = options.seedRadiusMm ?? 10;

  const m = V.normalize(momentDir);
  const helper: Vec3 = Math.abs(m[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = V.normalize(V.cross(m, helper));
  const v = V.cross(m, u);

  const positions: number[] = [];
  const scratch = new Float32Array(3);

  const fieldAtStep = (p: Vec3): Vec3 => {
    const r = V.sub(p, tipMm);
    const distMm = Math.max(4, V.len(r));
    const rHat = V.normalize(r);
    const scale = 1 / Math.pow(distMm, 3);
    const term = V.sub(V.scale(rHat, 3 * V.dot(m, rHat)), m);
    return V.scale(term, scale);
  };

  for (let line = 0; line < count; line += 1) {
    const angle = (line / count) * Math.PI * 2;
    const lateral = V.add(V.scale(u, Math.cos(angle)), V.scale(v, Math.sin(angle)));
    const seedDir = V.normalize(V.add(lateral, V.scale(m, line % 2 === 0 ? 0.35 : -0.35)));
    const seed = V.add(tipMm, V.scale(seedDir, seedRadius));

    for (const direction of [1, -1]) {
      let p = seed;
      scratch[0] = p[0];
      scratch[1] = p[1];
      scratch[2] = p[2];
      for (let s = 0; s < steps; s += 1) {
        const b0 = fieldAtStep(p);
        const n0 = V.normalize(b0);
        const p1 = V.add(p, V.scale(n0, stepMm * 0.5 * direction));
        const b1 = fieldAtStep(p1);
        const n1 = V.normalize(b1);
        const p2 = V.add(p, V.scale(n1, stepMm * 0.5 * direction));
        const b2 = fieldAtStep(p2);
        const n2 = V.normalize(b2);
        const p3 = V.add(p, V.scale(n2, stepMm * direction));
        const dir = V.normalize(
          V.add(V.add(n0, V.scale(n1, 2)), V.add(V.scale(n2, 2), n3OrZero(fieldAtStep(p3)))),
        );
        const next = V.add(p, V.scale(dir, stepMm * direction));
        if (!Number.isFinite(next[0]) || V.len(V.sub(next, tipMm)) > 300) break;
        positions.push(p[0], p[1], p[2], next[0], next[1], next[2]);
        p = next;
      }
    }
  }
  return new Float32Array(positions);
}

function n3OrZero(b: Vec3): Vec3 {
  const n = V.len(b);
  if (n < 1e-12) return [0, 0, 0];
  return V.scale(b, 1 / n);
}
