import { describe, expect, it } from "vitest";
import { searchProfileLabel, searchProfilesMatch } from "./search-utils";

describe("saved search helpers", () => {
  it("matches the same query without case sensitivity but preserves filters", () => {
    const first = { query: "Report", kind: "documents", date: "month", size: "large" } as const;
    expect(searchProfilesMatch(first, { ...first, query: "report" })).toBe(true);
    expect(searchProfilesMatch(first, { ...first, size: "small" })).toBe(false);
  });

  it("builds localized labels for saved filters", () => {
    const profile = { query: "预算", kind: "documents", date: "month", size: "large" } as const;
    expect(searchProfileLabel(profile, "zh-CN")).toContain("文档");
    expect(searchProfileLabel(profile, "en")).toContain("Documents");
    expect(searchProfileLabel({ query: "", kind: "all", date: "any", size: "any" }, "zh-CN")).toBe("搜索筛选");
  });
});
