import { create } from 'zustand';
import type {
  CaseRecord,
  DeviceSnapshot,
  PrecheckReport,
  ServerEvent,
  SessionSnapshot,
  User,
} from '@magnav/protocol';
import { LIMITS } from '@magnav/protocol';
import { hot } from '../telemetry/hot';
import { setCsrfToken } from '../services/http';
import { playAlarm } from '../services/audio';

export type ConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface Toast {
  id: string;
  tone: 'info' | 'success' | 'warn' | 'danger';
  title: string;
  message?: string;
}

export interface SessionStore {
  boot: 'loading' | 'ready' | 'anon';
  user: User | null;
  csrf: string | null;
  snapshot: SessionSnapshot | null;
  sessionId: string | null;
  connection: ConnectionState;
  latencyMs: number;
  events: ServerEvent[];
  toasts: Toast[];
  authError: string | null;
  setBoot: (boot: SessionStore['boot']) => void;
  setAuth: (user: User, csrf: string) => void;
  setAuthError: (message: string | null) => void;
  logout: () => void;
  setSnapshot: (snapshot: SessionSnapshot | null) => void;
  applyEvent: (event: ServerEvent) => void;
  setConnection: (state: ConnectionState) => void;
  setLatency: (ms: number) => void;
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  clearSession: () => void;
}

function updateSnapshot(
  snapshot: SessionSnapshot | null,
  patch: Partial<SessionSnapshot>,
): SessionSnapshot | null {
  return snapshot ? { ...snapshot, ...patch } : snapshot;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  boot: 'loading',
  user: null,
  csrf: null,
  snapshot: null,
  sessionId: null,
  connection: 'idle',
  latencyMs: 0,
  events: [],
  toasts: [],
  authError: null,

  setBoot: (boot) => set({ boot }),

  setAuth: (user, csrf) => {
    setCsrfToken(csrf);
    set({ user, csrf, boot: 'ready', authError: null });
  },

  setAuthError: (authError) => set({ authError }),

  logout: () => {
    setCsrfToken(null);
    hot.reset();
    set({
      user: null,
      csrf: null,
      snapshot: null,
      sessionId: null,
      connection: 'idle',
      boot: 'anon',
      events: [],
      toasts: [],
    });
  },

  setSnapshot: (snapshot) => {
    const prev = get().snapshot;
    if (prev?.sessionId && prev.sessionId !== snapshot?.sessionId) {
      hot.reset();
    }
    set({
      snapshot,
      sessionId: snapshot?.sessionId ?? null,
      events: snapshot?.events ?? [],
    });
  },

  applyEvent: (event) => {
    const state = get();
    const snapshot = state.snapshot;
    const events = [...state.events, event].slice(-200);
    let nextSnapshot = snapshot;

    if (snapshot) {
      switch (event.kind) {
        case 'phase':
          nextSnapshot = {
            ...snapshot,
            previousPhase: event.previous,
            phase: event.phase,
            phaseChangedAt: event.ts,
            context: {
              ...snapshot.context,
              pauseReason:
                event.phase === 'AUTO_PAUSED'
                  ? event.reason
                  : event.phase === 'AUTO_RUNNING'
                    ? undefined
                    : snapshot.context.pauseReason,
              abortReason: event.phase === 'ABORTING' ? event.reason : snapshot.context.abortReason,
            },
          };
          break;
        case 'alarm':
          if (!snapshot.alarms.some((a) => a.id === event.alarm.id)) {
            nextSnapshot = { ...snapshot, alarms: [...snapshot.alarms, event.alarm].slice(-40) };
            if (event.alarm.severity === 'high' || event.alarm.severity === 'medium') {
              playAlarm(event.alarm.severity);
              get().pushToast({
                tone: event.alarm.severity === 'high' ? 'danger' : 'warn',
                title: event.alarm.title,
                message: event.alarm.detail,
              });
            }
          }
          break;
        case 'alarm_update':
          nextSnapshot = {
            ...snapshot,
            alarms: snapshot.alarms.map((a) =>
              a.id === event.alarmId ? { ...a, ...event.patch } : a,
            ),
          };
          break;
        case 'precheck':
          nextSnapshot = { ...snapshot, precheck: event.report };
          break;
        case 'device':
          nextSnapshot = { ...snapshot, devices: event.devices };
          break;
        case 'deadman':
          nextSnapshot = { ...snapshot, deadman: event.deadman };
          break;
        case 'notice':
          get().pushToast({
            tone: event.tone === 'warn' ? 'warn' : event.tone === 'danger' ? 'danger' : 'info',
            title: event.message,
          });
          break;
        case 'ended':
          nextSnapshot = {
            ...snapshot,
            endedAt: event.ts,
          };
          break;
        default:
          break;
      }
    }
    set({ events, snapshot: nextSnapshot });
  },

  setConnection: (connection) => set({ connection }),
  setLatency: (latencyMs) => set({ latencyMs }),

  pushToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set({ toasts: [...get().toasts, { ...toast, id }].slice(-5) });
    window.setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, 5200);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  clearSession: () => {
    hot.reset();
    set({ snapshot: null, sessionId: null, events: [] });
  },
}));

export function selectPhase() {
  return useSessionStore((s) => s.snapshot?.phase ?? null);
}

export function selectAlarms() {
  return useSessionStore((s) => s.snapshot?.alarms ?? []);
}

export function selectCase(): CaseRecord | null {
  return useSessionStore((s) => s.snapshot?.case ?? null);
}

export function selectDevices(): DeviceSnapshot | null {
  return useSessionStore((s) => s.snapshot?.devices ?? null);
}

export function selectPrecheck(): PrecheckReport | null {
  return useSessionStore((s) => s.snapshot?.precheck ?? null);
}

export const ACTIVE_ALARM_FILTER = (alarm: { acknowledged: boolean; clearedAt?: number }) =>
  !alarm.acknowledged && !alarm.clearedAt;

export function stalePose(): boolean {
  return hot.isStale();
}

export { LIMITS };
