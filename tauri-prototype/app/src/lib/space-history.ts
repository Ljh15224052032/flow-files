import type { SpaceScanResult, SpaceScanSnapshot } from "../types";

export type SpaceHistoryPoint = {
  snapshot: SpaceScanSnapshot;
  availableDelta: number | null;
  usedPercent: number;
};

export function spaceCapacitySummary(result: SpaceScanResult, previous: SpaceScanSnapshot | null) {
  const usedBytes = Math.max(0, result.totalSpace - result.availableSpace);
  const usedPercent = result.totalSpace
    ? Math.max(0, Math.min(100, usedBytes / result.totalSpace * 100))
    : 0;
  return {
    usedBytes,
    usedPercent,
    availableDelta: previous ? result.availableSpace - previous.availableSpace : null,
  };
}

export function visibleSpaceHistory(history: SpaceScanSnapshot[], limit = 6): SpaceHistoryPoint[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  const start = Math.max(0, history.length - safeLimit);
  return history.slice(start).map((snapshot, index) => {
    const historyIndex = start + index;
    const previous = historyIndex > 0 ? history[historyIndex - 1] : null;
    const usedPercent = snapshot.totalSpace
      ? Math.max(0, Math.min(100, (snapshot.totalSpace - snapshot.availableSpace) / snapshot.totalSpace * 100))
      : 0;
    return {
      snapshot,
      availableDelta: previous ? snapshot.availableSpace - previous.availableSpace : null,
      usedPercent,
    };
  });
}
