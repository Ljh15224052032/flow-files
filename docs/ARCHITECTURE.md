# Flow Files 架构与维护边界

本文档面向后续维护者和 AI 开发任务。目标不是描述每一行代码，而是规定功能应放在哪里，避免继续扩大 `App.tsx` 或重复实现已有能力。

## 1. 应用结构

- `tauri-prototype/app/src/App.tsx`
  - 应用级状态协调、Tauri 命令调用、目录导航和跨模块工作流。
  - 可以组合组件，但不应继续承载大块对话框 JSX 或可独立测试的判断规则。
- `tauri-prototype/app/src/components/`
  - 只负责界面展示和明确的用户事件回调。
  - 当前已拆分预览、任务中心、操作确认、状态栏、设置、搜索筛选，以及完整的磁盘体检对话框。
  - `SpaceHealthDialog.tsx` 负责空间体检、重复文件复核和安全清理预览的展示与派生视图；扫描、剪贴板和文件变更仍由 `App.tsx` 编排。
- `tauri-prototype/app/src/lib/`
  - 不依赖 React 的纯函数、格式化、持久化解析与安全策略。
  - 新增排序、筛选、恢复、报告和分类规则时，优先在这里实现并添加同名 `.test.ts`。
- `tauri-prototype/app/src/hooks/`
  - 可复用的异步生命周期与外部服务状态，例如应用更新器和 Windows 文件拖放桥接。
- `tauri-prototype/app/src-tauri/src/`
  - Windows 文件系统、Shell、凭据管理、预览解码和长任务执行。
  - `path_policy.rs` 负责 Windows 路径安全；`error_policy.rs` 负责错误分类；`text_encoding.rs` 负责文本解码；`transfer_rate.rs` 负责复制限速计算。

## 2. 已有能力的唯一入口

开发前先检查以下入口，不要创建第二套并行实现：

| 能力 | 入口 |
| --- | --- |
| 文件名、路径、类型与排序 | `src/lib/file-utils.ts` |
| 文件拖入、拖出与跨目录放置生命周期 | `src/hooks/useFileDrag.ts` |
| 收藏、会话、任务、撤销和空间快照持久化 | `src/lib/storage.ts` |
| 任务筛选、优先级与失败重试路径 | `src/lib/task-utils.ts` |
| 网络位置提示与退避重试 | `src/lib/network-utils.ts` |
| 搜索条件比较与名称生成 | `src/lib/search-utils.ts` |
| 空间历史、容量比例与增长计算 | `src/lib/space-history.ts` |
| 空间诊断建议、清理筛选与重复文件规则 | `src/lib/space-utils.ts` |
| 磁盘诊断报告 | `src/lib/space-report.ts` |
| 文件操作错误分类 | `src-tauri/src/error_policy.rs` |
| Windows 名称与递归目标保护 | `src-tauri/src/path_policy.rs` |

## 3. 安全不变量

- 永久删除必须经过明确确认；默认删除进入 Windows 回收站。
- 清理功能必须先生成具体文件清单，不得自动勾选，不得把系统保护类别变成可直接清理。
- 重复文件清理必须重新校验完整内容，并保证每组至少保留一份。
- 路径参数必须在 Rust 端重新校验，不能只依赖前端按钮状态。
- Windows 长路径在内部必须保留扩展长度语义，对前端返回时再移除 `\\?\` 实现前缀；不得通过截断路径规避错误。
- 网络位置失败可指数退避，但可用状态必须立即清除该路径的失败次数，避免恢复后继续沿用最长重试间隔。
- 恢复中断任务时不得静默续跑；用户确认后重新扫描来源并重新处理冲突。
- 复制或替换失败时必须删除半成品；若目标原本存在，必须优先恢复临时备份并在回滚失败时保留可诊断错误。
- API 密钥不得进入日志、普通设置文件、Git 或命令行参数；当前使用 Windows 凭据管理器。
- 应用更新必须使用 Tauri 公钥验签；`.sig` 更新签名与 Windows Authenticode 代码签名不可混为一谈。
- 不通过注册表劫持冒充完整 Windows Explorer；Shell 集成必须可恢复且限定当前用户。

## 4. 模块化规则

新增功能时按以下顺序判断：

1. 可脱离 React 运行的判断或转换，放入 `src/lib/` 并先写测试。
2. 独立面板、对话框或重复区域，放入 `src/components/`，通过类型明确的 props 与主应用连接。
3. 具有订阅、计时器或异步生命周期的逻辑，放入 `src/hooks/`。
4. 需要文件系统、Windows API 或敏感凭据的能力，放入 Rust 后端并保持前端接口收敛。
5. `App.tsx` 只保留跨模块协调；不要把已拆出的规则复制回去。

## 5. 验证与发布

普通改动至少运行：

```powershell
cd tauri-prototype\app
npm test
npm run build
```

修改 Rust、发布配置或关键安全边界后运行：

```powershell
.\tools\Test-ReleaseReadiness.ps1
```

候选安装包流程：

```powershell
.\tools\Build-SignedInstaller.ps1
.\tools\Test-InstallerCandidate.ps1 -InstallerPath '<setup.exe>' -ExpectedVersion '<version>' -ExpectedSha256 '<sha256>'
```

静态检查通过后仍必须完成 [`RELEASE_ACCEPTANCE.md`](RELEASE_ACCEPTANCE.md) 中的实机安装、覆盖升级、失败更新和卸载矩阵，才能公开 Release。
