import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, CommandEnvelope, ServerMessage, User } from '@magnav/protocol';
import { SESSION_COOKIE, type AuthService } from './auth';
import type { ConsoleService, SessionSink } from './service';

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function rejectUpgrade(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachRealtime(
  server: HttpServer,
  service: ConsoleService,
  auth: AuthService,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws/v1') {
      rejectUpgrade(socket, '404 Not Found');
      return;
    }
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const resolved = auth.resolve(token);
    if (!resolved) {
      rejectUpgrade(socket, '401 Unauthorized');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, resolved.user);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, user: User) => {
    let subscribedSessionId: string | undefined;

    const sink: SessionSink = {
      user,
      sendJson: (message: ServerMessage) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      },
      sendBinary: (buffer: ArrayBuffer) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > 4 * 1024 * 1024) return;
        ws.send(buffer);
      },
      close: () => ws.close(),
    };

    const sendError = (code: string, message: string, detail?: string) => {
      sink.sendJson({ kind: 'error', code, message, detail });
    };

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        sendError('BAD_MESSAGE', '不接受二进制上行消息');
        return;
      }
      let message: ClientMessage;
      try {
        message = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        sendError('BAD_MESSAGE', 'JSON 解析失败');
        return;
      }
      try {
        switch (message.kind) {
          case 'ping':
            sink.sendJson({
              kind: 'pong',
              t0: message.t0,
              t1: Date.now(),
              serverTime: Date.now(),
            });
            return;
          case 'heartbeat':
            service.heartbeat(subscribedSessionId);
            sink.sendJson({
              kind: 'heartbeat_ack',
              t0: message.t0,
              serverTime: Date.now(),
            });
            return;
          case 'subscribe': {
            service.attach(sink, message.sessionId, user);
            subscribedSessionId = message.sessionId;
            return;
          }
          case 'unsubscribe': {
            service.detach(sink);
            sink.sessionId = undefined;
            subscribedSessionId = undefined;
            return;
          }
          case 'command': {
            if (!subscribedSessionId) {
              sendError('NO_ACTIVE_SESSION', '请先订阅手术会话');
              return;
            }
            const ack = service.handleCommand(sink, user, message.command as CommandEnvelope);
            if (!ack) return;
            return;
          }
          default:
            sendError('UNKNOWN_MESSAGE', '未知消息类型');
        }
      } catch (error) {
        const code = (error as { code?: string }).code ?? 'INTERNAL';
        const msg = error instanceof Error ? error.message : '处理消息失败';
        sendError(code, msg);
      }
    });

    ws.on('close', () => {
      service.detach(sink);
    });
    ws.on('error', () => {
      service.detach(sink);
    });
  });

  return wss;
}
