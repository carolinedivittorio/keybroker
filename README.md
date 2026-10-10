# Keybroker

Let coding agents use your API keys without ever seeing them.

Keybroker is a small macOS app that keeps your API keys in an encrypted vault. When an agent like Claude Code calls an API, Keybroker attaches the right key on the way out and strips it from the response on the way back. The agent only ever sees a placeholder such as `keybroker-managed:elevenlabs`, so a key can't end up in a transcript, a log, or a prompt injection's hands.

It works with any HTTP API, whether or not it has an MCP server, and with any auth style: bearer tokens, custom headers, query parameters or basic auth.

## How it works

- **You add keys in Keybroker**, each bound to the hosts it may be sent to (e.g. `api.elevenlabs.io`).
- **Agents call APIs normally.** In Claude Code, `curl`, SDKs and scripts just work: `$ELEVENLABS_API_KEY` holds a placeholder, and Keybroker's local proxy swaps in the real key for HTTPS requests to that key's hosts. Agents without a shell use Keybroker's `http_request` tool instead.
- **Agents can set up new APIs for you.** Ask your agent to use an API it doesn't have a key for. It reads the docs and proposes the settings with `propose_credential`, Keybroker opens a pre-filled form, and you paste the key there, never into chat.
- **You can see everything.** The Activity tab shows every request that used a key, with the request as the agent sent it and the (scrubbed) response.

## Supported agents

Open Keybroker and click **Connect** next to each one.

| Agent | What it gets |
|---|---|
| Claude Code (CLI and desktop app) | Shell commands use your keys automatically, Keybroker's tools, and a guard that blocks prompts containing a pasted key |
| Codex | Keybroker's tools, plus instructions in `~/.codex/AGENTS.md` |
| Claude Desktop | Keybroker's tools in chat (installed as a Claude Desktop extension) |
| Cursor | Keybroker's tools |

To use your keys from any other terminal, run `source ~/.keybroker/env.sh` in it first.

## Install

Keybroker requires macOS on Apple silicon. Download the latest `.dmg` from the [Releases](https://github.com/carolinedivittorio/keybroker/releases) page, open it, and drag Keybroker to Applications.

## Closing or removing Keybroker

Closing Keybroker never breaks your terminals or agents. Shells talk to a tiny always-on relay (a background item named `com.carolinedivittorio.keybroker.relay`) that hands traffic to Keybroker while it's open and connects directly when it isn't. Placeholders simply stop working until you reopen the app.

To remove Keybroker completely:

1. In Keybroker, remove each connected agent (Claude Desktop's extension is removed in Claude Desktop → Settings → Extensions).
2. Quit Keybroker and delete it from Applications.
3. Remove the relay and Keybroker's files:

```bash
launchctl bootout gui/$(id -u)/com.carolinedivittorio.keybroker.relay; rm -f ~/Library/LaunchAgents/com.carolinedivittorio.keybroker.relay.plist; rm -rf ~/.keybroker ~/Library/Application\ Support/Keybroker
```

4. Optionally delete the "Keybroker Safe Storage" item in Keychain Access.

## Disclaimer

Keybroker is provided as-is, with no guarantees of any kind, including that it will keep your keys secure. Use it at your own risk. Agents can still *use* your keys on the hosts you allow, so give each key the narrowest permissions and spending limits your provider offers.

## Development

```bash
pnpm install
pnpm test          # unit and integration tests
pnpm dev           # run the app (as "Keybroker Dev", with its own vault: use test keys only)
pnpm --filter keybroker ui     # the UI alone in a browser, with sample data
pnpm --filter keybroker dist   # unsigned app in app/dist, for local testing
```

### Releasing

Releases are built, signed with Developer ID, notarized and uploaded by GitHub Actions ([release.yml](.github/workflows/release.yml)). Bump `version` in `app/package.json`, commit, then push a matching tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The workflow creates a draft release with the `.dmg` and `.zip`. Review it on GitHub and publish it. The workflow needs these repository secrets: `MAC_CERT_P12_BASE64`, `MAC_CERT_P12_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.

```
app/                    Electron app: main process, preload, React UI
packages/core           vault, host rules, auth adapters, scrubbing, presets
packages/proxy          injecting proxy, always-on relay, request capture
packages/agent-api      local socket API, proposals, agent instructions
packages/cli            keybroker CLI: MCP server, Claude Code hooks, relay
integrations/           Claude Code plugin and Claude Desktop extension
patches/                mockttp patch: listen on 127.0.0.1 only
```

## License

[MIT](LICENSE)
