/**
 * @vitest-environment jsdom
 *
 * Launcher-dock tests.
 *
 * The dock exists because three independently-mounted surfaces need one row of
 * buttons — and the first placement (bottom-left) covered the shell's own
 * sidebar buttons, which is a bug the user sees immediately and no unit test
 * would have caught. These tests pin the parts that are checkable here: one
 * dock per document, buttons land in it, and removing a surface cleans up.
 *
 * The actual corner (bottom-right) lives in `surfaces.module.css`; jsdom does
 * not lay out or resolve the module's hashed class, so the position is verified
 * by reading the stylesheet rather than by asserting computed geometry.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SURFACE_DOCK_ATTR, attachLauncher, surfaceDock } from './surfaces.ts'

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('surfaceDock', () => {
  it('creates one dock and reuses it for later callers', () => {
    const first = surfaceDock()
    const second = surfaceDock()
    expect(first).toBeDefined()
    expect(second).toBe(first)
    expect(document.querySelectorAll(`[${SURFACE_DOCK_ATTR}]`)).toHaveLength(1)
  })
})

describe('attachLauncher', () => {
  it('puts the button in the dock', () => {
    const button = document.createElement('button')
    const detach = attachLauncher(button)
    const dock = document.querySelector(`[${SURFACE_DOCK_ATTR}]`)!
    expect(dock.contains(button)).toBe(true)
    expect(dock.childElementCount).toBe(1)
    detach()
  })

  it('keeps the buttons in attach order', () => {
    const detachers = ['设置', '素材库', '画布'].map(label => {
      const button = document.createElement('button')
      button.textContent = label
      return attachLauncher(button)
    })
    const dock = document.querySelector(`[${SURFACE_DOCK_ATTR}]`)!
    expect([...dock.children].map(child => child.textContent)).toEqual(['设置', '素材库', '画布'])
    for (const detach of detachers) detach()
  })

  it('removes the button, and the dock once it is empty', () => {
    const first = attachLauncher(document.createElement('button'))
    const second = attachLauncher(document.createElement('button'))
    const dock = document.querySelector(`[${SURFACE_DOCK_ATTR}]`)!
    expect(dock.childElementCount).toBe(2)

    first()
    expect(dock.childElementCount).toBe(1)
    // The dock survives while another surface still uses it.
    expect(document.querySelector(`[${SURFACE_DOCK_ATTR}]`)).not.toBeNull()

    second()
    expect(document.querySelector(`[${SURFACE_DOCK_ATTR}]`)).toBeNull()
  })

  it('is safe to dispose twice', () => {
    const detach = attachLauncher(document.createElement('button'))
    detach()
    expect(() => detach()).not.toThrow()
    expect(document.querySelector(`[${SURFACE_DOCK_ATTR}]`)).toBeNull()
  })
})

describe('dock placement', () => {
  it('does not sit in the bottom-left, where the shell owns buttons', () => {
    // jsdom does not lay out the module's hashed class, so the placement is
    // read from the stylesheet — that is where the bug lived.
    const css = readFileSync(path.join(process.cwd(), 'src', 'client', 'surfaces.module.css'), 'utf8')
    const dockRule = /\.dock,[\s\S]*?\{([\s\S]*?)\}/.exec(css)?.[1] ?? ''
    expect(dockRule).toContain('position: fixed')
    expect(dockRule).toContain('right:')
    expect(dockRule).toContain('bottom:')
    // A `left:` anchor here is what covered the sidebar controls.
    expect(dockRule).not.toMatch(/(^|[\s;{])left:/)
  })
})
