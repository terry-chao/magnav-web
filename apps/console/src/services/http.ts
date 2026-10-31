import type {
  ApiErrorBody,
  CaseDetail,
  CaseRecord,
  DeviceSnapshot,
  LoginResponse,
  Plan,
  RegistrationInfo,
  ReviewReport,
  SessionSnapshot,
  User,
} from '@magnav/protocol';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: string;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.detail = body.detail;
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (csrfToken && init.method && !['GET', 'HEAD'].includes(init.method)) {
    headers.set('x-csrf-token', csrfToken);
  }
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    let body: ApiErrorBody = { code: 'HTTP_ERROR', message: `请求失败 (${response.status})` };
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      /* ignore */
    }
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('magnav:auth-expired'));
    }
    throw new ApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const http = {
  login(badge: string, pin: string) {
    return request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ badge, pin }),
    });
  },
  async me() {
    return request<{ user: User; csrfToken: string }>('/auth/me');
  },
  logout() {
    return request<{ ok: boolean }>('/auth/logout', { method: 'POST' });
  },
  listCases() {
    return request<{ cases: CaseRecord[] }>('/cases');
  },
  caseDetail(caseId: string) {
    return request<CaseDetail>(`/cases/${caseId}`);
  },
  createCase(input: {
    nameMasked: string;
    sex: 'M' | 'F';
    age: number;
    diagnosis: string;
    procedure: string;
    weightKg?: number;
  }) {
    return request<CaseDetail>('/cases', { method: 'POST', body: JSON.stringify(input) });
  },
  vessels(caseId: string) {
    return request<import('@magnav/protocol').VesselTree>(`/cases/${caseId}/vessels`);
  },
  registration(caseId: string) {
    return request<RegistrationInfo>(`/cases/${caseId}/registration`);
  },
  verifyRegistration(caseId: string) {
    return request<RegistrationInfo>(`/cases/${caseId}/registration/verify`, { method: 'POST' });
  },
  plans(caseId: string) {
    return request<{ plans: Plan[] }>(`/cases/${caseId}/plans`);
  },
  composePlan(
    caseId: string,
    target: { branchId?: string; index?: number; point?: [number, number, number] },
    name?: string,
  ) {
    return request<Plan>(`/cases/${caseId}/plans`, {
      method: 'POST',
      body: JSON.stringify({ ...target, name }),
    });
  },
  approvePlan(planId: string, pin: string) {
    return request<Plan>(`/plans/${planId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },
  createSession(caseId: string, planId: string) {
    return request<SessionSnapshot>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ caseId, planId }),
    });
  },
  startDemo() {
    return request<SessionSnapshot>('/demo/start', { method: 'POST' });
  },
  session(sessionId: string) {
    return request<SessionSnapshot>(`/sessions/${sessionId}`);
  },
  review(sessionId: string) {
    return request<ReviewReport>(`/sessions/${sessionId}/review`);
  },
  sessionsForCase(caseId: string) {
    return request<{
      sessions: Array<{
        id: string;
        planId: string;
        phase: string;
        createdAt: number;
        startedAt: number | null;
        endedAt: number | null;
        outcome: 'COMPLETED' | 'ABORTED' | 'IN_PROGRESS';
      }>;
    }>(`/cases/${caseId}/sessions`);
  },
  devices(sessionId?: string) {
    return request<DeviceSnapshot>(
      `/devices${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`,
    );
  },
  selfTest() {
    return request<DeviceSnapshot>('/devices/self-test', { method: 'POST' });
  },
  injectFault(sessionId: string, type: 'tre' | 'force' | 'saturation' | 'gradient' | 'link' | 'clear') {
    return request<SessionSnapshot>('/demo/fault', {
      method: 'POST',
      body: JSON.stringify({ sessionId, type }),
    });
  },
  audit(limit = 100) {
    return request<{
      entries: import('@magnav/protocol').AuditEntry[];
      verify: { valid: boolean; count: number; brokenAt?: number };
    }>(`/audit?limit=${limit}`);
  },
  verifyAudit() {
    return request<{ valid: boolean; count: number; brokenAt?: number }>('/audit/verify');
  },
};
