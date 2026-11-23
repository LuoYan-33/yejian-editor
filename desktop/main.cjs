const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readDocument, writeDocument, hasChanged, resolveImage } = require('./files.cjs');
const { types: imageTypes } = require('./bitmap.cjs');
const { createUpdates } = require('./updates.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'yejian-image', privileges: { standard: true, secure: true } }]);
app.setAppUserModelId('cn.yejian.markdown.editor');
let windowHandle, current, menu, ready = false, allowClose = false;
let recent = [];
let updates;
const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
const queuedFiles = [];
const markdownFilter = [{ name: 'Markdown 文档', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }];

/** 识别资源管理器传入的文档，忽略 Electron 的启动参数。 */
function argumentFile(args, directory) {
  const value = args.slice(1).find(arg => !arg.startsWith('-') && /\.(md|markdown|mdown|mkd|txt)$/i.test(arg));
  return value ? path.resolve(directory, value) : null;
}

/** 返回供界面展示的最近文档标题和路径。 */
function recentItems() {
  return recent.map(filePath => ({ filePath, name: path.basename(filePath) }));
}

/** 更新最近列表，列表写入失败不影响已经保存的文档。 */
async function remember(filePath) {
  recent = [filePath, ...recent.filter(item => item.toLowerCase() !== filePath.toLowerCase())].slice(0, 12);
  try { await fs.writeFile(path.join(app.getPath('userData'), 'recent.json'), JSON.stringify(recent)); }
  catch (error) { console.warn('未能更新最近文档', error.message); }
}

/** 读取文档成功后再切换当前文件。 */
async function openDocument(filePath) {
  const loaded = await readDocument(filePath);
  const { text, ...metadata } = loaded;
  current = metadata;
  await remember(filePath);
  return { text, filePath, name: path.basename(filePath), recent: recentItems() };
}

/** 处理保存、另存为和磁盘文件已被其他程序修改的情况。 */
async function saveDocument(_event, text, saveAs, name) {
  if (typeof text !== 'string') throw new Error('文档内容无效。');
  let filePath = current?.filePath;
  if (!filePath || saveAs) {
    const selected = await dialog.showSaveDialog(windowHandle, {
      title: '保存 Markdown 文档', defaultPath: filePath || path.basename(name || '未命名.md'),
      filters: markdownFilter
    });
    if (selected.canceled) return null;
    filePath = selected.filePath;
  }
  if (current && filePath.toLowerCase() === current.filePath.toLowerCase() && await hasChanged(current)) {
    const choice = await dialog.showMessageBox(windowHandle, { type: 'warning', message: '磁盘上的文件已更改或移走',
      detail: '继续保存会用编辑器中的内容写入这个位置。', buttons: ['取消', '继续保存'], defaultId: 0, cancelId: 0 });
    if (choice.response !== 1) return null;
  }
  current = await writeDocument(filePath, text, current || { eol: '\r\n', bom: false });
  await remember(filePath);
  return { filePath, name: path.basename(filePath), recent: recentItems() };
}

/** 把系统菜单和快捷键交给同一套文档命令处理。 */
function buildMenu() {
  const groups = {
    file: ['文件', [['新建文档', 'new', 'Ctrl+N'], ['打开文档…', 'open', 'Ctrl+O'], null,
      ['保存', 'save', 'Ctrl+S'], ['另存为…', 'saveAs', 'Ctrl+Shift+S'], null, ['关闭窗口', 'close', 'Alt+F4']]],
    edit: ['编辑', [['撤销', 'undo', 'Ctrl+Z'], ['重做', 'redo', 'Ctrl+Shift+Z'], null,
      ['剪切', 'cut'], ['复制', 'copy'], ['粘贴', 'paste'], ['全选', 'selectAll'], null, ['查找与替换', 'find', 'Ctrl+F']]],
    format: ['格式', [['一级标题', 'h1', 'Ctrl+1'], ['二级标题', 'h2', 'Ctrl+2'], ['三级标题', 'h3', 'Ctrl+3'],
      null, ['粗体', 'bold', 'Ctrl+B'], ['斜体', 'italic', 'Ctrl+I'], ['行内代码', 'inlineCode'],
      null, ['引用', 'quote'], ['无序列表', 'bullet'], ['有序列表', 'ordered'], ['任务列表', 'task'], ['代码块', 'fence'],
      null, ['插入图片…', 'image'], ['插入表格', 'table'], ['插入分隔线', 'rule']]],
    view: ['视图', [['切换即时编辑 / 源码', 'mode', 'Ctrl+/'], ['显示 / 隐藏侧栏', 'sidebar', 'Ctrl+Shift+L'], ['专注模式', 'focus', 'F8']]],
    help: ['帮助', [[portable ? '下载新版免安装包…' : '检查更新', 'checkUpdate']]]
  };
  return Menu.buildFromTemplate(Object.entries(groups).map(([id, [label, items]]) => ({
    id, label, submenu: items.map(item => {
      if (!item) return { type: 'separator' };
      const [label, command, accelerator] = item;
      if (['cut', 'copy', 'paste', 'selectAll'].includes(command)) return { role: command, label };
      return { label, accelerator, registerAccelerator: false, click: () => windowHandle.webContents.send('command', command) };
    })
  })));
}

/** 注册有限的本地文件、原生对话框和窗口操作。 */
function registerHandlers() {
  ipcMain.handle('start', () => {
    ready = true;
    void updates?.check(false);
    return { recent: recentItems(), pending: queuedFiles.length };
  });
  ipcMain.handle('open-document', async (_event, requested) => {
    let filePath;
    if (requested === true) filePath = queuedFiles.shift();
    else if (typeof requested === 'string' && recent.includes(requested)) filePath = requested;
    else if (!requested) {
      const choice = await dialog.showOpenDialog(windowHandle, { title: '打开 Markdown 文档', filters: markdownFilter, properties: ['openFile'] });
      if (!choice.canceled) filePath = choice.filePaths[0];
    }
    return filePath ? openDocument(filePath) : null;
  });
  ipcMain.handle('new-document', () => { current = null; });
  ipcMain.handle('pick-image', async () => {
    const selected = await dialog.showOpenDialog(windowHandle, { title: '插入图片', properties: ['openFile'],
      filters: [{ name: '图片', extensions: Object.keys(imageTypes) }] });
    if (selected.canceled || !selected.filePaths.length) return null;
    const file = selected.filePaths[0], extension = path.extname(file).slice(1).toLowerCase();
    if (!Object.hasOwn(imageTypes, extension)) throw new Error('请选择 PNG、JPEG、GIF、WebP、BMP 或 AVIF 图片。');
    return { name: path.basename(file), url: 'data:' + imageTypes[extension] + ';base64,' + await fs.readFile(file, 'base64') };
  });
  ipcMain.handle('skip-pending', () => { queuedFiles.shift(); });
  ipcMain.handle('save-document', saveDocument);
  ipcMain.handle('check-update', () => {
    if (portable) return shell.openExternal('https://github.com/LuoYan-33/yejian-editor/releases/latest');
    if (updates) return void updates.check();
    windowHandle.webContents.send('update-state', { phase: 'development', version: app.getVersion() });
  });
  ipcMain.handle('download-update', () => { void updates?.download(); });
  ipcMain.handle('install-update', () => updates?.install() ?? false);
  ipcMain.handle('confirm-changes', async () => {
    const result = await dialog.showMessageBox(windowHandle, { type: 'question', message: '要保存当前文档的更改吗？',
      detail: '选择放弃更改将丢失上次保存后的编辑。', buttons: ['保存', '放弃更改', '取消'], defaultId: 0, cancelId: 2 });
    return result.response;
  });
  ipcMain.handle('show-error', (_event, detail) => dialog.showMessageBox(windowHandle, { type: 'error', message: '操作未完成', detail: String(detail) }));
  ipcMain.handle('open-link', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(new URL(url).href);
  });
  ipcMain.on('document-title', (_event, title) => windowHandle.setTitle(String(title) + ' · 页间'));
  ipcMain.on('finish-close', () => { allowClose = true; windowHandle.close(); });
  ipcMain.on('show-menu', (_event, group, point) => menu.getMenuItemById(group)?.submenu?.popup({
    window: windowHandle, x: Math.round(point.x), y: Math.round(point.y)
  }));
}

/** 创建采用系统窗口按钮的桌面编辑器。 */
async function launch() {
  try {
    const data = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'recent.json'), 'utf8'));
    if (Array.isArray(data)) recent = data.filter(item => typeof item === 'string' && path.isAbsolute(item)).slice(0, 12);
  } catch { /* 首次启动时还没有最近文档。 */ }
  protocol.handle('yejian-image', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'document') return new Response(null, { status: 404 });
      const image = await resolveImage(current?.filePath, decodeURIComponent(url.pathname.slice(1)));
      if (image) return new Response(await fs.readFile(image.path), { headers: { 'Content-Type': image.type, 'Cache-Control': 'no-store' } });
    } catch { /* 无法读取的图片由编辑器显示替代文本。 */ }
    return new Response(null, { status: 404 });
  });
  menu = buildMenu();
  Menu.setApplicationMenu(menu);
  registerHandlers();
  windowHandle = new BrowserWindow({ width: 1160, height: 800, minWidth: 640, minHeight: 450, show: false,
    title: '页间', backgroundColor: '#faf9f6', titleBarStyle: 'hidden', autoHideMenuBar: true,
    titleBarOverlay: { color: '#f4f3ef', symbolColor: '#565750', height: 43 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  windowHandle.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  windowHandle.webContents.on('will-navigate', event => event.preventDefault());
  windowHandle.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  windowHandle.on('close', event => {
    if (!ready || allowClose || updates?.installing || windowHandle.webContents.isCrashed()) return;
    event.preventDefault();
    windowHandle.webContents.send('command', 'close');
  });
  windowHandle.once('ready-to-show', () => windowHandle.show());
  if (app.isPackaged && !portable) {
    updates = createUpdates(require('electron-updater').autoUpdater, app.getVersion(), state => {
      if (!windowHandle.isDestroyed()) windowHandle.webContents.send('update-state', state);
    });
  }
  await windowHandle.loadFile(path.join(__dirname, '../ui-dist/index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const initialFile = argumentFile(process.argv, process.cwd());
  if (initialFile) queuedFiles.push(initialFile);
  app.on('second-instance', (_event, args, directory) => {
    const filePath = argumentFile(args, directory);
    if (filePath) {
      queuedFiles.push(filePath);
      if (ready) windowHandle.webContents.send('command', 'pending');
    }
    if (windowHandle?.isMinimized()) windowHandle.restore();
    windowHandle?.focus();
  });
  app.whenReady().then(launch);
  app.on('window-all-closed', () => app.quit());
}
