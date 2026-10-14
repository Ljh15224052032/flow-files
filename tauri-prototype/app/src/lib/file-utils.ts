import type {
  BatchRenameDraft, DirectoryStatus, EntryIconKind, FileEntry, SortDirection, SortKey,
  UiLanguage,
} from "../types";

export function labelForPath(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || path;
}

export function volumeKey(path: string) {
  const drive = path.match(/^([A-Za-z]:)[\\/]/);
  if (drive) return drive[1].toLowerCase();
  const network = path.match(/^\\\\([^\\]+)\\([^\\]+)/);
  return network ? `\\\\${network[1].toLowerCase()}\\${network[2].toLowerCase()}` : "";
}

export function directoryKindForPath(path: string): DirectoryStatus["kind"] {
  return path.startsWith("\\\\") ? "network" : /^[A-Za-z]:/.test(path) ? "drive" : "folder";
}

export function nativeDropMode(paths: string[], destination: string): "copy" | "move" {
  const destinationVolume = volumeKey(destination);
  return destinationVolume && paths.every((path) => volumeKey(path) === destinationVolume) ? "move" : "copy";
}

export function displayName(entry: FileEntry, showExtensions: boolean) {
  if (entry.isDirectory || showExtensions) return entry.name;
  const extensionStart = entry.name.lastIndexOf(".");
  return extensionStart > 0 ? entry.name.slice(0, extensionStart) : entry.name;
}

export function joinWindowsPath(parent: string, name: string) {
  return `${parent.replace(/[\\/]+$/, "")}\\${name}`;
}

export function parentDirectory(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  if (/^\\\\[^\\]+\\[^\\]+$/.test(normalized)) return normalized;
  const separator = normalized.lastIndexOf("\\");
  if (/^[A-Za-z]:/.test(normalized) && separator <= 2) return `${normalized.slice(0, 2)}\\`;
  if (separator < 0) return normalized;
  return normalized.slice(0, separator);
}

export function batchNameFor(entry: FileEntry, draft: BatchRenameDraft, index: number, total: number) {
  const dot = entry.isDirectory ? -1 : entry.name.lastIndexOf(".");
  const stem = dot > 0 ? entry.name.slice(0, dot) : entry.name;
  const extension = dot > 0 ? entry.name.slice(dot) : "";
  const replaced = draft.find ? stem.split(draft.find).join(draft.replace) : stem;
  const digits = Math.max(2, String(Math.max(draft.startNumber, draft.startNumber + total - 1)).length);
  const number = draft.addNumbers ? `${String(draft.startNumber + index).padStart(digits, "0")} ` : "";
  return `${draft.prefix}${number}${replaced}${draft.suffix}${extension}`;
}

export function iconKindFor(entry: FileEntry): EntryIconKind {
  if (entry.isDirectory) return "folder";
  const extension = entry.extension?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp", "gif", "heic", "bmp", "svg"].includes(extension)) return "image";
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(extension)) return "video";
  if (["mp3", "wav", "flac", "aac", "m4a", "ogg"].includes(extension)) return "audio";
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) return "archive";
  if (["js", "jsx", "ts", "tsx", "rs", "cs", "py", "java", "cpp", "c", "h", "html", "css", "json", "xml", "yaml", "yml", "toml", "md"].includes(extension)) return "code";
  if (extension === "pdf") return "pdf";
  if (["exe", "msi", "bat", "cmd", "ps1"].includes(extension)) return "app";
  if (["txt", "doc", "docx", "rtf", "odt", "xls", "xlsx", "ppt", "pptx", "csv"].includes(extension)) return "document";
  return "file";
}

export function typeLabelFor(entry: FileEntry, language: UiLanguage) {
  if (entry.isDirectory) return language === "zh-CN" ? "文件夹" : "Folder";
  const extension = entry.extension?.toLowerCase() ?? "";
  const exactLabels: Record<string, string> = language === "zh-CN" ? {
    pdf: "PDF 文档", txt: "文本文档", md: "Markdown 文档", doc: "Word 文档", docx: "Word 文档", xls: "Excel 工作簿", xlsx: "Excel 工作簿",
    ppt: "PowerPoint 演示文稿", pptx: "PowerPoint 演示文稿", csv: "CSV 文档", exe: "应用程序", msi: "安装程序", bat: "批处理脚本",
    cmd: "命令脚本", ps1: "PowerShell 脚本", zip: "ZIP 压缩文件", rar: "RAR 压缩文件", "7z": "7-Zip 压缩文件", tar: "TAR 压缩文件", gz: "GZip 压缩文件",
  } : {
    pdf: "PDF document", txt: "Text document", md: "Markdown document", doc: "Word document", docx: "Word document", xls: "Excel workbook", xlsx: "Excel workbook",
    ppt: "PowerPoint", pptx: "PowerPoint", csv: "CSV document", exe: "Application", msi: "Installer", bat: "Batch script", cmd: "Command script",
    ps1: "PowerShell script", zip: "ZIP archive", rar: "RAR archive", "7z": "7-Zip archive", tar: "TAR archive", gz: "GZip archive",
  };
  if (exactLabels[extension]) return exactLabels[extension];
  const kind = iconKindFor(entry);
  const categoryLabels: Partial<Record<EntryIconKind, string>> = language === "zh-CN"
    ? { image: "图像", video: "视频", audio: "音频", code: "源代码文件", document: "文档" }
    : { image: "Image", video: "Video", audio: "Audio", code: "Source file", document: "Document" };
  if (categoryLabels[kind]) return extension ? `${extension.toUpperCase()} ${categoryLabels[kind]}` : categoryLabels[kind]!;
  return extension ? `${extension.toUpperCase()} ${language === "zh-CN" ? "文件" : "file"}` : language === "zh-CN" ? "文件" : "File";
}

export function sortEntriesForView(entries: FileEntry[], sortKey: SortKey, sortDirection: SortDirection, language: UiLanguage) {
  return [...entries].sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
    let comparison = 0;
    if (sortKey === "modified") comparison = (left.modifiedUnixSeconds ?? 0) - (right.modifiedUnixSeconds ?? 0);
    else if (sortKey === "type") comparison = typeLabelFor(left, language).localeCompare(typeLabelFor(right, language), language, { numeric: true, sensitivity: "base" });
    else if (sortKey === "size") comparison = left.size - right.size;
    else comparison = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
    return sortDirection === "ascending" ? comparison : -comparison;
  });
}

export function pathCrumbs(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return [];
  if (normalized.startsWith("\\\\") && parts.length >= 2) {
    const root = `\\\\${parts[0]}\\${parts[1]}`;
    return [{ label: root, path: root }, ...parts.slice(2).map((label, index) => ({ label, path: `${root}\\${parts.slice(2, index + 3).join("\\")}` }))];
  }
  return parts.map((label, index) => ({
    label: index === 0 && /^[A-Za-z]:$/.test(label) ? `${label}\\` : label,
    path: index === 0 && /^[A-Za-z]:$/.test(label) ? `${label}\\` : parts.slice(0, index + 1).join("\\"),
  }));
}

export function localizedLocation(label: string, language: UiLanguage) {
  if (language !== "zh-CN") return label;
  return ({ Home: "主页", Desktop: "桌面", Documents: "文档", Downloads: "下载", Pictures: "图片" } as Record<string, string>)[label] ?? label;
}

export function isThumbnailCandidate(entry: FileEntry) {
  return !entry.isDirectory && ["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(entry.extension?.toLowerCase() ?? "");
}
