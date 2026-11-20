const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readDocument, writeDocument, hasChanged, resolveImage } = require('../desktop/files.cjs');

/** 为每项验证分配专有临时目录，结束时只清理该目录内的测试文件。 */
async function fixture(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yejian-test-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('保存和重新打开保留中文、表格、BOM 以及原始换行形式', async context => {
  const dir = await fixture(context);
  const text = '# 标题\n\n| 一 | 二 |\n|---|---|\n| 甲 | 乙 |\n';
  for (const eol of ['\n', '\r\n', '\r']) {
    for (const bom of [false, true]) {
      const file = path.join(dir, '我的笔记.md');
      const written = await writeDocument(file, text, { eol, bom });
      assert.equal(await hasChanged(written), false);
      assert.deepEqual(await readDocument(file), { ...written, text });
      assert.equal(await fs.readFile(file, 'utf8'), (bom ? '\uFEFF' : '') + text.replace(/\n/g, eol));
    }
  }
});

test('检测外部修改与删除，无法解码的文件不得误读后覆盖', async context => {
  const file = path.join(await fixture(context), '记录.md');
  const original = await writeDocument(file, '旧', { bom: false, eol: '\n' });
  await fs.writeFile(file, '新');
  assert.equal(await hasChanged(original), true);
  await fs.writeFile(file, Buffer.from([0xff, 0xfe, 1]));
  await assert.rejects(readDocument(file), /UTF-8/);
  await fs.writeFile(file, Buffer.from([0, 1, 2]));
  await assert.rejects(readDocument(file), /二进制/);
  await fs.unlink(file);
  assert.equal(await hasChanged(original), true);
});

test('本地图片限制在文档目录，拒绝其他格式及外部目录', async context => {
  const dir = await fixture(context);
  const sub = path.join(dir, '笔记');
  await fs.mkdir(sub);
  const file = path.join(sub, '记录.md');
  await fs.writeFile(path.join(sub, '截图.png'), '测试');
  await fs.writeFile(file, '正文');
  await fs.writeFile(path.join(dir, '外部.png'), '测试');
  assert.equal((await resolveImage(file, '截图.png')).type, 'image/png');
  for (const address of ['../外部.png', '记录.md', 'C:\\Windows\\a.jpg', 'https://example.com/a.png']) {
    assert.equal(await resolveImage(file, address), null);
  }
});
