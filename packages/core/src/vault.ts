import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isValidHostPattern } from './hosts.js';
import type { CertificateAuthority, Credential, ResolvedCredential, VaultData } from './types.js';

/** Encrypts the vault at rest. In the app this is Electron safeStorage (key lives in Keychain). */
export interface Cipher {
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

/** Test/dev cipher. Not encryption. */
export const plaintextCipher: Cipher = {
  encrypt: (s) => Buffer.from(s, 'utf8'),
  decrypt: (b) => b.toString('utf8'),
};

interface Envelope {
  data: VaultData;
  /** Detects tampering: anything editing the ciphertext can't produce a matching digest. */
  digest: string;
}

const digestOf = (data: VaultData) => createHash('sha256').update(JSON.stringify(data)).digest('hex');

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export class VaultError extends Error {}

/**
 * Credentials, secrets and rules in one encrypted file. Rules live inside the encrypted
 * envelope on purpose: an agent that can write files must not be able to rebind a
 * secret to a new host by editing a config file.
 */
export class Vault {
  private constructor(
    private readonly path: string,
    private readonly cipher: Cipher,
    private data: VaultData,
  ) {}

  static async open(path: string, cipher: Cipher): Promise<Vault> {
    let raw: Buffer;
    try {
      raw = await readFile(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return new Vault(path, cipher, { version: 1, credentials: [], secrets: {} });
      }
      throw err;
    }
    let envelope: Envelope;
    try {
      envelope = JSON.parse(cipher.decrypt(raw));
    } catch {
      throw new VaultError(`Vault at ${path} could not be decrypted`);
    }
    if (digestOf(envelope.data) !== envelope.digest) throw new VaultError(`Vault at ${path} failed integrity check`);
    return new Vault(path, cipher, envelope.data);
  }

  static inMemory(data?: Partial<VaultData>): Vault {
    return new Vault('', plaintextCipher, { version: 1, credentials: [], secrets: {}, ...data });
  }

  listCredentials(): Credential[] {
    return structuredClone(this.data.credentials);
  }

  getCredential(name: string): Credential | undefined {
    const c = this.data.credentials.find((c) => c.name === name);
    return c && structuredClone(c);
  }

  hasSecret(name: string): boolean {
    return Boolean(this.data.secrets[name]);
  }

  /** Credentials that have a secret set. Only the proxy should call this. */
  resolved(): ResolvedCredential[] {
    return this.data.credentials
      .filter((c) => this.data.secrets[c.name])
      .map((c) => ({ credential: structuredClone(c), secret: this.data.secrets[c.name] }));
  }

  /** Create or replace a credential. Passing `secret` sets it; omitting it keeps the existing one. */
  async upsert(input: Omit<Credential, 'createdAt' | 'updatedAt'>, secret?: string): Promise<Credential> {
    validateCredentialInput(input);
    const now = new Date().toISOString();
    const existing = this.data.credentials.find((c) => c.name === input.name);
    const credential: Credential = {
      ...input,
      hosts: input.hosts.map((h) => h.trim().toLowerCase()),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.data.credentials = existing
      ? this.data.credentials.map((c) => (c.name === input.name ? credential : c))
      : [...this.data.credentials, credential];
    if (secret !== undefined && secret !== '') this.data.secrets[input.name] = secret;
    await this.save();
    return structuredClone(credential);
  }

  async remove(name: string): Promise<void> {
    this.data.credentials = this.data.credentials.filter((c) => c.name !== name);
    delete this.data.secrets[name];
    await this.save();
  }

  pausedClients(): string[] {
    return [...(this.data.pausedClients ?? [])];
  }

  isPaused(client: string | undefined): boolean {
    return Boolean(client && this.data.pausedClients?.includes(client));
  }

  async setPaused(client: string, paused: boolean): Promise<void> {
    const others = (this.data.pausedClients ?? []).filter((c) => c !== client);
    this.data.pausedClients = paused ? [...others, client] : others;
    await this.save();
  }

  getCA(): CertificateAuthority | undefined {
    return this.data.ca && { ...this.data.ca };
  }

  async setCA(ca: CertificateAuthority): Promise<void> {
    this.data.ca = { ...ca };
    await this.save();
  }

  private async save(): Promise<void> {
    if (!this.path) return;
    const envelope: Envelope = { data: this.data, digest: digestOf(this.data) };
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, this.cipher.encrypt(JSON.stringify(envelope)), { mode: 0o600 });
    await rename(tmp, this.path);
  }
}

export function validateCredentialInput(input: Omit<Credential, 'createdAt' | 'updatedAt'>) {
  if (!NAME_RE.test(input.name)) throw new VaultError('Name must be lowercase letters, digits, - or _');
  if (input.hosts.length === 0) throw new VaultError('At least one host is required');
  for (const host of input.hosts) {
    if (!isValidHostPattern(host)) throw new VaultError(`Invalid host: ${host}`);
  }
  const auth = input.auth;
  if (auth.type === 'header' && !/^[A-Za-z0-9-]+$/.test(auth.header)) throw new VaultError('Invalid header name');
  if (auth.type === 'query' && !auth.param) throw new VaultError('Query param name is required');
  if (input.envVar && !/^[A-Z_][A-Z0-9_]*$/.test(input.envVar)) throw new VaultError('Env var must be UPPER_SNAKE_CASE');
}
