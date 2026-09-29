/**
 * @vitest-environment jsdom
 *
 * Right-sidebar tab tests.
 *
 * The two surfaces now live in the shell's right column, so what has to hold is
 * the handoff: both tab types are declared, both bodies land under the same ids,
 * the open/close calls go to the controller, and a shell without the column
 * leaves the plugin working through its floating surfaces instead of throwing.
 */

import { describe, expect, it, vi } from 'vitest'
import type { CanvasStore } from './canvas-store.ts'
import type { LibraryStore } from './library-store.ts'
import {
  CANVAS_TAB_KIND,
  LIBRARY_TAB_KIND,
  closeSeeWorkTab,
  isSeeWorkTabActive,
  openSeeWorkTab,
  registerSidebarTabs,
  sidebarAvailable,
  type TabStores,
} from './sidebar-tabs.ts'

/** A stub right column that records what it was asked to do. */
function sidebarHarness(): {
  ctx: unknown
  types: Array<Record<string, unknown>>
  bodies: Array<{ key: unknown; component: unknown }>
  titles: Array<{ key: unknown; component: unknown }>
  opened: Array<{ kind: string; options: unknown }>
  closed: string[]
  active: { kind: string; id: string } | undefined
} {
  const types: Array<Record<string, unknown>> = []
  const bodies: Array<{ key: unknown; component: unknown }> = []
  const titles: Array<{ key: unknown; component: unknown }> = []
  const opened: Array<{ kind: string; options: unknown }> = []
  const closed: string[] = []
  const state = { active: undefined as { kind: string; id: string } | undefined }
  const registry = {
    sidebarRightTabs: {
      register(definition: Record<string, unknown>) {
        types.push(definition)
        return () => {}
      },
    },
    sidebarRight: {
      openTab(kind: string, options?: unknown) {
        opened.push({ kind, options })
        state.active = { kind, id: `tab-${kind}` }
      },
      active: () => state.active,
      close(tabId: string) {
        closed.push(tabId)
        state.active = undefined
      },
    },
    slots: {
      inject(_name: string, callback: () => void) {
        callback()
        return () => {}
      },
      register(options: Record<string, unknown>, component: unknown) {
        if (options.name === 'sidebar.right.pane.tab') bodies.push({ key: options.key, component })
        else titles.push({ key: options.key, component })
        return () => {}
      },
    },
  }
  // Services arrive through `ctx.get`, the client guard's sanctioned probe.
  const ctx = { get: (name: string) => (registry as Record<string, unknown>)[name] }
  return {
    ctx,
    types,
    bodies,
    titles,
    opened,
    closed,
    get active() { return state.active },
  }
}

/** The stores the registration binds; only their identity matters here. */
function stores(): TabStores {
  return {
    library: {} as LibraryStore,
    canvas: {} as CanvasStore,
    entries: () => [],
    onNeedLibrary: () => {},
  }
}

describe('registerSidebarTabs', () => {
  it('declares both tab types and their bodies, and reports them available', () => {
    const harness = sidebarHarness()
    const result = registerSidebarTabs(harness.ctx as never, stores())
    expect(harness.types.map(type => type.kind)).toEqual([LIBRARY_TAB_KIND, CANVAS_TAB_KIND])
    expect(harness.bodies.map(body => body.key)).toEqual(['dsh-seework/library', 'dsh-seework/canvas'])
    expect(harness.titles.map(title => title.key)).toEqual(['dsh-seework/library', 'dsh-seework/canvas'])
    expect(typeof harness.types[0]!.title).toBe('function')
    // The caller retires its floating launchers only when both tabs landed.
    expect(result.tabsAvailable).toBe(true)
    expect(typeof result.dispose).toBe('function')
  })

  it('reports the tabs unavailable on a shell without the column', () => {
    const empty = { get: (name: string) => (name === 'slots' ? { inject: () => () => {}, register: () => () => {} } : undefined) }
    const result = registerSidebarTabs(empty as never, stores())
    expect(result.tabsAvailable).toBe(false)
    expect(sidebarAvailable(empty as never)).toBe(false)
  })

  it('reports the column available when both services answer', () => {
    const harness = sidebarHarness()
    expect(sidebarAvailable(harness.ctx as never)).toBe(true)
  })

  it('keeps going when the registry refuses a tab', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const registry: Record<string, unknown> = {
      sidebarRightTabs: { register: () => { throw new Error('id taken') } },
      slots: {
        inject: (_name: string, callback: () => void) => { callback(); return () => {} },
        register: () => { throw new Error('key taken') },
      },
    }
    const hostile = { get: (name: string) => registry[name] }
    try {
      const result = registerSidebarTabs(hostile as never, stores())
      expect(result.tabsAvailable).toBe(false)
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('tab control', () => {
  it('opens, reports and closes through the right column', () => {
    const harness = sidebarHarness()
    expect(openSeeWorkTab(harness.ctx as never, LIBRARY_TAB_KIND)).toBe(true)
    expect(harness.opened).toEqual([{ kind: LIBRARY_TAB_KIND, options: { revealIfOpened: true } }])
    expect(isSeeWorkTabActive(harness.ctx as never, LIBRARY_TAB_KIND)).toBe(true)
    expect(isSeeWorkTabActive(harness.ctx as never, CANVAS_TAB_KIND)).toBe(false)

    expect(closeSeeWorkTab(harness.ctx as never, LIBRARY_TAB_KIND)).toBe(true)
    expect(harness.closed).toEqual([`tab-${LIBRARY_TAB_KIND}`])
    expect(isSeeWorkTabActive(harness.ctx as never, LIBRARY_TAB_KIND)).toBe(false)
  })

  it('reports failure instead of throwing when there is no column', () => {
    const bare = {}
    expect(openSeeWorkTab(bare as never, LIBRARY_TAB_KIND)).toBe(false)
    expect(isSeeWorkTabActive(bare as never, LIBRARY_TAB_KIND)).toBe(false)
    expect(closeSeeWorkTab(bare as never, LIBRARY_TAB_KIND)).toBe(false)
  })

  it('does not close a tab that belongs to something else', () => {
    const harness = sidebarHarness()
    openSeeWorkTab(harness.ctx as never, CANVAS_TAB_KIND)
    expect(closeSeeWorkTab(harness.ctx as never, LIBRARY_TAB_KIND)).toBe(false)
    expect(harness.closed).toEqual([])
  })
})
