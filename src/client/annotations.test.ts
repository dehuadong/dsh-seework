/**
 * Annotation geometry (the marking layer's pure half).
 *
 * What matters: objects live in the picture's own pixels, hit-testing picks the
 * topmost one, moving shifts every kind, and the editor's stroke width is scaled
 * into picture pixels — otherwise the same choice draws a hairline on a 4K image
 * and a slab on a thumbnail.
 */

import { describe, expect, it } from 'vitest'
import {
  annotationAt,
  annotationBounds,
  annotationsAt,
  arrowHeadPoints,
  hasAnnotations,
  hitAnnotation,
  moveAnnotation,
  scaleWidth,
  type Annotation,
} from './annotations.ts'

const RECT: Annotation = { kind: 'rect', color: '#ff3b30', sizePx: 4, x: 10, y: 20, width: 100, height: 50 }
const TEXT: Annotation = { kind: 'text', color: '#0a84ff', sizePx: 20, x: 5, y: 5, text: '这里' }
const BRUSH: Annotation = { kind: 'brush', color: '#ffcc00', sizePx: 8, points: [{ x: 0, y: 0 }, { x: 30, y: 40 }] }
const ARROW: Annotation = { kind: 'arrow', color: '#ff3b30', sizePx: 4, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }

describe('annotationBounds', () => {
  it('reports the rectangle as drawn', () => {
    expect(annotationBounds(RECT)).toEqual({ x: 10, y: 20, width: 100, height: 50 })
  })

  it('wraps a stroke with half its width', () => {
    expect(annotationBounds(BRUSH)).toEqual({ x: -4, y: -4, width: 38, height: 48 })
  })

  it('gives text a box a click can land in', () => {
    const bounds = annotationBounds(TEXT)
    expect(bounds.x).toBe(5)
    expect(bounds.height).toBeGreaterThan(0)
    expect(bounds.width).toBeGreaterThan(0)
  })
})

describe('moveAnnotation', () => {
  it('shifts a rectangle', () => {
    expect(moveAnnotation(RECT, 5, -5)).toMatchObject({ x: 15, y: 15 })
  })

  it('shifts every point of a stroke', () => {
    const moved = moveAnnotation(BRUSH, 2, 3)
    expect(moved.kind === 'brush' && moved.points).toEqual([{ x: 2, y: 3 }, { x: 32, y: 43 }])
  })
})

describe('annotationAt', () => {
  it('picks the topmost object under the point', () => {
    const annotations = [RECT, { ...RECT, color: '#000000', x: 40, y: 20 }]
    expect(annotationAt(annotations, { x: 60, y: 30 })).toBe(1)
    expect(annotationAt(annotations, { x: 15, y: 25 })).toBe(0)
  })

  it('allows a tolerance around the edge and nothing far away', () => {
    expect(hitAnnotation(RECT, { x: 108, y: 70 })).toBe(true)
    expect(hitAnnotation(RECT, { x: 400, y: 400 })).toBe(false)
    expect(annotationAt([RECT], { x: 400, y: 400 })).toBeUndefined()
  })
})

describe('scaleWidth', () => {
  it('converts an editor width into picture pixels', () => {
    expect(scaleWidth(4, 3)).toBe(12)
  })

  it('never produces a zero-width mark', () => {
    expect(scaleWidth(4, 0)).toBe(4)
    expect(scaleWidth(4, Number.NaN)).toBe(4)
    expect(scaleWidth(0.1, 1)).toBe(1)
  })
})

describe('hasAnnotations', () => {
  it('is false for an untouched session', () => {
    expect(hasAnnotations([])).toBe(false)
  })

  it('is false when the only mark is an empty stroke or blank text', () => {
    expect(hasAnnotations([{ kind: 'brush', color: '#fff', sizePx: 4, points: [] }])).toBe(false)
    expect(hasAnnotations([{ kind: 'text', color: '#fff', sizePx: 12, x: 0, y: 0, text: '   ' }])).toBe(false)
  })

  it('is true once something is actually marked', () => {
    expect(hasAnnotations([RECT])).toBe(true)
    expect(hasAnnotations([BRUSH])).toBe(true)
    expect(hasAnnotations([TEXT])).toBe(true)
    expect(hasAnnotations([ARROW])).toBe(true)
  })
})

describe('arrows', () => {
  it('are hit along the shaft, not across the whole bounding box', () => {
    // On the shaft.
    expect(hitAnnotation(ARROW, { x: 50, y: 2 })).toBe(true)
    // Inside the bounding box but far from the line: a user clicking there means
    // "the picture", not "this arrow".
    expect(hitAnnotation(ARROW, { x: 50, y: 40 })).toBe(false)
    // Past the tip, beyond the tolerance.
    expect(hitAnnotation(ARROW, { x: 200, y: 0 })).toBe(false)
  })

  it('move both ends together', () => {
    expect(moveAnnotation(ARROW, 10, -5)).toMatchObject({ from: { x: 10, y: -5 }, to: { x: 110, y: -5 } })
  })

  it('bound their whole extent, head included', () => {
    const bounds = annotationBounds(ARROW)
    expect(bounds.x).toBeLessThan(0)
    expect(bounds.x + bounds.width).toBeGreaterThan(100)
    expect(bounds.y).toBeLessThan(0)
  })

  it('build a head at the tip, wide enough to see', () => {
    const [left, right, tip] = arrowHeadPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 4)
    expect(tip).toEqual({ x: 100, y: 0 })
    // The two base corners straddle the shaft, behind the tip.
    expect(Math.sign(left.y)).not.toBe(Math.sign(right.y))
    expect(left.x).toBeLessThan(tip.x)
    expect(right.x).toBeLessThan(tip.x)
  })
})

describe('annotationsAt (the eraser’s picker)', () => {
  it('returns every object under the point, topmost first', () => {
    const stacked = [RECT, { ...RECT, color: '#000000' }]
    expect(annotationsAt(stacked, { x: 50, y: 30 })).toEqual([1, 0])
    expect(annotationsAt(stacked, { x: 500, y: 500 })).toEqual([])
  })
})
