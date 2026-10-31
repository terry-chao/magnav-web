import { assign, setup } from 'xstate';
import type { PrecheckItem, ProcedurePhase } from './types';

/**
 * Authoritative procedure state machine (shared definition).
 *
 * The server runs the only live instance; the console may instantiate the
 * same machine for local dry-runs/tests but never treats it as truth.
 * Every illegal transition is a no-op and must be rejected *before* the
 * event is sent — guards here are the second line of defence.
 */

export interface ProcedureMachineContext {
  treMm: number;
  treMaxMm: number;
  precheck: PrecheckItem[];
  planApproved: boolean;
  feasibilityPassed: boolean;
  armedBy?: string;
  countersignedBy?: string;
  estopLatched: boolean;
  pauseReason?: string;
  abortReason?: string;
  targetReached: boolean;
}

export interface ProcedureInput {
  treMm?: number;
  treMaxMm?: number;
  planApproved?: boolean;
  feasibilityPassed?: boolean;
}

export type ProcedureEvent =
  | { type: 'LOAD_CASE' }
  | { type: 'IMAGES_READY' }
  | { type: 'PLAN_CONFIRMED' }
  | { type: 'REGISTERED' }
  | { type: 'PRECHECK_UPDATED'; items: PrecheckItem[] }
  | { type: 'SET_TRE'; treMm: number }
  | { type: 'SET_PLAN'; approved: boolean; feasible: boolean }
  | { type: 'SET_COUNTERSIGN'; armedBy: string; countersignedBy: string }
  | { type: 'PRECHECK_PASSED' }
  | { type: 'START_AUTO' }
  | { type: 'DISARM' }
  | { type: 'PAUSE'; reason?: string }
  | { type: 'RESUME' }
  | { type: 'TAKEOVER' }
  | { type: 'FAULT'; reason?: string }
  | { type: 'TARGET_REACHED' }
  | { type: 'ABORT'; reason?: string }
  | { type: 'ABORT_DONE' }
  | { type: 'ESTOP' }
  | { type: 'RESET_ESTOP' };

export function createProcedureContext(input: ProcedureInput = {}): ProcedureMachineContext {
  return {
    treMm: input.treMm ?? Number.POSITIVE_INFINITY,
    treMaxMm: input.treMaxMm ?? 1.5,
    precheck: [],
    planApproved: input.planApproved ?? false,
    feasibilityPassed: input.feasibilityPassed ?? false,
    estopLatched: false,
    targetReached: false,
  };
}

const treOk = ({ context }: { context: ProcedureMachineContext }) =>
  Number.isFinite(context.treMm) && context.treMm <= context.treMaxMm;

const precheckOk = ({ context }: { context: ProcedureMachineContext }) =>
  context.precheck.length > 0 && context.precheck.every((item) => item.passed);

const armReady = ({ context }: { context: ProcedureMachineContext }) =>
  treOk({ context }) &&
  precheckOk({ context }) &&
  context.planApproved &&
  context.feasibilityPassed &&
  Boolean(context.armedBy) &&
  Boolean(context.countersignedBy) &&
  !context.estopLatched;

const estopClear = ({ context }: { context: ProcedureMachineContext }) => !context.estopLatched;

const planApproved = ({ context }: { context: ProcedureMachineContext }) => context.planApproved;

export const procedureMachine = setup({
  types: {
    context: {} as ProcedureMachineContext,
    events: {} as ProcedureEvent,
    input: {} as ProcedureInput,
  },
  guards: {
    treOk,
    precheckOk,
    armReady,
    estopClear,
    planApproved,
  },
  actions: {
    latchEstop: assign({ estopLatched: true }),
    clearEstop: assign({ estopLatched: false }),
    clearPause: assign({ pauseReason: undefined }),
    setTre: assign({
      treMm: ({ event }) => (event.type === 'SET_TRE' ? event.treMm : Number.POSITIVE_INFINITY),
    }),
    setPrecheck: assign({
      precheck: ({ event }) => (event.type === 'PRECHECK_UPDATED' ? event.items : []),
    }),
    setPlan: assign({
      planApproved: ({ event }) => (event.type === 'SET_PLAN' ? event.approved : false),
      feasibilityPassed: ({ event }) => (event.type === 'SET_PLAN' ? event.feasible : false),
    }),
    setCountersign: assign({
      armedBy: ({ event }) => (event.type === 'SET_COUNTERSIGN' ? event.armedBy : undefined),
      countersignedBy: ({ event }) =>
        event.type === 'SET_COUNTERSIGN' ? event.countersignedBy : undefined,
    }),
  },
}).createMachine({
  id: 'procedure',
  initial: 'IDLE',
  context: ({ input }) => createProcedureContext(input),
  // Data-only events are available in every state.
  on: {
    SET_TRE: { actions: 'setTre' },
    PRECHECK_UPDATED: { actions: 'setPrecheck' },
    SET_PLAN: { actions: 'setPlan' },
    SET_COUNTERSIGN: { actions: 'setCountersign' },
  },
  states: {
    IDLE: { on: { LOAD_CASE: 'CASE_READY' } },
    CASE_READY: { on: { IMAGES_READY: 'SEGMENTED' } },
    SEGMENTED: {
      on: {
        PLAN_CONFIRMED: { target: 'PLAN_READY', guard: 'planApproved' },
      },
    },
    PLAN_READY: {
      on: {
        REGISTERED: { target: 'REGISTERED', guard: 'treOk' },
      },
    },
    REGISTERED: {
      on: {
        PRECHECK_PASSED: { target: 'ARMED', guard: 'armReady' },
      },
    },
    ARMED: {
      on: {
        START_AUTO: { target: 'AUTO_RUNNING', guard: 'estopClear' },
        DISARM: 'REGISTERED',
        ABORT: {
          target: 'ABORTING',
          actions: assign({ abortReason: ({ event }) => event.reason }),
        },
        ESTOP: { actions: 'latchEstop' },
        RESET_ESTOP: { actions: 'clearEstop' },
      },
    },
    AUTO_RUNNING: {
      on: {
        PAUSE: {
          target: 'AUTO_PAUSED',
          actions: assign({ pauseReason: ({ event }) => event.reason ?? '术者暂停' }),
        },
        FAULT: {
          target: 'AUTO_PAUSED',
          actions: assign({ pauseReason: ({ event }) => event.reason ?? '自动流程故障' }),
        },
        TAKEOVER: 'MANUAL',
        TARGET_REACHED: {
          target: 'COMPLETED',
          actions: assign({ targetReached: true }),
        },
        ABORT: {
          target: 'ABORTING',
          actions: assign({ abortReason: ({ event }) => event.reason }),
        },
        ESTOP: {
          target: 'AUTO_PAUSED',
          actions: ['latchEstop', assign({ pauseReason: '软件急停触发' })],
        },
      },
    },
    AUTO_PAUSED: {
      on: {
        RESUME: { target: 'AUTO_RUNNING', guard: 'estopClear', actions: 'clearPause' },
        TAKEOVER: 'MANUAL',
        ABORT: {
          target: 'ABORTING',
          actions: assign({ abortReason: ({ event }) => event.reason }),
        },
        ESTOP: { actions: 'latchEstop' },
        RESET_ESTOP: { actions: 'clearEstop' },
      },
    },
    MANUAL: {
      on: {
        PRECHECK_PASSED: { target: 'ARMED', guard: 'armReady' },
        ABORT: {
          target: 'ABORTING',
          actions: assign({ abortReason: ({ event }) => event.reason }),
        },
        ESTOP: { actions: 'latchEstop' },
        RESET_ESTOP: { actions: 'clearEstop' },
      },
    },
    ABORTING: {
      on: {
        ABORT_DONE: 'ABORTED',
      },
    },
    ABORTED: { type: 'final' },
    COMPLETED: { type: 'final' },
  },
});

/** A compile-time-safe helper for code that only needs the phase value. */
export function phaseOf(snapshotValue: unknown): ProcedurePhase {
  return typeof snapshotValue === 'string' ? (snapshotValue as ProcedurePhase) : 'IDLE';
}
