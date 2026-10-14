import { describe, expect, it } from "vitest";
import type { RunningOperation } from "../types";
import { operationProgressPercent, searchResultSummary } from "./status-utils";

function operation(overrides: Partial<RunningOperation> = {}): RunningOperation {
  return {
    jobId: "job", mode: "copy", paused: false, startedAt: 0, speed: 0,
    processedBytes: 25, totalBytes: 100, completedItems: 0, totalItems: 1,
    currentName: "", phase: "transfer", scannedItems: 0, scannedBytes: 0,
    ...overrides,
  };
}

describe("status bar summaries", () => {
  it("caps transfer progress and keeps scanning indeterminate", () => {
    expect(operationProgressPercent(operation())).toBe(25);
    expect(operationProgressPercent(operation({ processedBytes: 120 }))).toBe(100);
    expect(operationProgressPercent(operation({ phase: "scanning" }))).toBe(34);
  });

  it("describes indexed, truncated, and cancelled searches", () => {
    expect(searchResultSummary({ provider: "everything", scanned: 42, truncated: false, cancelled: false }, "zh-CN")).toBe("Everything 索引 · 已扫描 42");
    expect(searchResultSummary({ provider: "native", scanned: 20_000, truncated: true, cancelled: false }, "en")).toContain("20,000+");
    expect(searchResultSummary({ provider: "native", scanned: 8, truncated: false, cancelled: true }, "en")).toBe("Local scan · Scanned 8 · Cancel");
  });
});
