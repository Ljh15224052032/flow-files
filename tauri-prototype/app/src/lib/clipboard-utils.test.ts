import { describe, expect, it } from "vitest";
import { formatPathsForClipboard } from "./clipboard-utils";

describe("formatPathsForClipboard", () => {
  it("quotes paths for command-line use", () => {
    expect(formatPathsForClipboard(["D:\\My Folder", "C:\\notes.txt"], true))
      .toBe("\"D:\\My Folder\"\r\n\"C:\\notes.txt\"");
  });

  it("preserves raw paths when copying as text", () => {
    expect(formatPathsForClipboard(["D:\\My Folder", "C:\\notes.txt"], false))
      .toBe("D:\\My Folder\r\nC:\\notes.txt");
  });
});
