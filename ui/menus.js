/** 使用同一份菜单命令，为自定义背景提供随窗口配色的菜单。 */
export function installMenus(desk, menus, enqueue) {
  const panel = document.getElementById('app-menu');
  let trigger, priorFocus;

  /** 生成当前菜单，将剪贴板操作保留给原生窗口。 */
  function open(button, keyboard) {
    const visible = panel.matches(':popover-open');
    if (visible) panel.hidePopover();
    if (visible && trigger === button) return;
    trigger = button;
    priorFocus = document.activeElement;
    panel.replaceChildren(...menus[button.dataset.menu].map(item => {
      if (!item) {
        const separator = document.createElement('hr');
        separator.setAttribute('role', 'separator');
        return separator;
      }
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.dataset.command = item.id;
      entry.tabIndex = -1;
      entry.setAttribute('role', 'menuitem');
      entry.textContent = item.label;
      if (item.accelerator) {
        const hint = document.createElement('kbd');
        hint.textContent = item.accelerator;
        entry.append(hint);
      }
      return entry;
    }));
    const rect = button.getBoundingClientRect();
    panel.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
    panel.style.top = rect.bottom + 2 + 'px';
    panel.showPopover({ source: button });
    button.setAttribute('aria-expanded', 'true');
    if (keyboard) panel.querySelector('button').focus();
  }

  for (const button of document.querySelectorAll('[data-menu]')) {
    button.setAttribute('aria-haspopup', 'menu');
    button.onmousedown = event => event.preventDefault();
    button.onclick = event => {
      if (document.documentElement.hasAttribute('data-custom-background')) return open(button, event.detail === 0);
      const rect = button.getBoundingClientRect();
      desk.menu(button.dataset.menu, { x: rect.left, y: rect.bottom + 2 });
    };
  }

  panel.onbeforetoggle = event => {
    if (event.newState === 'closed') trigger?.removeAttribute('aria-expanded');
  };
  panel.onmousedown = event => event.preventDefault();
  panel.onclick = event => {
    const command = event.target.closest('[data-command]')?.dataset.command;
    if (!command) return;
    panel.hidePopover();
    priorFocus?.focus({ preventScroll: true });
    if (['cut', 'copy', 'paste', 'selectAll'].includes(command)) desk.edit(command);
    else enqueue(command);
  };
  panel.onkeydown = event => {
    const entries = [...panel.querySelectorAll('button')];
    const index = entries.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    entries[(index + step + entries.length) % entries.length].focus();
  };
}
