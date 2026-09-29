/**
 * @vitest-environment jsdom
 *
 * Floating command bar: where it sits, and the one action it carries so far.
 *
 * The maths is pure and pinned here because a wrong placement is exactly the
 * class of bug that only shows up at the edges of the board (a bar half off the
 * stage, or a picture's bar floating over a different picture).
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CanvasViewport } from '../protocol.ts'
import { NodeFloatingBar } from './NodeFloatingBar.tsx'
import { FLOATING_BAR_EDGE_MARGIN, FLOATING_BAR_GAP, floatingBarPosition } from './floating-bar.ts'

const VIEWPORT: CanvasViewport = { x: 0, y: 0, k: 1 }
const BAR = { width: 160, height: 30 }
const STAGE = { width: 800, height: 600 }

/** One node rectangle at a board position. */
function node(x: number, y: number, width = 200, height = 120): { x: number; y: number; width: number; height: number } {
  return { x, y, width, height }
}

describe('floatingBarPosition', () => {
  it('sits above the node, centred on it', () => {
    const position = floatingBarPosition(node(200, 200), VIEWPORT, BAR, STAGE)
    expect(position.placement).toBe('above')
    // Node spans x 200..400 → centre 300 → bar left = 300 - 80.
    expect(position.left).toBe(220)
    expect(position.top).toBe(200 - FLOATING_BAR_GAP - BAR.height)
  })

  it('flips below when there is no room above', () => {
    const position = floatingBarPosition(node(200, 4), VIEWPORT, BAR, STAGE)
    expect(position.placement).toBe('below')
    // Node bottom = 4 + 120 = 124.
    expect(position.top).toBe(124 + FLOATING_BAR_GAP)
  })

  it('clamps inside the stage instead of running off an edge', () => {
    // A narrow node right at the left edge would put the bar at -60 without the clamp.
    const left = floatingBarPosition(node(0, 200, 40), VIEWPORT, BAR, STAGE)
    expect(left.left).toBe(FLOATING_BAR_EDGE_MARGIN)
    const right = floatingBarPosition(node(760, 200), VIEWPORT, BAR, STAGE)
    expect(right.left).toBe(STAGE.width - FLOATING_BAR_EDGE_MARGIN - BAR.width)
  })

  it('follows pan and zoom', () => {
    const zoomed: CanvasViewport = { x: 40, y: -60, k: 2 }
    const position = floatingBarPosition(node(100, 100, 200, 100), zoomed, BAR, STAGE)
    // Node screen x: 100*2+40 = 240 .. 640 → centre 440 → left 360; top 100*2-60 = 140.
    expect(position.left).toBe(360)
    expect(position.top).toBe(140 - FLOATING_BAR_GAP - BAR.height)
  })
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

describe('NodeFloatingBar', () => {
  it('offers 「加入到对话框」 and runs it', () => {
    const clicks: string[] = []
    act(() => {
      root.render(
        <NodeFloatingBar
          node={node(200, 200)}
          viewport={VIEWPORT}
          stageSize={STAGE}
          onAddToConversation={() => { clicks.push('composer'); return true }}
        />,
      )
    })
    const button = container.querySelector<HTMLButtonElement>('button')!
    expect(button.textContent).toBe('加入到对话框')
    act(() => { button.click() })
    expect(clicks).toEqual(['composer'])
  })

  it('disables the action when there is no session to add to', () => {
    act(() => {
      root.render(<NodeFloatingBar node={node(200, 200)} viewport={VIEWPORT} stageSize={STAGE} />)
    })
    expect(container.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
  })

  it('tells the board which side it landed on', () => {
    act(() => {
      root.render(
        <NodeFloatingBar node={node(200, 4)} viewport={VIEWPORT} stageSize={STAGE} onAddToConversation={() => true} />,
      )
    })
    expect(container.querySelector('[data-dsh-seework-node-bar]')?.getAttribute('data-placement')).toBe('below')
  })

  it('carries the mark and crop entries, disabled without their handlers', () => {
    act(() => {
      root.render(<NodeFloatingBar node={node(200, 200)} viewport={VIEWPORT} stageSize={STAGE} />)
    })
    const labels = [...container.querySelectorAll('button')].map(button => button.textContent)
    expect(labels).toEqual(['加入到对话框', '标注', '裁剪'])
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].every(button => button.disabled)).toBe(true)
  })

  it('runs the mark and crop entries', () => {
    const ran: string[] = []
    act(() => {
      root.render(
        <NodeFloatingBar
          node={node(200, 200)}
          viewport={VIEWPORT}
          stageSize={STAGE}
          onAnnotate={() => { ran.push('annotate') }}
          onCrop={() => { ran.push('crop') }}
        />,
      )
    })
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')]
    act(() => { buttons[1]!.click() })
    act(() => { buttons[2]!.click() })
    expect(ran).toEqual(['annotate', 'crop'])
  })
})
