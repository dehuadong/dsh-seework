/**
 * @vitest-environment jsdom
 *
 * The annotation editor's behaviour, driven through real pointer and keyboard
 * events.
 *
 * The case that matters most here came from a user report: typing a label and
 * pressing Esc used to close the WHOLE editor (the document-level Escape handler
 * saw the key too), so the only way out of the text box was Enter. Esc must cancel
 * the typing and leave the editor open.
 *
 * A second user report — 「文字标注功能不能使用了」 — came from committing on blur:
 * a real click opens the box on pointerdown, the browser then moves focus on
 * mousedown, and the freshly mounted box was blurred and thrown away inside that
 * same click. The box is now created on release, and pressing outside it confirms.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnotationEditor } from './AnnotationEditor.tsx'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // The editor burns through a real canvas; jsdom has no 2D context, so the save
  // path is stubbed out and only the interaction is under test.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.restoreAllMocks()
})

/** Render the editor and return the pieces the tests drive. */
function render(onCancel: () => void = () => {}): {
  toolbar: HTMLElement
  surface: SVGSVGElement
  tool: (label: string) => HTMLButtonElement
  pointer: (type: string, x: number, y: number, target?: Element) => void
} {
  act(() => {
    root.render(<AnnotationEditor url="/api/dsh-seework/library/image/a-0.png" natural={{ width: 1000, height: 500 }} onSave={() => {}} onCancel={onCancel} />)
  })
  const toolbar = container.querySelector<HTMLElement>('[data-dsh-seework-annotation-toolbar]')!
  const surface = container.querySelector<SVGSVGElement>('svg')!
  const tool = (label: string): HTMLButtonElement =>
    [...toolbar.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === label)!
  const pointer = (type: string, x: number, y: number, target: Element = surface): void => {
    act(() => {
      // jsdom has no PointerEvent; React dispatches on the native event NAME, so a
      // MouseEvent of type `pointerdown` reaches the same handler.
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }))
    })
  }
  return { toolbar, surface, tool, pointer }
}

describe('AnnotationEditor', () => {
  it('offers all five tools, plus undo/redo and the save action', () => {
    const { toolbar } = render()
    const labels = [...toolbar.querySelectorAll('button')].map(button => button.textContent)
    expect(labels.slice(0, 5)).toEqual(['画笔', '矩形', '箭头', '文字', '橡皮擦'])
    expect(labels).toContain('撤销')
    expect(labels).toContain('重做')
    expect(container.querySelector('[data-dsh-seework-annotation-save]')).not.toBeNull()
    // Nothing marked yet: there is nothing to save.
    expect(container.querySelector<HTMLButtonElement>('[data-dsh-seework-annotation-save]')!.disabled).toBe(true)
  })

  it('keeps the whole editor inside one panel, so the chrome never spreads out', () => {
    // The pane can be stretched to the whole window (分栏 / 全屏); the editor is a
    // bounded panel inside it rather than a full-bleed page (user report: 太大),
    // and nothing in that panel may be see-through (user report: 文字显示不清楚).
    const { toolbar } = render()
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.children).toHaveLength(1)
    const panel = dialog.firstElementChild as HTMLElement
    expect(panel.contains(toolbar)).toBe(true)
    expect(panel.contains(container.querySelector('[data-dsh-seework-annotation-save]'))).toBe(true)
    expect(panel.contains(container.querySelector('svg'))).toBe(true)
  })

  it('draws a rectangle by dragging, and enables saving', () => {
    const { surface, tool, pointer } = render()
    act(() => { tool('矩形').click() })
    pointer('pointerdown', 100, 50)
    pointer('pointermove', 400, 250)
    pointer('pointerup', 400, 250)
    expect(surface.querySelectorAll('rect')).toHaveLength(1)
    expect(container.querySelector<HTMLButtonElement>('[data-dsh-seework-annotation-save]')!.disabled).toBe(false)
  })

  it('draws an arrow with a shaft and a head', () => {
    const { surface, tool, pointer } = render()
    act(() => { tool('箭头').click() })
    pointer('pointerdown', 100, 100)
    pointer('pointermove', 300, 200)
    pointer('pointerup', 300, 200)
    expect(surface.querySelectorAll('line')).toHaveLength(1)
    expect(surface.querySelectorAll('polygon')).toHaveLength(1)
  })

  it('erases an object the pointer is dragged over, and undo brings it back', () => {
    const { surface, tool, pointer } = render()
    act(() => { tool('矩形').click() })
    pointer('pointerdown', 100, 50)
    pointer('pointermove', 400, 250)
    pointer('pointerup', 400, 250)
    expect(surface.querySelectorAll('rect')).toHaveLength(1)

    act(() => { tool('橡皮擦').click() })
    pointer('pointerdown', 250, 150)
    expect(surface.querySelectorAll('rect')).toHaveLength(0)

    act(() => { [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '撤销')!.click() })
    expect(surface.querySelectorAll('rect')).toHaveLength(1)
  })
})

describe('the text tool’s keyboard', () => {
  /**
   * Open the text box the way a real click does: press, then release.
   *
   * The release half is not a detail — the box is created there on purpose, because
   * a box created on the press is blurred by the browser's own `mousedown` focus
   * handling before the user can type (see the regression tests below).
   */
  function openText(): { input: HTMLInputElement; cancelled: () => number; pointer: (type: string, x: number, y: number, target?: Element) => void; tool: (label: string) => HTMLButtonElement; surface: SVGSVGElement } {
    let cancels = 0
    const ui = render(() => { cancels += 1 })
    act(() => { ui.tool('文字').click() })
    ui.pointer('pointerdown', 200, 100)
    ui.pointer('pointerup', 200, 100)
    const input = container.querySelector<HTMLInputElement>('[data-dsh-seework-annotation-text] input')
    if (input === null) throw new Error('the text box did not open')
    return { ...ui, input, cancelled: () => cancels }
  }

  /** Type into the box (jsdom's own value setter, so React sees the change). */
  function type(input: HTMLInputElement, value: string): void {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('opens on release, not on the press that would immediately blur it', () => {
    const { tool, pointer } = render()
    act(() => { tool('文字').click() })
    pointer('pointerdown', 200, 100)
    // A box created here would be mounted and then blurred inside the same click,
    // because the browser moves focus on mousedown (which follows pointerdown).
    expect(container.querySelector('[data-dsh-seework-annotation-text]')).toBeNull()
    pointer('pointerup', 200, 100)
    expect(container.querySelector('[data-dsh-seework-annotation-text]')).not.toBeNull()
  })

  it('survives losing focus mid-click and still confirms with Enter', () => {
    const { input } = openText()
    // This is what the browser does to a box that opens too early; the box must
    // stay put (it used to commit its empty value and vanish — user report:
    // 「文字标注功能不能使用了」).
    act(() => { input.blur() })
    expect(container.querySelector('[data-dsh-seework-annotation-text]')).not.toBeNull()
    type(input, '看这里')
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(container.querySelector('svg')!.querySelectorAll('text')).toHaveLength(1)
    expect(container.querySelector('[data-dsh-seework-annotation-text]')).toBeNull()
  })

  it('confirms the typing when the user presses somewhere else', () => {
    const { input, pointer } = openText()
    type(input, '看这里')
    pointer('pointerdown', 500, 300)
    pointer('pointerup', 500, 300)
    expect(container.querySelector('[data-dsh-seework-annotation-text]')).toBeNull()
    expect(container.querySelector('svg')!.querySelectorAll('text')).toHaveLength(1)
    // …and that press only confirmed: the next one opens a box again. In a real
    // browser the confirming press re-renders between the capture and bubble
    // listeners, so this second half is what keeps one click from confirming a
    // label and immediately opening the next box.
    pointer('pointerdown', 600, 350)
    pointer('pointerup', 600, 350)
    expect(container.querySelector('[data-dsh-seework-annotation-text]')).not.toBeNull()
  })

  it('cancels with Esc WITHOUT closing the editor, even with no focus in the box', () => {
    const { input, cancelled } = openText()
    act(() => { input.blur() })
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    // The typing is gone…
    expect(container.querySelector('[data-dsh-seework-annotation-text]')).toBeNull()
    expect(container.querySelector('svg')!.querySelectorAll('text')).toHaveLength(0)
    // …and the editor is still there, which is the whole point of the fix.
    expect(container.querySelector('[data-dsh-seework-annotation-toolbar]')).not.toBeNull()
    expect(cancelled()).toBe(0)
  })

  it('cancels with Esc from inside the box, and keeps the editor open', () => {
    const { input, cancelled } = openText()
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(container.querySelector('[data-dsh-seework-annotation-text]')).toBeNull()
    expect(container.querySelector('svg')!.querySelectorAll('text')).toHaveLength(0)
    expect(container.querySelector('[data-dsh-seework-annotation-toolbar]')).not.toBeNull()
    expect(cancelled()).toBe(0)
  })

  it('still closes the editor when Escape arrives with no text box open', () => {
    let cancels = 0
    render(() => { cancels += 1 })
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(cancels).toBe(1)
  })
})
