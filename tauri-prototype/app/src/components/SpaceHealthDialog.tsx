import type {
  DuplicateGroup, DuplicateScanProgress, DuplicateScanResult, DuplicateSizeFilter,
  DuplicateTypeFilter, Location, SpaceCleanupAge, SpaceCleanupPreview, SpaceScanCategory,
  SpaceScanItem, SpaceScanProgress, SpaceScanResult, SpaceScanSnapshot, UiLanguage,
} from "../types";
import { UI_COPY } from "../localization";
import { formatDate, formatSize } from "../lib/format";
import { labelForPath } from "../lib/file-utils";
import {
  duplicateKeepReason, filterDuplicateGroups, filterSpaceCleanupCandidates,
  selectedSpaceItemBytes, spaceCategoryAdvice, spaceCategoryLabel, suggestedDuplicateKeep,
} from "../lib/space-utils";
import { SpaceHealthIcon } from "./Icons";
import { SpaceCapacityCard } from "./SpaceCapacityCard";
import { SpaceHistoryCard } from "./SpaceHistoryCard";
import { SpaceRankings } from "./SpaceRankings";

type ScanModel = {
  locations: Location[];
  drive: string;
  root: string;
  scanning: boolean;
  progress: SpaceScanProgress | null;
  result: SpaceScanResult | null;
  previousSnapshot: SpaceScanSnapshot | null;
  history: SpaceScanSnapshot[];
  error: string | null;
};

type DuplicateModel = {
  scanning: boolean;
  progress: DuplicateScanProgress | null;
  result: DuplicateScanResult | null;
  error: string | null;
  selected: ReadonlySet<string>;
  confirmOpen: boolean;
  acknowledged: boolean;
  busy: boolean;
  message: string | null;
  query: string;
  sizeFilter: DuplicateSizeFilter;
  typeFilter: DuplicateTypeFilter;
};

type CleanupModel = {
  adviceCategoryId: string | null;
  preview: SpaceCleanupPreview | null;
  loading: boolean;
  selected: ReadonlySet<string>;
  age: SpaceCleanupAge;
  confirmOpen: boolean;
  acknowledged: boolean;
  message: string | null;
  error: string | null;
};

type SpaceHealthDialogProps = {
  language: UiLanguage;
  scan: ScanModel;
  duplicates: DuplicateModel;
  cleanup: CleanupModel;
  onClose: () => void;
  onSelectDrive: (path: string) => void;
  onStartScan: () => void;
  onStopScan: () => void;
  onScanParent: () => void;
  onCopyReport: (result: SpaceScanResult) => void;
  onOpenItem: (item: SpaceScanItem) => void;
  onDrillDirectory: (item: SpaceScanItem) => void;
  onStartDuplicateScan: () => void;
  onStopDuplicateScan: () => void;
  onDuplicateQueryChange: (value: string) => void;
  onDuplicateSizeChange: (value: DuplicateSizeFilter) => void;
  onDuplicateTypeChange: (value: DuplicateTypeFilter) => void;
  onToggleDuplicate: (group: DuplicateGroup, path: string) => void;
  onOpenDuplicateReview: () => void;
  onCloseDuplicateReview: () => void;
  onDuplicateAcknowledgedChange: (value: boolean) => void;
  onConfirmDuplicateCleanup: () => void;
  onShowAdvice: (category: SpaceScanCategory) => void;
  onCloseAdvice: () => void;
  onPrepareCleanup: (category: SpaceScanCategory) => void;
  onCleanupAgeChange: (age: SpaceCleanupAge) => void;
  onSelectCleanupPaths: (paths: string[]) => void;
  onToggleCleanup: (path: string) => void;
  onRevealCleanup: (path: string) => void;
  onOpenCleanupReview: () => void;
  onCloseCleanupReview: () => void;
  onCleanupAcknowledgedChange: (value: boolean) => void;
  onConfirmCleanup: () => void;
};

export function SpaceHealthDialog({
  language, scan, duplicates, cleanup, onClose, onSelectDrive, onStartScan, onStopScan,
  onScanParent, onCopyReport, onOpenItem, onDrillDirectory, onStartDuplicateScan,
  onStopDuplicateScan, onDuplicateQueryChange, onDuplicateSizeChange, onDuplicateTypeChange,
  onToggleDuplicate, onOpenDuplicateReview, onCloseDuplicateReview,
  onDuplicateAcknowledgedChange, onConfirmDuplicateCleanup, onShowAdvice, onCloseAdvice,
  onPrepareCleanup, onCleanupAgeChange, onSelectCleanupPaths, onToggleCleanup,
  onRevealCleanup, onOpenCleanupReview, onCloseCleanupReview,
  onCleanupAcknowledgedChange, onConfirmCleanup,
}: SpaceHealthDialogProps) {
  const text = UI_COPY[language];
  const drives = scan.locations.filter((location) => /^[A-Za-z]:\\$/.test(location.path) && location.isAvailable);
  const scanningSubdirectory = scan.root.toLocaleLowerCase() !== scan.drive.toLocaleLowerCase();
  const riskLabel = (risk: SpaceScanCategory["risk"]) => risk === "safe" ? text.safeToReview : risk === "review" ? text.confirmBeforeAction : text.protectedItem;
  const activeCategory = scan.result?.categories.find((category) => category.id === cleanup.adviceCategoryId) ?? null;
  const activeAdvice = activeCategory ? spaceCategoryAdvice(activeCategory.id, language) : null;
  const filteredCleanupCandidates = cleanup.preview ? filterSpaceCleanupCandidates(cleanup.preview.candidates, cleanup.age) : [];
  const filteredCleanupBytes = filteredCleanupCandidates.reduce((sum, item) => sum + item.size, 0);
  const selectedCleanupBytes = cleanup.preview ? selectedSpaceItemBytes(cleanup.preview.candidates, cleanup.selected) : 0;
  const duplicateItems = duplicates.result?.groups.flatMap((group) => group.files) ?? [];
  const selectedDuplicateBytes = selectedSpaceItemBytes(duplicateItems, duplicates.selected);
  const filteredDuplicateGroups = duplicates.result
    ? filterDuplicateGroups(duplicates.result.groups, duplicates.query, duplicates.sizeFilter, duplicates.typeFilter)
    : [];

  return <div className="settings-backdrop space-health-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="space-health-panel" role="dialog" aria-modal="true" aria-labelledby="space-health-title">
      <header>
        <div><h2 id="space-health-title">{text.spaceHealthTitle}</h2><p>{text.spaceHealthIntro}</p></div>
        <button className="settings-close" aria-label={text.close} onClick={onClose}>×</button>
      </header>
      <div className="space-health-controls">
        <div className="space-drive-picker" aria-label={text.locations}>{drives.map((drive) => <button key={drive.path} className={scan.drive.toLocaleLowerCase() === drive.path.toLocaleLowerCase() ? "active" : ""} disabled={scan.scanning || duplicates.scanning} onClick={() => onSelectDrive(drive.path)}><strong>{drive.path}</strong><span>{drive.availableSpace !== null ? `${formatSize(drive.availableSpace)} ${text.available}` : "—"}</span></button>)}</div>
        {scan.scanning ? <button className="space-scan-action secondary" onClick={onStopScan}>{text.stopScan}</button> : <button className="space-scan-action" disabled={!drives.length} onClick={onStartScan}>{scan.result ? text.rescan : text.startScan}</button>}
      </div>
      <div className="space-health-body">
        {(scan.result || scanningSubdirectory) && <div className="space-scope-bar"><button disabled={!scanningSubdirectory || scan.scanning} onClick={onScanParent}>←</button><div><span>{language === "zh-CN" ? "扫描范围" : "Scan scope"}</span><strong title={scan.root}>{scan.root}</strong></div>{scan.result && <div className="space-scope-actions"><button onClick={() => onCopyReport(scan.result!)}>{language === "zh-CN" ? "复制报告" : "Copy report"}</button><button className="space-open-scope" onClick={() => onOpenItem({ name: labelForPath(scan.result!.root), path: scan.result!.root, size: scan.result!.scannedBytes, modifiedUnixSeconds: null, isDirectory: true })}>{text.openLocation}</button></div>}</div>}
        {scan.scanning && <section className="space-scan-running"><div className="space-scan-running-heading"><strong>{text.scanningSpace}</strong><span>{formatSize(scan.progress?.scannedBytes ?? 0)} · {scan.progress?.scannedFiles ?? 0} {language === "zh-CN" ? "个文件" : "files"}</span></div><div className="space-health-progress indeterminate"><i /></div><small title={scan.progress?.currentPath}>{scan.progress?.currentPath}</small></section>}
        {scan.error && <div className="space-scan-error"><strong>{language === "zh-CN" ? "扫描未完成" : "Scan did not finish"}</strong><span>{scan.error}</span></div>}
        {!scan.result && !scan.scanning && !scan.error && <div className="space-health-empty"><SpaceHealthIcon /><strong>{text.noScanYet}</strong><span>{text.scanCoverageHint}</span></div>}
        {scan.result && <>
          <SpaceCapacityCard result={scan.result} previous={scan.previousSnapshot} language={language} />
          <SpaceHistoryCard history={scan.history} language={language} availableLabel={text.available} />
          <section className="duplicate-diagnostic">
            <header><div><strong>{language === "zh-CN" ? "重复文件诊断" : "Duplicate file diagnosis"}</strong><span>{language === "zh-CN" ? "仅检查 1 MB 以上文件；完整哈希确认，不会自动选择或删除" : "Files over 1 MB only; full-hash verification with no automatic selection or deletion"}</span></div>{duplicates.scanning ? <button className="secondary" onClick={onStopDuplicateScan}>{text.stopScan}</button> : <button disabled={scan.scanning} onClick={onStartDuplicateScan}>{duplicates.result ? (language === "zh-CN" ? "重新查重" : "Scan again") : (language === "zh-CN" ? "开始查重" : "Find duplicates")}</button>}</header>
            {duplicates.scanning && <div className="duplicate-running"><div><strong>{duplicates.progress?.phase === "verifying" ? (language === "zh-CN" ? "正在完整校验…" : "Verifying full contents…") : duplicates.progress?.phase === "fingerprint" ? (language === "zh-CN" ? "正在筛选候选…" : "Filtering candidates…") : (language === "zh-CN" ? "正在扫描文件…" : "Scanning files…")}</strong><span>{(duplicates.progress?.scannedFiles ?? 0).toLocaleString()} {language === "zh-CN" ? "个文件" : "files"} · {(duplicates.progress?.candidateFiles ?? 0).toLocaleString()} {language === "zh-CN" ? "个候选" : "candidates"}</span></div><div className="space-health-progress indeterminate"><i /></div><small title={duplicates.progress?.currentPath}>{duplicates.progress?.currentPath}</small></div>}
            {duplicates.error && <div className="space-scan-error"><strong>{language === "zh-CN" ? "重复文件诊断未完成" : "Duplicate diagnosis did not finish"}</strong><span>{duplicates.error}</span></div>}
            {duplicates.result && <div className="duplicate-results">
              <div className="duplicate-summary"><article><span>{language === "zh-CN" ? "确认重复组" : "Verified groups"}</span><strong>{duplicates.result.groups.length.toLocaleString()}</strong></article><article><span>{language === "zh-CN" ? "可复核空间" : "Reviewable space"}</span><strong>{formatSize(duplicates.result.reclaimableBytes)}</strong></article><article><span>{language === "zh-CN" ? "已检查" : "Scanned"}</span><strong>{duplicates.result.scannedFiles.toLocaleString()}</strong><small>{duplicates.result.issues ? `${duplicates.result.issues} ${language === "zh-CN" ? "个无法读取" : "unreadable"}` : (language === "zh-CN" ? "无读取错误" : "No read errors")}</small></article></div>
              <p>{language === "zh-CN" ? "“可复核空间”按每组保留 1 份估算。“建议保留”只根据目录性质、修改时间和路径长度给出参考，不会自动勾选；每组始终至少保留一份。" : "Reviewable space assumes one copy is retained. Suggested keeps only consider folder type, modified date, and path length; nothing is preselected and every group keeps at least one copy."}</p>
              {duplicates.result.truncated && <p className="space-cleanup-note">{language === "zh-CN" ? "重复组很多，当前仅显示占用最大的 500 组。" : "Many groups were found; only the 500 largest are shown."}</p>}
              {!!duplicates.result.groups.length && <div className="duplicate-filter-bar"><input value={duplicates.query} onChange={(event) => onDuplicateQueryChange(event.target.value)} placeholder={language === "zh-CN" ? "筛选文件名、文件夹或完整路径" : "Filter name, folder, or full path"} /><select value={duplicates.typeFilter} onChange={(event) => onDuplicateTypeChange(event.target.value as DuplicateTypeFilter)} aria-label={language === "zh-CN" ? "文件类型" : "File type"}><option value="all">{language === "zh-CN" ? "所有类型" : "All types"}</option><option value="images">{text.images}</option><option value="videos">{text.videos}</option><option value="audio">{text.audio}</option><option value="documents">{text.documents}</option><option value="archives">{text.archives}</option><option value="other">{language === "zh-CN" ? "其他类型" : "Other"}</option></select><div>{(["all", "10mb", "100mb", "1gb"] as DuplicateSizeFilter[]).map((size) => <button key={size} className={duplicates.sizeFilter === size ? "active" : ""} onClick={() => onDuplicateSizeChange(size)}>{size === "all" ? (language === "zh-CN" ? "全部大小" : "All sizes") : `${size.replace("mb", " MB").replace("gb", " GB")}+`}</button>)}</div><span>{filteredDuplicateGroups.length.toLocaleString()} / {duplicates.result.groups.length.toLocaleString()} {language === "zh-CN" ? "组" : "groups"}</span></div>}
              {duplicates.message && <div className="duplicate-cleanup-message">{duplicates.message}</div>}
              <div className="duplicate-groups">{filteredDuplicateGroups.length ? filteredDuplicateGroups.map((group) => {
                const suggested = suggestedDuplicateKeep(group);
                return <details key={`${group.signature}-${group.fileSize}`}><summary><span><strong>{formatSize(group.fileSize)} × {group.files.length}</strong><small>{language === "zh-CN" ? `可复核 ${formatSize(group.reclaimableBytes)}` : `${formatSize(group.reclaimableBytes)} reviewable`} · #{group.signature}</small></span><b>›</b></summary><div>{group.files.map((item) => <div className={`duplicate-file-row ${suggested?.path === item.path ? "suggested-keep" : ""}`} key={item.path} title={item.path}><label><input type="checkbox" checked={duplicates.selected.has(item.path)} disabled={duplicates.busy} onChange={() => onToggleDuplicate(group, item.path)} /><span><strong>{item.name}{suggested?.path === item.path && <b className="keep-suggestion">{language === "zh-CN" ? "建议保留" : "Suggested keep"}</b>}</strong><small>{item.path}</small>{suggested?.path === item.path && <i>{duplicateKeepReason(group, item, language)}</i>}</span></label><em>{formatDate(item.modifiedUnixSeconds, language)}</em><button aria-label={text.openLocation} title={text.openLocation} onClick={() => onOpenItem(item)}>↗</button></div>)}</div></details>;
              }) : <span className="space-list-empty">{duplicates.result.groups.length ? (language === "zh-CN" ? "当前筛选下没有重复文件组。" : "No duplicate groups match the current filters.") : (language === "zh-CN" ? "没有发现经过完整内容校验的重复文件。" : "No duplicates were confirmed by full-content verification.")}</span>}</div>
              {!!duplicates.result.groups.length && <footer className="duplicate-cleanup-footer"><div><strong>{duplicates.selected.size.toLocaleString()} {language === "zh-CN" ? "个待清理" : "selected"}</strong><span>{formatSize(selectedDuplicateBytes)} · {language === "zh-CN" ? "未勾选的文件将保留" : "Unchecked copies will be retained"}</span></div><button disabled={!duplicates.selected.size || duplicates.busy} onClick={onOpenDuplicateReview}>{language === "zh-CN" ? "复核并清理" : "Review cleanup"}</button></footer>}
              {duplicates.confirmOpen && <div className="space-cleanup-confirm duplicate-cleanup-confirm"><strong>{language === "zh-CN" ? "重新校验后移入回收站" : "Re-verify, then recycle"}</strong><p>{language === "zh-CN" ? `将重新读取并比对 ${duplicates.selected.size} 个文件的完整内容；只有仍与保留副本完全一致的文件才会移入 Windows 回收站。` : `The full contents of ${duplicates.selected.size} selected file(s) will be read again. Only files still identical to a retained copy will be moved to the Windows Recycle Bin.`}</p><label><input type="checkbox" checked={duplicates.acknowledged} onChange={(event) => onDuplicateAcknowledgedChange(event.target.checked)} /><span>{language === "zh-CN" ? "我已逐项查看文件名与路径，并确认每组未勾选的副本应当保留。" : "I reviewed every name and path and confirm the unchecked copy in each group should be retained."}</span></label><div><button disabled={duplicates.busy} onClick={onCloseDuplicateReview}>{text.cancel}</button><button className="primary" disabled={!duplicates.acknowledged || duplicates.busy} onClick={onConfirmDuplicateCleanup}>{duplicates.busy ? (language === "zh-CN" ? "正在完整校验…" : "Verifying…") : (language === "zh-CN" ? "确认移入回收站" : "Move to Recycle Bin")}</button></div></div>}
            </div>}
          </section>
          <section className="space-category-section">
            <header><strong>{text.attentionItems}</strong><span>{language === "zh-CN" ? "先看建议，再预检具体文件；不会自动勾选或删除" : "Read advice, preview exact files, then confirm; nothing is preselected"}</span></header>
            <div className="space-category-grid">{scan.result.categories.length ? scan.result.categories.map((category) => {
              const previousSize = scan.previousSnapshot?.categories[category.id];
              const delta = previousSize === undefined ? null : category.size - previousSize;
              const advice = spaceCategoryAdvice(category.id, language);
              return <article key={category.id} className={`risk-${category.risk} ${cleanup.adviceCategoryId === category.id ? "active" : ""}`}>
                <div><strong>{spaceCategoryLabel(category.id, language)}</strong><span className="space-risk-badge">{riskLabel(category.risk)}</span></div>
                <b>{formatSize(category.size)}</b>
                <small>{category.fileCount.toLocaleString()} {language === "zh-CN" ? "个文件" : "files"}{delta !== null && delta !== 0 ? ` · ${language === "zh-CN" ? "较上次" : "vs last"} ${delta > 0 ? "+" : "−"}${formatSize(Math.abs(delta))}` : ""}</small>
                <p>{advice.summary}</p>
                <div className="space-category-actions"><button onClick={() => onShowAdvice(category)}>{language === "zh-CN" ? "查看建议" : "View advice"}</button>{advice.cleanable && <button className="cleanup" disabled={cleanup.loading} onClick={() => onPrepareCleanup(category)}>{language === "zh-CN" ? "复核清理" : "Review cleanup"}</button>}</div>
              </article>;
            }) : <span className="space-list-empty">{language === "zh-CN" ? "没有发现已知关注项" : "No known items found"}</span>}</div>
            {activeCategory && activeAdvice && <div className="space-advice-panel">
              <header><div><strong>{spaceCategoryLabel(activeCategory.id, language)}</strong><span className={`space-risk-badge risk-${activeCategory.risk}`}>{riskLabel(activeCategory.risk)}</span></div><button aria-label={text.close} onClick={onCloseAdvice}>×</button></header>
              <div className="space-advice-copy"><article><span>{language === "zh-CN" ? "判断" : "Assessment"}</span><p>{activeAdvice.summary}</p></article><article><span>{language === "zh-CN" ? "建议" : "Recommendation"}</span><p>{activeAdvice.action}</p></article><article><span>{language === "zh-CN" ? "注意" : "Caution"}</span><p>{activeAdvice.caution}</p></article></div>
              {!activeAdvice.cleanable && <div className="space-advice-protected">{language === "zh-CN" ? "为避免破坏系统或误删个人内容，此类别不提供直接清理按钮。" : "Direct cleanup is unavailable for this category to avoid system damage or personal data loss."}</div>}
              {activeAdvice.cleanable && !cleanup.preview && !cleanup.loading && <button className="space-prepare-cleanup" onClick={() => onPrepareCleanup(activeCategory)}>{language === "zh-CN" ? "扫描并列出可复核文件" : "Scan and list reviewable files"}</button>}
              {cleanup.loading && !cleanup.preview && <div className="space-cleanup-loading"><span>{language === "zh-CN" ? "正在生成清理预检清单…" : "Building cleanup preview…"}</span><div className="space-health-progress indeterminate"><i /></div></div>}
              {cleanup.error && <div className="space-scan-error"><strong>{language === "zh-CN" ? "无法完成清理预检" : "Cleanup preview failed"}</strong><span>{cleanup.error}</span></div>}
              {cleanup.message && <div className="space-cleanup-success">{cleanup.message}</div>}
              {cleanup.preview && <div className="space-cleanup-preview">
                <header><div><strong>{language === "zh-CN" ? "清理前复核" : "Review before cleanup"}</strong><span>{formatSize(cleanup.preview.totalBytes)} · {cleanup.preview.totalFiles.toLocaleString()} {language === "zh-CN" ? "个匹配文件" : "matching files"}</span></div><div><button onClick={() => onSelectCleanupPaths(filteredCleanupCandidates.map((item) => item.path))}>{language === "zh-CN" ? "选择当前结果" : "Select filtered"}</button><button onClick={() => onSelectCleanupPaths([])}>{language === "zh-CN" ? "清除选择" : "Clear"}</button></div></header>
                {cleanup.preview.truncated && <p className="space-cleanup-note">{language === "zh-CN" ? `为便于安全复核，仅列出最大的 ${cleanup.preview.candidates.length} 个文件；清理只作用于你明确勾选的文件。` : `For safe review, only the largest ${cleanup.preview.candidates.length} files are shown. Cleanup only affects checked files.`}</p>}
                <div className="space-cleanup-filters"><div><span>{language === "zh-CN" ? "按未修改时间" : "Not modified for"}</span>{(["all", "30", "90", "365"] as SpaceCleanupAge[]).map((age) => <button key={age} className={cleanup.age === age ? "active" : ""} onClick={() => onCleanupAgeChange(age)}>{age === "all" ? (language === "zh-CN" ? "全部" : "All") : age === "365" ? (language === "zh-CN" ? "1 年" : "1 year") : `${age} ${language === "zh-CN" ? "天" : "days"}`}</button>)}</div><strong>{filteredCleanupCandidates.length.toLocaleString()} {language === "zh-CN" ? "项" : "items"} · {formatSize(filteredCleanupBytes)}</strong></div>
                <div className="space-cleanup-list">{filteredCleanupCandidates.length ? filteredCleanupCandidates.map((item) => <div className="space-cleanup-row" key={item.path} title={item.path}><label><input type="checkbox" checked={cleanup.selected.has(item.path)} onChange={() => onToggleCleanup(item.path)} /><span><strong>{item.name}</strong><small>{item.path}</small><em>{language === "zh-CN" ? "修改于" : "Modified"} {formatDate(item.modifiedUnixSeconds, language)}</em></span></label><b>{formatSize(item.size)}</b><button aria-label={text.openLocation} title={text.openLocation} onClick={() => onRevealCleanup(item.path)}>↗</button></div>) : <span className="space-list-empty">{language === "zh-CN" ? "当前筛选下没有文件。" : "No files match this filter."}</span>}</div>
                <footer><div><strong>{cleanup.selected.size.toLocaleString()} {language === "zh-CN" ? "个已选" : "selected"}</strong><span>{formatSize(selectedCleanupBytes)}</span></div><button disabled={!cleanup.selected.size || cleanup.loading} onClick={onOpenCleanupReview}>{language === "zh-CN" ? "复核并继续" : "Review and continue"}</button></footer>
                {cleanup.confirmOpen && <div className="space-cleanup-confirm"><strong>{language === "zh-CN" ? "最后确认" : "Final confirmation"}</strong><p>{language === "zh-CN" ? `将把你选择的 ${cleanup.selected.size} 个文件（${formatSize(selectedCleanupBytes)}）移入 Windows 回收站，不会永久删除。` : `${cleanup.selected.size} selected file(s) (${formatSize(selectedCleanupBytes)}) will be moved to the Windows Recycle Bin, not permanently deleted.`}</p><label><input type="checkbox" checked={cleanup.acknowledged} onChange={(event) => onCleanupAcknowledgedChange(event.target.checked)} /><span>{language === "zh-CN" ? "我已查看上方文件名、路径和大小，并确认清理这些内容。" : "I reviewed the names, paths, and sizes above and confirm these items."}</span></label><div><button onClick={onCloseCleanupReview}>{text.cancel}</button><button className="primary" disabled={!cleanup.acknowledged || cleanup.loading} onClick={onConfirmCleanup}>{cleanup.loading ? (language === "zh-CN" ? "正在处理…" : "Processing…") : (language === "zh-CN" ? "确认移入回收站" : "Move to Recycle Bin")}</button></div></div>}
              </div>}
            </div>}
          </section>
          <SpaceRankings directories={scan.result.largestDirectories} files={scan.result.largestFiles} language={language} onOpenDirectory={onDrillDirectory} onOpenFile={onOpenItem} />
        </>}
      </div>
    </section>
  </div>;
}
