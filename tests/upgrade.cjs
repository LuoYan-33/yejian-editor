const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright-core');
const yaml = require('js-yaml');
const { version } = require('../package.json');

/** 仅向本机测试窗口提供待发布的真实安装文件和更新清单。 */
function serveRelease(request, response) {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1);
  const setup = 'Yejian-Setup-' + version + '-x64.exe';
  if (!['latest.yml', setup, setup + '.blockmap'].includes(name)) {
    response.writeHead(404).end();
    return;
  }
  const file = path.resolve('release', name);
  response.writeHead(200, { 'Content-Length': fs.statSync(file).size });
  fs.createReadStream(file).pipe(response);
}

/** 在专用 Windows 运行器确认新程序已从同一安装目录重新打开。 */
async function verifyRestart(executable) {
  const script = "Get-Process -Name Yejian -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:YEJIAN_TEST_EXE -and $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.MainModule.FileVersionInfo.FileVersion }";
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const versions = execFileSync('powershell.exe', ['-NoProfile', '-Command', script + '; exit 0'], {
      encoding: 'utf8', env: { ...process.env, YEJIAN_TEST_EXE: executable }
    });
    if (versions.trim().split(/\r?\n/).includes(version)) return;
    await delay(1000);
  }
  throw new Error('未检测到正式版本重新打开窗口');
}

/** 在一次性运行器内，从较低测试版本经过真实更新器升级到待发布版本。 */
async function verifyUpgrade() {
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', '真实安装测试需要一次性 GitHub 运行器');
  const temporary = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'yejian-'));
  const directory = path.join(temporary, 'installed');
  const executable = path.join(directory, 'Yejian.exe');
  const base = version + '-qa.0';
  const setup = path.resolve('.cache/upgrade-test', 'Yejian-Setup-' + base + '-x64.exe');
  execFileSync(setup, ['/S', '/D=' + directory], { timeout: 120000 });
  const server = http.createServer(serveRelease);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const feed = { provider: 'generic', url: 'http://127.0.0.1:' + server.address().port, updaterCacheDirName: 'yejian-upgrade-test' };
  fs.writeFileSync(path.join(directory, 'resources/app-update.yml'), yaml.dump(feed));
  const document = path.join(temporary, '升级验证.md');
  fs.writeFileSync(document, '原文');
  let desktop;
  try {
    desktop = await electron.launch({ executablePath: executable, args: [document], timeout: 60000 });
    assert.equal(await desktop.evaluate(({ app }) => app.getVersion()), base);
    const page = await desktop.firstWindow();
    await page.getByText('升级验证.md', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: '下载更新' }).click();
    const restart = page.getByRole('button', { name: '重启安装' });
    await restart.waitFor({ timeout: 120000 });
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('：已保存');
    await desktop.evaluate(({ dialog }) => {
      // 第一次取消重启，第二次确认保存。
      const choices = [2, 0];
      dialog.showMessageBox = async () => ({ response: choices.shift() });
    });
    await restart.click();
    await page.waitForFunction(() => !document.querySelector('#editor').inert && !document.querySelector('#dirty-dot').hidden);
    assert.equal(fs.readFileSync(document, 'utf8'), '原文');
    const closed = desktop.waitForEvent('close', { timeout: 90000 });
    await restart.click();
    await closed;
    assert.equal(fs.readFileSync(document, 'utf8'), '原文：已保存');
    await verifyRestart(executable);
    assert.equal(yaml.load(fs.readFileSync(path.join(directory, 'resources/app-update.yml'), 'utf8')).provider, 'github');
    console.log('真实安装版完成下载、取消重启、保存文档、原地升级及重新打开', base, '→', version);
  } finally {
    server.close();
    await desktop?.close().catch(() => {});
  }
}

verifyUpgrade().catch(error => { console.error(error); process.exitCode = 1; });
