import type { UiLanguage } from "../types";

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes < 60 ? `${minutes}m ${remainder}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatDate(seconds: number | null, language: UiLanguage) {
  if (!seconds) return "—";
  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(seconds * 1000));
}

export function detailLabel(key: string, language: UiLanguage) {
  const labels: Record<string, [string, string]> = {
    dimensions: ["尺寸", "Dimensions"], camera: ["相机", "Camera"], lens: ["镜头", "Lens"], captured: ["拍摄时间", "Captured"], aperture: ["光圈", "Aperture"], exposure: ["曝光时间", "Exposure"], iso: ["ISO", "ISO"], focalLength: ["焦距", "Focal length"],
    title: ["标题", "Title"], artist: ["歌手", "Artist"], album: ["专辑", "Album"], genre: ["流派", "Genre"], year: ["年份", "Year"], track: ["音轨", "Track"], bitrate: ["比特率", "Bitrate"], sampleRate: ["采样率", "Sample rate"], bitDepth: ["位深", "Bit depth"], channels: ["声道数", "Channels"],
  };
  return labels[key]?.[language === "zh-CN" ? 0 : 1] ?? key;
}
