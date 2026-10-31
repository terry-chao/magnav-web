import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { procedureMachine } from '../src/machine';
import type { PrecheckItem, ProcedurePhase } from '../src/types';

const okItems: PrecheckItem[] = [
  { id: 'tre', label: '配准', detail: '', passed: true, severity: 'required' },
  { id: 'coil', label: '线圈', detail: '', passed: true, severity: 'required' },
];

const baseInput = { treMm: 0.8, planApproved: true, feasibilityPassed: true };

function newActor(input = baseInput) {
  const actor = createActor(procedureMachine, { input });
  actor.start();
  return actor;
}

function phase(actor: ReturnType<typeof newActor>): ProcedurePhase {
  return actor.getSnapshot().value as ProcedurePhase;
}

function reachArmed(actor: ReturnType<typeof newActor>) {
  actor.send({ type: 'LOAD_CASE' });
  actor.send({ type: 'IMAGES_READY' });
  actor.send({ type: 'PLAN_CONFIRMED' });
  actor.send({ type: 'REGISTERED' });
  actor.send({ type: 'PRECHECK_UPDATED', items: okItems });
  actor.send({ type: 'SET_COUNTERSIGN', armedBy: 'u-surgeon', countersignedBy: 'u-assistant' });
  actor.send({ type: 'PRECHECK_PASSED' });
}

describe('procedure state machine', () => {
  it('starts IDLE and walks the readiness gate', () => {
    const actor = newActor();
    expect(phase(actor)).toBe('IDLE');
    actor.send({ type: 'LOAD_CASE' });
    expect(phase(actor)).toBe('CASE_READY');
    actor.send({ type: 'IMAGES_READY' });
    expect(phase(actor)).toBe('SEGMENTED');
    actor.send({ type: 'PLAN_CONFIRMED' });
    expect(phase(actor)).toBe('PLAN_READY');
    actor.send({ type: 'REGISTERED' });
    expect(phase(actor)).toBe('REGISTERED');
    reachArmed(actor);
    expect(phase(actor)).toBe('ARMED');
  });

  it('refuses to arm without a countersignature', () => {
    const actor = newActor();
    actor.send({ type: 'LOAD_CASE' });
    actor.send({ type: 'IMAGES_READY' });
    actor.send({ type: 'PLAN_CONFIRMED' });
    actor.send({ type: 'REGISTERED' });
    actor.send({ type: 'PRECHECK_UPDATED', items: okItems });
    actor.send({ type: 'PRECHECK_PASSED' });
    expect(phase(actor)).toBe('REGISTERED');
  });

  it('refuses registration when TRE exceeds the limit', () => {
    const actor = newActor({ ...baseInput, treMm: 2.4 });
    actor.send({ type: 'LOAD_CASE' });
    actor.send({ type: 'IMAGES_READY' });
    actor.send({ type: 'PLAN_CONFIRMED' });
    actor.send({ type: 'REGISTERED' });
    expect(phase(actor)).toBe('PLAN_READY');
  });

  it('rejects commands that are illegal in the current phase', () => {
    const actor = newActor();
    actor.send({ type: 'START_AUTO' });
    expect(phase(actor)).toBe('IDLE');
    actor.send({ type: 'LOAD_CASE' });
    actor.send({ type: 'IMAGES_READY' });
    actor.send({ type: 'REGISTERED' });
    expect(phase(actor)).toBe('SEGMENTED');
  });

  it('runs, pauses, resumes and completes', () => {
    const actor = newActor();
    reachArmed(actor);
    actor.send({ type: 'START_AUTO' });
    expect(phase(actor)).toBe('AUTO_RUNNING');
    actor.send({ type: 'PAUSE', reason: '测试暂停' });
    expect(phase(actor)).toBe('AUTO_PAUSED');
    expect(actor.getSnapshot().context.pauseReason).toBe('测试暂停');
    actor.send({ type: 'RESUME' });
    expect(phase(actor)).toBe('AUTO_RUNNING');
    actor.send({ type: 'TARGET_REACHED' });
    expect(phase(actor)).toBe('COMPLETED');
  });

  it('latches e-stop and blocks resume until reset', () => {
    const actor = newActor();
    reachArmed(actor);
    actor.send({ type: 'START_AUTO' });
    actor.send({ type: 'ESTOP' });
    expect(phase(actor)).toBe('AUTO_PAUSED');
    expect(actor.getSnapshot().context.estopLatched).toBe(true);
    actor.send({ type: 'RESUME' });
    expect(phase(actor)).toBe('AUTO_PAUSED');
    actor.send({ type: 'RESET_ESTOP' });
    expect(actor.getSnapshot().context.estopLatched).toBe(false);
    actor.send({ type: 'RESUME' });
    expect(phase(actor)).toBe('AUTO_RUNNING');
  });

  it('supports manual takeover and re-arming', () => {
    const actor = newActor();
    reachArmed(actor);
    actor.send({ type: 'START_AUTO' });
    actor.send({ type: 'TAKEOVER' });
    expect(phase(actor)).toBe('MANUAL');
    actor.send({ type: 'PRECHECK_PASSED' });
    expect(phase(actor)).toBe('ARMED');
  });

  it('aborts and finishes in ABORTED', () => {
    const actor = newActor();
    reachArmed(actor);
    actor.send({ type: 'START_AUTO' });
    actor.send({ type: 'ABORT', reason: '测试中止' });
    expect(phase(actor)).toBe('ABORTING');
    actor.send({ type: 'ABORT_DONE' });
    expect(phase(actor)).toBe('ABORTED');
    expect(actor.getSnapshot().status).toBe('done');
  });

  it('does not confirm a plan that was never approved', () => {
    const actor = newActor({ ...baseInput, planApproved: false });
    actor.send({ type: 'LOAD_CASE' });
    actor.send({ type: 'IMAGES_READY' });
    actor.send({ type: 'PLAN_CONFIRMED' });
    expect(phase(actor)).toBe('SEGMENTED');
  });
});
