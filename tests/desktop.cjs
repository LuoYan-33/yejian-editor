const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { verifyRichEditing } = require('./rich-editing.cjs');
const { verifyQuickInsert } = require('./quick-insert.cjs');

/** 验证应用图标入口、深色主题、整窗背景和恢复默认。 */
async function verifyAppearance(page) {
  const entry = page.getByRole('button', { name: '外观设置' });
  const panel = page.getByRole('dialog', { name: '外观设置' });
  const theme = panel.getByLabel('主题');
  const background = panel.getByLabel('窗口背景色');
  const editor = page.locator('#editor');
  const titlebar = page.locator('.titlebar');
  const sidebar = page.locator('aside');
  const initialText = await editor.locator('.cm-content').innerText();

  await entry.click();
  await panel.waitFor();
  assert.equal(await entry.locator('img').evaluate(image => image.naturalWidth), 256);
  await theme.selectOption('dark');
  assert.equal(await titlebar.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(41, 40, 35)');
  assert.equal(await editor.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(35, 35, 32)');

  await background.fill('#f6dfb4');
  assert.equal(await editor.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(246, 223, 180)');
  assert.equal(await editor.evaluate(node => getComputedStyle(node).color), 'rgb(0, 0, 0)');
  assert.equal(await titlebar.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(246, 223, 180)');
  assert.equal(await sidebar.evaluate(node => getComputedStyle(node).backgroundColor), await page.locator('footer').evaluate(node => getComputedStyle(node).backgroundColor));
  const panelColor = await panel.evaluate(node => getComputedStyle(node).backgroundColor);
  await page.keyboard.press('Escape');
  if (await page.locator('[data-menu="view"]').isVisible()) {
    await page.locator('[data-menu="view"]').click();
    const menu = page.getByRole('menu', { name: '应用菜单' });
    await menu.waitFor();
    assert.equal(await menu.evaluate(node => getComputedStyle(node).backgroundColor), panelColor);
    await menu.getByRole('menuitem', { name: /侧栏/ }).click();
    await sidebar.waitFor({ state: 'hidden' });
    await page.locator('#expand').click();
    await sidebar.waitFor();
  }
  await entry.click();
  await theme.selectOption('light');
  assert.equal(await background.inputValue(), '#f6dfb4');
  await background.fill('#191e24');
  assert.equal(await editor.evaluate(node => getComputedStyle(node).color), 'rgb(255, 255, 255)');
  await panel.getByRole('button', { name: '使用主题默认背景' }).click();
  assert.equal(await background.inputValue(), '#fcfbf8');
  assert.equal(await editor.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(252, 251, 248)');
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await editor.locator('.cm-content').innerText(), initialText);
  assert.equal(await page.locator('#dirty-dot').isVisible(), false);
}

/** 打开真实桌面窗口，用临时文件代替人工在系统文件选择框中挑选文件。 */
async function verify() {
  const root = path.resolve(__dirname, '..');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'yejian-desktop-'));
  const isPackaged = Boolean(process.argv[2]);
  const executablePath = isPackaged ? path.resolve(process.argv[2]) : require('electron');
  const args = ['--user-data-dir=' + path.join(temporary, 'profile'), ...(isPackaged ? [] : [root])];
  const app = await electron.launch({ executablePath, args, timeout: 50000 });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.line-h1').waitFor();
    assert.equal(await page.locator('.nav-item').count(), 5);
    await verifyAppearance(page);
    await fs.mkdir(path.join(root, '.cache'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.cache', 'welcome.png') });
    const file = path.join(temporary, '集成验证.md'), copy = path.join(temporary, '另存.md');
    const input = '# 中文标题\n\n正文 **加粗** 与 *斜体*。\n\n- [ ] 任务\n\n| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |\n\n~~~js\n# 不是标题\n~~~\n';
    const original = '\uFEFF' + input.replace(/\n/g, '\r\n');
    await fs.writeFile(file, original);
    await app.evaluate(({ dialog }, { file, copy }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: copy });
      dialog.showMessageBox = async (_parent, options) => {
        if (options.type === 'error') throw new Error(options.detail);
        return { response: options.cancelId ?? 0 };
      };
    }, { file, copy });
    await page.keyboard.press('Control+o');
    await page.waitForFunction(() => document.querySelector('#filename').textContent === '集成验证.md');
    assert.equal(await page.locator('.nav-item').count(), 1);
    await page.locator('.md-table td').first().waitFor();
    const checkbox = page.locator('.cm-task');
    await checkbox.check();
    await page.locator('#dirty-dot:visible').waitFor();
    await page.keyboard.press('Control+s');
    await page.locator('#dirty-dot').waitFor({ state: 'hidden' });
    assert.equal(await fs.readFile(file, 'utf8'), original.replace('[ ]', '[x]'));
    await page.locator('#source-mode').click();
    assert.equal(await page.locator('.md-table').count(), 0);
    assert.match(await page.locator('.cm-content').innerText(), /\*\*加粗\*\*/);
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('新增中文');
    await page.keyboard.press('Control+Shift+s');
    await page.waitForFunction(() => document.querySelector('#filename').textContent === '另存.md');
    assert.equal(await fs.readFile(copy, 'utf8'), original.replace('[ ]', '[x]') + '新增中文');
    await page.keyboard.insertText('取消后保留');
    await page.keyboard.press('Control+n');
    await page.waitForFunction(() => !document.querySelector('#editor').inert);
    assert.match(await page.locator('.cm-content').innerText(), /取消后保留/);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    await page.keyboard.press('Control+n');
    await page.waitForFunction(() => document.querySelector('#filename').textContent === '未命名.md');
    await page.keyboard.press('Control+z');
    await page.locator('.cm-placeholder').waitFor();
    assert.doesNotMatch(await page.locator('.cm-content').innerText(), /新增中文|取消后保留/);
    await page.locator('#live-mode').click();
    await page.keyboard.insertText('# 新文章');
    await page.getByRole('button', { name: '新文章' }).waitFor();
    await page.keyboard.press('F8');
    await page.locator('body.focus-mode').waitFor();
    await page.keyboard.press('F8');
    await page.locator('.docbar').waitFor();
    await page.keyboard.press('Control+f');
    await page.locator('.cm-search').waitFor();
    await verifyRichEditing(page, file);
    await verifyQuickInsert(app, page, temporary);
    assert.deepEqual(errors, []);
    console.log('真实窗口通过：外观设置、大纲、表格、待办、打开、保存、另存为、源码、取消放弃、撤销隔离、专注和查找。');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
