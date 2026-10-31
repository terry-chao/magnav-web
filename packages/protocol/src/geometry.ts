import type { Quat, Vec3 } from './types';

export const V = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  dist: (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  normalize: (a: Vec3): Vec3 => {
    const n = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / n, a[1] / n, a[2] / n];
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
  clampLength: (a: Vec3, max: number): Vec3 => {
    const n = Math.hypot(a[0], a[1], a[2]);
    if (n <= max || n === 0) return a;
    return [a[0] * (max / n), a[1] * (max / n), a[2] * (max / n)];
  },
};

export function catmullRomPoint(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    out[i] =
      0.5 *
      (2 * p1[i] +
        (-p0[i] + p2[i]) * t +
        (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
        (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  }
  return out;
}

export function polylineLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += V.dist(points[i - 1]!, points[i]!);
  return total;
}

export function cumulativeLengths(points: readonly Vec3[]): number[] {
  const out = new Array<number>(points.length);
  out[0] = 0;
  for (let i = 1; i < points.length; i += 1) {
    out[i] = out[i - 1]! + V.dist(points[i - 1]!, points[i]!);
  }
  return out;
}

/** Resample a polyline at constant arc-length spacing. Endpoints preserved. */
export function resamplePolyline(points: readonly Vec3[], stepMm = 1.5): Vec3[] {
  if (points.length < 2) return points.slice();
  const cum = cumulativeLengths(points);
  const total = cum[cum.length - 1]!;
  if (total < stepMm) return [points[0]!, points[points.length - 1]!];
  const count = Math.max(2, Math.round(total / stepMm) + 1);
  const step = total / (count - 1);
  const out: Vec3[] = [points[0]!];
  let seg = 1;
  for (let i = 1; i < count - 1; i += 1) {
    const target = i * step;
    while (seg < cum.length - 1 && cum[seg]! < target) seg += 1;
    const s0 = cum[seg - 1]!;
    const s1 = cum[seg]!;
    const t = s1 > s0 ? (target - s0) / (s1 - s0) : 0;
    out.push(V.lerp(points[seg - 1]!, points[seg]!, Math.min(1, Math.max(0, t))));
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** Smooth a control polygon with centripetal Catmull–Rom and resample. */
export function smoothVessel(
  control: readonly Vec3[],
  stepMm = 2,
): Vec3[] {
  if (control.length < 2) return control.slice();
  const dense: Vec3[] = [control[0]!];
  for (let i = 0; i < control.length - 1; i += 1) {
    const p0 = control[Math.max(0, i - 1)]!;
    const p1 = control[i]!;
    const p2 = control[i + 1]!;
    const p3 = control[Math.min(control.length - 1, i + 2)]!;
    const length = V.dist(p1, p2);
    const sub = Math.max(8, Math.ceil(length / 1.2));
    for (let j = 1; j <= sub; j += 1) {
      dense.push(catmullRomPoint(p0, p1, p2, p3, j / sub));
    }
  }
  return resamplePolyline(dense, stepMm);
}

export function interpolateRadii(
  controlRadii: readonly number[],
  count: number,
): number[] {
  if (controlRadii.length === 0) return new Array(count).fill(1.5);
  if (controlRadii.length === 1) return new Array(count).fill(controlRadii[0]!);
  const out: number[] = [];
  const segments = controlRadii.length - 1;
  for (let i = 0; i < count; i += 1) {
    const t = (i / Math.max(1, count - 1)) * segments;
    const k = Math.min(segments - 1, Math.floor(t));
    const f = t - k;
    out.push(controlRadii[k]! * (1 - f) + controlRadii[k + 1]! * f);
  }
  return out;
}

/** Menger curvature in 1/mm at point i. */
export function curvatureAt(points: readonly Vec3[], i: number): number {
  if (i <= 0 || i >= points.length - 1) return 0;
  const a = points[i - 1]!;
  const b = points[i]!;
  const c = points[i + 1]!;
  const ab = V.dist(a, b);
  const bc = V.dist(b, c);
  const ca = V.dist(c, a);
  if (ab < 1e-6 || bc < 1e-6 || ca < 1e-6) return 0;
  const area = 0.5 * V.len(V.cross(V.sub(b, a), V.sub(c, a)));
  return (4 * area) / (ab * bc * ca);
}

export function curvatureProfile(points: readonly Vec3[]): number[] {
  const out = new Array<number>(points.length).fill(0);
  for (let i = 1; i < points.length - 1; i += 1) out[i] = curvatureAt(points, i);
  // light smoothing to avoid single-sample spikes at resampling artefacts
  const smoothed = out.slice();
  for (let i = 1; i < out.length - 1; i += 1) {
    smoothed[i] = (out[i - 1]! + out[i]! * 2 + out[i + 1]!) / 4;
  }
  return smoothed;
}

export function pointAtS(
  points: readonly Vec3[],
  sMm: number,
): { point: Vec3; tangent: Vec3; index: number; sMm: number } {
  const cum = cumulativeLengths(points);
  const total = cum[cum.length - 1]!;
  const s = Math.min(total, Math.max(0, sMm));
  let hi = 1;
  while (hi < cum.length - 1 && cum[hi]! < s) hi += 1;
  const s0 = cum[hi - 1]!;
  const s1 = cum[hi]!;
  const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
  const point = V.lerp(points[hi - 1]!, points[hi]!, t);
  const tangent = V.normalize(V.sub(points[hi]!, points[hi - 1]!));
  return { point, tangent, index: hi, sMm: s };
}

/** Catheter shape: `lengthMm` of path behind the tip plus the tip. */
export function shapeUpToS(
  points: readonly Vec3[],
  tipS: number,
  lengthMm: number,
  samples: number,
): Float32Array {
  const start = Math.max(0, tipS - lengthMm);
  const out = new Float32Array(samples * 3);
  for (let i = 0; i < samples; i += 1) {
    const s = start + ((tipS - start) * i) / (samples - 1);
    const { point } = pointAtS(points, s);
    out[i * 3] = point[0];
    out[i * 3 + 1] = point[1];
    out[i * 3 + 2] = point[2];
  }
  return out;
}

export function nearestOnPolyline(
  points: readonly Vec3[],
  target: Vec3,
): { index: number; distanceMm: number; sMm: number; point: Vec3 } {
  let best = { index: 0, distanceMm: Infinity, sMm: 0, point: points[0]! };
  const cum = cumulativeLengths(points);
  for (let i = 0; i < points.length; i += 1) {
    const d = V.dist(points[i]!, target);
    if (d < best.distanceMm) {
      best = { index: i, distanceMm: d, sMm: cum[i]!, point: points[i]! };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Quaternions                                                         */
/* ------------------------------------------------------------------ */

export const Q = {
  identity: (): Quat => [0, 0, 0, 1],
  normalize: (q: Quat): Quat => {
    const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  },
  conjugate: (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]],
  multiply: (a: Quat, b: Quat): Quat => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  rotate: (q: Quat, v: Vec3): Vec3 => {
    // v' = v + 2 * qv × (qv × v + w v)
    const qv: Vec3 = [q[0], q[1], q[2]];
    const t = V.scale(V.cross(qv, v), 2);
    return V.add(v, V.add(V.scale(t, q[3]), V.cross(qv, t)));
  },
  slerp: (a: Quat, b: Quat, t: number): Quat => {
    let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let bb = b;
    if (cos < 0) {
      cos = -cos;
      bb = [-b[0], -b[1], -b[2], -b[3]];
    }
    if (cos > 0.9995) {
      return Q.normalize([
        a[0] + (bb[0] - a[0]) * t,
        a[1] + (bb[1] - a[1]) * t,
        a[2] + (bb[2] - a[2]) * t,
        a[3] + (bb[3] - a[3]) * t,
      ]);
    }
    const theta = Math.acos(cos);
    const sin = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / sin;
    const wb = Math.sin(t * theta) / sin;
    return Q.normalize([
      a[0] * wa + bb[0] * wb,
      a[1] * wa + bb[1] * wb,
      a[2] * wa + bb[2] * wb,
      a[3] * wa + bb[3] * wb,
    ]);
  },
};

/** Shortest-arc rotation taking unit vector `from` to unit vector `to`. */
export function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const f = V.normalize(from);
  const t = V.normalize(to);
  let d = V.dot(f, t);
  if (d > 0.999999) return Q.identity();
  if (d < -0.999999) {
    let axis = V.cross([1, 0, 0], f);
    if (V.len(axis) < 1e-6) axis = V.cross([0, 1, 0], f);
    axis = V.normalize(axis);
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = V.cross(f, t);
  return Q.normalize([c[0], c[1], c[2], 1 + d]);
}

/** Catheter tip quaternion in LPS: local +Z aligned with tangent. */
export function quatAlong(tangent: Vec3): Quat {
  return quatFromUnitVectors([0, 0, 1], tangent);
}

/** Rotation matrix (row-major 4x4) from a quaternion. */
export function matrixFromQuat(q: Quat): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    0,
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    0,
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
    0,
    0,
    0,
    0,
    1,
  ];
}
