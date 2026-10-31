import { describe, expect, it } from 'vitest';
import {
  buildFieldLines,
  fieldAt,
  gradientAlong,
  solveCoilCurrents,
  tipTorqueMilliNm,
} from '../src/field';
import { V } from '../src/geometry';

describe('magnetic field model', () => {
  it('produces a field close to the requested direction and magnitude', () => {
    const tip = [0, 0, 0] as const;
    for (const dir of [
      [0, 0, 1],
      [1, 0, 0],
      [0.3, -0.5, 0.8],
    ] as const) {
      const currents = solveCoilCurrents(tip, dir, 42);
      const b = fieldAt(tip, currents);
      expect(V.len(b)).toBeGreaterThan(30);
      expect(V.len(b)).toBeLessThan(55);
      const alignment = V.dot(V.normalize(b), V.normalize(dir));
      expect(alignment).toBeGreaterThan(0.75);
    }
  });

  it('keeps coil currents inside limits', () => {
    const currents = solveCoilCurrents([20, 10, -5], [0, 1, 0], 55);
    for (const current of currents) {
      expect(Math.abs(current)).toBeLessThanOrEqual(50.0001);
    }
  });

  it('reports a plausible gradient', () => {
    const tip = [10, 0, 0] as const;
    const currents = solveCoilCurrents(tip, [0, 0, 1], 42);
    const grad = gradientAlong(tip, [0, 0, 1], currents);
    expect(grad).toBeGreaterThan(0);
    expect(grad).toBeLessThan(4);
  });

  it('computes torque in mN·m', () => {
    const torque = tipTorqueMilliNm([0, 0, 1], [42, 0, 0]);
    expect(torque).toBeCloseTo(2.52, 2);
  });

  it('builds finite field line segments', () => {
    const lines = buildFieldLines([0, 0, 0], [0, 0, 1], { count: 4, steps: 8 });
    expect(lines.length).toBeGreaterThan(48);
    expect(lines.length % 6).toBe(0);
    for (const value of lines) expect(Number.isFinite(value)).toBe(true);
  });
});
