/**
 * Canvas viewport math (pure functions, shared by the board and its tests).
 *
 * The board is spatial, not a node graph: the viewport is an ordinary
 * translate+scale pair, so every question about it ("what is under the cursor",
 * "where does a card land if I click here") is one linear map. Keeping that map
 * in one module means the pointer handling never re-derives it.
 *
 * Coordinate convention: a board card at `(x, y)` renders at
 * `(x * k + vx, y * k + vy)` in screen pixels.
 */

import type { CanvasCard, CanvasViewport } from './protocol.ts'
import { CANVAS_ZOOM_MAX, CANVAS_ZOOM_MIN } from './canvas-limits.ts'

/** Zoom applied per wheel notch and per toolbar button press. */
export const ZOOM_STEP = 1.25

/** Padding kept around the content by {@link fitViewport}. */
export const FIT_PADDING = 48

/** Clamp a zoom factor into the supported range. */
export function clampZoom(k: number): number {
  if (!Number.isFinite(k)) return 1
  return Math.round(Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, k)) * 1000) / 1000
}

/** Convert a screen point to board coordinates. */
export function screenToBoard(viewport: CanvasViewport, screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: (screenX - viewport.x) / viewport.k,
    y: (screenY - viewport.y) / viewport.k,
  }
}

/** Convert a board point to screen coordinates. */
export function boardToScreen(viewport: CanvasViewport, boardX: number, boardY: number): { x: number; y: number } {
  return {
    x: boardX * viewport.k + viewport.x,
    y: boardY * viewport.k + viewport.y,
  }
}

/**
 * Zoom one step around a fixed screen anchor (the cursor, or the viewport
 * centre for a button press), so the board point under the anchor stays put.
 * @param direction - 1 zooms in, -1 zooms out.
 */
export function zoomAt(
  viewport: CanvasViewport,
  direction: 1 | -1,
  anchorX: number,
  anchorY: number,
): CanvasViewport {
  const next = clampZoom(direction === 1 ? viewport.k * ZOOM_STEP : viewport.k / ZOOM_STEP)
  return zoomTo(viewport, next, anchorX, anchorY)
}

/** Zoom to an exact factor around a fixed screen anchor. */
export function zoomTo(
  viewport: CanvasViewport,
  targetK: number,
  anchorX: number,
  anchorY: number,
): CanvasViewport {
  const k = clampZoom(targetK)
  if (k === viewport.k) return viewport
  const board = screenToBoard(viewport, anchorX, anchorY)
  return {
    x: anchorX - board.x * k,
    y: anchorY - board.y * k,
    k,
  }
}

/** Translate the viewport by a screen-space delta (dragging the board). */
export function panBy(viewport: CanvasViewport, deltaX: number, deltaY: number): CanvasViewport {
  return { x: viewport.x + deltaX, y: viewport.y + deltaY, k: viewport.k }
}

/** Bounding box of a set of cards, or undefined for an empty board. */
export function cardBounds(cards: CanvasCard[]): { x: number; y: number; width: number; height: number } | undefined {
  if (cards.length === 0) return undefined
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const card of cards) {
    minX = Math.min(minX, card.x)
    minY = Math.min(minY, card.y)
    maxX = Math.max(maxX, card.x + card.width)
    maxY = Math.max(maxY, card.y + card.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Compute the viewport that shows every card with a little padding.
 * @param stageWidth - visible area width in screen pixels.
 * @param stageHeight - visible area height in screen pixels.
 * @returns the fitted viewport; the identity viewport for an empty board or a
 *   degenerate stage.
 */
export function fitViewport(
  cards: CanvasCard[],
  stageWidth: number,
  stageHeight: number,
  padding = FIT_PADDING,
): CanvasViewport {
  if (cards.length === 0 || stageWidth <= 0 || stageHeight <= 0) return { x: 0, y: 0, k: 1 }
  const bounds = cardBounds(cards)
  if (bounds === undefined || bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0, k: 1 }
  const availableWidth = Math.max(1, stageWidth - 2 * padding)
  const availableHeight = Math.max(1, stageHeight - 2 * padding)
  const k = clampZoom(Math.min(availableWidth / bounds.width, availableHeight / bounds.height))
  return {
    x: Math.round((-bounds.x * k + (stageWidth - bounds.width * k) / 2) * 100) / 100,
    y: Math.round((-bounds.y * k + (stageHeight - bounds.height * k) / 2) * 100) / 100,
    k,
  }
}

/**
 * Grid cell size in screen pixels at the current zoom, chosen so the dot grid
 * always reads as roughly the same density however far the user zoomed.
 */
export function gridStep(k: number, base = 32): number {
  if (!Number.isFinite(k) || k <= 0) return base
  let step = base * k
  while (step < 12) step *= 4
  while (step > 160) step /= 4
  return step
}
