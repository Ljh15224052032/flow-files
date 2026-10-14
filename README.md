# Flow Files

Flow Files 是一款面向 Windows 的轻量文件管理器，使用 Tauri 2、React、TypeScript 和 Rust 开发。项目最初用于比较 Tauri 与 Avalonia 的内存和开发成本，现在的主线已经转为可日常使用的 Tauri 应用。

> 当前版本：`0.1.0`。项目仍处于早期开发阶段，暂不建议完全替代 Windows 资源管理器。

## 当前能力

- 多标签目录浏览、标签拖动排序、前进/后退、地址栏和路径面包屑。
- 详细信息、紧凑列表和大图标视图，支持排序、列宽调整和虚拟滚动。
- 图片缩略图和高清预览；文本、代码、音频、视频以及常见文件元数据预览。
- 收藏夹分组、折叠、文件夹树、最近位置和会话恢复。
- 当前目录筛选、递归搜索、搜索历史、常用筛选，以及可选的 Everything 索引搜索。
- 新建、重命名、复制、剪切、粘贴、拖放、回收站、永久删除、压缩和解压。
- Windows 文件剪贴板互通、目录变化自动刷新、冲突处理、暂停、取消、进度和失败项重试。
- 有界的撤销记录和最近任务历史，支持按状态筛选和手动调整等待任务的优先级；失败项目可整批或单独重试，重启时中断的任务会等待用户确认后重新扫描并继续。
- 磁盘空间体检、有界历史趋势与分类增长对比、安全清理预览、重复文件扫描和清理前复核。
- Windows Terminal 与 Claude Code 启动；DeepSeek 密钥存放在 Windows 凭据管理器。
- 文件夹右键菜单和目录打开集成。项目不会宣称能够可靠劫持所有第三方软件对资源管理器的调用。
- 中文和英文界面，以及接近 Codex 的中性深色视觉风格。
- 设置页可检查并确认安装 GitHub 正式发布通道中的更新；下载内容必须通过内置公钥验签。

更完整的状态划分见 [ROADMAP.md](ROADMAP.md)，每个版本的变化见 [CHANGELOG.md](CHANGELOG.md)。

准备发布时先运行 `tools/Test-ReleaseReadiness.ps1`，再按 [发布验收矩阵](docs/RELEASE_ACCEPTANCE.md) 完成安装、升级、验签更新与卸载测试。实际安装步骤必须由测试者明确确认后执行。

## 目录结构

```text
file-manager-tech-lab/
├─ tauri-prototype/app/     # Flow Files 主应用
│  └─ src/                  # 页面编排、组件、领域工具、类型与测试
├─ avalonia-prototype/      # 早期 Avalonia 技术对照原型
├─ tools/                   # 内存测量脚本
├─ RESULTS.md               # Tauri / Avalonia 初期测量记录
├─ CHANGELOG.md             # 版本变更记录
└─ ROADMAP.md               # 已完成、待增强和未实现功能
```

## 开发环境

- Windows 10 或 Windows 11
- Microsoft Edge WebView2 Runtime
- Node.js 20 或更高版本
- Rust stable（`x86_64-pc-windows-msvc`）
- Visual Studio Build Tools，包含 MSVC 与 Windows SDK

## 本地开发

```powershell
cd D:\Code-Rebuild\3-learning-labs\file-manager-tech-lab\tauri-prototype\app
npm install
npm run tauri dev
```

前端检查：

```powershell
npm test
npm run build
```

Rust 测试：

```powershell
cd src-tauri
cargo test
```

生成不带安装器的正式 EXE：

```powershell
npm run build:app
```

生成 NSIS 安装包：

```powershell
npm run build:installer
```

推送与四处构建清单一致的 `vMAJOR.MINOR.PATCH` 标签后，GitHub Actions 会运行前后端测试、生成 Windows NSIS 安装包，并创建一个待人工验收的草稿 Release。草稿不会自动公开；应先验证全新安装、覆盖升级、保留设置和卸载，再发布。

## 数据与安全

- 文件删除默认进入 Windows 回收站；永久删除必须经过确认。
- 磁盘清理先扫描和预览，再由用户选择并确认，不会静默删除。
- 自动化测试只操作临时目录。
- WebView 启用 CSP、原型冻结和禁止 MIME 嗅探；本地媒体协议明确拒绝读取常见凭据目录。
- Claude/DeepSeek API 密钥不会写入源码或浏览器存储，而是交给 Windows 凭据管理器保存。
- 会话、收藏夹、搜索历史和界面设置保存在应用本地存储中。

## 版本管理

项目采用语义化版本号：

- `0.1.x`：早期可用版本，以修复和小幅完善为主。
- `0.x.0`：新增一批完整能力或发生较大交互变化。
- `1.0.0`：安装、升级、数据迁移和核心文件操作达到稳定标准。

发布版本使用 `vMAJOR.MINOR.PATCH` Git 标签。版本发布前需要同步修改：

- `tauri-prototype/app/package.json`
- `tauri-prototype/app/src-tauri/Cargo.toml`
- `tauri-prototype/app/src-tauri/tauri.conf.json`
- `CHANGELOG.md`

可以运行 `tools/Check-Version.ps1` 检查各构建清单中的版本是否一致；GitHub CI 也会执行同一检查。

发布标签还会与清单版本进行强校验，例如 `v0.2.0` 只能发布清单版本 `0.2.0`。发布流水线使用 GitHub Secrets 中的专用私钥签名更新包，应用只内置可公开的验证公钥；验签失败的更新不会安装。

维护者本机的加密签名私钥位于 `%USERPROFILE%\.tauri\flow-files.key`，密码备份位于同目录的 `flow-files-signing-password.dpapi`，只能由当前 Windows 用户解密。这两个文件都不属于仓库；正式使用应用内更新后，丢失私钥将无法继续向既有安装推送更新，应另做安全的离线备份。

## 技术对照记录

Avalonia 原型与内存测量脚本仍保留，便于复核早期选型。对比结果见 [RESULTS.md](RESULTS.md)。测量 Tauri 时需要合并宿主进程与 WebView2 子进程，不能只查看单一进程。
