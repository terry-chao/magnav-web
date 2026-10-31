import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Q, mulberry32 } from '@magnav/protocol';
import type { Quat, Vec3 } from '@magnav/protocol';
import { lpsToScene, quatToScene, sceneToLps, vectorToScene } from './coords';

describe('LPS ↔ scene conversion', () => {
  it('maps the axes correctly and preserves handedness', () => {
    const left = lpsToScene([1, 0, 0]).toArray();
    expect(left[0]).toBeCloseTo(-1, 9);
    expect(left[1]).toBeCloseTo(0, 9);
    expect(left[2]).toBeCloseTo(0, 9);
    const back = lpsToScene([0, 1, 0]).toArray();
    expect(back[0]).toBeCloseTo(0, 9);
    expect(back[1]).toBeCloseTo(0, 9);
    expect(back[2]).toBeCloseTo(1, 9);
    const up = lpsToScene([0, 0, 1]).toArray();
    expect(up[0]).toBeCloseTo(0, 9);
    expect(up[1]).toBeCloseTo(1, 9);
    expect(up[2]).toBeCloseTo(0, 9);
  });

  it('round-trips arbitrary points', () => {
    const random = mulberry32(42);
    for (let i = 0; i < 200; i += 1) {
      const p: Vec3 = [random() * 600 - 300, random() * 600 - 300, random() * 600 - 300];
      const scene = lpsToScene(p);
      const back = sceneToLps(scene);
      expect(back[0]).toBeCloseTo(p[0], 6);
      expect(back[1]).toBeCloseTo(p[1], 6);
      expect(back[2]).toBeCloseTo(p[2], 6);
    }
  });

  it('converts orientation by a basis change F·R·F⁻¹', () => {
    const random = mulberry32(7);
    const qScene = new THREE.Quaternion();
    const rotated = new THREE.Vector3();
    for (let i = 0; i < 100; i += 1) {
      const axis: Vec3 = [random() - 0.5, random() - 0.5, random() - 0.5];
      const angle = random() * Math.PI * 2;
      const n = Math.hypot(...axis) || 1;
      const s = Math.sin(angle / 2) / n;
      const q: Quat = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
      const v: Vec3 = [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1];

      quatToScene(q, qScene);
      rotated.copy(vectorToScene(v)).applyQuaternion(qScene);
      const expected = vectorToScene(Q.rotate(q, v));

      expect(rotated.x).toBeCloseTo(expected.x, 5);
      expect(rotated.y).toBeCloseTo(expected.y, 5);
      expect(rotated.z).toBeCloseTo(expected.z, 5);
    }
  });
});
