import {
  COIL_SPECS,
  FLAG,
  LIMITS,
  V,
  curvatureProfile,
  fieldAt,
  gradientAlong,
  pointAtS,
  polylineLength,
  quatAlong,
  shapeUpToS,
  solveCoilCurrents,
  tipTorqueMilliNm,
} from '@magnav/protocol';
import type {
  Plan,
  ProcedurePhase,
  ReviewFrame,
  TelemetryFrame,
  Vec3,
} from '@magnav/protocol';

export type SimMode = 'HOLD' | 'RUNNING' | 'ABORTING';

export type SimEffect =
  | { type: 'segment'; index: number; name: string; count: number }
  | { type: 'arrived' }
  | { type: 'abort_done' }
  | { type: 'alarm'; code: string; detail: string };

export interface InjectedFaults {
  forceSpike: boolean;
  saturation: boolean;
  gradientSpike: boolean;
}

const SHAPE_POINTS = 96;
const SHAPE_LENGTH_MM = 150;

/** Extends the visible catheter body behind the entry point when needed. */
function buildCatheterShape(path: Vec3[], tipS: number): Float32Array {
  const out = new Float32Array(SHAPE_POINTS * 3);
  const startS = Math.max(0, tipS - SHAPE_LENGTH_MM);
  const visibleOnPath = tipS - startS;
  const virtualLength = Math.max(0, SHAPE_LENGTH_MM - visibleOnPath);
  const entry = path[0]!;
  const firstTangent = V.normalize(V.sub(path[Math.min(2, path.length - 1)]!, entry));
  const virtual = Math.max(2, Math.round((virtualLength / SHAPE_LENGTH_MM) * SHAPE_POINTS));

  if (virtualLength > 0.5) {
    for (let i = 0; i < virtual; i += 1) {
      const t = i / Math.max(1, virtual - 1);
      const point = V.sub(entry, V.scale(firstTangent, (1 - t) * virtualLength));
      out[i * 3] = point[0];
      out[i * 3 + 1] = point[1];
      out[i * 3 + 2] = point[2];
    }
  }
  const remaining = SHAPE_POINTS - (virtualLength > 0.5 ? virtual : 0);
  const pathShape = shapeUpToS(path, tipS, Math.max(0.1, visibleOnPath), Math.max(2, remaining));
  for (let i = 0; i < remaining; i += 1) {
    const src = i * 3;
    const dst = (SHAPE_POINTS - remaining + i) * 3;
    out[dst] = pathShape[src]!;
    out[dst + 1] = pathShape[src + 1]!;
    out[dst + 2] = pathShape[src + 2]!;
  }
  return out;
}

function momentDirection(tangent: Vec3): Vec3 {
  const helper: Vec3 = Math.abs(tangent[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const side = V.normalize(V.cross(tangent, helper));
  return V.normalize(V.add(tangent, V.scale(side, 0.3)));
}

/**
 * Deterministic robot/field simulator for one planned procedure.
 * Kinematics advance along the resampled plan path; magnetic field, coil
 * currents, forces and flags are derived from the same dipole model used by
 * the feasibility check.
 */
export class RobotEngine {
  readonly plan: Plan;
  readonly path: Vec3[];
  readonly totalMm: number;
  readonly curvature: number[];

  mode: SimMode = 'HOLD';
  sMm = 0;
  speedMmS = 0;
  seq = 0;
  effects: SimEffect[] = [];
  injection: InjectedFaults = { forceSpike: false, saturation: false, gradientSpike: false };
  demoAlarms = true;

  private lastSegment = -1;
  private tempAlarmFired = false;
  private nearAlarmFired = false;

  constructor(plan: Plan) {
    this.plan = plan;
    this.path = plan.path;
    this.totalMm = plan.totalLengthMm || polylineLength(plan.path);
    this.curvature = curvatureProfile(plan.path);
  }

  get progress(): number {
    return this.totalMm > 0 ? Math.min(1, Math.max(0, this.sMm / this.totalMm)) : 0;
  }

  get segmentIndex(): number {
    const segments = this.plan.segments;
    for (let i = 0; i < segments.length; i += 1) {
      if (this.sMm <= segments[i]!.endS + 0.01) return i;
    }
    return Math.max(0, segments.length - 1);
  }

  start(): void {
    this.mode = 'RUNNING';
    this.speedMmS = 0;
    this.sMm = 0;
    this.lastSegment = -1;
    this.tempAlarmFired = false;
    this.nearAlarmFired = false;
  }

  resume(): void {
    this.mode = 'RUNNING';
  }

  hold(): void {
    if (this.mode !== 'ABORTING') this.mode = 'HOLD';
    this.speedMmS = 0;
  }

  abort(): void {
    this.mode = 'ABORTING';
  }

  step(dtSeconds: number): void {
    const dt = Math.min(0.25, Math.max(0, dtSeconds));
    if (this.mode === 'RUNNING') {
      const segment = this.plan.segments[this.segmentIndex] ?? this.plan.segments[0]!;
      const remaining = this.totalMm - this.sMm;
      const targetSpeed =
        remaining < 8
          ? Math.max(0.6, remaining / 4)
          : segment.nominalSpeedMmS;
      const accel = 3.2;
      const delta = targetSpeed - this.speedMmS;
      this.speedMmS += Math.sign(delta) * Math.min(Math.abs(delta), accel * dt);
      this.sMm = Math.min(this.totalMm, this.sMm + this.speedMmS * dt);

      if (this.sMm >= this.totalMm - 0.001) {
        this.sMm = this.totalMm;
        this.speedMmS = 0;
        this.mode = 'HOLD';
        this.effects.push({ type: 'arrived' });
      }

      const seg = this.segmentIndex;
      if (seg !== this.lastSegment) {
        this.lastSegment = seg;
        const meta = this.plan.segments[seg];
        if (meta) {
          this.effects.push({
            type: 'segment',
            index: meta.index,
            name: meta.name,
            count: this.plan.segments.length,
          });
        }
      }

      if (this.demoAlarms) {
        if (!this.tempAlarmFired && this.progress > 0.62) {
          this.tempAlarmFired = true;
          this.effects.push({
            type: 'alarm',
            code: 'COIL_TEMP',
            detail: 'C3 线圈温升 57.6 °C，已自动降低该路负载 8%，继续监测',
          });
        }
        if (!this.nearAlarmFired && this.progress > 0.92) {
          this.nearAlarmFired = true;
          this.effects.push({
            type: 'alarm',
            code: 'APPROACHING_TARGET',
            detail: '距目标点 < 15 mm，准备确认到达',
          });
        }
      }
      return;
    }

    if (this.mode === 'ABORTING') {
      this.speedMmS = -14;
      this.sMm = Math.max(0, this.sMm - 14 * dt);
      if (this.sMm <= 0.001) {
        this.sMm = 0;
        this.speedMmS = 0;
        this.mode = 'HOLD';
        this.effects.push({ type: 'abort_done' });
      }
      return;
    }

    this.speedMmS = 0;
  }

  private currentsFor(tip: Vec3, tangent: Vec3): Float32Array {
    const currents = solveCoilCurrents(tip, tangent, LIMITS.fieldNominalMilliTesla);
    if (this.injection.saturation) {
      const idx = 6;
      currents[idx] = COIL_SPECS[idx]!.maxCurrentA;
      currents[(idx + 3) % COIL_SPECS.length] = -COIL_SPECS[(idx + 3) % COIL_SPECS.length]!.maxCurrentA * 0.92;
    }
    if (this.injection.gradientSpike) {
      for (let i = 0; i < currents.length; i += 1) {
        currents[i] = Math.max(
          -COIL_SPECS[i]!.maxCurrentA,
          Math.min(
            COIL_SPECS[i]!.maxCurrentA,
            currents[i]! + Math.sin(i * 1.7) * 26,
          ),
        );
      }
    }
    return currents;
  }

  frame(ts = Date.now()): TelemetryFrame {
    const { point, tangent, index } = pointAtS(this.path, this.sMm);
    const curvature = this.curvature[index] ?? 0;
    const currents = this.currentsFor(point, tangent);
    const b = fieldAt(point, currents);
    const grad = gradientAlong(point, tangent, currents) * (this.injection.gradientSpike ? 1 : 1);
    const torque = tipTorqueMilliNm(momentDirection(tangent), b);
    const bMag = V.len(b);

    const saturated =
      this.injection.saturation ||
      currents.some((c) => Math.abs(c) >= COIL_SPECS[0]!.maxCurrentA * 0.985);

    let flags = 0;
    if (saturated) flags |= FLAG.SATURATED;
    if (grad > LIMITS.gradWarn) flags |= FLAG.GRAD_LIMIT;
    if (this.injection.forceSpike) flags |= FLAG.FORCE_LIMIT;
    if (this.progress > 0.97) flags |= FLAG.NEAR_TARGET;

    const lateral =
      0.028 +
      curvature * 1.1 +
      Math.sin(this.sMm * 0.35) * 0.012 +
      (this.injection.forceSpike ? 0.58 : 0);
    const axial = 0.085 + Math.sin(this.sMm * 0.18) * 0.03;

    return {
      seq: ++this.seq,
      ts,
      tip: {
        t: point,
        q: quatAlong(tangent),
        ts,
      },
      shape: buildCatheterShape(this.path, this.sMm),
      moment: momentDirection(tangent),
      coils: currents,
      field: {
        b,
        grad,
        torque,
      },
      force: { axial, lateral },
      flags,
      progress: this.progress,
      segmentIndex: this.segmentIndex,
      speedMmS: this.speedMmS,
    };
  }

  reviewFrame(phase: ProcedurePhase, ts = Date.now()): ReviewFrame {
    const frame = this.frame(ts);
    return {
      t: 0,
      ts,
      tip: frame.tip.t,
      q: frame.tip.q,
      progress: frame.progress,
      segmentIndex: frame.segmentIndex,
      b: Number(V.len(frame.field.b).toFixed(2)),
      grad: Number(frame.field.grad.toFixed(3)),
      torque: Number(frame.field.torque.toFixed(3)),
      axial: Number(frame.force.axial.toFixed(3)),
      lateral: Number(frame.force.lateral.toFixed(3)),
      phase,
    };
  }
}
