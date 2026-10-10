import type { AuthScheme } from './types.js';

export type Headers = Record<string, string | string[] | undefined>;

export interface OutgoingRequest {
  url: URL;
  headers: Headers;
}

function setHeader(headers: Headers, name: string, value: string) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) delete headers[key];
  }
  headers[lower] = value;
}

function basicCredentials(auth: Extract<AuthScheme, { type: 'basic' }>, secret: string): string {
  return auth.username ? `${auth.username}:${secret}` : secret;
}

/** Attach the secret to the request according to its auth scheme. Overwrites whatever placeholder was there. */
export function applyAuth(request: OutgoingRequest, auth: AuthScheme, secret: string): void {
  switch (auth.type) {
    case 'header':
      setHeader(request.headers, auth.header, `${auth.prefix ?? ''}${secret}`);
      return;
    case 'bearer':
      setHeader(request.headers, 'authorization', `Bearer ${secret}`);
      return;
    case 'query':
      request.url.searchParams.set(auth.param, secret);
      return;
    case 'basic':
      setHeader(
        request.headers,
        'authorization',
        `Basic ${Buffer.from(basicCredentials(auth, secret)).toString('base64')}`,
      );
      return;
  }
}

/** Every form the secret could take on the wire, so responses can be scrubbed of any of them. */
export function secretVariants(auth: AuthScheme, secret: string): string[] {
  const variants = new Set([secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')]);
  if (auth.type === 'basic') variants.add(Buffer.from(basicCredentials(auth, secret)).toString('base64'));
  // Very short secrets would make scrubbing redact random bytes; they're also not real API keys.
  return [...variants].filter((v) => v.length >= 8);
}

export function describeAuth(auth: AuthScheme): string {
  switch (auth.type) {
    case 'header':
      return `header ${auth.header}${auth.prefix ? ` (prefix "${auth.prefix}")` : ''}`;
    case 'bearer':
      return 'Authorization: Bearer';
    case 'query':
      return `query param ${auth.param}`;
    case 'basic':
      return auth.username ? `Basic auth (user ${auth.username})` : 'Basic auth';
  }
}
