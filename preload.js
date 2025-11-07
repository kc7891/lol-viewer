const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => {
    require('electron').shell.openExternal(url);
  }
});
