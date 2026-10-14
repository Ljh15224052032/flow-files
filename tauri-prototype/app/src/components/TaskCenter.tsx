import { UI_COPY } from "../localization";
import type { TransferTask, UiLanguage } from "../types";
import { formatDuration, formatSize } from "../lib/format";
import { filterOperationTasks, retryableTaskPaths, type TaskFilter } from "../lib/task-utils";

type TaskCenterProps = {
  tasks: TransferTask[];
  filter: TaskFilter;
  language: UiLanguage;
  onClose: () => void;
  onFilterChange: (filter: TaskFilter) => void;
  onPrioritize: (task: TransferTask) => void;
  onTogglePaused: () => void;
  onCancel: (task: TransferTask) => void;
  onRetry: (task: TransferTask) => void;
  onClearFinished: () => void;
};

const FILTERS: TaskFilter[] = ["all", "active", "issues", "completed"];
const ACTIVE_STATUSES = ["queued", "running", "paused"];
const FINISHED_STATUSES = ["completed", "cancelled", "failed"];

export function TaskCenter({
  tasks,
  filter,
  language,
  onClose,
  onFilterChange,
  onPrioritize,
  onTogglePaused,
  onCancel,
  onRetry,
  onClearFinished,
}: TaskCenterProps) {
  const text = UI_COPY[language];
  const activeCount = tasks.filter((task) => ACTIVE_STATUSES.includes(task.status)).length;
  const recoveredCount = tasks.filter((task) => task.recoveredFromRestart).length;
  const filteredTasks = filterOperationTasks(tasks, filter);

  function filterLabel(value: TaskFilter) {
    if (language === "zh-CN") return value === "all" ? "全部" : value === "active" ? "进行中" : value === "issues" ? "有问题" : "已完成";
    return value === "all" ? "All" : value === "active" ? "Active" : value === "issues" ? "Issues" : "Finished";
  }

  return (
    <aside className="task-center" aria-label={text.tasks}>
      <header>
        <div>
          <strong>{text.tasks}</strong>
          <span>
            {activeCount} {language === "zh-CN" ? "项进行中" : "active"}
            {recoveredCount ? ` · ${recoveredCount} ${language === "zh-CN" ? "项待恢复" : "to recover"}` : ""}
          </span>
        </div>
        <button aria-label={text.close} onClick={onClose}>×</button>
      </header>

      <nav className="task-filters" aria-label={language === "zh-CN" ? "任务筛选" : "Task filters"}>
        {FILTERS.map((value) => (
          <button key={value} className={filter === value ? "active" : ""} onClick={() => onFilterChange(value)}>
            {filterLabel(value)}
            <b>{filterOperationTasks(tasks, value).length}</b>
          </button>
        ))}
      </nav>

      <div className="task-list">
        {filteredTasks.length === 0 ? (
          <div className="task-empty">
            {tasks.length === 0 ? text.noTasks : language === "zh-CN" ? "当前筛选下没有任务" : "No tasks match this filter"}
          </div>
        ) : [...filteredTasks].reverse().map((task) => {
          const scanning = task.phase === "scanning" && ["running", "paused"].includes(task.status);
          const percent = task.totalBytes ? Math.min(100, task.processedBytes / task.totalBytes * 100) : task.status === "completed" ? 100 : 0;
          const stateLabel = task.recoveredFromRestart
            ? language === "zh-CN" ? "上次退出时中断" : "Interrupted by last exit"
            : task.status === "queued" ? text.queued
            : task.status === "paused" ? text.pause
            : task.status === "completed" ? text.completed
            : task.status === "cancelled" ? text.cancel
            : task.status === "failed" ? text.failed
            : scanning ? text.scanning
            : task.mode === "copy" ? text.copying : text.moving;
          const retryablePaths = retryableTaskPaths(task);

          return (
            <article className={`task-item ${task.status} ${task.recoveredFromRestart ? "recovered" : ""}`} key={task.jobId}>
              <div className="task-title">
                <strong>{task.mode === "copy" ? text.copy : text.cut} · {task.totalItems} {language === "zh-CN" ? "项" : "item(s)"}</strong>
                <span>{stateLabel}</span>
              </div>
              <small title={scanning ? task.currentName : task.destination}>{scanning ? task.currentName || text.scanning : `→ ${task.destination}`}</small>
              <div className={`task-progress ${scanning ? "indeterminate" : ""}`}><i style={{ width: scanning ? "34%" : `${percent}%` }} /></div>
              <div className="task-meta">
                <span>{scanning ? `${task.scannedItems} ${text.scannedItems} · ${formatSize(task.scannedBytes)}` : task.totalBytes ? `${formatSize(task.processedBytes)} / ${formatSize(task.totalBytes)}` : `${task.completedItems}/${task.totalItems}`}</span>
                {!scanning && task.speed > 0 && task.status === "running" && <span>{formatSize(task.speed)}/s · {formatDuration((task.totalBytes - task.processedBytes) / task.speed)}</span>}
                <span>{task.issues.length > 0 ? `${task.issues.length} ${language === "zh-CN" ? "个问题" : "issue(s)"}` : ""}</span>
              </div>
              {task.recoveredFromRestart && (
                <p className="task-recovery-note">
                  {language === "zh-CN"
                    ? "Flow Files 不会静默续跑。继续前会重新扫描源文件，并按原冲突规则处理已完成的部分。"
                    : "Flow Files never resumes silently. Continuing rescans the sources and applies the original conflict rules to completed items."}
                </p>
              )}
              {ACTIVE_STATUSES.includes(task.status) && (
                <div className="task-actions">
                  {task.status === "queued" && <button onClick={() => onPrioritize(task)}>{language === "zh-CN" ? "优先执行" : "Run next"}</button>}
                  {task.status !== "queued" && <button onClick={onTogglePaused}>{task.status === "paused" ? text.resume : text.pause}</button>}
                  <button onClick={() => onCancel(task)}>{text.cancel}</button>
                </div>
              )}
              {!ACTIVE_STATUSES.includes(task.status) && retryablePaths.length > 0 && (
                <div className="task-actions task-retry-actions">
                  <button onClick={() => onRetry(task)}>
                    {task.recoveredFromRestart ? language === "zh-CN" ? "重新扫描并继续" : "Rescan and continue" : text.retryFailed} · {retryablePaths.length}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {tasks.some((task) => FINISHED_STATUSES.includes(task.status)) && <footer><button onClick={onClearFinished}>{text.clearCompleted}</button></footer>}
    </aside>
  );
}
