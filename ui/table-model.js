/** 按 Markdown 表格的分隔符切分，记住原文位置和单元格两侧的空白。 */
function readRow(doc, node, origin) {
  const text = doc.sliceString(node.from, node.to);
  const pipes = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\\') index++;
    else if (text[index] === '|') pipes.push(index);
  }
  const edges = [-1, ...pipes, text.length];
  if (pipes.length && !text.slice(0, pipes[0]).trim()) edges.shift();
  if (pipes.length && !text.slice(pipes.at(-1) + 1).trim()) edges.pop();
  const cells = [];
  for (let index = 1; index < edges.length; index++) {
    const start = edges[index - 1] + 1;
    const raw = text.slice(start, edges[index]);
    const value = raw.trim();
    const from = node.from - origin + start + (value ? raw.indexOf(value) : Math.floor(raw.length / 2));
    cells.push({ value, from, to: from + value.length });
  }
  return { cells, prefix: doc.sliceString(doc.lineAt(node.from).from, node.from) };
}

/** 从解析器定位的行读取表格，同时保留引用或列表里的续行缩进。 */
export function readTable(doc, node) {
  const rows = [node.getChild('TableHeader'), ...node.getChildren('TableRow')].map(row => readRow(doc, row, node.from));
  const divider = readRow(doc, node.getChild('TableDelimiter'), node.from);
  return { rows, divider, columns: Math.max(...rows.map(row => row.cells.length)), raw: doc.sliceString(node.from, node.to) };
}

/** 转义单元格里的竖线，保留已有转义，并将单元格粘贴的换行合为空格。 */
export function encodeCell(value) {
  return value.replace(/\r\n?|\n/g, ' ').replace(/(\\*)\|/g, (match, slashes) => slashes.length % 2 ? match : '\\' + match);
}

/** 只在结构变化或补齐短行时重新生成表格；普通输入直接替换一个单元格。 */
export function changeTable(model, row, column, action, value = '') {
  const cells = model.rows.map(entry => Array.from({ length: model.columns }, (_, index) => entry.cells[index]?.value || ''));
  const prefixes = model.rows.map(entry => entry.prefix);
  const rules = Array.from({ length: model.columns }, (_, index) => model.divider.cells[index]?.value || '---');
  let nextRow = row, nextColumn = column;
  if (action === 'cell') cells[row][column] = value;
  else if (action === 'rowAbove' || action === 'rowBelow') {
    if (row === 0 && action === 'rowAbove') return null;
    nextRow = row + Number(action === 'rowBelow');
    cells.splice(nextRow, 0, Array(model.columns).fill(''));
    prefixes.splice(nextRow, 0, row ? prefixes[row] : model.divider.prefix);
  } else if (action === 'deleteRow') {
    if (!row) return null;
    cells.splice(row, 1); prefixes.splice(row, 1);
    nextRow = Math.min(row, cells.length - 1);
  } else if (action === 'colLeft' || action === 'colRight') {
    nextColumn = column + Number(action === 'colRight');
    for (const entry of cells) entry.splice(nextColumn, 0, '');
    rules.splice(nextColumn, 0, '---');
  } else if (action === 'deleteCol') {
    if (model.columns === 1) return null;
    for (const entry of cells) entry.splice(column, 1);
    rules.splice(column, 1); nextColumn = Math.min(column, rules.length - 1);
  } else return null;
  const render = values => '| ' + values.join(' | ') + ' |';
  const lines = cells.map((entry, index) => (index ? prefixes[index] : '') + render(entry));
  lines.splice(1, 0, model.divider.prefix + render(rules));
  return { text: lines.join('\n'), row: nextRow, column: nextColumn };
}
