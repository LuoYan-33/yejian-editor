const fs = require('node:fs/promises');
const { writeAtomically } = require('./files.cjs');

/** 只接受已知的主题与可直接用于取色控件的十六进制颜色。 */
function normalizeAppearance(settings) {
  const { theme, background } = settings ?? {};
  return {
    theme: ['light', 'dark', 'system'].includes(theme) ? theme : 'light',
    background: typeof background === 'string' && /^#[\da-f]{6}$/i.test(background) ? background.toLowerCase() : null
  };
}

/** 载入外观偏好，并将连续的设置写入按操作顺序提交。 */
async function loadAppearance(filePath) {
  let settings = normalizeAppearance();
  try { settings = normalizeAppearance(JSON.parse(await fs.readFile(filePath, 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') console.warn('未能读取外观设置', error.message);
  }
  let writes = Promise.resolve();
  return {
    /** 返回最近一次成功写入的设置。 */
    current: () => settings,
    /** 关闭窗口前等当前写入完成。 */
    flush: () => writes,
    /** 成功写入后更新设置，写入失败可由后续操作恢复。 */
    save(next) {
      const requested = normalizeAppearance(next);
      const pending = writes.then(async () => {
        await writeAtomically(filePath, JSON.stringify(requested));
        settings = requested;
        return settings;
      });
      writes = pending.catch(() => {});
      return pending;
    }
  };
}

module.exports = { loadAppearance };
