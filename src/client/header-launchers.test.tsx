/**
 * @vitest-environment jsdom
 *
 * Header-launcher tests: the SeeWork entry points in the shell's conversation
 * header.
 *
 * What matters here is not the styling but the wiring, because both halves are
 * invisible until a real click happens in a real shell:
 *  - the buttons land in the shell's utilities slot;
 *  - pressing one asks the column to open or close the matching page, so there
 *    is exactly one way in;
 *  - the pressed button reports itself active while that surface is up.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeaderLaunchers, setLauncherControls } from './header-launchers.tsx'
import { apply } from './index.ts'
import { ACTIVATE_EVENT } from './activation.ts'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // `apply` mounts the real surfaces, and their stores refresh on mount. A
  // stubbed fetch keeps those promises settling inside the test instead of
  // resolving after it, where React reports them as stray act() updates.
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  // `apply` appends its own surfaces to document.body; clear them so one test's
  // panel cannot answer another test's click.
  for (const node of [...document.body.children]) {
    if (node !== container) node.remove()
  }
  vi.unstubAllGlobals()
})

/** Every activation announcement seen so far, newest last. */
function recordActivations(): Array<string> {
  const seen: Array<string> = []
  document.addEventListener(ACTIVATE_EVENT, event => { seen.push((event as CustomEvent<string>).detail) })
  return seen
}

describe('HeaderLaunchers', () => {
  it('renders one button per surface, in order', () => {
    act(() => {
      root.render(<HeaderLaunchers />)
    })
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons.map(button => button.textContent)).toEqual(['素材库', '画布'])
    expect(buttons.map(button => button.dataset.surface)).toEqual(['library', 'canvas'])
  })

  it('asks the matching surface to open, through the controls', () => {
    const opened: string[] = []
    const stop = setLauncherControls({
      isOpen: () => false,
      open: surface => { opened.push(surface); return true },
      close: () => true,
    })
    act(() => {
      root.render(<HeaderLaunchers />)
    })
    const canvas = container.querySelector<HTMLButtonElement>('button[data-surface="canvas"]')!
    act(() => { canvas.click() })
    expect(opened).toEqual(['canvas'])
    stop()
  })

  it('marks the button whose surface is up', () => {
    act(() => {
      root.render(<HeaderLaunchers />)
    })
    const library = container.querySelector<HTMLButtonElement>('button[data-surface="library"]')!
    expect(library.dataset.active).toBeUndefined()
    act(() => {
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: 'library' }))
    })
    expect(library.dataset.active).toBe('true')
    expect(library.getAttribute('aria-expanded')).toBe('true')
    act(() => {
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: 'canvas' }))
    })
    expect(library.dataset.active).toBeUndefined()
    expect(container.querySelector<HTMLButtonElement>('button[data-surface="canvas"]')!.dataset.active).toBe('true')
  })

  it('presses the surface away when it is already showing', () => {
    const seen = recordActivations()
    const opened: string[] = []
    const closed: string[] = []
    const stop = setLauncherControls({
      isOpen: surface => surface === 'library',
      open: surface => { opened.push(surface); return true },
      close: surface => { closed.push(surface); return true },
    })
    act(() => {
      root.render(<HeaderLaunchers />)
    })
    const library = container.querySelector<HTMLButtonElement>('button[data-surface="library"]')!
    act(() => { library.click() })
    expect(closed).toEqual(['library'])
    expect(opened).toEqual([])
    stop()
    // Without controls there is no column to act on, so a press does nothing —
    // and in particular does not announce a surface nobody can open.
    act(() => { library.click() })
    expect(seen).toEqual([])
  })
})

describe('apply: header launchers', () => {
  /**
   * A stub client context that records slot registrations.
   *
   * Only the slot registry is exercised: the surfaces `apply()` also mounts
   * would start store refreshes and pollute the run with async updates, and what
   * this test is about is the handoff to the shell, not those panels.
   */
  function launchWith(slots: Record<string, unknown> | undefined, declared?: string[]): {
    registrations: Array<{ options: Record<string, unknown>; component: unknown }>
    injections: string[]
    disposed: string[]
    /** Run the deferred slot callbacks; `reverse` flips their arrival order. */
    runInjections(reverse?: boolean): void
  } {
    const registrations: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const injections: string[] = []
    const disposed: string[] = []
    const callbacks: Array<{ name: string; callback: () => void }> = []
    const registry = slots === undefined
      ? undefined
      : {
        inject(name: string, callback: () => void) {
          injections.push(name)
          callbacks.push({ name, callback })
          return () => {}
        },
        register(options: Record<string, unknown>, component: unknown) {
          registrations.push({ options, component })
          return () => { disposed.push(String(options.name)) }
        },
        ...slots,
      }
    const ctx = { slots: registry, effect: () => () => {}, get: () => undefined }
    // `apply` mounts the plugin's DOM surfaces too; wrapping it keeps React's
    // async updates inside act() instead of warning about them.
    act(() => { apply(ctx as never) })
    return {
      registrations,
      injections,
      disposed,
      // A slot the shell never declared simply never runs its callback; a stub
      // that ran everything would hide exactly the degradation under test.
      runInjections: (reverse = false) => {
        const ordered = reverse ? [...callbacks].reverse() : callbacks
        for (const entry of ordered) {
          if (declared !== undefined && !declared.includes(entry.name)) continue
          entry.callback()
        }
      },
    }
  }

  it('registers itself as a header utility when the shell offers the slot', () => {
    const harness = launchWith({})
    expect(harness.injections).toContain('conversation.session.header.utilities')
    harness.runInjections()
    const header = harness.registrations.find(entry => entry.options.name === 'conversation.session.header.utilities')
    expect(header?.options.id).toBe('dsh-seework')
  })

  it('adds a SeeWork page to the settings dialog navigation', () => {
    // `settings.plugin.item` is a tab inside the Plugins section, which users
    // miss; the nav list is where they look for a plugin they just installed.
    const harness = launchWith({})
    expect(harness.injections).toContain('settings.section')
    harness.runInjections()
    const section = harness.registrations.find(entry => entry.options.name === 'settings.section')
    expect(section?.options.id).toBe('dsh-seework')
    expect((section?.options.label as () => string)()).toBe('SeeWork')
    // After the shipped sections (10 models / 15 plugins / 20 agent presets).
    expect(section?.options.order as number).toBeGreaterThan(20)
  })

  it('keeps the settings card in exactly one place', () => {
    // With the nav page accepted, the Plugins-section tab must not stay live —
    // whether it was never registered (the nav won first) or registered and then
    // disposed (the tab won first). The same card offered twice is the clutter
    // this replaced.
    const harness = launchWith({})
    harness.runInjections()
    expect(harness.registrations.some(entry => entry.options.name === 'settings.section')).toBe(true)
    const liveTab = harness.registrations.some(entry => entry.options.name === 'settings.plugin.item')
      && !harness.disposed.includes('settings.plugin.item')
    expect(liveTab).toBe(false)
  })

  it('drops the Plugins tab when the navigation page arrives second', () => {
    // The other ordering: the Plugins tab's callback runs first, so the tab is
    // registered, and the nav page lands afterwards — that is when the tab has
    // to be disposed, or the duplicate survives exactly as it did before.
    const harness = launchWith({})
    harness.runInjections(true)
    expect(harness.registrations.some(entry => entry.options.name === 'settings.plugin.item')).toBe(true)
    expect(harness.disposed).toContain('settings.plugin.item')
  })

  it('falls back to the Plugins tab when the shell has no settings navigation', () => {
    // A shell that never declares `settings.section` must still be configurable,
    // so the Plugins-section tab stays registered in that case.
    const harness = launchWith({}, ['settings.plugin.item', 'conversation.session.header.utilities'])
    harness.runInjections()
    expect(harness.registrations.some(entry => entry.options.name === 'settings.plugin.item')).toBe(true)
    expect(harness.disposed).not.toContain('settings.plugin.item')
  })

  it('does not throw when the shell exposes no slots at all', () => {
    expect(() => { launchWith(undefined) }).not.toThrow()
  })

  it('survives a slot registry that refuses the registration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const harness = launchWith({ register: () => { throw new Error('occupied') } })
      expect(() => { harness.runInjections() }).not.toThrow()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
