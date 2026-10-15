import { FolderGlyph } from "./Icons";
import { formatSize } from "../lib/format";
import { parentDirectory } from "../lib/file-utils";
import { UI_COPY } from "../localization";
import type { SpaceScanItem, UiLanguage } from "../types";

type SpaceRankingsProps = {
  directories: SpaceScanItem[];
  files: SpaceScanItem[];
  language: UiLanguage;
  onOpenDirectory: (item: SpaceScanItem) => void;
  onOpenFile: (item: SpaceScanItem) => void;
};

export function SpaceRankings({ directories, files, language, onOpenDirectory, onOpenFile }: SpaceRankingsProps) {
  const text = UI_COPY[language];
  const largestDirectorySize = Math.max(1, directories[0]?.size ?? 1);
  const largestFileSize = Math.max(1, files[0]?.size ?? 1);
  return <div className="space-ranking-grid">
    <section className="space-ranking">
      <header><strong>{text.largeDirectories}</strong><span>{language === "zh-CN" ? "点击目录继续向下检查" : "Click a folder to drill down"}</span></header>
      <div className="space-ranking-list">{directories.slice(0, 16).map((item) => <button key={item.path} title={language === "zh-CN" ? `继续检查 ${item.path}` : `Scan inside ${item.path}`} onClick={() => onOpenDirectory(item)}><span className="space-rank-icon"><FolderGlyph /></span><span className="space-rank-copy"><strong>{item.name}</strong><small>{item.path}</small><i><b style={{ width: `${Math.max(2, item.size / largestDirectorySize * 100)}%` }} /></i></span><em>{formatSize(item.size)} <b>›</b></em></button>)}</div>
    </section>
    <section className="space-ranking">
      <header><strong>{text.largeFilesTitle}</strong><span>{language === "zh-CN" ? "点击可在 Flow Files 中定位" : "Click to locate in Flow Files"}</span></header>
      <div className="space-ranking-list">{files.slice(0, 16).map((item) => <button key={item.path} title={`${text.openLocation}: ${item.path}`} onClick={() => onOpenFile(item)}><span className="space-rank-file">▤</span><span className="space-rank-copy"><strong>{item.name}</strong><small>{parentDirectory(item.path)}</small><i><b style={{ width: `${Math.max(2, item.size / largestFileSize * 100)}%` }} /></i></span><em>{formatSize(item.size)}</em></button>)}</div>
    </section>
  </div>;
}
