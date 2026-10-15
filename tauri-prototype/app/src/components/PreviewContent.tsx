import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { TEXT_PREVIEW_CHUNK } from "../constants";
import { detailLabel, formatDate, formatSize } from "../lib/format";
import { iconKindFor } from "../lib/file-utils";
import { actualSizeZoom, clampImagePan, clampImageZoom, type ImagePoint } from "../lib/image-preview-utils";
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
  const [imageZoom, setImageZoom] = useState(1);
  const [imageOffset, setImageOffset] = useState<ImagePoint>({ x: 0, y: 0 });
  const [imageDragging, setImageDragging] = useState(false);
  const imageStageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const imageDragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: ImagePoint } | null>(null);

  useEffect(() => {
    setPdfPage(1);
    setPdfZoom(100);
    setMediaInfo(null);
    setDetailsOpen(false);
    setDetails(null);
    setDetailsLoading(false);
    setImageZoom(1);
    setImageOffset({ x: 0, y: 0 });
    setImageDragging(false);
    imageDragRef.current = null;
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

  function clampPan(point: ImagePoint, zoom = imageZoom) {
    const stage = imageStageRef.current;
    const image = imageRef.current;
    if (!stage || !image) return { x: 0, y: 0 };
    return clampImagePan(point, stage.clientWidth, stage.clientHeight, image.offsetWidth, image.offsetHeight, zoom);
  }

  function setZoom(nextValue: number) {
    const nextZoom = clampImageZoom(nextValue);
    setImageZoom(nextZoom);
    setImageOffset((current) => clampPan(current, nextZoom));
  }

  function fitImage() {
    setImageZoom(1);
    setImageOffset({ x: 0, y: 0 });
  }

  function showImageActualSize() {
    const image = imageRef.current;
    if (!image) return;
    setZoom(actualSizeZoom(image.naturalWidth, image.naturalHeight, image.offsetWidth, image.offsetHeight));
  }

  function handleImageWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setZoom(imageZoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
  }

  function handleImagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (imageZoom <= 1 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    imageDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: imageOffset };
    setImageDragging(true);
  }

  function handleImagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = imageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setImageOffset(clampPan({ x: drag.origin.x + event.clientX - drag.startX, y: drag.origin.y + event.clientY - drag.startY }));
  }

  function stopImageDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (imageDragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    imageDragRef.current = null;
    setImageDragging(false);
  }

  function handleImageKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom(imageZoom * 1.25);
    } else if (event.key === "-") {
      event.preventDefault();
      setZoom(imageZoom / 1.25);
    } else if (event.key === "0") {
      event.preventDefault();
      fitImage();
    } else if (imageZoom > 1 && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const step = 32;
      setImageOffset((current) => clampPan({
        x: current.x + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0),
        y: current.y + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0),
      }));
    }
  }

  function renderImage(source: string) {
    const instruction = language === "zh-CN" ? "滚轮缩放；放大后拖动查看；双击恢复适应" : "Wheel to zoom; drag when enlarged; double-click to fit";
    return <div className="image-preview-shell">
      <div className="preview-toolstrip image-preview-tools">
        <button aria-label={language === "zh-CN" ? "缩小" : "Zoom out"} title={language === "zh-CN" ? "缩小" : "Zoom out"} disabled={imageZoom <= 0.25} onClick={() => setZoom(imageZoom / 1.25)}>−</button>
        <b>{Math.round(imageZoom * 100)}%</b>
        <button aria-label={language === "zh-CN" ? "放大" : "Zoom in"} title={language === "zh-CN" ? "放大" : "Zoom in"} disabled={imageZoom >= 16} onClick={() => setZoom(imageZoom * 1.25)}>＋</button>
        <span />
        <button className="image-fit-button" title={language === "zh-CN" ? "适应预览区域（快捷键 0）" : "Fit preview (shortcut 0)"} onClick={fitImage}>{language === "zh-CN" ? "适应" : "Fit"}</button>
        <button className="image-actual-button" title={language === "zh-CN" ? "按图片原始像素显示" : "Show at actual pixel size"} onClick={showImageActualSize}>1:1</button>
      </div>
      <div
        ref={imageStageRef}
        className={`image-preview-stage ${imageZoom > 1 ? "zoomed" : ""} ${imageDragging ? "dragging" : ""}`}
        tabIndex={0}
        role="img"
        aria-label={`${entry.name}。${instruction}`}
        title={instruction}
        onWheel={handleImageWheel}
        onPointerDown={handleImagePointerDown}
        onPointerMove={handleImagePointerMove}
        onPointerUp={stopImageDrag}
        onPointerCancel={stopImageDrag}
        onLostPointerCapture={stopImageDrag}
        onDoubleClick={fitImage}
        onKeyDown={handleImageKeyDown}
      >
        <div className="image-preview-canvas" style={{ transform: `translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0)` }}>
          <img
            ref={imageRef}
            src={source}
            alt=""
            draggable={false}
            style={{ transform: `scale(${imageZoom})` }}
            onDragStart={(event) => event.preventDefault()}
            onLoad={(event) => {
              setMediaInfo({ duration: 0, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
              fitImage();
            }}
          />
        </div>
      </div>
    </div>;
  }

  const media = loading ? <span className="preview-spinner" />
    : preview?.kind === "image" && preview.dataUrl ? renderImage(preview.dataUrl)
      : (preview?.kind === "svg" || preview?.kind === "heic") ? renderImage(sourceUrl)
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
