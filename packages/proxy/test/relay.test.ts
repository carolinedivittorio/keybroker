import type { Server } from 'node:net';
import * as mockttp from 'mockttp';
import { ProxyAgent, fetch } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDACTED, Vault } from '@keybroker/core';
import { generateCA, startProxy, startRelay, type RunningProxy } from '../src/index.js';

const SECRET = 'relay_test_secret_0123456789';

describe('relay', () => {
  let upstreamApi: mockttp.Mockttp;
  let upstreamCA: { key: string; cert: string };
  let relay: Server;
  let relayPort: number;
  let proxyCA: { key: string; cert: string };
  let proxy: RunningProxy | undefined;
  const vault = Vault.inMemory();

  beforeAll(async () => {
    upstreamCA = await mockttp.generateCACertificate();
    upstreamApi = mockttp.getLocal({ https: upstreamCA });
    await upstreamApi.start();
    await upstreamApi.forAnyRequest().thenCallback((req) => ({ json: { key: req.headers['x-key'] ?? null, url: req.url } }));
    await vault.upsert({ name: 'api', hosts: ['localhost'], auth: { type: 'header', header: 'x-key' } }, SECRET);
    proxyCA = await generateCA();
    relay = await startRelay({ port: 0, upstreamPort: 47999 });
    relayPort = (relay.address() as { port: number }).port;
  });

  afterAll(async () => {
    await proxy?.stop();
    relay?.close();
    await upstreamApi?.stop();
  });

  const call = (ca: string, path = '/x') =>
    fetch(`https://localhost:${upstreamApi.port}${path}`, {
      dispatcher: new ProxyAgent({ uri: `http://127.0.0.1:${relayPort}`, requestTls: { ca: [ca, upstreamCA.cert] } }),
    });

  it('works as a plain proxy while the app is closed (no key attached)', async () => {
    const res = await call(upstreamCA.cert);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).key).toBeNull();
  });

  it('hands everything to the app proxy once it is running', async () => {
    proxy = await startProxy({ ca: proxyCA, port: 47999, credentials: () => vault.resolved(), upstreamCAs: [upstreamCA.cert] });
    const res = await call(proxyCA.cert);
    expect(((await res.json()) as any).key).toBe(REDACTED);
  });

  it('falls back to direct again when the app quits', async () => {
    await proxy!.stop();
    proxy = undefined;
    const res = await call(upstreamCA.cert, '/after');
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).key).toBeNull();
  });

  it('forwards plain-HTTP requests directly when the app is closed', async () => {
    const http = mockttp.getLocal();
    await http.start();
    await http.forGet('/plain').thenReply(200, 'plain ok');
    const res = await fetch(`http://127.0.0.1:${http.port}/plain`, { dispatcher: new ProxyAgent(`http://127.0.0.1:${relayPort}`) });
    expect(await res.text()).toBe('plain ok');
    await http.stop();
  });
});
