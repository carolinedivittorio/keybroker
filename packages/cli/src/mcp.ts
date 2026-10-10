import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AGENT_INSTRUCTIONS, AgentClient, type Proposal } from '@keybroker/agent-api';

const DEFAULT_WAIT_SECONDS = 240;

const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bearer') }).describe('Authorization: Bearer <key>'),
  z
    .object({
      type: z.literal('header'),
      header: z.string().describe('Header name, e.g. xi-api-key'),
      prefix: z.string().optional().describe('Text before the key, e.g. "Token "'),
    })
    .describe('Key sent in a custom header'),
  z.object({ type: z.literal('query'), param: z.string().describe('Query parameter name') }).describe('Key sent as ?param=<key>'),
  z
    .object({ type: z.literal('basic'), username: z.string().optional().describe('Fixed username; omit if the key is user:pass') })
    .describe('HTTP Basic auth'),
]);

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

function describeProposal(p: Proposal): string {
  switch (p.status) {
    case 'approved': {
      const test = p.test
        ? p.test.ok
          ? ` Test request succeeded (HTTP ${p.test.status}).`
          : ` Test request failed (${p.test.status ? `HTTP ${p.test.status}` : p.test.error}); the key or settings may be wrong.`
        : '';
      const env = p.credential?.envVar
        ? ` New sessions get ${p.credential.envVar}=${p.credential.placeholder}. In this session, either export that yourself or omit the auth header: the proxy attaches the key for these hosts either way.`
        : '';
      return `Approved: the user added "${p.credential?.name ?? p.name}" for ${p.credential?.hosts.join(', ')}.${test}${env}`;
    }
    case 'rejected':
      return 'The user rejected this proposal. Ask them how they want to proceed; do not ask for the key itself.';
    case 'expired':
      return 'The proposal expired before the user reviewed it. Propose again if still needed.';
    default:
      return `Still waiting for the user to review it in Keybroker (proposal id ${p.id}). Call credential_status with this id to keep waiting.`;
  }
}

export async function runMcpServer(clientName?: string) {
  const client = new AgentClient(undefined, clientName);
  const server = new McpServer({ name: 'keybroker', version: '0.1.0' }, { instructions: AGENT_INSTRUCTIONS });

  server.registerTool(
    'list_credentials',
    {
      description: 'List the APIs Keybroker can authenticate for you: name, allowed hosts, auth scheme and env var. Never returns key values.',
      annotations: { readOnlyHint: true },
    },
    async () => text(await client.listCredentials()),
  );

  server.registerTool(
    'propose_credential',
    {
      description:
        "Propose a new API credential after researching the API's auth docs. Opens a pre-filled form in Keybroker where the user pastes their key (never share it with you). Waits for the user, then reports whether it was approved and whether a test request succeeded.",
      inputSchema: {
        name: z.string().describe('Short lowercase id, e.g. "elevenlabs"'),
        hosts: z.array(z.string()).min(1).describe('API hostnames the key may be sent to, e.g. ["api.elevenlabs.io"]. Exact hosts or *.example.com'),
        auth: authSchema,
        env_var: z.string().optional().describe('Env var the official SDK reads, e.g. ELEVENLABS_API_KEY'),
        docs_url: z.string().optional().describe('https URL of the auth docs you used'),
        notes: z.string().optional().describe('One line telling the user where to create the key'),
        test_path: z.string().optional().describe('Cheap authenticated GET path on the first host to verify the key, e.g. /v1/user'),
        wait_seconds: z.number().int().min(0).max(600).optional().describe(`How long to wait for the user (default ${DEFAULT_WAIT_SECONDS})`),
      },
    },
    async (args) => {
      const proposal = await client.propose({
        name: args.name,
        hosts: args.hosts,
        auth: args.auth,
        envVar: args.env_var,
        docsUrl: args.docs_url,
        notes: args.notes,
        testRequest: args.test_path ? { method: 'GET', path: args.test_path } : undefined,
      });
      const result = await client.getProposal(proposal.id, args.wait_seconds ?? DEFAULT_WAIT_SECONDS);
      return text(`${describeProposal(result)}\n\n${JSON.stringify({ id: result.id, status: result.status, test: result.test }, null, 2)}`);
    },
  );

  server.registerTool(
    'credential_status',
    {
      description: 'Check on (and keep waiting for) a proposal made with propose_credential.',
      inputSchema: {
        id: z.string(),
        wait_seconds: z.number().int().min(0).max(600).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, wait_seconds }) => {
      const result = await client.getProposal(id, wait_seconds ?? DEFAULT_WAIT_SECONDS);
      return text(`${describeProposal(result)}\n\n${JSON.stringify({ id: result.id, status: result.status, test: result.test }, null, 2)}`);
    },
  );

  server.registerTool(
    'http_request',
    {
      description:
        "Make an HTTP request through Keybroker. If the URL's host has a credential, the key is attached automatically; don't add auth headers yourself. Use this when a shell isn't routed through Keybroker. Binary responses (audio, images) need save_to.",
      inputSchema: {
        url: z.string().describe('Full https URL'),
        method: z.string().optional().describe('Default GET'),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().optional().describe('Request body, e.g. JSON text'),
        save_to: z.string().optional().describe('Absolute path to write the response body to'),
      },
    },
    async ({ url, method, headers, body, save_to }) => {
      const result = await client.request({ url, method, headers, body, saveTo: save_to });
      return text(result);
    },
  );

  await server.connect(new StdioServerTransport());
}
