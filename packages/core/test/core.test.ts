import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyAuth,
  findPlaceholders,
  hostMatches,
  isValidHostPattern,
  isWithinDomain,
  plaintextCipher,
  REDACTED,
  scrubBuffer,
  secretVariants,
  Vault,
  VaultError,
  type Headers,
} from '../src/index.js';

describe('hostMatches', () => {
  it('matches exact hosts case-insensitively', () => {
    expect(hostMatches('api.elevenlabs.io', 'API.ElevenLabs.io')).toBe(true);
    expect(hostMatches('api.elevenlabs.io', 'api.elevenlabs.io.evil.com')).toBe(false);
    expect(hostMatches('api.elevenlabs.io', 'elevenlabs.io')).toBe(false);
  });
  it('rejects wildcards broader than one registrable domain', () => {
    expect(isValidHostPattern('*.io')).toBe(false);
    expect(isValidHostPattern('*.example.com')).toBe(true);
    expect(isValidHostPattern('*')).toBe(false);
  });
  it('checks docs domains on a dot boundary', () => {
    expect(isWithinDomain('api.elevenlabs.io', 'elevenlabs.io')).toBe(true);
    expect(isWithinDomain('evilelevenlabs.io', 'elevenlabs.io')).toBe(false);
  });
  it('matches wildcard subdomains but not the apex or lookalikes', () => {
    expect(hostMatches('*.example.com', 'a.example.com')).toBe(true);
    expect(hostMatches('*.example.com', 'example.com')).toBe(false);
    expect(hostMatches('*.example.com', 'evilexample.com')).toBe(false);
  });
});

describe('applyAuth', () => {
  const req = () => ({ url: new URL('https://api.x.com/v1?a=1'), headers: { 'XI-API-KEY': 'keybroker-managed:x' } as Headers });
  it('replaces a custom header regardless of case', () => {
    const r = req();
    applyAuth(r, { type: 'header', header: 'xi-api-key' }, 's3cret');
    expect(r.headers).toEqual({ 'xi-api-key': 's3cret' });
  });
  it('supports bearer, query and basic', () => {
    const b = req();
    applyAuth(b, { type: 'bearer' }, 'tok');
    expect(b.headers.authorization).toBe('Bearer tok');
    const q = req();
    applyAuth(q, { type: 'query', param: 'key' }, 'tok');
    expect(q.url.searchParams.get('key')).toBe('tok');
    const basic = req();
    applyAuth(basic, { type: 'basic', username: 'api' }, 'pw');
    expect(basic.headers.authorization).toBe(`Basic ${Buffer.from('api:pw').toString('base64')}`);
  });
});

describe('placeholders and scrubbing', () => {
  it('finds placeholders including URL-encoded ones', () => {
    expect(findPlaceholders('x keybroker-managed:elevenlabs y', 'key=keybroker-managed%3Astripe')).toEqual(['elevenlabs', 'stripe']);
  });
  it('scrubs raw and encoded forms of the secret', () => {
    const secret = 'sk_live_abcdef123456';
    const needles = secretVariants({ type: 'bearer' }, secret);
    const body = Buffer.from(`echo ${secret} and ${Buffer.from(secret).toString('base64')}`);
    const out = scrubBuffer(body, needles);
    expect(out.redactions).toBe(2);
    expect(out.body.toString()).toBe(`echo ${REDACTED} and ${REDACTED}`);
  });
});

describe('Vault', () => {
  const input = { name: 'elevenlabs', hosts: ['api.elevenlabs.io'], auth: { type: 'header' as const, header: 'xi-api-key' }, envVar: 'ELEVENLABS_API_KEY' };

  it('round-trips through disk and keeps secrets out of listings', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'kb-')), 'vault.bin');
    const v = await Vault.open(path, plaintextCipher);
    await v.upsert(input, 'secret-value-1');
    const reopened = await Vault.open(path, plaintextCipher);
    expect(reopened.listCredentials()[0]).not.toHaveProperty('secret');
    expect(reopened.resolved()[0].secret).toBe('secret-value-1');
    // Updating without a secret keeps the old one.
    await reopened.upsert({ ...input, notes: 'hi' });
    expect(reopened.resolved()[0].secret).toBe('secret-value-1');
  });

  it('rejects a vault whose rules were edited behind its back', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'kb-')), 'vault.bin');
    const v = await Vault.open(path, plaintextCipher);
    await v.upsert(input, 'secret-value-1');
    const raw = await readFile(path, 'utf8');
    await writeFile(path, raw.replace('api.elevenlabs.io', 'evil.example.com'));
    await expect(Vault.open(path, plaintextCipher)).rejects.toThrow(VaultError);
  });

  it('validates names and hosts', async () => {
    const v = Vault.inMemory();
    await expect(v.upsert({ ...input, name: 'Bad Name' })).rejects.toThrow(VaultError);
    await expect(v.upsert({ ...input, hosts: ['https://api.x.com/'] })).rejects.toThrow(VaultError);
  });
});

describe('paused agents', () => {
  it('persist inside the vault', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'kb-')), 'vault.bin');
    const v = await Vault.open(path, plaintextCipher);
    await v.setPaused('claude-desktop', true);
    const reopened = await Vault.open(path, plaintextCipher);
    expect(reopened.isPaused('claude-desktop')).toBe(true);
    expect(reopened.isPaused('codex')).toBe(false);
    expect(reopened.isPaused(undefined)).toBe(false);
    await reopened.setPaused('claude-desktop', false);
    expect(reopened.pausedClients()).toEqual([]);
  });
});
