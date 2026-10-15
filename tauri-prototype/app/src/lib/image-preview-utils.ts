export type ImagePoint = { x: number; y: number };

export const MIN_IMAGE_ZOOM = 0.25;
export const MAX_IMAGE_ZOOM = 16;

export function clampImageZoom(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, value));
}

export function actualSizeZoom(
  naturalWidth: number,
  naturalHeight: number,
  renderedWidth: number,
  renderedHeight: number,
) {
  if (naturalWidth <= 0 || naturalHeight <= 0 || renderedWidth <= 0 || renderedHeight <= 0) return 1;
  return clampImageZoom(Math.max(naturalWidth / renderedWidth, naturalHeight / renderedHeight));
}

export function clampImagePan(
  point: ImagePoint,
  viewportWidth: number,
  viewportHeight: number,
  renderedWidth: number,
  renderedHeight: number,
  zoom: number,
): ImagePoint {
  const safeZoom = clampImageZoom(zoom);
  const maxX = Math.max(0, (renderedWidth * safeZoom - viewportWidth) / 2);
  const maxY = Math.max(0, (renderedHeight * safeZoom - viewportHeight) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, point.x)),
    y: Math.max(-maxY, Math.min(maxY, point.y)),
  };
}
