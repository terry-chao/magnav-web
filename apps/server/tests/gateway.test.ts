import { describe, expect, it } from 'vitest';
import { buildSeedData } from '../src/seed';
import { createGatewayFactory, createSimulatedGateway } from '../src/gateway';
import type { Plan } from '@magnav/protocol';

const plan: Plan = buildSeedData().plans.get('plan-1031-lad')!;

describe('robot gateway factory', () => {
  it('defaults to the simulated gateway', () => {
    const factory = createGatewayFactory({} as NodeJS.ProcessEnv);
    const gateway = factory(plan);
    expect(gateway.kind).toBe('simulated');
    expect(gateway.totalMm).toBeCloseTo(plan.totalLengthMm, 1);
    expect(gateway.progress).toBe(0);
    expect(gateway.mode).toBe('HOLD');
  });

  it('creates a fresh gateway per session', () => {
    const gatewayA = createSimulatedGateway(plan);
    const gatewayB = createSimulatedGateway(plan);
    expect(gatewayA).not.toBe(gatewayB);
    expect(gatewayA.plan.id).toBe(plan.id);
  });

  it('fails fast for an unknown gateway mode', () => {
    expect(() =>
      createGatewayFactory({ MAGNAV_GATEWAY: 'unknown' } as NodeJS.ProcessEnv),
    ).toThrow(/未知 MAGNAV_GATEWAY/);
  });

  it('fails fast when external mode has no adapter', () => {
    const factory = createGatewayFactory({ MAGNAV_GATEWAY: 'external' } as NodeJS.ProcessEnv);
    expect(() => factory(plan)).toThrow(/external/);
  });
});
