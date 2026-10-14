import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { TEXT_PREVIEW_CHUNK } from "../constants";
import { detailLabel, formatDate, formatSize } from "../lib/format";
import { iconKindFor } from "../lib/file-utils";
import type { FileDetails, FileEntry, FilePreview, UiLanguage } from "../types";
import { EntryIcon } from "./Icons";

type PreviewCopy = {
  folder: string;
  officePreviewHint: string;
  codecUnavailable: string;
  noPreview: string;
  open: string;
};

type PreviewContentProps = {
  entry: FileEntry;
  preview: FilePreview | null;
  loading: boolean;
  language: UiLanguage;
  copy: PreviewCopy;
  onOpen: () => void;
  onTextPage: (encoding: string, offset: number) => void;
};

export function PreviewContent({ entry, preview, loading, language, copy: text, onOpen, onTextPage }: PreviewContentProps) {
  const sourceUrl = !entry.isDirectory ? convertFileSrc(entry.path) : "";
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfZoom, setPdfZoom] = useState(100);
  const [mediaInfo, setMediaInfo] = useState<{ duration: number; width: number; height: number } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState<FileDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    setPdfPage(1);
    setPdfZoom(100);
    setMediaInfo(null);
    setDetailsOpen(false);
    setDetails(null);
    setDetailsLoading(false);
  }, [entry.path]);

  const textPage = preview?.kind === "text" ? Math.floor(preview.textOffset / TEXT_PREVIEW_CHUNK) + 1 : 1;
  const textPages = preview?.kind === "text" ? Math.max(1, Math.ceil(preview.totalBytes / TEXT_PREVIEW_CHUNK)) : 1;
  const pdfUrl = `${sourceUrl}#page=${pdfPage}&zoom=${pdfZoom}`;
  const detailsSupported = ["image", "svg", "heic", "audio"].includes(preview?.kind ?? "");

  async function toggleDetails() {
    const nextOpen = !detailsOpen;
    setDetailsOpen(nextOpen);
    if (!nextOpen || details || detailsLoading) return;
    setDetailsLoading(true);
    try {
      setDetails(await invoke<FileDetails>("load_file_details", { path: entry.path }));
    } catch {
      setDetails({ items: [] });
    } finally {
      setDetailsLoading(false);
    }
  }

  const media = loading ? <span className="preview-spinner" />
    : preview?.kind === "image" && preview.dataUrl ? <img src={preview.dataUrl} alt="" />
      : (preview?.kind === "svg" || preview?.kind === "heic") ? <img src={sourceUrl} alt="" />
        : preview?.kind === "pdf" ? <div className="pdf-preview-shell"><div className="preview-toolstrip"><button disabled={pdfPage <= 1} onClick={() => setPdfPage((page) => Math.max(1, page - 1))}>‹</button><label>{language === "zh-CN" ? "第" : "Page"}<input type="number" min="1" value={pdfPage} onChange={(event) => setPdfPage(Math.max(1, Number(event.target.value) || 1))} />{language === "zh-CN" ? "页" : ""}</label><button onClick={() => setPdfPage((page) => page + 1)}>›</button><span /><button disabled={pdfZoom <= 50} onClick={() => setPdfZoom((zoom) => Math.max(50, zoom - 25))}>−</button><b>{pdfZoom}%</b><button disabled={pdfZoom >= 200} onClick={() => setPdfZoom((zoom) => Math.min(200, zoom + 25))}>＋</button></div><iframe key={pdfUrl} src={pdfUrl} title={entry.name} /></div>
          : preview?.kind === "video" ? <video src={sourceUrl} controls preload="metadata" onLoadedMetadata={(event) => setMediaInfo({ duration: event.currentTarget.duration, width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })} />
            : preview?.kind === "audio" ? <audio src={sourceUrl} controls preload="metadata" onLoadedMetadata={(event) => setMediaInfo({ duration: event.currentTarget.duration, width: 0, height: 0 })} />
              : preview?.kind === "text" ? <div className="text-preview-shell"><div className="preview-toolstrip"><select aria-label={language === "zh-CN" ? "文本编码" : "Text encoding"} value={preview.encoding ?? "utf-8"} onChange={(event) => onTextPage(event.target.value, 0)}><option value="utf-8">UTF-8</option><option value="gbk">GBK / GB18030</option><option value="big5">Big5</option><option value="windows-1252">Windows-1252</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select><span /><button disabled={preview.textOffset <= 0} onClick={() => onTextPage(preview.encoding ?? "utf-8", Math.max(0, preview.textOffset - TEXT_PREVIEW_CHUNK))}>‹</button><b>{textPage}/{textPages}</b><button disabled={!preview.truncated} onClick={() => onTextPage(preview.encoding ?? "utf-8", preview.textOffset + TEXT_PREVIEW_CHUNK)}>›</button></div><pre>{preview.text}</pre></div>
                : <span className={`preview-generic entry-icon ${iconKindFor(entry)}-icon`}><EntryIcon entry={entry} /></span>;

  return <div className="preview-content">
    <div className={`preview-visual ${preview?.kind ?? "none"}`}>{media}</div>
    <strong title={entry.name}>{entry.name}</strong>
    <span>{entry.isDirectory ? text.folder : formatSize(entry.size)} · {formatDate(entry.modifiedUnixSeconds, language)}</span>
    {mediaInfo && mediaInfo.width > 0 && <small className="media-info">{mediaInfo.width} × {mediaInfo.height}</small>}
    {entry.isLink && entry.linkTarget && <small className="link-target" title={entry.linkTarget}>→ {entry.linkTarget}</small>}
    {preview?.kind === "text" && textPages > 1 && <small>{language === "zh-CN" ? `分段显示，每段最多 128 KB · 第 ${textPage}/${textPages} 段` : `Shown in 128 KB chunks · Part ${textPage} of ${textPages}`}</small>}
    {preview?.kind === "office" && <small>{text.officePreviewHint}</small>}
    {preview?.kind === "heic" && <small>{text.codecUnavailable}</small>}
    {preview?.kind === "none" && !entry.isDirectory && !loading && <small>{text.noPreview}</small>}
    {detailsSupported && <section className={`preview-details ${detailsOpen ? "open" : ""}`}><button aria-expanded={detailsOpen} onClick={() => void toggleDetails()}><span>{language === "zh-CN" ? "详细信息" : "Details"}</span><i>›</i></button>{detailsOpen && <div className="preview-detail-list">{detailsLoading ? <span className="preview-spinner" /> : details?.items.length ? details.items.map((item) => <div key={item.key}><span>{detailLabel(item.key, language)}</span><strong title={item.value}>{item.value}</strong></div>) : <small>{language === "zh-CN" ? "没有可用的附加信息" : "No additional details available"}</small>}</div>}</section>}
    <button onClick={onOpen}>{text.open}</button>
  </div>;
}
