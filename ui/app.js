import { EditorView } from '@codemirror/view';
import { createState, changeMode, format } from './editor.js';
import { headings, sourceMode } from './live.js';
import { installIcons } from './icons.js';
import { installContextMenu } from './context-menu.js';
import { installImagePaste } from './images.js';
import guide from './welcome.md';
import './style.css';

const element = id => document.getElementById(id);
const desk = window.desk;
let documentName = '使用指南.md', filePath = '', isGuide = true, tab = 'outline';
let recent = [], outline = [], saved, dirty = false, pipeline = Promise.resolve();
let view, countTimer;
let installing = false;
installIcons();

/** 更新计数时将汉字逐字统计，连续的英文或数字按词统计。 */
function countWords() {
  const text = view.state.doc.toString().replace(/\bdata:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,[a-z\d+/=]+/gi, '');
  const count = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu) || [];
  element('word-count').textContent = count.length.toLocaleString('zh-CN') + ' 字词';
}

/** 根据当前路径与修改状态更新标签、窗口标题和状态栏。 */
function refreshFile() {
  dirty = !view.state.doc.eq(saved);
  element('filename').textContent = documentName;
  element('filename').title = filePath || documentName;
  element('dirty-dot').hidden = !dirty;
  element('state-light').classList.toggle('changed', dirty);
  element('status-text').textContent = dirty ? '有未保存的修改' : filePath ? '已保存' : isGuide ? '使用指南' : '新文档';
  desk.title((dirty ? '● ' : '') + documentName);
}

/** 高亮光标所在章节，目录按钮位置直接来自语法树。 */
function refreshPosition() {
  const cursor = view.state.selection.main.head;
  const line = view.state.doc.lineAt(cursor);
  element('position').textContent = '行 ' + line.number + '，列 ' + (cursor - line.from + 1);
  if (tab !== 'outline') return;
  const active = outline.findLast(item => item.from <= cursor);
  for (const button of element('navigation').children) {
    button.setAttribute('aria-current', String(Number(button.dataset.position) === active?.from));
  }
}

/** 重绘侧栏，自文档读出的文字只作为文本节点写入。 */
function refreshNavigation() {
  const container = element('navigation');
  container.replaceChildren();
  const showOutline = tab === 'outline';
  element('outline-tab').setAttribute('aria-pressed', String(showOutline));
  element('recent-tab').setAttribute('aria-pressed', String(!showOutline));
  const items = showOutline ? outline : recent;
  for (const item of items) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.textContent = showOutline ? item.title : item.name;
    if (showOutline) {
      button.classList.add('level-' + item.level);
      button.style.paddingLeft = (12 + (item.level - 1) * 13) + 'px';
      button.dataset.position = item.from;
      button.onclick = () => {
        const position = Math.min(item.from, view.state.doc.length);
        view.focus();
        view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 24 }) });
      };
    } else {
      button.title = item.filePath;
      button.onclick = () => enqueue('recent', item.filePath);
    }
    container.append(button);
  }
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'nav-empty';
    empty.textContent = showOutline ? '输入标题后，大纲会出现在这里。' : '打开或保存过的文档会出现在这里。';
    container.append(empty);
  }
  refreshPosition();
}

/** 仅在文本变化时重算派生内容，避免光标移动触发全文扫描。 */
function onUpdate(update) {
  if (!saved || !view) return;
  if (update.docChanged) {
    refreshFile();
    clearTimeout(countTimer);
    // 等本轮输入停顿再更新全文大纲及统计，长文写作时优先响应按键。
    countTimer = setTimeout(() => {
      countWords();
      outline = headings(view.state);
      if (tab === 'outline') refreshNavigation();
    }, 120);
  }
  if (update.selectionSet) refreshPosition();
}

/** 切换到新的文档并重置保存基准，编辑模式沿用当前选择。 */
function showDocument(loaded, guideDocument = false) {
  clearTimeout(countTimer);
  const state = createState(loaded.text, onUpdate, view?.state.field(sourceMode) ?? false);
  saved = state.doc;
  if (view) view.setState(state);
  else view = new EditorView({ state, parent: element('editor') });
  filePath = loaded.filePath || '';
  documentName = loaded.name || '未命名.md';
  recent = loaded.recent || recent;
  isGuide = guideDocument;
  outline = headings(state);
  tab = 'outline';
  refreshFile(); refreshNavigation(); countWords();
}

/** 仅在写盘成功时更新基准，写入过程中产生的新内容继续标为未保存。 */
async function save(saveAs = false) {
  const snapshot = view.state.doc;
  const result = await desk.save(snapshot.toString(), saveAs, documentName);
  if (!result) return false;
  saved = snapshot;
  ({ filePath, name: documentName, recent } = result);
  isGuide = false;
  refreshFile(); refreshNavigation();
  return true;
}

/** 有修改时提供保存、放弃和取消三条路径。 */
async function canLeave() {
  if (!dirty) return true;
  const choice = await desk.confirm();
  return choice === 1 || (choice === 0 && await save());
}

/** 同步模式按钮与编辑器显示状态。 */
function switchMode(source) {
  changeMode(view, source);
  document.body.classList.toggle('source', source);
  element('live-mode').setAttribute('aria-pressed', String(!source));
  element('source-mode').setAttribute('aria-pressed', String(source));
  view.focus();
}

/** 在状态栏提供当前可执行的更新操作，保持正文可继续编辑。 */
function showUpdate({ phase, version, percent }) {
  const states = {
    checking: ['正在检查更新…'],
    current: ['已是最新版本 ' + version],
    available: ['发现新版本 ' + version, '下载更新', 'downloadUpdate'],
    downloading: ['正在下载 ' + version + ' · ' + percent + '%'],
    ready: [version + ' 已就绪', '重启安装', 'installUpdate'],
    installing: ['正在重启安装 ' + version + '…'],
    failed: ['更新失败', '重新检查', 'checkUpdate'],
    development: ['开发版 ' + version + ' · 请在安装版中更新']
  };
  if (phase === 'failed' && installing) {
    installing = false;
    element('editor').inert = false;
    view.focus();
  }
  const [message, label, action] = states[phase];
  element('update-text').textContent = message;
  const button = element('update-action');
  button.textContent = label || '';
  button.hidden = !action;
  button.onclick = action ? () => enqueue(action) : null;
}

/** 在载入和关闭期间冻结文档，避免异步文件操作覆盖新输入。 */
async function switchDocument(action, argument) {
  const editor = element('editor');
  editor.inert = true;
  try {
    if (!await canLeave()) {
      if (action === 'pending') await desk.skipPending();
      return;
    }
    if (action === 'close') return desk.close();
    if (action === 'installUpdate') {
      installing = true;
      try { if (!await desk.installUpdate()) installing = false; }
      catch (error) { installing = false; throw error; }
      return;
    }
    if (action === 'new') {
      await desk.fresh();
      showDocument({ text: '' });
    } else {
      const loaded = await desk.open(action === 'pending' ? true : argument);
      if (loaded) showDocument(loaded);
    }
  } finally {
    editor.inert = installing;
  }
  view.focus();
}

/** 处理桌面菜单、侧栏按钮和原生快捷键。 */
async function run(action, argument) {
  if (installing) return;
  if (['new', 'open', 'recent', 'pending', 'close', 'installUpdate'].includes(action)) return switchDocument(action, argument);
  if (action === 'checkUpdate' || action === 'downloadUpdate') return desk[action]();
  if (action === 'save' || action === 'saveAs') return save(action === 'saveAs');
  if (action === 'mode') return switchMode(!view.state.field(sourceMode));
  if (action === 'sidebar') return document.body.classList.toggle('sidebar-off');
  if (action === 'focus') {
    const active = document.body.classList.toggle('focus-mode');
    document.querySelector('[data-action="focus"]').setAttribute('aria-pressed', String(active));
    view.focus();
    return;
  }
  return format(view, action, argument);
}

/** 文件操作串行执行，取消或报错不会中断后续命令。 */
function enqueue(action, argument) {
  pipeline = pipeline.then(() => run(action, argument)).catch(error =>
    desk.error(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')));
  return pipeline;
}

/** 让正文、侧栏和空白处都能接收文件快捷键，并避开中文输入法组词阶段。 */
function shortcut(event) {
  if (event.isComposing || event.altKey || (desk.isMac ? event.ctrlKey : event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (['z', 'y'].includes(key) && event.target.closest('input,textarea')) return;
  const keys = { n: 'new', o: 'open', s: 'save', 'shift+s': 'saveAs', f: 'find', b: 'bold', i: 'italic',
    z: 'undo', 'shift+z': 'redo', y: 'redo',
    '1': 'h1', '2': 'h2', '3': 'h3', '/': 'mode', 'shift+l': 'sidebar' };
  const modified = desk.isMac ? event.metaKey : event.ctrlKey;
  const action = modified ? keys[(event.shiftKey ? 'shift+' : '') + key] : key === 'f8' ? 'focus' : null;
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) enqueue(action);
}

/** 建立编辑器并接收启动时从资源管理器传入的文件。 */
async function start() {
  if (desk.isMac) {
    document.querySelector('.titlebar').hidden = true;
    for (const hint of document.querySelectorAll('kbd')) hint.textContent = hint.textContent.replace('Ctrl ', '⌘');
    document.querySelector('.save-button').title = '保存文档（⌘S）';
  }
  showDocument({ name: '使用指南.md', text: (desk.isMac ? guide.replaceAll('Ctrl + ', '⌘') : guide).trimEnd() }, true);
  installContextMenu(view, enqueue);
  installImagePaste(view, enqueue);
  for (const button of document.querySelectorAll('[data-menu]')) button.onmousedown = event => event.preventDefault();
  for (const button of document.querySelectorAll('[data-action]')) button.onclick = () => enqueue(button.dataset.action);
  for (const button of document.querySelectorAll('[data-menu]')) button.onclick = () => {
    const rect = button.getBoundingClientRect();
    desk.menu(button.dataset.menu, { x: rect.left, y: rect.bottom + 2 });
  };
  element('live-mode').onclick = () => switchMode(false);
  element('source-mode').onclick = () => switchMode(true);
  element('outline-tab').onclick = () => { tab = 'outline'; refreshNavigation(); };
  element('recent-tab').onclick = () => { tab = 'recent'; refreshNavigation(); };
  desk.onCommand(enqueue);
  desk.onUpdateState(showUpdate);
  window.addEventListener('keydown', shortcut, true);
  const initial = await desk.start();
  recent = initial.recent;
  for (let index = 0; index < initial.pending; index++) await enqueue('pending');
}

start();
