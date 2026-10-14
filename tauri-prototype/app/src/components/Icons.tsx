import type { FileEntry } from "../types";
import { iconKindFor } from "../lib/file-utils";

export function EntryIcon({ entry }: { entry: FileEntry }) {
  const kind = iconKindFor(entry);
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "folder") return <svg {...common}><path className="icon-fill" d="M3.5 6.8c0-1 .8-1.8 1.8-1.8h4l2 2h7.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H5.3c-1 0-1.8-.8-1.8-1.8V6.8Z" /><path d="M3.8 8.5h16.4" /></svg>;
  if (kind === "image") return <svg {...common}><rect x="3.5" y="4" width="17" height="16" rx="2.4" /><circle cx="8.5" cy="9" r="1.4" /><path d="m5.5 17 4.1-4 2.8 2.5 2.1-2 4 3.5" /></svg>;
  if (kind === "video") return <svg {...common}><rect x="3.5" y="5" width="17" height="14" rx="2.4" /><path className="icon-fill" d="m10 9 5 3-5 3V9Z" /></svg>;
  if (kind === "audio") return <svg {...common}><path d="M9.5 17.2V6.8L18 5v9.9" /><circle className="icon-fill" cx="6.8" cy="17.2" r="2.7" /><circle className="icon-fill" cx="15.3" cy="14.9" r="2.7" /></svg>;
  if (kind === "archive") return <svg {...common}><path d="M7 3.8h8l3 3V20H7V3.8Z" /><path d="M10.5 4v2m0 2v2m0 2v2m0 2v2" /><path d="M15 4v3h3" /></svg>;
  if (kind === "code") return <svg {...common}><path d="M7 3.8h8l3 3V20H7V3.8Z" /><path d="M15 4v3h3M11 11l-2 2 2 2m3-4 2 2-2 2" /></svg>;
  if (kind === "pdf") return <svg {...common}><path className="icon-fill" d="M7 3.8h8l3 3V20H7V3.8Z" /><path d="M15 4v3h3M9.3 14.8h5.4M9.3 11.8h5.4" /></svg>;
  if (kind === "app") return <svg {...common}><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M8 8h3v3H8V8Zm5 0h3v3h-3V8Zm-5 5h3v3H8v-3Zm5 0h3v3h-3v-3Z" /></svg>;
  if (kind === "document") return <svg {...common}><path d="M7 3.8h8l3 3V20H7V3.8Z" /><path d="M15 4v3h3M9.5 11h5m-5 3h5m-5 3H13" /></svg>;
  return <svg {...common}><path d="M7 3.8h8l3 3V20H7V3.8Z" /><path d="M15 4v3h3" /></svg>;
}

export function ChevronIcon() {
  return <svg className="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6 3.5 3.5L11.5 6" /></svg>;
}

export function SortIcon() {
  return <svg className="toolbar-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3v14m0 0-3-3m3 3 3-3M14 17V3m0 0-3 3m3-3 3 3" /></svg>;
}

export function ViewIcon() {
  return <svg className="toolbar-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h2m3 0h9M3 10h2m3 0h9M3 15h2m3 0h9" /></svg>;
}

export function ActionsIcon() {
  return <svg className="toolbar-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1" /><circle cx="10" cy="10" r="1" /><circle cx="16" cy="10" r="1" /></svg>;
}

export function SettingsIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2m0 11v2M2.5 10h2m11 0h2M4.7 4.7l1.4 1.4m7.8 7.8 1.4 1.4m0-10.6-1.4 1.4m-7.8 7.8-1.4 1.4" /></svg>;
}

export function SpaceHealthIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 15.5V10m4.3 5.5V6.8m4.4 8.7V9m4.3 6.5V4.5" /><path d="M2.8 17.2h14.4" /></svg>;
}

export function FolderGlyph() {
  return <svg className="tree-folder-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2.8 5.8c0-.9.7-1.6 1.6-1.6h3.4l1.8 1.9h6c.9 0 1.6.7 1.6 1.6v6.5c0 .9-.7 1.6-1.6 1.6H4.4c-.9 0-1.6-.7-1.6-1.6V5.8Z" /><path d="M3.1 7.4h13.8" /></svg>;
}
