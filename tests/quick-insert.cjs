const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

/** 在目标段落右键选择插入操作。 */
async function choose(page, target, label) {
  await target.click({ button: 'right', position: { x: 3, y: 7 } });
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

/** 验证三类列表连续输入、空项退出、任务状态以及选中多行后的自动编号。 */
async function verifyLists(page) {
  const lines = page.locator('#editor > .cm-editor > .cm-scroller > .cm-content > .cm-line');
  for (const [name, prefix] of [['无序列表', '- '], ['有序列表', '1. '], ['任务列表', '- [ ] ']]) {
    await page.keyboard.press('Control+n');
    await page.locator('.cm-placeholder').waitFor();
    await choose(page, lines.first(), name);
    await page.keyboard.insertText('第一项');
    if (name === '任务列表') {
      await page.locator('.cm-task').check();
      await lines.first().click();
      await page.keyboard.press('End');
    }
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('第二项');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('结束后的正文');
    await page.locator('#source-mode').click();
    const expected = [(name === '任务列表' ? '- [x] ' : prefix) + '第一项',
      (name === '有序列表' ? '2. ' : prefix) + '第二项', '', '结束后的正文'];
    assert.deepEqual(await lines.allTextContents(), expected, name);
    await page.locator('#live-mode').click();
  }
  await page.keyboard.press('Control+n');
  await page.locator('.cm-placeholder').waitFor();
  await page.keyboard.insertText('甲\n乙\n丙');
  await page.keyboard.press('Control+a');
  await choose(page, lines.nth(1), '有序列表');
  await page.locator('#source-mode').click();
  assert.deepEqual(await lines.allTextContents(), ['1. 甲', '2. 乙', '3. 丙']);
  await page.locator('#live-mode').click();
}

/** 在独立临时目录验证本地选图、截图粘贴、撤销与单文件分享。 */
async function verifyQuickInsert(app, page, directory) {
  await verifyLists(page);
  const source = path.join(directory, '插图[一].png');
  const documentFile = path.join(directory, '配图笔记.md');
  const shareDir = path.join(directory, '仅分享文档');
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 13; canvas.height = 7;
    canvas.getContext('2d').fillRect(0, 0, 13, 7);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await fs.writeFile(source, Buffer.from(base64, 'base64'));
  await app.evaluate(({ dialog }, { source, documentFile }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: documentFile });
  }, { source, documentFile });
  await page.keyboard.press('Control+n');
  await page.locator('.cm-placeholder').waitFor();
  const content = page.locator('#editor > .cm-editor > .cm-scroller > .cm-content');
  await choose(page, content.locator('.cm-line').first(), '插入图片…');
  await page.waitForFunction(() => document.querySelector('.md-image')?.naturalWidth === 13);
  assert.equal(await page.locator('.md-image').getAttribute('alt'), '插图[一]');
  await page.keyboard.press('Control+z');
  await page.locator('.cm-placeholder').waitFor();
  await page.keyboard.press('Control+Shift+z');
  await page.locator('.md-image').waitFor();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.evaluate(base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], '截图.png', { type: 'image/png' }));
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, base64);
  await page.waitForFunction(() => document.querySelectorAll('.md-image').length === 2);
  await choose(page, content.locator('.cm-line').last(), '插入表格');
  const cell = page.locator('.md-table td').first();
  await choose(page, cell, '插入图片…');
  await cell.locator('.md-image').waitFor();
  await page.locator('#filename').click();
  await page.waitForFunction(() => document.querySelector('.md-table td img')?.naturalWidth === 13);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelector('#filename').textContent === '配图笔记.md' && document.querySelector('#dirty-dot').hidden);
  const saved = await fs.readFile(documentFile, 'utf8');
  assert.equal(saved.split('data:image/png;base64,' + base64).length - 1, 3);
  assert.ok(!saved.includes(directory));
  await fs.mkdir(shareDir);
  const standalone = path.join(shareDir, '分享.md');
  await fs.copyFile(documentFile, standalone);
  await fs.unlink(source);
  await app.evaluate(({ dialog }, standalone) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [standalone] }); }, standalone);
  await page.keyboard.press('Control+o');
  await page.waitForFunction(() => document.querySelector('#filename').textContent === '分享.md' &&
    Array.from(document.querySelectorAll('.md-image')).filter(image => image.naturalWidth === 13).length === 3);
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await choose(page, content.locator('.cm-line').first(), '插入图片…');
  assert.equal(await page.locator('#dirty-dot').isHidden(), true);
  console.log('快捷插入通过：三类列表续写和退出、多行编号、选图及截图粘贴、表格图片、撤销重做、独立文档离线重开。');
}

module.exports = { verifyQuickInsert };
