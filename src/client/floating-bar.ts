/**
 * Where a node's floating command bar sits.
 *
 * Pure maths (no React, no DOM) so it can be tested without a browser: the bar
 * hugs the node's top edge, flips below it when there is not enough room above,
 * and clamps horizontally inside the visible stage so it never runs off an edge.
 * Mirrors the reference client's own helper (seeaitv `utils/floatingBarPosition`),
 * because the interaction it serves is the same one: click a node, get a bar
 * right there.
 */

import { boardToScreen } from '../canvas-viewport.ts'
import type { CanvasViewport } from '../protocol.ts'

/** Vertical gap between the bar and the node it belongs to (screen px). */
export const FLOATING_BAR_GAP = 8

/** Minimum horizontal distance from the stage's edges (screen px). */
export const FLOATING_BAR_EDGE_MARGIN = 8

/** Which side of the node the bar ended up on (a caller may style the arrow). */
export type FloatingBarPlacement = 'above' | 'below'

/** The node rectangle, in board coordinates. */
export interface FloatingBarNode {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Place the bar for one node.
 *
 * @param node - the node's rectangle in board coordinates.
 * @param viewport - the board's viewport.
 * @param barSize - the bar's measured size in screen pixels.
 * @param stageSize - the visible stage size in screen pixels.
 * @returns absolute left/top inside the stage, and which side it landed on.
 */
export function floatingBarPosition(
  node: FloatingBarNode,
  viewport: CanvasViewport,
  barSize: { width: number; height: number },
  stageSize: { width: number; height: number },
): { left: number; top: number; placement: FloatingBarPlacement } {
  const topLeft = boardToScreen(viewport, node.x, node.y)
  const bottomRight = boardToScreen(viewport, node.x + node.width, node.y + node.height)
  const centreX = (topLeft.x + bottomRight.x) / 2

  // Above by default; below when the bar would cross the stage's top edge.
  const placement: FloatingBarPlacement =
    topLeft.y - FLOATING_BAR_GAP - barSize.height < 0 ? 'below' : 'above'
  const top = placement === 'above'
    ? topLeft.y - FLOATING_BAR_GAP - barSize.height
    : bottomRight.y + FLOATING_BAR_GAP

  const minLeft = FLOATING_BAR_EDGE_MARGIN
  const maxLeft = Math.max(minLeft, stageSize.width - FLOATING_BAR_EDGE_MARGIN - barSize.width)
  const left = Math.min(Math.max(centreX - barSize.width / 2, minLeft), maxLeft)

  return { left, top, placement }
}
