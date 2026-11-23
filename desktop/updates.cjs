/** 管理安装版的更新状态，只有用户明确选择重启才会调用安装程序。 */
function createUpdates(updater, currentVersion, notify) {
  let phase = 'idle', version = currentVersion, visible = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.disableWebInstaller = true;

  /** 只向窗口发送显示所需的版本、进度和操作状态。 */
  function show(next, percent = 0) {
    phase = next;
    if (visible) notify({ phase, version, percent });
  }

  /** 启动检查保持安静，手动检查时也可以查看正在进行的下载。 */
  async function check(manual = true) {
    visible ||= manual;
    if (['checking', 'available', 'downloading', 'ready', 'installing'].includes(phase)) {
      if (phase !== 'downloading') show(phase);
      return;
    }
    show('checking');
    try {
      const result = await updater.checkForUpdates();
      if (!result) throw new Error('无法检查版本');
      if (result.isUpdateAvailable) {
        version = result.updateInfo.version;
        visible = true;
        show('available');
      } else {
        version = currentVersion;
        show('current');
      }
    } catch { show('failed'); }
  }

  /** 下载完成后保留在待安装状态，用户可以继续写作。 */
  async function download() {
    if (phase !== 'available') return;
    show('downloading');
    try {
      await updater.downloadUpdate();
      show('ready');
    } catch { show('failed'); }
  }

  /** 窗口已完成文档保护后静默安装并重新打开程序。 */
  function install() {
    if (phase !== 'ready') return false;
    show('installing');
    try { updater.quitAndInstall(true, true); }
    catch { show('failed'); }
    return phase === 'installing';
  }

  updater.on('download-progress', progress => {
    if (phase === 'downloading') show(phase, Math.round(progress.percent));
  });
  // 检查与下载中的错误由对应 Promise 处理，安装错误由事件报告。
  updater.on('error', () => { if (phase === 'installing') show('failed'); });
  return { check, download, install, get installing() { return phase === 'installing'; } };
}

module.exports = { createUpdates };
