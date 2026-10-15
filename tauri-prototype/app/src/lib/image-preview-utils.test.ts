import { describe, expect, it } from "vitest";
import { actualSizeZoom, clampImagePan, clampImageZoom } from "./image-preview-utils";

describe("image preview viewport helpers", () => {
  it("keeps zoom finite and inside the supported range", () => {
    expect(clampImageZoom(0.01)).toBe(0.25);
    expect(clampImageZoom(20)).toBe(16);
    expect(clampImageZoom(Number.NaN)).toBe(1);
  });

  it("calculates a one-to-one zoom from the fitted image size", () => {
    expect(actualSizeZoom(4000, 2000, 800, 400)).toBe(5);
    expect(actualSizeZoom(200, 100, 200, 100)).toBe(1);
    expect(actualSizeZoom(0, 100, 200, 100)).toBe(1);
  });

  it("prevents a dragged image from being lost outside its viewport", () => {
    expect(clampImagePan({ x: 900, y: -700 }, 300, 200, 300, 150, 2)).toEqual({ x: 150, y: -50 });
    expect(clampImagePan({ x: 20, y: 20 }, 300, 200, 200, 100, 1)).toEqual({ x: 0, y: 0 });
  });
});
