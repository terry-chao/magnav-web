import { describe, expect, it } from 'vitest';
import {
  Q,
  V,
  curvatureProfile,
  pointAtS,
  polylineLength,
  quatAlong,
  quatFromUnitVectors,
  resamplePolyline,
  shapeUpToS,
  smoothVessel,
} from '../src/geometry';

describe('geometry', () => {
  it('resamples at near-constant arc length and preserves endpoints', () => {
    const line = [V.scale([1, 0, 0], 0), [10, 0, 0], [20, 5, 0], [30, 10, 0]] as const;
    const sampled = resamplePolyline(line, 2);
    expect(sampled[0]).toEqual([0, 0, 0]);
    expect(sampled[sampled.length - 1]).toEqual([30, 10, 0]);
    for (let i = 1; i < sampled.length; i += 1) {
      const d = V.dist(sampled[i - 1]!, sampled[i]!);
      expect(d).toBeGreaterThan(1.5);
      expect(d).toBeLessThan(2.5);
    }
  });

  it('smooths and resamples a control polygon with plausible length', () => {
    const control = [
      [0, 0, 0],
      [0, 0, 40],
      [30, 0, 70],
      [60, 10, 90],
    ] as const;
    const smooth = smoothVessel(control, 2);
    expect(smooth.length).toBeGreaterThan(40);
    expect(polylineLength(smooth)).toBeGreaterThan(100);
    expect(polylineLength(smooth)).toBeLessThan(220);
    expect(smooth[0]).toEqual(control[0]);
  });

  it('computes curvature of a circular arc', () => {
    const radius = 50;
    const points = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 39) * Math.PI;
      return [radius * Math.sin(a), 0, radius * (1 - Math.cos(a))] as [
        number,
        number,
        number,
      ];
    });
    const k = curvatureProfile(points);
    expect(k[20]).toBeGreaterThan(0.015);
    expect(k[20]).toBeLessThan(0.025);
  });

  it('interpolates a point at arc length', () => {
    const line = [
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ] as const;
    const at = pointAtS(line, 15);
    expect(at.point[0]).toBeCloseTo(15, 5);
    expect(at.tangent[0]).toBeCloseTo(1, 5);
  });

  it('builds a fixed-size catheter shape ending at the tip', () => {
    const line = [
      [0, 0, 0],
      [0, 0, 100],
    ] as const;
    const shape = shapeUpToS(line, 80, 60, 96);
    expect(shape.length).toBe(96 * 3);
    expect(shape[95 * 3 + 2]).toBeCloseTo(80, 4);
    expect(shape[2]).toBeCloseTo(20, 1);
  });

  it('rotates basis vectors with quaternions', () => {
    const q = quatFromUnitVectors([0, 0, 1], [1, 0, 0]);
    const rotated = Q.rotate(q, [0, 0, 1]);
    expect(rotated[0]).toBeCloseTo(1, 5);
    expect(rotated[1]).toBeCloseTo(0, 5);
    expect(rotated[2]).toBeCloseTo(0, 5);
  });

  it('aligns tip quaternion with path tangent', () => {
    const q = quatAlong([0, 1, 0]);
    const forward = Q.rotate(q, [0, 0, 1]);
    expect(forward[1]).toBeCloseTo(1, 5);
  });
});
