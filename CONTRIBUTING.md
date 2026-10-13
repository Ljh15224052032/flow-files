# Contributing

## 开发原则

- 不把“已有功能的增强”描述成全新的未实现功能。
- 文件操作必须优先可恢复，并为永久删除等破坏性操作提供明确确认。
- 不在源码、提交、日志或测试夹具中保存 API 密钥和个人路径数据。
- UI 修改需要同时检查正常窗口和最小窗口尺寸。
- 修改现有行为时同步更新 `CHANGELOG.md` 和 `ROADMAP.md`。

## 提交约定

提交信息采用简洁的 Conventional Commits 前缀：

- `feat:` 新功能
- `fix:` 缺陷修复
- `refactor:` 不改变行为的结构调整
- `docs:` 文档
- `test:` 测试
- `build:` 构建与依赖
- `chore:` 维护性工作

每个提交只解决一个主题。不要提交构建产物、密钥、个人设置或临时测量文件。

## 提交前检查

```powershell
cd tauri-prototype\app
npm run build
cd src-tauri
cargo test
```

涉及发布时，还要确认 `package.json`、`Cargo.toml`、`tauri.conf.json` 与 `CHANGELOG.md` 中的版本一致。
