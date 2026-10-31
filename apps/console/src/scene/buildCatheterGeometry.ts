import * as THREE from 'three';

export const CATHETER_SECTIONS = 96;
export const CATHETER_RADIAL = 8;

/** Fixed topology so the per-frame update only writes vertex buffers. */
export function createCatheterGeometry(): THREE.BufferGeometry {
  const vertexCount = CATHETER_SECTIONS * CATHETER_RADIAL;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];
  for (let i = 0; i < CATHETER_SECTIONS; i += 1) {
    for (let j = 0; j < CATHETER_RADIAL; j += 1) {
      const k = i * CATHETER_RADIAL + j;
      uvs[k * 2] = i / (CATHETER_SECTIONS - 1);
      uvs[k * 2 + 1] = j / CATHETER_RADIAL;
    }
  }
  for (let i = 0; i < CATHETER_SECTIONS - 1; i += 1) {
    for (let j = 0; j < CATHETER_RADIAL; j += 1) {
      const a = i * CATHETER_RADIAL + j;
      const b = i * CATHETER_RADIAL + ((j + 1) % CATHETER_RADIAL);
      const c = (i + 1) * CATHETER_RADIAL + j;
      const d = (i + 1) * CATHETER_RADIAL + ((j + 1) % CATHETER_RADIAL);
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);
  return geometry;
}

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _prevT = new THREE.Vector3();

/**
 * Parallel-transport tube update. No allocations in the loop; normals are
 * analytic (radial) so computeVertexNormals() is never called.
 */
export function updateCatheterGeometry(
  geometry: THREE.BufferGeometry,
  shape: Float32Array,
  sections = CATHETER_SECTIONS,
  radial = CATHETER_RADIAL,
  radius = 1.25,
): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const P = pos.array as Float32Array;
  const N = nrm.array as Float32Array;
  const count = Math.min(sections, Math.floor(shape.length / 3));
  if (count < 2) return;

  // initial frame
  _t.set(
    shape[3]! - shape[0]!,
    shape[4]! - shape[1]!,
    shape[5]! - shape[2]!,
  );
  if (_t.lengthSq() < 1e-9) _t.set(0, 0, 1);
  _t.normalize();
  _b.set(0, 0, 1);
  if (Math.abs(_b.dot(_t)) > 0.9) _b.set(1, 0, 0);
  _n.crossVectors(_t, _b).normalize();
  _b.crossVectors(_t, _n).normalize();

  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    _p.set(shape[i3]!, shape[i3 + 1]!, shape[i3 + 2]!);
    const prev3 = Math.max(0, i - 1) * 3;
    const next3 = Math.min(count - 1, i + 1) * 3;
    _prevT.copy(_t);
    _t.set(
      shape[next3]! - shape[prev3]!,
      shape[next3 + 1]! - shape[prev3 + 1]!,
      shape[next3 + 2]! - shape[prev3 + 2]!,
    );
    if (_t.lengthSq() < 1e-9) _t.copy(_prevT);
    _t.normalize();

    // parallel transport: remove tangential component from the previous normal
    _n.addScaledVector(_t, -_t.dot(_n));
    if (_n.lengthSq() < 1e-8) {
      _n.set(0, 0, 1).cross(_t);
      if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0).cross(_t);
    }
    _n.normalize();
    _b.crossVectors(_t, _n).normalize();

    const taper = 1 - 0.12 * (i / (count - 1));
    for (let r = 0; r < radial; r += 1) {
      const angle = (r / radial) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const nx = _n.x * cos + _b.x * sin;
      const ny = _n.y * cos + _b.y * sin;
      const nz = _n.z * cos + _b.z * sin;
      const o = (i * radial + r) * 3;
      P[o] = _p.x + nx * radius * taper;
      P[o + 1] = _p.y + ny * radius * taper;
      P[o + 2] = _p.z + nz * radius * taper;
      N[o] = nx;
      N[o + 1] = ny;
      N[o + 2] = nz;
    }
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  geometry.computeBoundingSphere();
}
