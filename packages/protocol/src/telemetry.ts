import { TELEMETRY } from './constants';
import type { TelemetryFrame, Vec3 } from './types';

/**
 * Binary telemetry frame (little endian)
 *
 *  header 20 B : magic u16 | version u8 | type u8 | seq u32 | ts f64 | len u32
 *  payload     : tip t 3f | tip q 4f | tipTs f64 | shapeCount u16 | pad u16 |
 *                shape 96×3 f | moment 3f | coilCount u8 | pad 3 |
 *                coils 12f | b 3f | grad f | torque f | axial f | lateral f |
 *                flags u32 | progress f | segment u16 | pad u16 | speed f
 *
 * The decoder returns typed-array views over the received buffer (zero copy);
 * the decoding worker transfers the whole buffer to the main thread.
 */

export const MAGIC = 0x4d47; // 'MG'
export const WIRE_VERSION = 1;
export const TYPE_TELEMETRY = 1;
export const HEADER_BYTES = 20;

const P_TIP_T = 0;
const P_TIP_Q = 12;
const P_TIP_TS = 28;
const P_SHAPE_COUNT = 36;
const P_SHAPE = 40;
const P_MOMENT = P_SHAPE + TELEMETRY.shapePoints * 3 * 4;
const P_COIL_COUNT = P_MOMENT + 12;
const P_COILS = P_COIL_COUNT + 4;
const P_B = P_COILS + TELEMETRY.coilCount * 4;
const P_GRAD = P_B + 12;
const P_TORQUE = P_GRAD + 4;
const P_AXIAL = P_TORQUE + 4;
const P_LATERAL = P_AXIAL + 4;
const P_FLAGS = P_LATERAL + 4;
const P_PROGRESS = P_FLAGS + 4;
const P_SEGMENT = P_PROGRESS + 4;
const P_SPEED = P_SEGMENT + 4;
export const PAYLOAD_BYTES = P_SPEED + 4;
export const FRAME_BYTES = HEADER_BYTES + PAYLOAD_BYTES;

export interface FrameHeader {
  magic: number;
  version: number;
  type: number;
  seq: number;
  ts: number;
  length: number;
}

export function peekHeader(buffer: ArrayBuffer): FrameHeader {
  const dv = new DataView(buffer);
  return {
    magic: dv.getUint16(0, true),
    version: dv.getUint8(2),
    type: dv.getUint8(3),
    seq: dv.getUint32(4, true),
    ts: dv.getFloat64(8, true),
    length: dv.getUint32(16, true),
  };
}

export function encodeTelemetry(frame: TelemetryFrame): ArrayBuffer {
  const buffer = new ArrayBuffer(FRAME_BYTES);
  const dv = new DataView(buffer);
  dv.setUint16(0, MAGIC, true);
  dv.setUint8(2, WIRE_VERSION);
  dv.setUint8(3, TYPE_TELEMETRY);
  dv.setUint32(4, frame.seq >>> 0, true);
  dv.setFloat64(8, frame.ts, true);
  dv.setUint32(16, PAYLOAD_BYTES, true);

  const base = HEADER_BYTES;
  // tip translation + rotation
  dv.setFloat32(base + P_TIP_T, frame.tip.t[0], true);
  dv.setFloat32(base + P_TIP_T + 4, frame.tip.t[1], true);
  dv.setFloat32(base + P_TIP_T + 8, frame.tip.t[2], true);
  for (let i = 0; i < 4; i += 1) {
    dv.setFloat32(base + P_TIP_Q + i * 4, frame.tip.q[i]!, true);
  }
  dv.setFloat64(base + P_TIP_TS, frame.tip.ts, true);

  const points = Math.min(TELEMETRY.shapePoints, Math.floor(frame.shape.length / 3));
  dv.setUint16(base + P_SHAPE_COUNT, points, true);
  dv.setUint16(base + P_SHAPE_COUNT + 2, 0, true);
  for (let i = 0; i < points * 3; i += 1) {
    dv.setFloat32(base + P_SHAPE + i * 4, frame.shape[i]!, true);
  }
  for (let i = 0; i < 3; i += 1) {
    dv.setFloat32(base + P_MOMENT + i * 4, frame.moment[i]!, true);
  }
  const coils = Math.min(TELEMETRY.coilCount, frame.coils.length);
  dv.setUint8(base + P_COIL_COUNT, coils);
  for (let i = 0; i < coils; i += 1) {
    dv.setFloat32(base + P_COILS + i * 4, frame.coils[i]!, true);
  }
  for (let i = 0; i < 3; i += 1) {
    dv.setFloat32(base + P_B + i * 4, frame.field.b[i]!, true);
  }
  dv.setFloat32(base + P_GRAD, frame.field.grad, true);
  dv.setFloat32(base + P_TORQUE, frame.field.torque, true);
  dv.setFloat32(base + P_AXIAL, frame.force.axial, true);
  dv.setFloat32(base + P_LATERAL, frame.force.lateral, true);
  dv.setUint32(base + P_FLAGS, frame.flags >>> 0, true);
  dv.setFloat32(base + P_PROGRESS, frame.progress, true);
  dv.setUint16(base + P_SEGMENT, frame.segmentIndex, true);
  dv.setUint16(base + P_SEGMENT + 2, 0, true);
  dv.setFloat32(base + P_SPEED, frame.speedMmS, true);
  return buffer;
}

export function decodeTelemetry(buffer: ArrayBuffer): TelemetryFrame {
  if (buffer.byteLength < HEADER_BYTES + 40) {
    throw new Error(`telemetry frame too short: ${buffer.byteLength}`);
  }
  const dv = new DataView(buffer);
  if (dv.getUint16(0, true) !== MAGIC) throw new Error('telemetry bad magic');
  if (dv.getUint8(2) !== WIRE_VERSION) throw new Error('telemetry version mismatch');
  if (dv.getUint8(3) !== TYPE_TELEMETRY) throw new Error('not a telemetry frame');
  const seq = dv.getUint32(4, true);
  const ts = dv.getFloat64(8, true);
  const base = HEADER_BYTES;
  const count = Math.min(TELEMETRY.shapePoints, dv.getUint16(base + P_SHAPE_COUNT, true));

  const shape = new Float32Array(buffer, base + P_SHAPE, count * 3);
  const coilCount = Math.min(TELEMETRY.coilCount, dv.getUint8(base + P_COIL_COUNT));
  const coils = new Float32Array(buffer, base + P_COILS, coilCount);

  const tipT: Vec3 = [
    dv.getFloat32(base + P_TIP_T, true),
    dv.getFloat32(base + P_TIP_T + 4, true),
    dv.getFloat32(base + P_TIP_T + 8, true),
  ];
  const tipQ = [
    dv.getFloat32(base + P_TIP_Q, true),
    dv.getFloat32(base + P_TIP_Q + 4, true),
    dv.getFloat32(base + P_TIP_Q + 8, true),
    dv.getFloat32(base + P_TIP_Q + 12, true),
  ] as const;

  return {
    seq,
    ts,
    tip: { t: tipT, q: tipQ, ts: dv.getFloat64(base + P_TIP_TS, true) },
    shape,
    moment: [
      dv.getFloat32(base + P_MOMENT, true),
      dv.getFloat32(base + P_MOMENT + 4, true),
      dv.getFloat32(base + P_MOMENT + 8, true),
    ],
    coils,
    field: {
      b: [
        dv.getFloat32(base + P_B, true),
        dv.getFloat32(base + P_B + 4, true),
        dv.getFloat32(base + P_B + 8, true),
      ],
      grad: dv.getFloat32(base + P_GRAD, true),
      torque: dv.getFloat32(base + P_TORQUE, true),
    },
    force: {
      axial: dv.getFloat32(base + P_AXIAL, true),
      lateral: dv.getFloat32(base + P_LATERAL, true),
    },
    flags: dv.getUint32(base + P_FLAGS, true),
    progress: dv.getFloat32(base + P_PROGRESS, true),
    segmentIndex: dv.getUint16(base + P_SEGMENT, true),
    speedMmS: dv.getFloat32(base + P_SPEED, true),
  };
}

/** Copy a decoded frame so it can outlive the receive buffer (used in tests/replay). */
export function cloneFrame(frame: TelemetryFrame): TelemetryFrame {
  return {
    ...frame,
    tip: { t: [...frame.tip.t] as Vec3, q: [...frame.tip.q] as typeof frame.tip.q, ts: frame.tip.ts },
    shape: frame.shape.slice(),
    coils: frame.coils.slice(),
    moment: [...frame.moment] as Vec3,
    field: { ...frame.field, b: [...frame.field.b] as Vec3 },
    force: { ...frame.force },
  };
}
