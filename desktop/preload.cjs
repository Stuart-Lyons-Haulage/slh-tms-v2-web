const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slhDesktop', Object.freeze({
  isDesktop: true,
  app: Object.freeze({
    getInfo: () => ipcRenderer.invoke('desktop:app-info'),
  }),
  files: Object.freeze({
    save: (options) => ipcRenderer.invoke('desktop:save-file', options),
  }),
  print: Object.freeze({
    currentPage: () => ipcRenderer.invoke('desktop:print'),
  }),
  notifications: Object.freeze({
    show: (title, body) => ipcRenderer.invoke('desktop:notify', { title, body }),
  }),
  shell: Object.freeze({
    openExternal: (target) => ipcRenderer.invoke('desktop:open-external', target),
  }),
}));
