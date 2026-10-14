import type { TransferTask } from "../types";

export type TaskFilter = "all" | "active" | "issues" | "completed";

export function taskMatchesFilter(task: TransferTask, filter: TaskFilter) {
  if (filter === "all") return true;
  if (filter === "active") return ["queued", "running", "paused"].includes(task.status);
  if (filter === "issues") return task.recoveredFromRestart || task.status === "failed" || task.issues.length > 0;
  return task.status === "completed" || task.status === "cancelled";
}

export function filterOperationTasks(tasks: TransferTask[], filter: TaskFilter) {
  return tasks.filter((task) => taskMatchesFilter(task, filter));
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
