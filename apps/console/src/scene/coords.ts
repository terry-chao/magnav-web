import * as THREE from 'three';
import type { Pose, Quat, Vec3 } from '@magnav/protocol';

/**
 * The single coordinate conversion point in the console.
 * Patient LPS (x left, y posterior, z superior) → three.js (x right, y up, z back).
 *
 *   x_t = -x_lps    y_t = z_lps    z_t = y_lps
 *
 * This is a proper rotation (determinant +1) — a 180° rotation about (0,1,1).
 */
export const LPS_TO_SCENE = new THREE.Matrix4().set(
  -1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
);

const F = LPS_TO_SCENE.clone();
const _matrix = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();

export function lpsToScene(point: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-point[0], point[2], point[1]);
}

export function sceneToLps(point: THREE.Vector3): Vec3 {
  return [-point.x, point.z, point.y];
}

export function vectorToScene(v: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-v[0], v[2], v[1]);
}

export function vectorFromScene(v: THREE.Vector3): Vec3 {
  return [-v.x, v.z, v.y];
}

/** Basis transform for orientations: R_scene = F · R_lps · F⁻¹ (F⁻¹ = F). */
export function quatToScene(q: Quat, out = new THREE.Quaternion()): THREE.Quaternion {
  _matrix.makeRotationFromQuaternion(_tmpQuat.set(q[0], q[1], q[2], q[3]));
  _matrix.premultiply(F).multiply(F);
  return out.setFromRotationMatrix(_matrix);
}

export function poseToScene(
  pose: Pose,
  outPos = new THREE.Vector3(),
  outQuat = new THREE.Quaternion(),
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  lpsToScene(pose.t, outPos);
  quatToScene(pose.q, outQuat);
  return { position: outPos, quaternion: outQuat };
}

export function lpsPointsToFloat32(points: readonly Vec3[]): Float32Array {
  const out = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    out[i * 3] = p[0];
    out[i * 3 + 1] = p[1];
    out[i * 3 + 2] = p[2];
  }
  return out;
}
