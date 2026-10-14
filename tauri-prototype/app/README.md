# Flow Files application

Flow Files 的应用源码。面向最终用户的说明和完整开发文档位于仓库根目录的 [README](../../README.md)。

## 常用命令

```powershell
npm install             # 安装前端与 Tauri CLI 依赖
npm run tauri dev       # 启动开发版
npm test                # 运行前端纯逻辑单元测试
npm run build           # TypeScript 检查和前端生产构建
npm run build:app       # 生成 release EXE，不生成安装包
npm run build:installer # 生成 NSIS 安装包
```

Rust 测试：

```powershell
cd src-tauri
cargo test
```

正式 EXE 输出到：

```text
src-tauri/target/release/flow-files.exe
```

不要提交 `node_modules`、`dist`、Rust `target`、本地环境变量、日志或安装包生成物。

`app/.cargo/config.toml` 是当前电脑使用的 Cargo 镜像配置，只保留在本机，不进入 Git；GitHub CI 使用官方 crates.io。

`src/App.tsx` 负责页面状态和功能编排；可独立验证的路径、排序、持久化和格式化逻辑位于 `src/lib`，预览与图标位于 `src/components`，中英文案位于 `src/localization.ts`。新增功能应优先放进对应领域模块，避免再次把所有实现堆回主文件。
