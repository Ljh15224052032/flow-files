import { describe, expect, it } from "vitest";
import type { FileEntry } from "../types";
import {
  batchNameFor, directoryKindForPath, displayName, iconKindFor, labelForPath, nativeDropMode,
  pathCrumbs, sortEntriesForView, typeLabelFor, volumeKey,
} from "./file-utils";

function entry(name: string, options: Partial<FileEntry> = {}): FileEntry {
  const extension = name.includes(".") ? name.split(".").pop() ?? null : null;
  return {
    name,
    path: `C:\\test\\${name}`,
    isDirectory: false,
    size: 0,
    modifiedUnixSeconds: 0,
    extension,
    isHidden: false,
    isLink: false,
    linkTarget: null,
    ...options,
  };
}

describe("Windows path helpers", () => {
  it("recognizes local and network volume roots", () => {
    expect(volumeKey("D:\\projects\\flow")).toBe("d:");
    expect(volumeKey("\\\\server\\share\\folder")).toBe("\\\\server\\share");
    expect(directoryKindForPath("\\\\server\\share")).toBe("network");
    expect(directoryKindForPath("D:\\")).toBe("drive");
    expect(directoryKindForPath("relative-folder")).toBe("folder");
  });

  it("uses move on one volume and copy across volumes", () => {
    expect(nativeDropMode(["D:\\a.txt", "D:\\folder\\b.txt"], "D:\\target")).toBe("move");
    expect(nativeDropMode(["C:\\a.txt"], "D:\\target")).toBe("copy");
    expect(nativeDropMode(["\\\\server\\share\\a.txt"], "\\\\server\\share\\target")).toBe("move");
  });

  it("builds drive and UNC breadcrumbs without losing their roots", () => {
    expect(pathCrumbs("D:\\projects\\flow")).toEqual([
      { label: "D:\\", path: "D:\\" },
      { label: "projects", path: "D:\\projects" },
      { label: "flow", path: "D:\\projects\\flow" },
    ]);
    expect(pathCrumbs("\\\\server\\share\\folder")).toEqual([
      { label: "\\\\server\\share", path: "\\\\server\\share" },
      { label: "folder", path: "\\\\server\\share\\folder" },
    ]);
    expect(labelForPath("D:\\projects\\flow\\")).toBe("flow");
  });
});

describe("file presentation helpers", () => {
  it("hides only the final extension", () => {
    expect(displayName(entry("archive.backup.zip"), false)).toBe("archive.backup");
    expect(displayName(entry("archive.backup.zip"), true)).toBe("archive.backup.zip");
    expect(displayName(entry("folder.name", { isDirectory: true }), false)).toBe("folder.name");
  });

  it("classifies icons and localized file types", () => {
    expect(iconKindFor(entry("photo.webp"))).toBe("image");
    expect(iconKindFor(entry("script.ts"))).toBe("code");
    expect(typeLabelFor(entry("report.xlsx"), "zh-CN")).toBe("Excel 工作簿");
    expect(typeLabelFor(entry("clip.mkv"), "en")).toBe("MKV Video");
  });

  it("keeps folders first while sorting files", () => {
    const values = [
      entry("b.txt", { size: 2 }),
      entry("folder", { isDirectory: true }),
      entry("a.txt", { size: 1 }),
    ];
    expect(sortEntriesForView(values, "name", "ascending", "en").map((item) => item.name))
      .toEqual(["folder", "a.txt", "b.txt"]);
    expect(sortEntriesForView(values, "size", "descending", "en").map((item) => item.name))
      .toEqual(["folder", "b.txt", "a.txt"]);
  });

  it("previews batch rename output without changing extensions", () => {
    expect(batchNameFor(entry("draft.final.md"), {
      find: "draft",
      replace: "report",
      prefix: "项目-",
      suffix: "-完成",
      addNumbers: true,
      startNumber: 3,
    }, 0, 12)).toBe("项目-03 report.final-完成.md");
  });
});
