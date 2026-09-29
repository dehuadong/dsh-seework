/**
 * @vitest-environment jsdom
 *
 * Render smoke test for the library drawer: the panel is what the user actually
 * sees, and a crashing render (bad hook order, missing key, undefined field)
 * would blank the sidebar rather than fail a unit assertion.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryEntry } from '../protocol.ts'
import type { SeeWorkApi } from './api.ts'
import { setCanvasAddFace } from './canvas-add.ts'
import { LibraryStore } from './library-store.ts'
import { LibraryPanel } from './LibraryPanel.tsx'

/** One entry the panel can render. */
function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: 'entry-1',
    createdAt: Date.parse('2026-09-16T10:00:00'),
    mode: 'text',
    model: 'seedream-5-0-lite',
    prompt: '雪山下的木屋，黄昏',
    resolution: '2K',
    aspectRatio: '16:9',
    quality: '',
    outputFormat: 'png',
    n: 1,
    images: [{ url: '/api/dsh-seework/library/image/entry-1-0.png', file: 'entry-1-0.png', mime: 'image/png', width: 64, height: 32 }],
    cost: 0.22,
    source: 'agent',
    ...overrides,
  }
}

/** A store pre-loaded with the given entries (no network involved). */
async function loadedStore(entries: LibraryEntry[]): Promise<LibraryStore> {
  const api = {
    library: async () => ({ ok: true as const, value: { entries, total: entries.length, imageCount: entries.length, dataRoot: '/tmp/lib' } }),
  } as unknown as SeeWorkApi
  const store = new LibraryStore(api)
  await store.refresh()
  return store
}

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
  vi.restoreAllMocks()
})

describe('LibraryPanel', () => {
  it('renders the entries grouped by day with their metadata', async () => {
    const store = await loadedStore([
      entry({ id: 'a', prompt: '雪山下的木屋，黄昏' }),
      entry({ id: 'b', prompt: '赛博城市夜景', model: 'gpt-image-2', source: 'panel', cost: undefined }),
    ])
    act(() => {
      root.render(<LibraryPanel store={store} onClose={() => {}} onOpen={() => {}} />)
    })
    const text = container.textContent ?? ''
    expect(text).toContain('SeeWork 素材库')
    expect(text).toContain('雪山下的木屋，黄昏')
    expect(text).toContain('赛博城市夜景')
    expect(text).toContain('seedream-5-0-lite')
    expect(text).toContain('gpt-image-2')
    expect(text).toContain('¥0.22')
    expect(text).toContain('对话')
    expect(text).toContain('面板')
    expect(container.querySelectorAll('img')).toHaveLength(2)
  })

  it('filters what is rendered when the search box changes', async () => {
    const store = await loadedStore([
      entry({ id: 'a', prompt: '雪山下的木屋' }),
      entry({ id: 'b', prompt: '赛博城市夜景' }),
    ])
    act(() => {
      root.render(<LibraryPanel store={store} onClose={() => {}} onOpen={() => {}} />)
    })
    const search = container.querySelector<HTMLInputElement>('input[placeholder="搜索提示词…"]')
    expect(search).not.toBeNull()
    act(() => {
      // React tracks a controlled input's value itself; assigning through the
      // DOM setter and then dispatching `input` is what a real keystroke does.
      // (React's own `act` has no event helper — that lives in testing-library.)
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setValue.call(search!, '赛博')
      search!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const text = container.textContent ?? ''
    expect(text).toContain('赛博城市夜景')
    expect(text).not.toContain('雪山下的木屋')
  })

  it('opens an entry when its card is clicked', async () => {
    const store = await loadedStore([entry({ id: 'a' })])
    const opened: string[] = []
    act(() => {
      root.render(<LibraryPanel store={store} onClose={() => {}} onOpen={id => { opened.push(id) }} />)
    })
    const thumb = container.querySelector<HTMLButtonElement>('button[title="查看大图"]')
    expect(thumb).not.toBeNull()
    act(() => { thumb!.click() })
    expect(opened).toEqual(['a'])
  })

  it('explains an empty library instead of rendering nothing', async () => {
    const store = await loadedStore([])
    act(() => {
      root.render(<LibraryPanel store={store} onClose={() => {}} onOpen={() => {}} />)
    })
    expect(container.textContent ?? '').toContain('还没有生成过图片')
  })

  it('puts the picture a card shows onto the canvas', async () => {
    const added: string[] = []
    const restore = setCanvasAddFace({
      add: async target => { added.push(target.file); return true },
    })
    try {
      const store = await loadedStore([entry({ id: 'a', images: [{ url: '/x.png', file: 'a-0.png', mime: 'image/png', width: 64, height: 32 }] })])
      act(() => {
        root.render(<LibraryPanel store={store} onClose={() => {}} onOpen={() => {}} />)
      })
      const button = container.querySelector<HTMLButtonElement>('[data-dsh-seework-add-to-canvas]')
      expect(button).not.toBeNull()
      act(() => { button!.click() })
      expect(added).toEqual(['a-0.png'])
      // The card's other controls still work: this is a sibling, not a hijack.
      expect(container.querySelector('button[title="查看大图"]')).not.toBeNull()
    } finally {
      restore()
    }
  })

  it('offers no canvas action when there is no canvas to add to', async () => {
    const store = await loadedStore([entry({ id: 'a' })])
    act(() => {
      root.render(<LibraryPanel store={store} onClose={() => {}} onOpen={() => {}} />)
    })
    expect(container.querySelector('[data-dsh-seework-add-to-canvas]')).toBeNull()
  })

  it('keeps the last list on screen while reporting a read failure', async () => {
    const entries = [entry({ id: 'a' })]
    let failing = false
    const api = {
      library: async () => failing
        ? { ok: false as const, code: 'internal', message: '设置接口不可达' }
        : { ok: true as const, value: { entries, total: 1, imageCount: 1, dataRoot: '/tmp/lib' } },
    } as unknown as SeeWorkApi
    const store = new LibraryStore(api)
    await store.refresh()
    failing = true
    await store.refresh()

    act(() => {
      root.render(<LibraryPanel store={store} onClose={() => {}} onOpen={() => {}} />)
    })
    const text = container.textContent ?? ''
    expect(text).toContain('设置接口不可达')
    expect(text).toContain('雪山下的木屋')
  })
})
