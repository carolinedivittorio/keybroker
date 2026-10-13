import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateState } from '../shared/api';

const { autoUpdater } = electronUpdater;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

let state: UpdateState = { status: 'idle' };
let notify: (state: UpdateState) => void = () => {};

function set(next: UpdateState) {
  state = next;
  notify(state);
}

export function updateState(): UpdateState {
  return state;
}

export function checkForUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates().catch(() => {
    // Offline or GitHub unreachable: try again at the next interval.
  });
}

/**
 * Updates come from GitHub Releases (latest-mac.yml + the .zip). macOS only installs an
 * update signed with the same Developer ID, so a tampered download is rejected.
 */
export function startUpdates(onChange: (state: UpdateState) => void) {
  notify = onChange;
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => state.status !== 'ready' && set({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version }));
  autoUpdater.on('update-not-available', () => state.status !== 'ready' && set({ status: 'idle' }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => state.status !== 'ready' && set({ status: 'error', error: err.message }));

  checkForUpdates();
  setInterval(checkForUpdates, CHECK_EVERY_MS).unref();
}

export function installUpdate() {
  if (state.status === 'ready') autoUpdater.quitAndInstall();
}
