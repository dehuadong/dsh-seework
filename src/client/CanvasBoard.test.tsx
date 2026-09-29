/**
 * @vitest-environment jsdom
 *
 * Render smoke test for the canvas board: the surface is the whole feature, and
 * a crashing render (bad hook order, undefined card field, missing metric)
 * would blank the board rather than fail a unit assertion.
 *
 * Geometry needs DOM measurements, so `getBoundingClientRect` is stubbed —
 * jsdom reports every element as 0×0, which would make "fit" and "place in the
 * middle" meaningless.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasDocument } from '../protocol.ts'
import type { SeeWorkApi } from './api.ts'
import { CanvasStore } from './canvas-store.ts'
import { CanvasBoard, CanvasBoardList, NOTICE_MS } from './CanvasBoard.tsx'

/** The envelope shape `SeeWorkApi` answers with (kept local to the stub). */
type Envelope<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

const BOARD_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/**
 * A pointer event for jsdom, which ships no `PointerEvent`. React's synthetic
 * pointer handlers and the board's window listeners only read the mouse fields,
 * so a `MouseEvent` under the pointer type name does the job.
 */
function pointer(type: string, x: number, y: number): Event {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
}

/** A board with two cards: one picture and one note. */
function board(overrides: Partial<CanvasDocument> = {}): CanvasDocument {
  return {
    id: BOARD_ID,
    title: '测试画布',
    revision: 1,
    viewport: { x: 0, y: 0, k: 1 },
    cards: [
      { id: 'pic', kind: 'image', x: 10, y: 20, width: 320, height: 240, z: 1, file: `${BOARD_ID}-0.png`, model: 'seedream-5-0-lite', prompt: '雪山' },
      { id: 'note', kind: 'text', x: 400, y: 20, width: 240, height: 100, z: 2, text: '一句备注', fontSize: 16 },
    ],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** A stub API client that keeps the board in memory. */
function stubApi(initial: CanvasDocument = board()): {
  api: SeeWorkApi
  stored: () => CanvasDocument
  calls: string[]
  apiError: (message: string | undefined) => void
} {
  let stored = initial
  let failure: string | undefined
  const calls: string[] = []
  const answer = <T,>(value: T): Envelope<T> => failure === undefined
    ? { ok: true as const, value }
    : { ok: false as const, code: 'internal', message: failure }
  const api = {
    canvases: async () => answer({
      canvases: [{ id: stored.id, title: stored.title, revision: stored.revision, cardCount: stored.cards.length, createdAt: 1, updatedAt: 1 }],
      dataRoot: '/tmp/lib',
    }),
    createCanvas: async () => answer({ canvas: board({ revision: 1, cards: [] }) }),
    readCanvas: async () => answer({ canvas: stored }),
    saveCanvas: async (canvas: CanvasDocument) => {
      stored = { ...canvas, revision: stored.revision + 1 }
      return { ok: true as const, value: { canvas: stored } }
    },
    removeCanvas: async () => answer({ canvases: [] }),
    removeCanvasAsset: async (file: string) => {
      calls.push(`remove:${file}`)
      return answer({ removed: 1, bytes: 12 })
    },
    pruneCanvasAssets: async () => {
      calls.push('prune')
      return answer({ removed: 2, bytes: 2048 })
    },
  }
  return { api: api as unknown as SeeWorkApi, stored: () => stored, calls, apiError: message => { failure = message } }
}

/** A live store with the board open. */
async function openStore(initial: CanvasDocument = board()): Promise<{ store: CanvasStore; stored: () => CanvasDocument; calls: string[] }> {
  const { api, stored, calls } = stubApi(initial)
  const store = new CanvasStore(api)
  await store.open(BOARD_ID)
  return { store, stored, calls }
}

/** A live store plus its API stub, for the tests that assert route calls. */
async function openStoreWithApi(initial: CanvasDocument = board()): Promise<{ store: CanvasStore; api: SeeWorkApi; calls: string[]; apiError: (message: string | undefined) => void }> {
  const stub = stubApi(initial)
  const store = new CanvasStore(stub.api)
  await store.open(BOARD_ID)
  return { store, api: stub.api, calls: stub.calls, apiError: stub.apiError }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // jsdom reports every element as 0×0; the board needs a real stage. It
  // measures `offsetWidth`/`offsetHeight`, never the transformed world layer's
  // client rect — that one already includes the zoom.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, width: 900, height: 600, top: 0, left: 0, right: 900, bottom: 600, height2: 600, width2: 900,
  } as unknown as DOMRect)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.restoreAllMocks()
})

describe('CanvasBoard', () => {
  it('renders both cards with their geometry and content', async () => {
    const { store } = await openStore()
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const text = container.textContent ?? ''
    expect(text).toContain('测试画布')
    expect(text).toContain('备注')
    const cards = container.querySelectorAll('[data-seework-card]')
    expect(cards).toHaveLength(2)
    const picture = container.querySelector<HTMLElement>('[data-seework-card="pic"]')!
    expect(picture.style.left).toBe('10px')
    expect(picture.style.top).toBe('20px')
    expect(picture.style.width).toBe('320px')
    expect(picture.querySelector('img')?.getAttribute('src')).toBe(`/api/dsh-seework/library/image/${BOARD_ID}-0.png`)
    const note = container.querySelector<HTMLTextAreaElement>('[data-seework-card="note"] textarea')!
    expect(note.value).toBe('一句备注')
    store.dispose()
  })

  it('applies the board viewport to the world layer', async () => {
    const { store } = await openStore(board({ viewport: { x: -40, y: 20, k: 1.5 } }))
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const world = container.querySelector<HTMLElement>('[class*="world"]')!
    expect(world.style.transform).toBe('translate(-40px, 20px) scale(1.5)')
    expect(container.textContent).toContain('150%')
    store.dispose()
  })

  it('zooms and fits through the toolbar', async () => {
    const { store } = await openStore()
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const button = (label: string): HTMLButtonElement => {
      const found = [...container.querySelectorAll('button')].find(item => item.textContent === label)
      if (found === undefined) throw new Error(`no button labelled ${label}`)
      return found as HTMLButtonElement
    }
    act(() => { button('＋').click() })
    expect(store.getSnapshot().board!.viewport.k).toBeGreaterThan(1)
    act(() => { button('100%').click() })
    expect(store.getSnapshot().board!.viewport.k).toBe(1)
    act(() => { button('−').click() })
    expect(store.getSnapshot().board!.viewport.k).toBeLessThan(1)
    act(() => { button('适应内容').click() })
    // The two cards span x 10..640 and y 20..260, so fitting them in 900×600
    // with padding leaves the whole board visible at a zoom above 1.
    expect(store.getSnapshot().board!.viewport.k).toBeGreaterThan(1)
    store.dispose()
  })

  it('keeps the viewport put when "fit" is pressed twice', async () => {
    const { store } = await openStore(board({ viewport: { x: 12, y: -30, k: 1.4 } }))
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const fit = [...container.querySelectorAll('button')].find(item => item.textContent === '适应内容')!
    act(() => { fit.click() })
    const once = store.getSnapshot().board!.viewport
    act(() => { fit.click() })
    const twice = store.getSnapshot().board!.viewport
    // Fitting content that already fits must be a no-op.
    expect(twice).toEqual(once)
    store.dispose()
  })

  it('does not reset the view when "fit" has no stage to measure', async () => {
    // A degenerate fit returns the identity viewport — 100% at the origin —
    // which throws away wherever the user had scrolled to and reads as "my
    // pictures disappeared". Nothing to fit against means nothing to do.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(0)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(0)
    const { store } = await openStore(board({ viewport: { x: 123, y: -45, k: 2 } }))
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const fit = [...container.querySelectorAll('button')].find(item => item.textContent === '适应内容')!
    act(() => { fit.click() })
    expect(store.getSnapshot().board!.viewport).toEqual({ x: 123, y: -45, k: 2 })
    store.dispose()
  })

  it('pans by the pointer step even when a second board shares the store', async () => {
    // Two live boards over one store (the client half loading twice, say) both
    // install a window pointermove listener. Panning from the gesture's start
    // point would add the whole distance once per listener and the board would
    // run away from the pointer; panning by the step between events is
    // idempotent, so the board follows the pointer exactly once.
    const { store } = await openStore()
    const second = document.createElement('div')
    document.body.appendChild(second)
    const secondRoot = createRoot(second)
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
      secondRoot.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const surface = container.querySelector<HTMLElement>('[class*="surface"]')!
    act(() => {
      surface.dispatchEvent(pointer('pointerdown', 100, 100))
    })
    act(() => {
      window.dispatchEvent(pointer('pointermove', 140, 130))
    })
    expect(store.getSnapshot().board!.viewport).toEqual({ x: 40, y: 30, k: 1 })
    act(() => {
      window.dispatchEvent(pointer('pointermove', 200, 130))
    })
    expect(store.getSnapshot().board!.viewport).toEqual({ x: 100, y: 30, k: 1 })
    act(() => {
      window.dispatchEvent(pointer('pointerup', 200, 130))
    })
    act(() => { secondRoot.unmount() })
    second.remove()
    store.dispose()
  })

  it('keeps the live viewport when an autosave response lands mid-gesture', async () => {
    // A pan is a stream of viewport edits; the autosave that rides along
    // snapshots the board at send time. Adopting that response wholesale snaps
    // the board back to the snapshot — visible as the view drifting under the
    // pointer — so a successful save must adopt the revision, not the layout.
    const { store } = await openStore()
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const surface = container.querySelector<HTMLElement>('[class*="surface"]')!
    act(() => {
      surface.dispatchEvent(pointer('pointerdown', 100, 100))
    })
    act(() => {
      window.dispatchEvent(pointer('pointermove', 140, 130))
    })
    expect(store.getSnapshot().board!.viewport.x).toBe(40)
    await act(async () => { await store.saveNow() })
    expect(store.getSnapshot().board!.viewport).toEqual({ x: 40, y: 30, k: 1 })
    store.dispose()
  })

  it('adds a note in the middle of the view', async () => {
    const { store } = await openStore()
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const addNote = [...container.querySelectorAll('button')].find(item => item.textContent === '加备注')!
    act(() => { addNote.click() })
    const cards = store.getSnapshot().board!.cards
    expect(cards).toHaveLength(3)
    const note = cards.find(card => card.kind === 'text' && card.id !== 'note')!
    // Stage centre is (450, 300) board units at zoom 1 with no translation.
    expect(note.x).toBe(330)
    expect(note.y).toBe(250)
    store.dispose()
  })

  it('edits a note through its textarea', async () => {
    const { store } = await openStore()
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-seework-card="note"] textarea')!
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setValue.call(textarea, '改过的备注')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(store.getSnapshot().board!.cards.find(card => card.id === 'note')!.text).toBe('改过的备注')
    store.dispose()
  })

  it('lifts a card to the front when it is selected', async () => {
    // New cards land on top, so a card clicked in order to move it used to be
    // stuck under the ones added after it.
    const { store } = await openStore()
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const picture = container.querySelector<HTMLElement>('[data-seework-card="pic"]')!
    expect(picture.style.zIndex).toBe('1')
    act(() => { picture.dispatchEvent(pointer('pointerdown', 100, 100)) })
    const cards = store.getSnapshot().board!.cards
    const raised = cards.find(card => card.id === 'pic')!
    expect(raised.z).toBe(3)
    expect(Math.max(...cards.map(card => card.z))).toBe(raised.z)
    // …and clicking it again does not keep rewriting the document.
    act(() => { picture.dispatchEvent(pointer('pointerdown', 100, 100)) })
    expect(store.getSnapshot().board!.cards.find(card => card.id === 'pic')!.z).toBe(3)
    store.dispose()
  })

  it('labels each picture with where it came from, and says what ✕ deletes', async () => {
    // A composite and a library picture side by side: the badge tells them apart,
    // and only the board's own picture claims its file goes with the card.
    const { store } = await openStore(board({
      cards: [
        { id: 'made', kind: 'image', x: 0, y: 0, width: 200, height: 200, z: 1, file: 'made-0.png', source: 'canvas', origin: 'annotation' },
        { id: 'old', kind: 'image', x: 300, y: 0, width: 200, height: 200, z: 2, file: 'old-0.png', source: 'canvas', model: '裁剪' },
        { id: 'pic', kind: 'image', x: 600, y: 0, width: 200, height: 200, z: 3, file: `${BOARD_ID}-0.png`, model: 'seedream-5-0-lite' },
      ],
    }))
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const badge = (id: string): string =>
      container.querySelector<HTMLElement>(`[data-seework-card="${id}"] [data-dsh-seework-card-origin]`)?.textContent ?? ''
    const hint = (id: string): string =>
      container.querySelector<HTMLButtonElement>(`[data-seework-card="${id}"] button`)?.title ?? ''
    expect(badge('made')).toBe('标注合成')
    // No recorded origin: inferred from the label the older version wrote.
    expect(badge('old')).toBe('裁剪合成')
    expect(badge('pic')).toBe('图片')
    expect(hint('made')).toContain('合成图的文件也会一起删掉')
    expect(hint('old')).toContain('合成图的文件也会一起删掉')
    expect(hint('pic')).toContain('不会删除素材库里的文件')
    store.dispose()
  })

  it('reads the origin off the library for a picture added from it', async () => {
    const { store } = await openStore(board({
      cards: [{ id: 'pic', kind: 'image', x: 0, y: 0, width: 200, height: 200, z: 1, file: 'panel-0.png' }],
    }))
    const entries = [{
      id: 'entry-1',
      createdAt: 1,
      mode: 'text' as const,
      prompt: '面板画的',
      model: 'gpt-image-2',
      resolution: '1K',
      aspectRatio: '1:1',
      quality: '',
      outputFormat: 'png',
      n: 1,
      images: [{ file: 'panel-0.png', url: '/api/dsh-seework/library/image/panel-0.png', mime: 'image/png' }],
      source: 'panel' as const,
    }]
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries }} onNeedLibrary={() => {}} />)
    })
    const badge = container.querySelector<HTMLElement>('[data-seework-card="pic"] [data-dsh-seework-card-origin]')
    expect(badge?.textContent).toBe('面板生成')
    store.dispose()
  })

  it('deletes a composite’s file with the card, and leaves the library alone', async () => {
    const initial = board({
      cards: [
        { id: 'made', kind: 'image', x: 0, y: 0, width: 200, height: 200, z: 1, file: 'made-0.png', source: 'canvas', origin: 'crop' },
        { id: 'pic', kind: 'image', x: 300, y: 0, width: 200, height: 200, z: 2, file: `${BOARD_ID}-0.png` },
      ],
    })
    const { store, calls } = await openStoreWithApi(initial)
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    // The composite: board stops showing it first, then its file goes.
    act(() => { container.querySelector<HTMLButtonElement>('[data-seework-card="made"] button')!.click() })
    await act(async () => { await Promise.resolve() })
    expect(store.getSnapshot().board!.cards.map(card => card.id)).toEqual(['pic'])
    expect(calls).toEqual(['remove:made-0.png'])
    // The library picture: no delete call at all.
    act(() => { container.querySelector<HTMLButtonElement>('[data-seework-card="pic"] button')!.click() })
    await act(async () => { await Promise.resolve() })
    expect(calls).toEqual(['remove:made-0.png'])
    store.dispose()
  })

  it('cleans up unreferenced pictures through the toolbar, and reports it', async () => {
    const { store, calls, apiError } = await openStoreWithApi()
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === '清理无用图片')!
    act(() => { button.click() })
    await act(async () => { await Promise.resolve() })
    expect(calls).toEqual(['prune'])
    expect(container.textContent).toContain('已清理 2 张')
    expect(container.textContent).toContain('2.0 KB')

    // A refusal is surfaced instead of swallowed.
    apiError('接口不可达')
    act(() => { button.click() })
    await act(async () => { await Promise.resolve() })
    expect(container.textContent).toContain('清理失败：接口不可达')
    store.dispose()
  })

  it('fades the notice out instead of leaving it on the board forever', async () => {
    // User report: 「一直存在提示条，不消失」.
    vi.useFakeTimers()
    try {
      const { store } = await openStoreWithApi()
      act(() => {
        root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
      })
      const button = [...container.querySelectorAll('button')].find(item => item.textContent === '清理无用图片')!
      act(() => { button.click() })
      await act(async () => { await Promise.resolve() })
      expect(container.textContent).toContain('已清理 2 张')
      // A second action replaces the text rather than stacking two bars.
      act(() => { button.click() })
      await act(async () => { await Promise.resolve() })
      expect(container.textContent!.match(/已清理/g)).toHaveLength(1)
      act(() => { vi.advanceTimersByTime(NOTICE_MS + 1) })
      expect(container.textContent).not.toContain('已清理')
      store.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('puts the layer list away as soon as the board is touched', async () => {
    const { store } = await openStore()
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const surface = container.querySelector<HTMLElement>('[class*="surface"]')!
    act(() => { container.querySelector<HTMLButtonElement>('[data-dsh-seework-layers-toggle]')!.click() })
    expect(container.querySelector('[data-dsh-seework-layers]')).not.toBeNull()
    // Reading the list does not close it…
    act(() => { container.querySelector<HTMLElement>('[data-seework-layer-row="pic"]')!.dispatchEvent(pointer('pointerdown', 10, 10)) })
    expect(container.querySelector('[data-dsh-seework-layers]')).not.toBeNull()
    // …but pressing the board does.
    act(() => { surface.dispatchEvent(pointer('pointerdown', 500, 400)) })
    expect(container.querySelector('[data-dsh-seework-layers]')).toBeNull()
    store.dispose()
  })

  it('lists the cards as layers, top first, and picking one selects and raises it', async () => {
    // 'pic' starts at the bottom of the stack, 'note' on top of it.
    const { store } = await openStore()
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const toggle = container.querySelector<HTMLButtonElement>('[data-dsh-seework-layers-toggle]')!
    expect(container.querySelector('[data-dsh-seework-layers]')).toBeNull()
    act(() => { toggle.click() })
    const rows = [...container.querySelectorAll<HTMLElement>('[data-seework-layer-row]')]
    // Top of the stack is listed first, and numbered from 1.
    expect(rows.map(row => row.getAttribute('data-seework-layer-row'))).toEqual(['note', 'pic'])
    expect(rows[0]!.textContent).toContain('1')
    expect(rows[0]!.textContent).toContain('备注')

    // Picking the buried picture selects it and lifts it above everything.
    act(() => { rows[1]!.click() })
    const cards = store.getSnapshot().board!.cards
    const raised = cards.find(card => card.id === 'pic')!
    expect(Math.max(...cards.map(card => card.z))).toBe(raised.z)
    // The list re-orders to match, and the picked row is the marked one.
    const after = [...container.querySelectorAll<HTMLElement>('[data-seework-layer-row]')]
    expect(after.map(row => row.getAttribute('data-seework-layer-row'))).toEqual(['pic', 'note'])
    expect(after[0]!.getAttribute('data-seework-layer-active')).toBe('true')
    store.dispose()
  })

  it('brings a card that is off-screen into view when it is picked from the list', async () => {
    // 1200 board units to the right of the viewport, which is 900×600 at zoom 1.
    const { store } = await openStore(board({
      cards: [{ id: 'far', kind: 'image', x: 1200, y: 0, width: 200, height: 200, z: 1, file: `${BOARD_ID}-0.png` }],
    }))
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    act(() => { container.querySelector<HTMLButtonElement>('[data-dsh-seework-layers-toggle]')!.click() })
    act(() => { container.querySelector<HTMLElement>('[data-seework-layer-row="far"]')!.click() })
    // The card centre (1300, 100) is now the centre of the 900×600 stage.
    expect(store.getSnapshot().board!.viewport).toEqual({ x: 450 - 1300, y: 300 - 100, k: 1 })
    store.dispose()
  })

  it('removes a card from the board without touching the library', async () => {
    const { store } = await openStore()
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries: [] }} onNeedLibrary={() => {}} />)
    })
    const close = container.querySelector<HTMLButtonElement>('[data-seework-card="pic"] button')!
    act(() => { close.click() })
    expect(store.getSnapshot().board!.cards.map(card => card.id)).toEqual(['note'])
    store.dispose()
  })

  it('places a library picture at the centre of the view', async () => {
    const { store } = await openStore()
    const entries = [{
      id: 'entry-1',
      createdAt: 1,
      mode: 'text' as const,
      model: 'seedream-5-0-lite',
      prompt: '雪山',
      resolution: '2K',
      aspectRatio: '16:9',
      quality: '',
      outputFormat: 'png',
      n: 1,
      images: [{ url: '/api/dsh-seework/library/image/x-0.png', file: 'x-0.png', mime: 'image/png', width: 1024, height: 512 }],
      source: 'agent' as const,
    }]
    act(() => {
      root.render(<CanvasBoard store={store} library={{ entries }} onNeedLibrary={() => {}} />)
    })
    act(() => {
      const open = [...container.querySelectorAll('button')].find(item => item.textContent === '从素材库添加')!
      open.click()
    })
    const item = container.querySelector<HTMLButtonElement>('[class*="pickerItem"]')!
    act(() => { item.click() })
    const placed = store.getSnapshot().board!.cards.at(-1)!
    expect(placed.kind).toBe('image')
    expect(placed.file).toBe('x-0.png')
    expect(placed.model).toBe('seedream-5-0-lite')
    // 320 wide at the source aspect ratio (2:1) → 160 tall, centred on (450, 300).
    expect(placed.height).toBe(160)
    expect(placed.x).toBe(290)
    expect(placed.y).toBe(220)
    store.dispose()
  })
})

describe('CanvasBoardList', () => {
  it('lists boards, marks the open one, and creates a new one', async () => {
    const { store } = await openStore()
    await store.refreshList()
    act(() => {
      root.render(<CanvasBoardList store={store} />)
    })
    expect(container.textContent).toContain('测试画布')
    expect(container.textContent).toContain('2 个卡片')
    const create = [...container.querySelectorAll('button')].find(item => item.textContent === '新建')!
    act(() => { create.click() })
    store.dispose()
  })
})
