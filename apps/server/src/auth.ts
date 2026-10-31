import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Role, User } from '@magnav/protocol';

export interface StoredUser extends User {
  pinHash: string;
  salt: string;
  active: boolean;
}

interface AuthSession {
  token: string;
  csrf: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export const SESSION_COOKIE = 'magnav_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const SALT = 'magnav-demo-v0.1';

function hashPin(pin: string, salt = SALT): string {
  return createHash('sha256').update(`${salt}:${pin}`).digest('hex');
}

const RAW_USERS: Array<Omit<StoredUser, 'pinHash' | 'salt'> & { pin: string }> = [
  {
    id: 'u-surgeon',
    badge: 'M-1042',
    name: '赵*峰',
    role: 'surgeon',
    title: '主任医师 · 介入导管室',
    initials: '赵',
    pin: '2468',
    active: true,
  },
  {
    id: 'u-assistant',
    badge: 'M-1087',
    name: '李*婷',
    role: 'assistant',
    title: '介入助手 · 导管室',
    initials: '李',
    pin: '1357',
    active: true,
  },
  {
    id: 'u-tech',
    badge: 'T-2011',
    name: '王*磊',
    role: 'tech',
    title: '影像技师 · 导管室',
    initials: '王',
    pin: '8642',
    active: true,
  },
  {
    id: 'u-engineer',
    badge: 'E-3007',
    name: '陈*涛',
    role: 'engineer',
    title: '临床工程师 · 设备保障',
    initials: '陈',
    pin: '1122',
    active: true,
  },
  {
    id: 'u-reviewer',
    badge: 'Q-4003',
    name: '周*敏',
    role: 'reviewer',
    title: '质控审核 · 医疗安全部',
    initials: '周',
    pin: '4455',
    active: true,
  },
];

export const USERS: StoredUser[] = RAW_USERS.map(({ pin, ...user }) => ({
  ...user,
  salt: SALT,
  pinHash: hashPin(pin, SALT),
}));

export function publicUser(user: StoredUser): User {
  return {
    id: user.id,
    badge: user.badge,
    name: user.name,
    role: user.role,
    title: user.title,
    initials: user.initials,
  };
}

export function userById(id: string): StoredUser | undefined {
  return USERS.find((u) => u.id === id);
}

export function userByBadge(badge: string): StoredUser | undefined {
  return USERS.find((u) => u.badge.toLowerCase() === badge.trim().toLowerCase());
}

export function verifyPin(user: StoredUser, pin: string): boolean {
  const a = Buffer.from(hashPin(pin, user.salt), 'hex');
  const b = Buffer.from(user.pinHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class AuthService {
  private sessions = new Map<string, AuthSession>();

  login(badge: string, pin: string): { user: StoredUser; token: string; csrf: string; expiresAt: number } | null {
    const user = userByBadge(badge);
    if (!user || !user.active || !verifyPin(user, pin)) return null;
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(18).toString('base64url');
    const now = Date.now();
    const session: AuthSession = {
      token,
      csrf,
      userId: user.id,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    this.sessions.set(token, session);
    this.cleanup(now);
    return { user, token, csrf, expiresAt: session.expiresAt };
  }

  resolve(token: string | undefined | null): { user: StoredUser; csrf: string } | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    const user = userById(session.userId);
    if (!user) return null;
    return { user, csrf: session.csrf };
  }

  logout(token: string | undefined | null): void {
    if (token) this.sessions.delete(token);
  }

  cleanup(now = Date.now()): void {
    for (const [token, session] of this.sessions) {
      if (session.expiresAt < now) this.sessions.delete(token);
    }
  }
}

export type { Role };
