export type FloatingMenuPlacement = {
  left: number;
  top: number;
  maxHeight: number;
  direction: "up" | "down";
};

type FloatingMenuPlacementOptions = {
  anchorX: number;
  anchorY: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function placeFloatingMenu({
  anchorX,
  anchorY,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  margin = 8,
}: FloatingMenuPlacementOptions): FloatingMenuPlacement {
  const usableHeight = Math.max(1, viewportHeight - margin * 2);
  const availableBelow = Math.max(0, viewportHeight - margin - anchorY);
  const availableAbove = Math.max(0, anchorY - margin);
  const opensDown = menuHeight <= availableBelow || (menuHeight > availableAbove && availableBelow >= availableAbove);
  const maxHeight = Math.max(1, Math.min(usableHeight, opensDown ? availableBelow : availableAbove));
  const visibleHeight = Math.min(menuHeight, maxHeight);

  return {
    left: clamp(anchorX, margin, viewportWidth - margin - menuWidth),
    top: opensDown
      ? clamp(anchorY, margin, viewportHeight - margin - visibleHeight)
      : Math.max(margin, anchorY - visibleHeight),
    maxHeight,
    direction: opensDown ? "down" : "up",
  };
}
