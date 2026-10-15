import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPERATION_TASKS_KEY, FAVORITES_KEY, SESSION_KEY, SPACE_SCAN_SNAPSHOTS_KEY,
} from "../constants";
import {
  appendSpaceScanSnapshot, readSpaceScanHistory, readSpaceScanSnapshots, readStoredFavorites,
  readStoredOperationTasks, readStoredSession, snapshotForSpaceScan, writeStoredOperationTasks,
} from "./storage";
import type { TransferTask } from "../types";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("persisted Flow Files state", () => {
  it("migrates legacy favorites and removes case-insensitive duplicates", () => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([
      "D:\\Projects",
      { path: "d:\\projects", label: "Duplicate", group: "Work" },
      { path: "C:\\Users\\z\\Downloads", label: " 下载 ", group: " 常用 " },
      { broken: true },
    ]));
    expect(readStoredFavorites()).toEqual([
      { path: "D:\\Projects", label: null, group: null },
      { path: "C:\\Users\\z\\Downloads", label: "下载", group: "常用" },
    ]);
  });

  it("marks interrupted transfers as failed after restart", () => {
    localStorage.setItem(OPERATION_TASKS_KEY, JSON.stringify([{
      jobId: "copy-1",
      mode: "copy",
      sourcePaths: ["C:\\source.txt"],
      destination: "D:\\target",
      conflict: "keepBoth",
      conflictResolutions: [],
      status: "running",
      queuedAt: 10,
      startedAt: 20,
      processedBytes: 50,
      totalBytes: 100,
      completedItems: 0,
      totalItems: 1,
    }]));
    const [task] = readStoredOperationTasks();
    expect(task.status).toBe("failed");
    expect(task.error).toContain("closed before this task completed");
    expect(task.recoveredFromRestart).toBe(true);
    expect(task.processedBytes).toBe(50);
    expect(task.sourcePaths).toEqual(["C:\\source.txt"]);
  });

  it("persists only the latest twenty transfer tasks for shutdown recovery", () => {
    const tasks = Array.from({ length: 24 }, (_, index) => ({
      jobId: `job-${index}`, mode: "copy", sourcePaths: [`C:\\source-${index}.txt`], destination: "D:\\target",
      conflict: "skip", conflictResolutions: [], status: "queued", queuedAt: index, startedAt: index,
      finishedAt: null, paused: false, processedBytes: 0, totalBytes: 0, completedItems: 0, totalItems: 1,
      currentName: "", phase: "scanning", scannedItems: 0, scannedBytes: 0, speed: 0, issues: [], error: null,
      recoveredFromRestart: false,
    } satisfies TransferTask));
    writeStoredOperationTasks(tasks);
    const stored = JSON.parse(localStorage.getItem(OPERATION_TASKS_KEY) ?? "[]") as TransferTask[];
    expect(stored).toHaveLength(20);
    expect(stored[0].jobId).toBe("job-4");
    expect(stored[19].jobId).toBe("job-23");
  });

  it("drops malformed persisted operation issues before task recovery", () => {
    localStorage.setItem(OPERATION_TASKS_KEY, JSON.stringify([{
      jobId: "failed-1", mode: "copy", sourcePaths: ["C:\\source.txt"], destination: "D:\\target",
      conflict: "skip", conflictResolutions: [], status: "failed", queuedAt: 1, startedAt: 1,
      issues: [
        { path: "C:\\locked.txt", code: "inUse", message: "locked" },
        { path: null, code: "network", message: "bad path" },
        { path: "C:\\unknown.txt", code: "invented", message: "bad code" },
        "not an issue",
      ],
    }]));
    const [task] = readStoredOperationTasks();
    expect(task.issues).toEqual([{ path: "C:\\locked.txt", code: "inUse", message: "locked" }]);
  });

  it("sanitizes restored sessions instead of trusting arbitrary storage", () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      activeTabId: 7,
      tabs: [{
        id: 7,
        path: "D:\\Projects\\Flow",
        label: 42,
        pinned: "yes",
        history: ["D:\\Projects", null, "D:\\Projects\\Flow"],
        historyIndex: 99,
        scrollTop: -20,
        viewMode: "unknown",
        selectedPaths: ["D:\\Projects\\Flow\\README.md", 12],
      }],
    }));
    const session = readStoredSession();
    expect(session?.tabs).toHaveLength(1);
    expect(session?.tabs[0]).toMatchObject({
      path: "D:\\Projects\\Flow",
      label: "Flow",
      pinned: true,
      historyIndex: 1,
      scrollTop: 0,
      viewMode: "comfortable",
      selectedPaths: ["D:\\Projects\\Flow\\README.md"],
    });
  });

  it("migrates a compact legacy disk snapshot into bounded history", () => {
    const snapshot = snapshotForSpaceScan({
      root: "C:\\",
      totalSpace: 1000,
      availableSpace: 250,
      scannedBytes: 700,
      scannedFiles: 3,
      scannedFolders: 2,
      issues: 0,
      skippedReparsePoints: 0,
      cancelled: false,
      largestFiles: [],
      largestDirectories: [],
      categories: [{ id: "temporaryFiles", risk: "safe", size: 40, fileCount: 2 }],
    });
    localStorage.setItem(SPACE_SCAN_SNAPSHOTS_KEY, JSON.stringify({ c: snapshot }));
    expect(readSpaceScanSnapshots().c).toMatchObject({
      root: "C:\\",
      availableSpace: 250,
      categories: { temporaryFiles: 40 },
    });
    expect(readSpaceScanHistory().c).toEqual([snapshot]);
  });

  it("keeps only the latest twelve disk snapshots", () => {
    let now = 1;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    for (let index = 0; index < 15; index += 1) {
      now = index + 1;
      appendSpaceScanSnapshot({
        root: "C:\\", totalSpace: 1000, availableSpace: 300 - index,
        scannedBytes: 600 + index, scannedFiles: 3, scannedFolders: 2, issues: 0,
        skippedReparsePoints: 0, cancelled: false, largestFiles: [], largestDirectories: [],
        categories: [{ id: "temporaryFiles", risk: "safe", size: index, fileCount: 1 }],
      });
    }
    const history = readSpaceScanHistory()["c:\\"];
    expect(history).toHaveLength(12);
    expect(history[0].capturedAt).toBe(4);
    expect(history[11].capturedAt).toBe(15);
  });
});
