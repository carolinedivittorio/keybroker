// Standalone smoke test: runs the real proxy with a throwaway credential for httpbin.org,
// writes an env.sh into a temp dir, and prints the path. Ctrl-C to stop.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, writeShellEnv } from '@keybroker/core';
import { generateCA, startProxy } from '../src/index.js';

const vault = Vault.inMemory();
await vault.upsert(
  { name: 'httpbin', hosts: ['httpbin.org'], auth: { type: 'header', header: 'x-api-key' }, envVar: 'HTTPBIN_API_KEY' },
  process.env.SMOKE_SECRET ?? 'kb_smoke_secret_0123456789',
);
const ca = await generateCA();
const proxy = await startProxy({
  ca,
  port: Number(process.env.SMOKE_PORT ?? 47199),
  credentials: () => vault.resolved(),
  onEvent: (e) => console.log('event', JSON.stringify(e)),
});
const dir = await mkdtemp(join(tmpdir(), 'keybroker-smoke-'));
const { envFile } = await writeShellEnv({ dir, proxyUrl: proxy.url, caCert: ca.cert, credentials: vault.listCredentials() });
console.log(`ENV_FILE=${envFile}`);
