import { describe, expect, it } from "vitest";
import type { SpaceScanSnapshot } from "../types";
import { visibleSpaceHistory } from "./space-history";

function snapshot(capturedAt: number, availableSpace: number, totalSpace = 100): SpaceScanSnapshot {
  return { root: "C:\\", capturedAt, availableSpace, totalSpace, scannedBytes: 0, categories: {} };
}

describe("disk space history", () => {
  it("keeps the latest visible points while comparing the first one with hidden history", () => {
    const history = Array.from({ length: 8 }, (_, index) => snapshot(index, 80 - index * 5));
    const points = visibleSpaceHistory(history, 6);
    expect(points.map((point) => point.snapshot.capturedAt)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(points[0].availableDelta).toBe(-5);
    expect(points[5].usedPercent).toBeCloseTo(55);
  });

  it("clamps invalid capacity ratios into a displayable percentage", () => {
    expect(visibleSpaceHistory([snapshot(1, -50)])[0].usedPercent).toBe(100);
    expect(visibleSpaceHistory([snapshot(1, 200)])[0].usedPercent).toBe(0);
    expect(visibleSpaceHistory([snapshot(1, 0, 0)])[0].usedPercent).toBe(0);
  });
});
