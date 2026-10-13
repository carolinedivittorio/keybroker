import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import type { Server } from 'node:http';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, protocol, safeStorage, shell, Tray } from 'electron';
import { DEFAULT_SOCKET_PATH, startAgentServer } from '@keybroker/agent-api';
import { placeholderFor, PRESETS, Vault, writeShellEnv, type Cipher } from '@keybroker/core';
import { generateCA, startProxy, type ProxyEvent, type ProxyEventDetail, type RunningProxy } from '@keybroker/proxy';
import type { BrokerStatus, CredentialInput, CredentialView } from '../shared/api';
import { createBroker } from './agent';
import { APP_PROXY_PORT, ensureRelay, RELAY_PORT } from './relay';
import { checkForUpdates, installUpdate, startUpdates, updateState } from './updates';
import { ensureTools, INTEGRATION_NAMES, listIntegrations, setIntegration } from './integrations';

// Dev builds get their own name, which means their own vault and Keychain entry. They are
// not a security boundary (anything running as you can drive the dev Electron binary), so
// real keys belong in the packaged, fused app only.
const IS_DEV_BUILD = !app.isPackaged;
app.setName(IS_DEV_BUILD ? 'Keybroker Dev' : 'Keybroker');

/** Switches that would let another process inspect or script the app. Refused in packaged builds. */
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'inspect', 'inspect-brk', 'inspect-port', 'js-flags'];

// Packaged: the app's proxy sits behind the always-on relay (see relay.ts). Dev builds
// listen on the public port directly and don't install the relay.
const PROXY_PORT = Number(process.env.KEYBROKER_PORT ?? (IS_DEV_BUILD ? RELAY_PORT : APP_PROXY_PORT));

// The packaged app keeps the GrantFileProtocolExtraPrivileges fuse off, so file:// can't
// load the UI out of app.asar. It's served from this private scheme instead.
const UI_SCHEME = 'keybroker';
const RENDERER_DIR = join(__dirname, '../renderer');
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
protocol.registerSchemesAsPrivileged([{ scheme: UI_SCHEME, privileges: { standard: true, secure: true } }]);

function serveRenderer() {
  protocol.handle(UI_SCHEME, async (request) => {
    const file = normalize(join(RENDERER_DIR, decodeURIComponent(new URL(request.url).pathname)));
    if (!file.startsWith(RENDERER_DIR + sep)) return new Response('Not found', { status: 404 });
    try {
      return new Response(await readFile(file), { headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
const BROKER_DIR = join(homedir(), '.keybroker');
const MAX_EVENTS = 200;

// Resources live next to the app in dev and in Contents/Resources when packaged.
const assetsDir = app.isPackaged ? join(process.resourcesPath, 'assets') : join(__dirname, '../../../assets');

/** safeStorage keeps its key in the macOS Keychain, scoped to this app's signature. */
const keychainCipher: Cipher = {
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
};

let vault: Vault;
let proxy: RunningProxy | undefined;
let tray: Tray | undefined;
let window: BrowserWindow | undefined;
let envFile = join(BROKER_DIR, 'env.sh');
let startupError: string | undefined;
let agentServer: Server | undefined;
const events: ProxyEvent[] = [];
let lastPendingCount = 0;

const broker = createBroker({
  vault: () => vault,
  proxy: () => proxy,
  caCert: () => vault.getCA()!.cert,
  credentialsChanged,
  clientName: (client) => INTEGRATION_NAMES[client] ?? client,
  showProposals() {
    const pending = broker.proposals.pending();
    window?.webContents.send('proposals:changed');
    if (pending.length > lastPendingCount) {
      const latest = pending.at(-1)!;
      new Notification({ title: 'Keybroker', body: `An agent proposed a credential for ${latest.hosts.join(', ')}. Review it and add your key.` }).show();
      openWindow();
    }
    lastPendingCount = pending.length;
    updateTrayMenu();
  },
});

// Request/response details for the Activity view: memory only, never written to disk.
const eventDetails = new Map<string, ProxyEventDetail>();

function onProxyEvent(event: ProxyEvent, detail: ProxyEventDetail) {
  events.push(event);
  eventDetails.set(event.id, detail);
  if (events.length > MAX_EVENTS) eventDetails.delete(events.shift()!.id);
  window?.webContents.send('events:new', event);
  appendFile(join(BROKER_DIR, 'audit.log'), `${JSON.stringify(event)}\n`).catch(() => {});
}

/** Restore the Activity list after a restart. Only summaries are on disk; details never are. */
async function loadRecentEvents() {
  const lines = (await readFile(join(BROKER_DIR, 'audit.log'), 'utf8').catch(() => '')).trim().split('\n').slice(-MAX_EVENTS);
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as ProxyEvent;
      if (e.id) events.push(e);
    } catch {
      /* skip malformed lines */
    }
  }
}

async function refreshShellEnv() {
  const ca = vault.getCA();
  if (!ca || !proxy) return;
  ({ envFile } = await writeShellEnv({
    dir: BROKER_DIR,
    // Shells talk to the relay, which survives the app quitting.
    proxyUrl: IS_DEV_BUILD ? proxy.url : `http://127.0.0.1:${RELAY_PORT}`,
    caCert: ca.cert,
    credentials: vault.listCredentials(),
  }));
}

/** Called after any credential change: intercept the new host set and refresh placeholders. */
async function credentialsChanged() {
  await proxy?.reload();
  await refreshShellEnv();
  updateTrayMenu();
}

function credentialViews(): CredentialView[] {
  return vault.listCredentials().map((c) => ({
    ...c,
    hasSecret: vault.hasSecret(c.name),
    placeholder: placeholderFor(c.name),
  }));
}

function openWindow() {
  if (window) {
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    title: 'Keybroker',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: IS_DEV_BUILD,
    },
  });
  window.on('closed', () => {
    window = undefined;
    if (process.platform === 'darwin') app.dock?.hide();
  });
  // The UI never navigates; anything that tries to goes to the real browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.platform === 'darwin') app.dock?.show();
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else window.loadURL(`${UI_SCHEME}://app/index.html`);
}

function updateTrayMenu() {
  if (!tray) return;
  const count = vault.listCredentials().length;
  const pending = broker.proposals.pending().length;
  const status = startupError
    ? `⚠︎ ${startupError}`
    : proxy
      ? `Proxy running on 127.0.0.1:${proxy.port}`
      : 'Proxy stopped';
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { label: `${count} credential${count === 1 ? '' : 's'}`, enabled: false },
      ...(pending ? [{ label: `Review ${pending} proposal${pending === 1 ? '' : 's'}…`, click: openWindow }] : []),
      { type: 'separator' },
      { label: 'Open Keybroker…', click: openWindow },
      { label: 'Copy shell setup command', click: () => clipboard.writeText(`source ${envFile}`) },
      { type: 'separator' },
      updateState().status === 'ready'
        ? { label: `Restart to update to ${updateState().version}`, click: installUpdate }
        : { label: 'Check for updates', enabled: app.isPackaged, click: checkForUpdates },
      { type: 'separator' },
      { label: 'Quit Keybroker', role: 'quit' },
    ]),
  );
}

/**
 * Changing where a stored key may be sent is the one edit that can leak it, so it needs a
 * native confirmation. A compromised renderer can call the IPC, but can't click this.
 */
async function confirmRebinding(input: CredentialInput): Promise<boolean> {
  const existing = vault.getCredential(input.name);
  if (!existing || !vault.hasSecret(input.name)) return true;
  const sameHosts = [...existing.hosts].sort().join() === [...input.hosts].map((h) => h.toLowerCase()).sort().join();
  const sameAuth = JSON.stringify(existing.auth) === JSON.stringify(input.auth);
  if (sameHosts && sameAuth) return true;
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Allow'],
    defaultId: 0,
    cancelId: 0,
    message: `Change where your ${input.name} key is sent?`,
    detail: `Your stored key will be sent to:\n${input.hosts.join('\n')}\n\nPreviously:\n${existing.hosts.join('\n')}\n\nOnly allow this if you made the change yourself.`,
  });
  return response === 1;
}

function registerIpc() {
  ipcMain.handle('status', (): BrokerStatus => ({
    proxyUrl: proxy?.url ?? '',
    envFile,
    error: startupError,
    devBuild: IS_DEV_BUILD,
  }));
  ipcMain.handle('credentials:list', () => credentialViews());
  ipcMain.handle('presets', () => PRESETS);
  ipcMain.handle('credentials:save', async (_e, input: CredentialInput, secret?: string) => {
    try {
      if (!(await confirmRebinding(input))) return { ok: false, error: 'Change cancelled.' };
      await vault.upsert(input, secret?.trim() || undefined);
      await credentialsChanged();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle('credentials:delete', async (_e, name: string) => {
    await vault.remove(name);
    await credentialsChanged();
  });
  ipcMain.handle('events:recent', () => events);
  ipcMain.handle('events:detail', (_e, id: string) => eventDetails.get(id) ?? null);
  ipcMain.handle('proposals:pending', () => broker.proposals.pending());
  ipcMain.handle('proposals:approve', async (_e, id: string, input: CredentialInput, secret: string) => {
    try {
      await broker.approve(id, input, secret);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle('proposals:reject', (_e, id: string) => broker.reject(id));
  ipcMain.handle('integrations:list', () => listIntegrations(vault.pausedClients()));
  ipcMain.handle('integrations:pause', async (_e, id: string, paused: boolean) => {
    if (!(id in INTEGRATION_NAMES)) throw new Error(`Unknown agent ${id}`);
    await vault.setPaused(id, paused);
  });
  ipcMain.handle('integrations:set', async (_e, id: string, install: boolean) => {
    try {
      await setIntegration(id, install);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle('update:state', () => updateState());
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.handle('copy', (_e, text: string) => clipboard.writeText(text));
  ipcMain.handle('open-external', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
  });
}

async function start() {
  await mkdir(BROKER_DIR, { recursive: true });
  await loadRecentEvents();
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Keychain encryption is unavailable');
  vault = await Vault.open(join(app.getPath('userData'), 'vault.bin'), keychainCipher);

  let ca = vault.getCA();
  if (!ca) {
    ca = await generateCA();
    await vault.setCA(ca);
  }

  try {
    proxy = await startProxy({ ca, port: PROXY_PORT, credentials: () => vault.resolved(), onEvent: onProxyEvent });
  } catch (err) {
    startupError = `Couldn't start proxy on port ${PROXY_PORT}: ${(err as Error).message}`;
  }
  await refreshShellEnv();
  agentServer = await startAgentServer(broker.handlers, DEFAULT_SOCKET_PATH);
  const repo = join(__dirname, '../../..');
  await ensureTools(
    app.isPackaged
      ? {
          cliBinary: join(process.resourcesPath, 'bin', 'keybroker'),
          marketplace: join(process.resourcesPath, 'integrations', 'claude-code'),
          desktopExtension: join(process.resourcesPath, 'claude-desktop', 'keybroker.mcpb'),
        }
      : {
          cliBinary: join(repo, 'packages/cli/dist/keybroker'),
          marketplace: join(repo, 'integrations/claude-code'),
          desktopExtension: join(repo, 'build/claude-desktop/keybroker.mcpb'),
        },
  ).catch((err) => console.error('Could not set up ~/.keybroker tools:', err));
  if (!IS_DEV_BUILD) {
    await ensureRelay(join(process.resourcesPath, 'bin', 'keybroker')).catch((err) => {
      startupError = `Couldn't start the background relay: ${(err as Error).message}`;
    });
  }
}

const debugSwitch = DEBUG_SWITCHES.find((s) => app.commandLine.hasSwitch(s)) ?? process.argv.find((a) => a.startsWith('--inspect'));
if (!IS_DEV_BUILD && debugSwitch) {
  // Someone relaunched us to get a debugger attached. Exit before anything (including a
  // DevTools server or a window) comes up, and never open the vault.
  console.error(`Keybroker refuses to run with ${debugSwitch}.`);
  app.exit(1);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openWindow);
  // Menubar app: closing the window keeps the broker running.
  app.on('window-all-closed', () => {});
  app.on('activate', openWindow);

  app.whenReady().then(async () => {
    serveRenderer();
    registerIpc();
    try {
      await start();
    } catch (err) {
      dialog.showErrorBox('Keybroker failed to start', (err as Error).message);
      app.quit();
      return;
    }
    const icon = nativeImage.createFromPath(join(assetsDir, 'trayTemplate.png'));
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip('Keybroker');
    updateTrayMenu();
    startUpdates((state) => {
      window?.webContents.send('update:state', state);
      updateTrayMenu();
    });
    openWindow();
  });

  app.on('before-quit', () => {
    proxy?.stop();
    agentServer?.close();
  });
}
