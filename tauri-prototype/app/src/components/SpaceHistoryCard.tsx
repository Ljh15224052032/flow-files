import { formatDate, formatSize } from "../lib/format";
import { visibleSpaceHistory } from "../lib/space-history";
import type { SpaceScanSnapshot, UiLanguage } from "../types";

type SpaceHistoryCardProps = {
  history: SpaceScanSnapshot[];
  language: UiLanguage;
  availableLabel: string;
};

export function SpaceHistoryCard({ history, language, availableLabel }: SpaceHistoryCardProps) {
  if (history.length <= 1) return null;
  return <section className="space-history-card">
    <header><div><strong>{language === "zh-CN" ? "空间变化记录" : "Space history"}</strong><span>{language === "zh-CN" ? `最多保留最近 12 次体检，当前已有 ${history.length} 次` : `Keeps up to 12 scans; ${history.length} currently stored`}</span></div><b>{language === "zh-CN" ? "可用空间" : "Free space"}</b></header>
    <div className="space-history-list">{visibleSpaceHistory(history).map(({ snapshot, availableDelta, usedPercent }) => <article key={`${snapshot.root}-${snapshot.capturedAt}`}><div><strong>{formatDate(snapshot.capturedAt / 1000, language)}</strong><span>{formatSize(snapshot.availableSpace)} {availableLabel}{availableDelta !== null && availableDelta !== 0 ? ` · ${availableDelta > 0 ? "+" : "−"}${formatSize(Math.abs(availableDelta))}` : ""}</span></div><i><b style={{ width: `${usedPercent}%` }} /></i><em>{Math.round(usedPercent)}%</em></article>)}</div>
  </section>;
}
