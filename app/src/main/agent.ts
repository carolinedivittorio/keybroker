import {
  AgentApiError,
  PAUSED_STATUS,
  ProposalStore,
  type AgentApiHandlers,
  type CallContext,
  type CredentialSummary,
  type Proposal,
  type ProposalInput,
} from '@keybroker/agent-api';
import {
  describeAuth,
  findCredentialForHost,
  placeholderFor,
  PRESETS,
  validateCredentialInput,
  VaultError,
  type AuthScheme,
  type Credential,
  type Vault,
} from '@keybroker/core';
import { proxiedRequest, type RunningProxy } from '@keybroker/proxy';
import type { CredentialInput } from '../shared/api';

export interface BrokerDeps {
  vault: () => Vault;
  proxy: () => RunningProxy | undefined;
  caCert: () => string;
  credentialsChanged: () => Promise<void>;
  /** Bring the review UI forward when a proposal arrives. */
  showProposals: () => void;
  /** Display name for a launcher --client id, e.g. "Claude Desktop". */
  clientName: (client: string) => string;
}

export function summarize(vault: Vault, c: Credential): CredentialSummary {
  return {
    name: c.name,
    hosts: c.hosts,
    auth: c.auth,
    authDescription: describeAuth(c.auth),
    envVar: c.envVar,
    docsUrl: c.docsUrl,
    hasSecret: vault.hasSecret(c.name),
    placeholder: placeholderFor(c.name),
  };
}

const sameAuth = (a: AuthScheme, b: AuthScheme) => JSON.stringify(a) === JSON.stringify(b);
const sameHosts = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();

function matchingPreset(input: ProposalInput): string | undefined {
  return PRESETS.find((p) => sameHosts(p.hosts, input.hosts) && sameAuth(p.auth, input.auth))?.label;
}

/** Only keep fields we understand; anything else an agent sends is dropped. */
function cleanProposal(raw: any): ProposalInput {
  if (!raw || typeof raw !== 'object') throw new AgentApiError('Proposal must be an object');
  const str = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const input: ProposalInput = {
    name: String(raw.name ?? '').trim().toLowerCase(),
    hosts: Array.isArray(raw.hosts) ? raw.hosts.map((h: unknown) => String(h).trim().toLowerCase()) : [],
    auth: raw.auth,
    envVar: str(raw.envVar, 100),
    docsUrl: str(raw.docsUrl, 500),
    notes: str(raw.notes, 1000),
  };
  if (raw.testRequest) {
    const path = str(raw.testRequest.path, 500);
    if (!path?.startsWith('/')) throw new AgentApiError('testRequest.path must start with /');
    const method = raw.testRequest.method === 'HEAD' ? 'HEAD' : 'GET';
    input.testRequest = { method, path };
  }
  const auth = input.auth as any;
  const authOk =
    auth &&
    ((auth.type === 'bearer' && Object.keys(auth).length === 1) ||
      (auth.type === 'header' && typeof auth.header === 'string' && (auth.prefix === undefined || typeof auth.prefix === 'string')) ||
      (auth.type === 'query' && typeof auth.param === 'string') ||
      (auth.type === 'basic' && (auth.username === undefined || typeof auth.username === 'string')));
  if (!authOk) throw new AgentApiError('auth must be {type:"bearer"} | {type:"header",header,prefix?} | {type:"query",param} | {type:"basic",username?}');
  input.auth =
    auth.type === 'header'
      ? { type: 'header', header: auth.header, ...(auth.prefix ? { prefix: auth.prefix } : {}) }
      : auth.type === 'query'
        ? { type: 'query', param: auth.param }
        : auth.type === 'basic'
          ? { type: 'basic', ...(auth.username ? { username: auth.username } : {}) }
          : { type: 'bearer' };
  if (input.docsUrl && !input.docsUrl.startsWith('https://')) throw new AgentApiError('docsUrl must be https');
  try {
    validateCredentialInput(input);
  } catch (err) {
    throw new AgentApiError((err as Error).message);
  }
  return input;
}

export function createBroker(deps: BrokerDeps) {
  const proposals = new ProposalStore(() => deps.showProposals());

  async function runTest(credential: Credential, test: ProposalInput['testRequest']): Promise<Proposal['test']> {
    const proxy = deps.proxy();
    const host = credential.hosts.find((h) => !h.startsWith('*.'));
    if (!test || !proxy || !host) return undefined;
    try {
      const res = await proxiedRequest(
        { url: `https://${host}${test.path}`, method: test.method },
        { url: proxy.url, caCert: deps.caCert() },
      );
      return { ok: res.status >= 200 && res.status < 300, status: res.status };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  function assertNotPaused(ctx: CallContext) {
    if (deps.vault().isPaused(ctx.client)) {
      const name = deps.clientName(ctx.client!);
      throw new AgentApiError(
        `Keybroker is paused for ${name}. The user can turn it back on in the Keybroker app (Connect your agents → Resume). Don't try to work around this.`,
        PAUSED_STATUS,
      );
    }
  }

  const handlers: AgentApiHandlers = {
    listCredentials(ctx) {
      assertNotPaused(ctx);
      const vault = deps.vault();
      return vault.listCredentials().map((c) => summarize(vault, c));
    },

    async propose(raw, ctx) {
      assertNotPaused(ctx);
      const input = cleanProposal(raw);
      if (deps.vault().getCredential(input.name)) {
        throw new AgentApiError(
          `A credential named "${input.name}" already exists. Proposals can't change existing credentials; ask the user to edit it in the Keybroker app, or propose a different name.`,
          409,
        );
      }
      return proposals.create(input, { matchesPreset: matchingPreset(input) });
    },

    getProposal(id, waitMs, ctx) {
      assertNotPaused(ctx);
      return proposals.wait(id, waitMs);
    },

    async request(raw, ctx) {
      assertNotPaused(ctx);
      const proxy = deps.proxy();
      if (!proxy) throw new AgentApiError('Keybroker proxy is not running', 503);
      if (!raw || typeof raw.url !== 'string') throw new AgentApiError('url is required');
      const result = await proxiedRequest(raw, { url: proxy.url, caCert: deps.caCert() });
      let host = '';
      try {
        host = new URL(raw.url).hostname;
      } catch {}
      const match = findCredentialForHost(deps.vault().resolved(), host);
      return { ...result, credential: match?.credential.name };
    },
  };

  /** Called from the app UI only: the user saved the (possibly edited) proposal with their key. */
  async function approve(id: string, input: CredentialInput, secret: string) {
    const proposal = proposals.get(id);
    if (proposal.status !== 'pending') throw new VaultError(`This proposal is already ${proposal.status}`);
    if (!secret.trim()) throw new VaultError('Paste the API key to approve this proposal.');
    const vault = deps.vault();
    if (vault.getCredential(input.name)) throw new VaultError(`A credential named "${input.name}" already exists.`);
    const credential = await vault.upsert(input, secret.trim());
    await deps.credentialsChanged();
    const test = await runTest(credential, proposal.testRequest);
    proposals.update(id, { status: 'approved', test, credential: summarize(vault, credential) });
  }

  function reject(id: string) {
    proposals.update(id, { status: 'rejected' });
  }

  return { handlers, proposals, approve, reject };
}
