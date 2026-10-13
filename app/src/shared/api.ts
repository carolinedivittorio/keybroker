import type { Credential, Preset } from '@keybroker/core';
import type { ProxyEvent, ProxyEventDetail } from '@keybroker/proxy';
import type { Proposal } from '@keybroker/agent-api';

export type { Proposal, ProxyEvent, ProxyEventDetail };

/** A credential as the UI sees it: never the secret, only whether one is stored. */
export interface CredentialView extends Credential {
  hasSecret: boolean;
  placeholder: string;
}

export interface BrokerStatus {
  proxyUrl: string;
  envFile: string;
  error?: string;
  /** Dev builds aren't a security boundary; the UI warns against storing real keys. */
  devBuild: boolean;
}

export interface IntegrationView {
  id: string;
  name: string;
  /** The agent is on this Mac. */
  detected: boolean;
  installed: boolean;
  /** The user paused Keybroker for this agent. */
  paused?: boolean;
  /** What Keybroker adds to this agent. */
  gives: string[];
  /** What this agent can't get, and why. */
  missing: string[];
  /** Exactly what installing changes: commands run and files edited. */
  changes: string[];
  note?: string;
  /** Set when the agent manages removal itself; shown instead of a Remove button. */
  removeHint?: string;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  version?: string;
  error?: string;
}

export type CredentialInput = Omit<Credential, 'createdAt' | 'updatedAt'>;

export interface KeybrokerApi {
  status(): Promise<BrokerStatus>;
  listCredentials(): Promise<CredentialView[]>;
  presets(): Promise<Preset[]>;
  /** `secret` is optional when editing: omitted keeps the stored one. */
  saveCredential(input: CredentialInput, secret?: string): Promise<{ ok: true } | { ok: false; error: string }>;
  deleteCredential(name: string): Promise<void>;
  recentEvents(): Promise<ProxyEvent[]>;
  /** Request and scrubbed response for one event; null once it has aged out. */
  eventDetail(id: string): Promise<ProxyEventDetail | null>;
  onEvent(callback: (event: ProxyEvent) => void): () => void;
  pendingProposals(): Promise<Proposal[]>;
  approveProposal(id: string, input: CredentialInput, secret: string): Promise<{ ok: true } | { ok: false; error: string }>;
  rejectProposal(id: string): Promise<void>;
  onProposalsChanged(callback: () => void): () => void;
  integrations(): Promise<IntegrationView[]>;
  setIntegration(id: string, install: boolean): Promise<{ ok: true } | { ok: false; error: string }>;
  pauseIntegration(id: string, paused: boolean): Promise<void>;
  updateState(): Promise<UpdateState>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
  installUpdate(): Promise<void>;
  copy(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}
