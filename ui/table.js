import { EditorState } from '@codemirror/state';
import { EditorView, keymap, WidgetType } from '@codemirror/view';
import { defaultKeymap, isolateHistory } from '@codemirror/commands';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { changeTable, encodeCell } from './table-model.js';
import bitmap from '../desktop/bitmap.cjs';
import { imageAddress } from './images.js';

const markdown = new MarkdownIt({ html: false });
const validateLink = markdown.validateLink;
markdown.validateLink = address => bitmap.isEmbeddedImage(address) || validateLink(address);
const grids = new WeakMap();

/** 渲染静止单元格；仅正在输入的格子创建编辑器。 */
function paint(cell, value) {
  const fragment = DOMPurify.sanitize(markdown.renderInline(value), { RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['strong', 'em', 's', 'code', 'a', 'br', 'img'], ALLOWED_ATTR: ['href', 'src', 'alt'] });
  for (const image of fragment.querySelectorAll('img')) {
    const src = imageAddress(image.getAttribute('src') || '');
    if (src) { image.src = src; image.className = 'md-image'; }
    else image.replaceWith(image.alt);
  }
  cell.replaceChildren(fragment);
}

/** 找到当前获得焦点的单元格，使快捷键和右键使用同一选区。 */
export function activeGrid(view) {
  const root = document.activeElement?.closest('.md-table');
  return root && view.dom.contains(root) ? grids.get(root) : null;
}

class EditableGrid {
  /** 创建原生表格，用同一个主文档保存数据和撤销记录。 */
  constructor(view, model, extensions) {
    this.view = view;
    this.extensions = extensions;
    this.root = document.createElement('div');
    this.root.className = 'md-table';
    this.table = this.root.appendChild(document.createElement('table'));
    grids.set(this.root, this);
    this.draw(model);
    this.root.addEventListener('mousedown', event => {
      const cell = event.target.closest('td,th');
      if (!cell || cell === this.active?.cell || event.button > 2) return;
      event.preventDefault();
      this.edit(cell.parentElement.rowIndex, cell.cellIndex, event);
    });
    this.root.addEventListener('focusout', () => queueMicrotask(() => {
      if (!this.root.contains(document.activeElement)) this.finish();
    }));
  }

  /** 同一结构的输入只更新变化的格子，让中文输入法的组合文本保持焦点。 */
  draw(model) {
    const sameShape = this.model && this.model.rows.length === model.rows.length && this.model.columns === model.columns;
    const previous = this.model;
    this.model = model;
    if (!sameShape) {
      this.finish();
      this.table.replaceChildren();
    }
    model.rows.forEach((entry, row) => {
      const tr = sameShape ? this.table.rows[row] : this.table.insertRow();
      for (let column = 0; column < model.columns; column++) {
        const cell = sameShape ? tr.cells[column] : tr.appendChild(document.createElement(row ? 'td' : 'th'));
        const rule = model.divider.cells[column]?.value || '';
        cell.style.textAlign = rule.endsWith(':') ? (rule.startsWith(':') ? 'center' : 'right') : 'left';
        const value = entry.cells[column]?.value || '';
        if (cell === this.active?.cell) {
          const editor = this.active.editor;
          if (!this.writing) this.active.range = entry.cells[column];
          if (!this.writing && encodeCell(editor.state.doc.toString()) !== value) {
            editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
          }
        } else if (!sameShape || value !== previous.rows[row].cells[column]?.value) paint(cell, value);
      }
    });
  }

  /** 关闭单元格编辑器，并恢复排版后的文字。 */
  finish() {
    if (!this.active) return;
    const { cell, row, column, editor } = this.active;
    this.active = null;
    editor.destroy();
    paint(cell, this.model.rows[row]?.cells[column]?.value || '');
  }

  /** 将一次单元格修改同步为主文档的一次事务。 */
  write(value) {
    const { row, column } = this.active;
    const cell = this.active.range;
    const encoded = encodeCell(value);
    if (this.model.raw.slice(cell?.from ?? 0, cell?.to ?? 0) === encoded) return;
    const start = this.view.posAtDOM(this.root);
    const changes = cell ? { from: start + cell.from, to: start + cell.to, insert: encoded }
      : { from: start, to: start + this.model.raw.length, insert: changeTable(this.model, row, column, 'cell', encoded).text };
    // 保留用户刚输入的首尾空格；语法树会把它们当作表格排版空白。
    this.writing = true;
    try {
      this.view.dispatch({ changes, userEvent: 'input.type' });
      if (this.active) this.active.range = cell ? { from: cell.from, to: cell.from + encoded.length } : this.model.rows[row].cells[column];
    } finally { this.writing = false; }
  }

  /** 按当前格子的位置增删行列，并把光标放入操作后的目标格。 */
  structure(action) {
    const { row, column } = this.active;
    const result = changeTable(this.model, row, column, action);
    if (!result) return false;
    const start = this.view.posAtDOM(this.root);
    this.finish();
    this.view.dispatch({ changes: { from: start, to: start + this.model.raw.length, insert: result.text },
      annotations: isolateHistory.of('full'), userEvent: 'input.table' });
    // 结构变化时编辑器可能重建组件，使用实际文档位置重新找到目标。
    const root = [...this.view.dom.querySelectorAll('.md-table')].find(element => this.view.posAtDOM(element) === start);
    grids.get(root)?.edit(result.row, result.column);
    return true;
  }

  /** Tab 在格子间移动，从末格继续时插入一行。 */
  step(backward) {
    const { row, column } = this.active;
    const index = row * this.model.columns + column + (backward ? -1 : 1);
    if (index < 0) return this.leave(false);
    if (index >= this.model.rows.length * this.model.columns) {
      this.structure('rowBelow');
      if (this.root.isConnected) this.edit(row + 1, 0);
    } else this.edit(Math.floor(index / this.model.columns), index % this.model.columns);
    return true;
  }

  /** 离开表格后恢复正文的键盘操作。 */
  leave(after = true) {
    const anchor = this.view.posAtDOM(this.root) + (after ? this.model.raw.length : 0);
    this.finish();
    this.view.dispatch({ selection: { anchor } });
    this.view.focus();
    return true;
  }

  /** 在单元格里直接编辑已排版的内容，普通输入与表格操作共用主文档历史。 */
  edit(row, column, point) {
    const cell = this.table.rows[row]?.cells[column];
    if (!cell || this.active?.cell === cell) return;
    this.finish();
    cell.replaceChildren();
    const value = this.model.rows[row].cells[column]?.value || '';
    const editor = new EditorView({ parent: cell, state: EditorState.create({ doc: value, extensions: [
      this.extensions, EditorView.lineWrapping, EditorView.contentAttributes.of({ 'aria-label': '编辑单元格' }),
      keymap.of([{ key: 'Tab', run: () => this.step(false) }, { key: 'Shift-Tab', run: () => this.step(true) },
        { key: 'Enter', run: () => this.step(false) }, { key: 'Escape', run: () => this.leave() },
        ...defaultKeymap]),
      EditorState.transactionFilter.of(tr => {
        if (!tr.docChanged || tr.newDoc.lines === 1) return tr;
        const changes = [];
        for (let index = 2; index <= tr.newDoc.lines; index++) {
          const to = tr.newDoc.line(index).from;
          changes.push({ from: to - 1, to, insert: ' ' });
        }
        return [tr, { changes, sequential: true }];
      })
    ] }), dispatchTransactions: (transactions, inner) => {
      inner.update(transactions);
      if (this.active?.editor === inner && transactions.some(tr => tr.docChanged)) this.write(inner.state.doc.toString());
    } });
    this.active = { row, column, cell, editor, range: this.model.rows[row].cells[column] };
    const position = this.view.posAtDOM(this.root) + (this.active.range?.from ?? 0);
    this.view.dispatch({ selection: { anchor: position } });
    editor.focus();
    const anchor = point ? editor.posAtCoords({ x: point.clientX, y: point.clientY }) : value.length;
    editor.dispatch({ selection: { anchor: anchor ?? value.length } });
  }
}

export class TableWidget extends WidgetType {
  /** 保存表格快照和单元格内联排版配置。 */
  constructor(model, extensions) { super(); this.model = model; this.extensions = extensions; }
  /** 相同文本的表格可复用。 */
  eq(other) { return this.model.raw === other.model.raw; }
  /** 创建可导航、可直接输入的表格。 */
  toDOM(view) { return new EditableGrid(view, this.model, this.extensions).root; }
  /** 写入期间保留正在输入的单元格。 */
  updateDOM(root) { grids.get(root).draw(this.model); return true; }
  /** 主文档切换或表格移除时释放子编辑器。 */
  destroy(root) { grids.get(root)?.finish(); }
}

/** 让右键点击和键盘上下文菜单都能定位目标单元格。 */
export function gridAt(cell, point) {
  const grid = grids.get(cell.closest('.md-table'));
  grid.edit(cell.parentElement.rowIndex, cell.cellIndex, point);
  return grid;
}
