import { resolve } from 'node:path';
import { buildSeedData } from './seed';
import { AuditChain } from './audit';
import { ConsoleService } from './service';
import { AuthService } from './auth';
import { buildApp } from './app';
import { attachRealtime } from './ws';

const port = Number(process.env.PORT ?? 8810);
const host = process.env.HOST ?? '127.0.0.1';

async function main(): Promise<void> {
  const auditPath =
    process.env.MAGNAV_AUDIT_PATH ?? resolve(process.cwd(), 'data', 'audit.jsonl');
  const audit = new AuditChain(auditPath);
  const seed = buildSeedData();
  const service = new ConsoleService(seed, audit);
  const auth = new AuthService();
  const app = await buildApp({ service, auth, audit });
  await app.listen({ port, host });

  attachRealtime(app.server, service, auth);
  service.start();

  const shutdown = async (signal: string) => {
    console.log(`[magnav] ${signal} received, shutting down`);
    service.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  console.log('');
  console.log('  MAGNAV supervisory console · web full-stack');
  console.log(`  http://${host}:${port}`);
  console.log('  demo logins: surgeon M-1042/2468 · assistant M-1087/1357');
  console.log('               tech T-2011/8642 · engineer E-3007/1122 · reviewer Q-4003/4455');
  console.log('');
}

main().catch((error) => {
  console.error('[magnav] fatal', error);
  process.exit(1);
});
