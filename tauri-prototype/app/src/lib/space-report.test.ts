import { describe, expect, it } from "vitest";
import type { SpaceScanResult } from "../types";
import { buildSpaceReport } from "./space-report";

const result: SpaceScanResult = {
  root: "C:\\",
  totalSpace: 1000,
  availableSpace: 250,
  scannedBytes: 600,
  scannedFiles: 3,
  scannedFolders: 2,
  issues: 1,
  skippedReparsePoints: 1,
  cancelled: false,
  categories: [{ id: "temporaryFiles", risk: "safe", size: 300, fileCount: 2 }],
  largestDirectories: [{ name: "Cache", path: "C:\\Cache", size: 300, modifiedUnixSeconds: null, isDirectory: true }],
  largestFiles: [{ name: "large.bin", path: "C:\\large.bin", size: 200, modifiedUnixSeconds: null, isDirectory: false }],
};

describe("space report", () => {
  it("includes scope, safety context, categories, and largest paths", () => {
    const report = buildSpaceReport(result, "zh-CN", Date.UTC(2026, 9, 14));
    expect(report).toContain("扫描范围: C:\\");
    expect(report).toContain("临时文件");
    expect(report).toContain("C:\\Cache");
    expect(report).toContain("不代表上述内容都可以安全删除");
  });

  it("marks partial scans explicitly", () => {
    expect(buildSpaceReport({ ...result, cancelled: true }, "en", 0)).toContain("results are partial");
  });
});
