import type {
  ClientMessage,
  CommandAck,
  CommandEnvelope,
  CommandType,
  ServerMessage,
  TelemetryFrame,
} from '@magnav/protocol';
import { hot } from '../telemetry/hot';
import { observePong } from './clock';
import { useSessionStore } from '../store/session';

interface PendingCommand {
  resolve: (ack: CommandAck) => void;
  reject: (error: Error) => void;
  timer: number;
}

class RealtimeClient {
  private ws: WebSocket | null = null;
  private worker: Worker | null = null;
  private sessionId: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private pingTimer: number | null = null;
  private pending = new Map<string, PendingCommand>();
  private manuallyClosed = false;
  private connecting = false;

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.connecting) return;
    this.manuallyClosed = false;
    this.ensureWorker();
    this.connecting = true;
    useSessionStore.getState().setConnection(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/v1`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.connecting = false;
      this.reconnectAttempt = 0;
      useSessionStore.getState().setConnection('live');
      if (this.sessionId) this.sendSubscribe(this.sessionId);
      this.startTimers();
    };

    ws.onmessage = (event) => this.handleMessage(event);

    ws.onerror = () => {
      this.connecting = false;
    };

    ws.onclose = () => {
      this.connecting = false;
      this.stopTimers();
      this.ws = null;
      for (const pending of this.pending.values()) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error('实时链路已断开'));
      }
      this.pending.clear();
      if (this.manuallyClosed) {
        useSessionStore.getState().setConnection('idle');
        return;
      }
      useSessionStore.getState().setConnection('reconnecting');
      this.scheduleReconnect();
    };
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.sessionId = null;
    this.stopTimers();
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
    this.worker?.terminate();
    this.worker = null;
    hot.reset();
    useSessionStore.getState().setConnection('idle');
  }

  subscribe(sessionId: string): void {
    this.sessionId = sessionId;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(sessionId);
    } else {
      this.connect();
    }
  }

  unsubscribe(): void {
    this.sessionId = null;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ kind: 'unsubscribe' });
    }
    hot.reset();
  }

  async sendCommand(
    type: CommandType,
    params: Record<string, unknown> = {},
  ): Promise<CommandAck> {
    const state = useSessionStore.getState();
    if (!state.user || !state.snapshot) throw new Error('会话未就绪');
    if (this.ws?.readyState !== WebSocket.OPEN) throw new Error('实时链路未连接');
    const command: CommandEnvelope = {
      id: crypto.randomUUID(),
      type,
      params,
      issuedBy: state.user.id,
      issuedAt: Date.now(),
      expectedState: state.snapshot.phase,
      nonce: crypto.randomUUID(),
    };
    return new Promise<CommandAck>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(command.id);
        reject(new Error('指令未在 2 s 内确认，请以服务端广播状态为准'));
      }, 2500);
      this.pending.set(command.id, { resolve, reject, timer });
      this.send({ kind: 'command', command });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (!useSessionStore.getState().user) {
      useSessionStore.getState().setConnection('offline');
      return;
    }
    this.reconnectAttempt += 1;
    const delay = Math.min(8000, 500 * 2 ** Math.min(4, this.reconnectAttempt - 1));
    if (this.reconnectAttempt === 3) {
      useSessionStore.getState().pushToast({
        tone: 'warn',
        title: '实时链路重连中',
        message: `第 ${this.reconnectAttempt} 次重试，正在恢复遥测与状态快照`,
      });
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private sendSubscribe(sessionId: string): void {
    this.send({ kind: 'subscribe', sessionId });
  }

  private send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private startTimers(): void {
    this.stopTimers();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ kind: 'heartbeat', t0: Date.now() });
    }, 1000);
    this.pingTimer = window.setInterval(() => {
      this.send({ kind: 'ping', t0: Date.now() });
    }, 5000);
    this.send({ kind: 'ping', t0: Date.now() });
  }

  private stopTimers(): void {
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.heartbeatTimer = null;
    this.pingTimer = null;
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.worker = new Worker(new URL('../workers/telemetry.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<TelemetryFrame | { error: string }>) => {
      const data = event.data;
      if ('error' in data) {
        console.warn('[telemetry] decode error', data.error);
        return;
      }
      hot.push(data);
    };
  }

  private handleMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer) {
      this.worker?.postMessage({ buffer: event.data }, [event.data]);
      return;
    }
    let message: ServerMessage;
    try {
      message = JSON.parse(String(event.data)) as ServerMessage;
    } catch {
      return;
    }
    switch (message.kind) {
      case 'hello':
      case 'snapshot': {
        const store = useSessionStore.getState();
        store.setSnapshot(message.snapshot);
        if (this.sessionId !== message.snapshot.sessionId) {
          this.sessionId = message.snapshot.sessionId;
        }
        store.setConnection('live');
        return;
      }
      case 'event': {
        const store = useSessionStore.getState();
        store.applyEvent(message.event);
        if (message.event.kind === 'command') {
          const pending = this.pending.get(message.event.ack.id);
          if (pending) {
            window.clearTimeout(pending.timer);
            this.pending.delete(message.event.ack.id);
            pending.resolve(message.event.ack);
          }
        }
        return;
      }
      case 'pong': {
        observePong(message.t0, message.t1, message.serverTime);
        const rtt = message.t1 - message.t0;
        useSessionStore.getState().setLatency(Math.max(0, rtt));
        return;
      }
      case 'heartbeat_ack': {
        const rtt = Date.now() - message.t0;
        useSessionStore.getState().setLatency(Math.max(0, rtt));
        return;
      }
      case 'error': {
        useSessionStore.getState().pushToast({
          tone: 'danger',
          title: message.message,
          message: message.detail,
        });
        return;
      }
      default:
        return;
    }
  }
}

export const realtime = new RealtimeClient();
