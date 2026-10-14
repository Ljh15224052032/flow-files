import { describe, expect, it } from "vitest";
import { UI_COPY } from "./localization";

describe("Flow Files localization", () => {
  it("keeps Chinese and English translation keys in sync", () => {
    expect(Object.keys(UI_COPY["zh-CN"]).sort()).toEqual(Object.keys(UI_COPY.en).sort());
  });

  it("does not ship empty interface strings", () => {
    for (const copy of Object.values(UI_COPY)) {
      expect(Object.values(copy).every((value) => value.trim().length > 0)).toBe(true);
    }
  });
});
