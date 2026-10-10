import { chmod, mkdir, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { AgentApiError, CLIENT_HEADER, type AgentApiHandlers, type CallContext } from './protocol.js';

const MAX_BODY = 5 * 1024 * 1024;
const MAX_WAIT_MS = 10 * 60 * 1000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new AgentApiError('Request body too large', 413);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AgentApiError('Body must be JSON');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** HTTP over a unix socket, so it's curl-able (`curl --unix-socket`) but not reachable from the network or browsers. */
export async function startAgentServer(handlers: AgentApiHandlers, socketPath: string): Promise<Server> {
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  await rm(socketPath, { force: true });

  const server = createServer(async (req, res) => {
    try {
      // Browsers can't speak to unix sockets, but refuse anything with an Origin regardless.
      if (req.headers.origin) throw new AgentApiError('Browser requests are not allowed', 403);
      const url = new URL(req.url ?? '/', 'http://keybroker');
      const route = `${req.method} ${url.pathname}`;
      const client = req.headers[CLIENT_HEADER];
      const ctx: CallContext = { client: typeof client === 'string' && /^[a-z0-9-]{1,40}$/.test(client) ? client : undefined };

      if (route === 'GET /v1/credentials') return send(res, 200, await handlers.listCredentials(ctx));
      if (route === 'POST /v1/proposals') return send(res, 201, await handlers.propose((await readJson(req)) as any, ctx));
      const proposal = url.pathname.match(/^\/v1\/proposals\/([\w-]+)$/);
      if (req.method === 'GET' && proposal) {
        const wait = Math.min(Number(url.searchParams.get('wait') ?? 0) * 1000 || 0, MAX_WAIT_MS);
        // Long polls must outlive Node's default request timeouts.
        req.socket.setTimeout(0);
        return send(res, 200, await handlers.getProposal(proposal[1], wait, ctx));
      }
      if (route === 'POST /v1/request') return send(res, 200, await handlers.request((await readJson(req)) as any, ctx));
      throw new AgentApiError(`No route for ${route}`, 404);
    } catch (err) {
      const status = err instanceof AgentApiError ? err.status : 500;
      send(res, status, { error: (err as Error).message });
    }
  });
  server.requestTimeout = 0;
  server.headersTimeout = 30_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  await chmod(socketPath, 0o600);
  return server;
}
