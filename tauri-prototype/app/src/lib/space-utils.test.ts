import { describe, expect, it } from "vitest";
import type { DuplicateGroup, SpaceScanItem } from "../types";
import { duplicateFileMatchesType, duplicateKeepReason, spaceCategoryAdvice, spaceCategoryLabel, suggestedDuplicateKeep } from "./space-utils";

function item(path: string, modifiedUnixSeconds = 0): SpaceScanItem {
  return { name: path.split("\\").pop() ?? path, path, size: 100, modifiedUnixSeconds, isDirectory: false };
}

function group(files: SpaceScanItem[]): DuplicateGroup {
  return { signature: "hash", fileSize: 100, reclaimableBytes: Math.max(0, files.length - 1) * 100, files };
}

describe("space diagnosis helpers", () => {
  it("prefers a normal path over a cache copy, then newer and shorter paths", () => {
    const cached = item("C:\\Temp\\cache\\copy.txt", 30);
    const normal = item("C:\\Docs\\copy.txt", 10);
    expect(suggestedDuplicateKeep(group([cached, normal]))).toEqual(normal);
    expect(duplicateKeepReason(group([cached, normal]), normal, "en")).toContain("outside temporary");
    const older = item("C:\\A\\same.txt", 10);
    const newer = item("C:\\VeryLongFolder\\same.txt", 20);
    expect(suggestedDuplicateKeep(group([older, newer]))).toEqual(newer);
  });

  it("classifies duplicate filters without treating known formats as other", () => {
    expect(duplicateFileMatchesType(item("C:\\photo.HEIC"), "images")).toBe(true);
    expect(duplicateFileMatchesType(item("C:\\archive.zip"), "other")).toBe(false);
    expect(duplicateFileMatchesType(item("C:\\data.unknown"), "other")).toBe(true);
  });

  it("keeps category labels and safety advice localized", () => {
    expect(spaceCategoryLabel("temporaryFiles", "zh-CN")).toBe("临时文件");
    expect(spaceCategoryAdvice("temporaryFiles", "en").cleanable).toBe(true);
    expect(spaceCategoryAdvice("systemManaged", "zh-CN").cleanable).toBe(false);
  });
});
