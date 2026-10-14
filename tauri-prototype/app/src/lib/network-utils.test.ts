import { describe, expect, it } from "vitest";
import type { DirectoryStatus } from "../types";
import { nextAvailabilityRetry, unavailableLocationCopy } from "./network-utils";

function status(reason: DirectoryStatus["reason"], kind: DirectoryStatus["kind"] = "network"): DirectoryStatus {
  return { path: "\\\\server\\share", available: false, kind, reason };
}

describe("network recovery helpers", () => {
  it("distinguishes access, missing, unreachable, and timeout messages", () => {
    const messages = ["accessDenied", "notFound", "unreachable", "timeout"].map((reason) =>
      unavailableLocationCopy(status(reason as DirectoryStatus["reason"]), "zh-CN").title,
    );
    expect(new Set(messages).size).toBe(4);
    expect(unavailableLocationCopy(status("unreachable"), "en").title).toContain("Network");
    expect(unavailableLocationCopy(status("unreachable", "drive"), "en").title).toContain("Drive");
  });

  it("backs off from eight seconds and caps retries at two minutes", () => {
    const now = 1_000;
    expect(nextAvailabilityRetry(0, now)).toEqual({ failures: 1, nextAt: now + 8_000 });
    expect(nextAvailabilityRetry(1, now)).toEqual({ failures: 2, nextAt: now + 16_000 });
    expect(nextAvailabilityRetry(4, now)).toEqual({ failures: 5, nextAt: now + 120_000 });
    expect(nextAvailabilityRetry(99, now)).toEqual({ failures: 5, nextAt: now + 120_000 });
  });
});
