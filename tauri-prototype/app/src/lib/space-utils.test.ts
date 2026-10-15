import { describe, expect, it } from "vitest";
import type { DuplicateGroup, SpaceScanItem } from "../types";
import {
  duplicateFileMatchesType, duplicateKeepReason, filterDuplicateGroups,
  filterSpaceCleanupCandidates, selectedSpaceItemBytes, spaceCategoryAdvice,
  spaceCategoryLabel, suggestedDuplicateKeep,
} from "./space-utils";

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

  it("filters cleanup candidates by age without treating unknown dates as old", () => {
    const now = 2_000_000_000;
    const old = item("C:\\Temp\\old.tmp", now - 91 * 86400);
    const recent = item("C:\\Temp\\recent.tmp", now - 5 * 86400);
    const unknown = { ...item("C:\\Temp\\unknown.tmp"), modifiedUnixSeconds: null };
    expect(filterSpaceCleanupCandidates([old, recent, unknown], "90", now)).toEqual([old]);
    expect(filterSpaceCleanupCandidates([old, recent, unknown], "all", now)).toHaveLength(3);
  });

  it("combines duplicate text, size, and type filters", () => {
    const photos = group([item("C:\\Photos\\trip.jpg"), item("D:\\Backup\\trip.jpg")]);
    photos.fileSize = 12 * 1024 * 1024;
    const docs = group([item("C:\\Docs\\notes.txt"), item("D:\\Backup\\notes.txt")]);
    docs.fileSize = 120 * 1024 * 1024;
    expect(filterDuplicateGroups([photos, docs], "trip", "10mb", "images")).toEqual([photos]);
    expect(filterDuplicateGroups([photos, docs], "backup", "100mb", "documents")).toEqual([docs]);
  });

  it("sums only explicitly selected diagnostic items", () => {
    const first = item("C:\\one.bin");
    const second = { ...item("C:\\two.bin"), size: 250 };
    expect(selectedSpaceItemBytes([first, second], new Set([second.path]))).toBe(250);
  });
});
