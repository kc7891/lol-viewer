/**
 * Electron main process
 */

import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import application logic
import { Application } from '../index.js';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

// Electron store for settings
const store = new Store();

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let appInstance: Application | null = null;
let isQuitting = false;

/**
 * Create system tray icon
 */
function createTray() {
  // Create tray icon (use default if custom icon not available)
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);

  // If icon doesn't exist or is empty, create a simple default icon
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'LoL Analytics Viewer',
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: appInstance ? '⚡ Running' : '⏸ Stopped',
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: 'Settings',
      click: () => {
        createSettingsWindow();
      },
    },
    {
      label: appInstance ? 'Stop' : 'Start',
      click: async () => {
        if (appInstance) {
          await stopApplication();
        } else {
          await startApplication();
        }
        updateTrayMenu();
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('LoL Analytics Viewer');

  tray.on('click', () => {
    createSettingsWindow();
  });
}

/**
 * Update tray menu
 */
function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'LoL Analytics Viewer',
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: appInstance ? '⚡ Running' : '⏸ Stopped',
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: 'Settings',
      click: () => {
        createSettingsWindow();
      },
    },
    {
      label: appInstance ? 'Stop' : 'Start',
      click: async () => {
        if (appInstance) {
          await stopApplication();
        } else {
          await startApplication();
        }
        updateTrayMenu();
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * Create settings window
 */
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 700,
    title: 'LoL Analytics Viewer - Settings',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load settings HTML
  settingsWindow.loadFile(path.join(__dirname, '../../assets/settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  // Don't quit when window is closed
  settingsWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      settingsWindow?.hide();
    }
  });
}

/**
 * Start application
 */
async function startApplication() {
  try {
    const config = await loadConfig();
    appInstance = new Application(config);
    await appInstance.initialize();
    await appInstance.start();

    logger.info('Application started from Electron');

    // Notify renderer
    if (settingsWindow) {
      settingsWindow.webContents.send('app-status', 'running');
    }

    updateTrayMenu();
  } catch (error) {
    logger.error('Failed to start application', error as Error);

    dialog.showErrorBox(
      'Startup Error',
      `Failed to start application: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Stop application
 */
async function stopApplication() {
  if (appInstance) {
    await appInstance.stop();
    appInstance = null;

    logger.info('Application stopped from Electron');

    // Notify renderer
    if (settingsWindow) {
      settingsWindow.webContents.send('app-status', 'stopped');
    }

    updateTrayMenu();
  }
}

/**
 * App ready handler
 */
app.whenReady().then(async () => {
  createTray();

  // Auto-start application
  const autoStart = store.get('autoStart', true) as boolean;
  if (autoStart) {
    await startApplication();
  }

  // IPC handlers
  ipcMain.handle('get-config', async () => {
    return await loadConfig();
  });

  ipcMain.handle('save-config', async (_event, config) => {
    store.set('config', config);
    return true;
  });

  ipcMain.handle('get-app-status', () => {
    return appInstance ? 'running' : 'stopped';
  });

  ipcMain.handle('start-app', async () => {
    await startApplication();
  });

  ipcMain.handle('stop-app', async () => {
    await stopApplication();
  });

  ipcMain.handle('restart-app', async () => {
    await stopApplication();
    await startApplication();
  });
});

/**
 * Prevent quit when all windows closed (stay in tray)
 */
app.on('window-all-closed', () => {
  // Don't quit on macOS
  if (process.platform !== 'darwin' && !isQuitting) {
    // Keep running in background
  }
});

/**
 * Quit handler
 */
app.on('before-quit', async () => {
  isQuitting = true;
  if (appInstance) {
    await stopApplication();
  }
});

/**
 * Handle second instance (prevent multiple instances)
 */
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus settings window if someone tries to open second instance
    if (settingsWindow) {
      if (settingsWindow.isMinimized()) settingsWindow.restore();
      settingsWindow.focus();
    } else {
      createSettingsWindow();
    }
  });
}
