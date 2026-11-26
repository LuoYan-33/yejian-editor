import { Compartment, EditorState, Prec } from '@codemirror/state';
import { drawSelection, EditorView, keymap, placeholder, scrollPastEnd } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { followLink, liveMarkdown, setSource, sourceMode } from './live.js';
import { activeGrid, gridAt } from './table.js';
import { visibleStart } from './edit-boundaries.js';
import { insertImage } from './images.js';

const highlighting = new Compartment();

/** 保留浅色语法配色，并为深色和自定义窗口背景提供可读的前景色。 */
function syntaxColor(light, dark) {
  return `var(--editor-ink, light-dark(${light}, ${dark}))`;
}

const sourceHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.meta, color: syntaxColor('#404740', '#c0bcb1') },
  { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.heading, textDecoration: 'underline', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.keyword, color: syntaxColor('#708', '#deb2ef') },
  { tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName], color: syntaxColor('#219', '#a8bbf0') },
  { tag: [tags.literal, tags.inserted], color: syntaxColor('#164', '#a5d5b6') },
  { tag: [tags.string, tags.deleted], color: syntaxColor('#a11', '#f3ab9a') },
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: syntaxColor('#e40', '#f4b187') },
  { tag: tags.definition(tags.variableName), color: syntaxColor('#00f', '#a8bbf0') },
  { tag: tags.local(tags.variableName), color: syntaxColor('#30a', '#deb2ef') },
  { tag: [tags.typeName, tags.namespace], color: syntaxColor('#085', '#a5d5b6') },
  { tag: tags.className, color: syntaxColor('#167', '#9ed0dc') },
  { tag: [tags.special(tags.variableName), tags.macroName], color: syntaxColor('#256', '#9ed0dc') },
  { tag: tags.definition(tags.propertyName), color: syntaxColor('#00c', '#a8bbf0') },
  { tag: tags.comment, color: syntaxColor('#940', '#ddba91') },
  { tag: tags.invalid, color: syntaxColor('#f00', '#ff9f91') }
]));
const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });
const listKeys = Prec.high(keymap.of([
  { key: 'Enter', run: continueList },
  { key: 'Backspace', run: deleteMarkupBackward }
]));
const listPrefixes = { bullet: '- ', ordered: '1. ', task: '- [ ] ' };

/** 复用语法树续写和重排编号；退出顶层空项时留空行，使后续输入成为独立正文。 */
function continueList(view) {
  const { state } = view, selection = state.selection.main;
  const line = state.doc.lineAt(selection.head);
  const empty = selection.empty && /^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?$/.test(line.text);
  let item = empty ? syntaxTree(state).resolveInner(selection.head, -1) : null;
  while (item && item.name !== 'ListItem') item = item.parent;
  const separate = item?.parent?.parent?.name === 'Document' && item.prevSibling && line.number > 1
    && state.doc.line(line.number - 1).text.trim();
  if (!separate) return continueMarkup(view);
  return continueMarkup({ state, dispatch: tr => {
    const anchor = tr.newSelection.main.head;
    view.dispatch(state.update(tr, { changes: { from: anchor, insert: '\n' }, selection: { anchor: anchor + 1 }, sequential: true }));
  } });
}
const labels = {
  'Control character': '控制字符', 'go to line': '跳到行', 'Search': '查找', 'Replace': '替换',
  'next': '下一个', 'previous': '上一个', 'all': '全部', 'match case': '区分大小写', 'by word': '全字匹配',
  'regexp': '正则表达式', 'replace': '替换', 'replace all': '全部替换', 'close': '关闭', 'current match': '当前匹配',
  'replaced $ matches': '已替换 $ 处', 'replaced match on line $': '已替换第 $ 行的匹配', 'on line': '位于行'
};

/** 给每个打开的文档分配独立的撤销记录和选区。 */
export function createState(text, onUpdate, source = false) {
  let state = EditorState.create({ doc: text, extensions: [
    markdown({ base: markdownLanguage, addKeymap: false }), listKeys, liveMarkdown, highlighting.of(source ? sourceHighlight : []),
    history(), drawSelection(), EditorView.lineWrapping, scrollPastEnd(), placeholder('开始写作…'),
    keymap.of([...historyKeymap, ...defaultKeymap, ...searchKeymap, indentWithTab]), search({ top: true }),
    EditorState.phrases.of(labels), EditorView.contentAttributes.of({ 'aria-label': 'Markdown 文档正文', spellcheck: 'false' }),
    EditorView.domEventHandlers({ mousedown: followLink }),
    EditorView.updateListener.of(onUpdate)
  ] });
  if (source) state = state.update({ effects: setSource.of(true) }).state;
  else state = state.update({ selection: { anchor: visibleStart(state, 0) } }).state;
  return state;
}

/** 切换展示层，保留当前选区、原文和撤销记录。 */
export function changeMode(view, source) {
  if (view.state.field(sourceMode) === source) return;
  view.dispatch({ effects: [setSource.of(source), highlighting.reconfigure(source ? sourceHighlight : [])] });
}

/** 在选择内容两侧添加标记，把焦点保留在可编辑的正文。 */
function wrap(view, before, after, fallback) {
  const { from, to } = view.state.selection.main;
  const content = view.state.sliceDoc(from, to) || fallback;
  view.dispatch({ changes: { from, to, insert: before + content + after },
    selection: { anchor: from + before.length, head: from + before.length + content.length }, userEvent: 'input' });
}

/** 对选中的完整行应用标题、引用或列表前缀。 */
function prefixLines(view, prefix) {
  const { from, to } = view.state.selection.main;
  const first = view.state.doc.lineAt(from), last = view.state.doc.lineAt(to > from ? to - 1 : to);
  const changes = [];
  let sequence = 1;
  const underlines = new Set();
  const tree = syntaxTree(view.state);
  for (let number = first.number; number <= last.number; number++) {
    const line = view.state.doc.line(number);
    if (underlines.has(number)) continue;
    let node = tree.resolveInner(line.from, 1);
    while (node && !/^(?:ATX|Setext)Heading/.test(node.name)) node = node.parent;
    const marks = node?.getChildren('HeaderMark') || [];
    if (node?.name.startsWith('Setext')) underlines.add(view.state.doc.lineAt(node.to).number);
    else if (marks.length > 1) changes.push({ from: marks.at(-1).from - 1, to: marks.at(-1).to });
    const existing = /^(?:#{1,6}(?:\s+|$)|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/.exec(line.text)?.[0] || '';
    const insert = prefix === listPrefixes.ordered ? String(sequence++) + '. ' : prefix;
    changes.push({ from: line.from, to: line.from + existing.length, insert });
  }
  for (const number of underlines) {
    const line = view.state.doc.line(number);
    changes.push({ from: line.from - 1, to: line.to });
  }
  changes.sort((left, right) => left.from - right.from);
  const updated = view.state.changes(changes);
  const selection = from === to ? { anchor: updated.mapPos(from, 1) } : undefined;
  view.dispatch({ changes: updated, selection, userEvent: 'input.format' });
}

/** 再次应用同一行内格式时，移除相应标记并保留正文选区。 */
function inlineStyle(view, action, wrapper) {
  const names = { bold: 'StrongEmphasis', italic: 'Emphasis', inlineCode: 'InlineCode' };
  const { from, to } = view.state.selection.main;
  let node = syntaxTree(view.state).resolveInner(from, 1);
  while (node && (node.name !== names[action] || node.to < to)) node = node.parent;
  const first = node?.firstChild, last = node?.lastChild;
  if (!first || !last || first === last) return wrap(view, ...wrapper);
  const start = Math.max(first.to, from), end = Math.min(last.from, to);
  const whole = from === to || (start === first.to && end === last.from);
  if (!whole && action !== 'inlineCode') {
    const token = view.state.sliceDoc(first.from, first.to);
    const left = view.state.sliceDoc(first.to, start), plain = view.state.sliceDoc(start, end), right = view.state.sliceDoc(end, last.from);
    const before = left ? token + left + token : '';
    const after = right ? token + right + token : '';
    view.dispatch({ changes: { from: node.from, to: node.to, insert: before + plain + after },
      selection: { anchor: node.from + before.length, head: node.from + before.length + plain.length }, userEvent: 'input.format' });
    return;
  }
  view.dispatch({ changes: [{ from: first.from, to: first.to }, { from: last.from, to: last.to }], userEvent: 'input.format' });
}

/** 在当前段落后或空行处插入完整块，并将光标放到可继续输入的位置。 */
function insertBlock(view, text, offset) {
  const { state } = view, position = state.selection.main.to;
  const line = state.doc.lineAt(position);
  let block = syntaxTree(state).resolveInner(position, position === line.from ? 1 : -1);
  while (block.parent && block.parent.name !== 'Document') block = block.parent;
  // 在当前段落之后插入，避免拆散选中内容和隐藏的成对标记。
  const from = line.text.trim() && block.name !== 'Document' ? state.doc.lineAt(block.to).to : line.from;
  const insertionLine = state.doc.lineAt(from);
  let before = '';
  if (from && insertionLine.text.trim()) before = '\n\n';
  else if (insertionLine.number > 1 && state.doc.line(insertionLine.number - 1).text.trim()) before = '\n';
  const start = from + before.length;
  const after = state.doc.lineAt(from).to < state.doc.length && state.doc.line(state.doc.lineAt(from).number + 1).text.trim() ? '\n' : '';
  view.dispatch({ changes: { from, insert: before + text + after }, selection: { anchor: start + offset },
    scrollIntoView: true, userEvent: 'input.block' });
  return start;
}

/** 建立独立表格块，并让首个表头立即接收输入。 */
function insertTable(view) {
  const start = insertBlock(view, '| 列一 | 列二 |\n| --- | --- |\n|  |  |\n\n', 2);
  if (view.state.field(sourceMode)) return;
  const root = [...view.dom.querySelectorAll('.md-table')].find(table => view.posAtDOM(table) === start);
  if (root) {
    const cell = gridAt(root.querySelector('th'));
    cell.active.editor.dispatch({ selection: { anchor: 0, head: cell.active.editor.state.doc.length } });
  }
}

/** 让菜单和快捷键复用相同的编辑命令。 */
export function format(parent, action, argument) {
  const grid = activeGrid(parent);
  if (action === 'image') return insertImage(parent, grid, argument);
  if (action === 'undo' || action === 'redo') {
    const location = grid?.active;
    const changed = action === 'undo' ? undo(parent) : redo(parent);
    if (location && grid.root.isConnected) {
      grid.edit(Math.min(location.row, grid.model.rows.length - 1), Math.min(location.column, grid.model.columns - 1));
      grid.active?.editor.focus();
    } else parent.focus();
    return changed;
  }
  if (action === 'find') return openSearchPanel(parent);
  const view = grid?.active?.editor || parent;
  view.focus();
  const tick = String.fromCharCode(96);
  const wrappers = { bold: ['**', '**', '粗体文字'], italic: ['*', '*', '斜体文字'], inlineCode: [tick, tick, '代码'],
    fence: ['\n' + tick.repeat(3) + '\n', '\n' + tick.repeat(3) + '\n', '代码'] };
  if (['bold', 'italic', 'inlineCode'].includes(action)) return inlineStyle(view, action, wrappers[action]);
  if (grid) return;
  if (action === 'table') return insertTable(view);
  if (action === 'rule') return insertBlock(view, '---\n\n', 5);
  const insertList = { insertBullet: 'bullet', insertOrdered: 'ordered', insertTask: 'task' }[action];
  if (insertList) {
    const prefix = listPrefixes[insertList];
    if (view.state.selection.main.empty) return insertBlock(view, prefix, prefix.length);
    return prefixLines(view, prefix);
  }
  if (action === 'fence') return wrap(view, ...wrappers.fence);
  const prefixes = { paragraph: '', h1: '# ', h2: '## ', h3: '### ', quote: '> ', ...listPrefixes };
  if (Object.hasOwn(prefixes, action)) prefixLines(view, prefixes[action]);
}
