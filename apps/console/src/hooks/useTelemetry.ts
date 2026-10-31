import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LIMITS } from '@magnav/protocol';
import type { TelemetryFrame } from '@magnav/protocol';
import { hot } from '../telemetry/hot';
import { serverNow } from '../services/clock';
import { realtime } from '../services/realtime';
import { useSessionStore } from '../store/session';
import type { CommandAck, CommandType } from '@magnav/protocol';

export function useHotVersion(): number {
  return useSyncExternalStore(hot.subscribe, hot.getVersion, hot.getVersion);
}

export function useHotFrame(): TelemetryFrame | null {
  useHotVersion();
  return hot.latest;
}

export function useDataAge(): { ageMs: number; stale: boolean } {
  useHotVersion();
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), 200);
    return () => window.clearInterval(timer);
  }, []);
  if (!hot.latest) return { ageMs: Number.POSITIVE_INFINITY, stale: true };
  const ageMs = Math.max(0, now - hot.latest.ts);
  return { ageMs, stale: ageMs > LIMITS.stalePoseMs };
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useRunCommand() {
  const [pending, setPending] = useState<CommandType | null>(null);
  const pushToast = useSessionStore((s) => s.pushToast);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const run = useCallback(
    async (type: CommandType, params: Record<string, unknown> = {}): Promise<CommandAck | null> => {
      setPending(type);
      try {
        const ack = await realtime.sendCommand(type, params);
        if (!ack.ok) {
          pushToast({
            tone: 'danger',
            title: `${ack.code} · ${ack.message}`,
            message: typeof ack.detail?.detail === 'string' ? ack.detail.detail : undefined,
          });
        }
        return ack;
      } catch (error) {
        if (mounted.current) {
          pushToast({
            tone: 'danger',
            title: '指令未确认',
            message: error instanceof Error ? error.message : '请检查网络与实时链路',
          });
        }
        return null;
      } finally {
        if (mounted.current) setPending(null);
      }
    },
    [pushToast],
  );

  return { run, pending };
}
