const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const net = require('net');
const { pathToFileURL } = require('url');

let mainWindow = null;
let serverInstance = null;

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
  const mod = await import(pathToFileURL(serverPath).href);
  serverInstance = await mod.startServer(port);
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
  } catch (err) {
    dialog.showErrorBox(
      'Error al abrir AulaÁgil',
      err instanceof Error ? err.message : String(err)
    );
    app.quit();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
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
