/**
 * Crop geometry: the box starts sensibly, stays inside the picture, and resizes
 * from the anchor the user is NOT dragging. A crop that could leave the picture
 * would produce a blank strip, so the clamps are pinned here.
 */

import { describe, expect, it } from 'vitest'
import {
  CROP_ASPECTS,
  MIN_CROP_SIZE,
  cropNodePosition,
  cropRectToNode,
  croppedNodeSize,
  defaultCropRect,
  moveCropRect,
  resizeCropRect,
} from './crop-rect.ts'

const NATURAL = { width: 1000, height: 500 }

describe('CROP_ASPECTS', () => {
  it('offers the reference client’s list, free box first', () => {
    expect(CROP_ASPECTS.map(option => option.label)).toEqual(['自定义', '1:1', '4:3', '3:4', '16:9', '9:16'])
    expect(CROP_ASPECTS[0]!.value).toBeNull()
  })
})

describe('defaultCropRect', () => {
  it('starts as the whole picture when no ratio is chosen', () => {
    expect(defaultCropRect(NATURAL, null)).toEqual({ x: 0, y: 0, width: 1000, height: 500 })
  })

  it('starts as the largest centred box of the requested ratio', () => {
    expect(defaultCropRect(NATURAL, 1)).toEqual({ x: 250, y: 0, width: 500, height: 500 })
    const wide = defaultCropRect(NATURAL, 16 / 9)
    expect(wide.width).toBeCloseTo(888.888, 2)
    expect(wide.height).toBeCloseTo(500, 5)
    expect(wide.x).toBeCloseTo(55.556, 2)
  })
})

describe('moveCropRect', () => {
  it('moves the box and keeps it inside the picture', () => {
    expect(moveCropRect({ x: 0, y: 0, width: 400, height: 300 }, 50, 25, NATURAL)).toEqual({ x: 50, y: 25, width: 400, height: 300 })
    expect(moveCropRect({ x: 0, y: 0, width: 400, height: 300 }, -100, -100, NATURAL)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    expect(moveCropRect({ x: 900, y: 400, width: 400, height: 300 }, 500, 500, NATURAL)).toEqual({ x: 600, y: 200, width: 400, height: 300 })
  })
})

describe('resizeCropRect', () => {
  const RECT = { x: 200, y: 100, width: 400, height: 200 }

  it('anchors the opposite corner', () => {
    const resized = resizeCropRect(RECT, 'se', 50, 30, NATURAL, null)
    expect(resized).toEqual({ x: 200, y: 100, width: 450, height: 230 })
    const fromTopLeft = resizeCropRect(RECT, 'nw', 50, 30, NATURAL, null)
    expect(fromTopLeft).toEqual({ x: 250, y: 130, width: 350, height: 170 })
  })

  it('only moves the axis a straight handle owns', () => {
    const east = resizeCropRect(RECT, 'e', 50, 999, NATURAL, null)
    expect(east).toEqual({ x: 200, y: 100, width: 450, height: 200 })
  })

  it('holds a fixed ratio while resizing', () => {
    const square = resizeCropRect({ x: 0, y: 0, width: 400, height: 400 }, 'se', 100, 10, NATURAL, 1)
    expect(square.width).toBeCloseTo(square.height, 5)
  })

  it('never shrinks below the minimum box', () => {
    const tiny = resizeCropRect(RECT, 'se', -9999, -9999, NATURAL, null)
    expect(tiny.width).toBe(MIN_CROP_SIZE)
    expect(tiny.height).toBe(MIN_CROP_SIZE)
  })
})

describe('cropRectToNode', () => {
  it('scales the box into the node’s displayed size', () => {
    expect(cropRectToNode({ x: 250, y: 0, width: 500, height: 500 }, { width: 200, height: 100 }, NATURAL))
      .toEqual({ x: 50, y: 0, width: 100, height: 100 })
  })
})

describe('the new node a crop produces', () => {
  it('lands beside the original, keeping its own aspect', () => {
    expect(cropNodePosition({ x: 100, y: 50, width: 320 }, { width: 200 })).toEqual({ x: 444, y: 50 })
    expect(croppedNodeSize({ x: 0, y: 0, width: 800, height: 400 })).toEqual({ width: 320, height: 160 })
    expect(croppedNodeSize({ x: 0, y: 0, width: 100, height: 400 })).toEqual({ width: 100, height: 400 })
  })
})
