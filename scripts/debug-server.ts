/** Server-only VS Code debug entry. Run with: node --import tsx scripts/debug-server.ts */
process.env.NODE_ENV ??= 'development';
process.env.HOST ??= '127.0.0.1';
// Debug-only port; production uses 8810.
process.env.PORT ??= '8820';

await import('../apps/server/src/index.ts');
