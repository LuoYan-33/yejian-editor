const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

/** 在真实编辑窗口中点选右键菜单项。 */
async function choose(page, target, label) {
  await target.click({ button: 'right', position: { x: 5, y: 8 } });
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

/** 验证即时输入、右键格式、表格编辑以及保存后的 Markdown 原文。 */
async function verifyRichEditing(page, file) {
  const input = '# 标题\n\n选择文字\n\n**加粗** 和 [链接](https://example.com)\n\n**单字**\n\n~~~js\nconst sample = 1;\n~~~\n\n| 名称 | 数量 |\n| :--- | ---: |\n| **苹果** | 12 |\n';
  await fs.writeFile(file, input);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+o');
  await page.locator('.line-h1').filter({ hasText: '标题' }).waitFor();
  const content = page.locator('#editor > .cm-editor > .cm-scroller > .cm-content');
  await content.locator('.cm-strong').first().click();
  assert.doesNotMatch(await content.innerText(), /\*\*|https:\/\/|~~~|# 标题|---:/);
  await page.locator('.line-h1').click();
  assert.equal(await page.locator('.line-h1').innerText(), '标题');
  await page.keyboard.press('Control+Home');
  await page.keyboard.insertText('新');
  assert.equal(await page.locator('.line-h1').allInnerTexts().then(lines => lines[0]), '新标题');
  await page.keyboard.press('Control+z');
  const strongLine = content.locator('.cm-line').filter({ hasText: '单字' });
  await strongLine.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  assert.equal(await content.locator('.cm-strong').filter({ hasText: /^单$/ }).count(), 1);
  await page.keyboard.press('Backspace');
  assert.doesNotMatch(await content.innerText(), /\*\*/);
  const plain = content.locator('.cm-line').filter({ hasText: '选择文字' });
  await plain.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await choose(page, plain, '粗体');
  await plain.locator('.cm-strong').waitFor();
  assert.equal(await plain.innerText(), '选择文字');
  await choose(page, plain, '二级标题');
  await page.locator('.line-h2').filter({ hasText: '选择文字' }).waitFor();

  const rows = page.locator('.md-table tr');
  const cell = (row, column) => rows.nth(row).locator('th,td').nth(column);
  await cell(1, 0).click();
  assert.equal(await cell(1, 0).innerText(), '苹果');
  await choose(page, cell(1, 0), '在下方插入行');
  assert.equal(await rows.count(), 3);
  await page.keyboard.insertText('梨');
  await page.keyboard.insertText(' ');
  await page.keyboard.insertText('汁|饮品');
  await page.keyboard.press('Tab');
  await page.keyboard.insertText('25');
  await choose(page, cell(2, 1), '在左侧插入列');
  assert.equal(await rows.first().locator('th').count(), 3);
  const composition = await page.context().newCDPSession(page);
  await composition.send('Input.imeSetComposition', { text: 'xin', selectionStart: 3, selectionEnd: 3 });
  await composition.send('Input.imeSetComposition', { text: '新增', selectionStart: 2, selectionEnd: 2 });
  await composition.send('Input.insertText', { text: '新增' });
  await composition.detach();
  await page.keyboard.press('Control+a');
  await choose(page, cell(2, 1), '斜体');
  await cell(2, 1).locator('.cm-emphasis').waitFor();
  await choose(page, cell(2, 1), '在右侧插入列');
  assert.equal(await rows.first().locator('th').count(), 4);
  await choose(page, cell(2, 2), '删除当前列');
  await choose(page, cell(2, 0), '在上方插入行');
  assert.equal(await rows.count(), 4);
  await choose(page, cell(2, 0), '删除当前行');
  assert.equal(await rows.count(), 3);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelectorAll('.md-table tr').length === 4);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(() => document.querySelectorAll('.md-table tr').length === 3);
  await cell(0, 0).click({ button: 'right' });
  assert.equal(await page.getByRole('menuitem', { name: '删除当前行' }).isDisabled(), true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+s');
  await page.locator('#dirty-dot').waitFor({ state: 'hidden' });
  const written = await fs.readFile(file, 'utf8');
  assert.match(written, /## \*\*选择文字\*\*/);
  assert.match(written, /\| :--- \| --- \| ---: \|/);
  assert.match(written, /\| 梨 汁\\\|饮品 \| \*新增\* \| 25 \|/);
  assert.match(written, /\| \*\*苹果\*\* \|  \| 12 \|/);
  await page.locator('#source-mode').click();
  assert.match(await content.innerText(), /~~~js/);
  await page.locator('#live-mode').click();
  await cell(2, 0).click();
  assert.equal(await cell(2, 0).innerText(), '梨 汁|饮品');
  await page.keyboard.press('Control+o');
  await cell(2, 1).getByText('新增', { exact: true }).waitFor();
  await choose(page, plain, '插入表格');
  await page.waitForFunction(() => document.querySelectorAll('.md-table').length === 2);
  assert.doesNotMatch(await content.innerText(), /---:|\*\*|~~~js/);
  assert.equal(await page.locator('.line-h2 .cm-strong').innerText(), '选择文字');
  console.log('即时排版与右键验证通过：选区格式、直接输入、四向插入、删除、撤销重做、转义、对齐与保存回读。');
}

module.exports = { verifyRichEditing };
