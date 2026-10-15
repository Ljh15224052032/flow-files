import type { SpaceScanSnapshot } from "../types";

export type SpaceHistoryPoint = {
  snapshot: SpaceScanSnapshot;
  availableDelta: number | null;
  usedPercent: number;
};

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
