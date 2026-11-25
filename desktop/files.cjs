const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { EOL } = require('node:os');
const { types } = require('./bitmap.cjs');

/** 用文件内容识别外部编辑，避免依赖时间戳精度。 */
function fingerprint(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 读取 UTF-8 文档，并保留原有的 BOM 和换行习惯。 */
async function readDocument(filePath) {
  const bytes = await fs.readFile(filePath);
  const bom = bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191]));
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('文件不是有效的 UTF-8 文本，请先转换编码。');
  }
  if (text.includes('\0')) throw new Error('这个文件包含二进制数据，无法作为 Markdown 打开。');
  const endings = text.match(/\r\n|\r|\n/g) || [];
  const eol = endings[0] || EOL;
  return { filePath, text: text.replace(/\r\n?/g, '\n'), bom, eol, revision: fingerprint(bytes) };
}

/** 对已有文档按原编码写入，成功后才替换目标文件。 */
async function writeDocument(filePath, text, format) {
  const bytes = Buffer.from((format.bom ? '\uFEFF' : '') + text.replace(/\n/g, format.eol), 'utf8');
  const temporary = path.join(path.dirname(filePath), '.yejian-' + randomUUID() + '.tmp');
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return { filePath, bom: format.bom, eol: format.eol, revision: fingerprint(bytes) };
}

/** 检查磁盘内容是否仍与打开或上次保存时一致。 */
async function hasChanged(document) {
  try {
    return fingerprint(await fs.readFile(document.filePath)) !== document.revision;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

/** 只向编辑页面提供当前文档目录下的本地位图。 */
async function resolveImage(documentPath, relative) {
  if (!documentPath || !relative || /[:\\]/.test(relative) || path.isAbsolute(relative)) return null;
  const root = await fs.realpath(path.dirname(documentPath));
  const imagePath = await fs.realpath(path.resolve(root, relative));
  const inside = path.relative(root, imagePath);
  if (inside === '..' || inside.startsWith('..' + path.sep) || path.isAbsolute(inside)) return null;
  const extension = path.extname(imagePath).slice(1).toLowerCase();
  const type = Object.hasOwn(types, extension) ? types[extension] : null;
  return type ? { path: imagePath, type } : null;
}

module.exports = { readDocument, writeDocument, hasChanged, resolveImage };
