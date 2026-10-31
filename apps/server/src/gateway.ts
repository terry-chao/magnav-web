import type { Plan, ProcedurePhase, ReviewFrame, TelemetryFrame } from '@magnav/protocol';
import { RobotEngine, type InjectedFaults, type SimEffect, type SimMode } from './simulator';

/**
 * Realtime-layer boundary.
 *
 * The console service talks to a gateway, never to the simulator directly.
 * The default implementation is `RobotEngine`; a hardware-in-the-loop adapter
 * implements the same interface and consumes frames from the realtime layer.
 *
 * External adapter contract:
 *   - `start/resume/hold/abort` translate high-level intents into the realtime
 *     layer's command channel; they never send coil currents.
 *   - `step(dt)` advances/refreshes local state only (or no-ops for push-based
 *     transports).
 *   - `frame(ts)` returns the latest confirmed telemetry frame, never an
 *     extrapolated position.
 *   - `effects` carries state-machine effects (arrived, segment, alarm) that the
 *     service applies authoritatively.
 */
export interface RobotGateway {
  readonly kind: 'simulated' | 'external';
  readonly plan: Plan;
  readonly progress: number;
  readonly segmentIndex: number;
  readonly totalMm: number;
  sMm: number;
  mode: SimMode;
  injection: InjectedFaults;
  effects: SimEffect[];
  /** simulation-only: enables demo advisory alarms */
  demoAlarms?: boolean;
  start(): void;
  resume(): void;
  hold(): void;
  abort(): void;
  step(dtSeconds: number): void;
  frame(ts?: number): TelemetryFrame;
  reviewFrame(phase: ProcedurePhase, ts?: number): ReviewFrame;
}

export type GatewayFactory = (plan: Plan) => RobotGateway;

/** Default gateway used by the web demo and the test suite. */
export const createSimulatedGateway: GatewayFactory = (plan) => new RobotEngine(plan);

/**
 * Selects the gateway implementation. External mode is intentionally explicit:
 * it fails fast instead of silently pretending to talk to hardware.
 */
export function createGatewayFactory(
  env: NodeJS.ProcessEnv = process.env,
): GatewayFactory {
  const mode = env.MAGNAV_GATEWAY ?? 'simulated';
  if (mode === 'simulated') return createSimulatedGateway;
  if (mode === 'external') {
    return () => {
      throw new Error(
        'MAGNAV_GATEWAY=external：请实现 RobotGateway 并在此返回外部实时层适配器（见 docs/INTEGRATION.md）',
      );
    };
  }
  throw new Error(`未知 MAGNAV_GATEWAY: ${mode}`);
}
