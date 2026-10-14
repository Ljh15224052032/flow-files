import type { TransferTask } from "../types";

export type TaskFilter = "all" | "active" | "issues" | "completed";
export type TaskModeFilter = "all" | "copy" | "move";

export function taskMatchesFilter(task: TransferTask, filter: TaskFilter) {
  if (filter === "all") return true;
  if (filter === "active") return ["queued", "running", "paused"].includes(task.status);
  if (filter === "issues") return task.recoveredFromRestart || task.status === "failed" || task.issues.length > 0;
  return task.status === "completed" || task.status === "cancelled";
}

export function taskMatchesQuery(task: TransferTask, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [task.destination, task.currentName, ...task.sourcePaths]
    .some((value) => value.toLocaleLowerCase().includes(normalized));
}

export function filterOperationTasks(tasks: TransferTask[], filter: TaskFilter, query = "", mode: TaskModeFilter = "all") {
  return tasks.filter((task) => taskMatchesFilter(task, filter)
    && (mode === "all" || task.mode === mode)
    && taskMatchesQuery(task, query));
}

export function retryableTaskPaths(task: TransferTask) {
  const issuePaths = task.issues.map((issue) => issue.path);
  const candidates = issuePaths.length ? issuePaths : task.status === "failed" && task.error ? task.sourcePaths : [];
  return candidates.filter(
    (path, index, all) => all.findIndex((candidate) => candidate.toLocaleLowerCase() === path.toLocaleLowerCase()) === index,
  );
}

export function prioritizeQueuedTask(tasks: TransferTask[], jobId: string) {
  const taskIndex = tasks.findIndex((task) => task.jobId === jobId && task.status === "queued");
  if (taskIndex < 0) return tasks;
  const firstQueuedIndex = tasks.findIndex((task) => task.status === "queued");
  if (firstQueuedIndex < 0 || taskIndex === firstQueuedIndex) return tasks;
  const next = [...tasks];
  const [task] = next.splice(taskIndex, 1);
  next.splice(firstQueuedIndex, 0, task);
  return next;
}
