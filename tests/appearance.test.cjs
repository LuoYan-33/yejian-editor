const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadAppearance } = require('../desktop/appearance.cjs');
const { backgroundScheme } = require('../desktop/appearance-colors.cjs');

test('外观设置按顺序保存，重新读取可恢复主题和整窗背景', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yejian-appearance-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'appearance.json');
  const settings = await loadAppearance(file);
  assert.deepEqual(settings.current(), { theme: 'light', background: null });

  const first = settings.save({ theme: 'dark', background: null });
  const latest = settings.save({ theme: 'system', background: '#243E4A' });
  await settings.flush();
  assert.deepEqual(await first, { theme: 'dark', background: null });
  assert.deepEqual(await latest, { theme: 'system', background: '#243e4a' });
  const reopened = await loadAppearance(file);
  assert.deepEqual(reopened.current(), { theme: 'system', background: '#243e4a' });

  await reopened.save({ ...reopened.current(), background: null });
  assert.deepEqual((await loadAppearance(file)).current(), { theme: 'system', background: null });
});

test('配置只接受支持的主题和六位颜色，前景明暗随背景亮度变化', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yejian-appearance-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'appearance.json');
  await fs.writeFile(file, JSON.stringify({ theme: 'unknown', background: '#abcd' }));
  const settings = await loadAppearance(file);
  assert.deepEqual(settings.current(), { theme: 'light', background: null });
  assert.equal(backgroundScheme('#f6dfb4'), 'light');
  assert.equal(backgroundScheme('#191e24'), 'dark');
});
