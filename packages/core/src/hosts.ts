import type { Credential, ResolvedCredential } from './types.js';

/** `api.example.com` matches exactly; `*.example.com` matches any subdomain but not the apex. */
export function hostMatches(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase();
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (p.startsWith('*.')) {
    const suffix = p.slice(1);
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return p === h;
}

export function credentialMatchesHost(credential: Credential, host: string): boolean {
  return credential.hosts.some((pattern) => hostMatches(pattern, host));
}

/** Prefer the credential the request named via placeholder; otherwise the first one bound to the host. */
export function findCredentialForHost(
  credentials: ResolvedCredential[],
  host: string,
  preferredName?: string,
): ResolvedCredential | undefined {
  const matching = credentials.filter((c) => credentialMatchesHost(c.credential, host));
  if (preferredName) {
    const named = matching.find((c) => c.credential.name === preferredName);
    if (named) return named;
  }
  return matching[0];
}

const HOST_PATTERN = /^([a-z0-9-]+\.)+[a-z0-9-]+$|^localhost$/;

/**
 * Exact hosts, or wildcards with at least two labels after the `*.`, so `*.example.com`
 * is allowed but `*.io` (every .io site) is not.
 */
export function isValidHostPattern(pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (p.startsWith('*.')) {
    const rest = p.slice(2);
    return HOST_PATTERN.test(rest) && rest.split('.').length >= 2;
  }
  return HOST_PATTERN.test(p);
}

/** True if `host` is `domain` or a subdomain of it. Dot-bounded, so `evilexample.com` doesn't match `example.com`. */
export function isWithinDomain(host: string, domain: string): boolean {
  const h = host.replace(/^\*\./, '').toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}
