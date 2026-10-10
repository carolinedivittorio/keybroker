import * as mockttp from 'mockttp';
import { ProxyAgent, fetch } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDACTED, Vault } from '@keybroker/core';
import { generateCA, startProxy, type ProxyEvent, type ProxyEventDetail, type RunningProxy } from '../src/index.js';

const SECRET = 'xi_test_secret_0123456789';

describe('keybroker proxy', () => {
  let upstream: mockttp.Mockttp;
  let proxy: RunningProxy;
  let agent: ProxyAgent;
  const events: ProxyEvent[] = [];
  const details: ProxyEventDetail[] = [];
  const vault = Vault.inMemory();

  beforeAll(async () => {
    // A fake API at https://localhost that echoes back what it received, secret included.
    const upstreamCA = await mockttp.generateCACertificate();
    upstream = mockttp.getLocal({ https: upstreamCA });
    await upstream.start();
    await upstream.forAnyRequest().thenCallback(async (req) => ({
      statusCode: 200,
      json: { url: req.url, headers: req.headers, echoed: `your key is ${req.headers['xi-api-key']}` },
    }));

    await vault.upsert(
      { name: 'fakeapi', hosts: ['localhost'], auth: { type: 'header', header: 'xi-api-key' }, envVar: 'FAKE_API_KEY' },
      SECRET,
    );
    const ca = await generateCA();
    proxy = await startProxy({
      ca,
      credentials: () => vault.resolved(),
      upstreamCAs: [upstreamCA.cert],
      onEvent: (e, d) => {
        events.push(e);
        details.push(d);
      },
    });
    agent = new ProxyAgent({ uri: proxy.url, requestTls: { ca: ca.cert } });
  });

  afterAll(async () => {
    await agent?.close();
    await proxy?.stop();
    await upstream?.stop();
  });

  const call = (path: string, headers: Record<string, string> = {}) =>
    fetch(`https://localhost:${upstream.port}${path}`, { dispatcher: agent, headers });

  it('injects the secret upstream and scrubs it from the response', async () => {
    const res = await call('/v1/user', { 'xi-api-key': 'keybroker-managed:fakeapi' });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(SECRET);
    const json = JSON.parse(text);
    expect(json.headers['xi-api-key']).toBe(REDACTED);
    expect(json.echoed).toBe(`your key is ${REDACTED}`);

    expect(events.at(-1)).toMatchObject({ action: 'injected', credential: 'fakeapi', redactions: 2 });
  });

  it('captures what the agent sent and the scrubbed response, never the secret', async () => {
    await call('/v1/user?x=1', { 'xi-api-key': 'keybroker-managed:fakeapi' });
    const detail = details.at(-1)!;
    expect(JSON.stringify(detail)).not.toContain(SECRET);
    expect(detail.request.headers['xi-api-key']).toBe('keybroker-managed:fakeapi');
    expect(detail.request.injectedAt).toBe('header xi-api-key');
    expect(detail.response?.status).toBe(200);
    expect(detail.response?.body).toContain(REDACTED);
    expect(events.at(-1)!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('injects even when the client sends no placeholder at all', async () => {
    const res = await call('/v1/user');
    expect((await res.json() as any).headers['xi-api-key']).toBe(REDACTED);
  });

  it('blocks a placeholder for an unknown credential with a helpful error', async () => {
    // Plain HTTP so the request reaches the proxy's rules without TLS interception.
    const res = await fetch(`http://127.0.0.1:${upstream.port}/`, {
      dispatcher: agent,
      headers: { authorization: 'Bearer keybroker-managed:stripe' },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).message).toContain('No credential named "stripe"');
  });

  it('refuses to send a credential over plain HTTP', async () => {
    const res = await fetch(`http://localhost:${upstream.port}/`, { dispatcher: agent });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).message).toContain('plain HTTP');
  });
});
