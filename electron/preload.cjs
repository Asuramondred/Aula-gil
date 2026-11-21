const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aulaAgilUpdater', {
  getState: () => ipcRenderer.invoke('updater:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  quitAndInstall: () => ipcRenderer.invoke('updater:install'),
  openReleaseDownload: (url) => ipcRenderer.invoke('updater:open-external', url),
  onStatus: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, state) => {
      callback(state);
    };
    ipcRenderer.on('updater:status', listener);
    return () => {
      ipcRenderer.removeListener('updater:status', listener);
    };
  },
});

contextBridge.exposeInMainWorld('aulaAgilDrive', {
  openAuthUrl: (url) => ipcRenderer.invoke('drive:open-auth-url', url),
});

contextBridge.exposeInMainWorld('aulaAgilGitHub', {
  openAuthUrl: (url) => ipcRenderer.invoke('github:open-auth-url', url),
});
