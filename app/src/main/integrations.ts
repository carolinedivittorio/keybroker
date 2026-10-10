import { execFile } from 'node:child_process';
import { access, copyFile, cp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { AGENT_INSTRUCTIONS } from '@keybroker/agent-api';
import type { IntegrationView } from '../shared/api';

const run = promisify(execFile);
const HOME = homedir();
const BROKER_DIR = join(HOME, '.keybroker');
export const CLI_PATH = join(BROKER_DIR, 'bin', 'keybroker');
const MARKETPLACE_DIR = join(BROKER_DIR, 'integrations', 'claude-code');

// GUI apps get a minimal PATH, and guessing is fragile (e.g. a broken Homebrew `node` would
// win over the one the user actually uses). Ask the user's login shell for their real PATH,
// and only fall back to common install locations after it.
const FALLBACK_PATH = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(HOME, '.local/bin'),
  join(HOME, '.claude/local'),
  join(HOME, '.npm-global/bin'),
  join(HOME, '.bun/bin'),
  '/usr/bin',
  '/bin',
];

let searchPath: Promise<string[]> | undefined;
function getSearchPath(): Promise<string[]> {
  searchPath ??= run(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__KB__%s__KB__" "$PATH"'], { timeout: 5000 })
    .then(({ stdout }) => stdout.match(/__KB__(.*)__KB__/)?.[1]?.split(':') ?? [])
    .catch(() => [] as string[])
    .then((login) => [...new Set([...login, ...FALLBACK_PATH].filter(Boolean))]);
  return searchPath;
}

async function childEnv() {
  return { ...process.env, PATH: (await getSearchPath()).join(':') };
}

const exists = (p: string) => access(p).then(() => true, () => false);

async function findBinary(name: string): Promise<string | undefined> {
  for (const dir of await getSearchPath()) {
    if (await exists(join(dir, name))) return join(dir, name);
  }
  return undefined;
}

async function readJson(path: string): Promise<any> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`${path} isn't valid JSON, so Keybroker won't edit it.`);
  }
}

/** Every edit to someone else's config keeps a copy of the original next to it. */
async function backup(path: string) {
  if (await exists(path)) await copyFile(path, `${path}.keybroker-backup`);
}

async function writeJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await backup(path);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** Each agent's launcher names itself, so the user can pause it in Keybroker. */
const mcpArgs = (client: string) => ['mcp', '--client', client];

/** JSON configs with an `mcpServers` map (Cursor). */
function jsonMcpIntegration(opts: {
  id: string;
  client: string;
  name: string;
  appDir: string;
  configPath: string;
  restartNote: string;
}) {
  return {
    async view(): Promise<IntegrationView> {
      const detected = await exists(opts.appDir);
      const config = detected ? await readJson(opts.configPath).catch(() => ({})) : {};
      return {
        id: opts.id,
        name: opts.name,
        detected,
        installed: Boolean(config.mcpServers?.keybroker),
        gives: ['MCP tools: list, propose, request'],
        missing: ['Shell routing (no shell access through Keybroker)', 'Pasted-key guard'],
        changes: [`Adds "keybroker" to mcpServers in ${opts.configPath.replace(HOME, '~')} (backup kept)`],
        note: opts.restartNote,
      };
    },
    async install() {
      const config = await readJson(opts.configPath);
      config.mcpServers = { ...(config.mcpServers ?? {}), keybroker: { command: CLI_PATH, args: mcpArgs(opts.client) } };
      await writeJson(opts.configPath, config);
    },
    async uninstall() {
      const config = await readJson(opts.configPath);
      if (!config.mcpServers?.keybroker) return;
      delete config.mcpServers.keybroker;
      await writeJson(opts.configPath, config);
    },
  };
}

const CLAUDE_DESKTOP_DIR = join(HOME, 'Library/Application Support/Claude');
let mcpbPath: string | undefined;

/** Desktop unpacks installed extensions into its support dir; look for ours by manifest name. */
async function claudeDesktopExtensionDir(): Promise<string | undefined> {
  const dir = join(CLAUDE_DESKTOP_DIR, 'Claude Extensions');
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const entry of entries) {
    const manifest = await readJson(join(dir, entry, 'manifest.json')).catch(() => ({}));
    if (manifest.name === 'keybroker') return join(dir, entry);
  }
  return undefined;
}

const AGENTS_START = '<!-- keybroker:start -->';
const AGENTS_END = '<!-- keybroker:end -->';
const AGENTS_MD = join(HOME, '.codex', 'AGENTS.md');

function withoutKeybrokerBlock(text: string) {
  const start = text.indexOf(AGENTS_START);
  const end = text.indexOf(AGENTS_END);
  if (start === -1 || end === -1) return text;
  return (text.slice(0, start) + text.slice(end + AGENTS_END.length)).replace(/\n{3,}/g, '\n\n');
}

const integrations = {
  'claude-code': {
    async view(): Promise<IntegrationView> {
      const bin = await findBinary('claude');
      const entry = await readJson(join(HOME, '.claude/plugins/installed_plugins.json'))
        .then((d) => d.plugins?.['keybroker@keybroker']?.[0])
        .catch(() => undefined);
      return {
        id: 'claude-code',
        name: 'Claude Code',
        detected: Boolean(bin),
        installed: Boolean(entry),
        gives: ['Shell routing through the proxy', 'MCP tools: list, propose, request', 'Pasted-key guard', 'Session context about your APIs'],
        missing: [],
        changes: [
          `claude plugin marketplace add ${MARKETPLACE_DIR.replace(HOME, '~')}`,
          'claude plugin install keybroker@keybroker (user scope)',
        ],
        note: 'Applies to new Claude Code sessions.',
      };
    },
    async install() {
      const bin = await findBinary('claude');
      if (!bin) throw new Error('Claude Code CLI not found');
      // Re-adding an existing marketplace fails harmlessly; refresh it instead.
      const env = await childEnv();
      await run(bin, ['plugin', 'marketplace', 'add', MARKETPLACE_DIR], { env }).catch(() =>
        run(bin, ['plugin', 'marketplace', 'update', 'keybroker'], { env }),
      );
      await run(bin, ['plugin', 'install', 'keybroker@keybroker'], { env });
    },
    async uninstall() {
      const bin = await findBinary('claude');
      if (!bin) throw new Error('Claude Code CLI not found');
      await run(bin, ['plugin', 'uninstall', 'keybroker@keybroker'], { env: await childEnv() }).catch(() => {});
      await run(bin, ['plugin', 'marketplace', 'remove', 'keybroker'], { env: await childEnv() }).catch(() => {});
    },
  },

  codex: {
    async view(): Promise<IntegrationView> {
      const bin = await findBinary('codex');
      const server = bin
        ? await run(bin, ['mcp', 'get', 'keybroker', '--json'], { env: await childEnv() }).then(
            ({ stdout }) => JSON.parse(stdout),
            () => undefined,
          )
        : undefined;
      return {
        id: 'codex',
        name: 'Codex',
        detected: Boolean(bin),
        installed: Boolean(server),
        gives: ['MCP tools: list, propose, request', 'Instructions in ~/.codex/AGENTS.md'],
        missing: ["Shell routing (Codex's sandbox blocks network by default; Codex uses http_request instead)", 'Pasted-key guard'],
        changes: [`codex mcp add keybroker -- ${CLI_PATH.replace(HOME, '~')} mcp --client codex`, 'Adds a marked Keybroker section to ~/.codex/AGENTS.md (backup kept)'],
        note: 'Applies to new Codex sessions.',
      };
    },
    async install() {
      const bin = await findBinary('codex');
      if (!bin) throw new Error('Codex CLI not found');
      await run(bin, ['mcp', 'remove', 'keybroker'], { env: await childEnv() }).catch(() => {});
      await run(bin, ['mcp', 'add', 'keybroker', '--', CLI_PATH, ...mcpArgs('codex')], { env: await childEnv() });
      const current = await readFile(AGENTS_MD, 'utf8').catch(() => '');
      const block = `${AGENTS_START}\n## Keybroker\n\n${AGENTS_INSTRUCTIONS_FOR_CODEX}\n${AGENTS_END}\n`;
      await backup(AGENTS_MD);
      await writeFile(AGENTS_MD, `${withoutKeybrokerBlock(current).trimEnd()}${current.trim() ? '\n\n' : ''}${block}`);
    },
    async uninstall() {
      const bin = await findBinary('codex');
      if (bin) await run(bin, ['mcp', 'remove', 'keybroker'], { env: await childEnv() }).catch(() => {});
      const current = await readFile(AGENTS_MD, 'utf8').catch(() => undefined);
      if (current?.includes(AGENTS_START)) {
        await backup(AGENTS_MD);
        await writeFile(AGENTS_MD, withoutKeybrokerBlock(current).trimEnd() + '\n');
      }
    },
  },

  // Claude Desktop rewrites claude_desktop_config.json from memory while it runs, so edits
  // from outside get lost. Its own extension format (.mcpb) is managed by Desktop instead.
  'claude-desktop': {
    async view(): Promise<IntegrationView> {
      const extDir = await claudeDesktopExtensionDir();
      return {
        id: 'claude-desktop',
        name: 'Claude Desktop',
        detected: await exists(CLAUDE_DESKTOP_DIR),
        installed: Boolean(extDir),
        gives: ['MCP tools: list, propose, request (chat)'],
        missing: ['Shell routing (Desktop chat has no shell)', 'Pasted-key guard (Desktop has no hooks)'],
        changes: ["Opens keybroker.mcpb in Claude Desktop; you confirm in Desktop's install dialog"],
        note: 'Claude Code (including the Code tab) uses the Claude Code plugin instead.',
        removeHint: 'Remove it in Claude Desktop → Settings → Extensions.',
      };
    },
    async install() {
      if (!mcpbPath || !(await exists(mcpbPath))) throw new Error('The Claude Desktop extension is missing from this build of Keybroker.');
      await run('/usr/bin/open', ['-a', 'Claude', mcpbPath]);
    },
    async uninstall() {
      // Desktop owns its extensions; the row shows removeHint instead of a Remove button.
    },
  },

  cursor: jsonMcpIntegration({
    id: 'cursor',
    client: 'cursor',
    name: 'Cursor',
    appDir: join(HOME, '.cursor'),
    configPath: join(HOME, '.cursor/mcp.json'),
    restartNote: 'Reload Cursor afterwards.',
  }),
};

/** Codex reads AGENTS.md, not MCP instructions, so it gets them here (minus shell-routing details). */
const AGENTS_INSTRUCTIONS_FOR_CODEX = AGENT_INSTRUCTIONS.replace(
  /- In shells that have sourced[\s\S]*?- If a shell isn't set up, or a tool ignores HTTPS_PROXY, use the http_request tool instead\./,
  '- Make authenticated calls with the keybroker http_request MCP tool. Don\'t add auth headers; the key is attached for the credential\'s hosts.',
);

export type IntegrationId = keyof typeof integrations;

export const INTEGRATION_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
};

export async function listIntegrations(paused: string[]): Promise<IntegrationView[]> {
  const views = await Promise.all(Object.values(integrations).map((i) => i.view()));
  return views.map((v) => ({ ...v, paused: paused.includes(v.id) }));
}

export async function setIntegration(id: string, install: boolean) {
  const integration = integrations[id as IntegrationId];
  if (!integration) throw new Error(`Unknown integration ${id}`);
  if (install) await integration.install();
  else await integration.uninstall();
}

/**
 * Put the CLI and the Claude Code marketplace at stable paths under ~/.keybroker, so agent
 * configs never point inside the app bundle (which is replaced on update). Sources are the
 * bundle's Resources when packaged, or the repo in dev.
 */
export async function ensureTools(sources: { cliBinary: string; marketplace: string; desktopExtension: string }) {
  mcpbPath = sources.desktopExtension;
  await mkdir(dirname(CLI_PATH), { recursive: true });
  await rm(CLI_PATH, { force: true });
  await symlink(sources.cliBinary, CLI_PATH);
  await rm(MARKETPLACE_DIR, { recursive: true, force: true });
  await mkdir(dirname(MARKETPLACE_DIR), { recursive: true });
  await cp(sources.marketplace, MARKETPLACE_DIR, { recursive: true });
}
