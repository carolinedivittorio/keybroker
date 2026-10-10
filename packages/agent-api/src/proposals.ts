import { randomUUID } from 'node:crypto';
import { AgentApiError, type Proposal, type ProposalInput } from './protocol.js';

/** Bounds how much an agent can spam the user with review dialogs. */
export const MAX_PENDING_PROPOSALS = 3;
const EXPIRE_AFTER_MS = 30 * 60 * 1000;

/** In-memory proposals with long-poll waiting. Proposals are short-lived, so nothing is persisted. */
export class ProposalStore {
  private proposals = new Map<string, Proposal>();
  private waiters = new Map<string, Set<() => void>>();

  constructor(private readonly onChange: () => void = () => {}) {}

  create(input: ProposalInput, extra: Pick<Proposal, 'matchesPreset'> = {}): Proposal {
    this.expireOld();
    // Re-proposing the same name while one is pending returns the existing one.
    const existing = this.pending().find((p) => p.name === input.name);
    if (existing) return existing;
    if (this.pending().length >= MAX_PENDING_PROPOSALS) {
      throw new AgentApiError('Too many proposals are waiting for the user. Wait for them to be reviewed first.', 429);
    }
    const proposal: Proposal = {
      ...input,
      ...extra,
      id: randomUUID(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.proposals.set(proposal.id, proposal);
    this.onChange();
    return structuredClone(proposal);
  }

  get(id: string): Proposal {
    this.expireOld();
    const p = this.proposals.get(id);
    if (!p) throw new AgentApiError(`No proposal with id ${id}`, 404);
    return structuredClone(p);
  }

  pending(): Proposal[] {
    return [...this.proposals.values()].filter((p) => p.status === 'pending').map((p) => structuredClone(p));
  }

  update(id: string, patch: Partial<Omit<Proposal, 'id'>>): Proposal {
    const p = this.proposals.get(id);
    if (!p) throw new AgentApiError(`No proposal with id ${id}`, 404);
    Object.assign(p, patch);
    if (p.status !== 'pending') {
      for (const wake of this.waiters.get(id) ?? []) wake();
      this.waiters.delete(id);
    }
    this.onChange();
    return structuredClone(p);
  }

  /** Resolves as soon as the proposal leaves `pending`, or after `ms`. */
  async wait(id: string, ms: number): Promise<Proposal> {
    const current = this.get(id);
    if (current.status !== 'pending' || ms <= 0) return current;
    await new Promise<void>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiters.get(id)?.delete(wake);
        resolve();
      }, ms);
      if (!this.waiters.has(id)) this.waiters.set(id, new Set());
      this.waiters.get(id)!.add(wake);
    });
    return this.get(id);
  }

  private expireOld() {
    const cutoff = Date.now() - EXPIRE_AFTER_MS;
    for (const p of this.proposals.values()) {
      if (p.status === 'pending' && Date.parse(p.createdAt) < cutoff) this.update(p.id, { status: 'expired' });
    }
  }
}
