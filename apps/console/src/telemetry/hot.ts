import { LIMITS, Q, V } from '@magnav/protocol';
import type { TelemetryFrame, Vec3 } from '@magnav/protocol';
import { serverNow } from '../services/clock';

const RING = 256;

type Listener = () => void;

/**
 * Hot telemetry lives outside React. 3D reads it from useFrame; numeric HUDs
 * subscribe through useSyncExternalStore at 10 Hz. Never put 120 Hz frames
 * into component state.
 */
class HotTelemetry {
  private frames: Array<TelemetryFrame | null> = new Array(RING).fill(null);
  private head = 0;
  private count = 0;
  private version = 0;
  private listeners = new Set<Listener>();
  private lastNotify = 0;

  latest: TelemetryFrame | null = null;
  latestArrivalAt = 0;
  maxSeq = -1;
  received = 0;
  dropped = 0;

  private interp: TelemetryFrame = {
    seq: 0,
    ts: 0,
    tip: { t: [0, 0, 0], q: [0, 0, 0, 1], ts: 0 },
    shape: new Float32Array(288),
    moment: [0, 0, 1],
    coils: new Float32Array(12),
    field: { b: [0, 0, 0], grad: 0, torque: 0 },
    force: { axial: 0, lateral: 0 },
    flags: 0,
    progress: 0,
    segmentIndex: 0,
    speedMmS: 0,
  };

  push(frame: TelemetryFrame): void {
    if (frame.seq <= this.maxSeq) {
      this.dropped += 1;
      return;
    }
    if (this.maxSeq >= 0 && frame.seq > this.maxSeq + 12) {
      // stream discontinuity — drop the stale ring
      this.frames.fill(null);
      this.head = 0;
      this.count = 0;
    }
    this.maxSeq = frame.seq;
    this.frames[this.head] = frame;
    this.head = (this.head + 1) % RING;
    this.count = Math.min(RING, this.count + 1);
    this.latest = frame;
    this.latestArrivalAt = performance.now();
    this.received += 1;
    this.version += 1;
    const now = performance.now();
    if (now - this.lastNotify >= 100) {
      this.lastNotify = now;
      for (const listener of this.listeners) listener();
    }
  }

  reset(): void {
    this.frames.fill(null);
    this.head = 0;
    this.count = 0;
    this.latest = null;
    this.maxSeq = -1;
    this.received = 0;
    this.dropped = 0;
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** Age of the latest sample in ms (sensor timestamp → now). */
  ageMs(): number {
    if (!this.latest) return Number.POSITIVE_INFINITY;
    return Math.max(0, serverNow() - this.latest.ts);
  }

  isStale(): boolean {
    return this.ageMs() > LIMITS.stalePoseMs;
  }

  private frameAt(offsetFromNewest: number): TelemetryFrame | null {
    if (offsetFromNewest < 0 || offsetFromNewest >= this.count) return null;
    const index = (this.head - 1 - offsetFromNewest + RING * 2) % RING;
    return this.frames[index] ?? null;
  }

  /**
   * Interpolated frame at server time `t` (usually now - 40 ms).
   * Returns null when the stream is stale; the scene must freeze, not extrapolate.
   */
  sampleAt(t: number = serverNow() - LIMITS.renderDelayMs): TelemetryFrame | null {
    const latest = this.latest;
    if (!latest) return null;
    if (this.ageMs() > LIMITS.stalePoseMs) return null;
    const target = Math.min(t, latest.ts);

    let newer: TelemetryFrame | null = null;
    let older: TelemetryFrame | null = null;
    for (let k = 0; k < this.count; k += 1) {
      const frame = this.frameAt(k);
      if (!frame) continue;
      if (frame.ts >= target) {
        newer = frame;
      } else {
        older = frame;
        break;
      }
    }
    if (!newer) return latest;
    if (!older) return newer;

    const span = newer.ts - older.ts;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (target - older.ts) / span)) : 1;
    return this.interpolate(older, newer, alpha);
  }

  private interpolate(a: TelemetryFrame, b: TelemetryFrame, alpha: number): TelemetryFrame {
    const out = this.interp;
    out.seq = b.seq;
    out.ts = b.ts;
    out.tip = {
      t: V.lerp(a.tip.t, b.tip.t, alpha),
      q: Q.slerp(a.tip.q, b.tip.q, alpha),
      ts: b.tip.ts,
    };
    const n = Math.min(a.shape.length, b.shape.length, out.shape.length);
    for (let i = 0; i < n; i += 1) {
      out.shape[i] = a.shape[i]! + (b.shape[i]! - a.shape[i]!) * alpha;
    }
    out.moment = V.normalize([
      a.moment[0] + (b.moment[0] - a.moment[0]) * alpha,
      a.moment[1] + (b.moment[1] - a.moment[1]) * alpha,
      a.moment[2] + (b.moment[2] - a.moment[2]) * alpha,
    ]) as Vec3;
    const coils = Math.min(a.coils.length, b.coils.length, out.coils.length);
    for (let i = 0; i < coils; i += 1) {
      out.coils[i] = a.coils[i]! + (b.coils[i]! - a.coils[i]!) * alpha;
    }
    out.field = {
      b: V.lerp(a.field.b, b.field.b, alpha) as Vec3,
      grad: a.field.grad + (b.field.grad - a.field.grad) * alpha,
      torque: a.field.torque + (b.field.torque - a.field.torque) * alpha,
    };
    out.force = {
      axial: a.force.axial + (b.force.axial - a.force.axial) * alpha,
      lateral: a.force.lateral + (b.force.lateral - a.force.lateral) * alpha,
    };
    out.flags = b.flags;
    out.progress = a.progress + (b.progress - a.progress) * alpha;
    out.segmentIndex = b.segmentIndex;
    out.speedMmS = b.speedMmS;
    return out;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;
}

export const hot = new HotTelemetry();
