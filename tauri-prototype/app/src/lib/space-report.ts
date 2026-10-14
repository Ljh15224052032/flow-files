import type { SpaceScanResult, UiLanguage } from "../types";
import { formatSize } from "./format";
import { spaceCategoryLabel } from "./space-utils";

export function buildSpaceReport(result: SpaceScanResult, language: UiLanguage, capturedAt = Date.now()) {
  const zh = language === "zh-CN";
  const used = Math.max(0, result.totalSpace - result.availableSpace);
  const lines = [
    zh ? "Flow Files 磁盘空间诊断报告" : "Flow Files disk space report",
    `${zh ? "生成时间" : "Generated"}: ${new Date(capturedAt).toLocaleString(language)}`,
    `${zh ? "扫描范围" : "Scope"}: ${result.root}`,
    `${zh ? "磁盘容量" : "Capacity"}: ${formatSize(result.totalSpace)}`,
    `${zh ? "已用 / 可用" : "Used / free"}: ${formatSize(used)} / ${formatSize(result.availableSpace)}`,
    `${zh ? "已读取" : "Measured"}: ${formatSize(result.scannedBytes)} · ${result.scannedFiles.toLocaleString(language)} ${zh ? "个文件" : "files"} · ${result.scannedFolders.toLocaleString(language)} ${zh ? "个文件夹" : "folders"}`,
    `${zh ? "无法读取 / 跳过联接" : "Unreadable / skipped links"}: ${result.issues.toLocaleString(language)} / ${result.skippedReparsePoints.toLocaleString(language)}`,
  ];

  if (result.cancelled) lines.push(zh ? "注意：扫描提前停止，以下为部分结果。" : "Note: the scan stopped early, so the results are partial.");
  lines.push("", zh ? "分类占用" : "Categories");
  for (const category of [...result.categories].sort((left, right) => right.size - left.size)) {
    lines.push(`- ${spaceCategoryLabel(category.id, language)}: ${formatSize(category.size)} · ${category.fileCount.toLocaleString(language)} ${zh ? "个文件" : "files"} · ${category.risk}`);
  }

  lines.push("", zh ? "最大目录（前 10）" : "Largest folders (top 10)");
  for (const item of result.largestDirectories.slice(0, 10)) lines.push(`- ${formatSize(item.size)} · ${item.path}`);
  lines.push("", zh ? "最大文件（前 10）" : "Largest files (top 10)");
  for (const item of result.largestFiles.slice(0, 10)) lines.push(`- ${formatSize(item.size)} · ${item.path}`);
  lines.push("", zh ? "说明：报告仅来自只读扫描，不代表上述内容都可以安全删除。" : "Note: this report comes from a read-only scan; listed items are not automatically safe to delete.");
  return lines.join("\n");
}
