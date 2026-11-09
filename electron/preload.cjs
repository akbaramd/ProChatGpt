const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chatdesk', Object.freeze({
  status: () => ipcRenderer.invoke('app:status'),
  showBrowser: (visible) => ipcRenderer.invoke('browser:show', !!visible),
  reloadBrowser: () => ipcRenderer.invoke('browser:reload'),
  sendApi: (id, messages) => ipcRenderer.invoke('api:send', { id, messages }),
  onStream: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('api:stream',listener);
    return () => ipcRenderer.removeListener('api:stream',listener);
  },
  onBrowserStatus: (cb) => {
    const listener = (_event,data) => cb(data);
    ipcRenderer.on('browser:status',listener);
    return () => ipcRenderer.removeListener('browser:status',listener);
  }
}));
