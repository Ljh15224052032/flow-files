import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { ClipboardState, DragGhost, ExternalDragResult, FileEntry, UiLanguage } from "../types";
import { canDropPathsInto, labelForPath, nativeDropMode } from "../lib/file-utils";

type PointerDrag = {
  paths: string[];
  startX: number;
  startY: number;
  target: string | null;
  active: boolean;
  dropAllowed: boolean;
};

type FileDragOptions = {
  selectedPaths: ReadonlySet<string>;
  renamingPath: string | null;
  operationActive: boolean;
  listingPath: string | null;
  language: UiLanguage;
  scheduleTabHover: (path: string | null) => void;
  clearTabHover: () => void;
  prepareTransfer: (clipboard: ClipboardState, destination: string) => void | Promise<void>;
  handleExternalMove: (paths: string[]) => void | Promise<void>;
  setStatus: (message: string) => void;
};

export function useFileDrag(options: FileDragOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pointerDragRef = useRef<PointerDrag | null>(null);
  const nativeDropPathsRef = useRef<string[]>([]);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null);

  const armPointerDrag = useCallback((entry: FileEntry, event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = optionsRef.current;
    if (event.button !== 0 || current.renamingPath) return;
    const paths = current.selectedPaths.has(entry.path) ? [...current.selectedPaths] : [entry.path];
    pointerDragRef.current = { paths, startX: event.clientX, startY: event.clientY, target: null, active: false, dropAllowed: false };
  }, []);

  const startExternalFileDrag = useCallback(async () => {
    const drag = pointerDragRef.current;
    const current = optionsRef.current;
    if (!drag?.active || current.operationActive) return;
    pointerDragRef.current = null;
    setDragTarget(null);
    setDragGhost(null);
    try {
      const result = await invoke<ExternalDragResult>("start_file_drag", { paths: drag.paths });
      if (result.effect === "move") await optionsRef.current.handleExternalMove(drag.paths);
      const latest = optionsRef.current;
      const messages = latest.language === "zh-CN"
        ? { copy: "已将文件复制到外部位置", move: "已将文件移动到外部位置", link: "已在外部位置创建快捷方式", none: "已取消外部拖放" }
        : { copy: "Copied files to the external destination.", move: "Moved files to the external destination.", link: "Created links at the external destination.", none: "External drag cancelled." };
      latest.setStatus(messages[result.effect]);
    } catch (error) {
      const latest = optionsRef.current;
      latest.setStatus(latest.language === "zh-CN" ? `无法拖出文件：${String(error)}` : `Could not drag files outside Flow Files: ${String(error)}`);
    }
  }, []);

  useEffect(() => {
    const elementAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-path]") ?? null;
    const move = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag) return;
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      drag.active = true;
      const targetElement = elementAt(event.clientX, event.clientY);
      drag.target = targetElement?.dataset.dropPath ?? null;
      drag.dropAllowed = !!drag.target && canDropPathsInto(drag.paths, drag.target);
      optionsRef.current.scheduleTabHover(targetElement?.classList.contains("tab") ? drag.target : null);
      setDragTarget(drag.dropAllowed ? drag.target : null);
      setDragGhost({
        x: event.clientX,
        y: event.clientY,
        count: drag.paths.length,
        mode: drag.target && drag.dropAllowed ? nativeDropMode(drag.paths, drag.target) : "blocked",
        targetLabel: drag.target ? labelForPath(drag.target) : null,
      });
      event.preventDefault();
    };
    const finish = () => {
      const drag = pointerDragRef.current;
      pointerDragRef.current = null;
      setDragGhost(null);
      setDragTarget(null);
      const current = optionsRef.current;
      current.clearTabHover();
      if (drag?.active && drag.target && drag.dropAllowed && !current.operationActive) {
        void current.prepareTransfer({ mode: nativeDropMode(drag.paths, drag.target), paths: drag.paths }, drag.target);
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    const targetAtPhysicalPosition = (x: number, y: number) => {
      const scale = window.devicePixelRatio || 1;
      const element = document.elementFromPoint(x / scale, y / scale)?.closest<HTMLElement>("[data-drop-path]") ?? null;
      return { path: element?.dataset.dropPath ?? optionsRef.current.listingPath, isTab: !!element?.classList.contains("tab") };
    };
    void getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (disposed) return;
      const current = optionsRef.current;
      if (payload.type === "leave") {
        nativeDropPathsRef.current = [];
        setDragTarget(null);
        current.clearTabHover();
        return;
      }
      if (payload.type === "enter") nativeDropPathsRef.current = payload.paths;
      const target = targetAtPhysicalPosition(payload.position.x, payload.position.y);
      if (payload.type === "enter" || payload.type === "over") {
        setDragTarget(target.path);
        current.scheduleTabHover(target.isTab ? target.path : null);
        return;
      }
      const paths = payload.paths.length ? payload.paths : nativeDropPathsRef.current;
      nativeDropPathsRef.current = [];
      setDragTarget(null);
      current.clearTabHover();
      if (target.path && paths.length && !current.operationActive) {
        void current.prepareTransfer({ mode: nativeDropMode(paths, target.path), paths }, target.path);
      }
    }).then((unlisten) => {
      if (disposed) unlisten(); else stopListening = unlisten;
    });
    return () => {
      disposed = true;
      stopListening?.();
      pointerDragRef.current = null;
      nativeDropPathsRef.current = [];
      optionsRef.current.clearTabHover();
    };
  }, []);

  return { armPointerDrag, dragGhost, dragTarget, startExternalFileDrag };
}
