/**
 * Electron preload script
 */

import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: unknown) => ipcRenderer.invoke('save-config', config),
  getAppStatus: () => ipcRenderer.invoke('get-app-status'),
  startApp: () => ipcRenderer.invoke('start-app'),
  stopApp: () => ipcRenderer.invoke('stop-app'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  onAppStatus: (callback: (status: string) => void) => {
    ipcRenderer.on('app-status', (_event, status) => callback(status));
  },
});
