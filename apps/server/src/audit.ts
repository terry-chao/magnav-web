import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { AuditEntry, Role, User } from '@magnav/protocol';

const GENESIS = '0'.repeat(64);

function digest(entry: Omit<AuditEntry, 'hash'>): string {
  return createHash('sha256')
    .update(
      [
        entry.seq,
        entry.ts,
        entry.actorId,
        entry.role,
        entry.action,
        entry.subject,
        entry.detail,
        entry.prevHash,
      ].join('|'),
    )
    .digest('hex');
}

/**
 * Append-only hash-chained audit log. Each entry commits to its predecessor,
 * so any retroactive edit breaks the chain. Persisted as JSONL when a path is
 * provided (the demo writes to data/audit.jsonl).
 */
export class AuditChain {
  private entries: AuditEntry[] = [];
  private seq = 0;
  private lastHash = GENESIS;
  private filePath: string | null;

  constructor(filePath: string | null = null) {
    this.filePath = filePath;
    if (filePath) {
      mkdirSync(dirname(filePath), { recursive: true });
      if (existsSync(filePath)) {
        const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as AuditEntry;
            this.entries.push(entry);
            this.seq = Math.max(this.seq, entry.seq);
            this.lastHash = entry.hash;
          } catch {
            // ignore malformed trailing line
          }
        }
      }
    }
  }

  append(
    actor: Pick<User, 'id' | 'name' | 'role'>,
    action: string,
    detail: string,
    subject: string,
    ts = Date.now(),
  ): AuditEntry {
    this.seq += 1;
    const partial: Omit<AuditEntry, 'hash'> = {
      seq: this.seq,
      ts,
      actorId: actor.id,
      actorName: actor.name,
      role: actor.role as Role,
      action,
      detail,
      subject,
      prevHash: this.lastHash,
    };
    const hash = digest(partial);
    const entry: AuditEntry = { ...partial, hash };
    this.entries.push(entry);
    this.lastHash = hash;
    if (this.filePath) {
      try {
        appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
      } catch {
        // persistence failure must never block the procedure
      }
    }
    return entry;
  }

  verify(): { valid: boolean; count: number; brokenAt?: number } {
    let prev = GENESIS;
    for (const entry of this.entries) {
      if (entry.prevHash !== prev) return { valid: false, count: this.entries.length, brokenAt: entry.seq };
      const expected = digest(entry);
      if (expected !== entry.hash) return { valid: false, count: this.entries.length, brokenAt: entry.seq };
      prev = entry.hash;
    }
    return { valid: true, count: this.entries.length };
  }

  list(limit = 100): AuditEntry[] {
    return this.entries.slice(-Math.max(1, limit)).reverse();
  }

  all(): AuditEntry[] {
    return this.entries.slice();
  }

  tail(count = 50): AuditEntry[] {
    return this.entries.slice(-count);
  }

  exportJsonl(): string {
    return this.entries.map((e) => JSON.stringify(e)).join('\n');
  }
}
