import { formatSize } from "../lib/format";
import { spaceCapacitySummary } from "../lib/space-history";
import { UI_COPY } from "../localization";
import type { SpaceScanResult, SpaceScanSnapshot, UiLanguage } from "../types";

type SpaceCapacityCardProps = {
  result: SpaceScanResult;
  previous: SpaceScanSnapshot | null;
  language: UiLanguage;
};

export function SpaceCapacityCard({ result, previous, language }: SpaceCapacityCardProps) {
  const text = UI_COPY[language];
  const { usedBytes, usedPercent, availableDelta } = spaceCapacitySummary(result, previous);
  return <section className="space-capacity-card">
    <div className="space-capacity-heading"><div><strong>{result.root}</strong><span>{formatSize(result.availableSpace)} {text.available} / {formatSize(result.totalSpace)}</span></div><b>{Math.round(usedPercent)}%</b></div>
    <div className="space-capacity-track"><i style={{ width: `${usedPercent}%` }} /></div>
    <div className={`space-summary-grid ${availableDelta !== null ? "with-comparison" : ""}`}>
      <article><span>{language === "zh-CN" ? "磁盘已用" : "Disk used"}</span><strong>{formatSize(usedBytes)}</strong></article>
      <article><span>{text.scanCaptured}</span><strong>{formatSize(result.scannedBytes)}</strong><small>{result.scannedFiles.toLocaleString()} {language === "zh-CN" ? "个文件" : "files"}</small></article>
      <article><span>{text.inaccessible}</span><strong>{result.issues.toLocaleString()}</strong><small>{result.skippedReparsePoints.toLocaleString()} {language === "zh-CN" ? "个联接/占位点已跳过" : "junctions/placeholders skipped"}</small></article>
      {availableDelta !== null && <article className={availableDelta >= 0 ? "space-change-positive" : "space-change-negative"}><span>{language === "zh-CN" ? "距上次体检" : "Since last scan"}</span><strong>{availableDelta >= 0 ? "+" : "−"}{formatSize(Math.abs(availableDelta))}</strong><small>{availableDelta >= 0 ? (language === "zh-CN" ? "可用空间增加" : "more free space") : (language === "zh-CN" ? "可用空间减少" : "less free space")}</small></article>}
    </div>
    <p>{text.scanCoverageHint}{result.cancelled ? ` · ${language === "zh-CN" ? "本次扫描已提前停止，当前显示部分结果。" : "This scan was stopped early; partial results are shown."}` : ""}</p>
  </section>;
}
