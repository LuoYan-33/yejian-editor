import { EditorState, findClusterBreak } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { keymap } from '@codemirror/view';

/** 提取行内标记及其可见正文的两端，包括链接后面的地址。 */
function inlineBounds(node) {
  if (!node) return null;
  if (node.name === 'Link') {
    const marks = node.getChildren('LinkMark');
    return marks.length >= 2 ? { start: marks[0].to, end: marks[1].from } : null;
  }
  if (!['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode'].includes(node.name)) return null;
  return { start: node.firstChild.to, end: node.lastChild.from };
}

/** 在行首和大纲跳转时，将光标放到标题、列表和行内格式的第一个可见文字前。 */
export function visibleStart(state, position) {
  const line = state.doc.lineAt(position);
  if (position !== line.from) return position;
  let cursor = position;
  while (cursor < line.to) {
    const node = syntaxTree(state).resolveInner(cursor, 1);
    if (node.from !== cursor) break;
    if (['HeaderMark', 'QuoteMark', 'ListMark', 'TaskMarker'].includes(node.name)) {
      cursor = node.to + (state.sliceDoc(node.to, node.to + 1) === ' ' ? 1 : 0);
    } else if (inlineBounds(node.parent)?.start === node.to) cursor = node.to;
    else break;
  }
  return cursor;
}

/** 在可见文字边界删除一个字素，成对保留或移除两侧的隐藏标记。 */
function deleteInline(view, backward) {
  const state = view.state, selection = state.selection.main;
  if (view.composing) return false;
  const tree = syntaxTree(state), direction = backward ? -1 : 1;
  if (!selection.empty) {
    let { from, to } = selection;
    for (let node = tree.resolveInner(from, 1); node; node = node.parent) {
      const bounds = inlineBounds(node);
      if (bounds && from === bounds.start && to === bounds.end) { from = node.from; to = node.to; }
    }
    if (from === selection.from && to === selection.to) return false;
    view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: 'delete.selection' });
    return true;
  }
  let cursor = selection.head, formatted = false;
  for (;;) {
    let node = tree.resolveInner(cursor, direction);
    while (node && !inlineBounds(node)) node = node.parent;
    if (!node) break;
    formatted = true;
    const { start, end } = inlineBounds(node);
    if ((backward && cursor <= start) || (!backward && cursor >= end)) {
      view.dispatch({ changes: [{ from: node.from, to: start }, { from: end, to: node.to }], userEvent: 'delete.format' });
      return true;
    }
    const inside = Math.max(start, Math.min(cursor, end));
    if (inside === cursor) break;
    cursor = inside;
  }
  if (!formatted) return false;
  const line = state.doc.lineAt(cursor);
  const adjacent = line.from + findClusterBreak(line.text, cursor - line.from, !backward);
  if (cursor === adjacent) return false;
  let from = Math.min(cursor, adjacent), to = Math.max(cursor, adjacent);
  for (let node = tree.resolveInner(from, 1); node; node = node.parent) {
    const bounds = inlineBounds(node);
    if (bounds && from === bounds.start && to === bounds.end) { from = node.from; to = node.to; }
  }
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: backward ? 'delete.backward' : 'delete.forward' });
  return true;
}

/** 即时模式中的光标按可见排版定位，源码模式仍使用原始字符偏移。 */
export function richBoundaries(sourceMode) {
  return [EditorState.transactionFilter.of(tr => {
    if (!tr.selection || tr.docChanged || tr.startState.field(sourceMode)) return tr;
    const range = tr.selection.main;
    if (range.empty) {
      const anchor = visibleStart(tr.startState, range.head);
      return anchor === range.head ? tr : [tr, { selection: { anchor }, sequential: true }];
    }
    // 选到行尾时避免只选中一侧定界符，否则输入替换后会留下另一侧标记。
    let { from, to } = range;
    for (let node = syntaxTree(tr.startState).resolveInner(from, 1); node; node = node.parent) {
      const bounds = inlineBounds(node);
      if (!bounds || to > node.to || (from === node.from && to === node.to)) continue;
      from = Math.max(from, bounds.start);
      to = Math.max(from, Math.min(to, bounds.end));
    }
    if (from === range.from && to === range.to) return tr;
    const selection = range.anchor < range.head ? { anchor: from, head: to } : { anchor: to, head: from };
    return [tr, { selection, sequential: true }];
  }), keymap.of([
    { key: 'Backspace', run: view => !view.state.field(sourceMode) && deleteInline(view, true) },
    { key: 'Delete', run: view => !view.state.field(sourceMode) && deleteInline(view, false) }
  ])];
}
