import { UI_COPY } from "../localization";
import type { RunningOperation, SearchProgress, SearchResultMeta, UiLanguage, UndoRecord } from "../types";
import { formatDuration, formatSize } from "../lib/format";
import { operationProgressPercent, searchResultSummary } from "../lib/status-utils";

type StatusBarProps = {
  operation: RunningOperation | null;
  searching: boolean;
  searchProgress: SearchProgress | null;
  searchResultMeta: SearchResultMeta | null;
  hasSearchResults: boolean;
  isLoading: boolean;
  status: string;
  latestUndo: UndoRecord | null;
  undoCount: number;
  undoBusy: boolean;
  itemCount: number;
  language: UiLanguage;
  onOpenTasks: () => void;
  onTogglePaused: () => void;
  onCancelOperation: () => void;
  onCancelSearch: () => void;
  onUndo: () => void;
};

export function StatusBar({
  operation,
  searching,
  searchProgress,
  searchResultMeta,
  hasSearchResults,
  isLoading,
  status,
  latestUndo,
  undoCount,
  undoBusy,
  itemCount,
  language,
  onOpenTasks,
  onTogglePaused,
  onCancelOperation,
  onCancelSearch,
  onUndo,
}: StatusBarProps) {
  const text = UI_COPY[language];
  return (
    <footer>
      {operation ? (
        <div className="operation-status">
          <button className="operation-summary" onClick={onOpenTasks}>
            <span>{operation.paused ? text.pause : operation.phase === "scanning" ? text.scanning : operation.mode === "copy" ? text.copying : text.moving} · {operation.currentName || (operation.phase === "scanning" ? operation.scannedItems : `${operation.completedItems}/${operation.totalItems}`)}</span>
          </button>
          <div className={`progress-track ${operation.phase === "scanning" ? "indeterminate" : ""}`}><i style={{ width: `${operationProgressPercent(operation)}%` }} /></div>
          <small>
            {operation.phase === "scanning"
              ? `${operation.scannedItems} ${text.scannedItems} · ${formatSize(operation.scannedBytes)}`
              : `${formatSize(operation.processedBytes)} / ${formatSize(operation.totalBytes)}${operation.speed > 0 && !operation.paused ? ` · ${formatSize(operation.speed)}/s · ${formatDuration((operation.totalBytes - operation.processedBytes) / operation.speed)}` : ""}`}
          </small>
          <button onClick={onTogglePaused}>{operation.paused ? text.resume : text.pause}</button>
          <button onClick={onCancelOperation}>{text.cancel}</button>
        </div>
      ) : searching ? (
        <div className="search-operation-status">
          <span className="loading-dot">{text.searchAll}</span>
          <span>{text.scanned} {searchProgress?.scanned ?? 0} · {searchProgress?.matches ?? 0} {text.matches}</span>
          <small title={searchProgress?.currentPath}>{searchProgress?.currentPath}</small>
          <button onClick={onCancelSearch}>{text.cancel}</button>
        </div>
      ) : (
        <>
          <span className={isLoading ? "loading-dot" : ""}>{isLoading ? text.loading : text.ready}</span>
          <span className="footer-message">{hasSearchResults && searchResultMeta ? searchResultSummary(searchResultMeta, language) : status}</span>
          {latestUndo && <button className="footer-undo" disabled={undoBusy} title={`${latestUndo.label} · ${text.undoRetention}`} onClick={onUndo}><span>{text.undo} · {latestUndo.label}</span><b>{undoCount}</b></button>}
        </>
      )}
      <span className="item-count">{itemCount} {text.shown}</span>
    </footer>
  );
}
