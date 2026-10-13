import { contextBridge, ipcRenderer } from 'electron';
import type { KeybrokerApi } from '../shared/api';

const api: KeybrokerApi = {
  status: () => ipcRenderer.invoke('status'),
  listCredentials: () => ipcRenderer.invoke('credentials:list'),
  presets: () => ipcRenderer.invoke('presets'),
  saveCredential: (input, secret) => ipcRenderer.invoke('credentials:save', input, secret),
  deleteCredential: (name) => ipcRenderer.invoke('credentials:delete', name),
  recentEvents: () => ipcRenderer.invoke('events:recent'),
  eventDetail: (id) => ipcRenderer.invoke('events:detail', id),
  onEvent: (callback) => {
    const listener = (_e: unknown, event: Parameters<typeof callback>[0]) => callback(event);
    ipcRenderer.on('events:new', listener);
    return () => ipcRenderer.removeListener('events:new', listener);
  },
  pendingProposals: () => ipcRenderer.invoke('proposals:pending'),
  approveProposal: (id, input, secret) => ipcRenderer.invoke('proposals:approve', id, input, secret),
  rejectProposal: (id) => ipcRenderer.invoke('proposals:reject', id),
  onProposalsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('proposals:changed', listener);
    return () => ipcRenderer.removeListener('proposals:changed', listener);
  },
  integrations: () => ipcRenderer.invoke('integrations:list'),
  setIntegration: (id, install) => ipcRenderer.invoke('integrations:set', id, install),
  pauseIntegration: (id, paused) => ipcRenderer.invoke('integrations:pause', id, paused),
  updateState: () => ipcRenderer.invoke('update:state'),
  onUpdateState: (callback) => {
    const listener = (_e: unknown, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
  installUpdate: () => ipcRenderer.invoke('update:install'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
};

contextBridge.exposeInMainWorld('keybroker', api);
