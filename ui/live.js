import { StateEffect, StateField } from '@codemirror/state';
import { ensureSyntaxTree, Language, language, syntaxTree } from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { readTable } from './table-model.js';
import { TableWidget } from './table.js';
import { richBoundaries } from './edit-boundaries.js';
import { imageAddress, imageTarget } from './images.js';

export const setSource = StateEffect.define();
export const sourceMode = StateField.define({
  create: () => false,
  update: (value, transaction) => transaction.effects.find(effect => effect.is(setSource))?.value ?? value
});

const parsedDocuments = new WeakMap();

/** 大纲和即时视图共用完整语法树，跳转长文时也能直接显示排版。 */
function documentTree(state) {
  let tree = parsedDocuments.get(state.doc);
  if (!tree) {
    tree = ensureSyntaxTree(state, state.doc.length, 25) || state.facet(language).parser.parse(state.doc.toString());
    parsedDocuments.set(state.doc, tree);
  }
  return tree;
}

class InlineWidget extends WidgetType {
  /** 保存生成预览所需的内容，不记录可能在编辑中失效的偏移。 */
  constructor(kind, value = '', description = '') {
    super();
    Object.assign(this, { kind, value, description });
  }
  /** 内容一致时复用已有节点，以免光标移动时重复加载图片。 */
  eq(other) { return this.kind === other.kind && this.value === other.value && this.description === other.description; }
  /** 创建嵌在编辑器中的标记，并让鼠标操作直接回写文档。 */
  toDOM(view) {
    if (this.kind === 'task') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'cm-task';
      checkbox.checked = /x/i.test(this.value);
      checkbox.setAttribute('aria-label', '切换任务完成状态');
      checkbox.onmousedown = event => event.preventDefault();
      checkbox.onchange = () => {
        const from = view.posAtDOM(checkbox);
        view.dispatch({ changes: { from, to: from + 3, insert: checkbox.checked ? '[x]' : '[ ]' }, userEvent: 'input' });
      };
      return checkbox;
    }
    const element = document.createElement(this.kind === 'image' ? 'img' : 'span');
    if (this.kind === 'image') {
      element.className = 'md-image';
      element.alt = this.description || '图片';
      element.src = this.value;
    } else {
      element.className = this.kind === 'rule' ? 'cm-rule' : 'cm-bullet';
      element.textContent = this.value;
    }
    element.onmousedown = event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const from = view.posAtDOM(element);
      view.dispatch({ selection: { anchor: from } });
      view.focus();
    };
    return element;
  }
}

/** 从图片标签取出可读说明，避免将地址或内嵌数据用作显示文字。 */
function imageLabel(doc, image) {
  const close = image.getChildren('LinkMark')[1];
  return close && doc.sliceString(image.from + 2, close.from).replace(/\\([\\[\]|])/g, '$1') || '图片';
}

/** 将一段 Markdown 语法转换成原文上的样式或预览组件。 */
function decorateNode(node, state, ranges, hidden) {
  const { name, from, to } = node;
  const doc = state.doc;
  const text = () => doc.sliceString(from, to);
  const mark = (className, start = from, end = to) => {
    if (end > start) ranges.push(Decoration.mark({ class: className }).range(start, end));
  };
  const replace = (start, end, widget, block = false) => {
    if (end <= start) return;
    const range = Decoration.replace({ widget, block }).range(start, end);
    ranges.push(range);
    hidden.push(range);
  };
  const line = (className, position = from) => ranges.push(Decoration.line({ class: className }).range(doc.lineAt(position).from));
  const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
  if (heading) line('line-h' + heading[1]);
  if (name === 'HeaderMark' || name === 'QuoteMark') {
    if (name === 'QuoteMark') line('line-quote');
    replace(from, to + (doc.sliceString(to, to + 1) === ' ' ? 1 : 0));
  } else if (name === 'ListMark') {
    line('line-list');
    if (/^[-+*]$/.test(text())) {
      const beforeTask = /^\s+\[[ xX]\]/.test(doc.sliceString(to, doc.lineAt(to).to));
      replace(from, to + (beforeTask ? 1 : 0), beforeTask ? undefined : new InlineWidget('bullet', '•'));
    }
  } else if (name === 'TaskMarker') replace(from, to, new InlineWidget('task', text()));
  else if (name === 'StrongEmphasis') mark('cm-strong');
  else if (name === 'Emphasis') mark('cm-emphasis');
  else if (name === 'InlineCode') mark('cm-inline-code');
  else if (name === 'Strikethrough') mark('cm-strike');
  else if (['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'SubscriptMark', 'SuperscriptMark'].includes(name)) replace(from, to);
  else if (name === 'Escape') replace(from, from + 1);
  else if (name === 'HorizontalRule') replace(from, to, new InlineWidget('rule'));
  else if (name === 'Autolink') {
    for (const edge of node.node.getChildren('LinkMark')) replace(edge.from, edge.to);
    mark('cm-md-link');
  } else if (name === 'LinkReference') {
    replace(from, to);
    return false;
  } else if (name === 'Link') {
    const close = node.node.getChildren('LinkMark')[1];
    if (close) { replace(from, from + 1); mark('cm-md-link', from + 1, close.from); replace(close.from, to); }
  } else if (name === 'Image') {
    const url = node.node.getChild('URL');
    const address = url && imageAddress(doc.sliceString(url.from, url.to).replace(/^<|>$/g, ''));
    const alt = imageLabel(doc, node.node);
    replace(from, to, address ? new InlineWidget('image', address, alt) : new InlineWidget('alt', alt));
    return false;
  } else if (name === 'Table') {
    replace(from, to, new TableWidget(readTable(doc, node.node), cellExtensions), true);
    return false;
  } else if (name === 'FencedCode' || name === 'CodeBlock') {
    const endLine = doc.lineAt(to).number;
    for (let number = doc.lineAt(from).number; number <= endLine; number++) line('line-code', doc.line(number).from);
    // 只收起围栏及其语言名，代码内容仍是可逐字编辑的正文。
    for (const child of node.node.getChildren('CodeMark')) {
      replace(child.from, doc.lineAt(child.from).to);
      line('line-fence', child.from);
    }
    return false;
  }
}

/** 基于编辑器的增量语法树排版，底层文档始终保留原始 Markdown。 */
function decorations(state) {
  const ranges = [], hidden = [];
  if (!state.field(sourceMode)) documentTree(state).iterate({ enter: node => decorateNode(node, state, ranges, hidden) });
  return { styled: Decoration.set(ranges, true), atomic: Decoration.set(hidden, true) };
}

const liveDecorations = StateField.define({
  create: decorations,
  update(value, transaction) {
    if (transaction.docChanged || transaction.effects.some(effect => effect.is(setSource))) return decorations(transaction.state);
    return value;
  },
  provide: field => [EditorView.decorations.from(field, value => value.styled),
    EditorView.atomicRanges.of(view => view.state.field(field).atomic)]
});

export const liveMarkdown = [sourceMode, imageTarget, liveDecorations, richBoundaries(sourceMode)];

// 单元格只解释行内标记，格子里的井号、减号等仍是普通文字。
const inlineLanguage = new Language(markdownLanguage.data, markdownLanguage.parser.configure({
  remove: ['IndentedCode', 'FencedCode', 'Blockquote', 'HorizontalRule', 'BulletList', 'OrderedList', 'ATXHeading',
    'HTMLBlock', 'LinkReference', 'SetextHeading', 'Table', 'TaskList']
}));
const cellExtensions = [inlineLanguage, liveMarkdown];

/** 从同一棵语法树提取标题，避免把代码块和引用示例错误地识别为标题文本。 */
export function headings(state) {
  const result = [];
  const tree = documentTree(state);
  tree.iterate({ enter(node) {
    const match = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
    if (!match) return;
    const headingLine = state.doc.lineAt(node.from);
    let cursor = headingLine.from, line = '';
    node.node.cursor().iterate(child => {
      if (child.name !== 'Image' || child.to > headingLine.to) return;
      line += state.doc.sliceString(cursor, child.from) + imageLabel(state.doc, child.node);
      cursor = child.to;
      return false;
    });
    line += state.doc.sliceString(cursor, headingLine.to);
    const title = line.replace(/^\s{0,3}#{1,6}\s+|\s+#+\s*$/g, '').replace(/[*_\x60]/g, '').trim();
    result.push({ level: Number(match[1]), title: title || '无标题', from: node.from });
  } });
  return result;
}

/** Ctrl + 单击链接时交给系统浏览器，普通单击仍可编辑链接。 */
export function followLink(event, view) {
  if (!event.ctrlKey) return false;
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null) return false;
  let node = syntaxTree(view.state).resolveInner(position, 1);
  while (node && node.name !== 'Link' && node.name !== 'Autolink') node = node.parent;
  const url = node?.getChild('URL');
  if (!url) return false;
  window.desk.link(view.state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, ''));
  return true;
}
