/**
 * Electron main process
 */

// @ts-nocheck - Dynamic ESM imports in CommonJS context
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } from 'electron';
import path from 'node:path';
import Store from 'electron-store';

// __dirname is available in CommonJS, but we need to declare it for TypeScript
declare const __dirname: string;

// Dynamic imports for ESM modules (will be loaded at runtime)
let Application: any;
let loadConfig: any;
let logger: any;

// Load ESM modules
async function loadESMModules() {
  // @ts-ignore - Dynamic imports of ESM modules from CommonJS
  const indexModule = await import('../index.js');
  // @ts-ignore - Dynamic imports of ESM modules from CommonJS
  const configModule = await import('../utils/config.js');
  // @ts-ignore - Dynamic imports of ESM modules from CommonJS
  const loggerModule = await import('../utils/logger.js');

  Application = indexModule.Application;
  loadConfig = configModule.loadConfig;
  logger = loggerModule.logger;
}

// Electron store for settings
const store = new Store();

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let appInstance: any = null;
let isQuitting = false;

/**
 * Send log to renderer process
 */
function sendLog(level: string, message: string) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('log', level, message);
  }
}

/**
 * Create system tray icon
 */
function createTray() {
  try {
    // Create tray icon (use default if custom icon not available)
    const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
    let icon = nativeImage.createFromPath(iconPath);

    // If icon doesn't exist, try to use app icon
    if (icon.isEmpty()) {
      // Create a minimal 1x1 transparent icon as placeholder
      // Note: On Windows, tray might not show without a proper icon
      const buffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      icon = nativeImage.createFromBuffer(buffer);

      logger.warn('Tray icon not found. Tray might not be visible on some systems.');
    }

    tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }));

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
  } catch (error) {
    logger.error('Failed to create tray icon', error as Error);
    // Continue without tray - settings window will still be accessible
  }
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
    sendLog('info', 'Loading configuration...');
    const config = await loadConfig();
    sendLog('success', 'Configuration loaded');

    sendLog('info', 'Initializing application...');
    appInstance = new Application(config);
    await appInstance.initialize();
    sendLog('success', 'Application initialized');

    sendLog('info', 'Connecting to League Client...');
    await appInstance.start();
    sendLog('success', 'Connected to League Client successfully');

    logger.info('Application started from Electron');

    // Notify renderer
    if (settingsWindow) {
      settingsWindow.webContents.send('app-status', 'running');
    }

    updateTrayMenu();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to start application', error as Error);
    sendLog('error', `Failed to start: ${errorMessage}`);

    // Show more helpful error messages
    let userMessage = errorMessage;
    if (errorMessage.includes('League Client process not found')) {
      userMessage = 'League of Legends client is not running. Please start League of Legends first.';
      sendLog('warn', 'Please start League of Legends and try again');
    } else if (errorMessage.includes('ECONNREFUSED')) {
      userMessage = 'Cannot connect to League Client. Make sure League of Legends is running.';
      sendLog('warn', 'Connection refused - check if League Client is running');
    }

    dialog.showErrorBox('Startup Error', userMessage);
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
  // Load ESM modules first
  await loadESMModules();

  createTray();

  // Always show settings window on startup for easy access
  // Users can close it if they don't need it
  createSettingsWindow();

  // Show welcome dialog only on first launch
  const hasLaunchedBefore = store.get('hasLaunchedBefore', false) as boolean;
  if (!hasLaunchedBefore) {
    store.set('hasLaunchedBefore', true);

    dialog.showMessageBox({
      type: 'info',
      title: 'LoL Analytics Viewer へようこそ',
      message: 'LoL Analytics Viewer が起動しました！',
      detail:
        '• 設定画面から「Start」ボタンを押してアプリを起動してください\n' +
        '• システムトレイ（タスクバー右下）にアイコンが表示されます\n' +
        '• トレイアイコンを右クリックして設定を変更できます\n' +
        '• League of Legendsを起動してチャンピオン選択を開始してください\n\n' +
        'ログセクションで動作状況を確認できます。',
      buttons: ['OK']
    });
  } else {
    // Auto-start application on subsequent launches if configured
    const autoStart = store.get('autoStart', false) as boolean;
    if (autoStart) {
      await startApplication();
    }
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

  // Manual testing IPC handlers
  ipcMain.handle('open-manual-matchup', async (_event, myChampion: string, enemyChampion: string, role: string | null) => {
    try {
      sendLog('info', `Manual test: Opening matchup ${myChampion} vs ${enemyChampion}${role ? ` (${role})` : ''}`);

      const config = await loadConfig();
      const { URLBuilder } = await import('../core/analytics/url-builder.js');
      const { browserController } = await import('../core/browser/controller.js');

      const urlBuilder = new URLBuilder('lol-analytics', config.lolAnalytics.baseUrl);
      const url = urlBuilder.buildMatchupURL(myChampion, enemyChampion, role || undefined);

      await browserController.open(url);
      sendLog('success', `Opened matchup page: ${url}`);
      return { success: true, url };
    } catch (error: any) {
      sendLog('error', `Failed to open matchup: ${error.message}`);
      throw error;
    }
  });

  ipcMain.handle('open-manual-counters', async (_event, champion: string, role: string | null) => {
    try {
      sendLog('info', `Manual test: Opening counters for ${champion}${role ? ` (${role})` : ''}`);

      const config = await loadConfig();
      const { URLBuilder } = await import('../core/analytics/url-builder.js');
      const { browserController } = await import('../core/browser/controller.js');

      const urlBuilder = new URLBuilder('lol-analytics', config.lolAnalytics.baseUrl);
      const url = urlBuilder.buildCounterURL(champion, role || undefined);

      await browserController.open(url);
      sendLog('success', `Opened counters page: ${url}`);
      return { success: true, url };
    } catch (error: any) {
      sendLog('error', `Failed to open counters: ${error.message}`);
      throw error;
    }
  });

  ipcMain.handle('open-manual-build', async (_event, champion: string, role: string | null) => {
    try {
      sendLog('info', `Manual test: Opening build guide for ${champion}${role ? ` (${role})` : ''}`);

      const config = await loadConfig();
      const { URLBuilder } = await import('../core/analytics/url-builder.js');
      const { browserController } = await import('../core/browser/controller.js');

      const urlBuilder = new URLBuilder('lol-analytics', config.lolAnalytics.baseUrl);
      const url = urlBuilder.buildBuildURL(champion, role || undefined);

      await browserController.open(url);
      sendLog('success', `Opened build guide: ${url}`);
      return { success: true, url };
    } catch (error: any) {
      sendLog('error', `Failed to open build guide: ${error.message}`);
      throw error;
    }
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
