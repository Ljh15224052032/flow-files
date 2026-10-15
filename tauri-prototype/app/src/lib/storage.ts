import {
  FAVORITES_KEY, FAVORITE_COLLAPSE_KEY, MAX_UNDO_STEPS, OPERATION_TASKS_KEY,
  RECENT_PATHS_KEY, SAVED_SEARCHES_KEY, SEARCH_HISTORY_KEY, SESSION_KEY,
  SPACE_SCAN_SNAPSHOTS_KEY, UNDO_RETENTION_MS, UNDO_STACK_KEY,
} from "../constants";
import type {
  ConflictResolution, FavoriteItem, FolderTab, OperationIssue, SavedSearch, SearchDate, SearchHistoryItem,
  SearchKind, SearchProfile, SearchSize, SpaceScanResult, SpaceScanSnapshot, TransferTask,
  TransferTaskStatus, UndoAction, UndoRecord, ViewMode,
} from "../types";
import { labelForPath } from "./file-utils";

const OPERATION_ISSUE_CODES: OperationIssue["code"][] = ["accessDenied", "inUse", "diskFull", "pathTooLong", "network", "notFound", "other"];

function parseStoredOperationIssues(value: unknown): OperationIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): OperationIssue[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<OperationIssue>;
    if (typeof candidate.path !== "string" || !candidate.path.trim() || typeof candidate.message !== "string" || !OPERATION_ISSUE_CODES.includes(candidate.code as OperationIssue["code"])) return [];
    return [{ path: candidate.path, code: candidate.code as OperationIssue["code"], message: candidate.message.slice(0, 1000) }];
  });
}

export function readStoredFavorites() {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    const items = value.flatMap((item): FavoriteItem[] => {
      if (typeof item === "string" && item.length > 0) return [{ path: item, label: null, group: null }];
      if (item && typeof item === "object" && "path" in item && typeof item.path === "string" && item.path.length > 0) {
        return [{ path: item.path, label: "label" in item && typeof item.label === "string" && item.label.trim() ? item.label.trim() : null, group: "group" in item && typeof item.group === "string" && item.group.trim() ? item.group.trim() : null }];
      }
      return [];
    });
    return items.filter((item, index) => items.findIndex((candidate) => candidate.path.toLocaleLowerCase() === item.path.toLocaleLowerCase()) === index);
  } catch {
    return [];
  }
}

export function readCollapsedFavoriteGroups() {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITE_COLLAPSE_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((group): group is string => typeof group === "string") : []);
  } catch {
    return new Set<string>();
  }
}

export function readSpaceScanSnapshots(): Record<string, SpaceScanSnapshot> {
  return Object.fromEntries(Object.entries(readSpaceScanHistory()).flatMap(([root, history]) => history.length ? [[root, history[history.length - 1]]] : []));
}

const MAX_SPACE_SCAN_SNAPSHOTS = 12;

function parseSpaceScanSnapshot(value: unknown): SpaceScanSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SpaceScanSnapshot>;
  if (typeof candidate.root !== "string" || typeof candidate.capturedAt !== "number" || typeof candidate.totalSpace !== "number" || typeof candidate.availableSpace !== "number" || typeof candidate.scannedBytes !== "number" || !candidate.categories || typeof candidate.categories !== "object" || Array.isArray(candidate.categories)) return null;
  const categories = Object.fromEntries(Object.entries(candidate.categories).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0));
  return { root: candidate.root, capturedAt: candidate.capturedAt, totalSpace: candidate.totalSpace, availableSpace: candidate.availableSpace, scannedBytes: candidate.scannedBytes, categories };
}

export function readSpaceScanHistory(): Record<string, SpaceScanSnapshot[]> {
  try {
    const value = JSON.parse(localStorage.getItem(SPACE_SCAN_SNAPSHOTS_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([root, stored]) => {
      const candidates = Array.isArray(stored) ? stored : [stored];
      const history = candidates.map(parseSpaceScanSnapshot).filter((snapshot): snapshot is SpaceScanSnapshot => snapshot !== null).sort((left, right) => left.capturedAt - right.capturedAt).slice(-MAX_SPACE_SCAN_SNAPSHOTS);
      return history.length ? [[root, history]] : [];
    }));
  } catch {
    return {};
  }
}

export function snapshotForSpaceScan(result: SpaceScanResult): SpaceScanSnapshot {
  return {
    root: result.root,
    capturedAt: Date.now(),
    totalSpace: result.totalSpace,
    availableSpace: result.availableSpace,
    scannedBytes: result.scannedBytes,
    categories: Object.fromEntries(result.categories.map((category) => [category.id, category.size])),
  };
}

export function appendSpaceScanSnapshot(result: SpaceScanResult) {
  const histories = readSpaceScanHistory();
  const key = result.root.toLocaleLowerCase();
  const history = [...(histories[key] ?? []), snapshotForSpaceScan(result)].slice(-MAX_SPACE_SCAN_SNAPSHOTS);
  histories[key] = history;
  localStorage.setItem(SPACE_SCAN_SNAPSHOTS_KEY, JSON.stringify(histories));
  return history;
}

export function readStoredRecentPaths() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_PATHS_KEY) ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((path): path is string => typeof path === "string" && path.length > 0))].slice(0, 20) : [];
  } catch {
    return [];
  }
}

function readSearchProfile(value: unknown): SearchProfile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SearchProfile>;
  const kinds: SearchKind[] = ["all", "folders", "images", "documents", "videos", "audio", "archives"];
  const dates: SearchDate[] = ["any", "day", "week", "month", "year"];
  const sizes: SearchSize[] = ["any", "small", "medium", "large"];
  if (typeof candidate.query !== "string" || !kinds.includes(candidate.kind as SearchKind) || !dates.includes(candidate.date as SearchDate) || !sizes.includes(candidate.size as SearchSize)) return null;
  return { query: candidate.query.slice(0, 240), kind: candidate.kind as SearchKind, date: candidate.date as SearchDate, size: candidate.size as SearchSize };
}

export function readStoredSearchHistory(): SearchHistoryItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): SearchHistoryItem[] => {
      const profile = readSearchProfile(item);
      const usedAt = item && typeof item === "object" && "usedAt" in item && typeof item.usedAt === "number" ? item.usedAt : 0;
      return profile ? [{ ...profile, usedAt }] : [];
    }).slice(0, 12);
  } catch {
    return [];
  }
}

export function readStoredSavedSearches(): SavedSearch[] {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_SEARCHES_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): SavedSearch[] => {
      const profile = readSearchProfile(item);
      if (!profile || !item || typeof item !== "object") return [];
      const candidate = item as Partial<SavedSearch>;
      return typeof candidate.id === "string" && typeof candidate.name === "string" ? [{ ...profile, id: candidate.id, name: candidate.name.slice(0, 120) }] : [];
    }).slice(0, 20);
  } catch {
    return [];
  }
}

export function readStoredUndoStack(): UndoRecord[] {
  try {
    const value = JSON.parse(localStorage.getItem(UNDO_STACK_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    const now = Date.now();
    return value.flatMap((item): UndoRecord[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<UndoRecord>;
      if (typeof candidate.id !== "string" || typeof candidate.label !== "string" || typeof candidate.createdAt !== "number" || now - candidate.createdAt > UNDO_RETENTION_MS || !candidate.action || typeof candidate.action !== "object") return [];
      const action = candidate.action as UndoAction;
      if (action.kind === "deleteCreated" && Array.isArray(action.paths) && action.paths.every((path) => typeof path === "string")) return [{ id: candidate.id, label: candidate.label.slice(0, 160), createdAt: candidate.createdAt, action: { kind: action.kind, paths: action.paths } }];
      if (action.kind === "restoreTrash" && Array.isArray(action.ids) && action.ids.every((id) => typeof id === "string")) return [{ id: candidate.id, label: candidate.label.slice(0, 160), createdAt: candidate.createdAt, action: { kind: action.kind, ids: action.ids } }];
      if (action.kind === "move" && Array.isArray(action.pairs) && action.pairs.every((pair) => pair && typeof pair.from === "string" && typeof pair.to === "string")) return [{ id: candidate.id, label: candidate.label.slice(0, 160), createdAt: candidate.createdAt, action: { kind: action.kind, pairs: action.pairs } }];
      return [];
    }).slice(-MAX_UNDO_STEPS);
  } catch {
    return [];
  }
}

export function readStoredOperationTasks(): TransferTask[] {
  try {
    const value = JSON.parse(localStorage.getItem(OPERATION_TASKS_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    const statuses: TransferTaskStatus[] = ["queued", "running", "paused", "completed", "cancelled", "failed"];
    return value.flatMap((item): TransferTask[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<TransferTask>;
      if (typeof candidate.jobId !== "string" || (candidate.mode !== "copy" && candidate.mode !== "move") || !Array.isArray(candidate.sourcePaths) || !candidate.sourcePaths.every((path) => typeof path === "string") || typeof candidate.destination !== "string" || !statuses.includes(candidate.status as TransferTaskStatus)) return [];
      const interrupted = candidate.status === "queued" || candidate.status === "running" || candidate.status === "paused";
      return [{
        jobId: candidate.jobId, mode: candidate.mode, sourcePaths: candidate.sourcePaths, destination: candidate.destination,
        conflict: candidate.conflict === "replace" || candidate.conflict === "keepBoth" ? candidate.conflict : "skip",
        conflictResolutions: Array.isArray(candidate.conflictResolutions) ? candidate.conflictResolutions.filter((resolution): resolution is ConflictResolution => !!resolution && typeof resolution.source === "string" && ["replace", "skip", "keepBoth"].includes(resolution.action)) : [],
        status: interrupted ? "failed" : candidate.status as TransferTaskStatus,
        queuedAt: typeof candidate.queuedAt === "number" ? candidate.queuedAt : Date.now(), startedAt: typeof candidate.startedAt === "number" ? candidate.startedAt : Date.now(), finishedAt: interrupted ? Date.now() : typeof candidate.finishedAt === "number" ? candidate.finishedAt : null,
        paused: false, processedBytes: typeof candidate.processedBytes === "number" ? candidate.processedBytes : 0, totalBytes: typeof candidate.totalBytes === "number" ? candidate.totalBytes : 0,
        completedItems: typeof candidate.completedItems === "number" ? candidate.completedItems : 0, totalItems: typeof candidate.totalItems === "number" ? candidate.totalItems : candidate.sourcePaths.length,
        currentName: typeof candidate.currentName === "string" ? candidate.currentName : "", phase: candidate.phase === "transfer" ? "transfer" : "scanning",
        scannedItems: typeof candidate.scannedItems === "number" ? candidate.scannedItems : 0, scannedBytes: typeof candidate.scannedBytes === "number" ? candidate.scannedBytes : 0, speed: 0,
        issues: parseStoredOperationIssues(candidate.issues), error: interrupted ? "Flow Files closed before this task completed." : typeof candidate.error === "string" ? candidate.error.slice(0, 1000) : null,
        recoveredFromRestart: interrupted || candidate.recoveredFromRestart === true,
      }];
    }).slice(-20);
  } catch {
    return [];
  }
}

export function writeStoredOperationTasks(tasks: TransferTask[]) {
  localStorage.setItem(OPERATION_TASKS_KEY, JSON.stringify(tasks.slice(-20)));
}

export function readStoredSession(): { tabs: FolderTab[]; activeTabId: number } | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as { tabs?: unknown[]; activeTabId?: unknown } | null;
    if (!value || !Array.isArray(value.tabs) || value.tabs.length === 0) return null;
    const rawTabs = value.tabs.filter((tab): tab is FolderTab => {
      const candidate = tab as Partial<FolderTab>;
      return typeof candidate.id === "number" && typeof candidate.path === "string" && Array.isArray(candidate.history);
    }).slice(0, 12);
    if (!rawTabs.length) return null;
    const activeIndex = Math.max(0, rawTabs.findIndex((tab) => tab.id === value.activeTabId));
    const seed = Date.now();
    const tabs = rawTabs.map((tab, index) => {
      const history = tab.history.filter((path): path is string => typeof path === "string" && path.length > 0).slice(-30);
      const safeHistory = history.length ? history : [tab.path];
      const storedViewMode: ViewMode = tab.viewMode === "compact" || tab.viewMode === "grid" ? tab.viewMode : "comfortable";
      const storedSelection = Array.isArray(tab.selectedPaths) ? tab.selectedPaths.filter((path): path is string => typeof path === "string").slice(0, 500) : [];
      return { ...tab, id: seed + index, label: typeof tab.label === "string" ? tab.label : labelForPath(tab.path), pinned: !!tab.pinned, history: safeHistory, historyIndex: Math.max(0, Math.min(Number(tab.historyIndex) || 0, safeHistory.length - 1)), scrollTop: Math.max(0, Number(tab.scrollTop) || 0), viewMode: storedViewMode, selectedPaths: storedSelection };
    });
    return { tabs, activeTabId: tabs[activeIndex]?.id ?? tabs[0].id };
  } catch {
    return null;
  }
}
