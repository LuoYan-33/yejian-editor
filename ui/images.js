import { StateEffect, StateField } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import bitmap from '../desktop/bitmap.cjs';

const remember = StateEffect.define();
// 读取图片期间仍可输入，插入位置随文档的修改移动。
export const imageTarget = StateField.define({
  create: () => null,
  update(range, tr) {
    for (const effect of tr.effects) if (effect.is(remember)) return effect.value;
    return range?.map(tr.changes) ?? null;
  }
});

/** 内嵌位图直接显示，本地相对路径使用仅能读取当前文档目录的协议。 */
export function imageAddress(raw) {
  if (bitmap.isEmbeddedImage(raw) || /^https:\/\//i.test(raw)) return raw;
  if (!raw || /^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(raw)) return '';
  try { return 'yejian-image://document/' + encodeURIComponent(decodeURIComponent(raw)); }
  catch { return ''; }
}

/** 从系统截图或复制的图片生成可以直接保存在 Markdown 内的地址。 */
function readClipboardImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取剪贴板中的图片。'));
    reader.onload = () => resolve({ name: file.name || '截图', url: reader.result });
    reader.readAsDataURL(file);
  });
}

/** 在正文和表格中共用同一个插入动作，支持取消、撤销和保存后离线查看。 */
export async function insertImage(parent, grid, file) {
  const active = grid?.active;
  let editor = active?.editor || parent;
  const selection = editor.state.selection.main, original = editor.state.doc;
  editor.dispatch({ effects: remember.of(selection) });
  try {
    const image = file ? await readClipboardImage(file) : await window.desk.pickImage();
    if (!image) return;
    if (!bitmap.isEmbeddedImage(image.url)) throw new Error('这张图片的格式暂不支持。');
    const preview = new Image();
    preview.src = image.url;
    try { await preview.decode(); }
    catch { throw new Error('图片无法解码，请检查文件是否完整。'); }
    // 系统选择框可能使单元格失焦；确认原格内容后再恢复当时的选区。
    if (active && !editor.dom.isConnected) {
      const current = grid.model.rows[active.row]?.cells[active.column]?.value ?? '';
      if (!grid.root.isConnected || current !== original.toString()) throw new Error('原单元格已改变，请重新选择插入位置。');
      grid.edit(active.row, active.column);
      editor = grid.active.editor;
    }
    const range = editor.state.field(imageTarget) || selection;
    const label = (editor.state.sliceDoc(range.from, range.to) || image.name.replace(/\.[^.]+$/, '') || '图片')
      .replace(/\s+/g, ' ').replace(/[\\[\]|]/g, '\\$&');
    const insert = '![' + label + '](' + image.url + ')';
    editor.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: { anchor: range.from + insert.length },
      annotations: isolateHistory.of('full'), scrollIntoView: true, userEvent: 'input.image' });
    editor.focus();
  } finally {
    if (editor.dom.isConnected) editor.dispatch({ effects: remember.of(null) });
  }
}

/** 粘贴截图时复用图片插入流程，普通文本沿用编辑器原生粘贴。 */
export function installImagePaste(view, enqueue) {
  view.dom.addEventListener('paste', event => {
    if (!event.target.closest('.cm-content')) return;
    const file = Array.from(event.clipboardData?.files || []).find(item => Object.values(bitmap.types).includes(item.type));
    if (!file) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    enqueue('image', file);
  }, true);
}
