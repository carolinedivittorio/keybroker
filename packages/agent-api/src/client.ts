import { request } from 'node:http';
import {
  CLIENT_HEADER,
  DEFAULT_SOCKET_PATH,
  type CredentialSummary,
  type Proposal,
  type ProposalInput,
  type RequestInput,
  type RequestResult,
} from './protocol.js';

export class AgentClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class AgentClient {
  constructor(
    readonly socketPath = process.env.KEYBROKER_SOCKET ?? DEFAULT_SOCKET_PATH,
    /** Which agent this is (from the launcher's --client), so the user can pause it. */
    readonly client?: string,
  ) {}

  private call<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        {
          socketPath: this.socketPath,
          method,
          path,
          headers: {
            ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
            ...(this.client ? { [CLIENT_HEADER]: this.client } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json: any;
            try {
              json = JSON.parse(text);
            } catch {
              return reject(new AgentClientError(`Bad response from Keybroker: ${text.slice(0, 200)}`, res.statusCode));
            }
            if ((res.statusCode ?? 500) >= 400) return reject(new AgentClientError(json.error ?? text, res.statusCode));
            resolve(json as T);
          });
        },
      );
      req.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
          reject(new AgentClientError('Keybroker is not running. Ask the user to open the Keybroker app.'));
        } else reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  listCredentials() {
    return this.call<CredentialSummary[]>('GET', '/v1/credentials');
  }

  propose(input: ProposalInput) {
    return this.call<Proposal>('POST', '/v1/proposals', input);
  }

  /** Long-polls for up to `waitSeconds` until the proposal is no longer pending. */
  getProposal(id: string, waitSeconds = 0) {
    return this.call<Proposal>('GET', `/v1/proposals/${encodeURIComponent(id)}?wait=${waitSeconds}`);
  }

  request(input: RequestInput) {
    return this.call<RequestResult>('POST', '/v1/request', input);
  }
}
