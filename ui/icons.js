const shapes = {
  book: '<path d="M4 5.5c3.3-.9 5.9-.3 8 1.4v13c-2.1-1.7-4.7-2.3-8-1.4zM12 6.9c2.2-1.7 4.8-2.3 8-1.4v13c-3.2-.9-5.8-.3-8 1.4"/><path d="M7 9.5l2 .4m6-.4 2-.4"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  outline: '<path d="M9 6h11M9 12h8M9 18h11M4 6h.1M4 12h.1M4 18h.1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  new: '<path d="M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9zM13 3v6h6M9 14h6m-3-3v6"/>',
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9v3M3 9h18l-3 10H5z"/>',
  file: '<path d="M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9zM13 3v6h6M8.5 13h7m-7 3h5"/>',
  pen: '<path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L5 15z"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>',
  save: '<path d="M4 3.5h13l3 3V20H4zM8 4v6h8V4M8 20v-7h8v7"/>',
  focus: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>'
};

/** 安装纯装饰图标，按钮的可访问名称由标签提供。 */
export function installIcons() {
  for (const element of document.querySelectorAll('[data-icon]')) {
    element.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + shapes[element.dataset.icon] + '</svg>';
  }
}
