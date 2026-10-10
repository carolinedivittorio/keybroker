import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AuthScheme } from '@keybroker/core';

/**
 * The agent API is reachable by anything running as the user, including the agent's
 * own shell. So it is safe by construction: nothing here returns a secret, and
 * nothing here can approve a proposal or change where an existing secret is sent.
 */
export const DEFAULT_SOCKET_PATH = join(homedir(), '.keybroker', 'agent.sock');

export interface CredentialSummary {
  name: string;
  hosts: string[];
  auth: AuthScheme;
  authDescription: string;
  envVar?: string;
  docsUrl?: string;
  hasSecret: boolean;
  /** What the env var holds in agent shells. */
  placeholder: string;
}

export interface TestRequest {
  method?: 'GET' | 'HEAD';
  /** Path on the first host, e.g. `/v1/user`. Should succeed with a valid key. */
  path: string;
}

export interface ProposalInput {
  name: string;
  hosts: string[];
  auth: AuthScheme;
  envVar?: string;
  docsUrl?: string;
  notes?: string;
  testRequest?: TestRequest;
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface Proposal extends ProposalInput {
  id: string;
  status: ProposalStatus;
  createdAt: string;
  /** Label of a built-in preset with the same hosts and auth, if any. */
  matchesPreset?: string;
  /** Result of the test request after approval. Status only, never the body. */
  test?: { ok: boolean; status?: number; error?: string };
  /** The credential as the user saved it; they may have edited the proposal. */
  credential?: CredentialSummary;
}

export interface RequestInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Write the response body to this file instead of returning it (for audio, images, …). */
  saveTo?: string;
}

export interface RequestResult {
  status: number;
  headers: Record<string, string>;
  /** Text bodies up to a limit; binary bodies need `saveTo`. */
  body?: string;
  bodyTruncated?: boolean;
  bytes: number;
  savedTo?: string;
  /** Which credential was attached, if any. */
  credential?: string;
}

export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Which agent is calling, from the launcher's `--client` flag (e.g. `claude-desktop`).
 * Self-reported, so it's for conveniences like pausing an agent, never for security.
 */
export const CLIENT_HEADER = 'x-keybroker-client';

export interface CallContext {
  client?: string;
}

export interface AgentApiHandlers {
  listCredentials(ctx: CallContext): Promise<CredentialSummary[]> | CredentialSummary[];
  propose(input: ProposalInput, ctx: CallContext): Promise<Proposal>;
  /** Resolves when the proposal leaves `pending` or after `waitMs`, whichever is first. */
  getProposal(id: string, waitMs: number, ctx: CallContext): Promise<Proposal>;
  request(input: RequestInput, ctx: CallContext): Promise<RequestResult>;
}

/** HTTP status for "this agent is paused in Keybroker". */
export const PAUSED_STATUS = 423;
export type { AuthScheme } from '@keybroker/core';
