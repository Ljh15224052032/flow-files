import type { DuplicateGroup, DuplicateTypeFilter, SpaceCategoryAdvice, SpaceScanItem, UiLanguage } from "../types";

const TRANSIENT_PATH = /[\\/](temp|tmp|cache|caches|\.cache|\$recycle\.bin|node_modules)[\\/]/i;

export function suggestedDuplicateKeep(group: DuplicateGroup) {
  if (!group.files.length) return null;
  return [...group.files].sort((left, right) => {
    const leftTransient = TRANSIENT_PATH.test(left.path) ? 1 : 0;
    const rightTransient = TRANSIENT_PATH.test(right.path) ? 1 : 0;
    if (leftTransient !== rightTransient) return leftTransient - rightTransient;
    const modified = (right.modifiedUnixSeconds ?? 0) - (left.modifiedUnixSeconds ?? 0);
    if (modified !== 0) return modified;
    return left.path.length - right.path.length || left.path.localeCompare(right.path);
  })[0];
}

export function duplicateKeepReason(group: DuplicateGroup, suggested: SpaceScanItem, language: UiLanguage) {
  const alternatives = group.files.filter((item) => item.path !== suggested.path);
  if (!TRANSIENT_PATH.test(suggested.path) && alternatives.some((item) => TRANSIENT_PATH.test(item.path))) {
    return language === "zh-CN" ? "不在临时或缓存目录" : "outside temporary and cache folders";
  }
  const newest = Math.max(...group.files.map((item) => item.modifiedUnixSeconds ?? 0));
  if ((suggested.modifiedUnixSeconds ?? 0) === newest && alternatives.some((item) => (item.modifiedUnixSeconds ?? 0) !== newest)) {
    return language === "zh-CN" ? "修改时间较新" : "newer modified date";
  }
  return language === "zh-CN" ? "路径较短，通常更容易识别" : "shorter, easier-to-recognize path";
}

export function duplicateFileMatchesType(item: SpaceScanItem, type: DuplicateTypeFilter) {
  if (type === "all") return true;
  const extension = item.name.includes(".") ? item.name.split(".").pop()!.toLowerCase() : "";
  const groups: Record<Exclude<DuplicateTypeFilter, "all" | "other">, Set<string>> = {
    images: new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "avif", "tif", "tiff"]),
    videos: new Set(["mp4", "mkv", "mov", "avi", "webm", "wmv", "m4v", "flv"]),
    audio: new Set(["mp3", "wav", "flac", "aac", "m4a", "ogg", "wma", "opus"]),
    documents: new Set(["txt", "md", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "rtf"]),
    archives: new Set(["zip", "7z", "rar", "tar", "gz", "bz2", "xz"]),
  };
  const known = Object.values(groups).some((extensions) => extensions.has(extension));
  return type === "other" ? !known : groups[type].has(extension);
}

const CATEGORY_LABELS: Record<string, [string, string]> = {
  temporaryFiles: ["临时文件", "Temporary files"],
  browserCache: ["浏览器缓存", "Browser caches"],
  recycleBin: ["回收站", "Recycle Bin"],
  aiModels: ["本地 AI 模型", "Local AI models"],
  developerCaches: ["开发工具缓存", "Developer caches"],
  downloads: ["下载目录", "Downloads"],
  installersArchives: ["安装包与压缩文件", "Installers and archives"],
  windowsUpdateCache: ["Windows 更新缓存", "Windows Update cache"],
  systemManaged: ["系统管理文件", "System-managed files"],
};

export function spaceCategoryLabel(id: string, language: UiLanguage) {
  return CATEGORY_LABELS[id]?.[language === "zh-CN" ? 0 : 1] ?? id;
}

export function spaceCategoryAdvice(id: string, language: UiLanguage): SpaceCategoryAdvice {
  const zh: Record<string, SpaceCategoryAdvice> = {
    temporaryFiles: { summary: "建议优先复核；通常是应用和系统留下的临时内容。", action: "关闭正在使用的软件后，勾选确认不再需要的文件并移入回收站。", caution: "正在使用的文件会被跳过；清理后个别应用首次启动可能稍慢。", cleanable: true },
    browserCache: { summary: "可释放空间，网页资源之后会自动重新下载。", action: "先关闭 Chrome、Edge 或 Firefox，再复核缓存文件并移入回收站。", caution: "这里只识别缓存目录，不会把密码、历史记录和书签列入清理。", cleanable: true },
    recycleBin: { summary: "其中内容已经删除，但仍占用磁盘空间。", action: "确认没有需要恢复的文件后，使用 Windows 的“清空回收站”。", caution: "清空回收站是永久操作，Flow Files 不在这里替你自动执行。", cleanable: false },
    aiModels: { summary: "模型通常很大，但删除后相关工具需要重新下载。", action: "按名称与路径确认不再使用的模型；更推荐先移动到其他磁盘。", caution: "这不是垃圾文件，必须逐项选择，不会默认勾选。", cleanable: true },
    developerCaches: { summary: "大多可以重建，但下次构建或安装依赖时会再次下载。", action: "优先处理长期不用的 Cargo、npm、pnpm、pip 或 NuGet 缓存。", caution: "近期项目仍可能依赖离线缓存；必须逐项复核。", cleanable: true },
    downloads: { summary: "下载目录是个人文件，不应自动当作垃圾。", action: "按大小和日期复核；优先移动到其他磁盘，仅删除确定无用的文件。", caution: "所有项目默认不选中。", cleanable: true },
    installersArchives: { summary: "已完成安装的安装包和重复压缩包可能可以处理。", action: "确认软件已安装、压缩内容已保存后，再逐项移入回收站。", caution: "备份包、镜像和唯一压缩副本可能仍有价值。", cleanable: true },
    windowsUpdateCache: { summary: "由 Windows 更新服务管理，不建议直接删除文件。", action: "请使用 Windows 设置中的“系统 → 存储 → 临时文件”处理。", caution: "直接改动可能造成更新修复或安装异常。", cleanable: false },
    systemManaged: { summary: "页面文件、休眠文件和转储文件由 Windows 管理。", action: "通过 Windows 存储设置、休眠设置或系统高级设置调整。", caution: "不要在文件管理器中直接删除。", cleanable: false },
  };
  const en: Record<string, SpaceCategoryAdvice> = {
    temporaryFiles: { summary: "Recommended for review; these are usually temporary app and system files.", action: "Close active apps, review each file, then move confirmed items to the Recycle Bin.", caution: "In-use files are skipped; some apps may start more slowly once.", cleanable: true },
    browserCache: { summary: "Can free space; web resources will be downloaded again when needed.", action: "Close browsers first, then review cache files and move confirmed items to the Recycle Bin.", caution: "Passwords, history, and bookmarks are not included.", cleanable: true },
    recycleBin: { summary: "Deleted items still occupy disk space.", action: "Use Windows Empty Recycle Bin after confirming nothing needs restoring.", caution: "Emptying it is permanent, so Flow Files does not run it automatically here.", cleanable: false },
    aiModels: { summary: "Models are often large, but tools must download them again after deletion.", action: "Confirm unused models by name and path; moving them to another drive is preferred.", caution: "These are not junk files and are never preselected.", cleanable: true },
    developerCaches: { summary: "Usually rebuildable, but builds and package installs may download them again.", action: "Prioritize old Cargo, npm, pnpm, pip, or NuGet cache files.", caution: "Recent projects may need offline caches; review every item.", cleanable: true },
    downloads: { summary: "Downloads are personal files and must not be treated as automatic junk.", action: "Review by size and date; prefer moving to another drive.", caution: "No item is preselected.", cleanable: true },
    installersArchives: { summary: "Completed installers and duplicate archives may be removable.", action: "Confirm installation or extraction first, then recycle individual items.", caution: "Backups, images, and unique archives may still be valuable.", cleanable: true },
    windowsUpdateCache: { summary: "Managed by Windows Update and not suitable for direct deletion.", action: "Use Windows Settings → System → Storage → Temporary files.", caution: "Direct changes can interfere with update repair or installation.", cleanable: false },
    systemManaged: { summary: "Page, hibernation, and dump files are managed by Windows.", action: "Use Windows Storage, hibernation, or advanced system settings.", caution: "Do not delete them in a file manager.", cleanable: false },
  };
  return (language === "zh-CN" ? zh : en)[id] ?? {
    summary: language === "zh-CN" ? "请先查看文件来源和用途。" : "Review the source and purpose first.",
    action: language === "zh-CN" ? "仅处理你确认不再需要的内容。" : "Only handle items you no longer need.",
    caution: language === "zh-CN" ? "不会自动选择或删除。" : "Nothing is selected or deleted automatically.",
    cleanable: false,
  };
}
