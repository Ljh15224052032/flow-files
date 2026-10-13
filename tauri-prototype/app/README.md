# Flow Files application

Flow Files 的应用源码。面向最终用户的说明和完整开发文档位于仓库根目录的 [README](../../README.md)。

## 常用命令

```powershell
npm install             # 安装前端与 Tauri CLI 依赖
npm run tauri dev       # 启动开发版
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
