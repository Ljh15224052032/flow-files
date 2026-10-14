import { describe, expect, it } from "vitest";
import type { TransferTask } from "../types";
import { filterOperationTasks } from "./task-utils";

function task(status: TransferTask["status"], recoveredFromRestart = false, issueCount = 0): TransferTask {
  return {
    jobId: `${status}-${recoveredFromRestart}-${issueCount}`, mode: "copy", sourcePaths: ["C:\\source.txt"], destination: "D:\\target",
    conflict: "skip", conflictResolutions: [], status, queuedAt: 1, startedAt: 1, finishedAt: null, paused: status === "paused",
    processedBytes: 0, totalBytes: 0, completedItems: 0, totalItems: 1, currentName: "", phase: "scanning", scannedItems: 0,
    scannedBytes: 0, speed: 0, issues: Array.from({ length: issueCount }, () => ({ path: "C:\\source.txt", code: "other", message: "error" })),
    error: null, recoveredFromRestart,
  };
}

describe("task center filters", () => {
  const tasks = [task("running"), task("paused"), task("failed"), task("failed", true), task("completed"), task("completed", false, 1), task("cancelled")];

  it("separates active and finished tasks", () => {
    expect(filterOperationTasks(tasks, "active")).toHaveLength(2);
    expect(filterOperationTasks(tasks, "completed")).toHaveLength(3);
  });

  it("keeps failed, recovered, and partially completed issue tasks together", () => {
    expect(filterOperationTasks(tasks, "issues")).toHaveLength(3);
  });
});
