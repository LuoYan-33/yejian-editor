const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../desktop/updates.cjs');

/** 使用可控的更新端点记录用户能看到的状态。 */
function fixture() {
  const updater = new EventEmitter();
  const states = [];
  updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '1.4.0' } });
  const updates = createUpdates(updater, '1.3.0', state => states.push(state));
  return { updater, updates, states };
}

test('启动时无更新保持安静，手动检查显示当前版本', async () => {
  const { updater, updates, states } = fixture();
  updater.checkForUpdates = async () => ({ isUpdateAvailable: false });
  await updates.check(false);
  assert.deepEqual(states, []);
  await updates.check();
  assert.equal(states.at(-1).phase, 'current');
  assert.equal(states.at(-1).version, '1.3.0');
});

test('合并重复检查与下载，只有就绪后才能显式启动安装', async () => {
  const { updater, updates, states } = fixture();
  const checking = Promise.withResolvers(), downloading = Promise.withResolvers();
  let checks = 0, downloads = 0, installs = 0;
  updater.checkForUpdates = () => { checks++; return checking.promise; };
  updater.downloadUpdate = () => { downloads++; return downloading.promise; };
  updater.quitAndInstall = (...args) => { installs++; assert.deepEqual(args, [true, true]); };
  const first = updates.check(false);
  await updates.check();
  assert.equal(checks, 1);
  checking.resolve({ isUpdateAvailable: true, updateInfo: { version: '1.4.0' } });
  await first;
  assert.equal(states.at(-1).phase, 'available');
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.autoDownload, false);
  const transfer = updates.download();
  await updates.download();
  assert.equal(downloads, 1);
  updater.emit('download-progress', { percent: 42.3 });
  assert.equal(states.at(-1).percent, 42);
  assert.equal(updates.install(), false);
  downloading.resolve();
  await transfer;
  assert.equal(states.at(-1).phase, 'ready');
  assert.equal(installs, 0);
  assert.equal(updates.install(), true);
  assert.equal(updates.install(), false);
  assert.equal(installs, 1);
});

test('检查、下载、安装失败可重新检查和下载', async () => {
  const { updater, updates, states } = fixture();
  const check = updater.checkForUpdates;
  updater.checkForUpdates = async () => { throw new Error('网络断开'); };
  await updates.check(false);
  assert.deepEqual(states, []);
  updater.checkForUpdates = check;
  updater.downloadUpdate = async () => { throw new Error('校验失败'); };
  await updates.check();
  await updates.download();
  assert.equal(states.at(-1).phase, 'failed');
  updater.downloadUpdate = async () => {};
  updater.quitAndInstall = () => updater.emit('error', new Error('安装失败'));
  await updates.check();
  await updates.download();
  assert.equal(updates.install(), false);
  assert.equal(updates.installing, false);
  assert.equal(states.at(-1).phase, 'failed');
});
