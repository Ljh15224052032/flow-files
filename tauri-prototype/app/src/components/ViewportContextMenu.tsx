import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { placeFloatingMenu } from "../lib/menu-position";

type ViewportContextMenuProps = {
  x: number;
  y: number;
  className?: string;
  children: ReactNode;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
};

export function ViewportContextMenu({ x, y, className = "", children, onPointerDown }: ViewportContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: x, top: y, visibility: "hidden" });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const placement = placeFloatingMenu({
      anchorX: x,
      anchorY: y,
      menuWidth: menu.offsetWidth,
      menuHeight: menu.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setStyle({ left: placement.left, top: placement.top, maxHeight: placement.maxHeight, visibility: "visible" });
  }, [x, y]);

  return <div ref={menuRef} className={`context-menu ${className}`.trim()} style={style} role="menu" onPointerDown={onPointerDown}>{children}</div>;
}
