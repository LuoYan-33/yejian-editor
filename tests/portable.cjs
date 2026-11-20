const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');

/** 等单文件程序完成解包并创建真实窗口，再接入临时配置的调试端口。 */
async function connect(profile, child) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('便携程序提前退出：' + child.exitCode);
    try {
      const port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0];
      return await chromium.connectOverCDP('http://127.0.0.1:' + Number(port), { timeout: 1500 });
    } catch { await delay(200); }
  }
  throw new Error('未等到免安装版窗口。');
}

/** 直接运行交付的便携 EXE，验证带中文路径的文件参数和真实写盘。 */
async function verifyPortable() {
  const exe = path.resolve(process.argv[2]);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'yejian-portable-'));
  const file = path.join(temporary, '便携验证.md');
  const profile = path.join(temporary, 'profile');
  const content = '# 便携验证\n\n- [ ] 完成测试\n\n![应用图标](图.png)\n\n| 地区 | 数值 |\n| --- | --- |\n| 上海 | 1 |\n';
  await fs.writeFile(file, content);
  await fs.writeFile(path.join(temporary, '图.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmFYAAAAASUVORK5CYII=', 'base64'));
  const child = spawn(exe, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, file],
    { windowsHide: true, stdio: 'ignore' });
  const closed = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  let page;
  try {
    const browser = await connect(profile, child);
    const context = browser.contexts()[0];
    page = context.pages()[0] || await context.waitForEvent('page');
    await page.waitForFunction(() => document.querySelector('#filename')?.textContent === '便携验证.md');
    await page.waitForFunction(() => document.querySelector('.md-image')?.naturalWidth === 1);
    await page.locator('.cm-task').check();
    await page.locator('.line-h1').click();
    assert.equal(await page.locator('.line-h1').innerText(), '便携验证');
    await page.locator('.md-table td').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: '在下方插入行' }).click();
    await page.keyboard.insertText('广州');
    await page.keyboard.press('Tab');
    await page.keyboard.insertText('2');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => document.querySelector('#status-text').textContent === '已保存');
    assert.equal(await fs.readFile(file, 'utf8'), content.replace('[ ]', '[x]') + '| 广州 | 2 |\n');
    await page.locator('.line-h1').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '有序列表', exact: true }).click();
    await page.keyboard.insertText('准备');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('交付');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('完成');
    await page.keyboard.press('Control+s');
    await page.locator('#dirty-dot').waitFor({ state: 'hidden' });
    assert.match(await fs.readFile(file, 'utf8'), /1\. 准备\n2\. 交付\n\n完成/);
    console.log('免安装 EXE 通过：文档打开、图片、表格编辑、右键插入列表、自动编号、空项退出及保存。');
  } finally {
    if (page) await page.evaluate(() => window.desk.close()).catch(() => {});
    const deadline = Date.now() + 20000;
    while (child.exitCode === null && Date.now() < deadline) await delay(150);
    if (child.exitCode === null) throw new Error('便携程序未正常退出。');
    assert.equal(await closed, 0);
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

verifyPortable().catch(error => { console.error(error); process.exitCode = 1; });
