const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

/** 从已安装的应用打开 Finder 文档，验证实际菜单、快捷键、编辑和保存保护。 */
async function verifyMac() {
  const bundle = path.resolve(process.argv[2]);
  const executable = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'yejian-mac-'));
  const file = path.join(temporary, '苹果笔记.md');
  await fs.writeFile(file, '# 我的笔记\n\n- [ ] 写作\n');
  const desktop = await electron.launch({ executablePath: path.join(bundle, 'Contents/MacOS', executable),
    args: ['--user-data-dir=' + path.join(temporary, 'profile')], timeout: 60000 });
  try {
    const page = await desktop.firstWindow();
    await page.locator('.line-h1').waitFor();
    assert.deepEqual(await desktop.evaluate(({ app, Menu }) => [
      app.getVersion(), process.arch, Menu.getApplicationMenu().getMenuItemById('help').submenu.items[0].label
    ]), [process.env.PREVIEW_VERSION, process.arch, '下载 Mac 体验版…']);
    // 通过 Launch Services 将文档交给正在运行的应用，覆盖 Finder 的打开方式。
    execFileSync('open', ['-a', bundle, file]);
    await page.waitForFunction(() => document.querySelector('#filename').textContent === '苹果笔记.md');
    await page.locator('.cm-task').check();
    await page.keyboard.press('Meta+s');
    await page.locator('#dirty-dot').waitFor({ state: 'hidden' });
    assert.equal(await fs.readFile(file, 'utf8'), '# 我的笔记\n\n- [x] 写作\n');
    await page.locator('.line-h1').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '插入表格', exact: true }).click();
    await page.locator('.md-table').waitFor();
    await desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }); });
    await page.keyboard.press('Meta+n');
    await page.locator('.md-table').waitFor();
    assert.equal(await page.locator('#filename').textContent(), '苹果笔记.md');
    await page.keyboard.press('Meta+s');
    await page.locator('#dirty-dot').waitFor({ state: 'hidden' });
    assert.match(await fs.readFile(file, 'utf8'), /\|.*---/);
    await page.keyboard.press('Meta+n');
    await page.locator('.cm-placeholder').waitFor();
    console.log('磁盘映像内的应用通过 Finder 打开、⌘N、⌘S、右键插表和未保存保护验证', process.arch);
  } finally {
    await desktop.evaluate(({ app }) => app.exit()).catch(() => {});
    await desktop.close().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

verifyMac().catch(error => { console.error(error); process.exitCode = 1; });
