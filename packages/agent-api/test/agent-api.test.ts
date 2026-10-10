import { stat } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AgentApiError,
  AgentClient,
  MAX_PENDING_PROPOSALS,
  ProposalStore,
  startAgentServer,
  type AgentApiHandlers,
  type ProposalInput,
} from '../src/index.js';

const input = (name: string): ProposalInput => ({ name, hosts: [`api.${name}.com`], auth: { type: 'bearer' } });

describe('ProposalStore', () => {
  it('wakes waiters when a proposal is resolved', async () => {
    const store = new ProposalStore();
    const p = store.create(input('a'));
    const waiting = store.wait(p.id, 5000);
    setTimeout(() => store.update(p.id, { status: 'approved' }), 20);
    expect((await waiting).status).toBe('approved');
  });

  it('returns pending after the wait times out', async () => {
    const store = new ProposalStore();
    const p = store.create(input('a'));
    expect((await store.wait(p.id, 30)).status).toBe('pending');
  });

  it('dedupes by name and caps pending proposals', () => {
    const store = new ProposalStore();
    const first = store.create(input('a'));
    expect(store.create(input('a')).id).toBe(first.id);
    for (let i = 1; i < MAX_PENDING_PROPOSALS; i++) store.create(input(`n${i}`));
    expect(() => store.create(input('overflow'))).toThrow(AgentApiError);
  });
});

describe('agent server over a unix socket', () => {
  let server: Server;
  let client: AgentClient;
  let socketPath: string;
  const store = new ProposalStore();

  beforeAll(async () => {
    socketPath = join(await mkdtemp(join(tmpdir(), 'kb-sock-')), 'agent.sock');
    const handlers: AgentApiHandlers = {
      listCredentials: () => [],
      propose: async (i) => store.create(i),
      getProposal: (id, ms) => store.wait(id, ms),
      request: async () => {
        throw new AgentApiError('nope', 503);
      },
    };
    server = await startAgentServer(handlers, socketPath);
    client = new AgentClient(socketPath);
  });
  afterAll(() => server?.close());

  it('is only accessible to the owner', async () => {
    expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
  });

  it('round-trips a proposal with long-polling', async () => {
    const p = await client.propose(input('svc'));
    expect(p.status).toBe('pending');
    setTimeout(() => store.update(p.id, { status: 'rejected' }), 50);
    expect((await client.getProposal(p.id, 5)).status).toBe('rejected');
  });

  it('surfaces handler errors with their status', async () => {
    await expect(client.request({ url: 'https://x' })).rejects.toMatchObject({ status: 503, message: 'nope' });
  });

  it('gives a helpful error when the app is not running', async () => {
    await expect(new AgentClient(join(tmpdir(), 'missing.sock')).listCredentials()).rejects.toThrow(/not running/);
  });
});

describe('client identification', () => {
  it('passes the --client name through to handlers', async () => {
    const socketPath = join(await mkdtemp(join(tmpdir(), 'kb-sock-')), 'agent.sock');
    let seen: string | undefined = 'unset';
    const server = await startAgentServer(
      {
        listCredentials: (ctx) => ((seen = ctx.client), []),
        propose: async () => { throw new Error('unused'); },
        getProposal: async () => { throw new Error('unused'); },
        request: async () => { throw new Error('unused'); },
      },
      socketPath,
    );
    await new AgentClient(socketPath, 'claude-desktop').listCredentials();
    expect(seen).toBe('claude-desktop');
    await new AgentClient(socketPath).listCredentials();
    expect(seen).toBeUndefined();
    server.close();
  });
});
