// Sample data for previewing the UI in a browser during development. Never bundled in production.
import type { KeybrokerApi, ProxyEvent, ProxyEventDetail } from '../../shared/api';

const now = Date.now();
const t = (s: number) => new Date(now - s * 1000).toISOString();
const events: ProxyEvent[] = [
  { id: 'e1', time: t(3600), action: 'injected', credential: 'elevenlabs', method: 'GET', host: 'api.elevenlabs.io', path: '/v1/user', status: 200, redactions: 0 },
  { id: 'e2', time: t(1800), action: 'injected', credential: 'elevenlabs', method: 'POST', host: 'api.elevenlabs.io', path: '/v1/text-to-speech/hpp4J3VqNfWAUOO0d1Us', status: 200, redactions: 0 },
  { id: 'e3', time: t(900), action: 'blocked', credential: 'elevenlabs', method: 'GET', host: 'api.elevenlabs.io', path: '/v1/user', status: 403, reason: 'Refusing to send credential "elevenlabs" over plain HTTP. Use https://api.elevenlabs.io/v1/user.' },
  { id: 'e4', time: t(120), action: 'injected', credential: 'cartesia', method: 'GET', host: 'api.cartesia.ai', path: '/voices', status: 401, redactions: 1 },
];
const detail: ProxyEventDetail = {
  request: { method: 'GET', url: 'https://api.elevenlabs.io/v1/user', headers: { host: 'api.elevenlabs.io', 'user-agent': 'curl/8.7.1', accept: '*/*', 'xi-api-key': 'keybroker-managed:elevenlabs' }, bodyBytes: 0, injectedAt: 'header xi-api-key' },
  response: { status: 200, headers: { 'content-type': 'application/json', 'content-length': '1218' }, contentType: 'application/json', bodyBytes: 1218, body: JSON.stringify({ user_id: 'user_123', subscription: { tier: 'free', character_count: 11, character_limit: 10000 }, xi_api_key_preview: null }) },
};
const cred = (name: string, hosts: string[], auth: any, envVar: string, hasSecret = true) => ({ name, hosts, auth, envVar, hasSecret, placeholder: `keybroker-managed:${name}`, createdAt: t(86400 * 2), updatedAt: t(86400) });

const stub: KeybrokerApi = {
  status: async () => ({ proxyUrl: 'http://127.0.0.1:47123', envFile: '/Users/you/.keybroker/env.sh', devBuild: false }),
  listCredentials: async () => [
    cred('elevenlabs', ['api.elevenlabs.io'], { type: 'header', header: 'xi-api-key' }, 'ELEVENLABS_API_KEY'),
    cred('cartesia', ['api.cartesia.ai'], { type: 'bearer' }, 'CARTESIA_API_KEY'),
    cred('stripe', ['api.stripe.com'], { type: 'bearer' }, 'STRIPE_API_KEY', false),
  ],
  presets: async () => [],
  saveCredential: async () => ({ ok: true }),
  deleteCredential: async () => {},
  recentEvents: async () => events,
  eventDetail: async () => detail,
  onEvent: () => () => {},
  pendingProposals: async () => (location.hash === '#proposal' ? [{ id: 'p1', name: 'resend', hosts: ['api.resend.com'], auth: { type: 'bearer' }, envVar: 'RESEND_API_KEY', docsUrl: 'https://resend.com/docs/api-reference/introduction', notes: 'Create a key at resend.com → API Keys.', testRequest: { method: 'GET', path: '/domains' }, status: 'pending', createdAt: t(5), matchesPreset: 'Resend' }] : []),
  approveProposal: async () => ({ ok: true }),
  rejectProposal: async () => {},
  onProposalsChanged: () => () => {},
  integrations: async () => [
    { id: 'claude-code', name: 'Claude Code', detected: true, installed: true, paused: false, gives: ['Shell routing', 'MCP tools', 'Pasted-key guard'], missing: [], changes: ['claude plugin marketplace add ~/.keybroker/integrations/claude-code', 'claude plugin install keybroker@keybroker (user scope)'], note: 'Applies to new Claude Code sessions.' },
    { id: 'codex', name: 'Codex', detected: true, installed: true, paused: true, gives: ['MCP tools', 'AGENTS.md instructions'], missing: ['Shell routing', 'Pasted-key guard'], changes: ['codex mcp add keybroker -- ~/.keybroker/bin/keybroker mcp --client codex'] },
    { id: 'claude-desktop', name: 'Claude Desktop', detected: true, installed: true, paused: false, gives: ['MCP tools (chat)'], missing: ['Shell routing', 'Pasted-key guard'], changes: ['Opens keybroker.mcpb in Claude Desktop'], removeHint: 'Remove it in Claude Desktop → Settings → Extensions.' },
    { id: 'cursor', name: 'Cursor', detected: true, installed: false, paused: false, gives: ['MCP tools'], missing: ['Shell routing', 'Pasted-key guard'], changes: ['Adds "keybroker" to mcpServers in ~/.cursor/mcp.json'] },
  ],
  setIntegration: async () => ({ ok: true }),
  pauseIntegration: async () => {},
  updateState: async () => (location.hash === '#update' ? { status: 'ready', version: '0.2.0' } : { status: 'idle' }),
  onUpdateState: () => () => {},
  installUpdate: async () => {},
  copy: async () => {},
  openExternal: async () => {},
};

window.keybroker = stub;
