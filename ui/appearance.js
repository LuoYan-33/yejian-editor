import { backgroundScheme } from '../desktop/appearance-colors.cjs';

/** 让左上角设置面板同步主题、窗口背景和已保存的外观偏好。 */
export function installAppearance(desk, initial) {
  const root = document.documentElement;
  const theme = document.getElementById('theme-choice');
  const background = document.getElementById('background-choice');
  const backgroundValue = document.getElementById('background-value');
  const reset = document.getElementById('reset-background');
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  let requested = initial, saved = initial;

  /** 根据当前选择刷新窗口和设置控件。 */
  function render() {
    const { theme: choice, background: custom } = requested;
    const dark = choice === 'dark' || (choice === 'system' && systemTheme.matches);
    root.style.colorScheme = custom ? backgroundScheme(custom) : choice === 'system' ? 'light dark' : choice;
    root.style.setProperty('--custom-background', custom);
    root.toggleAttribute('data-custom-background', custom !== null);
    theme.value = choice;
    background.value = custom ?? (dark ? '#232320' : '#fcfbf8');
    backgroundValue.textContent = background.value.toUpperCase();
    reset.disabled = custom === null;
  }

  /** 即时预览修改，保存失败时回到最近一次成功保存的设置。 */
  async function change(patch) {
    const next = { ...requested, ...patch };
    requested = next;
    render();
    try { saved = await desk.saveAppearance(next); }
    catch {
      if (requested === next) {
        requested = saved;
        render();
      }
      await desk.error('无法保存外观设置，请重试。');
    }
  }

  theme.onchange = () => change({ theme: theme.value });
  background.onchange = () => change({ background: background.value });
  reset.onclick = () => change({ background: null });
  systemTheme.addEventListener('change', render);
  render();
  document.querySelector('.brand-mark').disabled = false;
}
