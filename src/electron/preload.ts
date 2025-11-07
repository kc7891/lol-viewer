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
  // Manual testing functions
  openManualMatchup: (myChampion: string, enemyChampion: string, role: string | null) =>
    ipcRenderer.invoke('open-manual-matchup', myChampion, enemyChampion, role),
  openManualCounters: (champion: string, role: string | null) =>
    ipcRenderer.invoke('open-manual-counters', champion, role),
  openManualBuild: (champion: string, role: string | null) =>
    ipcRenderer.invoke('open-manual-build', champion, role),
  onAppStatus: (callback: (status: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
    ipcRenderer.on('app-status', listener);
    // Return cleanup function
    return () => ipcRenderer.removeListener('app-status', listener);
  },
  onLog: (callback: (level: string, message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, level: string, message: string) =>
      callback(level, message);
    ipcRenderer.on('log', listener);
    // Return cleanup function
    return () => ipcRenderer.removeListener('log', listener);
  },
});
