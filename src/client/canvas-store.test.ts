/**
 * @vitest-environment jsdom
 *
 * Canvas client-store tests: the board document, the debounced save, and the
 * revision fence. The fence is the reason two windows can edit one board, so
 * the conflict path gets the most attention — losing a user's layout to a
 * silently overwritten save is the failure this whole module exists to prevent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasDocument, CanvasSummary } from '../protocol.ts'
import type { SeeWorkApi } from './api.ts'
import { AUTOSAVE_DELAY_MS, CanvasStore, unusedCardId } from './canvas-store.ts'

/** One stored board. */
function board(overrides: Partial<CanvasDocument> = {}): CanvasDocument {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    title: '测试画布',
    revision: 3,
    viewport: { x: 0, y: 0, k: 1 },
    cards: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** A stub API client whose save behaviour each test controls. */
function stubApi(options: { board?: CanvasDocument; saveFails?: string; conflictOnce?: boolean } = {}) {
  let stored = options.board ?? board()
  const summaries: CanvasSummary[] = [{ id: stored.id, title: stored.title, revision: stored.revision, cardCount: stored.cards.length, createdAt: 1, updatedAt: 1 }]
  const calls: string[] = []
  let conflictPending = options.conflictOnce === true
  const api = {
    canvases: async () => {
      calls.push('list')
      return { ok: true as const, value: { canvases: summaries, dataRoot: '/tmp/lib' } }
    },
    createCanvas: async () => {
      calls.push('create')
      stored = board({ revision: 1, title: '未命名画布' })
      return { ok: true as const, value: { canvas: stored } }
    },
    readCanvas: async (id: string) => {
      calls.push(`read:${id}`)
      return id === stored.id
        ? { ok: true as const, value: { canvas: stored } }
        : { ok: false as const, code: 'canvas_not_found', message: '画布不存在。' }
    },
    saveCanvas: async (canvas: CanvasDocument, expectedRevision: number) => {
      calls.push(`save:${expectedRevision}`)
      if (conflictPending) {
        conflictPending = false
        // Another window saved first: the stored revision moved on.
        stored = { ...stored, revision: stored.revision + 1, title: '别处改过的标题' }
        return { ok: false as const, code: 'canvas_conflict', message: '画布已被其它窗口修改。' }
      }
      if (options.saveFails !== undefined) {
        return { ok: false as const, code: 'internal', message: options.saveFails }
      }
      if (expectedRevision !== stored.revision) {
        return { ok: false as const, code: 'canvas_conflict', message: '画布已被其它窗口修改。' }
      }
      stored = { ...canvas, revision: stored.revision + 1 }
      return { ok: true as const, value: { canvas: stored } }
    },
    removeCanvas: async (id: string) => {
      calls.push(`remove:${id}`)
      const remaining = summaries.filter(summary => summary.id !== id)
      return { ok: true as const, value: { canvases: remaining } }
    },
  }
  return { api: api as unknown as SeeWorkApi, calls, stored: () => stored }
}

/** Advance past the autosave debounce and let the save settle. */
async function settleAutosave(): Promise<void> {
  await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10)
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('CanvasStore', () => {
  it('loads the board list', async () => {
    const { api } = stubApi()
    const store = new CanvasStore(api)
    await store.refreshList()
    expect(store.getSnapshot().status).toBe('ready')
    expect(store.getSnapshot().boards).toHaveLength(1)
  })

  it('opens a board and reports it as clean', async () => {
    const { api } = stubApi()
    const store = new CanvasStore(api)
    const opened = await store.open('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(opened?.title).toBe('测试画布')
    expect(store.getSnapshot().board?.revision).toBe(3)
    expect(store.getSnapshot().dirty).toBe(false)
    store.dispose()
  })

  it('creates a board when no id is given', async () => {
    const { api, calls } = stubApi()
    const store = new CanvasStore(api)
    const created = await store.open('')
    expect(calls).toContain('create')
    expect(created?.title).toBe('未命名画布')
    store.dispose()
  })

  it('marks the board dirty on an edit and saves after the debounce', async () => {
    const { api, calls, stored } = stubApi()
    const store = new CanvasStore(api)
    await store.open('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')

    store.addCards([{ id: 'card-1', kind: 'image', x: 10, y: 20, width: 100, height: 100, z: 0, file: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-0.png' }])
    expect(store.getSnapshot().dirty).toBe(true)
    expect(store.getSnapshot().save).toBe('idle')
    // Nothing has crossed the wire yet.
    expect(calls.filter(call => call.startsWith('save'))).toHaveLength(0)

    await settleAutosave()
    expect(calls.filter(call => call.startsWith('save'))).toHaveLength(1)
    expect(store.getSnapshot().dirty).toBe(false)
    expect(store.getSnapshot().save).toBe('saved')
    expect(stored().cards.map(card => card.id)).toEqual(['card-1'])
    store.dispose()
  })

  it('keeps an edit made while the save request was in flight, and saves it', async () => {
    // The host's reply echoes the document that was SENT, so an edit that lands
    // while that request is in flight is newer than the reply. Adopting the echo
    // would drop it — clicking「适应内容」right after a card move is exactly this
    // shape — and marking the board clean would stop it from ever being saved.
    const base = board()
    let stored = base
    let release: (() => void) | undefined
    let saves = 0
    const api = {
      canvases: async () => ({ ok: true as const, value: { canvases: [], dataRoot: '/tmp/lib' } }),
      readCanvas: async () => ({ ok: true as const, value: { canvas: stored } }),
      saveCanvas: async (canvas: CanvasDocument) => {
        saves += 1
        // The first request hangs, opening the in-flight window.
        if (saves === 1) await new Promise<void>(resolve => { release = resolve })
        stored = { ...canvas, revision: stored.revision + 1 }
        return { ok: true as const, value: { canvas: stored } }
      },
    } as unknown as SeeWorkApi
    const store = new CanvasStore(api)
    await store.open(base.id)

    // First edit: its autosave is now in flight.
    store.setViewport({ x: 10, y: 20, k: 1 })
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10)
    expect(release).toBeDefined()

    // Second edit while the request is still out — the one that used to vanish.
    store.setViewport({ x: 0, y: 0, k: 0.25 })

    release?.()
    await vi.advanceTimersByTimeAsync(0)

    expect(store.getSnapshot().board!.viewport).toEqual({ x: 0, y: 0, k: 0.25 })
    expect(store.getSnapshot().dirty).toBe(true)

    // …and the follow-up save actually carries it to the host.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10)
    expect(saves).toBe(2)
    expect(stored.viewport).toEqual({ x: 0, y: 0, k: 0.25 })
    expect(store.getSnapshot().dirty).toBe(false)
    expect(store.getSnapshot().save).toBe('saved')
    store.dispose()
  })

  it('adopts the host revision when nothing changed while saving', async () => {
    const { api, stored, calls } = stubApi()
    const store = new CanvasStore(api)
    await store.open('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    store.addCards([{ id: 'card-1', kind: 'text', x: 0, y: 0, width: 10, height: 10, z: 0, text: '' }])
    await settleAutosave()
    expect(calls.filter(call => call.startsWith('save'))).toHaveLength(1)
    // The store took the host's new revision, and it is clean.
    expect(store.getSnapshot().board!.revision).toBe(stored().revision)
    expect(store.getSnapshot().dirty).toBe(false)
    expect(store.getSnapshot().save).toBe('saved')
    store.dispose()
  })

  it('stacks new cards above the ones already there', async () => {
    const { api } = stubApi()
    const store = new CanvasStore(api)
    await store.open('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    store.addCards([{ id: 'a', kind: 'text', x: 0, y: 0, width: 10, height: 10, z: 0, text: '' }])
    store.addCards([{ id: 'b', kind: 'text', x: 0, y: 0, width: 10, height: 10, z: 0, text: '' }])
    const cards = store.getSnapshot().board!.cards
    expect(cards[0]!.z).toBeLessThan(cards[1]!.z)
    store.dispose()
  })

  it('moves, resizes and removes cards', async () => {
    const { api } = stubApi()
    const store = new CanvasStore(api)
    await store.open('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    store.addCards([{ id: 'a', kind: 'text', x: 0, y: 0, width: 100, height: 100, z: 1, text: '' }])
    store.updateCard('a', { x: 50, y: 60 })
    expect(store.getSnapshot().board!.cards[0]).toMatchObject({ x: 50, y: 60 })
    store.updateCard('a', { width: 300 })
    expect(store.getSnapshot().board!.cards[0]!.width).toBe(300)
    store.removeCard('a')
    expect(store.getSnapshot().board!.cards).toHaveLength(0)
    store.dispose()
  })

  it('remembers the viewport', async () => {
    const { api, stored } = stubApi()
    const store = new CanvasStore(api)
    await store.open('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    store.setViewport({ x: -120, y: 40, k: 1.5 })
    await store.saveNow()
    expect(stored().viewport).toEqual({ x: -120, y: 40, k: 1.5 })
    store.dispose()
  })

  it('keeps the local edit and retries on the fresh revision when another window saved first', async () => {
    const { api, calls, stored } = stubApi({ conflictOnce: true })
    const store = new CanvasStore(api)
    await store.open('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    store.addCards([{ id: 'mine', kind: 'text', x: 5, y: 5, width: 10, height: 10, z: 1, text: '我的改动' }])
    await store.saveNow()

    // The conflict was reported, re-read, and retried on the new revision, so
    // the user's whole board is what ends up stored and the notice clears.
    expect(store.getSnapshot().dirty).toBe(false)
    expect(store.getSnapshot().save).toBe('saved')
    expect(store.getSnapshot().message).toBeUndefined()
    expect(stored().cards.map(card => card.id)).toEqual(['mine'])
    expect(calls.some(call => call.startsWith('read:'))).toBe(true)
    expect(calls.filter(call => call.startsWith('save')).length).toBeGreaterThanOrEqual(2)
    store.dispose()
  })

  it('adopts the revision the other window wrote, not the one it was reading', async () => {
    const { api } = stubApi({ conflictOnce: true })
    const store = new CanvasStore(api)
    await store.open('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    const before = store.getSnapshot().board!.revision
    store.addCards([{ id: 'mine', kind: 'text', x: 5, y: 5, width: 10, height: 10, z: 1, text: '' }])
    await store.saveNow()
    // The other window's write bumped the stored revision; the retry succeeded
    // on top of it.
    expect(store.getSnapshot().board!.revision).toBeGreaterThan(before + 1)
    store.dispose()
  })

  it('keeps the edit and reports a failure when the save cannot land', async () => {
    const { api } = stubApi({ saveFails: '接口不可达' })
    const store = new CanvasStore(api)
    await store.open('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    store.addCards([{ id: 'mine', kind: 'text', x: 0, y: 0, width: 10, height: 10, z: 1, text: '' }])
    await store.saveNow()
    expect(store.getSnapshot().save).toBe('error')
    expect(store.getSnapshot().message).toContain('接口不可达')
    expect(store.getSnapshot().dirty).toBe(true)
    expect(store.getSnapshot().board?.cards).toHaveLength(1)
    store.dispose()
  })

  it('reports a failed list read without dropping the open board', async () => {
    const { api } = stubApi()
    const store = new CanvasStore(api)
    await store.open('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    const failing = { ...api, canvases: async () => ({ ok: false as const, code: 'internal', message: '读不到列表' }) } as unknown as SeeWorkApi
    const other = new CanvasStore(failing)
    await other.refreshList()
    expect(other.getSnapshot().status).toBe('error')
    expect(other.getSnapshot().message).toBe('读不到列表')
    other.dispose()
    store.dispose()
  })

  it('saves on close and drops the board afterwards', async () => {
    const { api, stored } = stubApi()
    const store = new CanvasStore(api)
    await store.open('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    store.setTitle('改过的名字')
    await store.close()
    expect(stored().title).toBe('改过的名字')
    expect(store.getSnapshot().board).toBeUndefined()
    store.dispose()
  })

  it('deletes a board and refreshes the list', async () => {
    const { api, calls } = stubApi()
    const store = new CanvasStore(api)
    await store.open('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    await store.deleteBoard('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(calls).toContain('remove:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(store.getSnapshot().boards).toHaveLength(0)
    store.dispose()
  })

  it('does nothing when there is no open board', async () => {
    const { api, calls } = stubApi()
    const store = new CanvasStore(api)
    store.addCards([{ id: 'a', kind: 'text', x: 0, y: 0, width: 1, height: 1, z: 0, text: '' }])
    await store.saveNow()
    expect(calls.filter(call => call.startsWith('save'))).toHaveLength(0)
    store.dispose()
  })
})

describe('unusedCardId', () => {
  it('never collides with a card already on the board', () => {
    const taken = new Set<string>()
    const existing: CanvasDocument = board({ cards: [] })
    for (let index = 0; index < 50; index++) {
      const id = unusedCardId(existing)
      expect(taken.has(id)).toBe(false)
      taken.add(id)
      existing.cards = [...existing.cards, { id, kind: 'text', x: 0, y: 0, width: 1, height: 1, z: 0, text: '' }]
    }
  })

  it('works with no board at all', () => {
    expect(unusedCardId(undefined).length).toBeGreaterThan(0)
  })
})
