#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { AgentClient, AgentClientError, type AuthScheme, type Proposal } from '@keybroker/agent-api';
import { promptGuardHook, sessionStartHook } from './hooks.js';
import { runMcpServer } from './mcp.js';

const HELP = `keybroker: use API keys without seeing them

Usage:
  keybroker list [--json]
  keybroker propose --name <id> --host <host> [--host <host>…] --auth <scheme>
                    [--env-var NAME] [--docs URL] [--notes TEXT] [--test-path /path]
                    [--wait SECONDS] [--json]
  keybroker status <proposal-id> [--wait SECONDS] [--json]
  keybroker request <url> [-X METHOD] [-H 'Name: value']… [-d BODY] [-o FILE]
  keybroker mcp [--client NAME]
                           Run the MCP server on stdio (NAME lets the user pause this agent)
  keybroker relay [--port 47123] [--upstream 47124]
                           Always-on proxy front door (run by launchd)
  keybroker hook session-start | prompt-guard
                           Claude Code hooks (read hook JSON on stdin)

Auth schemes: bearer | header:<Name>[:<prefix>] | query:<param> | basic[:<username>]

API keys are never printed. To add one, propose it and the user enters the key in the Keybroker app.`;

function parseAuth(spec: string): AuthScheme {
  const [type, a, ...rest] = spec.split(':');
  switch (type) {
    case 'bearer':
      return { type: 'bearer' };
    case 'header':
      if (!a) throw new Error('header auth needs a header name: header:xi-api-key');
      return { type: 'header', header: a, ...(rest.length ? { prefix: rest.join(':') } : {}) };
    case 'query':
      if (!a) throw new Error('query auth needs a parameter name: query:api_key');
      return { type: 'query', param: a };
    case 'basic':
      return { type: 'basic', ...(a ? { username: a } : {}) };
    default:
      throw new Error(`Unknown auth scheme "${spec}"`);
  }
}

function printProposal(p: Proposal) {
  if (p.status === 'approved') {
    const test = p.test ? (p.test.ok ? `test OK (HTTP ${p.test.status})` : `test FAILED (${p.test.status ?? p.test.error})`) : 'no test';
    console.log(`approved: ${p.credential?.name} → ${p.credential?.hosts.join(', ')} · ${test}`);
    if (p.credential?.envVar) console.log(`${p.credential.envVar}=${p.credential.placeholder} in agent shells`);
  } else if (p.status === 'pending') {
    console.log(`pending: waiting for the user to review it in Keybroker. Check again with: keybroker status ${p.id} --wait 300`);
  } else {
    console.log(`${p.status}`);
  }
}

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  const client = new AgentClient();

  switch (command) {
    case 'mcp': {
      const { values } = parseArgs({ args: rest, options: { client: { type: 'string' } } });
      return runMcpServer(values.client ?? process.env.KEYBROKER_CLIENT);
    }

    case 'relay': {
      // Run by launchd so agent shells never lose network access when the app is closed.
      const { values } = parseArgs({ args: rest, options: { port: { type: 'string', default: '47123' }, upstream: { type: 'string', default: '47124' } } });
      const { startRelay } = await import('@keybroker/proxy/src/relay');
      await startRelay({ port: Number(values.port), upstreamPort: Number(values.upstream), onError: (e) => console.error(e.message) });
      console.error(`keybroker relay on 127.0.0.1:${values.port} → app proxy :${values.upstream} (direct when the app is closed)`);
      return new Promise(() => {});
    }

    case 'hook':
      if (rest[0] === 'session-start') return sessionStartHook();
      if (rest[0] === 'prompt-guard') return promptGuardHook();
      throw new Error('Usage: keybroker hook session-start|prompt-guard');

    case 'list': {
      const { values } = parseArgs({ args: rest, options: { json: { type: 'boolean' } } });
      const creds = await client.listCredentials();
      if (values.json) return console.log(JSON.stringify(creds, null, 2));
      if (creds.length === 0) return console.log('No credentials. Propose one with `keybroker propose`.');
      for (const c of creds) {
        console.log(`${c.name}${c.hasSecret ? '' : ' (no key yet)'}`);
        console.log(`  hosts: ${c.hosts.join(', ')}`);
        console.log(`  auth:  ${c.authDescription}`);
        if (c.envVar) console.log(`  env:   ${c.envVar}=${c.placeholder}`);
      }
      return;
    }

    case 'propose': {
      const { values } = parseArgs({
        args: rest,
        options: {
          name: { type: 'string' },
          host: { type: 'string', multiple: true },
          auth: { type: 'string' },
          'env-var': { type: 'string' },
          docs: { type: 'string' },
          notes: { type: 'string' },
          'test-path': { type: 'string' },
          wait: { type: 'string', default: '300' },
          json: { type: 'boolean' },
        },
      });
      if (!values.name || !values.host?.length || !values.auth) throw new Error('--name, --host and --auth are required');
      const proposal = await client.propose({
        name: values.name,
        hosts: values.host,
        auth: parseAuth(values.auth),
        envVar: values['env-var'],
        docsUrl: values.docs,
        notes: values.notes,
        testRequest: values['test-path'] ? { method: 'GET', path: values['test-path'] } : undefined,
      });
      if (!values.json) console.error(`Proposed "${proposal.name}". Waiting for the user to review it in Keybroker…`);
      const result = await client.getProposal(proposal.id, Number(values.wait));
      return values.json ? console.log(JSON.stringify(result, null, 2)) : printProposal(result);
    }

    case 'status': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { wait: { type: 'string', default: '0' }, json: { type: 'boolean' } },
      });
      if (!positionals[0]) throw new Error('Usage: keybroker status <proposal-id>');
      const result = await client.getProposal(positionals[0], Number(values.wait));
      return values.json ? console.log(JSON.stringify(result, null, 2)) : printProposal(result);
    }

    case 'request': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          X: { type: 'string', short: 'X' },
          H: { type: 'string', short: 'H', multiple: true },
          d: { type: 'string', short: 'd' },
          o: { type: 'string', short: 'o' },
        },
      });
      if (!positionals[0]) throw new Error('Usage: keybroker request <url>');
      const headers: Record<string, string> = {};
      for (const h of values.H ?? []) {
        const i = h.indexOf(':');
        if (i < 1) throw new Error(`Bad header "${h}"`);
        headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
      }
      const result = await client.request({
        url: positionals[0],
        method: values.X ?? (values.d ? 'POST' : 'GET'),
        headers,
        body: values.d,
        saveTo: values.o ? (await import('node:path')).resolve(values.o) : undefined,
      });
      console.error(`HTTP ${result.status}${result.credential ? ` · via ${result.credential}` : ''} · ${result.bytes} bytes`);
      if (result.savedTo) console.error(`saved to ${result.savedTo}`);
      else if (result.body !== undefined) console.log(result.body);
      if (result.status >= 400) process.exitCode = 22;
      return;
    }

    case undefined:
    case '-h':
    case '--help':
    case 'help':
      return console.log(HELP);

    default:
      throw new Error(`Unknown command "${command}". Run keybroker --help`);
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`keybroker: ${err instanceof AgentClientError || err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
