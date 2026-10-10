import { appendFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentClient, AgentClientError, PAUSED_STATUS, type CredentialSummary } from '@keybroker/agent-api';
import { ALLOW_MARKER, findLikelySecret } from './secret-patterns.js';

const ENV_FILE = join(homedir(), '.keybroker', 'env.sh');

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function emit(output: object) {
  process.stdout.write(JSON.stringify(output));
}

function describeCredentials(creds: CredentialSummary[]): string {
  if (creds.length === 0) return 'No APIs are configured yet.';
  return creds
    .map((c) => `- ${c.name}: ${c.hosts.join(', ')} (${c.authDescription}${c.envVar ? `; $${c.envVar} holds a placeholder that works as the key` : ''})`)
    .join('\n');
}

/**
 * SessionStart: when Keybroker is running, route this session's Bash through the proxy
 * (via CLAUDE_ENV_FILE) and tell Claude what's configured. When it isn't, change nothing,
 * so a closed app never breaks the session's network access.
 */
export async function sessionStartHook() {
  await readStdin();
  let creds: CredentialSummary[];
  try {
    creds = await new AgentClient(undefined, 'claude-code').listCredentials();
  } catch (err) {
    if (err instanceof AgentClientError && err.status === PAUSED_STATUS) {
      return emit({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext:
            'Keybroker (API key manager) is paused for Claude Code, so API keys are unavailable in this session. If the user needs an API that requires a key, tell them they can resume Keybroker for Claude Code in the Keybroker app and start a new session. Never ask the user to paste an API key.',
        },
      });
    }
    return emit({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          'Keybroker (API key manager) is installed but its app is not running, so API keys are unavailable in this session. If the user needs an API that requires a key, ask them to open the Keybroker app and start a new session. Never ask the user to paste an API key.',
      },
    });
  }

  const envFile = process.env.CLAUDE_ENV_FILE;
  let routed = false;
  if (envFile) {
    try {
      // CLAUDE_ENV_FILE accepts plain `export NAME=value` lines and comments.
      const lines = (await readFile(ENV_FILE, 'utf8')).split('\n').filter((l) => /^export [A-Za-z_][A-Za-z0-9_]*=/.test(l));
      await appendFile(envFile, `# Keybroker\n${lines.join('\n')}\n`);
      routed = true;
    } catch {
      // No env.sh yet: fall through and rely on the MCP http_request tool.
    }
  }

  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: [
        'Keybroker is active: it holds the user\'s API keys and attaches them to requests, so you never see or need the raw values.',
        routed
          ? 'Bash commands in this session are routed through Keybroker\'s proxy. Call configured APIs normally (curl, SDKs, scripts) using the env vars below; the real key is added for the allowed hosts. If HTTPS requests fail to connect to 127.0.0.1:47123, the Keybroker app was closed: ask the user to reopen it.'
          : 'Bash is not routed through Keybroker in this session; use the keybroker MCP http_request tool for authenticated calls.',
        `Configured APIs:\n${describeCredentials(creds)}`,
        'To use a new API, research its auth docs and call the keybroker propose_credential tool; the user adds the key in the Keybroker app. Never ask the user to paste a key into chat.',
      ].join('\n\n'),
    },
  });
}

/** UserPromptSubmit: stop pasted API keys before they reach Claude. */
export async function promptGuardHook() {
  let prompt = '';
  try {
    prompt = JSON.parse(await readStdin()).prompt ?? '';
  } catch {
    return; // Unparseable input: never block on our own error.
  }
  if (prompt.includes(ALLOW_MARKER)) return;
  const kind = findLikelySecret(prompt);
  if (!kind) return;
  emit({
    decision: 'block',
    reason:
      `Keybroker stopped this message because it looks like it contains a ${kind}, so Claude never saw it. ` +
      'Add keys in the Keybroker app instead (or ask Claude to propose a credential for the API). ' +
      'Claude Code may still have saved the text in your local transcript or prompt history, so if it was a real key, rotate it. ' +
      `If this was a false alarm, resend with "${ALLOW_MARKER}" anywhere in the message.`,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true },
  });
}
