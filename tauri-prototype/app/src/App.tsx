import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type UIEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import brandIcon from "../src-tauri/icons/flow-files.svg";
import "./App.css";
import {
  CLAUDE_FULL_ACCESS_KEY, CLAUDE_PROVIDER_KEY, COLUMN_WIDTHS_KEY, DEFAULT_COLUMN_WIDTHS,
  DEFAULT_LIST_VIEWPORT_HEIGHT, FAVORITES_KEY, FAVORITE_COLLAPSE_KEY, LANGUAGE_KEY,
  MAX_CACHED_FILE_ICONS, MAX_CACHED_THUMBNAILS, MAX_UNDO_STEPS, OPERATION_RATE_LIMIT_KEY,
  OPERATION_RATE_LIMITS,
  PREVIEW_PANE_KEY, RECENT_PATHS_KEY, SAVED_SEARCHES_KEY, SEARCH_EVERYTHING_KEY,
  SEARCH_HISTORY_KEY, SESSION_KEY, SHOW_EXTENSIONS_KEY, SHOW_HIDDEN_KEY, SORT_DIRECTION_KEY,
  SORT_KEY, UNDO_RETENTION_MS, UNDO_STACK_KEY,
  VIEW_MODE_KEY,
} from "./constants";
import type {
  BatchRenameDraft, ClaudeCredentialStatus, ClaudeDiagnostic, ClaudeProvider, ClipboardPayload,
  ClipboardState, ColumnWidths, ConflictChoice, ConflictEntry, ConflictResolution, DeleteRequest,
  DirectoryChanged, DirectoryListing, DirectoryLoadProgress, DirectoryStatus, DragGhost,
  DuplicateGroup, DuplicateScanProgress, DuplicateScanResult, DuplicateSizeFilter,
  DuplicateTypeFilter, EverythingStatus, ExternalDragResult, ExternalOpenTarget,
  FavoriteItem, FileEntry, FileOperationResult, FilePreview, FolderIntegrationStatus,
  FolderSizeProgress, FolderSizeResult, FolderSizeState, FolderTab, Location, OperationIssue,
  OperationScanProgress, PathSuggestion, PendingTransfer, ResizableColumn, RetryTransfer,
  RunningOperation, SavedSearch, SearchDate, SearchHistoryItem, SearchKind, SearchProgress,
  SearchProfile, SearchResult, SearchResultMeta, SearchSize, SelectionBox, SortDirection, SortKey,
  SpaceScanCategory,
  SpaceCleanupAge, SpaceCleanupPreview, SpaceScanItem, SpaceScanProgress, SpaceScanResult,
  SpaceScanSnapshot, Thumbnail, TransferTask, UiLanguage, UndoAction,
  UndoRecord, ViewMode,
} from "./types";
import {
  batchNameFor, directoryKindForPath, displayName, iconKindFor, isThumbnailCandidate,
  joinWindowsPath, labelForPath, localizedLocation, nativeDropMode, parentDirectory, pathCrumbs,
  sortEntriesForView, typeLabelFor,
} from "./lib/file-utils";
import {
  appendSpaceScanSnapshot, readCollapsedFavoriteGroups, readSpaceScanHistory, readStoredFavorites,
  readStoredOperationTasks, readStoredRecentPaths, readStoredSavedSearches,
  readStoredSearchHistory, readStoredSession, readStoredUndoStack, writeStoredOperationTasks,
} from "./lib/storage";
import {
  ActionsIcon, ChevronIcon, EntryIcon, FolderGlyph, SettingsIcon, SortIcon, SpaceHealthIcon,
  ViewIcon,
} from "./components/Icons";
import { formatDate, formatSize } from "./lib/format";
import { PreviewContent } from "./components/PreviewContent";
import { TaskCenter } from "./components/TaskCenter";
import { ConflictDialog, DeleteConfirmationDialog, OperationIssuesDialog } from "./components/OperationDialogs";
import { StatusBar } from "./components/StatusBar";
import { SettingsDialog } from "./components/SettingsDialog";
import { SearchPanel } from "./components/SearchPanel";
import { SpaceHistoryCard } from "./components/SpaceHistoryCard";
import { SpaceCapacityCard } from "./components/SpaceCapacityCard";
import { SpaceRankings } from "./components/SpaceRankings";
import { UI_COPY } from "./localization";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { prioritizeQueuedTask, retryableTaskPaths, type TaskFilter } from "./lib/task-utils";
import { buildSpaceReport } from "./lib/space-report";
import { duplicateFileMatchesType, duplicateKeepReason, spaceCategoryAdvice, spaceCategoryLabel, suggestedDuplicateKeep } from "./lib/space-utils";
import { nextAvailabilityRetry, unavailableLocationCopy } from "./lib/network-utils";
import { searchProfileLabel, searchProfilesMatch } from "./lib/search-utils";

function readStoredSortKey(): SortKey {
  const stored = localStorage.getItem(SORT_KEY);
  return stored === "modified" || stored === "type" || stored === "size" ? stored : "name";
}

function readStoredViewMode(): ViewMode {
  const stored = localStorage.getItem(VIEW_MODE_KEY);
  return stored === "compact" || stored === "grid" ? stored : "comfortable";
}

function readStoredColumnWidths(): ColumnWidths {
  try {
    const stored = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_KEY) ?? "null") as Partial<ColumnWidths> | null;
    return {
      modified: Math.max(110, Math.min(320, Number(stored?.modified) || DEFAULT_COLUMN_WIDTHS.modified)),
      type: Math.max(90, Math.min(260, Number(stored?.type) || DEFAULT_COLUMN_WIDTHS.type)),
      size: Math.max(70, Math.min(180, Number(stored?.size) || DEFAULT_COLUMN_WIDTHS.size)),
    };
  } catch {
    return DEFAULT_COLUMN_WIDTHS;
  }
}

function App() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [tabs, setTabs] = useState<FolderTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [address, setAddress] = useState("");
  const [addressEditing, setAddressEditing] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<PathSuggestion[]>([]);
  const [addressSuggestionIndex, setAddressSuggestionIndex] = useState(-1);
  const [recentPaths, setRecentPaths] = useState<string[]>(readStoredRecentPaths);
  const [directoryEventsReady, setDirectoryEventsReady] = useState(false);
  const [startupComplete, setStartupComplete] = useState(false);
  const [folderSize, setFolderSize] = useState<FolderSizeState | null>(null);
  const [unavailableLocation, setUnavailableLocation] = useState<DirectoryStatus | null>(null);
  const [unavailablePaths, setUnavailablePaths] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchKind, setSearchKind] = useState<SearchKind>("all");
  const [searchDate, setSearchDate] = useState<SearchDate>("any");
  const [searchSize, setSearchSize] = useState<SearchSize>("any");
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>(readStoredSearchHistory);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(readStoredSavedSearches);
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(null);
  const [searchResultMeta, setSearchResultMeta] = useState<SearchResultMeta | null>(null);
  const [preferEverything, setPreferEverything] = useState(() => localStorage.getItem(SEARCH_EVERYTHING_KEY) !== "false");
  const [everythingStatus, setEverythingStatus] = useState<EverythingStatus | null>(null);
  const [everythingStatusBusy, setEverythingStatusBusy] = useState(false);
  const [everythingStatusError, setEverythingStatusError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(DEFAULT_LIST_VIEWPORT_HEIGHT);
  const [listViewportWidth, setListViewportWidth] = useState(900);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState(() => localStorage.getItem(LANGUAGE_KEY) === "en" ? "Preparing your folders…" : "正在准备文件夹…");
  const [thumbnailCache, setThumbnailCache] = useState<Record<string, string>>({});
  const [fileIconCache, setFileIconCache] = useState<Record<string, string>>({});
  const [showExtensions, setShowExtensions] = useState(() => localStorage.getItem(SHOW_EXTENSIONS_KEY) !== "false");
  const [showHidden, setShowHidden] = useState(() => localStorage.getItem(SHOW_HIDDEN_KEY) === "true");
  const [favorites, setFavorites] = useState<FavoriteItem[]>(readStoredFavorites);
  const [favoriteEditingPath, setFavoriteEditingPath] = useState<string | null>(null);
  const [favoriteLabelValue, setFavoriteLabelValue] = useState("");
  const [favoriteGroupValue, setFavoriteGroupValue] = useState("");
  const [collapsedFavoriteGroups, setCollapsedFavoriteGroups] = useState<Set<string>>(readCollapsedFavoriteGroups);
  const [favoriteDraggingPath, setFavoriteDraggingPath] = useState<string | null>(null);
  const [favoriteDropPath, setFavoriteDropPath] = useState<string | null>(null);
  const [treeChildren, setTreeChildren] = useState<Record<string, FileEntry[]>>({});
  const [expandedTreePaths, setExpandedTreePaths] = useState<Set<string>>(() => new Set());
  const [treeLoadingPaths, setTreeLoadingPaths] = useState<Set<string>>(() => new Set());
  const [sortKey, setSortKey] = useState<SortKey>(readStoredSortKey);
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => localStorage.getItem(SORT_DIRECTION_KEY) === "descending" ? "descending" : "ascending");
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(readStoredColumnWidths);
  const [openMenu, setOpenMenu] = useState<"new" | "terminal" | "sort" | "view" | "actions" | null>(null);
  const [actionsMenuStyle, setActionsMenuStyle] = useState<React.CSSProperties>({});
  const [language, setLanguage] = useState<UiLanguage>(() => localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "zh-CN");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { appUpdate, appUpdateChecked, appUpdateBusy, appUpdateProgress, appUpdateError, checkForUpdates, installAvailableUpdate } = useAppUpdater(language);
  const [folderIntegration, setFolderIntegration] = useState<FolderIntegrationStatus | null>(null);
  const [folderIntegrationBusy, setFolderIntegrationBusy] = useState(false);
  const [folderIntegrationError, setFolderIntegrationError] = useState<string | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderIntegrationStatus | null>(null);
  const [folderContextMenuBusy, setFolderContextMenuBusy] = useState(false);
  const [folderContextMenuError, setFolderContextMenuError] = useState<string | null>(null);
  const [spaceHealthOpen, setSpaceHealthOpen] = useState(false);
  const [spaceScanDrive, setSpaceScanDrive] = useState("C:\\");
  const [spaceScanRoot, setSpaceScanRoot] = useState("C:\\");
  const [spaceScanning, setSpaceScanning] = useState(false);
  const [spaceScanProgress, setSpaceScanProgress] = useState<SpaceScanProgress | null>(null);
  const [spaceScanResult, setSpaceScanResult] = useState<SpaceScanResult | null>(null);
  const [spacePreviousSnapshot, setSpacePreviousSnapshot] = useState<SpaceScanSnapshot | null>(null);
  const [spaceSnapshotHistory, setSpaceSnapshotHistory] = useState<SpaceScanSnapshot[]>([]);
  const [spaceScanError, setSpaceScanError] = useState<string | null>(null);
  const [spaceAdviceCategoryId, setSpaceAdviceCategoryId] = useState<string | null>(null);
  const [spaceCleanupPreview, setSpaceCleanupPreview] = useState<SpaceCleanupPreview | null>(null);
  const [spaceCleanupLoading, setSpaceCleanupLoading] = useState(false);
  const [spaceCleanupSelected, setSpaceCleanupSelected] = useState<Set<string>>(() => new Set());
  const [spaceCleanupAge, setSpaceCleanupAge] = useState<SpaceCleanupAge>("all");
  const [spaceCleanupConfirmOpen, setSpaceCleanupConfirmOpen] = useState(false);
  const [spaceCleanupAcknowledged, setSpaceCleanupAcknowledged] = useState(false);
  const [spaceCleanupMessage, setSpaceCleanupMessage] = useState<string | null>(null);
  const [spaceCleanupError, setSpaceCleanupError] = useState<string | null>(null);
  const [duplicateScanning, setDuplicateScanning] = useState(false);
  const [duplicateProgress, setDuplicateProgress] = useState<DuplicateScanProgress | null>(null);
  const [duplicateResult, setDuplicateResult] = useState<DuplicateScanResult | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [duplicateCleanupSelected, setDuplicateCleanupSelected] = useState<Set<string>>(() => new Set());
  const [duplicateCleanupConfirmOpen, setDuplicateCleanupConfirmOpen] = useState(false);
  const [duplicateCleanupAcknowledged, setDuplicateCleanupAcknowledged] = useState(false);
  const [duplicateCleanupBusy, setDuplicateCleanupBusy] = useState(false);
  const [duplicateCleanupMessage, setDuplicateCleanupMessage] = useState<string | null>(null);
  const [duplicateFilterQuery, setDuplicateFilterQuery] = useState("");
  const [duplicateSizeFilter, setDuplicateSizeFilter] = useState<DuplicateSizeFilter>("all");
  const [duplicateTypeFilter, setDuplicateTypeFilter] = useState<DuplicateTypeFilter>("all");
  const [claudeProvider, setClaudeProvider] = useState<ClaudeProvider>(() => localStorage.getItem(CLAUDE_PROVIDER_KEY) === "anthropic" ? "anthropic" : "deepseek");
  const [claudeFullAccess, setClaudeFullAccess] = useState(() => localStorage.getItem(CLAUDE_FULL_ACCESS_KEY) !== "false");
  const [claudeCredential, setClaudeCredential] = useState<ClaudeCredentialStatus | null>(null);
  const [claudeApiKeyDraft, setClaudeApiKeyDraft] = useState("");
  const [claudeCredentialBusy, setClaudeCredentialBusy] = useState(false);
  const [claudeCredentialError, setClaudeCredentialError] = useState<string | null>(null);
  const [claudeDiagnostic, setClaudeDiagnostic] = useState<ClaudeDiagnostic | null>(null);
  const [claudeDiagnosticBusy, setClaudeDiagnosticBusy] = useState(false);
  const [previewPaneOpen, setPreviewPaneOpen] = useState(() => localStorage.getItem(PREVIEW_PANE_KEY) === "true");
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [quickPreviewOpen, setQuickPreviewOpen] = useState(false);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [undoStack, setUndoStack] = useState<UndoRecord[]>(readStoredUndoStack);
  const [undoBusy, setUndoBusy] = useState(false);
  const [operation, setOperation] = useState<RunningOperation | null>(null);
  const [operationTasks, setOperationTasks] = useState<TransferTask[]>(readStoredOperationTasks);
  const [operationRateLimit, setOperationRateLimit] = useState(() => {
    const stored = Number(localStorage.getItem(OPERATION_RATE_LIMIT_KEY));
    return OPERATION_RATE_LIMITS.some((value) => value === stored) ? stored : 0;
  });
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [operationIssues, setOperationIssues] = useState<OperationIssue[]>([]);
  const [retryTransfer, setRetryTransfer] = useState<RetryTransfer | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const [applyConflictToRemaining, setApplyConflictToRemaining] = useState(true);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<number | null>(null);
  const [tabDropId, setTabDropId] = useState<number | null>(null);
  const [tabDropSide, setTabDropSide] = useState<"before" | "after">("before");
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [batchRenameOpen, setBatchRenameOpen] = useState(false);
  const [batchRenameDraft, setBatchRenameDraft] = useState<BatchRenameDraft>({ find: "", replace: "", prefix: "", suffix: "", addNumbers: false, startNumber: 1 });
  const [batchRenameError, setBatchRenameError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; kind: "entry" | "background" } | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: number } | null>(null);
  const [closedTabs, setClosedTabs] = useState<FolderTab[]>([]);
  const [historyMenu, setHistoryMenu] = useState<{ x: number; y: number; items: { index: number; path: string }[] } | null>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const pointerDragRef = useRef<{ paths: string[]; startX: number; startY: number; target: string | null; active: boolean; dropAllowed: boolean } | null>(null);
  const marqueeRef = useRef<(SelectionBox & { pointerId: number; initialPaths: Set<string>; clientX: number; clientY: number; animationFrame: number | null }) | null>(null);
  const nativeDropPathsRef = useRef<string[]>([]);
  const tabHoverRef = useRef<{ path: string; timer: number } | null>(null);
  const tabReorderRef = useRef<{ tabId: number; startX: number; startY: number; active: boolean; targetId: number | null; side: "before" | "after" } | null>(null);
  const suppressTabClickRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const startupStartedRef = useRef(false);
  const tabsRef = useRef<FolderTab[]>([]);
  const externalTabSeedRef = useRef(0);
  const searchJobIdRef = useRef<string | null>(null);
  const directoryLoadJobIdRef = useRef<string | null>(null);
  const thumbnailJobIdRef = useRef<string | null>(null);
  const listingRef = useRef<DirectoryListing | null>(null);
  const addressSuggestionRequestRef = useRef(0);
  const folderSizeJobIdRef = useRef<string | null>(null);
  const spaceScanJobIdRef = useRef<string | null>(null);
  const duplicateScanJobIdRef = useRef<string | null>(null);
  const availabilityCheckRef = useRef(false);
  const backgroundAvailabilityCheckRef = useRef(false);
  const unavailablePathsRef = useRef<Set<string>>(new Set());
  const directoryStatusRequestsRef = useRef<Map<string, Promise<DirectoryStatus>>>(new Map());
  const availabilityRetryRef = useRef<Map<string, { failures: number; nextAt: number }>>(new Map());
  const unavailableLocationRef = useRef<DirectoryStatus | null>(null);
  const previewRequestRef = useRef(0);
  const operationExecutorRef = useRef<string | null>(null);
  const operationTasksRef = useRef(operationTasks);
  const text = UI_COPY[language];
  const latestUndo = undoStack[undoStack.length - 1] ?? null;
  const activeTaskCount = operationTasks.filter((task) => ["queued", "running", "paused"].includes(task.status)).length;
  const recoveredTaskCount = operationTasks.filter((task) => task.recoveredFromRestart).length;
  const undoAction = latestUndo?.action ?? null;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const contextTab = tabContextMenu ? tabs.find((tab) => tab.id === tabContextMenu.tabId) ?? null : null;
  const currentLocation = locations.find((location) => location.path.toLocaleLowerCase() === listing?.path.toLocaleLowerCase());
  const unavailableCopy = unavailableLocation ? unavailableLocationCopy(unavailableLocation, language) : null;
  const currentLabel = searchResults ? text.searchResults : currentLocation ? localizedLocation(currentLocation.label, language) : listing ? labelForPath(listing.path) : text.loading;
  const crumbs = listing ? pathCrumbs(listing.path) : [];
  const currentIsFavorite = !!listing && favorites.some((favorite) => favorite.path.toLocaleLowerCase() === listing.path.toLocaleLowerCase());
  const favoriteSections = useMemo(() => {
    const sections = new Map<string, FavoriteItem[]>();
    for (const favorite of favorites) {
      const group = favorite.group?.trim() ?? "";
      sections.set(group, [...(sections.get(group) ?? []), favorite]);
    }
    return [...sections.entries()];
  }, [favorites]);
  const treeRoots = useMemo(() => {
    const home = locations.find((location) => location.label === "Home");
    const drives = locations.filter((location) => /^[A-Za-z]:\\$/.test(location.path));
    const roots = home ? [home, ...drives] : drives;
    return roots.filter((location, index) => roots.findIndex((candidate) => candidate.path.toLocaleLowerCase() === location.path.toLocaleLowerCase()) === index);
  }, [locations]);

  useEffect(() => {
    listingRef.current = listing;
  }, [listing]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    unavailableLocationRef.current = unavailableLocation;
  }, [unavailableLocation]);

  useEffect(() => {
    unavailablePathsRef.current = unavailablePaths;
  }, [unavailablePaths]);

  function rememberPath(path: string) {
    setRecentPaths((current) => {
      const normalized = path.toLocaleLowerCase();
      const next = [path, ...current.filter((candidate) => candidate.toLocaleLowerCase() !== normalized)].slice(0, 20);
      localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function mergeAvailableLocations(latest: Location[]) {
    setLocations((current) => {
      const latestPaths = new Set(latest.map((location) => location.path.toLocaleLowerCase()));
      const disconnectedDrives = current
        .filter((location) => /^[A-Za-z]:\\$/.test(location.path) && !latestPaths.has(location.path.toLocaleLowerCase()))
        .map((location) => ({ ...location, totalSpace: null, availableSpace: null, isAvailable: false }));
      return [...latest, ...disconnectedDrives];
    });
  }

  function markPathAvailability(path: string, available: boolean) {
    const key = path.toLocaleLowerCase();
    setUnavailablePaths((current) => {
      if (current.has(key) === !available) return current;
      const next = new Set(current);
      if (available) next.delete(key); else next.add(key);
      unavailablePathsRef.current = next;
      return next;
    });
  }

  function checkDirectoryStatusWithTimeout(path: string, timeoutMs = 4_000): Promise<DirectoryStatus> {
    const key = path.toLocaleLowerCase();
    let request = directoryStatusRequestsRef.current.get(key);
    if (!request) {
      const base = invoke<DirectoryStatus>("check_directory_status", { path }).catch(() => ({ path, available: false, kind: directoryKindForPath(path), reason: "unknown" as const }));
      request = base.finally(() => {
        if (directoryStatusRequestsRef.current.get(key) === request) directoryStatusRequestsRef.current.delete(key);
      });
      directoryStatusRequestsRef.current.set(key, request);
    }
    return new Promise((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ path, available: false, kind: directoryKindForPath(path), reason: "timeout" });
      }, timeoutMs);
      request!.then((result) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(result);
      });
    });
  }

  function updateAvailabilityRetry(status: DirectoryStatus) {
    const key = status.path.toLocaleLowerCase();
    if (status.available) {
      availabilityRetryRef.current.delete(key);
      return;
    }
    const previous = availabilityRetryRef.current.get(key)?.failures ?? 0;
    availabilityRetryRef.current.set(key, nextAvailabilityRetry(previous));
  }

  useEffect(() => {
    if (!addressEditing) {
      setAddressSuggestions([]);
      setAddressSuggestionIndex(-1);
      return;
    }
    const requestId = ++addressSuggestionRequestRef.current;
    const timer = window.setTimeout(() => {
      void invoke<PathSuggestion[]>("suggest_paths", { input: address, recentPaths })
        .then((suggestions) => {
          if (requestId !== addressSuggestionRequestRef.current) return;
          setAddressSuggestions(suggestions);
          setAddressSuggestionIndex(-1);
        })
        .catch(() => {
          if (requestId === addressSuggestionRequestRef.current) setAddressSuggestions([]);
        });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [addressEditing, address, recentPaths]);

  useEffect(() => () => {
    const directoryJobId = directoryLoadJobIdRef.current;
    const thumbnailJobId = thumbnailJobIdRef.current;
    const folderSizeJobId = folderSizeJobIdRef.current;
    if (directoryJobId) void invoke("cancel_directory_load", { jobId: directoryJobId }).catch(() => undefined);
    if (thumbnailJobId) void invoke("cancel_thumbnail_job", { jobId: thumbnailJobId }).catch(() => undefined);
    if (folderSizeJobId) void invoke("cancel_folder_size", { jobId: folderSizeJobId }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!directoryEventsReady || startupStartedRef.current) return;
    startupStartedRef.current = true;
    let disposed = false;
    const loadStartupDirectory = async (path: string) => {
      const previousJobId = directoryLoadJobIdRef.current;
      if (previousJobId) void invoke("cancel_directory_load", { jobId: previousJobId }).catch(() => undefined);
      const jobId = crypto.randomUUID();
      directoryLoadJobIdRef.current = jobId;
      setIsLoading(true);
      setListing({ path, entries: [], folderCount: 0, fileCount: 0 });
      setAddress(path);
      setStatus(language === "zh-CN" ? "正在恢复上次打开的文件夹…" : "Restoring your last folder…");
      try {
        const result = await invoke<DirectoryListing>("list_directory_progressive", { jobId, path });
        if (disposed || directoryLoadJobIdRef.current !== jobId) throw new Error("Directory loading cancelled.");
        return result;
      } finally {
        if (directoryLoadJobIdRef.current === jobId) {
          directoryLoadJobIdRef.current = null;
          setIsLoading(false);
        }
      }
    };
    void (async () => {
      try {
        const availableLocations = await invoke<Location[]>("get_locations");
        if (disposed) return;
        setLocations(availableLocations);
        const initial = availableLocations[0];
        if (!initial) throw new Error("No accessible folders were found.");
        const storedSession = readStoredSession();
        let restoredTabs = storedSession?.tabs ?? [];
        let restoredActiveId = storedSession?.activeTabId ?? null;
        let restoredActive = restoredTabs.find((tab) => tab.id === restoredActiveId) ?? null;
        let nextListing: DirectoryListing;
        let startupUnavailable: DirectoryStatus | null = null;
        if (restoredActive) {
          try {
            nextListing = await loadStartupDirectory(restoredActive.path);
          } catch {
            if (disposed) return;
            const path = restoredActive.path;
            startupUnavailable = { path, available: false, kind: path.startsWith("\\\\") ? "network" : /^[A-Za-z]:/.test(path) ? "drive" : "folder", reason: "unknown" };
            nextListing = { path, entries: [], folderCount: 0, fileCount: 0 };
            unavailableLocationRef.current = startupUnavailable;
            setUnavailableLocation(startupUnavailable);
            markPathAvailability(path, false);
          }
        } else {
          const initialTab: FolderTab = { id: Date.now(), path: initial.path, label: initial.label, pinned: true, history: [initial.path], historyIndex: 0, scrollTop: 0, viewMode: readStoredViewMode(), selectedPaths: [] };
          restoredTabs = [initialTab];
          restoredActiveId = initialTab.id;
          restoredActive = initialTab;
          nextListing = await loadStartupDirectory(initial.path);
        }
        if (disposed) return;
        setTabs(restoredTabs);
        setActiveTabId(restoredActiveId);
        setListing(nextListing);
        setAddress(nextListing.path);
        if (restoredActive) {
          const existingPaths = new Set(nextListing.entries.map((entry) => entry.path));
          const restoredSelection = restoredActive.selectedPaths.filter((path) => existingPaths.has(path));
          setViewMode(restoredActive.viewMode);
          setSelectedPaths(new Set(restoredSelection));
          setSelected(nextListing.entries.find((entry) => entry.path === restoredSelection[0]) ?? null);
          setScrollTop(restoredActive.scrollTop);
          window.requestAnimationFrame(() => { if (fileListRef.current) fileListRef.current.scrollTop = restoredActive!.scrollTop; });
        }
        rememberPath(nextListing.path);
        setStatus(startupUnavailable
          ? (language === "zh-CN" ? "上次打开的位置暂时不可用，正在等待恢复…" : "The last location is unavailable. Waiting for it to return…")
          : (language === "zh-CN" ? `${nextListing.folderCount} 个文件夹 · ${nextListing.fileCount} 个文件` : `${nextListing.folderCount} folders · ${nextListing.fileCount} files`));
        sessionReadyRef.current = true;
      } catch (error) {
        if (!disposed) setStatus(language === "zh-CN" ? `无法启动文件浏览器：${String(error)}` : `Could not start the file browser: ${String(error)}`);
      } finally {
        if (!disposed) setStartupComplete(true);
      }
    })();
    return () => {
      disposed = true;
      startupStartedRef.current = false;
    };
  }, [directoryEventsReady]);

  useEffect(() => {
    if (!sessionReadyRef.current || !tabs.length || activeTabId === null) return;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ tabs, activeTabId }));
  }, [tabs, activeTabId]);

  useEffect(() => {
    const timer = window.setTimeout(() => localStorage.setItem(UNDO_STACK_KEY, JSON.stringify(undoStack)), 150);
    return () => window.clearTimeout(timer);
  }, [undoStack]);

  useEffect(() => {
    operationTasksRef.current = operationTasks;
    const timer = window.setTimeout(() => writeStoredOperationTasks(operationTasks), 300);
    return () => window.clearTimeout(timer);
  }, [operationTasks]);

  useEffect(() => {
    const flushOperationTasks = () => writeStoredOperationTasks(operationTasksRef.current);
    window.addEventListener("pagehide", flushOperationTasks);
    window.addEventListener("beforeunload", flushOperationTasks);
    return () => {
      window.removeEventListener("pagehide", flushOperationTasks);
      window.removeEventListener("beforeunload", flushOperationTasks);
    };
  }, []);

  useEffect(() => {
    if (!sessionReadyRef.current || activeTabId === null) return;
    const timer = window.setTimeout(() => {
      setTabs((current) => current.map((tab) => tab.id === activeTabId ? { ...tab, scrollTop, viewMode, selectedPaths: [...selectedPaths] } : tab));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [activeTabId, scrollTop, viewMode, selectedPaths]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void invoke<Location[]>("get_locations").then(mergeAvailableLocations).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    if (listing) setStatus(language === "zh-CN" ? `${listing.folderCount} 个文件夹 · ${listing.fileCount} 个文件` : `${listing.folderCount} folders · ${listing.fileCount} files`);
  }, [language]);

  useEffect(() => {
    void invoke<ClaudeCredentialStatus>("get_claude_credential_status")
      .then(setClaudeCredential)
      .catch((error) => setClaudeCredentialError(String(error)));
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    setEverythingStatusBusy(true);
    setEverythingStatusError(null);
    void invoke<EverythingStatus>("get_everything_status")
      .then(setEverythingStatus)
      .catch((error) => setEverythingStatusError(String(error)))
      .finally(() => setEverythingStatusBusy(false));
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => {
    if (!deleteRequest) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDeleteRequest(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deleteRequest]);

  useEffect(() => {
    if (!renamingPath) return;
    const frame = window.requestAnimationFrame(() => {
      const input = renameInputRef.current;
      if (!input) return;
      input.focus();
      const dot = selected?.isDirectory ? -1 : renameValue.lastIndexOf(".");
      input.setSelectionRange(0, dot > 0 ? dot : renameValue.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [renamingPath]);

  useEffect(() => {
    if (!contextMenu && !tabContextMenu && !historyMenu) return;
    const close = () => { setContextMenu(null); setTabContextMenu(null); setHistoryMenu(null); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", closeOnEscape); window.removeEventListener("resize", close); window.removeEventListener("blur", close); };
  }, [contextMenu, tabContextMenu, historyMenu]);

  useEffect(() => {
    if (!openMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".menu-anchor")) setOpenMenu(null);
    };
    const closeMenu = () => setOpenMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenMenu(null); };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("resize", closeMenu);
    return () => { window.removeEventListener("pointerdown", closeOutside); window.removeEventListener("keydown", closeOnEscape); window.removeEventListener("blur", closeMenu); window.removeEventListener("resize", closeMenu); };
  }, [openMenu]);

  const sortedEntries = useMemo(() => {
    const normalized = searchResults ? "" : query.trim().toLocaleLowerCase();
    const source = searchResults ?? listing?.entries ?? [];
    const available = showHidden ? source : source.filter((entry) => !entry.isHidden);
    const entries = normalized ? available.filter((entry) => entry.name.toLocaleLowerCase().includes(normalized)) : [...available];
    return sortEntriesForView(entries, sortKey, sortDirection, language);
  }, [listing, searchResults, query, sortKey, sortDirection, language, showHidden]);
  const selectedEntries = useMemo(() => sortedEntries.filter((entry) => selectedPaths.has(entry.path)), [sortedEntries, selectedPaths]);
  const batchRenamePreview = useMemo(() => selectedEntries.map((entry, index) => ({ entry, name: batchNameFor(entry, batchRenameDraft, index, selectedEntries.length) })), [selectedEntries, batchRenameDraft]);
  useLayoutEffect(() => {
    const element = fileListRef.current;
    if (!element) return;
    const measure = () => {
      setListViewportHeight(Math.max(1, Math.floor(element.clientHeight)));
      setListViewportWidth(Math.max(1, Math.floor(element.clientWidth)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const gridColumns = viewMode === "grid" ? Math.max(1, Math.floor((listViewportWidth - 20) / 148)) : 1;
  const rowHeight = viewMode === "compact" ? 42 : viewMode === "grid" ? 142 : 56;
  const firstVisibleRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 3);
  const firstVisible = firstVisibleRow * gridColumns;
  const visibleRows = Math.ceil(listViewportHeight / rowHeight) + 6;
  const visibleEntries = sortedEntries.slice(firstVisible, firstVisible + visibleRows * gridColumns);
  const virtualHeight = Math.ceil(sortedEntries.length / gridColumns) * rowHeight;
  const visibleImagePaths = visibleEntries.filter(isThumbnailCandidate).map((entry) => entry.path);
  const visibleImageKey = visibleImagePaths.join("\u0000");
  const visibleIconPaths = visibleEntries.filter((entry) => !isThumbnailCandidate(entry)).map((entry) => entry.path);
  const visibleIconKey = visibleIconPaths.join("\u0000");

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listen<OperationScanProgress>("file-operation-progress", ({ payload }) => {
      setOperation((current) => {
        if (!current || current.jobId !== payload.jobId) return current;
        const elapsedSeconds = Math.max(0.25, (Date.now() - current.startedAt) / 1000);
        return { ...current, ...payload, speed: payload.phase === "transfer" ? payload.processedBytes / elapsedSeconds : 0 };
      });
      setOperationTasks((current) => current.map((task) => {
        if (task.jobId !== payload.jobId) return task;
        const elapsedSeconds = Math.max(0.25, (Date.now() - task.startedAt) / 1000);
        return { ...task, ...payload, speed: payload.phase === "transfer" ? payload.processedBytes / elapsedSeconds : 0 };
      }));
    }).then((unlisten) => {
      if (disposed) unlisten(); else stopListening = unlisten;
    });
    return () => { disposed = true; stopListening?.(); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listen<DuplicateScanProgress>("duplicate-scan-progress", ({ payload }) => {
      if (!disposed && payload.jobId === duplicateScanJobIdRef.current) setDuplicateProgress(payload);
    }).then((unlisten) => {
      if (disposed) unlisten(); else stopListening = unlisten;
    });
    return () => {
      disposed = true;
      stopListening?.();
      const jobId = duplicateScanJobIdRef.current;
      if (jobId) void invoke("cancel_duplicate_scan", { jobId }).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listen<SpaceScanProgress>("space-scan-progress", ({ payload }) => {
      if (!disposed && payload.jobId === spaceScanJobIdRef.current) setSpaceScanProgress(payload);
    }).then((unlisten) => {
      if (disposed) unlisten(); else stopListening = unlisten;
    });
    return () => {
      disposed = true;
      stopListening?.();
      const jobId = spaceScanJobIdRef.current;
      if (jobId) void invoke("cancel_space_scan", { jobId }).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listen<DirectoryLoadProgress>("directory-load-progress", ({ payload }) => {
      if (disposed || payload.jobId !== directoryLoadJobIdRef.current) return;
      setListing((current) => {
        const sameDirectory = current?.path.toLocaleLowerCase() === payload.path.toLocaleLowerCase();
        return {
          path: payload.path,
          entries: sameDirectory ? [...current.entries, ...payload.entries] : payload.entries,
          folderCount: payload.folderCount,
          fileCount: payload.fileCount,
        };
      });
      setAddress(payload.path);
      setStatus(language === "zh-CN" ? `正在载入… ${payload.scanned} 项` : `Loading… ${payload.scanned} items`);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else {
        stopListening = unlisten;
        setDirectoryEventsReady(true);
      }
    }).catch(() => {
      if (!disposed) setDirectoryEventsReady(true);
    });
    return () => { disposed = true; stopListening?.(); };
  }, [language]);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listen<FolderSizeProgress>("folder-size-progress", ({ payload }) => {
      if (disposed || payload.jobId !== folderSizeJobIdRef.current) return;
      setFolderSize((current) => current ? {
        ...current,
        totalBytes: payload.totalBytes,
        scannedFiles: payload.scannedFiles,
        scannedFolders: payload.scannedFolders,
      } : current);
    }).then((unlisten) => {
      if (disposed) unlisten(); else stopListening = unlisten;
    });
    return () => { disposed = true; stopListening?.(); };
  }, []);

  useEffect(() => {
    const activeJobId = folderSizeJobIdRef.current;
    if (activeJobId) void invoke("cancel_folder_size", { jobId: activeJobId }).catch(() => undefined);
    folderSizeJobIdRef.current = null;
    setFolderSize(null);
  }, [selected?.path]);

  useEffect(() => {
    if (!listing?.path) return;
    let disposed = false;
    const checkedPath = listing.path;
    const check = async () => {
      if (availabilityCheckRef.current || disposed) return;
      availabilityCheckRef.current = true;
      try {
        const result = await checkDirectoryStatusWithTimeout(checkedPath);
        if (disposed || listingRef.current?.path.toLocaleLowerCase() !== checkedPath.toLocaleLowerCase()) return;
        updateAvailabilityRetry(result);
        const wasUnavailable = unavailableLocationRef.current?.path.toLocaleLowerCase() === checkedPath.toLocaleLowerCase();
        if (!result.available) {
          unavailableLocationRef.current = result;
          setUnavailableLocation(result);
          markPathAvailability(checkedPath, false);
          if (!wasUnavailable) setStatus(language === "zh-CN" ? "当前位置暂时不可用，正在等待设备或网络恢复…" : "This location is unavailable. Waiting for the device or network…");
        } else {
          markPathAvailability(checkedPath, true);
          if (!wasUnavailable) return;
          unavailableLocationRef.current = null;
          setUnavailableLocation(null);
          setStatus(language === "zh-CN" ? "位置已恢复，正在同步…" : "Location restored. Syncing…");
          void refreshDirectory(checkedPath);
          void invoke<Location[]>("get_locations").then(mergeAvailableLocations).catch(() => undefined);
        }
      } catch {
        // A transient status check failure should not replace the current listing.
      } finally {
        availabilityCheckRef.current = false;
      }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 8_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [listing?.path, language]);

  useEffect(() => {
    if (!startupComplete) return;
    let disposed = false;
    const checkBackgroundTabs = async () => {
      if (backgroundAvailabilityCheckRef.current || disposed) return;
      backgroundAvailabilityCheckRef.current = true;
      try {
        const activePath = listingRef.current?.path.toLocaleLowerCase();
        const now = Date.now();
        const paths = tabsRef.current
          .map((tab) => tab.path)
          .filter((path, index, all) => path.toLocaleLowerCase() !== activePath && all.findIndex((candidate) => candidate.toLocaleLowerCase() === path.toLocaleLowerCase()) === index)
          .filter((path) => (availabilityRetryRef.current.get(path.toLocaleLowerCase())?.nextAt ?? 0) <= now)
          .slice(0, 20);
        const results = await Promise.all(paths.map((path) => checkDirectoryStatusWithTimeout(path)));
        if (disposed) return;
        let recovered = 0;
        for (const result of results) {
          const key = result.path.toLocaleLowerCase();
          const wasUnavailable = unavailablePathsRef.current.has(key);
          updateAvailabilityRetry(result);
          markPathAvailability(result.path, result.available);
          if (result.available && wasUnavailable) recovered += 1;
        }
        if (recovered > 0) {
          setStatus(language === "zh-CN" ? `${recovered} 个后台位置已恢复连接` : `${recovered} background location(s) reconnected`);
          void invoke<Location[]>("get_locations").then(mergeAvailableLocations).catch(() => undefined);
        }
      } finally {
        backgroundAvailabilityCheckRef.current = false;
      }
    };
    void checkBackgroundTabs();
    const timer = window.setInterval(() => { void checkBackgroundTabs(); }, 12_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [startupComplete, language]);

  useEffect(() => {
    if (operationExecutorRef.current) return;
    const next = operationTasks.find((task) => task.status === "queued");
    if (!next) return;
    operationExecutorRef.current = next.jobId;
    setOperationTasks((current) => current.map((task) => task.jobId === next.jobId ? { ...task, status: "running", startedAt: Date.now() } : task));
    void executeTransfer(next).finally(() => {
      operationExecutorRef.current = null;
      window.setTimeout(() => setOperationTasks((current) => [...current]), 0);
    });
  }, [operationTasks]);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listen<SearchProgress>("search-progress", ({ payload }) => {
      if (!disposed && payload.jobId === searchJobIdRef.current) setSearchProgress(payload);
    }).then((unlisten) => {
      if (disposed) unlisten(); else stopListening = unlisten;
    });
    return () => { disposed = true; stopListening?.(); };
  }, []);

  function toggleExtensions() {
    setShowExtensions((current) => {
      const next = !current;
      localStorage.setItem(SHOW_EXTENSIONS_KEY, String(next));
      return next;
    });
  }

  function toggleHidden() {
    if (searchResults !== null || searching) clearDeepSearch();
    setShowHidden((current) => {
      const next = !current;
      localStorage.setItem(SHOW_HIDDEN_KEY, String(next));
      return next;
    });
    setSelected(null);
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
    setScrollTop(0);
  }

  function toggleEverythingSearch() {
    setPreferEverything((current) => {
      const next = !current;
      localStorage.setItem(SEARCH_EVERYTHING_KEY, String(next));
      return next;
    });
  }

  function toggleToolbarMenu(menu: "new" | "terminal" | "sort" | "view" | "actions") {
    setContextMenu(null);
    setTabContextMenu(null);
    setOpenMenu((current) => current === menu ? null : menu);
  }

  function toggleActionsMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    setContextMenu(null);
    setTabContextMenu(null);
    if (openMenu === "actions") {
      setOpenMenu(null);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const gap = 8;
    const footerAndMargin = 50;
    const spaceBelow = Math.max(0, window.innerHeight - bounds.bottom - footerAndMargin - gap);
    const spaceAbove = Math.max(0, bounds.top - gap);
    const openUpward = spaceBelow < 230 && spaceAbove > spaceBelow;
    setActionsMenuStyle({
      position: "fixed",
      zIndex: 160,
      right: Math.max(8, window.innerWidth - bounds.right),
      top: openUpward ? "auto" : bounds.bottom + gap,
      bottom: openUpward ? window.innerHeight - bounds.top + gap : "auto",
      maxHeight: Math.max(72, openUpward ? spaceAbove - gap : spaceBelow),
    });
    setOpenMenu("actions");
  }

  function chooseSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      const nextDirection = sortDirection === "ascending" ? "descending" : "ascending";
      setSortDirection(nextDirection);
      localStorage.setItem(SORT_DIRECTION_KEY, nextDirection);
    } else {
      setSortKey(nextKey);
      setSortDirection("ascending");
      localStorage.setItem(SORT_KEY, nextKey);
      localStorage.setItem(SORT_DIRECTION_KEY, "ascending");
    }
    setScrollTop(0);
    setOpenMenu(null);
  }

  function beginColumnResize(column: ResizableColumn, event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column];
    const limits: Record<ResizableColumn, [number, number]> = { modified: [110, 320], type: [90, 260], size: [70, 180] };
    const move = (pointerEvent: PointerEvent) => {
      const [minimum, maximum] = limits[column];
      const width = Math.max(minimum, Math.min(maximum, startWidth + startX - pointerEvent.clientX));
      setColumnWidths((current) => ({ ...current, [column]: width }));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      setColumnWidths((current) => { localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(current)); return current; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  }

  function resetColumnWidth(column: ResizableColumn, event: ReactMouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    setColumnWidths((current) => {
      const next = { ...current, [column]: DEFAULT_COLUMN_WIDTHS[column] };
      localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function chooseView(nextMode: ViewMode) {
    setViewMode(nextMode);
    localStorage.setItem(VIEW_MODE_KEY, nextMode);
    setScrollTop(0);
    setTabs((current) => current.map((tab) => tab.id === activeTabId ? { ...tab, viewMode: nextMode, scrollTop: 0 } : tab));
    if (fileListRef.current) fileListRef.current.scrollTop = 0;
    setOpenMenu(null);
  }

  function togglePreviewPane() {
    setPreviewPaneOpen((current) => {
      const next = !current;
      localStorage.setItem(PREVIEW_PANE_KEY, String(next));
      return next;
    });
    setOpenMenu(null);
  }

  function chooseLanguage(nextLanguage: UiLanguage) {
    setLanguage(nextLanguage);
    localStorage.setItem(LANGUAGE_KEY, nextLanguage);
  }

  function chooseClaudeProvider(provider: ClaudeProvider) {
    setClaudeProvider(provider);
    localStorage.setItem(CLAUDE_PROVIDER_KEY, provider);
    setClaudeCredentialError(null);
    setClaudeDiagnostic(null);
  }

  function toggleClaudeFullAccess() {
    setClaudeFullAccess((current) => {
      const next = !current;
      localStorage.setItem(CLAUDE_FULL_ACCESS_KEY, String(next));
      return next;
    });
  }

  async function saveClaudeApiKey() {
    if (!claudeApiKeyDraft.trim()) return;
    setClaudeCredentialBusy(true);
    setClaudeCredentialError(null);
    try {
      const next = await invoke<ClaudeCredentialStatus>("save_claude_api_key", { apiKey: claudeApiKeyDraft });
      setClaudeCredential(next);
      setClaudeApiKeyDraft("");
      setClaudeDiagnostic(null);
      chooseClaudeProvider("deepseek");
      setStatus(language === "zh-CN" ? "DeepSeek 密钥已安全保存；以后启动 Claude Code 会自动使用。" : "DeepSeek key saved securely. Claude Code will use it automatically.");
    } catch (error) {
      setClaudeCredentialError(String(error));
    } finally {
      setClaudeCredentialBusy(false);
    }
  }

  async function removeClaudeApiKey() {
    setClaudeCredentialBusy(true);
    setClaudeCredentialError(null);
    try {
      setClaudeCredential(await invoke<ClaudeCredentialStatus>("delete_claude_api_key"));
      setClaudeApiKeyDraft("");
      setClaudeDiagnostic(null);
    } catch (error) {
      setClaudeCredentialError(String(error));
    } finally {
      setClaudeCredentialBusy(false);
    }
  }

  async function runClaudeDiagnostic() {
    setClaudeDiagnosticBusy(true);
    setClaudeCredentialError(null);
    try {
      setClaudeDiagnostic(await invoke<ClaudeDiagnostic>("diagnose_claude", { provider: claudeProvider }));
    } catch (error) {
      setClaudeCredentialError(String(error));
    } finally {
      setClaudeDiagnosticBusy(false);
    }
  }

  function clearDeepSearch() {
    const activeJob = searchJobIdRef.current;
    if (activeJob) void invoke("cancel_search", { jobId: activeJob });
    searchJobIdRef.current = null;
    setSearching(false);
    setSearchResults(null);
    setSearchProgress(null);
    setSearchResultMeta(null);
    setSelected(null);
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
    setScrollTop(0);
  }

  function changeSearchQuery(value: string) {
    if (searchResults !== null || searching) clearDeepSearch();
    setQuery(value);
  }

  function currentSearchProfile(): SearchProfile {
    return { query: query.trim(), kind: searchKind, date: searchDate, size: searchSize };
  }

  function rememberSearch(profile: SearchProfile) {
    const item: SearchHistoryItem = { ...profile, usedAt: Date.now() };
    setSearchHistory((current) => {
      const next = [item, ...current.filter((candidate) => !searchProfilesMatch(candidate, profile))].slice(0, 12);
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  function saveCurrentSearch() {
    const profile = currentSearchProfile();
    if (!profile.query && profile.kind === "all" && profile.date === "any" && profile.size === "any") return;
    setSavedSearches((current) => {
      const existing = current.find((candidate) => searchProfilesMatch(candidate, profile));
      const item: SavedSearch = existing ? { ...existing, ...profile } : { ...profile, id: crypto.randomUUID(), name: searchProfileLabel(profile, language) };
      const next = [item, ...current.filter((candidate) => candidate.id !== item.id)].slice(0, 20);
      localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next));
      return next;
    });
  }

  function removeSavedSearch(id: string) {
    setSavedSearches((current) => {
      const next = current.filter((item) => item.id !== id);
      localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next));
      return next;
    });
  }

  function clearSearchHistory() {
    setSearchHistory([]);
    localStorage.removeItem(SEARCH_HISTORY_KEY);
  }

  async function startDeepSearch(profile: SearchProfile = currentSearchProfile()) {
    if (!listing || searching) return;
    if (!profile.query && profile.kind === "all" && profile.date === "any" && profile.size === "any") {
      setStatus(language === "zh-CN" ? "请输入名称，或至少选择一个筛选条件" : "Enter a name or choose at least one filter.");
      return;
    }
    setQuery(profile.query);
    setSearchKind(profile.kind);
    setSearchDate(profile.date);
    setSearchSize(profile.size);
    rememberSearch(profile);
    const day = 24 * 60 * 60;
    const age = profile.date === "day" ? day : profile.date === "week" ? 7 * day : profile.date === "month" ? 30 * day : profile.date === "year" ? 365 * day : 0;
    const modifiedAfter = age ? Math.floor(Date.now() / 1000) - age : null;
    const megabyte = 1024 * 1024;
    const minSize = profile.size === "medium" ? megabyte : profile.size === "large" ? 100 * megabyte : null;
    const maxSize = profile.size === "small" ? megabyte - 1 : profile.size === "medium" ? 100 * megabyte : null;
    const jobId = crypto.randomUUID();
    searchJobIdRef.current = jobId;
    setSearching(true);
    setSearchPanelOpen(false);
    setSearchResults([]);
    setSearchResultMeta(null);
    setSearchProgress({ jobId, scanned: 0, matches: 0, currentPath: listing.path });
    setSelected(null);
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
    setScrollTop(0);
    try {
      const result = await invoke<SearchResult>("search_directory", {
        request: { jobId, root: listing.path, query: profile.query, kind: profile.kind, modifiedAfter, minSize, maxSize, includeHidden: showHidden, preferEverything },
      });
      if (searchJobIdRef.current !== jobId) return;
      setSearchResults(result.entries);
      setSearchResultMeta({ scanned: result.scanned, cancelled: result.cancelled, truncated: result.truncated, provider: result.provider });
      const suffix = result.truncated ? (language === "zh-CN" ? "（已达到 20,000 条上限）" : " (20,000-result limit reached)") : result.cancelled ? (language === "zh-CN" ? "（已取消）" : " (cancelled)") : "";
      const source = result.provider === "everything" ? (language === "zh-CN" ? "Everything 索引" : "Everything index") : (language === "zh-CN" ? "本地扫描" : "local scan");
      setStatus(language === "zh-CN" ? `${source}：检查 ${result.scanned} 项，找到 ${result.entries.length} 项${suffix}` : `${source}: checked ${result.scanned} items; found ${result.entries.length}${suffix}.`);
    } catch (error) {
      if (searchJobIdRef.current === jobId) {
        setSearchResults(null);
        setStatus(language === "zh-CN" ? `搜索失败：${String(error)}` : `Search failed: ${String(error)}`);
      }
    } finally {
      if (searchJobIdRef.current === jobId) {
        searchJobIdRef.current = null;
        setSearching(false);
      }
    }
  }

  function cancelDeepSearch() {
    const jobId = searchJobIdRef.current;
    if (jobId) void invoke("cancel_search", { jobId });
  }

  function toggleFavoriteCurrent() {
    if (!listing) return;
    setFavorites((current) => {
      const alreadySaved = current.some((favorite) => favorite.path.toLocaleLowerCase() === listing.path.toLocaleLowerCase());
      const next = alreadySaved ? current.filter((favorite) => favorite.path.toLocaleLowerCase() !== listing.path.toLocaleLowerCase()) : [...current, { path: listing.path, label: null, group: null }];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
    setStatus(currentIsFavorite ? (language === "zh-CN" ? "已取消收藏" : "Removed from Favorites.") : (language === "zh-CN" ? "已收藏当前文件夹" : "Added the current folder to Favorites."));
  }

  function removeFavorite(path: string, event: ReactMouseEvent) {
    event.stopPropagation();
    setFavorites((current) => {
      const next = current.filter((favorite) => favorite.path.toLocaleLowerCase() !== path.toLocaleLowerCase());
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }

  function beginFavoriteRename(favorite: FavoriteItem, event: ReactMouseEvent) {
    event.stopPropagation();
    setFavoriteEditingPath(favorite.path);
    setFavoriteLabelValue(favorite.label ?? labelForPath(favorite.path));
    setFavoriteGroupValue(favorite.group ?? "");
  }

  function commitFavoriteRename(path: string, value: string, groupValue: string) {
    const cleanLabel = value.trim();
    const cleanGroup = groupValue.trim();
    setFavorites((current) => {
      const next = current.map((favorite) => favorite.path.toLocaleLowerCase() === path.toLocaleLowerCase()
        ? { ...favorite, label: cleanLabel && cleanLabel !== labelForPath(path) ? cleanLabel : null, group: cleanGroup || null }
        : favorite);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
    setFavoriteEditingPath(null);
  }

  function reorderFavorite(sourcePath: string, targetPath: string) {
    if (sourcePath.toLocaleLowerCase() === targetPath.toLocaleLowerCase()) return;
    setFavorites((current) => {
      const sourceIndex = current.findIndex((favorite) => favorite.path.toLocaleLowerCase() === sourcePath.toLocaleLowerCase());
      const targetIndex = current.findIndex((favorite) => favorite.path.toLocaleLowerCase() === targetPath.toLocaleLowerCase());
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      const movedWithGroup = { ...moved, group: current[targetIndex].group };
      next.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, movedWithGroup);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }

  function toggleFavoriteGroup(group: string) {
    const key = group.toLocaleLowerCase();
    setCollapsedFavoriteGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(FAVORITE_COLLAPSE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  async function toggleTreePath(path: string) {
    const key = path.toLocaleLowerCase();
    if (expandedTreePaths.has(key)) {
      setExpandedTreePaths((current) => { const next = new Set(current); next.delete(key); return next; });
      return;
    }
    setExpandedTreePaths((current) => new Set([...current, key]));
    if (treeChildren[key]) return;
    setTreeLoadingPaths((current) => new Set([...current, key]));
    try {
      const result = await invoke<DirectoryListing>("list_directory", { path });
      setTreeChildren((current) => ({ ...current, [key]: result.entries.filter((entry) => entry.isDirectory) }));
    } catch (error) {
      setExpandedTreePaths((current) => { const next = new Set(current); next.delete(key); return next; });
      setStatus(language === "zh-CN" ? `无法展开文件夹：${String(error)}` : `Could not expand folder: ${String(error)}`);
    } finally {
      setTreeLoadingPaths((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  }

  function renderTreeNode(path: string, label: string, depth = 0): React.ReactNode {
    const key = path.toLocaleLowerCase();
    const expanded = expandedTreePaths.has(key);
    const loading = treeLoadingPaths.has(key);
    const children = (treeChildren[key] ?? []).filter((entry) => showHidden || !entry.isHidden);
    const selectedTreeNode = listing?.path.toLocaleLowerCase() === key;
    return <div className="tree-node" key={path}>
      <div className={`tree-node-row ${selectedTreeNode ? "selected" : ""} ${dragTarget === path ? "drop-target" : ""}`} data-drop-path={path} style={{ paddingLeft: 5 + depth * 14 }}>
        <button className={`tree-toggle ${expanded ? "expanded" : ""}`} aria-label={expanded ? "Collapse" : "Expand"} onClick={() => void toggleTreePath(path)}>{loading ? "…" : "›"}</button>
        <button className="tree-label" title={path} onClick={() => void browse(path)}><FolderGlyph /><span>{label}</span></button>
      </div>
      {expanded && <div className="tree-children">{children.length ? children.map((entry) => renderTreeNode(entry.path, entry.name, depth + 1)) : !loading && <span className="tree-empty" style={{ paddingLeft: 35 + depth * 14 }}>—</span>}</div>}
    </div>;
  }

  function selectEntry(entry: FileEntry, index: number, event: ReactMouseEvent) {
    if (event.shiftKey && selectionAnchor !== null) {
      const start = Math.min(selectionAnchor, index);
      const end = Math.max(selectionAnchor, index);
      const range = sortedEntries.slice(start, end + 1).map((item) => item.path);
      setSelectedPaths(new Set(event.ctrlKey ? [...selectedPaths, ...range] : range));
      setSelected(entry);
      return;
    }
    if (event.ctrlKey) {
      const next = new Set(selectedPaths);
      if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path);
      setSelectedPaths(next);
      setSelected(next.has(entry.path) ? entry : (listing?.entries.find((item) => next.has(item.path)) ?? null));
      setSelectionAnchor(index);
      return;
    }
    setSelectedPaths(new Set([entry.path]));
    setSelected(entry);
    setSelectionAnchor(index);
  }

  function clientPositionInList(clientX: number, clientY: number) {
    const list = fileListRef.current;
    if (!list) return null;
    const rect = list.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(list.scrollWidth, clientX - rect.left + list.scrollLeft)),
      y: Math.max(0, Math.min(list.scrollHeight, clientY - rect.top + list.scrollTop)),
    };
  }

  function applyMarqueeSelection(box: SelectionBox, initialPaths: Set<string>) {
    const left = Math.min(box.startX, box.currentX);
    const right = Math.max(box.startX, box.currentX);
    const top = Math.min(box.startY, box.currentY);
    const bottom = Math.max(box.startY, box.currentY);
    const matchedIndices: number[] = [];
    if (viewMode === "grid") {
      const horizontalPadding = 8;
      const gap = 8;
      const cellWidth = Math.max(1, (listViewportWidth - horizontalPadding * 2 - gap * (gridColumns - 1)) / gridColumns);
      const firstRow = Math.max(0, Math.floor(top / rowHeight));
      const lastRow = Math.min(Math.ceil(sortedEntries.length / gridColumns) - 1, Math.floor(bottom / rowHeight));
      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = 0; column < gridColumns; column += 1) {
          const index = row * gridColumns + column;
          if (index >= sortedEntries.length) break;
          const itemLeft = horizontalPadding + column * (cellWidth + gap);
          const itemRight = itemLeft + cellWidth;
          const itemTop = row * rowHeight + horizontalPadding;
          const itemBottom = itemTop + 134;
          if (right >= itemLeft && left <= itemRight && bottom >= itemTop && top <= itemBottom) matchedIndices.push(index);
        }
      }
    } else {
      const firstIndex = Math.max(0, Math.floor(top / rowHeight));
      const lastIndex = Math.min(sortedEntries.length - 1, Math.floor(bottom / rowHeight));
      if (right >= 0 && left <= listViewportWidth) {
        for (let index = firstIndex; index <= lastIndex; index += 1) matchedIndices.push(index);
      }
    }
    const nextPaths = new Set(initialPaths);
    for (const index of matchedIndices) nextPaths.add(sortedEntries[index].path);
    setSelectedPaths(nextPaths);
    const primaryIndex = matchedIndices.length ? matchedIndices[matchedIndices.length - 1] : sortedEntries.findIndex((entry) => nextPaths.has(entry.path));
    setSelected(primaryIndex >= 0 ? sortedEntries[primaryIndex] : null);
    setSelectionAnchor(matchedIndices[0] ?? (primaryIndex >= 0 ? primaryIndex : null));
  }

  function beginMarqueeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || renamingPath || (event.target instanceof Element && event.target.closest(".file-row"))) return;
    const point = clientPositionInList(event.clientX, event.clientY);
    if (!point) return;
    const initialPaths = event.ctrlKey ? new Set(selectedPaths) : new Set<string>();
    const box = { startX: point.x, startY: point.y, currentX: point.x, currentY: point.y };
    marqueeRef.current = { ...box, pointerId: event.pointerId, initialPaths, clientX: event.clientX, clientY: event.clientY, animationFrame: null };
    setSelectionBox(box);
    if (!event.ctrlKey) {
      setSelected(null);
      setSelectedPaths(new Set());
      setSelectionAnchor(null);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const autoScroll = () => {
      const marquee = marqueeRef.current;
      const list = fileListRef.current;
      if (!marquee || !list) return;
      const rect = list.getBoundingClientRect();
      const edge = 30;
      let delta = 0;
      if (marquee.clientY < rect.top + edge) delta = -Math.max(2, Math.ceil((rect.top + edge - marquee.clientY) / 3));
      else if (marquee.clientY > rect.bottom - edge) delta = Math.max(2, Math.ceil((marquee.clientY - (rect.bottom - edge)) / 3));
      if (delta !== 0) {
        const previousTop = list.scrollTop;
        list.scrollTop = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, list.scrollTop + delta));
        if (list.scrollTop !== previousTop) {
          const nextPoint = clientPositionInList(marquee.clientX, marquee.clientY);
          if (nextPoint) {
            const nextBox = { startX: marquee.startX, startY: marquee.startY, currentX: nextPoint.x, currentY: nextPoint.y };
            marqueeRef.current = { ...marquee, ...nextBox };
            setSelectionBox(nextBox);
            applyMarqueeSelection(nextBox, marquee.initialPaths);
          }
        }
      }
      const current = marqueeRef.current;
      if (current) current.animationFrame = window.requestAnimationFrame(autoScroll);
    };
    marqueeRef.current.animationFrame = window.requestAnimationFrame(autoScroll);
    event.preventDefault();
  }

  function updateMarqueeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    const marquee = marqueeRef.current;
    if (!marquee || marquee.pointerId !== event.pointerId) return;
    const point = clientPositionInList(event.clientX, event.clientY);
    if (!point) return;
    const box = { startX: marquee.startX, startY: marquee.startY, currentX: point.x, currentY: point.y };
    marqueeRef.current = { ...marquee, ...box, clientX: event.clientX, clientY: event.clientY };
    setSelectionBox(box);
    applyMarqueeSelection(box, marquee.initialPaths);
    event.preventDefault();
  }

  function finishMarqueeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    const marquee = marqueeRef.current;
    if (!marquee || marquee.pointerId !== event.pointerId) return;
    if (marquee.animationFrame !== null) window.cancelAnimationFrame(marquee.animationFrame);
    marqueeRef.current = null;
    setSelectionBox(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.preventDefault();
  }

  function openEntryContextMenu(entry: FileEntry, index: number, event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!selectedPaths.has(entry.path)) {
      setSelectedPaths(new Set([entry.path]));
      setSelected(entry);
      setSelectionAnchor(index);
    }
    setOpenMenu(null);
    setTabContextMenu(null);
    setContextMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 230)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 570)), kind: "entry" });
  }

  function openBackgroundContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest(".file-row")) return;
    event.preventDefault();
    setSelected(null);
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
    setOpenMenu(null);
    setTabContextMenu(null);
    setContextMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 230)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 310)), kind: "background" });
  }

  function selectAll() {
    setSelectedPaths(new Set(sortedEntries.map((entry) => entry.path)));
    setSelected(sortedEntries[0] ?? null);
    setSelectionAnchor(sortedEntries.length ? 0 : null);
  }

  function selectByKeyboard(offset: number | "start" | "end", extend = false) {
    if (sortedEntries.length === 0) return;
    const currentIndex = selected ? sortedEntries.findIndex((entry) => entry.path === selected.path) : -1;
    const nextIndex = offset === "start" ? 0 : offset === "end" ? sortedEntries.length - 1 : Math.max(0, Math.min(sortedEntries.length - 1, (currentIndex < 0 ? (offset > 0 ? -1 : 0) : currentIndex) + offset));
    const entry = sortedEntries[nextIndex];
    setSelected(entry);
    if (extend) {
      const anchor = selectionAnchor ?? (currentIndex >= 0 ? currentIndex : nextIndex);
      const start = Math.min(anchor, nextIndex);
      const end = Math.max(anchor, nextIndex);
      setSelectedPaths(new Set(sortedEntries.slice(start, end + 1).map((item) => item.path)));
      if (selectionAnchor === null) setSelectionAnchor(anchor);
    } else {
      setSelectedPaths(new Set([entry.path]));
      setSelectionAnchor(nextIndex);
    }
    const targetRow = Math.floor(nextIndex / gridColumns);
    const targetTop = targetRow * rowHeight;
    const list = fileListRef.current;
    if (list && targetTop < list.scrollTop) list.scrollTop = targetTop;
    else if (list && targetTop + rowHeight > list.scrollTop + list.clientHeight) list.scrollTop = targetTop + rowHeight - list.clientHeight;
  }

  function toggleFocusedSelection() {
    if (!selected) return;
    const next = new Set(selectedPaths);
    if (next.has(selected.path)) next.delete(selected.path); else next.add(selected.path);
    setSelectedPaths(next);
    const index = sortedEntries.findIndex((entry) => entry.path === selected.path);
    if (index >= 0) setSelectionAnchor(index);
  }

  async function copySelection(mode: "copy" | "move") {
    if (selectedPaths.size === 0) return;
    const nextClipboard = { mode, paths: [...selectedPaths] } as ClipboardState;
    try {
      await invoke("set_file_clipboard", nextClipboard);
      setClipboard(nextClipboard);
      setOpenMenu(null);
      setStatus(language === "zh-CN" ? `${selectedPaths.size} 个项目已${mode === "copy" ? "复制到系统剪贴板" : "剪切"}` : `${selectedPaths.size} item(s) ${mode === "copy" ? "copied to the Windows clipboard" : "cut"}.`);
    } catch (error) { setStatus(language === "zh-CN" ? `无法访问系统剪贴板：${String(error)}` : `Could not access the Windows clipboard: ${String(error)}`); }
  }

  async function copySelectionText(mode: "path" | "name") {
    if (selectedPaths.size === 0) return;
    const values = mode === "path" ? [...selectedPaths] : selectedEntries.map((entry) => entry.name);
    try {
      await invoke("set_text_clipboard", { text: values.join("\r\n") });
      setOpenMenu(null);
      setContextMenu(null);
      setStatus(language === "zh-CN" ? `已复制 ${values.length} 个项目的${mode === "path" ? "路径" : "名称"}` : `Copied ${values.length} item ${mode === "path" ? "path(s)" : "name(s)"}.`);
    } catch (error) {
      setStatus(language === "zh-CN" ? `无法复制文本：${String(error)}` : `Could not copy text: ${String(error)}`);
    }
  }

  async function prepareTransfer(sourceClipboard: ClipboardState, destination: string) {
    try {
      const conflicts = await invoke<ConflictEntry[]>("find_conflicts", { sources: sourceClipboard.paths, destination });
      if (conflicts.length > 0) {
        setApplyConflictToRemaining(conflicts.length > 1);
        setPendingTransfer({ clipboard: sourceClipboard, destination, conflicts, currentIndex: 0, resolutions: [] });
      } else {
        await startTransfer(sourceClipboard, destination, "skip", []);
      }
    } catch (error) {
      setStatus(String(error));
    }
  }

  function resolveCurrentConflict(action: ConflictChoice) {
    const pending = pendingTransfer;
    if (!pending) return;
    const remaining = pending.conflicts.slice(pending.currentIndex);
    const additions = (applyConflictToRemaining ? remaining : remaining.slice(0, 1)).map((entry) => ({ source: entry.source.path, action }));
    const resolutions = [...pending.resolutions, ...additions];
    const nextIndex = pending.currentIndex + additions.length;
    if (nextIndex < pending.conflicts.length) {
      setPendingTransfer({ ...pending, currentIndex: nextIndex, resolutions });
      return;
    }
    void startTransfer(pending.clipboard, pending.destination, "skip", resolutions);
  }

  async function startTransfer(sourceClipboard: ClipboardState, destination: string, conflict: ConflictChoice, conflictResolutions: ConflictResolution[] = []) {
    const jobId = crypto.randomUUID();
    setPendingTransfer(null);
    setOpenMenu(null);
    setRetryTransfer(null);
    const now = Date.now();
    const task: TransferTask = {
      jobId, mode: sourceClipboard.mode, sourcePaths: sourceClipboard.paths, destination, conflict, conflictResolutions,
      status: "queued", queuedAt: now, startedAt: now, finishedAt: null, paused: false,
      processedBytes: 0, totalBytes: 0, completedItems: 0, totalItems: sourceClipboard.paths.length,
      currentName: "", phase: "scanning", scannedItems: 0, scannedBytes: 0, speed: 0, issues: [], error: null,
      recoveredFromRestart: false,
    };
    setOperationTasks((current) => {
      const next = [...current.slice(-19), task];
      operationTasksRef.current = next;
      writeStoredOperationTasks(next);
      return next;
    });
    setStatus(language === "zh-CN" ? `已加入文件任务：${sourceClipboard.paths.length} 项` : `Added ${sourceClipboard.paths.length} item(s) to the file queue.`);
  }

  function retryTaskFailures(task: TransferTask) {
    const paths = retryableTaskPaths(task);
    if (!paths.length) return;
    void startTransfer({ mode: task.mode, paths }, task.destination, task.conflict, task.conflictResolutions);
  }

  function retryAllTransferIssues() {
    const retry = retryTransfer;
    if (!retry) return;
    setOperationIssues([]);
    setRetryTransfer(null);
    void startTransfer(retry.clipboard, retry.destination, retry.conflict, retry.conflictResolutions);
  }

  async function retrySingleTransferIssue(issue: OperationIssue) {
    const retry = retryTransfer;
    if (!retry || !retry.clipboard.paths.some((path) => path.toLocaleLowerCase() === issue.path.toLocaleLowerCase())) return;
    const remainingPaths = retry.clipboard.paths.filter((path) => path.toLocaleLowerCase() !== issue.path.toLocaleLowerCase());
    setOperationIssues((current) => current.filter((item) => item.path.toLocaleLowerCase() !== issue.path.toLocaleLowerCase()));
    await startTransfer({ mode: retry.clipboard.mode, paths: [issue.path] }, retry.destination, retry.conflict, retry.conflictResolutions);
    setRetryTransfer(remainingPaths.length ? { ...retry, clipboard: { ...retry.clipboard, paths: remainingPaths } } : null);
  }

  function pushUndo(action: UndoAction, label: string) {
    const now = Date.now();
    const record: UndoRecord = { id: crypto.randomUUID(), action, label, createdAt: now };
    setUndoStack((current) => [...current.filter((item) => now - item.createdAt <= UNDO_RETENTION_MS), record].slice(-MAX_UNDO_STEPS));
  }

  async function executeTransfer(task: TransferTask) {
    const startedAt = Date.now();
    setOperationIssues([]);
    setOperation({
      jobId: task.jobId, mode: task.mode, startedAt, paused: false, speed: 0,
      processedBytes: task.processedBytes, totalBytes: task.totalBytes,
      completedItems: task.completedItems, totalItems: task.totalItems, currentName: task.currentName,
      phase: task.phase, scannedItems: task.scannedItems, scannedBytes: task.scannedBytes,
    });
    try {
      const result = await invoke<FileOperationResult>("run_file_operation", {
        request: { jobId: task.jobId, sources: task.sourcePaths, destination: task.destination, mode: task.mode, conflict: task.conflict, conflictResolutions: task.conflictResolutions, rateLimitBytesPerSecond: operationRateLimit },
      });
      if (result.undo) pushUndo(result.undo, language === "zh-CN" ? `${task.mode === "copy" ? "复制" : "移动"} ${result.completed} 项` : `${task.mode === "copy" ? "Copy" : "Move"} ${result.completed} item(s)`);
      if (result.issues.length) {
        setOperationIssues(result.issues);
        const failedClipboard = { mode: task.mode, paths: result.issues.map((issue) => issue.path) } as ClipboardState;
        setRetryTransfer({ clipboard: failedClipboard, destination: task.destination, conflict: task.conflict, conflictResolutions: task.conflictResolutions });
        if (task.mode === "move") {
          setClipboard(failedClipboard);
          void invoke("set_file_clipboard", failedClipboard);
        }
      } else {
        setRetryTransfer(null);
        if (task.mode === "move" && result.completed > 0) setClipboard(null);
      }
      const finalStatus = result.issues.length
        ? (language === "zh-CN" ? `已完成 ${result.completed} 项，${result.issues.length} 项需要处理` : `Completed ${result.completed} item(s); ${result.issues.length} need attention.`)
        : result.error
        ? result.error
        : result.cancelled
          ? (language === "zh-CN" ? `操作已取消，已完成 ${result.completed} 项` : `Operation cancelled after ${result.completed} item(s).`)
          : (language === "zh-CN" ? `已完成 ${result.completed} 项${result.skipped ? `，跳过 ${result.skipped} 项` : ""}` : `Completed ${result.completed} item(s)${result.skipped ? `; skipped ${result.skipped}` : ""}.`);
      setOperationTasks((current) => current.map((item) => item.jobId === task.jobId ? {
        ...item,
        status: result.cancelled ? "cancelled" : result.error || (result.issues.length > 0 && result.completed === 0) ? "failed" : "completed",
        finishedAt: Date.now(), issues: result.issues, error: result.error, recoveredFromRestart: false,
      } : item));
      if (listing) await browse(listing.path, activeTabId, false);
      setStatus(finalStatus);
    } catch (error) {
      setStatus(language === "zh-CN" ? `文件操作失败：${String(error)}` : `File operation failed: ${String(error)}`);
      setOperationTasks((current) => current.map((item) => item.jobId === task.jobId ? { ...item, status: "failed", finishedAt: Date.now(), error: String(error), recoveredFromRestart: false } : item));
    } finally {
      setOperation(null);
    }
  }

  async function pasteIntoCurrent() {
    if (!listing) return;
    try {
      const systemClipboard = await invoke<ClipboardPayload>("get_file_clipboard");
      const source = systemClipboard.paths.length ? systemClipboard : clipboard;
      if (source?.paths.length) await prepareTransfer(source, listing.path);
      else setStatus(language === "zh-CN" ? "系统剪贴板中没有可粘贴的文件" : "The Windows clipboard does not contain files.");
    } catch (error) { setStatus(language === "zh-CN" ? `无法读取系统剪贴板：${String(error)}` : `Could not read the Windows clipboard: ${String(error)}`); }
  }

  function cancelOperation() {
    if (operation) void invoke("cancel_file_operation", { jobId: operation.jobId });
  }

  function cancelTask(task: TransferTask) {
    if (task.status === "queued") {
      setOperationTasks((current) => current.map((item) => item.jobId === task.jobId ? { ...item, status: "cancelled", finishedAt: Date.now() } : item));
    } else if (task.status === "running" || task.status === "paused") {
      void invoke("cancel_file_operation", { jobId: task.jobId });
    }
  }

  function prioritizeTask(task: TransferTask) {
    setOperationTasks((current) => prioritizeQueuedTask(current, task.jobId));
  }

  async function toggleOperationPaused() {
    if (!operation) return;
    const paused = !operation.paused;
    await invoke("set_file_operation_paused", { jobId: operation.jobId, paused });
    setOperation((current) => current?.jobId === operation.jobId ? { ...current, paused } : current);
    setOperationTasks((current) => current.map((task) => task.jobId === operation.jobId ? { ...task, paused, status: paused ? "paused" : "running" } : task));
  }

  function changeOperationRateLimit(bytesPerSecond: number) {
    if (!OPERATION_RATE_LIMITS.some((value) => value === bytesPerSecond)) return;
    setOperationRateLimit(bytesPerSecond);
    localStorage.setItem(OPERATION_RATE_LIMIT_KEY, String(bytesPerSecond));
    if (operation) {
      void invoke("set_file_operation_rate_limit", { jobId: operation.jobId, bytesPerSecond })
        .catch((error) => setStatus(language === "zh-CN" ? `无法调整任务速度：${String(error)}` : `Could not change task speed: ${String(error)}`));
    }
  }

  function recycleSelection() {
    if (selectedPaths.size === 0 || !listing) return;
    setOpenMenu(null);
    setContextMenu(null);
    setDeleteRequest({ permanent: false, paths: [...selectedPaths], names: selectedEntries.map((entry) => entry.name) });
  }

  function permanentlyDeleteSelection() {
    if (selectedPaths.size === 0 || !listing) return;
    setOpenMenu(null);
    setContextMenu(null);
    setDeleteRequest({ permanent: true, paths: [...selectedPaths], names: selectedEntries.map((entry) => entry.name) });
  }

  async function confirmDeleteRequest() {
    const request = deleteRequest;
    if (!request || !listing) return;
    setDeleteRequest(null);
    setRetryTransfer(null);
    try {
      const result = await invoke<FileOperationResult>(request.permanent ? "permanently_delete_paths" : "recycle_paths", { paths: request.paths });
      if (!request.permanent && result.undo) pushUndo(result.undo, language === "zh-CN" ? `移入回收站 ${result.completed} 项` : `Recycle ${result.completed} item(s)`);
      if (result.issues.length) setOperationIssues(result.issues);
      await browse(listing.path, activeTabId, false);
      setStatus(request.permanent
        ? (result.issues.length ? (language === "zh-CN" ? `已永久删除 ${result.completed} 项，失败 ${result.issues.length} 项` : `Permanently deleted ${result.completed} item(s); ${result.issues.length} failed.`) : (language === "zh-CN" ? `已永久删除 ${result.completed} 项` : `Permanently deleted ${result.completed} item(s).`))
        : (result.issues.length ? (language === "zh-CN" ? `已移入回收站 ${result.completed} 项，失败 ${result.issues.length} 项` : `Recycled ${result.completed} item(s); ${result.issues.length} failed.`) : (language === "zh-CN" ? `已将 ${result.completed} 项移入回收站` : `Moved ${result.completed} item(s) to the Recycle Bin.`)));
    } catch (error) { setStatus(String(error)); }
  }

  async function undoLastOperation() {
    if (!latestUndo || operation || undoBusy) return;
    setUndoBusy(true);
    try {
      await invoke("undo_operation", { action: latestUndo.action });
      setUndoStack((current) => current.filter((record) => record.id !== latestUndo.id));
      if (listing) await browse(listing.path, activeTabId, false);
      setStatus(language === "zh-CN" ? `已撤销：${latestUndo.label}` : `Undid: ${latestUndo.label}`);
    } catch (error) { setStatus(language === "zh-CN" ? `无法撤销：${String(error)}` : `Could not undo: ${String(error)}`); }
    finally { setUndoBusy(false); }
  }

  function clearTabHover() {
    if (!tabHoverRef.current) return;
    window.clearTimeout(tabHoverRef.current.timer);
    tabHoverRef.current = null;
  }

  function scheduleTabHover(path: string | null) {
    const tab = path ? tabs.find((candidate) => candidate.path.toLocaleLowerCase() === path.toLocaleLowerCase()) : null;
    if (!tab || tab.id === activeTabId) { clearTabHover(); return; }
    if (tabHoverRef.current?.path.toLocaleLowerCase() === tab.path.toLocaleLowerCase()) return;
    clearTabHover();
    const timer = window.setTimeout(() => {
      tabHoverRef.current = null;
      void activateTab(tab);
    }, 650);
    tabHoverRef.current = { path: tab.path, timer };
  }

  useEffect(() => () => clearTabHover(), []);

  function armPointerDrag(entry: FileEntry, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || renamingPath) return;
    const paths = selectedPaths.has(entry.path) ? [...selectedPaths] : [entry.path];
    pointerDragRef.current = { paths, startX: event.clientX, startY: event.clientY, target: null, active: false, dropAllowed: false };
  }

  function canDropInto(paths: string[], target: string) {
    const normalizedTarget = target.replace(/[\\/]+$/, "").toLocaleLowerCase();
    if (paths.some((path) => {
      const source = path.replace(/[\\/]+$/, "").toLocaleLowerCase();
      return normalizedTarget === source || normalizedTarget.startsWith(`${source}\\`);
    })) return false;
    return !paths.every((path) => parentDirectory(path).replace(/[\\/]+$/, "").toLocaleLowerCase() === normalizedTarget);
  }

  async function startExternalFileDrag() {
    const drag = pointerDragRef.current;
    if (!drag?.active || operation) return;
    pointerDragRef.current = null;
    setDragTarget(null);
    setDragGhost(null);
    try {
      const result = await invoke<ExternalDragResult>("start_file_drag", { paths: drag.paths });
      if (result.effect === "move") {
        const moved = new Set(drag.paths.map((path) => path.toLocaleLowerCase()));
        setSearchResults((current) => current ? current.filter((entry) => !moved.has(entry.path.toLocaleLowerCase())) : current);
        setSelected(null);
        setSelectedPaths(new Set());
        setSelectionAnchor(null);
        if (listing) await refreshDirectory(listing.path);
      }
      const messages = language === "zh-CN"
        ? { copy: "已将文件复制到外部位置", move: "已将文件移动到外部位置", link: "已在外部位置创建快捷方式", none: "已取消外部拖放" }
        : { copy: "Copied files to the external destination.", move: "Moved files to the external destination.", link: "Created links at the external destination.", none: "External drag cancelled." };
      setStatus(messages[result.effect]);
    } catch (error) {
      setStatus(language === "zh-CN" ? `无法拖出文件：${String(error)}` : `Could not drag files outside Flow Files: ${String(error)}`);
    }
  }

  useEffect(() => {
    const elementAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-path]") ?? null;
    const move = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag) return;
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      drag.active = true;
      const targetElement = elementAt(event.clientX, event.clientY);
      drag.target = targetElement?.dataset.dropPath ?? null;
      drag.dropAllowed = !!drag.target && canDropInto(drag.paths, drag.target);
      scheduleTabHover(targetElement?.classList.contains("tab") ? drag.target : null);
      setDragTarget(drag.dropAllowed ? drag.target : null);
      setDragGhost({
        x: event.clientX,
        y: event.clientY,
        count: drag.paths.length,
        mode: drag.target && drag.dropAllowed ? nativeDropMode(drag.paths, drag.target) : "blocked",
        targetLabel: drag.target ? labelForPath(drag.target) : null,
      });
      event.preventDefault();
    };
    const finish = () => {
      const drag = pointerDragRef.current;
      pointerDragRef.current = null;
      setDragGhost(null);
      setDragTarget(null);
      clearTabHover();
      if (drag?.active && drag.target && drag.dropAllowed && !operation) void prepareTransfer({ mode: nativeDropMode(drag.paths, drag.target), paths: drag.paths }, drag.target);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); };
  }, [operation, listing?.path, tabs, activeTabId]);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    const targetAtPhysicalPosition = (x: number, y: number) => {
      const scale = window.devicePixelRatio || 1;
      const element = document.elementFromPoint(x / scale, y / scale)?.closest<HTMLElement>("[data-drop-path]") ?? null;
      return { path: element?.dataset.dropPath ?? listing?.path ?? null, isTab: !!element?.classList.contains("tab") };
    };
    void getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (disposed) return;
      if (payload.type === "leave") { nativeDropPathsRef.current = []; setDragTarget(null); clearTabHover(); return; }
      if (payload.type === "enter") nativeDropPathsRef.current = payload.paths;
      const target = targetAtPhysicalPosition(payload.position.x, payload.position.y);
      if (payload.type === "enter" || payload.type === "over") { setDragTarget(target.path); scheduleTabHover(target.isTab ? target.path : null); return; }
      const paths = payload.paths.length ? payload.paths : nativeDropPathsRef.current;
      nativeDropPathsRef.current = [];
      setDragTarget(null);
      clearTabHover();
      if (target.path && paths.length && !operation) void prepareTransfer({ mode: nativeDropMode(paths, target.path), paths }, target.path);
    }).then((unlisten) => { if (disposed) unlisten(); else stopListening = unlisten; });
    return () => { disposed = true; stopListening?.(); };
  }, [listing?.path, operation, tabs, activeTabId]);

  useEffect(() => {
    const prioritizedPaths = selected && visibleImagePaths.includes(selected.path)
      ? [selected.path, ...visibleImagePaths.filter((path) => path !== selected.path)]
      : visibleImagePaths;
    const missingPaths = prioritizedPaths.filter((path) => !thumbnailCache[path]).slice(0, 16);
    if (missingPaths.length === 0) {
      thumbnailJobIdRef.current = null;
      return;
    }
    let cancelled = false;
    const jobId = crypto.randomUUID();
    thumbnailJobIdRef.current = jobId;
    void invoke<Thumbnail[]>("load_thumbnails", { jobId, paths: missingPaths })
      .then((thumbnails) => {
        if (cancelled || thumbnailJobIdRef.current !== jobId) return;
        setThumbnailCache((current) => {
          const next = { ...current };
          for (const thumbnail of thumbnails) {
            delete next[thumbnail.path];
            next[thumbnail.path] = thumbnail.dataUrl;
          }
          const surplus = Object.keys(next).length - MAX_CACHED_THUMBNAILS;
          if (surplus > 0) Object.keys(next).slice(0, surplus).forEach((path) => delete next[path]);
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (thumbnailJobIdRef.current === jobId) thumbnailJobIdRef.current = null;
      void invoke("cancel_thumbnail_job", { jobId }).catch(() => undefined);
    };
  }, [visibleImageKey, thumbnailCache, selected?.path]);

  useEffect(() => {
    const missingPaths = visibleIconPaths.filter((path) => !fileIconCache[path]).slice(0, 32);
    if (missingPaths.length === 0) return;
    let cancelled = false;
    void invoke<Thumbnail[]>("load_file_icons", { paths: missingPaths })
      .then((icons) => {
        if (cancelled) return;
        setFileIconCache((current) => {
          const next = { ...current };
          for (const icon of icons) {
            delete next[icon.path];
            next[icon.path] = icon.dataUrl;
          }
          const surplus = Object.keys(next).length - MAX_CACHED_FILE_ICONS;
          if (surplus > 0) Object.keys(next).slice(0, surplus).forEach((path) => delete next[path]);
          return next;
        });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [visibleIconKey]);

  useEffect(() => {
    if (!selected || selectedPaths.size !== 1 || (!previewPaneOpen && !quickPreviewOpen)) {
      previewRequestRef.current += 1;
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    if (selected.isDirectory) {
      previewRequestRef.current += 1;
      setPreview({ kind: "none", dataUrl: null, text: null, truncated: false, encoding: null, textOffset: 0, totalBytes: 0 });
      setPreviewLoading(false);
      return;
    }
    const requestId = ++previewRequestRef.current;
    let disposed = false;
    setPreview(null);
    setPreviewLoading(true);
    void invoke<FilePreview>("load_file_preview", { path: selected.path, textEncoding: null, textOffset: 0 })
      .then((result) => { if (!disposed && previewRequestRef.current === requestId) setPreview(result); })
      .catch(() => { if (!disposed && previewRequestRef.current === requestId) setPreview({ kind: "none", dataUrl: null, text: null, truncated: false, encoding: null, textOffset: 0, totalBytes: 0 }); })
      .finally(() => { if (!disposed && previewRequestRef.current === requestId) setPreviewLoading(false); });
    return () => { disposed = true; };
  }, [selected?.path, selectedPaths.size, previewPaneOpen, quickPreviewOpen]);

  async function loadTextPreviewPage(encoding: string, offset: number) {
    if (!selected || selected.isDirectory || selectedPaths.size !== 1) return;
    const requestId = ++previewRequestRef.current;
    const path = selected.path;
    setPreviewLoading(true);
    try {
      const result = await invoke<FilePreview>("load_file_preview", { path, textEncoding: encoding, textOffset: Math.max(0, offset) });
      if (previewRequestRef.current === requestId) setPreview(result);
    } catch (error) {
      if (previewRequestRef.current === requestId) setStatus(language === "zh-CN" ? `无法读取文本预览：${String(error)}` : `Could not read text preview: ${String(error)}`);
    } finally {
      if (previewRequestRef.current === requestId) setPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (!listing) return;
    let disposed = false;
    let refreshTimer: number | undefined;
    let stopListening: (() => void) | undefined;
    const watchedPath = listing.path;
    void listen<DirectoryChanged>("directory-changed", ({ payload }) => {
      if (disposed || payload.path.toLocaleLowerCase() !== watchedPath.toLocaleLowerCase()) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => { void refreshDirectory(watchedPath); }, 180);
    }).then((unlisten) => {
      if (disposed) unlisten(); else stopListening = unlisten;
      return invoke("watch_directory", { path: watchedPath });
    }).catch((error) => { if (!disposed) setStatus(language === "zh-CN" ? `无法监听文件夹变化：${String(error)}` : `Could not watch this folder: ${String(error)}`); });
    return () => { disposed = true; window.clearTimeout(refreshTimer); stopListening?.(); };
  }, [listing?.path, activeTabId, language, searchResults]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key === "Escape" && (openMenu || contextMenu || tabContextMenu || historyMenu)) { event.preventDefault(); setOpenMenu(null); setContextMenu(null); setTabContextMenu(null); setHistoryMenu(null); return; }
      if (event.key === "Escape" && deleteRequest) { event.preventDefault(); setDeleteRequest(null); return; }
      if (event.key === "Escape" && batchRenameOpen && !archiveBusy) { event.preventDefault(); setBatchRenameOpen(false); return; }
      if (event.key === "Escape" && settingsOpen) { event.preventDefault(); setSettingsOpen(false); return; }
      if (event.key === "Escape" && spaceHealthOpen) { event.preventDefault(); closeSpaceHealth(); return; }
      if (event.key === "Escape" && pendingTransfer) { event.preventDefault(); setPendingTransfer(null); return; }
      if (event.key === "Escape" && quickPreviewOpen) { event.preventDefault(); setQuickPreviewOpen(false); return; }
      if (event.key === "Escape" && searchResults !== null) { event.preventDefault(); clearDeepSearch(); return; }
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || settingsOpen || spaceHealthOpen || pendingTransfer || deleteRequest || batchRenameOpen || quickPreviewOpen) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.shiftKey && event.key.toLowerCase() === "t") { event.preventDefault(); reopenClosedTab(); }
      else if (command && event.key.toLowerCase() === "t") { event.preventDefault(); openNewTab(); }
      else if (command && event.key.toLowerCase() === "w") { event.preventDefault(); if (activeTab && !activeTab.pinned) closeTabById(activeTab.id); }
      else if (command && event.key.toLowerCase() === "a") { event.preventDefault(); selectAll(); }
      else if (command && event.key.toLowerCase() === "c") { event.preventDefault(); void copySelection("copy"); }
      else if (command && event.key.toLowerCase() === "x") { event.preventDefault(); void copySelection("move"); }
      else if (command && event.key.toLowerCase() === "v") { event.preventDefault(); void pasteIntoCurrent(); }
      else if (command && event.key.toLowerCase() === "z") { event.preventDefault(); void undoLastOperation(); }
      else if (command && event.key.toLowerCase() === "l") { event.preventDefault(); beginAddressEditing(); }
      else if (command && event.key === " ") { event.preventDefault(); toggleFocusedSelection(); }
      else if (event.altKey && event.key === "Enter" && selectedPaths.size === 1 && selected) { event.preventDefault(); void showSelectedProperties(); }
      else if (event.shiftKey && event.key === "F10" && selectedPaths.size === 1 && selected) { event.preventDefault(); void showSelectedSystemMenu(); }
      else if (event.key === "Delete" && event.shiftKey) { event.preventDefault(); void permanentlyDeleteSelection(); }
      else if (event.key === "Delete") { event.preventDefault(); void recycleSelection(); }
      else if (event.key === "F2") { event.preventDefault(); beginRename(); }
      else if (event.key === "F5" && listing) { event.preventDefault(); void browse(listing.path, activeTabId, false); }
      else if (event.altKey && event.key === "ArrowUp" && listing) { event.preventDefault(); void browse(parentDirectory(listing.path)); }
      else if (event.key === "Backspace" && listing) { event.preventDefault(); void browse(parentDirectory(listing.path)); }
      else if (event.key === "ArrowDown") { event.preventDefault(); selectByKeyboard(viewMode === "grid" ? gridColumns : 1, event.shiftKey); }
      else if (event.key === "ArrowUp") { event.preventDefault(); selectByKeyboard(viewMode === "grid" ? -gridColumns : -1, event.shiftKey); }
      else if (event.key === "ArrowRight" && viewMode === "grid") { event.preventDefault(); selectByKeyboard(1, event.shiftKey); }
      else if (event.key === "ArrowLeft" && viewMode === "grid") { event.preventDefault(); selectByKeyboard(-1, event.shiftKey); }
      else if (event.key === "PageDown") { event.preventDefault(); selectByKeyboard(Math.max(gridColumns, Math.floor(listViewportHeight / rowHeight) * gridColumns), event.shiftKey); }
      else if (event.key === "PageUp") { event.preventDefault(); selectByKeyboard(-Math.max(gridColumns, Math.floor(listViewportHeight / rowHeight) * gridColumns), event.shiftKey); }
      else if (event.key === "Home") { event.preventDefault(); selectByKeyboard("start", event.shiftKey); }
      else if (event.key === "End") { event.preventDefault(); selectByKeyboard("end", event.shiftKey); }
      else if (event.key === "Enter" && selectedPaths.size === 1 && selected) { event.preventDefault(); void openEntry(selected); }
      else if (event.key === " " && selectedPaths.size === 1 && selected) { event.preventDefault(); setQuickPreviewOpen(true); }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [selectedPaths, selected, selectionAnchor, clipboard, undoAction, undoBusy, operation, listing, activeTabId, activeTab, tabs, openMenu, contextMenu, tabContextMenu, historyMenu, closedTabs, settingsOpen, spaceHealthOpen, pendingTransfer, deleteRequest, batchRenameOpen, archiveBusy, quickPreviewOpen, language, viewMode, gridColumns, rowHeight, listViewportHeight, sortedEntries, searchResults, searching]);

  async function browse(path: string, tabId = activeTabId, recordHistory = true, restoreState: FolderTab | null = null) {
    if (tabId === null) return;
    const requestedKey = path.toLocaleLowerCase();
    const requestedTab = tabs.find((tab) => tab.id === tabId);
    const openingStoredTab = requestedTab?.path.toLocaleLowerCase() === requestedKey;
    const driveRoot = /^[A-Za-z]:/.test(path) ? `${path.slice(0, 2)}\\`.toLocaleLowerCase() : null;
    const knownDisconnected = locations.some((location) => !location.isAvailable && (location.path.toLocaleLowerCase() === requestedKey || (!!driveRoot && location.path.toLocaleLowerCase() === driveRoot)));
    if (searchResults !== null || searching) clearDeepSearch();
    const previousJobId = directoryLoadJobIdRef.current;
    if (previousJobId) void invoke("cancel_directory_load", { jobId: previousJobId }).catch(() => undefined);
    const jobId = crypto.randomUUID();
    const previousListing = listingRef.current;
    directoryLoadJobIdRef.current = jobId;
    setIsLoading(true);
    setListing({ path, entries: [], folderCount: 0, fileCount: 0 });
    setAddress(path);
    setSelected(null);
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
    setQuickPreviewOpen(false);
    setQuery("");
    setScrollTop(0);
    setStatus(language === "zh-CN" ? "正在打开文件夹…" : "Opening folder…");
    try {
      const nextListing = await invoke<DirectoryListing>("list_directory_progressive", { jobId, path });
      if (directoryLoadJobIdRef.current !== jobId) return;
      unavailableLocationRef.current = null;
      setUnavailableLocation(null);
      markPathAvailability(nextListing.path, true);
      setTabs((current) => current.map((tab) => {
        if (tab.id !== tabId) return tab;
        const knownLocation = locations.find((location) => location.path.toLocaleLowerCase() === nextListing.path.toLocaleLowerCase());
        const label = knownLocation?.label ?? labelForPath(nextListing.path);
        if (!recordHistory) return { ...tab, path: nextListing.path, label };
        const history = [...tab.history.slice(0, tab.historyIndex + 1), nextListing.path];
        return { ...tab, path: nextListing.path, label, history, historyIndex: history.length - 1, scrollTop: 0, selectedPaths: [] };
      }));
      setListing(nextListing);
      rememberPath(nextListing.path);
      setTreeChildren((current) => {
        const key = nextListing.path.toLocaleLowerCase();
        return Object.prototype.hasOwnProperty.call(current, key) ? { ...current, [key]: nextListing.entries.filter((entry) => entry.isDirectory) } : current;
      });
      setAddress(nextListing.path);
      const existingPaths = new Set(nextListing.entries.map((entry) => entry.path));
      const restoredSelection = restoreState?.selectedPaths.filter((selectedPath) => existingPaths.has(selectedPath)) ?? [];
      setSelected(nextListing.entries.find((entry) => entry.path === restoredSelection[0]) ?? null);
      setSelectedPaths(new Set(restoredSelection));
      setSelectionAnchor(null);
      setQuickPreviewOpen(false);
      setQuery("");
      const restoredScrollTop = restoreState?.scrollTop ?? 0;
      if (restoreState) setViewMode(restoreState.viewMode);
      setScrollTop(restoredScrollTop);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => { if (fileListRef.current) fileListRef.current.scrollTop = restoredScrollTop; }));
      setStatus(language === "zh-CN" ? `${nextListing.folderCount} 个文件夹 · ${nextListing.fileCount} 个文件` : `${nextListing.folderCount} folders · ${nextListing.fileCount} files`);
    } catch (error) {
      if (directoryLoadJobIdRef.current !== jobId) return;
      const preserveDisconnectedView = openingStoredTab || knownDisconnected || path.startsWith("\\\\");
      if (preserveDisconnectedView) {
        const disconnected: DirectoryStatus = { path, available: false, kind: path.startsWith("\\\\") ? "network" : /^[A-Za-z]:/.test(path) ? "drive" : "folder", reason: "unknown" };
        unavailableLocationRef.current = disconnected;
        setUnavailableLocation(disconnected);
        markPathAvailability(path, false);
        if (previousListing?.path.toLocaleLowerCase() === requestedKey) setListing(previousListing);
        else setListing({ path, entries: [], folderCount: 0, fileCount: 0 });
        setAddress(path);
        if (!openingStoredTab && knownDisconnected) {
          setTabs((current) => current.map((tab) => {
            if (tab.id !== tabId) return tab;
            const label = locations.find((location) => location.path.toLocaleLowerCase() === requestedKey)?.label ?? labelForPath(path);
            if (!recordHistory) return { ...tab, path, label };
            const history = [...tab.history.slice(0, tab.historyIndex + 1), path];
            return { ...tab, path, label, history, historyIndex: history.length - 1, scrollTop: 0, selectedPaths: [] };
          }));
        }
        setStatus(language === "zh-CN" ? `“${path}”暂时不可用；恢复连接后会自动同步。` : `“${path}” is unavailable and will sync when it reconnects.`);
      } else if (previousListing) {
        setListing(previousListing);
        setAddress(previousListing.path);
        setStatus(language === "zh-CN" ? `无法打开“${path}”：${String(error)}` : `Could not open “${path}”: ${String(error)}`);
      } else {
        setStatus(language === "zh-CN" ? `无法打开“${path}”：${String(error)}` : `Could not open “${path}”: ${String(error)}`);
      }
    } finally {
      if (directoryLoadJobIdRef.current === jobId) {
        directoryLoadJobIdRef.current = null;
        setIsLoading(false);
      }
    }
  }

  async function openExternalTarget(target: ExternalOpenTarget) {
    const targetKey = target.directory.toLocaleLowerCase();
    const selectedPaths = target.selectedPath ? [target.selectedPath] : [];
    let targetTab = tabsRef.current.find((tab) => tab.path.toLocaleLowerCase() === targetKey) ?? null;
    if (!targetTab) {
      externalTabSeedRef.current += 1;
      targetTab = {
        id: Date.now() + externalTabSeedRef.current,
        path: target.directory,
        label: labelForPath(target.directory),
        pinned: false,
        history: [target.directory],
        historyIndex: 0,
        scrollTop: 0,
        viewMode,
        selectedPaths,
      };
      setTabs((current) => [...current, targetTab!]);
    } else {
      const tabId = targetTab.id;
      setTabs((current) => current.map((tab) => tab.id === tabId ? { ...tab, selectedPaths, scrollTop: 0 } : tab));
      targetTab = { ...targetTab, selectedPaths, scrollTop: 0 };
    }
    setActiveTabId(targetTab.id);
    await browse(target.directory, targetTab.id, false, targetTab);
  }

  useEffect(() => {
    if (!startupComplete) return;
    let disposed = false;
    const openTargets = (targets: ExternalOpenTarget[]) => {
      if (disposed || !targets.length) return;
      void (async () => {
        for (const target of targets) {
          if (disposed) return;
          await openExternalTarget(target);
        }
      })();
    };
    const unlistenPromise = listen<ExternalOpenTarget[]>("flow-open-targets", (event) => openTargets(event.payload));
    void invoke<ExternalOpenTarget[]>("take_external_open_targets").then(openTargets).catch(() => undefined);
    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [startupComplete]);

  useEffect(() => {
    void invoke<FolderIntegrationStatus>("get_folder_integration_status")
      .then(setFolderIntegration)
      .catch(() => setFolderIntegration(null));
    void invoke<FolderIntegrationStatus>("get_folder_context_menu_status")
      .then(setFolderContextMenu)
      .catch(() => setFolderContextMenu(null));
  }, []);

  async function toggleFolderIntegration() {
    const enabled = !(folderIntegration?.enabled ?? false);
    setFolderIntegrationBusy(true);
    setFolderIntegrationError(null);
    try {
      setFolderIntegration(await invoke<FolderIntegrationStatus>("set_folder_integration_enabled", { enabled }));
    } catch (error) {
      setFolderIntegrationError(`${text.windowsFolderIntegrationFailed}: ${String(error)}`);
    } finally {
      setFolderIntegrationBusy(false);
    }
  }

  async function toggleFolderContextMenu() {
    const enabled = !(folderContextMenu?.enabled ?? false);
    setFolderContextMenuBusy(true);
    setFolderContextMenuError(null);
    try {
      setFolderContextMenu(await invoke<FolderIntegrationStatus>("set_folder_context_menu_enabled", { enabled }));
    } catch (error) {
      setFolderContextMenuError(`${text.explorerContextMenuFailed}: ${String(error)}`);
    } finally {
      setFolderContextMenuBusy(false);
    }
  }

  async function refreshDirectory(path: string) {
    try {
      const nextListing = await invoke<DirectoryListing>("list_directory", { path });
      const previousListing = listingRef.current;
      if (previousListing?.path.toLocaleLowerCase() === nextListing.path.toLocaleLowerCase()) {
        const previousByPath = new Map(previousListing.entries.map((entry) => [entry.path.toLocaleLowerCase(), entry]));
        const nextPaths = new Set(nextListing.entries.map((entry) => entry.path.toLocaleLowerCase()));
        const invalidPaths = new Set<string>();
        for (const previous of previousListing.entries) {
          if (!nextPaths.has(previous.path.toLocaleLowerCase())) invalidPaths.add(previous.path);
        }
        for (const entry of nextListing.entries) {
          const previous = previousByPath.get(entry.path.toLocaleLowerCase());
          if (previous && (previous.size !== entry.size || previous.modifiedUnixSeconds !== entry.modifiedUnixSeconds || previous.extension !== entry.extension)) {
            invalidPaths.add(entry.path);
          }
        }
        if (invalidPaths.size) {
          const thumbnailJobId = thumbnailJobIdRef.current;
          if (thumbnailJobId) void invoke("cancel_thumbnail_job", { jobId: thumbnailJobId }).catch(() => undefined);
          setThumbnailCache((current) => {
            const next = { ...current };
            invalidPaths.forEach((invalidPath) => delete next[invalidPath]);
            return next;
          });
          setFileIconCache((current) => {
            const next = { ...current };
            invalidPaths.forEach((invalidPath) => delete next[invalidPath]);
            return next;
          });
        }
      }
      setListing((current) => current?.path.toLocaleLowerCase() === path.toLocaleLowerCase() ? nextListing : current);
      setTreeChildren((current) => {
        const key = nextListing.path.toLocaleLowerCase();
        return Object.prototype.hasOwnProperty.call(current, key) ? { ...current, [key]: nextListing.entries.filter((entry) => entry.isDirectory) } : current;
      });
      if (searchResults === null) {
        const existingPaths = new Set(nextListing.entries.map((entry) => entry.path));
        setSelectedPaths((current) => new Set([...current].filter((selectedPath) => existingPaths.has(selectedPath))));
        setSelected((current) => current ? (nextListing.entries.find((entry) => entry.path === current.path) ?? null) : null);
      }
      setStatus(language === "zh-CN" ? `${nextListing.folderCount} 个文件夹 · ${nextListing.fileCount} 个文件 · 已自动同步` : `${nextListing.folderCount} folders · ${nextListing.fileCount} files · Synced`);
    } catch (error) {
      setStatus(language === "zh-CN" ? `自动刷新失败：${String(error)}` : `Automatic refresh failed: ${String(error)}`);
    }
  }

  async function activateTab(tab: FolderTab) {
    setTabs((current) => current.map((candidate) => candidate.id === activeTabId ? { ...candidate, scrollTop, viewMode, selectedPaths: [...selectedPaths] } : candidate));
    setActiveTabId(tab.id);
    await browse(tab.path, tab.id, false, tab);
  }

  function openNewTab(path = activeTab?.path) {
    if (!path) return;
    const tab: FolderTab = { id: Date.now(), path, label: labelForPath(path), pinned: false, history: [path], historyIndex: 0, scrollTop: 0, viewMode, selectedPaths: [] };
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    void browse(path, tab.id, false, tab);
  }

  function openTabContextMenu(tabId: number, event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setOpenMenu(null);
    setTabContextMenu({ x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 150), tabId });
  }

  function armTabReorder(tabId: number, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".tab-close"))) return;
    tabReorderRef.current = { tabId, startX: event.clientX, startY: event.clientY, active: false, targetId: null, side: "before" };
  }

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = tabReorderRef.current;
      if (!drag) return;
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
      if (!drag.active) {
        drag.active = true;
        suppressTabClickRef.current = true;
        setDraggedTabId(drag.tabId);
        document.body.style.cursor = "grabbing";
      }
      const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".tab[data-tab-id]") ?? null;
      const targetId = Number(targetElement?.dataset.tabId);
      const source = tabs.find((tab) => tab.id === drag.tabId);
      const target = Number.isFinite(targetId) ? tabs.find((tab) => tab.id === targetId) : null;
      if (!source || !target || source.id === target.id || source.pinned !== target.pinned || !targetElement) {
        drag.targetId = null;
        setTabDropId(null);
      } else {
        const bounds = targetElement.getBoundingClientRect();
        drag.targetId = target.id;
        drag.side = event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
        setTabDropId(target.id);
        setTabDropSide(drag.side);
      }
      event.preventDefault();
    };
    const finish = (cancelled: boolean) => {
      const drag = tabReorderRef.current;
      tabReorderRef.current = null;
      document.body.style.cursor = "";
      if (drag?.active && !cancelled && drag.targetId !== null) {
        setTabs((current) => {
          const source = current.find((tab) => tab.id === drag.tabId);
          const target = current.find((tab) => tab.id === drag.targetId);
          if (!source || !target || source.pinned !== target.pinned) return current;
          const next = current.filter((tab) => tab.id !== source.id);
          const targetIndex = next.findIndex((tab) => tab.id === target.id);
          next.splice(targetIndex + (drag.side === "after" ? 1 : 0), 0, source);
          return next;
        });
      }
      setDraggedTabId(null);
      setTabDropId(null);
      if (drag?.active) window.setTimeout(() => { suppressTabClickRef.current = false; }, 0);
    };
    const release = () => finish(false);
    const cancel = () => finish(true);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      document.body.style.cursor = "";
    };
  }, [tabs]);

  function toggleTabPinned(tabId: number) {
    setTabs((current) => {
      const updated = current.map((tab) => tab.id === tabId ? { ...tab, pinned: !tab.pinned } : tab);
      return [...updated.filter((tab) => tab.pinned), ...updated.filter((tab) => !tab.pinned)];
    });
    setTabContextMenu(null);
  }

  function closeTabById(tabId: number) {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.pinned || tabs.length === 1) return;
    const closedTab = tabId === activeTabId ? { ...tab, scrollTop, viewMode, selectedPaths: [...selectedPaths] } : tab;
    setClosedTabs((current) => [closedTab, ...current].slice(0, 10));
    const closingIndex = tabs.findIndex((candidate) => candidate.id === tabId);
    const remaining = tabs.filter((candidate) => candidate.id !== tabId);
    setTabs(remaining);
    setTabContextMenu(null);
    if (tabId === activeTabId) void activateTab(remaining[Math.min(closingIndex, remaining.length - 1)]);
  }

  function closeOtherTabs(tabId: number) {
    const target = tabs.find((tab) => tab.id === tabId);
    if (!target) return;
    const remaining = tabs.filter((tab) => tab.id === tabId || tab.pinned);
    const newlyClosed = tabs.filter((tab) => tab.id !== tabId && !tab.pinned);
    if (newlyClosed.length) setClosedTabs((current) => [...newlyClosed.reverse(), ...current].slice(0, 10));
    setTabs(remaining);
    setTabContextMenu(null);
    if (!remaining.some((tab) => tab.id === activeTabId)) void activateTab(target);
  }

  function closeTab(event: ReactMouseEvent, tabId: number) {
    event.stopPropagation();
    closeTabById(tabId);
  }

  function duplicateTab(tab: FolderTab) {
    const source = tab.id === activeTabId ? { ...tab, scrollTop, viewMode, selectedPaths: [...selectedPaths] } : tab;
    const duplicate: FolderTab = { ...source, id: Date.now(), pinned: false, history: [...source.history], selectedPaths: [...source.selectedPaths] };
    setTabs((current) => {
      const index = current.findIndex((candidate) => candidate.id === tab.id);
      const next = [...current];
      next.splice(index + 1, 0, duplicate);
      return next;
    });
    setTabContextMenu(null);
    setActiveTabId(duplicate.id);
    void browse(duplicate.path, duplicate.id, false, duplicate);
  }

  function reopenClosedTab() {
    const [closed, ...remaining] = closedTabs;
    if (!closed) return;
    const reopened: FolderTab = { ...closed, id: Date.now(), pinned: false, history: [...closed.history], selectedPaths: [...closed.selectedPaths] };
    setClosedTabs(remaining);
    setTabs((current) => [...current, reopened]);
    setTabContextMenu(null);
    setActiveTabId(reopened.id);
    void browse(reopened.path, reopened.id, false, reopened);
  }

  function openHistoryMenu(direction: "back" | "forward", event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!activeTab) return;
    const items = direction === "back"
      ? activeTab.history.slice(0, activeTab.historyIndex).map((path, index) => ({ path, index })).reverse()
      : activeTab.history.slice(activeTab.historyIndex + 1).map((path, offset) => ({ path, index: activeTab.historyIndex + offset + 1 }));
    if (!items.length) return;
    setContextMenu(null);
    setTabContextMenu(null);
    setHistoryMenu({ x: Math.min(event.clientX, window.innerWidth - 280), y: Math.min(event.clientY, window.innerHeight - 260), items });
  }

  function navigateToHistory(index: number, path: string) {
    if (!activeTab) return;
    setTabs((current) => current.map((tab) => tab.id === activeTab.id ? { ...tab, historyIndex: index } : tab));
    setHistoryMenu(null);
    void browse(path, activeTab.id, false);
  }

  function goBack() {
    if (!activeTab || activeTab.historyIndex === 0) return;
    const nextIndex = activeTab.historyIndex - 1;
    setTabs((current) => current.map((tab) => tab.id === activeTab.id ? { ...tab, historyIndex: nextIndex } : tab));
    void browse(activeTab.history[nextIndex], activeTab.id, false);
  }

  function goForward() {
    if (!activeTab || activeTab.historyIndex >= activeTab.history.length - 1) return;
    const nextIndex = activeTab.historyIndex + 1;
    setTabs((current) => current.map((tab) => tab.id === activeTab.id ? { ...tab, historyIndex: nextIndex } : tab));
    void browse(activeTab.history[nextIndex], activeTab.id, false);
  }

  async function openEntry(entry: FileEntry) {
    if (entry.isDirectory) { await browse(entry.path); return; }
    try { await invoke("open_path", { path: entry.path }); setStatus(language === "zh-CN" ? `已打开 ${entry.name}` : `Opened ${entry.name}.`); }
    catch (error) { setStatus(language === "zh-CN" ? `无法打开 ${entry.name}：${String(error)}` : `Could not open ${entry.name}: ${String(error)}`); }
  }

  async function createItem(kind: "folder" | "text" | "markdown") {
    if (!listing || operation || searchResults !== null) return;
    const parentPath = listing.path;
    const baseName = kind === "folder"
      ? (language === "zh-CN" ? "新建文件夹" : "New folder")
      : kind === "text"
        ? (language === "zh-CN" ? "新建文本文档.txt" : "New Text Document.txt")
        : (language === "zh-CN" ? "新建 Markdown 文档.md" : "New Markdown Document.md");
    const existingNames = new Set(listing.entries.map((entry) => entry.name.toLocaleLowerCase()));
    let name = baseName;
    const extensionIndex = kind === "folder" ? -1 : baseName.lastIndexOf(".");
    const stem = extensionIndex > 0 ? baseName.slice(0, extensionIndex) : baseName;
    const extension = extensionIndex > 0 ? baseName.slice(extensionIndex) : "";
    for (let suffix = 2; existingNames.has(name.toLocaleLowerCase()); suffix += 1) name = `${stem} (${suffix})${extension}`;
    setOpenMenu(null);
    setContextMenu(null);
    try {
      await invoke(kind === "folder" ? "create_folder" : "create_file", { parentPath, name });
      const nextListing = await invoke<DirectoryListing>("list_directory", { path: parentPath });
      const created = nextListing.entries.find((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase() && entry.isDirectory === (kind === "folder"));
      setListing(nextListing);
      setTreeChildren((current) => {
        const key = parentPath.toLocaleLowerCase();
        return Object.prototype.hasOwnProperty.call(current, key) ? { ...current, [key]: nextListing.entries.filter((entry) => entry.isDirectory) } : current;
      });
      setQuery("");
      if (created) {
        pushUndo({ kind: "deleteCreated", paths: [created.path] }, language === "zh-CN" ? `新建“${created.name}”` : `Create “${created.name}”`);
        const visible = sortEntriesForView(showHidden ? nextListing.entries : nextListing.entries.filter((entry) => !entry.isHidden), sortKey, sortDirection, language);
        const index = Math.max(0, visible.findIndex((entry) => entry.path === created.path));
        const targetTop = Math.floor(index / gridColumns) * rowHeight;
        setSelected(created);
        setSelectedPaths(new Set([created.path]));
        setSelectionAnchor(index);
        setRenamingPath(created.path);
        setRenameValue(created.name);
        setRenameError(null);
        setScrollTop(targetTop);
        window.requestAnimationFrame(() => { if (fileListRef.current) fileListRef.current.scrollTop = targetTop; });
      }
      setStatus(language === "zh-CN" ? "项目已创建，请直接输入名称" : "Item created. Type its name.");
    } catch (error) { setStatus(language === "zh-CN" ? `无法创建项目：${String(error)}` : `Could not create item: ${String(error)}`); }
  }

  async function compressSelection() {
    if (!listing || selectedEntries.length === 0 || operation || archiveBusy) return;
    const first = selectedEntries[0];
    const firstStem = first.isDirectory ? first.name : first.name.replace(/\.[^.]+$/, "") || first.name;
    const archiveName = `${selectedEntries.length === 1 ? firstStem : language === "zh-CN" ? "压缩文件" : "Archive"}.zip`;
    setOpenMenu(null);
    setContextMenu(null);
    setArchiveBusy(true);
    setStatus(language === "zh-CN" ? `正在压缩 ${selectedEntries.length} 项…` : `Compressing ${selectedEntries.length} item(s)…`);
    try {
      const output = await invoke<string>("create_zip_archive", { paths: selectedEntries.map((entry) => entry.path), destination: listing.path, archiveName });
      pushUndo({ kind: "deleteCreated", paths: [output] }, language === "zh-CN" ? `创建压缩包“${labelForPath(output)}”` : `Create archive “${labelForPath(output)}”`);
      await browse(listing.path, activeTabId, false);
      setStatus(language === "zh-CN" ? `已创建 ${output}` : `Created ${output}.`);
    } catch (error) {
      setStatus(language === "zh-CN" ? `压缩失败：${String(error)}` : `Compression failed: ${String(error)}`);
    } finally {
      setArchiveBusy(false);
    }
  }

  async function extractSelectedZip() {
    if (!listing || selectedEntries.length !== 1 || selectedEntries[0].extension?.toLowerCase() !== "zip" || operation || archiveBusy) return;
    const source = selectedEntries[0];
    setOpenMenu(null);
    setContextMenu(null);
    setArchiveBusy(true);
    setStatus(language === "zh-CN" ? `正在解压 ${source.name}…` : `Extracting ${source.name}…`);
    try {
      const output = await invoke<string>("extract_zip_archive", { path: source.path, destination: listing.path });
      pushUndo({ kind: "deleteCreated", paths: [output] }, language === "zh-CN" ? `解压“${source.name}”` : `Extract “${source.name}”`);
      await browse(listing.path, activeTabId, false);
      setStatus(language === "zh-CN" ? `已解压到 ${output}` : `Extracted to ${output}.`);
    } catch (error) {
      setStatus(language === "zh-CN" ? `解压失败：${String(error)}` : `Extraction failed: ${String(error)}`);
    } finally {
      setArchiveBusy(false);
    }
  }

  function beginBatchRename() {
    if (selectedEntries.length < 2 || operation || archiveBusy) return;
    setOpenMenu(null);
    setContextMenu(null);
    setBatchRenameError(null);
    setBatchRenameDraft({ find: "", replace: "", prefix: "", suffix: "", addNumbers: false, startNumber: 1 });
    setBatchRenameOpen(true);
  }

  async function applyBatchRename() {
    if (!listing || archiveBusy) return;
    const changed = batchRenamePreview.filter(({ entry, name }) => name !== entry.name);
    if (!changed.length) {
      setBatchRenameError(language === "zh-CN" ? "请先设置至少一种名称变化。" : "Choose at least one name change first.");
      return;
    }
    const invalid = changed.find(({ name }) => !name.trim() || /[\\/:*?"<>|]/.test(name) || /[. ]$/.test(name));
    if (invalid) {
      setBatchRenameError(language === "zh-CN" ? `“${invalid.name}”不是有效的 Windows 名称。` : `“${invalid.name}” is not a valid Windows name.`);
      return;
    }
    const targets = changed.map(({ entry, name }) => joinWindowsPath(parentDirectory(entry.path), name).toLocaleLowerCase());
    if (new Set(targets).size !== targets.length) {
      setBatchRenameError(language === "zh-CN" ? "有两个项目会得到相同名称。" : "Two items would receive the same name.");
      return;
    }
    setArchiveBusy(true);
    setBatchRenameError(null);
    try {
      const undo = await invoke<UndoAction>("batch_rename", { items: changed.map(({ entry, name }) => ({ from: entry.path, to: joinWindowsPath(parentDirectory(entry.path), name) })) });
      pushUndo(undo, language === "zh-CN" ? `批量重命名 ${changed.length} 项` : `Batch rename ${changed.length} item(s)`);
      setBatchRenameOpen(false);
      setSelected(null);
      setSelectedPaths(new Set());
      await browse(listing.path, activeTabId, false);
      setStatus(language === "zh-CN" ? `已重命名 ${changed.length} 个项目，可撤销` : `Renamed ${changed.length} item(s). You can undo this operation.`);
    } catch (error) {
      setBatchRenameError(friendlyRenameError(error));
    } finally {
      setArchiveBusy(false);
    }
  }

  function beginRename() {
    if (!selected || selectedPaths.size !== 1 || operation || searchResults !== null) return;
    setRenamingPath(selected.path);
    setRenameValue(selected.name);
    setRenameError(null);
    setOpenMenu(null);
  }

  function friendlyRenameError(error: unknown) {
    const raw = String(error).replace(/^Error:\s*/i, "");
    if (/already exists|os error 183/i.test(raw)) return language === "zh-CN" ? "同一文件夹中已经有同名项目。" : "An item with this name already exists.";
    if (/cannot contain/i.test(raw)) return language === "zh-CN" ? "名称不能包含 \\ / : * ? \" < > |。" : "The name cannot contain \\ / : * ? \" < > |.";
    if (/end with a space or period/i.test(raw)) return language === "zh-CN" ? "名称不能以空格或句点结尾。" : "The name cannot end with a space or period.";
    if (/reserved by Windows/i.test(raw)) return language === "zh-CN" ? "这是 Windows 保留名称，请换一个名称。" : "This name is reserved by Windows.";
    if (/too long/i.test(raw)) return language === "zh-CN" ? "名称太长。" : "The name is too long.";
    if (/valid name/i.test(raw)) return language === "zh-CN" ? "请输入有效名称。" : "Enter a valid name.";
    return language === "zh-CN" ? `无法重命名：${raw}` : `Could not rename item: ${raw}`;
  }

  async function commitRename() {
    const source = selected;
    const newName = renameValue;
    if (!source || !listing) return;
    if (!newName) { setRenameError(language === "zh-CN" ? "名称不能为空。" : "The name cannot be empty."); return; }
    if (newName === source.name) { setRenamingPath(null); setRenameError(null); return; }
    try {
      await invoke("rename_path", { path: source.path, newName });
      const renamedPath = joinWindowsPath(parentDirectory(source.path), newName.trim());
      pushUndo({ kind: "move", pairs: [{ from: renamedPath, to: source.path }] }, language === "zh-CN" ? `将“${source.name}”重命名为“${newName.trim()}”` : `Rename “${source.name}” to “${newName.trim()}”`);
      setRenamingPath(null);
      setRenameError(null);
      await refreshDirectory(listing.path);
      setStatus(language === "zh-CN" ? `已重命名为“${newName}”` : `Renamed to “${newName}”.`);
    } catch (error) {
      const message = friendlyRenameError(error);
      setRenameError(message);
      setStatus(message);
      window.setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select(); }, 0);
    }
  }

  async function openTerminalAt(path = listing?.path, mode: "shell" | "claude" = "shell") {
    if (!path) return;
    try {
      await invoke("open_terminal", { path, mode, provider: mode === "claude" ? claudeProvider : null, fullAccess: mode === "claude" ? claudeFullAccess : false });
      setStatus(mode === "claude"
        ? (language === "zh-CN" ? `已在 ${path} 启动 Claude Code（${claudeProvider === "deepseek" ? "DeepSeek" : "Anthropic"}）` : `Started Claude Code in ${path} (${claudeProvider === "deepseek" ? "DeepSeek" : "Anthropic"}).`)
        : (language === "zh-CN" ? `已在 ${path} 打开终端` : `Opened Terminal in ${path}.`));
    } catch (error) {
      if (mode === "claude" && claudeProvider === "deepseek") {
        setSettingsOpen(true);
        setClaudeCredentialError(language === "zh-CN" ? "请先在下方保存 DeepSeek API 密钥。保存一次后，以后会自动使用。" : "Save your DeepSeek API key below. Flow Files will reuse it automatically.");
      }
      setStatus(mode === "claude"
        ? (language === "zh-CN" ? `无法启动 Claude Code：${String(error)}` : `Could not start Claude Code: ${String(error)}`)
        : (language === "zh-CN" ? `无法打开终端：${String(error)}` : `Could not open Terminal: ${String(error)}`));
    }
  }

  function terminalPathForSelection() {
    return selectedPaths.size === 1 && selected?.isDirectory ? selected.path : listing?.path;
  }

  async function openWithSelected() {
    if (!selected || selectedPaths.size !== 1 || selected.isDirectory) return;
    try {
      await invoke("open_with", { path: selected.path });
      setStatus(language === "zh-CN" ? `正在选择用于打开“${selected.name}”的应用` : `Choosing an app for “${selected.name}”.`);
    } catch (error) {
      setStatus(language === "zh-CN" ? `无法打开“打开方式”：${String(error)}` : `Could not open the app chooser: ${String(error)}`);
    }
  }

  async function showSelectedProperties() {
    if (!selected || selectedPaths.size !== 1) return;
    try {
      await invoke("show_properties", { path: selected.path });
    } catch (error) {
      setStatus(language === "zh-CN" ? `无法显示属性：${String(error)}` : `Could not show Properties: ${String(error)}`);
    }
  }

  async function revealSelectedInExplorer() {
    if (!selected || selectedPaths.size !== 1) return;
    setContextMenu(null);
    try {
      await invoke("reveal_in_explorer", { path: selected.path });
    } catch (error) {
      setStatus(language === "zh-CN" ? `无法在资源管理器中定位：${String(error)}` : `Could not reveal the item in File Explorer: ${String(error)}`);
    }
  }

  async function showSelectedSystemMenu() {
    if (!selected || selectedPaths.size !== 1) return;
    setContextMenu(null);
    try {
      await invoke("show_system_context_menu", { path: selected.path });
    } catch (error) {
      setStatus(language === "zh-CN" ? `无法打开 Windows 系统菜单：${String(error)}` : `Could not open the Windows system menu: ${String(error)}`);
    }
  }

  async function calculateSelectedFolderSize() {
    if (!selected?.isDirectory || selectedPaths.size !== 1) return;
    const previousJobId = folderSizeJobIdRef.current;
    if (previousJobId) void invoke("cancel_folder_size", { jobId: previousJobId }).catch(() => undefined);
    const jobId = crypto.randomUUID();
    folderSizeJobIdRef.current = jobId;
    setFolderSize({ path: selected.path, totalBytes: 0, scannedFiles: 0, scannedFolders: 0, issues: 0, cancelled: false, running: true });
    try {
      const result = await invoke<FolderSizeResult>("calculate_folder_size", { jobId, path: selected.path });
      if (folderSizeJobIdRef.current !== jobId) return;
      setFolderSize({ ...result, running: false });
      if (!result.cancelled) setStatus(language === "zh-CN" ? `文件夹大小：${formatSize(result.totalBytes)}` : `Folder size: ${formatSize(result.totalBytes)}`);
    } catch (error) {
      if (folderSizeJobIdRef.current !== jobId) return;
      setFolderSize(null);
      setStatus(language === "zh-CN" ? `无法计算文件夹大小：${String(error)}` : `Could not calculate folder size: ${String(error)}`);
    } finally {
      if (folderSizeJobIdRef.current === jobId) folderSizeJobIdRef.current = null;
    }
  }

  function cancelFolderSizeCalculation() {
    const jobId = folderSizeJobIdRef.current;
    if (!jobId) return;
    void invoke("cancel_folder_size", { jobId }).catch(() => undefined);
    setFolderSize((current) => current ? { ...current, running: false, cancelled: true } : current);
  }

  function beginAddressEditing() {
    setAddress(listing?.path ?? address);
    setAddressSuggestionIndex(-1);
    setAddressEditing(true);
    window.setTimeout(() => { addressInputRef.current?.focus(); addressInputRef.current?.select(); }, 0);
  }

  function chooseAddressSuggestion(suggestion: PathSuggestion) {
    setAddress(suggestion.path);
    setAddressSuggestions([]);
    setAddressSuggestionIndex(-1);
    setAddressEditing(false);
    void browse(suggestion.path);
  }

  function handleAddressKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && addressSuggestions.length) {
      event.preventDefault();
      setAddressSuggestionIndex((current) => current >= addressSuggestions.length - 1 ? 0 : current + 1);
    } else if (event.key === "ArrowUp" && addressSuggestions.length) {
      event.preventDefault();
      setAddressSuggestionIndex((current) => current <= 0 ? addressSuggestions.length - 1 : current - 1);
    } else if (event.key === "Tab" && addressSuggestions.length) {
      event.preventDefault();
      const suggestion = addressSuggestions[addressSuggestionIndex >= 0 ? addressSuggestionIndex : 0];
      setAddress(suggestion.path.endsWith("\\") ? suggestion.path : `${suggestion.path}\\`);
      setAddressSuggestionIndex(-1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setAddress(listing?.path ?? "");
      setAddressEditing(false);
    }
  }

  function submitAddress(event: FormEvent) {
    event.preventDefault();
    const selectedSuggestion = addressSuggestionIndex >= 0 ? addressSuggestions[addressSuggestionIndex] : null;
    const target = selectedSuggestion?.path ?? address.trim();
    if (target) void browse(target);
    setAddressSuggestions([]);
    setAddressSuggestionIndex(-1);
    setAddressEditing(false);
  }

  function openSpaceHealth() {
    const systemDrive = locations.find((location) => location.path.toLocaleLowerCase() === "c:\\")
      ?? locations.find((location) => /^[A-Za-z]:\\$/.test(location.path) && location.isAvailable);
    if (systemDrive && !spaceScanResult) {
      const history = readSpaceScanHistory()[systemDrive.path.toLocaleLowerCase()] ?? [];
      setSpaceScanDrive(systemDrive.path);
      setSpaceScanRoot(systemDrive.path);
      setSpaceSnapshotHistory(history);
      setSpacePreviousSnapshot(history[history.length - 1] ?? null);
    }
    setOpenMenu(null);
    setTaskCenterOpen(false);
    setSettingsOpen(false);
    setSpaceHealthOpen(true);
  }

  async function startSpaceScan(root = spaceScanRoot) {
    const previous = spaceScanJobIdRef.current;
    if (previous) await invoke("cancel_space_scan", { jobId: previous }).catch(() => undefined);
    const jobId = crypto.randomUUID();
    const wholeDrive = /^[A-Za-z]:\\$/.test(root);
    const snapshotKey = root.toLocaleLowerCase();
    const history = wholeDrive ? readSpaceScanHistory()[snapshotKey] ?? [] : [];
    setSpaceScanRoot(root);
    setSpaceSnapshotHistory(history);
    setSpacePreviousSnapshot(history[history.length - 1] ?? null);
    spaceScanJobIdRef.current = jobId;
    setSpaceScanning(true);
    setSpaceScanProgress({ jobId, scannedBytes: 0, scannedFiles: 0, scannedFolders: 0, issues: 0, currentPath: root });
    setSpaceScanResult(null);
    setSpaceScanError(null);
    setSpaceAdviceCategoryId(null);
    setSpaceCleanupPreview(null);
    setSpaceCleanupSelected(new Set());
    setSpaceCleanupAge("all");
    setSpaceCleanupConfirmOpen(false);
    setSpaceCleanupMessage(null);
    setSpaceCleanupError(null);
    const duplicateJob = duplicateScanJobIdRef.current;
    if (duplicateJob) await invoke("cancel_duplicate_scan", { jobId: duplicateJob }).catch(() => undefined);
    duplicateScanJobIdRef.current = null;
    setDuplicateScanning(false);
    setDuplicateProgress(null);
    setDuplicateResult(null);
    setDuplicateError(null);
    try {
      const result = await invoke<SpaceScanResult>("scan_disk_space", { jobId, root });
      if (spaceScanJobIdRef.current !== jobId) return;
      setSpaceScanResult(result);
      if (!result.cancelled && /^[A-Za-z]:\\$/.test(result.root)) {
        setSpaceSnapshotHistory(appendSpaceScanSnapshot(result));
      }
    } catch (error) {
      if (spaceScanJobIdRef.current === jobId) setSpaceScanError(String(error));
    } finally {
      if (spaceScanJobIdRef.current === jobId) {
        spaceScanJobIdRef.current = null;
        setSpaceScanning(false);
      }
    }
  }

  function cancelSpaceScan() {
    const jobId = spaceScanJobIdRef.current;
    if (jobId) void invoke("cancel_space_scan", { jobId }).catch(() => undefined);
  }

  async function startDuplicateScan() {
    const previous = duplicateScanJobIdRef.current;
    if (previous) await invoke("cancel_duplicate_scan", { jobId: previous }).catch(() => undefined);
    const jobId = crypto.randomUUID();
    duplicateScanJobIdRef.current = jobId;
    setDuplicateScanning(true);
    setDuplicateResult(null);
    setDuplicateError(null);
    setDuplicateCleanupSelected(new Set());
    setDuplicateCleanupConfirmOpen(false);
    setDuplicateCleanupAcknowledged(false);
    setDuplicateCleanupMessage(null);
    setDuplicateFilterQuery("");
    setDuplicateSizeFilter("all");
    setDuplicateTypeFilter("all");
    setDuplicateProgress({ jobId, phase: "scanning", scannedFiles: 0, candidateFiles: 0, processedBytes: 0, currentPath: spaceScanRoot });
    try {
      const result = await invoke<DuplicateScanResult>("scan_duplicate_files", { request: { jobId, root: spaceScanRoot, minimumSize: 1024 * 1024 } });
      if (duplicateScanJobIdRef.current === jobId) setDuplicateResult(result);
    } catch (error) {
      if (duplicateScanJobIdRef.current === jobId) setDuplicateError(String(error));
    } finally {
      if (duplicateScanJobIdRef.current === jobId) {
        duplicateScanJobIdRef.current = null;
        setDuplicateScanning(false);
      }
    }
  }

  function cancelDuplicateScan() {
    const jobId = duplicateScanJobIdRef.current;
    if (jobId) void invoke("cancel_duplicate_scan", { jobId }).catch(() => undefined);
  }

  function toggleDuplicateCleanupItem(group: DuplicateGroup, path: string) {
    setDuplicateCleanupMessage(null);
    setDuplicateCleanupSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
        return next;
      }
      const selectedInGroup = group.files.filter((item) => next.has(item.path)).length;
      if (selectedInGroup >= group.files.length - 1) {
        setDuplicateCleanupMessage(language === "zh-CN" ? "每组必须至少保留一份；不能把这一组全部选中。" : "At least one copy must remain in every group.");
        return current;
      }
      next.add(path);
      return next;
    });
    setDuplicateCleanupConfirmOpen(false);
    setDuplicateCleanupAcknowledged(false);
  }

  function resetDuplicateSelectionForFilter() {
    setDuplicateCleanupSelected(new Set());
    setDuplicateCleanupConfirmOpen(false);
    setDuplicateCleanupAcknowledged(false);
    setDuplicateCleanupMessage(null);
  }

  function changeDuplicateFilterQuery(value: string) {
    setDuplicateFilterQuery(value);
    resetDuplicateSelectionForFilter();
  }

  function changeDuplicateSizeFilter(value: DuplicateSizeFilter) {
    setDuplicateSizeFilter(value);
    resetDuplicateSelectionForFilter();
  }

  function changeDuplicateTypeFilter(value: DuplicateTypeFilter) {
    setDuplicateTypeFilter(value);
    resetDuplicateSelectionForFilter();
  }

  async function confirmDuplicateCleanup() {
    const result = duplicateResult;
    if (!result || !duplicateCleanupAcknowledged || !duplicateCleanupSelected.size) return;
    const groups = result.groups.flatMap((group) => {
      const recyclePaths = group.files.filter((item) => duplicateCleanupSelected.has(item.path)).map((item) => item.path);
      const keepPath = group.files.find((item) => !duplicateCleanupSelected.has(item.path))?.path;
      return recyclePaths.length && keepPath ? [{ keepPath, recyclePaths }] : [];
    });
    if (!groups.length) return;
    const selectedLookup = new Set(duplicateCleanupSelected);
    setDuplicateCleanupBusy(true);
    setDuplicateError(null);
    setDuplicateCleanupMessage(language === "zh-CN" ? "正在重新校验所选文件的完整内容…" : "Re-verifying the full contents of selected files…");
    try {
      const operationResult = await invoke<FileOperationResult>("recycle_verified_duplicates", { request: { root: result.root, groups } });
      if (operationResult.undo) pushUndo(operationResult.undo, language === "zh-CN" ? `清理重复文件 ${operationResult.completed} 项` : `Clean up ${operationResult.completed} duplicate(s)`);
      const failed = new Set(operationResult.issues.map((issue) => issue.path.toLocaleLowerCase()));
      const removed = new Set([...selectedLookup].filter((path) => !failed.has(path.toLocaleLowerCase())).map((path) => path.toLocaleLowerCase()));
      setDuplicateResult((current) => {
        if (!current) return current;
        const groups = current.groups.flatMap((group) => {
          const files = group.files.filter((item) => !removed.has(item.path.toLocaleLowerCase()));
          if (files.length < 2) return [];
          return [{ ...group, files, reclaimableBytes: group.fileSize * (files.length - 1) }];
        });
        return { ...current, groups, reclaimableBytes: groups.reduce((sum, group) => sum + group.reclaimableBytes, 0) };
      });
      setDuplicateCleanupSelected(new Set());
      setDuplicateCleanupConfirmOpen(false);
      setDuplicateCleanupAcknowledged(false);
      setDuplicateCleanupMessage(operationResult.issues.length
        ? (language === "zh-CN" ? `已移入回收站 ${operationResult.completed} 个文件；${operationResult.issues.length} 个文件被跳过。` : `${operationResult.completed} file(s) recycled; ${operationResult.issues.length} skipped.`)
        : (language === "zh-CN" ? `已将 ${operationResult.completed} 个经重新校验的重复文件移入回收站，可通过撤销恢复。` : `${operationResult.completed} re-verified duplicate(s) moved to the Recycle Bin and can be undone.`));
    } catch (error) {
      setDuplicateError(String(error));
      setDuplicateCleanupMessage(null);
    } finally {
      setDuplicateCleanupBusy(false);
    }
  }

  function closeSpaceHealth() {
    cancelSpaceScan();
    cancelDuplicateScan();
    setSpaceHealthOpen(false);
  }

  async function openSpaceScanItem(item: SpaceScanItem) {
    closeSpaceHealth();
    const target = item.isDirectory ? item.path : parentDirectory(item.path);
    const restoreState = !item.isDirectory && activeTab ? { ...activeTab, path: target, scrollTop: 0, selectedPaths: [item.path] } : null;
    await browse(target, activeTabId, true, restoreState);
  }

  function drillIntoSpaceDirectory(item: SpaceScanItem) {
    if (!item.isDirectory || spaceScanning) return;
    void startSpaceScan(item.path);
  }

  function scanParentSpaceDirectory() {
    if (spaceScanning || spaceScanRoot.toLocaleLowerCase() === spaceScanDrive.toLocaleLowerCase()) return;
    const parent = parentDirectory(spaceScanRoot);
    void startSpaceScan(parent.length < spaceScanDrive.length ? spaceScanDrive : parent);
  }

  function showSpaceAdvice(category: SpaceScanCategory) {
    setSpaceAdviceCategoryId(category.id);
    setSpaceCleanupPreview(null);
    setSpaceCleanupSelected(new Set());
    setSpaceCleanupAge("all");
    setSpaceCleanupConfirmOpen(false);
    setSpaceCleanupAcknowledged(false);
    setSpaceCleanupMessage(null);
    setSpaceCleanupError(null);
  }

  async function prepareSpaceCleanup(category: SpaceScanCategory) {
    showSpaceAdvice(category);
    setSpaceCleanupLoading(true);
    try {
      const preview = await invoke<SpaceCleanupPreview>("preview_space_cleanup", { root: spaceScanRoot, categoryId: category.id });
      setSpaceCleanupPreview(preview);
    } catch (error) {
      setSpaceCleanupError(String(error));
    } finally {
      setSpaceCleanupLoading(false);
    }
  }

  function toggleSpaceCleanupItem(path: string) {
    setSpaceCleanupSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
    setSpaceCleanupConfirmOpen(false);
    setSpaceCleanupAcknowledged(false);
  }

  function changeSpaceCleanupAge(age: SpaceCleanupAge) {
    setSpaceCleanupAge(age);
    setSpaceCleanupSelected(new Set());
    setSpaceCleanupConfirmOpen(false);
    setSpaceCleanupAcknowledged(false);
  }

  async function revealSpaceCleanupItem(path: string) {
    try {
      await invoke("reveal_in_explorer", { path });
    } catch (error) {
      setSpaceCleanupError(String(error));
    }
  }

  async function confirmSpaceCleanup() {
    const preview = spaceCleanupPreview;
    if (!preview || !spaceCleanupAcknowledged || !spaceCleanupSelected.size) return;
    const selectedPaths = [...spaceCleanupSelected];
    const selectedLookup = new Set(selectedPaths.map((path) => path.toLocaleLowerCase()));
    setSpaceCleanupLoading(true);
    setSpaceCleanupError(null);
    try {
      const result = await invoke<FileOperationResult>("recycle_space_cleanup_paths", { root: preview.root, categoryId: preview.categoryId, paths: selectedPaths });
      if (result.undo) pushUndo(result.undo, language === "zh-CN" ? `安全清理 ${result.completed} 个文件` : `Safe cleanup of ${result.completed} file(s)`);
      const failed = new Set(result.issues.map((issue) => issue.path.toLocaleLowerCase()));
      const removed = preview.candidates.filter((item) => selectedLookup.has(item.path.toLocaleLowerCase()) && !failed.has(item.path.toLocaleLowerCase()));
      const removedBytes = removed.reduce((sum, item) => sum + item.size, 0);
      const removedPaths = new Set(removed.map((item) => item.path.toLocaleLowerCase()));
      setSpaceCleanupPreview((current) => current ? { ...current, totalBytes: Math.max(0, current.totalBytes - removedBytes), totalFiles: Math.max(0, current.totalFiles - removed.length), candidates: current.candidates.filter((item) => !removedPaths.has(item.path.toLocaleLowerCase())) } : current);
      setSpaceScanResult((current) => current ? { ...current, categories: current.categories.map((category) => category.id === preview.categoryId ? { ...category, size: Math.max(0, category.size - removedBytes), fileCount: Math.max(0, category.fileCount - removed.length) } : category) } : current);
      setSpaceCleanupSelected(new Set());
      setSpaceCleanupConfirmOpen(false);
      setSpaceCleanupAcknowledged(false);
      setSpaceCleanupMessage(result.issues.length
        ? (language === "zh-CN" ? `已移入回收站 ${result.completed} 个文件；${result.issues.length} 个文件因占用或权限问题被跳过。` : `${result.completed} file(s) recycled; ${result.issues.length} skipped because of access or file-use issues.`)
        : (language === "zh-CN" ? `已将 ${result.completed} 个文件移入回收站，仍可通过撤销恢复。` : `${result.completed} file(s) moved to the Recycle Bin and can still be restored with Undo.`));
    } catch (error) {
      setSpaceCleanupError(String(error));
    } finally {
      setSpaceCleanupLoading(false);
    }
  }

  function renderSpaceHealth() {
    const drives = locations.filter((location) => /^[A-Za-z]:\\$/.test(location.path) && location.isAvailable);
    const result = spaceScanResult;
    const scanningSubdirectory = spaceScanRoot.toLocaleLowerCase() !== spaceScanDrive.toLocaleLowerCase();
    const riskLabel = (risk: SpaceScanCategory["risk"]) => risk === "safe" ? text.safeToReview : risk === "review" ? text.confirmBeforeAction : text.protectedItem;
    const activeCategory = result?.categories.find((category) => category.id === spaceAdviceCategoryId) ?? null;
    const activeAdvice = activeCategory ? spaceCategoryAdvice(activeCategory.id, language) : null;
    const cleanupAgeDays = spaceCleanupAge === "all" ? 0 : Number(spaceCleanupAge);
    const cleanupAgeCutoff = cleanupAgeDays ? Math.floor(Date.now() / 1000) - cleanupAgeDays * 86400 : 0;
    const filteredCleanupCandidates = spaceCleanupPreview?.candidates.filter((item) => !cleanupAgeCutoff || (!!item.modifiedUnixSeconds && item.modifiedUnixSeconds <= cleanupAgeCutoff)) ?? [];
    const filteredCleanupBytes = filteredCleanupCandidates.reduce((sum, item) => sum + item.size, 0);
    const selectedCleanupBytes = spaceCleanupPreview?.candidates.reduce((sum, item) => sum + (spaceCleanupSelected.has(item.path) ? item.size : 0), 0) ?? 0;
    const selectedDuplicateBytes = duplicateResult?.groups.reduce((sum, group) => sum + group.files.reduce((groupSum, item) => groupSum + (duplicateCleanupSelected.has(item.path) ? item.size : 0), 0), 0) ?? 0;
    const duplicateMinimumSize = duplicateSizeFilter === "10mb" ? 10 * 1024 * 1024 : duplicateSizeFilter === "100mb" ? 100 * 1024 * 1024 : duplicateSizeFilter === "1gb" ? 1024 * 1024 * 1024 : 0;
    const duplicateFilterNeedle = duplicateFilterQuery.trim().toLocaleLowerCase();
    const filteredDuplicateGroups = duplicateResult?.groups.filter((group) => group.fileSize >= duplicateMinimumSize && group.files.some((item) => (!duplicateFilterNeedle || item.name.toLocaleLowerCase().includes(duplicateFilterNeedle) || item.path.toLocaleLowerCase().includes(duplicateFilterNeedle)) && duplicateFileMatchesType(item, duplicateTypeFilter))) ?? [];
    return <div className="settings-backdrop space-health-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSpaceHealth(); }}>
      <section className="space-health-panel" role="dialog" aria-modal="true" aria-labelledby="space-health-title">
        <header>
          <div><h2 id="space-health-title">{text.spaceHealthTitle}</h2><p>{text.spaceHealthIntro}</p></div>
          <button className="settings-close" aria-label={text.close} onClick={closeSpaceHealth}>×</button>
        </header>
        <div className="space-health-controls">
          <div className="space-drive-picker" aria-label={text.locations}>{drives.map((drive) => <button key={drive.path} className={spaceScanDrive.toLocaleLowerCase() === drive.path.toLocaleLowerCase() ? "active" : ""} disabled={spaceScanning || duplicateScanning} onClick={() => { const history = readSpaceScanHistory()[drive.path.toLocaleLowerCase()] ?? []; setSpaceScanDrive(drive.path); setSpaceScanRoot(drive.path); setSpaceScanResult(null); setSpaceSnapshotHistory(history); setSpacePreviousSnapshot(history[history.length - 1] ?? null); setSpaceScanError(null); setDuplicateResult(null); setDuplicateError(null); setDuplicateCleanupSelected(new Set()); setDuplicateCleanupMessage(null); }}><strong>{drive.path}</strong><span>{drive.availableSpace !== null ? `${formatSize(drive.availableSpace)} ${text.available}` : "—"}</span></button>)}</div>
          {spaceScanning ? <button className="space-scan-action secondary" onClick={cancelSpaceScan}>{text.stopScan}</button> : <button className="space-scan-action" disabled={!drives.length} onClick={() => void startSpaceScan()}>{result ? text.rescan : text.startScan}</button>}
        </div>
        <div className="space-health-body">
          {(result || scanningSubdirectory) && <div className="space-scope-bar"><button disabled={!scanningSubdirectory || spaceScanning} onClick={scanParentSpaceDirectory}>←</button><div><span>{language === "zh-CN" ? "扫描范围" : "Scan scope"}</span><strong title={spaceScanRoot}>{spaceScanRoot}</strong></div>{result && <div className="space-scope-actions"><button onClick={() => { void invoke("set_text_clipboard", { text: buildSpaceReport(result, language) }).then(() => setStatus(language === "zh-CN" ? "诊断报告已复制到剪贴板" : "Diagnostic report copied to the clipboard")).catch((error) => setStatus(language === "zh-CN" ? `无法复制诊断报告：${String(error)}` : `Could not copy the diagnostic report: ${String(error)}`)); }}>{language === "zh-CN" ? "复制报告" : "Copy report"}</button><button className="space-open-scope" onClick={() => void openSpaceScanItem({ name: labelForPath(result.root), path: result.root, size: result.scannedBytes, modifiedUnixSeconds: null, isDirectory: true })}>{text.openLocation}</button></div>}</div>}
          {spaceScanning && <section className="space-scan-running"><div className="space-scan-running-heading"><strong>{text.scanningSpace}</strong><span>{formatSize(spaceScanProgress?.scannedBytes ?? 0)} · {spaceScanProgress?.scannedFiles ?? 0} {language === "zh-CN" ? "个文件" : "files"}</span></div><div className="space-health-progress indeterminate"><i /></div><small title={spaceScanProgress?.currentPath}>{spaceScanProgress?.currentPath}</small></section>}
          {spaceScanError && <div className="space-scan-error"><strong>{language === "zh-CN" ? "扫描未完成" : "Scan did not finish"}</strong><span>{spaceScanError}</span></div>}
          {!result && !spaceScanning && !spaceScanError && <div className="space-health-empty"><SpaceHealthIcon /><strong>{text.noScanYet}</strong><span>{text.scanCoverageHint}</span></div>}
          {result && <>
            <SpaceCapacityCard result={result} previous={spacePreviousSnapshot} language={language} />
            <SpaceHistoryCard history={spaceSnapshotHistory} language={language} availableLabel={text.available} />
            <section className="duplicate-diagnostic">
              <header><div><strong>{language === "zh-CN" ? "重复文件诊断" : "Duplicate file diagnosis"}</strong><span>{language === "zh-CN" ? "仅检查 1 MB 以上文件；完整哈希确认，不会自动选择或删除" : "Files over 1 MB only; full-hash verification with no automatic selection or deletion"}</span></div>{duplicateScanning ? <button className="secondary" onClick={cancelDuplicateScan}>{text.stopScan}</button> : <button disabled={spaceScanning} onClick={() => void startDuplicateScan()}>{duplicateResult ? (language === "zh-CN" ? "重新查重" : "Scan again") : (language === "zh-CN" ? "开始查重" : "Find duplicates")}</button>}</header>
              {duplicateScanning && <div className="duplicate-running"><div><strong>{duplicateProgress?.phase === "verifying" ? (language === "zh-CN" ? "正在完整校验…" : "Verifying full contents…") : duplicateProgress?.phase === "fingerprint" ? (language === "zh-CN" ? "正在筛选候选…" : "Filtering candidates…") : (language === "zh-CN" ? "正在扫描文件…" : "Scanning files…")}</strong><span>{(duplicateProgress?.scannedFiles ?? 0).toLocaleString()} {language === "zh-CN" ? "个文件" : "files"} · {(duplicateProgress?.candidateFiles ?? 0).toLocaleString()} {language === "zh-CN" ? "个候选" : "candidates"}</span></div><div className="space-health-progress indeterminate"><i /></div><small title={duplicateProgress?.currentPath}>{duplicateProgress?.currentPath}</small></div>}
              {duplicateError && <div className="space-scan-error"><strong>{language === "zh-CN" ? "重复文件诊断未完成" : "Duplicate diagnosis did not finish"}</strong><span>{duplicateError}</span></div>}
              {duplicateResult && <div className="duplicate-results">
                <div className="duplicate-summary"><article><span>{language === "zh-CN" ? "确认重复组" : "Verified groups"}</span><strong>{duplicateResult.groups.length.toLocaleString()}</strong></article><article><span>{language === "zh-CN" ? "可复核空间" : "Reviewable space"}</span><strong>{formatSize(duplicateResult.reclaimableBytes)}</strong></article><article><span>{language === "zh-CN" ? "已检查" : "Scanned"}</span><strong>{duplicateResult.scannedFiles.toLocaleString()}</strong><small>{duplicateResult.issues ? `${duplicateResult.issues} ${language === "zh-CN" ? "个无法读取" : "unreadable"}` : (language === "zh-CN" ? "无读取错误" : "No read errors")}</small></article></div>
                <p>{language === "zh-CN" ? "“可复核空间”按每组保留 1 份估算。“建议保留”只根据目录性质、修改时间和路径长度给出参考，不会自动勾选；每组始终至少保留一份。" : "Reviewable space assumes one copy is retained. Suggested keeps only consider folder type, modified date, and path length; nothing is preselected and every group keeps at least one copy."}</p>
                {duplicateResult.truncated && <p className="space-cleanup-note">{language === "zh-CN" ? "重复组很多，当前仅显示占用最大的 500 组。" : "Many groups were found; only the 500 largest are shown."}</p>}
                {!!duplicateResult.groups.length && <div className="duplicate-filter-bar"><input value={duplicateFilterQuery} onChange={(event) => changeDuplicateFilterQuery(event.target.value)} placeholder={language === "zh-CN" ? "筛选文件名、文件夹或完整路径" : "Filter name, folder, or full path"} /><select value={duplicateTypeFilter} onChange={(event) => changeDuplicateTypeFilter(event.target.value as DuplicateTypeFilter)} aria-label={language === "zh-CN" ? "文件类型" : "File type"}><option value="all">{language === "zh-CN" ? "所有类型" : "All types"}</option><option value="images">{text.images}</option><option value="videos">{text.videos}</option><option value="audio">{text.audio}</option><option value="documents">{text.documents}</option><option value="archives">{text.archives}</option><option value="other">{language === "zh-CN" ? "其他类型" : "Other"}</option></select><div>{(["all", "10mb", "100mb", "1gb"] as DuplicateSizeFilter[]).map((size) => <button key={size} className={duplicateSizeFilter === size ? "active" : ""} onClick={() => changeDuplicateSizeFilter(size)}>{size === "all" ? (language === "zh-CN" ? "全部大小" : "All sizes") : `${size.replace("mb", " MB").replace("gb", " GB")}+`}</button>)}</div><span>{filteredDuplicateGroups.length.toLocaleString()} / {duplicateResult.groups.length.toLocaleString()} {language === "zh-CN" ? "组" : "groups"}</span></div>}
                {duplicateCleanupMessage && <div className="duplicate-cleanup-message">{duplicateCleanupMessage}</div>}
                <div className="duplicate-groups">{filteredDuplicateGroups.length ? filteredDuplicateGroups.map((group) => {
                  const suggested = suggestedDuplicateKeep(group);
                  return <details key={`${group.signature}-${group.fileSize}`}><summary><span><strong>{formatSize(group.fileSize)} × {group.files.length}</strong><small>{language === "zh-CN" ? `可复核 ${formatSize(group.reclaimableBytes)}` : `${formatSize(group.reclaimableBytes)} reviewable`} · #{group.signature}</small></span><b>›</b></summary><div>{group.files.map((item) => <div className={`duplicate-file-row ${suggested?.path === item.path ? "suggested-keep" : ""}`} key={item.path} title={item.path}><label><input type="checkbox" checked={duplicateCleanupSelected.has(item.path)} disabled={duplicateCleanupBusy} onChange={() => toggleDuplicateCleanupItem(group, item.path)} /><span><strong>{item.name}{suggested?.path === item.path && <b className="keep-suggestion">{language === "zh-CN" ? "建议保留" : "Suggested keep"}</b>}</strong><small>{item.path}</small>{suggested?.path === item.path && <i>{duplicateKeepReason(group, item, language)}</i>}</span></label><em>{formatDate(item.modifiedUnixSeconds, language)}</em><button aria-label={text.openLocation} title={text.openLocation} onClick={() => void openSpaceScanItem(item)}>↗</button></div>)}</div></details>;
                }) : <span className="space-list-empty">{duplicateResult.groups.length ? (language === "zh-CN" ? "当前筛选下没有重复文件组。" : "No duplicate groups match the current filters.") : (language === "zh-CN" ? "没有发现经过完整内容校验的重复文件。" : "No duplicates were confirmed by full-content verification.")}</span>}</div>
                {!!duplicateResult.groups.length && <footer className="duplicate-cleanup-footer"><div><strong>{duplicateCleanupSelected.size.toLocaleString()} {language === "zh-CN" ? "个待清理" : "selected"}</strong><span>{formatSize(selectedDuplicateBytes)} · {language === "zh-CN" ? "未勾选的文件将保留" : "Unchecked copies will be retained"}</span></div><button disabled={!duplicateCleanupSelected.size || duplicateCleanupBusy} onClick={() => { setDuplicateCleanupConfirmOpen(true); setDuplicateCleanupAcknowledged(false); }}>{language === "zh-CN" ? "复核并清理" : "Review cleanup"}</button></footer>}
                {duplicateCleanupConfirmOpen && <div className="space-cleanup-confirm duplicate-cleanup-confirm"><strong>{language === "zh-CN" ? "重新校验后移入回收站" : "Re-verify, then recycle"}</strong><p>{language === "zh-CN" ? `将重新读取并比对 ${duplicateCleanupSelected.size} 个文件的完整内容；只有仍与保留副本完全一致的文件才会移入 Windows 回收站。` : `The full contents of ${duplicateCleanupSelected.size} selected file(s) will be read again. Only files still identical to a retained copy will be moved to the Windows Recycle Bin.`}</p><label><input type="checkbox" checked={duplicateCleanupAcknowledged} onChange={(event) => setDuplicateCleanupAcknowledged(event.target.checked)} /><span>{language === "zh-CN" ? "我已逐项查看文件名与路径，并确认每组未勾选的副本应当保留。" : "I reviewed every name and path and confirm the unchecked copy in each group should be retained."}</span></label><div><button disabled={duplicateCleanupBusy} onClick={() => setDuplicateCleanupConfirmOpen(false)}>{text.cancel}</button><button className="primary" disabled={!duplicateCleanupAcknowledged || duplicateCleanupBusy} onClick={() => void confirmDuplicateCleanup()}>{duplicateCleanupBusy ? (language === "zh-CN" ? "正在完整校验…" : "Verifying…") : (language === "zh-CN" ? "确认移入回收站" : "Move to Recycle Bin")}</button></div></div>}
              </div>}
            </section>
            <section className="space-category-section">
              <header><strong>{text.attentionItems}</strong><span>{language === "zh-CN" ? "先看建议，再预检具体文件；不会自动勾选或删除" : "Read advice, preview exact files, then confirm; nothing is preselected"}</span></header>
              <div className="space-category-grid">{result.categories.length ? result.categories.map((category) => {
                const previousSize = spacePreviousSnapshot?.categories[category.id];
                const delta = previousSize === undefined ? null : category.size - previousSize;
                const advice = spaceCategoryAdvice(category.id, language);
                return <article key={category.id} className={`risk-${category.risk} ${spaceAdviceCategoryId === category.id ? "active" : ""}`}>
                  <div><strong>{spaceCategoryLabel(category.id, language)}</strong><span className="space-risk-badge">{riskLabel(category.risk)}</span></div>
                  <b>{formatSize(category.size)}</b>
                  <small>{category.fileCount.toLocaleString()} {language === "zh-CN" ? "个文件" : "files"}{delta !== null && delta !== 0 ? ` · ${language === "zh-CN" ? "较上次" : "vs last"} ${delta > 0 ? "+" : "−"}${formatSize(Math.abs(delta))}` : ""}</small>
                  <p>{advice.summary}</p>
                  <div className="space-category-actions"><button onClick={() => showSpaceAdvice(category)}>{language === "zh-CN" ? "查看建议" : "View advice"}</button>{advice.cleanable && <button className="cleanup" disabled={spaceCleanupLoading} onClick={() => void prepareSpaceCleanup(category)}>{language === "zh-CN" ? "复核清理" : "Review cleanup"}</button>}</div>
                </article>;
              }) : <span className="space-list-empty">{language === "zh-CN" ? "没有发现已知关注项" : "No known items found"}</span>}</div>
              {activeCategory && activeAdvice && <div className="space-advice-panel">
                <header><div><strong>{spaceCategoryLabel(activeCategory.id, language)}</strong><span className={`space-risk-badge risk-${activeCategory.risk}`}>{riskLabel(activeCategory.risk)}</span></div><button aria-label={text.close} onClick={() => { setSpaceAdviceCategoryId(null); setSpaceCleanupPreview(null); setSpaceCleanupSelected(new Set()); }}>×</button></header>
                <div className="space-advice-copy"><article><span>{language === "zh-CN" ? "判断" : "Assessment"}</span><p>{activeAdvice.summary}</p></article><article><span>{language === "zh-CN" ? "建议" : "Recommendation"}</span><p>{activeAdvice.action}</p></article><article><span>{language === "zh-CN" ? "注意" : "Caution"}</span><p>{activeAdvice.caution}</p></article></div>
                {!activeAdvice.cleanable && <div className="space-advice-protected">{language === "zh-CN" ? "为避免破坏系统或误删个人内容，此类别不提供直接清理按钮。" : "Direct cleanup is unavailable for this category to avoid system damage or personal data loss."}</div>}
                {activeAdvice.cleanable && !spaceCleanupPreview && !spaceCleanupLoading && <button className="space-prepare-cleanup" onClick={() => void prepareSpaceCleanup(activeCategory)}>{language === "zh-CN" ? "扫描并列出可复核文件" : "Scan and list reviewable files"}</button>}
                {spaceCleanupLoading && !spaceCleanupPreview && <div className="space-cleanup-loading"><span>{language === "zh-CN" ? "正在生成清理预检清单…" : "Building cleanup preview…"}</span><div className="space-health-progress indeterminate"><i /></div></div>}
                {spaceCleanupError && <div className="space-scan-error"><strong>{language === "zh-CN" ? "无法完成清理预检" : "Cleanup preview failed"}</strong><span>{spaceCleanupError}</span></div>}
                {spaceCleanupMessage && <div className="space-cleanup-success">{spaceCleanupMessage}</div>}
                {spaceCleanupPreview && <div className="space-cleanup-preview">
                  <header><div><strong>{language === "zh-CN" ? "清理前复核" : "Review before cleanup"}</strong><span>{formatSize(spaceCleanupPreview.totalBytes)} · {spaceCleanupPreview.totalFiles.toLocaleString()} {language === "zh-CN" ? "个匹配文件" : "matching files"}</span></div><div><button onClick={() => setSpaceCleanupSelected(new Set(filteredCleanupCandidates.map((item) => item.path)))}>{language === "zh-CN" ? "选择当前结果" : "Select filtered"}</button><button onClick={() => setSpaceCleanupSelected(new Set())}>{language === "zh-CN" ? "清除选择" : "Clear"}</button></div></header>
                  {spaceCleanupPreview.truncated && <p className="space-cleanup-note">{language === "zh-CN" ? `为便于安全复核，仅列出最大的 ${spaceCleanupPreview.candidates.length} 个文件；清理只作用于你明确勾选的文件。` : `For safe review, only the largest ${spaceCleanupPreview.candidates.length} files are shown. Cleanup only affects checked files.`}</p>}
                  <div className="space-cleanup-filters"><div><span>{language === "zh-CN" ? "按未修改时间" : "Not modified for"}</span>{(["all", "30", "90", "365"] as SpaceCleanupAge[]).map((age) => <button key={age} className={spaceCleanupAge === age ? "active" : ""} onClick={() => changeSpaceCleanupAge(age)}>{age === "all" ? (language === "zh-CN" ? "全部" : "All") : age === "365" ? (language === "zh-CN" ? "1 年" : "1 year") : `${age} ${language === "zh-CN" ? "天" : "days"}`}</button>)}</div><strong>{filteredCleanupCandidates.length.toLocaleString()} {language === "zh-CN" ? "项" : "items"} · {formatSize(filteredCleanupBytes)}</strong></div>
                  <div className="space-cleanup-list">{filteredCleanupCandidates.length ? filteredCleanupCandidates.map((item) => <div className="space-cleanup-row" key={item.path} title={item.path}><label><input type="checkbox" checked={spaceCleanupSelected.has(item.path)} onChange={() => toggleSpaceCleanupItem(item.path)} /><span><strong>{item.name}</strong><small>{item.path}</small><em>{language === "zh-CN" ? "修改于" : "Modified"} {formatDate(item.modifiedUnixSeconds, language)}</em></span></label><b>{formatSize(item.size)}</b><button aria-label={text.openLocation} title={text.openLocation} onClick={() => void revealSpaceCleanupItem(item.path)}>↗</button></div>) : <span className="space-list-empty">{language === "zh-CN" ? "当前筛选下没有文件。" : "No files match this filter."}</span>}</div>
                  <footer><div><strong>{spaceCleanupSelected.size.toLocaleString()} {language === "zh-CN" ? "个已选" : "selected"}</strong><span>{formatSize(selectedCleanupBytes)}</span></div><button disabled={!spaceCleanupSelected.size || spaceCleanupLoading} onClick={() => { setSpaceCleanupConfirmOpen(true); setSpaceCleanupAcknowledged(false); }}>{language === "zh-CN" ? "复核并继续" : "Review and continue"}</button></footer>
                  {spaceCleanupConfirmOpen && <div className="space-cleanup-confirm"><strong>{language === "zh-CN" ? "最后确认" : "Final confirmation"}</strong><p>{language === "zh-CN" ? `将把你选择的 ${spaceCleanupSelected.size} 个文件（${formatSize(selectedCleanupBytes)}）移入 Windows 回收站，不会永久删除。` : `${spaceCleanupSelected.size} selected file(s) (${formatSize(selectedCleanupBytes)}) will be moved to the Windows Recycle Bin, not permanently deleted.`}</p><label><input type="checkbox" checked={spaceCleanupAcknowledged} onChange={(event) => setSpaceCleanupAcknowledged(event.target.checked)} /><span>{language === "zh-CN" ? "我已查看上方文件名、路径和大小，并确认清理这些内容。" : "I reviewed the names, paths, and sizes above and confirm these items."}</span></label><div><button onClick={() => setSpaceCleanupConfirmOpen(false)}>{text.cancel}</button><button className="primary" disabled={!spaceCleanupAcknowledged || spaceCleanupLoading} onClick={() => void confirmSpaceCleanup()}>{spaceCleanupLoading ? (language === "zh-CN" ? "正在处理…" : "Processing…") : (language === "zh-CN" ? "确认移入回收站" : "Move to Recycle Bin")}</button></div></div>}
                </div>}
              </div>}
            </section>
            <SpaceRankings directories={result.largestDirectories} files={result.largestFiles} language={language} onOpenDirectory={drillIntoSpaceDirectory} onOpenFile={(item) => void openSpaceScanItem(item)} />
          </>}
        </div>
      </section>
    </div>;
  }

  function renderSearchPanel() {
    return <SearchPanel
      language={language}
      query={query}
      kind={searchKind}
      date={searchDate}
      size={searchSize}
      savedSearches={savedSearches}
      searchHistory={searchHistory}
      onKindChange={setSearchKind}
      onDateChange={setSearchDate}
      onSizeChange={setSearchSize}
      onSave={saveCurrentSearch}
      onStart={(profile) => void startDeepSearch(profile)}
      onRemoveSaved={removeSavedSearch}
      onClearHistory={clearSearchHistory}
    />;
  }

  return <main className="file-app" onPointerLeave={() => void startExternalFileDrag()}>
    <header className="topbar">
      <div className="brand"><img className="brand-mark" src={brandIcon} alt="" /><span><strong>Flow Files</strong><small>{text.subtitle}</small></span></div>
      <div className="top-actions"><button className="space-health-button" onClick={openSpaceHealth} title={text.spaceHealth}><SpaceHealthIcon /><span>{text.spaceHealth}</span></button><div className="menu-anchor top-new-menu"><button className="top-new-button" aria-expanded={openMenu === "new"} onClick={() => toggleToolbarMenu("new")} disabled={!listing || !!operation || searchResults !== null}><span>＋ {text.newItem}</span><ChevronIcon /></button>{openMenu === "new" && <div className="toolbar-menu new-menu" role="menu"><button onClick={() => void createItem("folder")}><span>{text.newFolder}</span></button><button onClick={() => void createItem("text")}><span>{text.newTextFile}</span></button><button onClick={() => void createItem("markdown")}><span>{text.newMarkdownFile}</span></button></div>}</div><div className="menu-anchor terminal-launch-menu"><button className="top-new-button" aria-expanded={openMenu === "terminal"} onClick={() => toggleToolbarMenu("terminal")} disabled={!listing}><span>{text.terminal}</span><ChevronIcon /></button>{openMenu === "terminal" && <div className="toolbar-menu" role="menu"><button onClick={() => { setOpenMenu(null); void openTerminalAt(); }}><span>{text.plainTerminal}</span></button><button onClick={() => { setOpenMenu(null); void openTerminalAt(listing?.path, "claude"); }}><span>{text.claudeCode}</span><b>›_</b></button></div>}</div><button className={`task-center-button ${activeTaskCount ? "busy" : ""} ${recoveredTaskCount ? "recovery" : ""}`} onClick={() => setTaskCenterOpen((open) => !open)} title={recoveredTaskCount ? (language === "zh-CN" ? `${recoveredTaskCount} 个任务在上次退出时中断` : `${recoveredTaskCount} task(s) interrupted by the previous exit`) : text.tasks}><span>⇅</span>{activeTaskCount + recoveredTaskCount > 0 && <b>{activeTaskCount + recoveredTaskCount}</b>}</button><button className="settings-button" aria-label={text.settings} title={text.settings} onClick={() => setSettingsOpen(true)}><SettingsIcon /></button></div>
    </header>
    <nav className="tabbar" aria-label="Folder tabs">
      {tabs.map((tab) => <button key={tab.id} data-tab-id={tab.id} data-drop-path={tab.path} className={`tab ${tab.id === activeTabId ? "active" : ""} ${tab.pinned ? "pinned" : ""} ${dragTarget === tab.path ? "drop-target" : ""} ${draggedTabId === tab.id ? "dragging" : ""} ${unavailablePaths.has(tab.path.toLocaleLowerCase()) ? "offline" : ""} ${tabDropId === tab.id ? `reorder-${tabDropSide}` : ""}`} title={unavailablePaths.has(tab.path.toLocaleLowerCase()) ? `${tab.path} · ${language === "zh-CN" ? "已断开，点击重试" : "Disconnected; click to retry"}` : tab.path} onPointerDown={(event) => armTabReorder(tab.id, event)} onClick={(event) => { if (suppressTabClickRef.current) { event.preventDefault(); event.stopPropagation(); return; } void activateTab(tab); }} onContextMenu={(event) => openTabContextMenu(tab.id, event)} onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); closeTab(event, tab.id); } }}>{tab.pinned && <b className="tab-pin" aria-label={text.unpinTab}>⌖</b>}<span>{localizedLocation(tab.label, language)}</span>{tabs.length > 1 && !tab.pinned && <i className="tab-close" onClick={(event) => closeTab(event, tab.id)}>×</i>}</button>)}
      <button className="tab add-tab" title="Ctrl+T" onClick={() => openNewTab()}>＋</button>
    </nav>
    <section className="workspace">
      <aside className="sidebar">
        {favorites.length > 0 && <><p>{text.favorites}</p><div className="favorite-sections"><datalist id="favorite-groups">{favoriteSections.filter(([group]) => group).map(([group]) => <option value={group} key={group} />)}</datalist>{favoriteSections.map(([group, items]) => { const groupKey = group.toLocaleLowerCase(); const collapsed = collapsedFavoriteGroups.has(groupKey); return <section className="favorite-section" key={group || "ungrouped"}><button className="favorite-group-heading" aria-expanded={!collapsed} onClick={() => toggleFavoriteGroup(group)}><i>›</i><span>{group || (language === "zh-CN" ? "未分组" : "Ungrouped")}</span><b>{items.length}</b></button>{!collapsed && <div className="favorite-list">{items.map((favorite) => { const editing = favoriteEditingPath === favorite.path; return <div data-drop-path={favorite.path} className={`favorite-row ${editing ? "editing" : ""} ${listing?.path.toLocaleLowerCase() === favorite.path.toLocaleLowerCase() ? "selected" : ""} ${dragTarget === favorite.path ? "drop-target" : ""} ${favoriteDropPath === favorite.path ? "reorder-target" : ""}`} key={favorite.path} onDragOver={(event) => { if (!favoriteDraggingPath) return; event.preventDefault(); event.stopPropagation(); setFavoriteDropPath(favorite.path); }} onDrop={(event) => { if (!favoriteDraggingPath) return; event.preventDefault(); event.stopPropagation(); reorderFavorite(favoriteDraggingPath, favorite.path); setFavoriteDraggingPath(null); setFavoriteDropPath(null); }}><button className="favorite-handle" draggable={!editing} aria-label={language === "zh-CN" ? "拖动排序" : "Drag to reorder"} title={language === "zh-CN" ? "拖动排序，也可拖到其他分组" : "Drag to reorder or move between groups"} onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", favorite.path); setFavoriteDraggingPath(favorite.path); }} onDragEnd={() => { setFavoriteDraggingPath(null); setFavoriteDropPath(null); }}>⋮⋮</button>{editing ? <div className="favorite-editor"><input className="favorite-name-input" autoFocus value={favoriteLabelValue} aria-label={language === "zh-CN" ? "收藏名称" : "Favorite name"} placeholder={language === "zh-CN" ? "名称" : "Name"} onChange={(event) => setFavoriteLabelValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") commitFavoriteRename(favorite.path, favoriteLabelValue, favoriteGroupValue); else if (event.key === "Escape") setFavoriteEditingPath(null); }} /><input className="favorite-name-input" list="favorite-groups" value={favoriteGroupValue} aria-label={language === "zh-CN" ? "收藏分组" : "Favorite group"} placeholder={language === "zh-CN" ? "分组（可选）" : "Group (optional)"} onChange={(event) => setFavoriteGroupValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") commitFavoriteRename(favorite.path, favoriteLabelValue, favoriteGroupValue); else if (event.key === "Escape") setFavoriteEditingPath(null); }} /></div> : <button className="favorite-open" title={favorite.path} onClick={() => void browse(favorite.path)} onDoubleClick={(event) => beginFavoriteRename(favorite, event)}><FolderGlyph /><span>{favorite.label ?? labelForPath(favorite.path)}</span></button>}{editing ? <button className="favorite-edit visible" aria-label={language === "zh-CN" ? "保存" : "Save"} title={language === "zh-CN" ? "保存" : "Save"} onClick={(event) => { event.stopPropagation(); commitFavoriteRename(favorite.path, favoriteLabelValue, favoriteGroupValue); }}>✓</button> : <button className="favorite-edit" aria-label={language === "zh-CN" ? "编辑收藏" : "Edit favorite"} title={language === "zh-CN" ? "编辑名称和分组" : "Edit name and group"} onClick={(event) => beginFavoriteRename(favorite, event)}>✎</button>}{editing ? <button className="favorite-remove visible" aria-label={text.cancel} title={text.cancel} onClick={(event) => { event.stopPropagation(); setFavoriteEditingPath(null); }}>×</button> : <button className="favorite-remove" aria-label={text.removeFavorite} title={text.removeFavorite} onClick={(event) => removeFavorite(favorite.path, event)}>×</button>}</div>; })}</div>}</section>; })}</div><hr /></>}
        <p>{text.locations}</p><div className="location-list">{locations.map((location) => { const isDrive = location.totalSpace !== null && location.availableSpace !== null && location.totalSpace > 0; const usedPercent = isDrive ? Math.max(0, Math.min(100, (location.totalSpace! - location.availableSpace!) / location.totalSpace! * 100)) : 0; return <button key={location.path} data-drop-path={location.path} className={`location ${isDrive || !location.isAvailable ? "drive-location" : ""} ${!location.isAvailable ? "unavailable" : ""} ${listing?.path.toLowerCase() === location.path.toLowerCase() ? "selected" : ""} ${dragTarget === location.path ? "drop-target" : ""}`} onClick={() => void browse(location.path)}><span className="location-label">{localizedLocation(location.label, language)}</span>{!location.isAvailable ? <span className="drive-space-label">{language === "zh-CN" ? "已断开 · 点击重试" : "Disconnected · click to retry"}</span> : isDrive && <><span className="drive-space-label">{formatSize(location.availableSpace!)} {text.available} / {formatSize(location.totalSpace!)}</span><span className="drive-space-track"><i style={{ width: `${usedPercent}%` }} /></span></>}</button>; })}</div>
        <hr /><p>{text.folders}</p><div className="folder-tree">{treeRoots.map((root) => renderTreeNode(root.path, localizedLocation(root.label, language)))}</div>
        <hr /><p>{text.selection}</p><span>{selectedPaths.size > 1 ? `${selectedPaths.size} ${text.selectedCount}` : selected ? selected.name : text.nothingSelected}</span><span className="muted">{selectedPaths.size > 1 ? (language === "zh-CN" ? "可复制、移动或删除所选项目" : "Copy, move, or delete the selection") : selected ? (selected.isDirectory ? text.folder : formatSize(selected.size)) : text.selectHint}</span>
        {selected?.isDirectory && selectedPaths.size === 1 && <div className="folder-size-card">{folderSize ? <><strong>{formatSize(folderSize.totalBytes)}</strong><span>{language === "zh-CN" ? `${folderSize.scannedFiles} 个文件 · ${folderSize.scannedFolders} 个文件夹` : `${folderSize.scannedFiles} files · ${folderSize.scannedFolders} folders`}</span>{folderSize.issues > 0 && <small>{language === "zh-CN" ? `${folderSize.issues} 个位置无法读取` : `${folderSize.issues} locations could not be read`}</small>}{folderSize.running ? <button onClick={cancelFolderSizeCalculation}>{language === "zh-CN" ? "停止计算" : "Stop calculating"}</button> : <button onClick={() => void calculateSelectedFolderSize()}>{language === "zh-CN" ? "重新计算" : "Calculate again"}</button>}</> : <button onClick={() => void calculateSelectedFolderSize()}>{language === "zh-CN" ? "计算文件夹大小" : "Calculate folder size"}</button>}</div>}
      </aside>
      <section className={`content ${previewPaneOpen ? "with-preview-layout" : ""}`} style={{ "--modified-width": `${columnWidths.modified}px`, "--type-width": `${columnWidths.type}px`, "--size-width": `${columnWidths.size}px` } as React.CSSProperties}>
        <div className="navigation"><button onClick={goBack} onContextMenu={(event) => openHistoryMenu("back", event)} title={text.historyHint} disabled={!activeTab || activeTab.historyIndex === 0}>←</button><button onClick={goForward} onContextMenu={(event) => openHistoryMenu("forward", event)} title={text.historyHint} disabled={!activeTab || activeTab.historyIndex >= activeTab.history.length - 1}>→</button><form className="address-form" onSubmit={submitAddress}>{addressEditing ? <><input ref={addressInputRef} autoFocus aria-label={text.address} value={address} onChange={(event) => { setAddress(event.target.value); setAddressSuggestionIndex(-1); }} onKeyDown={handleAddressKeyDown} onBlur={() => setAddressEditing(false)} placeholder={text.address} autoComplete="off" />{addressSuggestions.length > 0 && <div className="address-suggestions" role="listbox">{addressSuggestions.map((suggestion, index) => <button key={suggestion.path} type="button" role="option" aria-selected={index === addressSuggestionIndex} className={index === addressSuggestionIndex ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseAddressSuggestion(suggestion)}><FolderGlyph /><span><strong>{suggestion.label}</strong><small>{suggestion.path}</small></span><i>{suggestion.source === "recent" ? (language === "zh-CN" ? "最近" : "Recent") : ""}</i></button>)}</div>}</> : <div className="breadcrumbs" title={`${text.editAddress} (Ctrl+L)`} onDoubleClick={beginAddressEditing}>{crumbs.map((crumb, index) => <span key={crumb.path}><button type="button" data-drop-path={crumb.path} className={dragTarget === crumb.path ? "drop-target" : ""} onClick={() => void browse(crumb.path)}>{crumb.label}</button>{index < crumbs.length - 1 && <i>›</i>}</span>)}<button type="button" className="edit-address" aria-label={text.editAddress} onClick={beginAddressEditing}>✎</button></div>}</form><div className="search-shell"><input className="search" value={query} onChange={(event) => changeSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void startDeepSearch(); } }} placeholder={text.search} /><button className="search-run" aria-label={searching ? text.cancel : text.searchAll} title={searching ? text.cancel : text.searchAll} onClick={() => searching ? cancelDeepSearch() : void startDeepSearch()}>{searching ? "×" : "⌕"}</button><button className={`search-filter-button ${searchPanelOpen ? "active" : ""}`} aria-label={text.searchFilters} title={text.searchFilters} onClick={() => setSearchPanelOpen((open) => !open)}>≡</button>{searchPanelOpen && renderSearchPanel()}</div></div>
        <div className="content-heading">
          <div className="content-identity"><div><h1>{currentLabel}</h1><span className="clean-path">{searchResults !== null ? `${listing?.path ?? ""}${query ? ` · ${query}` : ""}` : listing?.path ?? ""}</span></div>{searchResults !== null ? <button className="favorite-current" aria-label={text.backToFolder} title={text.backToFolder} onClick={clearDeepSearch}>×</button> : <button className={`favorite-current ${currentIsFavorite ? "active" : ""}`} aria-label={currentIsFavorite ? text.removeFavorite : text.addFavorite} title={currentIsFavorite ? text.removeFavorite : text.addFavorite} onClick={toggleFavoriteCurrent}>{currentIsFavorite ? "★" : "☆"}</button>}</div>
          {unavailableLocation && unavailableCopy && unavailableLocation.path.toLocaleLowerCase() === listing?.path.toLocaleLowerCase() && <div className={`location-warning reason-${unavailableLocation.reason ?? "unknown"}`}><span><strong>{unavailableCopy.title}</strong><small>{unavailableCopy.detail}</small></span><button onClick={() => listing && void browse(listing.path, activeTabId, false)}>{language === "zh-CN" ? "立即重试" : "Retry"}</button><button onClick={() => { const home = locations.find((location) => location.label === "Home" && location.isAvailable); if (home) void browse(home.path); }}>{language === "zh-CN" ? "返回主页" : "Go home"}</button></div>}
          <div className="heading-actions"><div className="view-tools">
            <div className="menu-anchor"><button className="toolbar-control" aria-expanded={openMenu === "sort"} onClick={() => toggleToolbarMenu("sort")}><SortIcon /><span>{text.sort}</span><ChevronIcon /></button>{openMenu === "sort" && <div className="toolbar-menu sort-menu" role="menu">{(["name", "modified", "type", "size"] as SortKey[]).map((key) => <button key={key} className={sortKey === key ? "chosen" : ""} onClick={() => chooseSort(key)}><span>{key === "name" ? text.name : key === "modified" ? text.dateModified : key === "type" ? text.type : text.size}</span>{sortKey === key && <b>{sortDirection === "ascending" ? "↑" : "↓"}</b>}</button>)}</div>}</div>
            <div className="menu-anchor"><button className="toolbar-control" aria-expanded={openMenu === "view"} onClick={() => toggleToolbarMenu("view")}><ViewIcon /><span>{text.view}</span><ChevronIcon /></button>{openMenu === "view" && <div className="toolbar-menu view-menu" role="menu"><button className={viewMode === "comfortable" ? "chosen" : ""} onClick={() => chooseView("comfortable")}><span>{text.comfortable}</span>{viewMode === "comfortable" && <b>✓</b>}</button><button className={viewMode === "compact" ? "chosen" : ""} onClick={() => chooseView("compact")}><span>{text.compact}</span>{viewMode === "compact" && <b>✓</b>}</button><button className={viewMode === "grid" ? "chosen" : ""} onClick={() => chooseView("grid")}><span>{text.grid}</span>{viewMode === "grid" && <b>✓</b>}</button><hr /><button className={previewPaneOpen ? "chosen" : ""} onClick={togglePreviewPane}><span>{text.previewPane}</span>{previewPaneOpen && <b>✓</b>}</button></div>}</div>
            <div className="menu-anchor"><button className="toolbar-control" aria-expanded={openMenu === "actions"} onClick={toggleActionsMenu}><ActionsIcon /><span>{text.actions}</span><ChevronIcon /></button>{openMenu === "actions" && <div className="toolbar-menu actions-menu floating-actions-menu" style={actionsMenuStyle} role="menu">
              <button disabled={!selected || selectedPaths.size !== 1 || selected.isDirectory} onClick={() => { setOpenMenu(null); void openWithSelected(); }}><span>{text.openWith}</span></button>
              <button disabled={!selected || selectedPaths.size !== 1} onClick={() => { setOpenMenu(null); void showSelectedProperties(); }}><span>{text.properties}</span><kbd>Alt+Enter</kbd></button><hr />
              <button disabled={!selected?.isDirectory || selectedPaths.size !== 1} onClick={() => { setOpenMenu(null); void calculateSelectedFolderSize(); }}><span>{language === "zh-CN" ? "计算文件夹大小" : "Calculate folder size"}</span></button>
              <button disabled={!listing} onClick={() => { setOpenMenu(null); void openTerminalAt(terminalPathForSelection()); }}><span>{text.terminalHere}</span></button>
              <button disabled={!listing} onClick={() => { setOpenMenu(null); void openTerminalAt(terminalPathForSelection(), "claude"); }}><span>{text.claudeHere}</span><b>›_</b></button>
              <button disabled={!listing} onClick={() => { setOpenMenu(null); toggleFavoriteCurrent(); }}><span>{currentIsFavorite ? text.removeFavorite : text.addFavorite}</span><b>{currentIsFavorite ? "★" : "☆"}</b></button><hr />
              <button disabled={!selectedPaths.size || !!operation} onClick={() => void copySelection("copy")}><span>{text.copy}</span><kbd>Ctrl+C</kbd></button>
              <button disabled={!selectedPaths.size || !!operation} onClick={() => void copySelection("move")}><span>{text.cut}</span><kbd>Ctrl+X</kbd></button>
              <button disabled={!selectedPaths.size} onClick={() => void copySelectionText("path")}><span>{text.copyPath}</span></button>
              <button disabled={!selectedPaths.size} onClick={() => void copySelectionText("name")}><span>{text.copyName}</span></button>
              <button disabled={!listing} onClick={() => void pasteIntoCurrent()}><span>{text.paste}</span><kbd>Ctrl+V</kbd></button>
              <button disabled={!undoAction || !!operation || undoBusy} title={text.undoRetention} onClick={() => void undoLastOperation()}><span>{latestUndo ? `${text.undo}：${latestUndo.label}` : text.undo}</span><kbd>{undoStack.length ? `${undoStack.length} · Ctrl+Z` : "Ctrl+Z"}</kbd></button><hr />
              <button disabled={!selectedPaths.size || !!operation || archiveBusy} onClick={() => void compressSelection()}><span>{text.compressZip}</span></button>
              <button disabled={selectedEntries.length !== 1 || selectedEntries[0]?.extension?.toLowerCase() !== "zip" || !!operation || archiveBusy} onClick={() => void extractSelectedZip()}><span>{text.extractZip}</span></button>
              <button disabled={selectedPaths.size < 2 || !!operation || archiveBusy} onClick={beginBatchRename}><span>{text.batchRename}</span></button><hr />
              <button disabled={selectedPaths.size !== 1 || !!operation || searchResults !== null} onClick={beginRename}><span>{text.rename}</span><kbd>F2</kbd></button>
              <button disabled={!selectedPaths.size || !!operation} onClick={() => void recycleSelection()}><span>{text.delete}</span><kbd>Del</kbd></button>
              <button className="danger" disabled={!selectedPaths.size || !!operation} onClick={() => void permanentlyDeleteSelection()}><span>{text.permanentDelete}</span><kbd>Shift+Del</kbd></button>
            </div>}</div>
          </div></div>
        </div>
        <div className={`columns ${viewMode === "grid" ? "grid-hidden" : ""}`}><div className="column-heading"><button onClick={() => chooseSort("name")}>{text.name} {sortKey === "name" ? (sortDirection === "ascending" ? "↑" : "↓") : ""}</button></div><div className="column-heading"><span className="column-resizer" role="separator" aria-orientation="vertical" title={language === "zh-CN" ? "拖动调整列宽；双击重置" : "Drag to resize; double-click to reset"} onPointerDown={(event) => beginColumnResize("modified", event)} onDoubleClick={(event) => resetColumnWidth("modified", event)} /><button onClick={() => chooseSort("modified")}>{text.modified} {sortKey === "modified" ? (sortDirection === "ascending" ? "↑" : "↓") : ""}</button></div><div className="column-heading"><span className="column-resizer" role="separator" aria-orientation="vertical" title={language === "zh-CN" ? "拖动调整列宽；双击重置" : "Drag to resize; double-click to reset"} onPointerDown={(event) => beginColumnResize("type", event)} onDoubleClick={(event) => resetColumnWidth("type", event)} /><button onClick={() => chooseSort("type")}>{text.type} {sortKey === "type" ? (sortDirection === "ascending" ? "↑" : "↓") : ""}</button></div><div className="column-heading"><span className="column-resizer" role="separator" aria-orientation="vertical" title={language === "zh-CN" ? "拖动调整列宽；双击重置" : "Drag to resize; double-click to reset"} onPointerDown={(event) => beginColumnResize("size", event)} onDoubleClick={(event) => resetColumnWidth("size", event)} /><button onClick={() => chooseSort("size")}>{text.size} {sortKey === "size" ? (sortDirection === "ascending" ? "↑" : "↓") : ""}</button></div></div>
        <div className={`browser-stage ${previewPaneOpen ? "with-preview" : ""}`}><div ref={fileListRef} role="listbox" aria-multiselectable="true" tabIndex={0} data-drop-path={listing?.path} className={`file-list view-${viewMode} ${dragTarget === listing?.path ? "drop-target" : ""}`} onScroll={(event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop)} onContextMenu={openBackgroundContextMenu} onPointerDown={beginMarqueeSelection} onPointerMove={updateMarqueeSelection} onPointerUp={finishMarqueeSelection} onPointerCancel={finishMarqueeSelection}>
          <div style={{ height: virtualHeight, position: "relative" }}><div className="entries-window" style={{ transform: `translateY(${firstVisibleRow * rowHeight}px)`, gridTemplateColumns: viewMode === "grid" ? `repeat(${gridColumns}, minmax(0, 1fr))` : undefined }}>{visibleEntries.map((entry, localIndex) => {
            const thumbnail = thumbnailCache[entry.path];
            const nativeIcon = fileIconCache[entry.path];
            const iconKind = iconKindFor(entry);
            const isCut = clipboard?.mode === "move" && clipboard.paths.includes(entry.path);
            return <button key={entry.path} role="option" aria-selected={selectedPaths.has(entry.path)} data-drop-path={entry.isDirectory ? entry.path : undefined} className={`file-row ${selectedPaths.has(entry.path) ? "selected" : ""} ${selected?.path === entry.path ? "focused-item" : ""} ${entry.isHidden ? "hidden-item" : ""} ${isCut ? "cut" : ""} ${dragTarget === entry.path ? "drop-target" : ""}`} onPointerDown={(event) => armPointerDrag(entry, event)} onClick={(event) => selectEntry(entry, firstVisible + localIndex, event)} onDoubleClick={() => { if (renamingPath !== entry.path) void openEntry(entry); }} onContextMenu={(event) => openEntryContextMenu(entry, firstVisible + localIndex, event)}>
              <span title={entry.isLink ? `${language === "zh-CN" ? "链接到" : "Links to"} ${entry.linkTarget ?? ""}` : undefined} className={`${thumbnail ? "entry-icon thumbnail-icon" : nativeIcon ? "entry-icon native-icon" : `entry-icon ${iconKind}-icon`} ${entry.isLink ? "link-entry-icon" : ""}`}>{thumbnail ? <img src={thumbnail} alt="" /> : nativeIcon ? <img src={nativeIcon} alt="" /> : <EntryIcon entry={entry} />}</span>
              <div className="name-cell">{renamingPath === entry.path ? <div className="rename-editor"><input ref={renameInputRef} className={`inline-rename ${renameError ? "invalid" : ""}`} value={renameValue} aria-invalid={!!renameError} aria-describedby={renameError ? "rename-error" : undefined} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => { setRenameValue(event.target.value); setRenameError(null); }} onBlur={() => { if (!renameError) void commitRename(); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commitRename(); } else if (event.key === "Escape") { event.preventDefault(); setRenamingPath(null); setRenameError(null); } }} />{renameError && <small id="rename-error" className="rename-error">{renameError}</small>}</div> : <strong title={entry.name}>{displayName(entry, showExtensions)}</strong>}{searchResults !== null && <small title={parentDirectory(entry.path)}>{parentDirectory(entry.path)}</small>}</div>
              <span>{formatDate(entry.modifiedUnixSeconds, language)}</span><span className="type-cell">{typeLabelFor(entry, language)}</span><span>{entry.isDirectory ? "—" : formatSize(entry.size)}</span>
            </button>;
          })}</div></div>
          {!isLoading && sortedEntries.length === 0 && <div className="empty-state">{query ? text.noMatches : text.empty}</div>}
          {selectionBox && <div className="selection-box" style={{ left: Math.min(selectionBox.startX, selectionBox.currentX), top: Math.min(selectionBox.startY, selectionBox.currentY), width: Math.max(1, Math.abs(selectionBox.currentX - selectionBox.startX)), height: Math.max(1, Math.abs(selectionBox.currentY - selectionBox.startY)) }} />}
        </div>{previewPaneOpen && <aside className="preview-pane"><header><strong>{text.preview}</strong><button aria-label={text.close} onClick={togglePreviewPane}>×</button></header>{selected && selectedPaths.size === 1 ? <PreviewContent entry={selected} preview={preview} loading={previewLoading} language={language} copy={text} onOpen={() => void openEntry(selected)} onTextPage={(encoding, offset) => void loadTextPreviewPage(encoding, offset)} /> : <div className="preview-placeholder"><ViewIcon /><span>{text.quickViewHint}</span></div>}</aside>}</div>
      </section>
    </section>
    <StatusBar
      operation={operation}
      searching={searching}
      searchProgress={searchProgress}
      searchResultMeta={searchResultMeta}
      hasSearchResults={searchResults !== null}
      isLoading={isLoading}
      status={status}
      latestUndo={latestUndo}
      undoCount={undoStack.length}
      undoBusy={undoBusy}
      itemCount={sortedEntries.length}
      language={language}
      onOpenTasks={() => setTaskCenterOpen(true)}
      onTogglePaused={() => void toggleOperationPaused()}
      onCancelOperation={cancelOperation}
      onCancelSearch={cancelDeepSearch}
      onUndo={() => void undoLastOperation()}
    />
    {taskCenterOpen && (
      <TaskCenter
        tasks={operationTasks}
        filter={taskFilter}
        language={language}
        rateLimit={operationRateLimit}
        onClose={() => setTaskCenterOpen(false)}
        onFilterChange={setTaskFilter}
        onRateLimitChange={changeOperationRateLimit}
        onPrioritize={prioritizeTask}
        onTogglePaused={() => void toggleOperationPaused()}
        onCancel={cancelTask}
        onRetry={retryTaskFailures}
        onClearFinished={() => setOperationTasks((current) => current.filter((task) => !["completed", "cancelled", "failed"].includes(task.status)))}
      />
    )}
    {pendingTransfer && (
      <ConflictDialog
        pending={pendingTransfer}
        applyToRemaining={applyConflictToRemaining}
        language={language}
        onApplyToRemainingChange={setApplyConflictToRemaining}
        onCancel={() => setPendingTransfer(null)}
        onResolve={resolveCurrentConflict}
      />
    )}
    {operationIssues.length > 0 && (
      <OperationIssuesDialog
        issues={operationIssues}
        retry={retryTransfer}
        language={language}
        onClose={() => setOperationIssues([])}
        onRetryAll={retryAllTransferIssues}
        onRetryIssue={(issue) => void retrySingleTransferIssue(issue)}
      />
    )}
    {deleteRequest && (
      <DeleteConfirmationDialog
        request={deleteRequest}
        language={language}
        onCancel={() => setDeleteRequest(null)}
        onConfirm={() => void confirmDeleteRequest()}
      />
    )}
    {batchRenameOpen && <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !archiveBusy) setBatchRenameOpen(false); }}><section className="settings-panel batch-rename-panel" role="dialog" aria-modal="true" aria-labelledby="batch-rename-title"><header><div><h2 id="batch-rename-title">{text.batchRenameTitle}</h2><p>{text.batchRenameIntro}</p></div><button className="settings-close" disabled={archiveBusy} aria-label={text.cancel} onClick={() => setBatchRenameOpen(false)}>×</button></header><div className="batch-rename-fields"><label><span>{text.findText}</span><input autoFocus value={batchRenameDraft.find} onChange={(event) => setBatchRenameDraft((draft) => ({ ...draft, find: event.target.value }))} /></label><label><span>{text.replaceWith}</span><input value={batchRenameDraft.replace} onChange={(event) => setBatchRenameDraft((draft) => ({ ...draft, replace: event.target.value }))} /></label><label><span>{text.prefix}</span><input value={batchRenameDraft.prefix} onChange={(event) => setBatchRenameDraft((draft) => ({ ...draft, prefix: event.target.value }))} /></label><label><span>{text.suffix}</span><input value={batchRenameDraft.suffix} onChange={(event) => setBatchRenameDraft((draft) => ({ ...draft, suffix: event.target.value }))} /></label><label className="numbering-field"><span>{text.addNumbers}</span><button className={`switch ${batchRenameDraft.addNumbers ? "on" : ""}`} role="switch" aria-checked={batchRenameDraft.addNumbers} onClick={() => setBatchRenameDraft((draft) => ({ ...draft, addNumbers: !draft.addNumbers }))}><span /></button></label><label><span>{text.startAt}</span><input type="number" min="0" max="999999" disabled={!batchRenameDraft.addNumbers} value={batchRenameDraft.startNumber} onChange={(event) => setBatchRenameDraft((draft) => ({ ...draft, startNumber: Math.max(0, Number(event.target.value) || 0) }))} /></label></div><div className="batch-preview"><strong>{text.previewChanges}</strong>{batchRenamePreview.slice(0, 12).map(({ entry, name }) => <div key={entry.path}><span title={entry.name}>{entry.name}</span><b>→</b><span title={name}>{name}</span></div>)}{batchRenamePreview.length > 12 && <small>{language === "zh-CN" ? `另有 ${batchRenamePreview.length - 12} 个项目` : `${batchRenamePreview.length - 12} more item(s)`}</small>}</div>{batchRenameError && <div className="batch-rename-error">{batchRenameError}</div>}<div className="conflict-actions"><button disabled={archiveBusy} onClick={() => setBatchRenameOpen(false)}>{text.cancel}</button><button className="primary" disabled={archiveBusy} onClick={() => void applyBatchRename()}>{archiveBusy ? text.loading : text.applyRename}</button></div></section></div>}
    {spaceHealthOpen && renderSpaceHealth()}
    {quickPreviewOpen && selected && selectedPaths.size === 1 && <div className="quick-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setQuickPreviewOpen(false); }}><section className="quick-preview" role="dialog" aria-modal="true" aria-label={text.preview}><button className="quick-preview-close" aria-label={text.close} onClick={() => setQuickPreviewOpen(false)}>×</button><PreviewContent entry={selected} preview={preview} loading={previewLoading} language={language} copy={text} onOpen={() => { setQuickPreviewOpen(false); void openEntry(selected); }} onTextPage={(encoding, offset) => void loadTextPreviewPage(encoding, offset)} /></section></div>}
    {settingsOpen && <SettingsDialog
      language={language}
      showExtensions={showExtensions}
      showHidden={showHidden}
      appUpdate={appUpdate}
      appUpdateChecked={appUpdateChecked}
      appUpdateBusy={appUpdateBusy}
      appUpdateProgress={appUpdateProgress}
      appUpdateError={appUpdateError}
      preferEverything={preferEverything}
      everythingStatus={everythingStatus}
      everythingStatusBusy={everythingStatusBusy}
      everythingStatusError={everythingStatusError}
      folderIntegration={folderIntegration}
      folderIntegrationBusy={folderIntegrationBusy}
      folderIntegrationError={folderIntegrationError}
      folderContextMenu={folderContextMenu}
      folderContextMenuBusy={folderContextMenuBusy}
      folderContextMenuError={folderContextMenuError}
      claudeProvider={claudeProvider}
      claudeFullAccess={claudeFullAccess}
      claudeCredential={claudeCredential}
      claudeApiKeyDraft={claudeApiKeyDraft}
      claudeCredentialBusy={claudeCredentialBusy}
      claudeCredentialError={claudeCredentialError}
      claudeDiagnostic={claudeDiagnostic}
      claudeDiagnosticBusy={claudeDiagnosticBusy}
      onClose={() => setSettingsOpen(false)}
      onLanguageChange={chooseLanguage}
      onToggleExtensions={toggleExtensions}
      onToggleHidden={toggleHidden}
      onCheckForUpdates={() => void checkForUpdates()}
      onInstallUpdate={() => void installAvailableUpdate()}
      onToggleEverything={toggleEverythingSearch}
      onToggleFolderIntegration={() => void toggleFolderIntegration()}
      onToggleFolderContextMenu={() => void toggleFolderContextMenu()}
      onClaudeProviderChange={chooseClaudeProvider}
      onToggleClaudeFullAccess={toggleClaudeFullAccess}
      onClaudeApiKeyDraftChange={setClaudeApiKeyDraft}
      onSaveClaudeApiKey={() => void saveClaudeApiKey()}
      onRemoveClaudeApiKey={() => void removeClaudeApiKey()}
      onRunClaudeDiagnostic={() => void runClaudeDiagnostic()}
    />}
    {contextMenu?.kind === "entry" && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
      <button disabled={!selected || selectedPaths.size !== 1} onClick={() => { setContextMenu(null); if (selected) void openEntry(selected); }}><span>{text.open}</span><kbd>Enter</kbd></button>
      <button disabled={!selected || selectedPaths.size !== 1 || selected.isDirectory} onClick={() => { setContextMenu(null); void openWithSelected(); }}><span>{text.openWith}</span></button>
      <button disabled={!listing} onClick={() => { const path = terminalPathForSelection(); setContextMenu(null); void openTerminalAt(path); }}><span>{text.terminalHere}</span></button>
      <button disabled={!listing} onClick={() => { const path = terminalPathForSelection(); setContextMenu(null); void openTerminalAt(path, "claude"); }}><span>{text.claudeHere}</span><b>›_</b></button>
      <hr />
      <button onClick={() => { setContextMenu(null); void copySelection("copy"); }}><span>{text.copy}</span><kbd>Ctrl+C</kbd></button>
      <button onClick={() => { setContextMenu(null); void copySelection("move"); }}><span>{text.cut}</span><kbd>Ctrl+X</kbd></button>
      <button onClick={() => void copySelectionText("path")}><span>{text.copyPath}</span></button>
      <button onClick={() => void copySelectionText("name")}><span>{text.copyName}</span></button>
      <button onClick={() => { setContextMenu(null); void pasteIntoCurrent(); }}><span>{text.paste}</span><kbd>Ctrl+V</kbd></button>
      <hr />
      <button disabled={!selectedPaths.size || archiveBusy} onClick={() => void compressSelection()}><span>{text.compressZip}</span></button>
      <button disabled={selectedEntries.length !== 1 || selectedEntries[0]?.extension?.toLowerCase() !== "zip" || archiveBusy} onClick={() => void extractSelectedZip()}><span>{text.extractZip}</span></button>
      <button disabled={selectedPaths.size < 2 || archiveBusy} onClick={beginBatchRename}><span>{text.batchRename}</span></button>
      <hr />
      <button disabled={selectedPaths.size !== 1 || searchResults !== null} onClick={() => { setContextMenu(null); beginRename(); }}><span>{text.rename}</span><kbd>F2</kbd></button>
      <button onClick={() => { setContextMenu(null); void recycleSelection(); }}><span>{text.delete}</span><kbd>Del</kbd></button>
      <button className="danger" onClick={() => { setContextMenu(null); void permanentlyDeleteSelection(); }}><span>{text.permanentDelete}</span><kbd>Shift+Del</kbd></button>
      <hr />
      <button disabled={!selected || selectedPaths.size !== 1} onClick={() => void revealSelectedInExplorer()}><span>{text.revealInExplorer}</span></button>
      <button disabled={!selected || selectedPaths.size !== 1} onClick={() => void showSelectedSystemMenu()}><span>{text.systemMenu}</span><kbd>Shift+F10</kbd></button>
      <hr />
      <button disabled={!selected || selectedPaths.size !== 1} onClick={() => { setContextMenu(null); void showSelectedProperties(); }}><span>{text.properties}</span><kbd>Alt+Enter</kbd></button>
    </div>}
    {contextMenu?.kind === "background" && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
      <button onClick={() => void createItem("folder")}><span>{text.newFolder}</span></button>
      <button onClick={() => void createItem("text")}><span>{text.newTextFile}</span></button>
      <button onClick={() => void createItem("markdown")}><span>{text.newMarkdownFile}</span></button>
      <hr />
      <button onClick={() => { setContextMenu(null); void pasteIntoCurrent(); }}><span>{text.paste}</span><kbd>Ctrl+V</kbd></button>
      <button onClick={() => { setContextMenu(null); if (listing) void browse(listing.path, activeTabId, false); }}><span>{text.refresh}</span><kbd>F5</kbd></button>
      <button onClick={() => { setContextMenu(null); void openTerminalAt(); }}><span>{text.terminalHere}</span></button>
      <button onClick={() => { setContextMenu(null); void openTerminalAt(listing?.path, "claude"); }}><span>{text.claudeHere}</span><b>›_</b></button>
    </div>}
    {tabContextMenu && contextTab && <div className="context-menu tab-context-menu" style={{ left: tabContextMenu.x, top: tabContextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
      <button onClick={() => toggleTabPinned(contextTab.id)}><span>{contextTab.pinned ? text.unpinTab : text.pinTab}</span><b>{contextTab.pinned ? "⌖" : ""}</b></button>
      <button onClick={() => duplicateTab(contextTab)}><span>{text.duplicateTab}</span></button>
      <button disabled={!closedTabs.length} onClick={reopenClosedTab}><span>{text.reopenClosedTab}</span><kbd>Ctrl+Shift+T</kbd></button>
      <button onClick={() => { const path = contextTab.path; setTabContextMenu(null); void openTerminalAt(path); }}><span>{text.terminalHere}</span></button>
      <button onClick={() => { const path = contextTab.path; setTabContextMenu(null); void openTerminalAt(path, "claude"); }}><span>{text.claudeHere}</span><b>›_</b></button>
      <hr />
      <button disabled={contextTab.pinned || tabs.length === 1} onClick={() => closeTabById(contextTab.id)}><span>{text.closeTab}</span><kbd>Ctrl+W</kbd></button>
      <button disabled={tabs.every((tab) => tab.id === contextTab.id || tab.pinned)} onClick={() => closeOtherTabs(contextTab.id)}><span>{text.closeOtherTabs}</span></button>
    </div>}
    {historyMenu && <div className="context-menu history-context-menu" style={{ left: historyMenu.x, top: historyMenu.y }} onPointerDown={(event) => event.stopPropagation()}>{historyMenu.items.map((item) => <button key={`${item.index}-${item.path}`} title={item.path} onClick={() => navigateToHistory(item.index, item.path)}><span>{labelForPath(item.path)}</span><small>{item.path}</small></button>)}</div>}
    {dragGhost && <div className={`drag-ghost ${dragGhost.mode}`} style={{ left: dragGhost.x + 14, top: dragGhost.y + 14 }}><b>{dragGhost.mode === "blocked" ? "×" : dragGhost.mode === "copy" ? "+" : "→"}</b><span>{dragGhost.mode === "blocked" ? (language === "zh-CN" ? "不能放在这里" : "Can't drop here") : language === "zh-CN" ? `${dragGhost.mode === "copy" ? "复制" : "移动"} ${dragGhost.count} 项到 ${dragGhost.targetLabel}` : `${dragGhost.mode === "copy" ? "Copy" : "Move"} ${dragGhost.count} item(s) to ${dragGhost.targetLabel}`}</span></div>}
  </main>;
}

export default App;
