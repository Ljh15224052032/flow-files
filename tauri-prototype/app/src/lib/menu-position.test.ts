import { describe, expect, it } from "vitest";
import { placeFloatingMenu } from "./menu-position";

describe("placeFloatingMenu", () => {
  it("opens downward when the menu fits below the pointer", () => {
    expect(placeFloatingMenu({ anchorX: 100, anchorY: 100, menuWidth: 220, menuHeight: 300, viewportWidth: 1000, viewportHeight: 800 }))
      .toEqual({ left: 100, top: 100, maxHeight: 692, direction: "down" });
  });

  it("opens upward when the pointer is close to the bottom edge", () => {
    expect(placeFloatingMenu({ anchorX: 100, anchorY: 740, menuWidth: 220, menuHeight: 500, viewportWidth: 1000, viewportHeight: 800 }))
      .toEqual({ left: 100, top: 240, maxHeight: 732, direction: "up" });
  });

  it("keeps an oversized menu on the larger side and makes it scrollable", () => {
    expect(placeFloatingMenu({ anchorX: 100, anchorY: 500, menuWidth: 220, menuHeight: 900, viewportWidth: 1000, viewportHeight: 700 }))
      .toEqual({ left: 100, top: 8, maxHeight: 492, direction: "up" });
  });

  it("clamps the menu inside the right edge", () => {
    expect(placeFloatingMenu({ anchorX: 950, anchorY: 100, menuWidth: 220, menuHeight: 100, viewportWidth: 1000, viewportHeight: 800 }).left)
      .toBe(772);
  });
});
