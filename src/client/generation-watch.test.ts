/**
 * @vitest-environment jsdom
 *
 * Tests for the "a generation finished in the host" watcher.
 *
 * The behaviours that matter are the boundaries: the first poll must only adopt
 * (never treat the existing library as brand new), a changed newest id refreshes
 * the shared library store exactly once, an unchanged id does nothing at all, a
 * failed poll changes nothing, and a hidden page stays quiet.
 *
 * The watcher no longer receives the canvas store at all: auto-opening the column
 * and placing the new picture on the board were removed on request, and "a
 * background generation must not rearrange the screen" is now a structural
 * property rather than something these tests have to police. Timers are injected
 * so the loop is driven deterministically.
 */

import { describe, expect, it } from 'vitest'
import type { LibraryHead } from '../protocol.ts'
import type { SeeWorkApi } from './api.ts'
import type { LibraryStore } from './library-store.ts'
import { watchGenerations } from './generation-watch.ts'

type Envelope<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

/** Let every pending microtask settle. */
const flush = async (): Promise<void> => {
  for (let index = 0; index < 40; index += 1) await Promise.resolve()
}

/** A watcher harness with an injectable timer and a scripted head sequence. */
function harness(heads: Array<Envelope<LibraryHead>>): {
  tick: () => Promise<void>
  stop: () => void
  calls: { refresh: number }
} {
  const queue = [...heads]
  const calls = { refresh: 0 }
  let handler: (() => void) | undefined

  const api = {
    libraryHead: async (): Promise<Envelope<LibraryHead>> => queue.shift() ?? { ok: true, value: { total: 0 } },
  } as unknown as SeeWorkApi
  const library = {
    refresh: async (): Promise<void> => { calls.refresh += 1 },
  } as unknown as LibraryStore

  const stop = watchGenerations({
    api,
    library,
    setTimer: (callback) => { handler = callback; return 0 as unknown as ReturnType<typeof setInterval> },
    clearTimer: () => {},
  })
  return {
    tick: async () => { handler?.(); await flush() },
    stop,
    calls,
  }
}

describe('watchGenerations', () => {
  it('adopts the library it finds on the first poll without refreshing', async () => {
    const watch = harness([{ ok: true, value: { total: 3, newestId: 'e3' } }])
    await watch.tick()
    expect(watch.calls.refresh).toBe(0)
    watch.stop()
  })

  it('refreshes the shared library store when a new entry appears', async () => {
    const watch = harness([
      { ok: true, value: { total: 3, newestId: 'e3' } },
      { ok: true, value: { total: 4, newestId: 'e4' } },
    ])
    await watch.tick() // adopt
    await watch.tick() // new entry
    expect(watch.calls.refresh).toBe(1)
    watch.stop()
  })

  it('does nothing while the newest entry is unchanged', async () => {
    const watch = harness([
      { ok: true, value: { total: 4, newestId: 'e4' } },
      { ok: true, value: { total: 4, newestId: 'e4' } },
      { ok: true, value: { total: 4, newestId: 'e4' } },
    ])
    await watch.tick()
    await watch.tick()
    await watch.tick()
    expect(watch.calls.refresh).toBe(0)
    watch.stop()
  })

  it('reacts to the first generation into an empty library', async () => {
    // The head reports no id while the library is empty. Adopting that as "the
    // newest" would make the very first image silently unnoticed.
    const watch = harness([
      { ok: true, value: { total: 0 } },
      { ok: true, value: { total: 1, newestId: 'e1' } },
    ])
    await watch.tick()
    await watch.tick()
    expect(watch.calls.refresh).toBe(1)
    watch.stop()
  })

  it('changes nothing when the poll fails', async () => {
    const watch = harness([
      { ok: true, value: { total: 1, newestId: 'e1' } },
      { ok: false, code: 'internal', message: '接口不可达' },
      // A failed poll must not consume the change it never saw.
      { ok: true, value: { total: 2, newestId: 'e2' } },
    ])
    await watch.tick()
    await watch.tick()
    expect(watch.calls.refresh).toBe(0)
    await watch.tick()
    expect(watch.calls.refresh).toBe(1)
    watch.stop()
  })

  it('stops polling once disposed', async () => {
    const watch = harness([
      { ok: true, value: { total: 1, newestId: 'e1' } },
      { ok: true, value: { total: 2, newestId: 'e2' } },
    ])
    await watch.tick()
    watch.stop()
    await watch.tick()
    expect(watch.calls.refresh).toBe(0)
  })

  it('stays quiet while the page is hidden', async () => {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      const watch = harness([
        { ok: true, value: { total: 1, newestId: 'e1' } },
        { ok: true, value: { total: 2, newestId: 'e2' } },
      ])
      await watch.tick()
      await watch.tick()
      expect(watch.calls.refresh).toBe(0)
      watch.stop()
    } finally {
      if (original === undefined) delete (document as unknown as Record<string, unknown>).visibilityState
      else Object.defineProperty(document, 'visibilityState', original)
    }
  })
})
