import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, stat, writeFile, chmod } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const RELAY_PORT = 47123;
export const APP_PROXY_PORT = 47124;
const LABEL = 'com.carolinedivittorio.keybroker.relay';
const RELAY_BIN = join(homedir(), '.keybroker', 'bin', 'keybroker-relay');
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

function plist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RELAY_BIN}</string>
    <string>relay</string>
    <string>--port</string><string>${RELAY_PORT}</string>
    <string>--upstream</string><string>${APP_PROXY_PORT}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardErrorPath</key><string>${join(homedir(), '.keybroker', 'relay.log')}</string>
</dict>
</plist>
`;
}

async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([stat(a), stat(b)]);
    if (sa.size !== sb.size) return false;
    const [ba, bb] = await Promise.all([readFile(a), readFile(b)]);
    return ba.equals(bb);
  } catch {
    return false;
  }
}

/**
 * Keep the always-on relay installed and current. Agent shells point at the relay, which
 * hands traffic to the app while it runs and goes direct otherwise, so closing (or deleting)
 * Keybroker never breaks a shell. The relay binary is a real copy, not a link into the app.
 */
export async function ensureRelay(bundledCli: string) {
  const domain = `gui/${userInfo().uid}`;
  await mkdir(join(homedir(), '.keybroker', 'bin'), { recursive: true });
  await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });

  const binaryChanged = !(await sameFile(bundledCli, RELAY_BIN));
  if (binaryChanged) {
    const tmp = `${RELAY_BIN}.tmp`;
    await copyFile(bundledCli, tmp);
    await chmod(tmp, 0o755);
    await rename(tmp, RELAY_BIN);
  }
  const wanted = plist();
  const plistChanged = (await readFile(PLIST, 'utf8').catch(() => '')) !== wanted;
  if (plistChanged) await writeFile(PLIST, wanted);

  const loaded = await run('/bin/launchctl', ['print', `${domain}/${LABEL}`]).then(
    () => true,
    () => false,
  );
  if (loaded && !binaryChanged && !plistChanged) return;
  if (loaded) await run('/bin/launchctl', ['bootout', `${domain}/${LABEL}`]).catch(() => {});
  await run('/bin/launchctl', ['bootstrap', domain, PLIST]);
}
