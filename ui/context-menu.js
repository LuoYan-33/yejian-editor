import { gridAt } from './table.js';

const inline = [['粗体', 'bold'], ['斜体', 'italic'], ['行内代码', 'inlineCode']];
const imageItem = ['插入图片…', 'image'];
const inserts = [imageItem, ['插入表格', 'table'], ['无序列表', 'insertBullet'], ['有序列表', 'insertOrdered'],
  ['任务列表', 'insertTask'], ['分隔线', 'rule']];
const blocks = [['正文', 'paragraph'], ['一级标题', 'h1'], ['二级标题', 'h2'], ['三级标题', 'h3'],
  ['引用', 'quote'], ['代码块', 'fence']];
const table = [['在上方插入行', 'rowAbove'], ['在下方插入行', 'rowBelow'], ['在左侧插入列', 'colLeft'],
  ['在右侧插入列', 'colRight'], ['删除当前行', 'deleteRow'], ['删除当前列', 'deleteCol']];

/** 将右键落在已有选区内时保留选区，落在其他地方时定位到点击处。 */
function locate(editor, event) {
  const position = editor.posAtCoords({ x: event.clientX, y: event.clientY });
  const selection = editor.state.selection.main;
  editor.focus();
  if (position !== null && (selection.empty || position < selection.from || position > selection.to)) {
    editor.dispatch({ selection: { anchor: position } });
  }
}

/** 创建贴合右键位置的格式菜单，并保持键盘焦点和输入法上下文。 */
export function installContextMenu(view, run) {
  const menu = document.createElement('div');
  menu.className = 'format-popup';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '编辑格式');
  menu.hidden = true;
  document.body.append(menu);
  const close = () => { menu.hidden = true; };
  menu.onmousedown = event => event.preventDefault();

  /** 为一类操作生成菜单项，表头和唯一剩余列的限制直接反映在按钮上。 */
  function group(title, items, grid, structural = false) {
    const section = document.createElement('div');
    section.className = 'format-group';
    const caption = document.createElement('span');
    caption.className = 'format-caption';
    caption.textContent = title;
    section.append(caption);
    for (const [label, action] of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.tabIndex = -1;
      button.textContent = label;
      if (structural) button.disabled = ((!grid.active.row && ['deleteRow', 'rowAbove'].includes(action))
        || (grid.model.columns === 1 && action === 'deleteCol'));
      button.onclick = () => {
        close();
        if (structural) grid.structure(action);
        else run(action);
      };
      section.append(button);
    }
    menu.append(section);
  }

  // Windows 右键点击单元格内边距时会先转移焦点，菜单出现前需要保住原选区。
  view.dom.addEventListener('mousedown', event => {
    if (event.button === 2 && event.target.closest('.cm-content,.md-table')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  view.dom.addEventListener('contextmenu', event => {
    if (!event.target.closest('.cm-content,.md-table') || event.target.closest('.cm-panel')) return;
    event.preventDefault();
    const cell = event.target.closest('.md-table td,.md-table th');
    const grid = cell && gridAt(cell, event);
    locate(grid ? grid.active.editor : view, event);
    menu.replaceChildren();
    if (grid) group('表格操作', table, grid, true);
    group('插入', grid ? [imageItem] : inserts, grid);
    group('文字格式', inline, grid);
    if (!grid) group('段落格式', blocks, null);
    menu.hidden = false;
    menu.style.left = Math.max(4, Math.min(event.clientX, innerWidth - menu.offsetWidth - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(event.clientY, innerHeight - menu.offsetHeight - 4)) + 'px';
  });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) close(); }, true);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  document.addEventListener('wheel', event => { if (!menu.contains(event.target)) close(); }, true);
  window.addEventListener('keydown', event => {
    if (menu.hidden) return;
    const buttons = [...menu.querySelectorAll('button:enabled')];
    const index = buttons.findIndex(button => button.classList.contains('chosen'));
    if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Enter', 'Escape'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Enter') return (buttons[index] || buttons[0]).click();
      if (event.key === 'Escape') return close();
      const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
      const selected = buttons[index < 0 ? (forward ? 0 : buttons.length - 1) : (index + (forward ? 1 : -1) + buttons.length) % buttons.length];
      for (const button of buttons) button.classList.toggle('chosen', button === selected);
      selected.scrollIntoView({ block: 'nearest' });
    } else close();
  }, true);
}
