/**
 * Canvas viewport tests: the board's pointer handling is derived entirely from
 * these functions, so a wrong mapping shows up as "the card lands somewhere
 * else when I drag it" — the kind of bug that is miserable to chase in a GUI.
 */

import { describe, expect, it } from 'vitest'
import {
  boardToScreen,
  cardBounds,
  clampZoom,
  fitViewport,
  gridStep,
  panBy,
  screenToBoard,
  zoomAt,
  zoomTo,
  ZOOM_STEP,
} from './canvas-viewport.ts'
import { CANVAS_ZOOM_MAX, CANVAS_ZOOM_MIN } from './canvas-limits.ts'
import type { CanvasCard, CanvasViewport } from './protocol.ts'

/** One card at a fixed spot. */
function card(x: number, y: number, width = 100, height = 100): CanvasCard {
  return { id: `${x},${y}`, kind: 'text', x, y, width, height, z: 0, text: '' }
}

describe('clampZoom', () => {
  it('keeps zoom inside the supported range', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(99)).toBe(CANVAS_ZOOM_MAX)
    expect(clampZoom(0)).toBe(CANVAS_ZOOM_MIN)
    expect(clampZoom(Number.NaN)).toBe(1)
  })
})

describe('coordinate mapping', () => {
  const viewport: CanvasViewport = { x: 100, y: 50, k: 2 }

  it('round-trips a point through screen and board space', () => {
    const board = screenToBoard(viewport, 300, 250)
    expect(board).toEqual({ x: 100, y: 100 })
    expect(boardToScreen(viewport, board.x, board.y)).toEqual({ x: 300, y: 250 })
  })

  it('maps the viewport origin to the translation', () => {
    expect(boardToScreen(viewport, 0, 0)).toEqual({ x: 100, y: 50 })
    expect(screenToBoard(viewport, 100, 50)).toEqual({ x: 0, y: 0 })
  })
})

describe('panBy', () => {
  it('translates without touching the zoom', () => {
    expect(panBy({ x: 10, y: 20, k: 1.5 }, -5, 5)).toEqual({ x: 5, y: 25, k: 1.5 })
  })
})

describe('zoomTo / zoomAt', () => {
  it('keeps the board point under the anchor fixed', () => {
    const before: CanvasViewport = { x: 0, y: 0, k: 1 }
    const anchor = { x: 400, y: 300 }
    const boardUnderCursor = screenToBoard(before, anchor.x, anchor.y)
    const after = zoomTo(before, 2, anchor.x, anchor.y)
    expect(after.k).toBe(2)
    // The same board point is still under the same screen pixel.
    const screenAfter = boardToScreen(after, boardUnderCursor.x, boardUnderCursor.y)
    expect(screenAfter.x).toBeCloseTo(anchor.x, 6)
    expect(screenAfter.y).toBeCloseTo(anchor.y, 6)
  })

  it('zooms one step in and out and clamps at the limits', () => {
    const base: CanvasViewport = { x: 0, y: 0, k: 1 }
    expect(zoomAt(base, 1, 0, 0).k).toBeCloseTo(ZOOM_STEP, 6)
    expect(zoomAt(base, -1, 0, 0).k).toBeCloseTo(1 / ZOOM_STEP, 6)
    expect(zoomAt({ x: 0, y: 0, k: CANVAS_ZOOM_MAX }, 1, 0, 0).k).toBe(CANVAS_ZOOM_MAX)
    expect(zoomAt({ x: 0, y: 0, k: CANVAS_ZOOM_MIN }, -1, 0, 0).k).toBe(CANVAS_ZOOM_MIN)
  })

  it('returns the same viewport when the zoom does not change', () => {
    const base: CanvasViewport = { x: 3, y: 4, k: 1 }
    expect(zoomTo(base, 1, 10, 10)).toBe(base)
  })
})

describe('cardBounds', () => {
  it('is undefined for an empty board', () => {
    expect(cardBounds([])).toBeUndefined()
  })

  it('covers every card including the ones at negative coordinates', () => {
    expect(cardBounds([card(0, 0, 100, 50), card(-50, 20, 100, 100)])).toEqual({
      x: -50,
      y: 0,
      width: 150,
      height: 120,
    })
  })
})

describe('fitViewport', () => {
  it('zooms in when the content is small enough to fill the stage', () => {
    // 100×100 content in a 1000×800 stage with 48px padding fits at 7.04×,
    // which the zoom ceiling caps at 5×.
    const viewport = fitViewport([card(0, 0, 100, 100)], 1000, 800, 48)
    expect(viewport.k).toBe(CANVAS_ZOOM_MAX)
    // …and the content stays centred at that zoom.
    const centre = boardToScreen(viewport, 50, 50)
    expect(centre.x).toBeCloseTo(500, 2)
    expect(centre.y).toBeCloseTo(400, 2)
  })

  it('shows a board that exactly fills the padded stage at 1:1', () => {
    const viewport = fitViewport([card(0, 0, 904, 704)], 1000, 800, 48)
    expect(viewport.k).toBe(1)
    // 904 + 2*48 = 1000 exactly, so the width is the binding constraint.
    expect(boardToScreen(viewport, 0, 0).x).toBeCloseTo(48, 2)
  })

  it('centres content smaller than the stage at the zoom that fits it', () => {
    const viewport = fitViewport([card(0, 0, 452, 352)], 1000, 800, 48)
    expect(viewport.k).toBe(2)
    const centre = boardToScreen(viewport, 226, 176)
    expect(centre.x).toBeCloseTo(500, 2)
    expect(centre.y).toBeCloseTo(400, 2)
  })

  it('scales down content taller than the stage', () => {
    const viewport = fitViewport([card(0, 0, 100, 4000)], 1000, 800, 48)
    expect(viewport.k).toBeLessThan(1)
    expect(viewport.k).toBeGreaterThanOrEqual(CANVAS_ZOOM_MIN)
  })

  it('falls back to the identity viewport for an empty board or a degenerate stage', () => {
    expect(fitViewport([], 1000, 800)).toEqual({ x: 0, y: 0, k: 1 })
    expect(fitViewport([card(0, 0)], 0, 0)).toEqual({ x: 0, y: 0, k: 1 })
  })
})

describe('gridStep', () => {
  it('keeps the dot spacing in a readable band at every zoom', () => {
    for (const k of [0.1, 0.25, 0.5, 1, 2, 5]) {
      const step = gridStep(k)
      expect(step).toBeGreaterThanOrEqual(12)
      expect(step).toBeLessThanOrEqual(160)
    }
    expect(gridStep(Number.NaN)).toBe(32)
  })
})
