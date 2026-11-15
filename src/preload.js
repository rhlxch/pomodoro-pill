const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pomo', {
  init: () => ipcRenderer.invoke('init'),
  action: (name, payload) => ipcRenderer.send('action', name, payload),
  updateSettings: (patch) => ipcRenderer.invoke('update-settings', patch),
  getStats: () => ipcRenderer.invoke('get-stats'),
  resetStats: () => ipcRenderer.invoke('reset-stats'),
  suspendHotkeys: (on) => ipcRenderer.invoke('suspend-hotkeys', on),
  on: (channel, fn) => {
    const allowed = ['state', 'settings', 'stats', 'toast', 'complete', 'open-tab'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => fn(data));
  }
});
