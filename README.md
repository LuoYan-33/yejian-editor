# 页间 Markdown 编辑器

页间是一款 Windows 64 位桌面编辑器。可以直接在排好的正文里写作，也可以切换到 Markdown 源码编辑。

## 下载

| 版本 | 使用方式 |
| --- | --- |
| [Windows 安装版](https://github.com/LuoYan-33/yejian-editor/releases/download/v1.2.0/Yejian-Setup-1.2.0-x64.exe) | 双击 EXE，按向导安装。 |
| [Windows 免安装版](https://github.com/LuoYan-33/yejian-editor/releases/download/v1.2.0/Yejian-Portable-1.2.0-x64.exe) | 下载后直接双击运行。 |

## 写作

- 在正文中右键，可以调整标题和文字格式，或插入图片、列表和表格。
- 列表中按 Enter 续写，在空项按 Enter 返回正文。表格中按 Tab 移到下一格，右键可以增删行列。
- 右键插入图片或按 Ctrl + V 粘贴截图，图片会嵌入文档，分享时只需发送一个 Markdown 文件。
- 使用左侧大纲跳转章节，按 Ctrl + F 查找，按 F8 切换专注模式。

## 从源码运行

项目使用 Electron 和 CodeMirror，在 Windows x64、Node.js 24 下构建验证。安装依赖后即可启动编辑器。

```sh
npm ci
npm start
```

运行 `npm test` 验证文件读写，运行 `npm run test:desktop` 验证桌面编辑流程。运行 `npm run dist` 在 `release/` 生成安装版与免安装版 EXE。
