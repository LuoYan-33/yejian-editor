# 页间 Markdown 编辑器

页间是一款支持 Windows 和 macOS 的桌面编辑器。可以直接在排好的正文里写作，也可以切换到 Markdown 源码编辑。

## 下载

**Windows** 用户打开[最新正式版下载页](https://github.com/LuoYan-33/yejian-editor/releases/latest)，在附件（Assets）里选择适合的 EXE。

| 文件名 | 使用方式 |
| --- | --- |
| `Yejian-Setup-版本号-x64.exe` | 双击安装。1.3.0 起，启动时会检查更新，也可从「帮助 → 检查更新」手动检查。 |
| `Yejian-Portable-版本号-x64.exe` | 双击运行。在「帮助 → 下载新版免安装包」获取新文件，关闭旧版后替换。 |

使用 1.2.0 时，请先手动安装一次新版。之后发现更新时，点击底部状态栏的「下载更新」，下载期间可继续写作。点击「重启安装」后，若文档有修改，可选择保存、放弃或取消。确认后编辑器会安装并重新打开。

**Mac** 用户打开 [Mac 体验版下载页](https://github.com/LuoYan-33/yejian-editor/releases?q=mac)。苹果 M 系列芯片下载 `arm64.dmg`，Intel 处理器下载 `x64.dmg`。打开磁盘映像，将「页间」拖入「应用程序」，再从那里打开。体验版未使用 Apple Developer ID 签名或经苹果公证。首次打开若被拦截，确认来源后可到「系统设置 → 隐私与安全性」选择「仍要打开」。后续通过「帮助 → 下载 Mac 体验版」手动更新。

## 写作

- 在正文中右键，可以调整标题和文字格式，或插入图片、列表和表格。
- 列表中按 Enter 续写，在空项按 Enter 返回正文。表格中按 Tab 移到下一格，右键可以增删行列。
- 右键插入图片或按 Ctrl + V 粘贴截图，图片会嵌入文档，分享时只需发送一个 Markdown 文件。
- 使用左侧大纲跳转章节，按 Ctrl + F 查找，按 F8 切换专注模式。
- 在 Mac 上使用 ⌘ 组合键，例如 ⌘O 打开、⌘S 保存、⌘F 查找。

## 从源码运行

项目使用 Electron 和 CodeMirror，在 Windows x64、Node.js 24 下构建验证。安装依赖后即可启动编辑器。

```sh
npm ci
npm start
```

运行 `npm test` 验证文件读写和更新逻辑，运行 `npm run test:desktop` 验证桌面编辑流程。运行 `npm run dist` 在 `release/` 生成安装版、免安装版和更新清单。

## 发布新版本

1. 将准备发布的代码推送到 `main`。
2. 打开 [GitHub Actions 的「发布 Windows 版本」](https://github.com/LuoYan-33/yejian-editor/actions/workflows/release.yml)，点击 **Run workflow**，选择 `main` 并输入更高的正式版本号，例如 `1.3.1`。
3. 点击 **Run workflow** 确认。工作流会更新源码版本号、运行测试、构建 Windows 程序并创建标签。安装包和更新清单一起校验通过后，版本会出现在下载页，已安装的用户即可收到更新。

工作流使用 GitHub 提供的仓库令牌。若上传中断，可以用同一版本号重新运行以完成草稿发布。

发布 Mac 体验版时，打开[「发布 Mac 体验版」工作流](https://github.com/LuoYan-33/yejian-editor/actions/workflows/mac-preview.yml)，选择 `main`，输入当前项目版本的体验版序号。工作流在苹果芯片和 Intel 机器上分别打包、挂载并验证 DMG，再将两个安装包放入同一条预发布记录。
