/**
 * What agents are told about Keybroker. Used as MCP server instructions, and later
 * for AGENTS.md / the Claude Code skill.
 */
export const AGENT_INSTRUCTIONS = `Keybroker manages API keys on this machine. You never need the raw value of an API key, and you must never ask the user to paste one into chat, a file, or a terminal.

Using a configured API:
- Call list_credentials to see which APIs are set up (name, hosts, auth scheme, env var).
- In shells that have sourced ~/.keybroker/env.sh, env vars like ELEVENLABS_API_KEY hold a placeholder ("keybroker-managed:<name>"). Use them exactly as you would a real key, with curl, SDKs or scripts. Keybroker's proxy attaches the real key to HTTPS requests for that credential's hosts and removes it from responses.
- If a shell isn't set up, or a tool ignores HTTPS_PROXY, use the http_request tool instead.
- A 403 with "keybroker_blocked" explains what was refused (wrong host, plain HTTP, unknown credential). Read the message and adjust rather than retrying.
- A 401/403 from the API itself usually means the stored key is invalid or lacks a permission. Tell the user to update it in the Keybroker app.

Adding a new API:
1. Research its authentication from the official docs: API host(s), how the key is sent (bearer token, a specific header, a query parameter, or basic auth), the env var its SDK reads, and a cheap authenticated GET endpoint to test with.
2. Call propose_credential with those details. Keybroker opens a form pre-filled with them; the user checks it and pastes their key there, never to you.
3. The call waits for the user. When it returns "approved", the API is ready to use (check test.ok). If it returns "pending", call credential_status to keep waiting. If "rejected", ask the user what they'd like to do.

Never try to read, print, decode or work around Keybroker to obtain a key.`;
