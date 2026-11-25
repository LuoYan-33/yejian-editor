const { contextBridge, ipcRenderer } = require('electron');

// 页面只获得编辑文档所需的操作，文件选择和路径检查由主进程负责。
contextBridge.exposeInMainWorld('desk', {
  isMac: process.platform === 'darwin',
  start: () => ipcRenderer.invoke('start'),
  open: recent => ipcRenderer.invoke('open-document', recent),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  skipPending: () => ipcRenderer.invoke('skip-pending'),
  fresh: () => ipcRenderer.invoke('new-document'),
  save: (text, as, name) => ipcRenderer.invoke('save-document', text, as, name),
  confirm: () => ipcRenderer.invoke('confirm-changes'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateState: callback => ipcRenderer.on('update-state', (_event, state) => callback(state)),
  error: message => ipcRenderer.invoke('show-error', message),
  title: title => ipcRenderer.send('document-title', title),
  menu: (name, point) => ipcRenderer.send('show-menu', name, point),
  link: url => ipcRenderer.invoke('open-link', url),
  close: () => ipcRenderer.send('finish-close'),
  onCommand: callback => ipcRenderer.on('command', (_event, ...args) => callback(...args))
});
