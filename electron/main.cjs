const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

let mainWindow = null;
let serverInstance = null;
let serverModule = null;
let lastCheckManual = false;
let checkInFlight = false;
let closeBackupDone = false;

function readPublishConfig() {
  const candidates = [
    path.join(process.resourcesPath || '', 'app-update.yml'),
    path.join(app.getAppPath(), 'electron-builder.yml'),
    path.join(__dirname, '..', 'electron-builder.yml'),
  ];

  for (const filePath of candidates) {
    try {
      if (!filePath || !fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      const ownerMatch = content.match(/^\s*(?:-\s*)?owner:\s*["']?([^"'\r\n#]+)["']?/m);
      const repoMatch = content.match(/^\s*(?:-\s*)?repo:\s*["']?([^"'\r\n#]+)["']?/m);
      const owner = ownerMatch ? ownerMatch[1].trim() : '';
      const repo = repoMatch ? repoMatch[1].trim() : '';
      if (owner && repo) {
        const isPlaceholder =
          owner === 'TU_USUARIO_GITHUB' ||
          repo === 'NOMBRE_DEL_REPO' ||
          owner.includes('TU_USUARIO') ||
          repo.includes('NOMBRE_DEL_REPO');
        return {
          owner,
          repo,
          isConfigured: !isPlaceholder,
        };
      }
    } catch {
      // Try next candidate
    }
  }

  return {
    owner: 'TU_USUARIO_GITHUB',
    repo: 'NOMBRE_DEL_REPO',
    isConfigured: false,
  };
}

function formatReleaseNotes(rawNotes) {
  if (!rawNotes) return '';
  let text = '';
  if (typeof rawNotes === 'string') {
    text = rawNotes;
  } else if (Array.isArray(rawNotes)) {
    text = rawNotes
      .map((entry) => {
        if (!entry) return '';
        const ver = entry.version ? `v${entry.version}\n` : '';
        return `${ver}${entry.note || ''}`;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  return text
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(?:p|div|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseSemver(version) {
  const cleaned = String(version || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
  const parts = cleaned.split('.').map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function isOfflineError(err) {
  const msg = String(err && err.message ? err.message : err || '').toLowerCase();
  const code = String(err && err.code ? err.code : '').toLowerCase();
  return (
    code === 'enotfound' ||
    code === 'eai_again' ||
    code === 'enetunreach' ||
    code === 'econnrefused' ||
    code === 'etimedout' ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('err_name_not_resolved') ||
    msg.includes('err_network') ||
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('timed out')
  );
}

function isSignatureOrUnsupportedError(err) {
  const msg = String(err && err.message ? err.message : err || '').toLowerCase();
  return (
    msg.includes('code signature') ||
    msg.includes('did not pass validation') ||
    msg.includes('could not get code signature') ||
    msg.includes('not packed') ||
    msg.includes('app-update.yml')
  );
}

function isAllowedGitHubUrl(rawUrl, publishCfg) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'github.com') {
      if (publishCfg && publishCfg.isConfigured) {
        const expectedPrefix = `/${publishCfg.owner.toLowerCase()}/${publishCfg.repo.toLowerCase()}/`;
        return parsed.pathname.toLowerCase().startsWith(expectedPrefix);
      }
      return true;
    }
    return (
      host === 'objects.githubusercontent.com' ||
      host.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

const isPortableWindows =
  process.platform === 'win32' && Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
const isUnsignedMac = process.platform === 'darwin';

const updaterState = {
  isDesktopApp: true,
  platform: process.platform,
  isPackaged: app.isPackaged,
  isPortable: isPortableWindows,
  supportsAutoInstall:
    app.isPackaged && process.platform === 'win32' && !isPortableWindows,
  currentVersion: app.getVersion(),
  status: 'idle', // idle | checking | available | up-to-date | downloading | downloaded | error | unconfigured
  availableVersion: null,
  releaseNotes: '',
  releaseDate: null,
  progress: 0,
  transferredBytes: 0,
  totalBytes: 0,
  directDownloadUrl: null,
  requiresManualDownload: isUnsignedMac || isPortableWindows || !app.isPackaged,
  repoSlug: '',
  lastCheckedAt: null,
  error: null,
  message: '',
};

function emitUpdaterState(patch = {}) {
  Object.assign(updaterState, patch);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', { ...updaterState });
  }
}

function pickBestReleaseAssetUrl(assets, fallbackHtmlUrl, platform, isPortable) {
  const list = Array.isArray(assets) ? assets : [];
  if (platform === 'darwin') {
    const dmg = list.find((a) => String(a.name || '').toLowerCase().endsWith('.dmg'));
    if (dmg && dmg.browser_download_url) return dmg.browser_download_url;
    const zip = list.find((a) => String(a.name || '').toLowerCase().endsWith('.zip'));
    if (zip && zip.browser_download_url) return zip.browser_download_url;
  } else if (platform === 'win32') {
    if (isPortable) {
      const portable = list.find((a) => {
        const n = String(a.name || '').toLowerCase();
        return n.endsWith('.exe') && !n.includes('setup');
      });
      if (portable && portable.browser_download_url) {
        return portable.browser_download_url;
      }
    }
    const setup = list.find((a) => {
      const n = String(a.name || '').toLowerCase();
      return n.endsWith('.exe') && n.includes('setup');
    });
    if (setup && setup.browser_download_url) return setup.browser_download_url;
    const anyExe = list.find((a) => String(a.name || '').toLowerCase().endsWith('.exe'));
    if (anyExe && anyExe.browser_download_url) return anyExe.browser_download_url;
  }
  return fallbackHtmlUrl || null;
}

async function checkGitHubReleaseFallback(manual) {
  const publishCfg = readPublishConfig();
  const repoSlug = `${publishCfg.owner}/${publishCfg.repo}`;

  if (!publishCfg.isConfigured) {
    emitUpdaterState({
      status: manual ? 'unconfigured' : 'idle',
      repoSlug,
      lastCheckedAt: new Date().toISOString(),
      error: null,
      message: manual
        ? 'Configura owner y repo de GitHub en electron-builder.yml para consultar GitHub Releases.'
        : '',
    });
    return { ...updaterState };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(
      publishCfg.owner
    )}/${encodeURIComponent(publishCfg.repo)}/releases/latest`;

    const res = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `AulaAgil/${app.getVersion()}`,
      },
      signal: controller.signal,
    });

    if (res.status === 404) {
      emitUpdaterState({
        status: 'up-to-date',
        repoSlug,
        lastCheckedAt: new Date().toISOString(),
        error: null,
        message:
          'Aún no hay versiones publicadas en GitHub Releases; estás usando la compilación actual.',
      });
      return { ...updaterState };
    }

    if (!res.ok) {
      throw new Error(`GitHub respondió con estado ${res.status}`);
    }

    const release = await res.json();
    const remoteTag = String(release.tag_name || release.name || '').replace(/^v/i, '');
    const current = app.getVersion();
    const isNewer = remoteTag && compareSemver(remoteTag, current) > 0;
    const directUrl = pickBestReleaseAssetUrl(
      release.assets,
      release.html_url,
      process.platform,
      isPortableWindows
    );
    const notes = formatReleaseNotes(release.body);

    if (isNewer) {
      emitUpdaterState({
        status: 'available',
        repoSlug,
        availableVersion: remoteTag,
        releaseNotes: notes,
        releaseDate: release.published_at || null,
        directDownloadUrl: isAllowedGitHubUrl(directUrl, publishCfg)
          ? directUrl
          : release.html_url || null,
        requiresManualDownload:
          isUnsignedMac || isPortableWindows || !app.isPackaged,
        lastCheckedAt: new Date().toISOString(),
        error: null,
        message: `Nueva versión ${remoteTag} disponible en GitHub Releases.`,
      });
    } else {
      emitUpdaterState({
        status: 'up-to-date',
        repoSlug,
        availableVersion: null,
        releaseNotes: '',
        directDownloadUrl: null,
        lastCheckedAt: new Date().toISOString(),
        error: null,
        message: 'Ya cuentas con la última versión instalada.',
      });
    }
    return { ...updaterState };
  } catch (err) {
    if (isOfflineError(err) || (err && err.name === 'AbortError')) {
      if (manual) {
        emitUpdaterState({
          status: 'error',
          repoSlug,
          lastCheckedAt: new Date().toISOString(),
          error: 'Sin conexión para verificar actualizaciones',
          message: 'Sin conexión para verificar actualizaciones',
        });
      } else {
        emitUpdaterState({ status: 'idle', error: null, message: '' });
      }
      return { ...updaterState };
    }

    emitUpdaterState({
      status: manual ? 'error' : 'idle',
      repoSlug,
      lastCheckedAt: new Date().toISOString(),
      error: manual
        ? 'No se pudieron consultar las actualizaciones en este momento.'
        : null,
      message: '',
    });
    return { ...updaterState };
  } finally {
    clearTimeout(timeout);
  }
}

function setupAutoUpdater() {
  const publishCfg = readPublishConfig();
  updaterState.repoSlug = `${publishCfg.owner}/${publishCfg.repo}`;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    emitUpdaterState({
      status: 'checking',
      error: null,
      message: 'Buscando actualizaciones...',
    });
  });

  autoUpdater.on('update-available', (info) => {
    const cfg = readPublishConfig();
    const version = info && info.version ? String(info.version) : '';
    const fallbackUrl = cfg.isConfigured
      ? `https://github.com/${cfg.owner}/${cfg.repo}/releases/tag/v${version}`
      : null;

    emitUpdaterState({
      status: 'available',
      availableVersion: version,
      releaseNotes: formatReleaseNotes(info && info.releaseNotes),
      releaseDate: (info && info.releaseDate) || null,
      progress: 0,
      directDownloadUrl: fallbackUrl,
      requiresManualDownload: isUnsignedMac || isPortableWindows,
      lastCheckedAt: new Date().toISOString(),
      error: null,
      message: `Nueva versión ${version} disponible.`,
    });
  });

  autoUpdater.on('update-not-available', () => {
    emitUpdaterState({
      status: 'up-to-date',
      availableVersion: null,
      releaseNotes: '',
      progress: 0,
      lastCheckedAt: new Date().toISOString(),
      error: null,
      message: 'Ya cuentas con la última versión instalada.',
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    emitUpdaterState({
      status: 'downloading',
      progress: Math.min(100, Math.max(0, Math.round(progressObj.percent || 0))),
      transferredBytes: progressObj.transferred || 0,
      totalBytes: progressObj.total || 0,
      error: null,
      message: 'Descargando actualización...',
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    emitUpdaterState({
      status: 'downloaded',
      availableVersion:
        (info && info.version) || updaterState.availableVersion,
      releaseNotes:
        formatReleaseNotes(info && info.releaseNotes) || updaterState.releaseNotes,
      progress: 100,
      error: null,
      message:
        'Actualización descargada y lista. Tus datos y base de datos local permanecerán intactos.',
    });
  });

  autoUpdater.on('error', async (err) => {
    if (isSignatureOrUnsupportedError(err)) {
      await checkGitHubReleaseFallback(lastCheckManual);
      return;
    }
    if (isOfflineError(err)) {
      if (lastCheckManual) {
        emitUpdaterState({
          status: 'error',
          lastCheckedAt: new Date().toISOString(),
          error: 'Sin conexión para verificar actualizaciones',
          message: 'Sin conexión para verificar actualizaciones',
        });
      } else {
        emitUpdaterState({ status: 'idle', error: null, message: '' });
      }
      return;
    }

    emitUpdaterState({
      status: lastCheckManual ? 'error' : 'idle',
      lastCheckedAt: new Date().toISOString(),
      error: lastCheckManual
        ? 'No se pudo completar la verificación de actualizaciones.'
        : null,
      message: '',
    });
  });
}

async function performUpdateCheck(manual) {
  if (checkInFlight) return { ...updaterState };
  checkInFlight = true;
  lastCheckManual = Boolean(manual);

  const publishCfg = readPublishConfig();
  updaterState.repoSlug = `${publishCfg.owner}/${publishCfg.repo}`;

  try {
    if (!publishCfg.isConfigured) {
      emitUpdaterState({
        status: manual ? 'unconfigured' : 'idle',
        lastCheckedAt: new Date().toISOString(),
        error: null,
        message: manual
          ? 'Configura tu usuario y repositorio de GitHub en electron-builder.yml para verificar versiones.'
          : '',
      });
      return { ...updaterState };
    }

    emitUpdaterState({
      status: 'checking',
      error: null,
      message: 'Buscando actualizaciones...',
    });

    // En macOS sin firma, ejecutable portable o modo desarrollo, usar GitHub Releases directo
    if (!app.isPackaged || isUnsignedMac || isPortableWindows) {
      return await checkGitHubReleaseFallback(manual);
    }

    await autoUpdater.checkForUpdates();
    return { ...updaterState };
  } catch (err) {
    if (isSignatureOrUnsupportedError(err)) {
      return await checkGitHubReleaseFallback(manual);
    }
    if (isOfflineError(err)) {
      if (manual) {
        emitUpdaterState({
          status: 'error',
          lastCheckedAt: new Date().toISOString(),
          error: 'Sin conexión para verificar actualizaciones',
          message: 'Sin conexión para verificar actualizaciones',
        });
      } else {
        emitUpdaterState({ status: 'idle', error: null, message: '' });
      }
      return { ...updaterState };
    }

    emitUpdaterState({
      status: manual ? 'error' : 'idle',
      lastCheckedAt: new Date().toISOString(),
      error: manual
        ? 'No se pudieron buscar actualizaciones en este momento.'
        : null,
      message: '',
    });
    return { ...updaterState };
  } finally {
    checkInFlight = false;
  }
}

function registerUpdaterIpc() {
  ipcMain.handle('updater:get-state', () => ({ ...updaterState }));

  ipcMain.handle('updater:check', async () => performUpdateCheck(true));

  ipcMain.handle('updater:download', async () => {
    const publishCfg = readPublishConfig();
    if (
      updaterState.requiresManualDownload ||
      !app.isPackaged ||
      isUnsignedMac ||
      isPortableWindows
    ) {
      if (isAllowedGitHubUrl(updaterState.directDownloadUrl, publishCfg)) {
        await shell.openExternal(updaterState.directDownloadUrl);
        return { openedExternal: true, state: { ...updaterState } };
      }
      return { openedExternal: false, state: { ...updaterState } };
    }

    try {
      emitUpdaterState({
        status: 'downloading',
        progress: 0,
        error: null,
        message: 'Iniciando descarga en segundo plano...',
      });
      await autoUpdater.downloadUpdate();
      return { ok: true, state: { ...updaterState } };
    } catch (err) {
      if (isOfflineError(err)) {
        emitUpdaterState({
          status: 'error',
          error: 'Sin conexión para descargar la actualización',
          message: 'Sin conexión para descargar la actualización',
        });
      } else if (isAllowedGitHubUrl(updaterState.directDownloadUrl, publishCfg)) {
        emitUpdaterState({
          status: 'available',
          requiresManualDownload: true,
          error:
            'No se pudo descargar automáticamente. Puedes usar la descarga directa.',
        });
      } else {
        emitUpdaterState({
          status: 'error',
          error: 'No se pudo descargar la actualización.',
        });
      }
      return { ok: false, state: { ...updaterState } };
    }
  });

  ipcMain.handle('updater:install', async () => {
    if (updaterState.status !== 'downloaded') {
      return { ok: false };
    }
    if (serverInstance && typeof serverInstance.close === 'function') {
      try {
        await new Promise((resolve) => serverInstance.close(() => resolve()));
      } catch {
        // Continue with install even if server close throws
      }
    }
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });
    return { ok: true };
  });

  ipcMain.handle('updater:open-external', async (_event, customUrl) => {
    const publishCfg = readPublishConfig();
    const targetUrl = customUrl || updaterState.directDownloadUrl;
    if (!isAllowedGitHubUrl(targetUrl, publishCfg)) {
      return { ok: false, error: 'URL de descarga no permitida.' };
    }
    await shell.openExternal(targetUrl);
    return { ok: true };
  });

  ipcMain.handle('drive:open-auth-url', async (_event, authUrl) => {
    try {
      const parsed = new URL(String(authUrl || ''));
      if (
        parsed.protocol !== 'https:' ||
        parsed.hostname.toLowerCase() !== 'accounts.google.com'
      ) {
        return { ok: false, error: 'URL de autenticación de Google no permitida.' };
      }
      await shell.openExternal(parsed.toString());
      return { ok: true };
    } catch {
      return { ok: false, error: 'URL de autenticación inválida.' };
    }
  });
}

function findAvailablePort(preferredPort = 3456) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => {
      const fallback = net.createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const addr = fallback.address();
        const port = typeof addr === 'object' && addr ? addr.port : 3456;
        fallback.close(() => resolve(port));
      });
    });
    tester.listen(preferredPort, '127.0.0.1', () => {
      tester.close(() => resolve(preferredPort));
    });
  });
}

async function waitForDevServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {
      // Wait for local server startup
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function startEmbeddedProductionServer() {
  const port = await findAvailablePort(3456);
  process.env.NODE_ENV = 'production';
  process.env.LIBRETA_NO_AUTOSTART = '1';
  process.env.LIBRETA_DATA_DIR = app.getPath('userData');
  process.env.PORT = String(port);

  const serverPath = path.join(__dirname, '..', 'dist-server', 'server.mjs');
  serverModule = await import(pathToFileURL(serverPath).href);
  serverInstance = await serverModule.startServer(port);
  return `http://127.0.0.1:${port}`;
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    title: 'AulaÁgil',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  try {
    let targetUrl = 'http://localhost:3000';
    if (app.isPackaged) {
      targetUrl = await startEmbeddedProductionServer();
    } else {
      const ready = await waitForDevServer(targetUrl, 15000);
      if (!ready) {
        dialog.showErrorBox(
          'Servidor local no encontrado',
          'Inicia primero "npm run dev" en otra terminal o compila el instalador con "npm run electron:build".'
        );
        app.quit();
        return;
      }
    }

    await mainWindow.loadURL(targetUrl);

    if (app.isPackaged) {
      setTimeout(() => {
        performUpdateCheck(false).catch(() => {});
      }, 5000);
    }
  } catch (err) {
    dialog.showErrorBox(
      'Error al abrir AulaÁgil',
      err instanceof Error ? err.message : String(err)
    );
    app.quit();
  }

  mainWindow.on('close', async (event) => {
    if (
      !closeBackupDone &&
      serverModule &&
      typeof serverModule.triggerOnCloseDriveBackup === 'function'
    ) {
      event.preventDefault();
      closeBackupDone = true;
      try {
        await Promise.race([
          serverModule.triggerOnCloseDriveBackup(),
          new Promise((r) => setTimeout(r, 6000)),
        ]);
      } catch {
        // Never block app exit if offline
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  setupAutoUpdater();
  registerUpdaterIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverInstance && typeof serverInstance.close === 'function') {
    try {
      serverInstance.close();
    } catch {
      // Ignore close error on exit
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
