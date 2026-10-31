import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import type { ApiErrorBody, LoginResponse, User } from '@magnav/protocol';
import { publicUser, SESSION_COOKIE, SESSION_TTL_MS, type AuthService, type StoredUser } from './auth';
import type { AuditChain } from './audit';
import type { ConsoleService } from './service';
import { ServiceError } from './service';

declare module 'fastify' {
  interface FastifyRequest {
    magnavUser?: StoredUser;
    magnavCsrf?: string;
    magnavToken?: string;
  }
}

const loginSchema = z.object({
  badge: z.string().min(2).max(40),
  pin: z.string().min(3).max(12),
});

const createCaseSchema = z.object({
  nameMasked: z.string().min(1).max(40),
  sex: z.enum(['M', 'F']),
  age: z.number().int().min(1).max(120),
  diagnosis: z.string().min(1).max(200),
  procedure: z.string().max(120).default('磁导航介入'),
  weightKg: z.number().min(20).max(200).optional(),
});

const planSchema = z.object({
  branchId: z.string().optional(),
  index: z.number().int().min(0).optional(),
  point: z.tuple([z.number(), z.number(), z.number()]).optional(),
  name: z.string().max(80).optional(),
});

const sessionSchema = z.object({
  caseId: z.string().min(1),
  planId: z.string().min(1),
});

const approveSchema = z.object({ pin: z.string().min(3).max(12) });
const faultSchema = z.object({
  sessionId: z.string().min(1),
  type: z.enum(['tre', 'force', 'saturation', 'gradient', 'link', 'clear']),
});

function authUser(req: FastifyRequest): User {
  if (!req.magnavUser) throw new ServiceError('AUTH_REQUIRED', '登录已失效', undefined, 401);
  return publicUser(req.magnavUser);
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof ServiceError) {
    const body: ApiErrorBody = {
      code: error.code,
      message: error.message,
      detail: error.detail,
    };
    return reply.code(error.status).send(body);
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      code: 'BAD_REQUEST',
      message: '请求参数不合法',
      detail: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  }
  const message = error instanceof Error ? error.message : 'unknown error';
  reply.code(500).send({ code: 'INTERNAL', message: '服务内部错误', detail: message });
}

export interface AppDeps {
  service: ConsoleService;
  auth: AuthService;
  audit: AuditChain;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: false,
  });

  await app.register(cookie);

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.includes('text/html')) {
      reply.header(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self' ws: wss:",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'none'",
          "frame-ancestors 'none'",
        ].join('; '),
      );
    }
    return payload;
  });

  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/v1')) return;
    const publicPaths = ['/api/v1/health', '/api/v1/auth/login'];
    if (publicPaths.includes(req.url.split('?')[0]!)) return;
    const token = req.cookies[SESSION_COOKIE];
    const auth = deps.auth.resolve(token);
    if (!auth) {
      return reply.code(401).send({ code: 'AUTH_REQUIRED', message: '登录已失效' });
    }
    req.magnavUser = auth.user;
    req.magnavCsrf = auth.csrf;
    req.magnavToken = token;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const header = req.headers['x-csrf-token'];
      if (typeof header !== 'string' || header !== auth.csrf) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'CSRF 校验失败' });
      }
    }
  });

  app.setErrorHandler((error, _req, reply) => handleError(reply, error));

  /* ---------------------------------------------------------------- */
  /* auth                                                              */
  /* ---------------------------------------------------------------- */

  app.post('/api/v1/auth/login', async (req, reply) => {
    const parsed = loginSchema.parse(req.body);
    const result = deps.auth.login(parsed.badge, parsed.pin);
    if (!result) {
      deps.audit.append(
        { id: 'anonymous', name: parsed.badge, role: 'reviewer' },
        'LOGIN_FAILED',
        '登录失败：工牌或口令错误',
        'auth',
      );
      return reply.code(401).send({ code: 'AUTH_FAILED', message: '工牌或口令错误' });
    }
    reply.setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
      secure: false,
    });
    deps.audit.append(result.user, 'LOGIN', `登录成功 · ${result.user.role}`, 'auth');
    const body: LoginResponse = {
      user: publicUser(result.user),
      sessionExpiresAt: result.expiresAt,
      csrfToken: result.csrf,
    };
    return reply.send(body);
  });

  app.get('/api/v1/auth/me', async (req) => {
    const user = authUser(req);
    return { user, csrfToken: req.magnavCsrf };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    if (req.magnavUser) {
      deps.audit.append(publicUser(req.magnavUser), 'LOGOUT', '退出登录', 'auth');
    }
    deps.auth.logout(req.magnavToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /* ---------------------------------------------------------------- */
  /* cases & planning                                                  */
  /* ---------------------------------------------------------------- */

  app.get('/api/v1/cases', async (req) => {
    const user = authUser(req);
    return { cases: deps.service.listCases(user) };
  });

  app.post('/api/v1/cases', async (req) => {
    const user = authUser(req);
    const input = createCaseSchema.parse(req.body);
    return deps.service.createCase(input, user);
  });

  app.get('/api/v1/cases/:caseId', async (req) => {
    const user = authUser(req);
    const { caseId } = req.params as { caseId: string };
    return deps.service.getCaseDetail(caseId, user);
  });

  app.get('/api/v1/cases/:caseId/vessels', async (req) => {
    const { caseId } = req.params as { caseId: string };
    return deps.service.getTree(caseId);
  });

  app.get('/api/v1/cases/:caseId/registration', async (req) => {
    const { caseId } = req.params as { caseId: string };
    return deps.service.getRegistration(caseId);
  });

  app.post('/api/v1/cases/:caseId/registration/verify', async (req) => {
    const user = authUser(req);
    const { caseId } = req.params as { caseId: string };
    return deps.service.verifyRegistration(caseId, user);
  });

  app.get('/api/v1/cases/:caseId/plans', async (req) => {
    const { caseId } = req.params as { caseId: string };
    return { plans: deps.service.listPlans(caseId) };
  });

  app.post('/api/v1/cases/:caseId/plans', async (req) => {
    const user = authUser(req);
    const { caseId } = req.params as { caseId: string };
    const input = planSchema.parse(req.body ?? {});
    return deps.service.composePlanForCase(caseId, input, input.name, user);
  });

  app.post('/api/v1/plans/:planId/approve', async (req) => {
    const user = authUser(req);
    const { planId } = req.params as { planId: string };
    const input = approveSchema.parse(req.body);
    return deps.service.approvePlan(planId, user, input.pin);
  });

  app.get('/api/v1/cases/:caseId/sessions', async (req) => {
    const { caseId } = req.params as { caseId: string };
    return { sessions: deps.service.listSessionsForCase(caseId) };
  });

  /* ---------------------------------------------------------------- */
  /* sessions & review                                                 */
  /* ---------------------------------------------------------------- */

  app.post('/api/v1/sessions', async (req) => {
    const user = authUser(req);
    const input = sessionSchema.parse(req.body);
    if (!['surgeon', 'assistant'].includes(user.role)) {
      throw new ServiceError('FORBIDDEN', '仅术者或助手可开启手术会话', undefined, 403);
    }
    return deps.service.createSession(input.caseId, input.planId, user);
  });

  app.post('/api/v1/demo/start', async (req) => {
    return deps.service.startDemo(authUser(req));
  });

  app.get('/api/v1/sessions/:sessionId', async (req) => {
    const user = authUser(req);
    const { sessionId } = req.params as { sessionId: string };
    return deps.service.snapshot(sessionId, user);
  });

  app.get('/api/v1/sessions/:sessionId/review', async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    return deps.service.getReviewReport(sessionId);
  });

  /* ---------------------------------------------------------------- */
  /* devices, faults, audit                                            */
  /* ---------------------------------------------------------------- */

  app.get('/api/v1/devices', async (req) => {
    const query = req.query as { sessionId?: string };
    return deps.service.getDevices(query.sessionId);
  });

  app.post('/api/v1/devices/self-test', async (req) => {
    const user = authUser(req);
    return deps.service.selfTestCoils(user);
  });

  app.post('/api/v1/demo/fault', async (req) => {
    const user = authUser(req);
    const input = faultSchema.parse(req.body);
    return deps.service.injectFault(input.sessionId, input.type, user);
  });

  app.get('/api/v1/audit', async (req) => {
    const query = req.query as { limit?: string };
    const limit = Math.min(500, Math.max(1, Number(query.limit ?? 100)));
    return { entries: deps.audit.list(limit), verify: deps.audit.verify() };
  });

  app.get('/api/v1/audit/verify', async () => deps.audit.verify());

  app.get('/api/v1/audit/export', async (req, reply) => {
    const user = authUser(req);
    if (!['engineer', 'reviewer', 'surgeon'].includes(user.role)) {
      throw new ServiceError('FORBIDDEN', '无导出权限', undefined, 403);
    }
    reply.header('Content-Type', 'application/x-ndjson; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="magnav-audit.jsonl"');
    return deps.audit.exportJsonl();
  });

  app.get('/api/v1/health', async () => ({
    ok: true,
    version: '0.1.0',
    uptimeS: Math.round(process.uptime()),
    sessions: deps.service.countSessions(),
    telemetryHz: 120,
  }));

  /* ---------------------------------------------------------------- */
  /* static console (production build)                                 */
  /* ---------------------------------------------------------------- */

  const consoleDist = fileURLToPath(new URL('../../console/dist/', import.meta.url));
  const indexHtml = `${consoleDist}index.html`;
  if (existsSync(indexHtml)) {
    await app.register(fastifyStatic, {
      root: consoleDist,
      prefix: '/',
      wildcard: false,
      index: ['index.html'],
    });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/ws/')) {
        return reply.type('text/html').sendFile('index.html');
      }
      return reply.code(404).send({ code: 'NOT_FOUND', message: '资源不存在' });
    });
  }

  return app;
}
