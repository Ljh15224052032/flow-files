import { UI_COPY } from "../localization";
import type { RunningOperation, SearchResultMeta, UiLanguage } from "../types";

export function operationProgressPercent(operation: RunningOperation) {
  if (operation.phase === "scanning") return 34;
  return operation.totalBytes ? Math.min(100, operation.processedBytes / operation.totalBytes * 100) : 0;
}

export function searchResultSummary(meta: SearchResultMeta, language: UiLanguage) {
  const text = UI_COPY[language];
  const provider = meta.provider === "everything"
    ? language === "zh-CN" ? "Everything 索引" : "Everything index"
    : language === "zh-CN" ? "本地扫描" : "Local scan";
  return `${provider} · ${text.scanned} ${meta.scanned}${meta.truncated ? " · 20,000+" : meta.cancelled ? ` · ${text.cancel}` : ""}`;
}
