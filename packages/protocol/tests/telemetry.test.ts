import { describe, expect, it } from 'vitest';
import {
  decodeTelemetry,
  encodeTelemetry,
  peekHeader,
  cloneFrame,
  FRAME_BYTES,
  MAGIC,
  TYPE_TELEMETRY,
  WIRE_VERSION,
} from '../src/telemetry';
import type { TelemetryFrame } from '../src/types';

function sampleFrame(seq = 7): TelemetryFrame {
  const shape = new Float32Array(96 * 3);
  for (let i = 0; i < shape.length; i += 1) shape[i] = i * 0.25;
  const coils = new Float32Array(12);
  for (let i = 0; i < coils.length; i += 1) coils[i] = 30 - i;
  return {
    seq,
    ts: 1_730_000_000_123.5,
    tip: {
      t: [12.5, -3.25, 88.125],
      q: [0.1, 0.2, 0.3, 0.927],
      ts: 1_730_000_000_120,
    },
    shape,
    moment: [0.1, 0.2, 0.97],
    coils,
    field: { b: [41.2, 3.1, -8.4], grad: 0.83, torque: 1.23 },
    force: { axial: 0.12, lateral: 0.03 },
    flags: 0b10101,
    progress: 0.4267,
    segmentIndex: 2,
    speedMmS: 6.4,
  };
}

describe('binary telemetry codec', () => {
  it('round-trips every field', () => {
    const frame = sampleFrame();
    const buffer = encodeTelemetry(frame);
    expect(buffer.byteLength).toBe(FRAME_BYTES);
    const header = peekHeader(buffer);
    expect(header.magic).toBe(MAGIC);
    expect(header.version).toBe(WIRE_VERSION);
    expect(header.type).toBe(TYPE_TELEMETRY);
    expect(header.seq).toBe(7);
    expect(header.ts).toBe(frame.ts);
    expect(header.length).toBe(FRAME_BYTES - 20);

    const out = decodeTelemetry(buffer);
    expect(out.seq).toBe(7);
    expect(out.ts).toBe(frame.ts);
    expect(out.tip.t).toEqual(frame.tip.t);
    expect(out.tip.q[3]).toBeCloseTo(0.927, 5);
    expect(out.shape.length).toBe(288);
    expect(out.shape[287]).toBeCloseTo(frame.shape[287]!, 4);
    expect(out.coils[11]).toBeCloseTo(19, 5);
    expect(out.field.b[0]).toBeCloseTo(41.2, 4);
    expect(out.field.grad).toBeCloseTo(0.83, 5);
    expect(out.field.torque).toBeCloseTo(1.23, 4);
    expect(out.force.lateral).toBeCloseTo(0.03, 5);
    expect(out.flags).toBe(0b10101);
    expect(out.progress).toBeCloseTo(0.4267, 5);
    expect(out.segmentIndex).toBe(2);
    expect(out.speedMmS).toBeCloseTo(6.4, 4);
  });

  it('decodes zero-copy views', () => {
    const buffer = encodeTelemetry(sampleFrame());
    const out = decodeTelemetry(buffer);
    expect(out.shape.buffer).toBe(buffer);
    expect(out.coils.buffer).toBe(buffer);
  });

  it('clones frames safely', () => {
    const buffer = encodeTelemetry(sampleFrame());
    const out = decodeTelemetry(buffer);
    const copy = cloneFrame(out);
    expect(copy.shape).not.toBe(out.shape);
    expect(Array.from(copy.shape)).toEqual(Array.from(out.shape));
  });

  it('rejects malformed frames', () => {
    const buffer = new ArrayBuffer(FRAME_BYTES);
    new DataView(buffer).setUint16(0, 0x1234, true);
    expect(() => decodeTelemetry(buffer)).toThrow(/magic/);
  });

  it('rejects frame with wrong magic', () => {
    const buffer = encodeTelemetry(sampleFrame());
    new DataView(buffer).setUint8(2, 9);
    expect(() => decodeTelemetry(buffer)).toThrow(/version/);
  });
});
