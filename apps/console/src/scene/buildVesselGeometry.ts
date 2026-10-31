import * as THREE from 'three';
import type { VesselTree, Vec3 } from '@magnav/protocol';
import { V } from '@magnav/protocol';

export interface BranchRange {
  start: number;
  count: number;
}

export interface StenosisMarker {
  branchId: string;
  position: Vec3;
  tangent: Vec3;
  radius: number;
  severityPct: number;
  label: string;
}

export interface VesselGeometryResult {
  geometry: THREE.BufferGeometry;
  ranges: Map<string, BranchRange>;
  markers: StenosisMarker[];
  highlight: Float32Array;
}

const RADIAL = 10;

function parallelTransportFrames(points: readonly Vec3[]): {
  tangents: THREE.Vector3[];
  normals: THREE.Vector3[];
  binormals: THREE.Vector3[];
} {
  const tangents: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  const tmp = new THREE.Vector3();
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const t = new THREE.Vector3(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]);
    if (t.lengthSq() < 1e-9) t.set(0, 0, 1);
    t.normalize();
    tangents.push(t);
  }
  let normal = new THREE.Vector3(0, 1, 0);
  if (Math.abs(normal.dot(tangents[0]!)) > 0.9) normal.set(1, 0, 0);
  normal.crossVectors(tangents[0]!, normal).normalize();
  for (let i = 0; i < points.length; i += 1) {
    const t = tangents[i]!;
    if (i > 0) {
      const prevT = tangents[i - 1]!;
      const axis = new THREE.Vector3().crossVectors(prevT, t);
      const len = axis.length();
      if (len > 1e-8) {
        axis.multiplyScalar(1 / len);
        const angle = Math.acos(THREE.MathUtils.clamp(prevT.dot(t), -1, 1));
        normal.applyAxisAngle(axis, angle);
      }
    }
    // re-orthogonalise to protect against drift
    tmp.crossVectors(t, normal).normalize();
    normal = new THREE.Vector3().crossVectors(tmp, t).normalize();
    const binormal = new THREE.Vector3().crossVectors(t, normal).normalize();
    normals.push(normal.clone());
    binormals.push(binormal);
  }
  return { tangents, normals, binormals };
}

/** Build one merged, vertex-attributed tube mesh for the entire vessel tree. */
export function buildVesselGeometry(tree: VesselTree, radiusBoost = 0): VesselGeometryResult {
  const positions: number[] = [];
  const normals: number[] = [];
  const tone: number[] = [];
  const highlight: number[] = [];
  const indices: number[] = [];
  const ranges = new Map<string, BranchRange>();
  const markers: StenosisMarker[] = [];

  for (const branch of tree.branches) {
    const start = positions.length / 3;
    const frames = parallelTransportFrames(branch.points);
    const count = branch.points.length;
    for (let i = 0; i < count; i += 1) {
      const p = branch.points[i]!;
      const r = (branch.radii[i] ?? 1.5) + radiusBoost;
      const n = frames.normals[i]!;
      const b = frames.binormals[i]!;
      for (let j = 0; j < RADIAL; j += 1) {
        const angle = (j / RADIAL) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const nx = n.x * cos + b.x * sin;
        const ny = n.y * cos + b.y * sin;
        const nz = n.z * cos + b.z * sin;
        positions.push(p[0] + nx * r, p[1] + ny * r, p[2] + nz * r);
        normals.push(nx, ny, nz);
        tone.push(branch.tone);
        highlight.push(0);
      }
    }
    for (let i = 0; i < count - 1; i += 1) {
      for (let j = 0; j < RADIAL; j += 1) {
        const a = start + i * RADIAL + j;
        const b = start + i * RADIAL + ((j + 1) % RADIAL);
        const c = start + (i + 1) * RADIAL + j;
        const d = start + (i + 1) * RADIAL + ((j + 1) % RADIAL);
        indices.push(a, c, b, b, c, d);
      }
    }
    ranges.set(branch.id, { start, count: count * RADIAL });
    if (branch.stenosis) {
      const index = Math.min(branch.points.length - 1, branch.stenosis.atIndex);
      const point = branch.points[index]!;
      const prev = branch.points[Math.max(0, index - 2)]!;
      const next = branch.points[Math.min(branch.points.length - 1, index + 2)]!;
      markers.push({
        branchId: branch.id,
        position: point,
        tangent: V.normalize(V.sub(next, prev)),
        radius: branch.radii[index] ?? 1.5,
        severityPct: branch.stenosis.severityPct,
        label: branch.stenosis.label,
      });
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('aTone', new THREE.Float32BufferAttribute(tone, 1));
  geometry.setAttribute('aHighlight', new THREE.Float32BufferAttribute(highlight, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return {
    geometry,
    ranges,
    markers,
    highlight: new Float32Array(highlight),
  };
}
