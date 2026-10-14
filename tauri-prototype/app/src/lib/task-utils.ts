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
