const { app, BrowserWindow, dialog, ipcMain, Notification, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEV_URL = 'http://localhost:5173';

function requestedUrl() {
  const argument = process.argv.find((value) => value.startsWith('--server-url='));
  const candidate = process.env.SLH_TMS_URL || argument?.slice('--server-url='.length) || DEV_URL;
  let parsed;
  try { parsed = new URL(candidate); } catch { throw new Error('SLH_TMS_URL must be a valid http(s) URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('SLH_TMS_URL must use http or https.');
  return parsed.toString();
}

const startUrl = requestedUrl();
const trustedOrigin = new URL(startUrl).origin;

function isMicrosoftAuthUrl(target) {
  try {
    const parsed = new URL(target);
    return parsed.protocol === 'https:' && (
      parsed.hostname === 'login.microsoftonline.com' ||
      parsed.hostname.endsWith('.login.microsoftonline.com') ||
      parsed.hostname === 'login.microsoft.com'
    );
  } catch {
    return false;
  }
}

function isTrustedNavigation(target) {
  if (target === 'about:blank') return true;
  try { return new URL(target).origin === trustedOrigin || isMicrosoftAuthUrl(target); }
  catch { return false; }
}

function secureWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  };
}

function protectWindow(webContents) {
  webContents.on('will-navigate', (event, target) => {
    if (isTrustedNavigation(target)) return;
    event.preventDefault();
    if (/^https?:/i.test(target)) void shell.openExternal(target);
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (!isTrustedNavigation(url)) {
      if (/^https?:/i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 560,
        height: 760,
        autoHideMenuBar: true,
        webPreferences: secureWebPreferences(),
      },
    };
  });
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: 'SLH Transport Manager',
    backgroundColor: '#f3f6f8',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(),
  });

  protectWindow(mainWindow.webContents);
  mainWindow.webContents.on('did-create-window', (window) => protectWindow(window.webContents));
  void mainWindow.loadURL(startUrl);
}

function safeFileName(value) {
  const name = path.basename(String(value || 'SLH-export'));
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 180) || 'SLH-export';
}

ipcMain.handle('desktop:app-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
  serverUrl: startUrl,
}));

ipcMain.handle('desktop:save-file', async (_event, options = {}) => {
  const defaultName = safeFileName(options.defaultName);
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: Array.isArray(options.filters) ? options.filters.slice(0, 8) : undefined,
  });
  if (result.canceled || !result.filePath) return { saved: false };

  const encoding = options.encoding === 'base64' ? 'base64' : 'utf8';
  const content = typeof options.content === 'string' ? options.content : '';
  const bytes = Buffer.from(content, encoding);
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('Desktop export exceeds the 50 MB safety limit.');
  await fs.writeFile(result.filePath, bytes);
  return { saved: true, filePath: result.filePath };
});

ipcMain.handle('desktop:print', async () => {
  if (!mainWindow) return { printed: false };
  const success = await new Promise((resolve) => {
    mainWindow.webContents.print({ silent: false, printBackground: true }, (ok) => resolve(ok));
  });
  return { printed: success };
});

ipcMain.handle('desktop:notify', (_event, payload = {}) => {
  const title = String(payload.title || 'SLH Transport Manager').slice(0, 120);
  const body = String(payload.body || '').slice(0, 500);
  if (!Notification.isSupported()) return { shown: false };
  new Notification({ title, body }).show();
  return { shown: true };
});

ipcMain.handle('desktop:open-external', async (_event, target) => {
  const parsed = new URL(String(target));
  if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) throw new Error('External link protocol is not allowed.');
  await shell.openExternal(parsed.toString());
  return { opened: true };
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('co.uk.stuartlyons.tms');
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
