/**
 * Crop geometry, in the picture's own pixels.
 *
 * The crop box lives in natural coordinates and is rendered by scaling it to the
 * node's displayed size, so zooming the board never changes what will be cut —
 * the same three-layer mapping (natural ↔ node ↔ screen) the reference client
 * uses. Pure arithmetic, unit-tested; the actual cutting lives in `burn-image.ts`.
 */

/** One crop box, in picture pixels. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** One length/ratio choice in the crop toolbar. */
export interface CropAspectOption {
  label: string
  /** width / height, or null for a free box. */
  value: number | null
}

/** The ratio menu, mirroring the reference client's list. */
export const CROP_ASPECTS: readonly CropAspectOption[] = [
  { label: '自定义', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
]

/** Smallest crop box (picture pixels), so a stray drag cannot produce nothing. */
export const MIN_CROP_SIZE = 16

/** The eight resize handles. */
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** All handles, in outline order. */
export const CROP_HANDLES: readonly CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Which directions a handle moves. */
const HANDLE_AXES: Record<CropHandle, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
}

/** Keep a box inside the picture. */
function clampRect(rect: CropRect, natural: { width: number; height: number }): CropRect {
  const width = Math.min(Math.max(MIN_CROP_SIZE, rect.width), natural.width)
  const height = Math.min(Math.max(MIN_CROP_SIZE, rect.height), natural.height)
  return {
    width,
    height,
    x: Math.min(Math.max(0, rect.x), Math.max(0, natural.width - width)),
    y: Math.min(Math.max(0, rect.y), Math.max(0, natural.height - height)),
  }
}

/**
 * The box a crop mode starts with: the whole picture, or the largest box of the
 * requested ratio that fits in it.
 *
 * @param natural - the picture's natural size.
 * @param aspect - width / height, or null for the whole picture.
 * @returns the starting box.
 */
export function defaultCropRect(natural: { width: number; height: number }, aspect: number | null): CropRect {
  if (aspect === null) return { x: 0, y: 0, width: natural.width, height: natural.height }
  const byWidth = { width: natural.width, height: natural.width / aspect }
  const size = byWidth.height <= natural.height ? byWidth : { width: natural.height * aspect, height: natural.height }
  return clampRect({
    x: (natural.width - size.width) / 2,
    y: (natural.height - size.height) / 2,
    width: size.width,
    height: size.height,
  }, natural)
}

/**
 * Move the box, keeping it inside the picture.
 * @param rect - the current box.
 * @param dx - pointer delta in picture pixels.
 * @param dy - pointer delta in picture pixels.
 * @param natural - the picture's natural size.
 * @returns the moved box.
 */
export function moveCropRect(rect: CropRect, dx: number, dy: number, natural: { width: number; height: number }): CropRect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, natural)
}

/**
 * Resize the box by one handle.
 *
 * The anchor (the opposite edge/corner) stays put, which is what makes dragging a
 * handle feel like resizing rather than moving; with a fixed ratio the box grows
 * along the dominant axis and stays inside the picture.
 *
 * @param rect - the current box.
 * @param handle - which handle is being dragged.
 * @param dx - pointer delta in picture pixels.
 * @param dy - pointer delta in picture pixels.
 * @param natural - the picture's natural size.
 * @param aspect - width / height, or null for a free box.
 * @returns the resized box.
 */
export function resizeCropRect(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  natural: { width: number; height: number },
  aspect: number | null,
): CropRect {
  const axes = HANDLE_AXES[handle]
  let width = axes.x === 0 ? rect.width : rect.width + dx * axes.x
  let height = axes.y === 0 ? rect.height : rect.height + dy * axes.y
  if (aspect !== null) {
    // Grow along whichever axis moved more, then derive the other from the ratio.
    const byWidth = { width, height: width / aspect }
    const byHeight = { width: height * aspect, height }
    const chosen = Math.abs(dx) >= Math.abs(dy) ? byWidth : byHeight
    width = chosen.width
    height = chosen.height
  }
  width = Math.max(MIN_CROP_SIZE, width)
  height = Math.max(MIN_CROP_SIZE, height)
  // The anchor is the edge the dragged handle is not touching.
  const x = axes.x === 0 ? rect.x : axes.x < 0 ? rect.x + rect.width - width : rect.x
  const y = axes.y === 0 ? rect.y : axes.y < 0 ? rect.y + rect.height - height : rect.y
  return clampRect({ x, y, width, height }, natural)
}

/**
 * The displayed position of the box inside a node.
 *
 * @param rect - the box in picture pixels.
 * @param node - the node's displayed size on screen.
 * @param natural - the picture's natural size.
 * @returns screen-space offsets relative to the node's top-left corner.
 */
export function cropRectToNode(
  rect: CropRect,
  node: { width: number; height: number },
  natural: { width: number; height: number },
): CropRect {
  const scaleX = natural.width === 0 ? 1 : node.width / natural.width
  const scaleY = natural.height === 0 ? 1 : node.height / natural.height
  return {
    x: rect.x * scaleX,
    y: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  }
}

/**
 * Where a crop's new node goes: to the right of the original, same top edge.
 *
 * Non-destructive by construction — the crop is a NEW node next to the picture it
 * came from, so the user can compare them.
 *
 * @param source - the original card's board rectangle.
 * @param size - the new node's size.
 * @returns the new node's top-left corner.
 */
export function cropNodePosition(
  source: { x: number; y: number; width: number },
  size: { width: number },
): { x: number; y: number } {
  return { x: source.x + source.width + 24, y: source.y }
}

/**
 * The displayed size of a crop's node: the crop's own aspect ratio, at a size
 * comparable to the picture it came from.
 *
 * @param rect - the crop box in picture pixels.
 * @param maxWidth - the widest the new node may be on the board.
 * @returns the node's board size.
 */
export function croppedNodeSize(rect: CropRect, maxWidth = 320): { width: number; height: number } {
  const aspect = rect.height === 0 ? 1 : rect.width / rect.height
  const width = Math.max(48, Math.min(maxWidth, rect.width))
  return { width: Math.round(width), height: Math.round(width / aspect) }
}
