/** How a secret is attached to an outgoing request. */
export type AuthScheme =
  /** Arbitrary header, e.g. `xi-api-key: <secret>` or `Authorization: Token <secret>`. */
  | { type: 'header'; header: string; prefix?: string }
  /** `Authorization: Bearer <secret>`. */
  | { type: 'bearer' }
  /** `?<param>=<secret>` on the URL. */
  | { type: 'query'; param: string }
  /** `Authorization: Basic base64(username:secret)`. Without a username the secret is `user:pass`. */
  | { type: 'basic'; username?: string };

/** Everything about a credential except the secret value. Safe to show to agents. */
export interface Credential {
  /** Stable identifier, lowercase, e.g. `elevenlabs`. Used in placeholders. */
  name: string;
  /** Hosts the secret may be sent to. Exact (`api.elevenlabs.io`) or wildcard (`*.example.com`). */
  hosts: string[];
  auth: AuthScheme;
  /** Env var SDKs read the key from; gets a placeholder value in the agent's shell. */
  envVar?: string;
  docsUrl?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** A credential plus its secret. Only ever exists inside the broker process. */
export interface ResolvedCredential {
  credential: Credential;
  secret: string;
}

export interface CertificateAuthority {
  key: string;
  cert: string;
}

export interface VaultData {
  version: 1;
  credentials: Credential[];
  secrets: Record<string, string>;
  ca?: CertificateAuthority;
  /** Agents the user has paused (by launcher --client name). In the vault so agents can't unpause themselves. */
  pausedClients?: string[];
}
