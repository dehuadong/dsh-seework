/**
 * Where a picked picture lands on a board.
 *
 * Kept outside the board component so the maths has one home: the picture picker
 * inside the board and the conversation's 「加到画布」 both ask where the visible
 * centre is, and both build the same card there. (Automatic placement of a fresh
 * generation is gone — a background generation no longer touches the board.)
 */

import { CANVAS_NEW_IMAGE_SIZE } from './canvas-limits.ts'
import { screenToBoard } from './canvas-viewport.ts'
import type { CanvasCard, CanvasCardOrigin, CanvasCardSource, CanvasViewport } from './protocol.ts'

/** One picture to place, as the library stores it. */
export interface PlacedImage {
  /** Library file name the card points at. */
  file: string
  /**
   * Which store `file` belongs to. Absent means the material library, which is
   * what a picture picked out of it is; a board's own asset (an upload, a
   * composite) says `canvas`, or the card would point at the wrong route.
   */
  source?: CanvasCardSource | undefined
  width?: number | undefined
  height?: number | undefined
  /** Model that produced it, shown on the card. */
  model?: string | undefined
  /** Prompt snapshot, shown on the card. */
  prompt?: string | undefined
  /** Where it came from, shown as the card badge. */
  origin?: CanvasCardOrigin | undefined
}

/**
 * Build the card for one picture, centred on the given board point.
 * @param image - the picture to place.
 * @param centre - board coordinates of the stage centre.
 * @param id - the card id to use.
 * @returns the card, sized to the picture's own aspect ratio.
 */
export function centeredImageCard(image: PlacedImage, centre: { x: number; y: number }, id: string): CanvasCard {
  const aspect = image.width !== undefined && image.height !== undefined && image.height > 0
    ? image.width / image.height
    : 1
  const height = Math.round(CANVAS_NEW_IMAGE_SIZE / aspect)
  return {
    id,
    kind: 'image',
    x: Math.round(centre.x - CANVAS_NEW_IMAGE_SIZE / 2),
    y: Math.round(centre.y - height / 2),
    width: CANVAS_NEW_IMAGE_SIZE,
    height,
    z: 0,
    file: image.file,
    model: image.model ?? '',
    prompt: image.prompt ?? '',
    ...image.source === undefined ? {} : { source: image.source },
    ...image.origin === undefined ? {} : { origin: image.origin },
  }
}

/**
 * Board coordinates of the visible centre.
 * @param viewport - the board's viewport.
 * @param stage - visible stage size in screen pixels.
 * @returns the board point at the middle of the stage.
 */
export function stageCentre(viewport: CanvasViewport, stage: { width: number; height: number }): { x: number; y: number } {
  return screenToBoard(viewport, stage.width / 2, stage.height / 2)
}

/**
 * Stage size assumed when nothing measurable is on screen yet.
 *
 * Halving a real stage puts a picture in the middle of what the user sees;
 * halving a ZERO stage puts it exactly on the viewport's top-left corner, which
 * is the "why did it land in the corner" bug. Assuming a plausible panel size
 * keeps it near the middle even before the canvas has been laid out.
 */
export const ASSUMED_STAGE: { readonly width: number; readonly height: number } = { width: 960, height: 640 }

/**
 * The stage size to place against, falling back when nothing is measured.
 * @param measured - the last measurement (may be zero before layout).
 * @returns a usable size.
 */
export function usableStage(measured: { width: number; height: number }): { width: number; height: number } {
  return measured.width > 0 && measured.height > 0 ? measured : { ...ASSUMED_STAGE }
}
