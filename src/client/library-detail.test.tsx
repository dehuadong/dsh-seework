/**
 * @vitest-environment jsdom
 *
 * Render smoke test for the material detail overlay: it is the destructive
 * surface (delete removes files from disk), so its confirm flow and its
 * behaviour when the entry disappears underneath it both need pinning.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryEntry } from '../protocol.ts'
import type { SeeWorkApi } from './api.ts'
import { setCanvasAddFace } from './canvas-add.ts'
import { setComposerFace, setComposerProbe } from './composer-draft.ts'
import { LibraryStore } from './library-store.ts'
import { LibraryDetail } from './library-detail.tsx'

/** One entry with two images, so paging is exercised. */
function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: 'entry-1',
    createdAt: Date.parse('2026-09-16T10:00:00'),
    mode: 'edit',
    model: 'gpt-image-2',
    prompt: '把天空换成星空',
    resolution: '2K',
    aspectRatio: '16:9',
    quality: 'high',
    outputFormat: 'png',
    n: 2,
    images: [
      { url: '/api/dsh-seework/library/image/entry-1-0.png', file: 'entry-1-0.png', mime: 'image/png', width: 64, height: 32 },
      { url: '/api/dsh-seework/library/image/entry-1-1.png', file: 'entry-1-1.png', mime: 'image/png', width: 64, height: 32 },
    ],
    cost: 0.44,
    refNames: ['上一张图'],
    source: 'agent',
    ...overrides,
  }
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
  setCanvasAddFace(undefined)
  container.remove()
  vi.restoreAllMocks()
})

/** A store over a stub client whose single entry can be deleted. */
async function storeWith(item: LibraryEntry): Promise<{ store: LibraryStore; removed: string[] }> {
  const removed: string[] = []
  let entries = [item]
  const api = {
    library: async () => ({ ok: true as const, value: { entries, total: entries.length, imageCount: entries.length, dataRoot: '/tmp/lib' } }),
    removeEntry: async (id: string) => {
      removed.push(id)
      entries = entries.filter(candidate => candidate.id !== id)
      return { ok: true as const, value: { entries } }
    },
  } as unknown as SeeWorkApi
  const store = new LibraryStore(api)
  await store.refresh()
  return { store, removed }
}

describe('LibraryDetail', () => {
  it('renders the images, the full prompt and the generation parameters', async () => {
    const { store } = await storeWith(entry())
    act(() => {
      root.render(<LibraryDetail store={store} entryId="entry-1" onClose={() => {}} />)
    })
    const text = container.textContent ?? ''
    expect(text).toContain('把天空换成星空')
    expect(text).toContain('gpt-image-2')
    expect(text).toContain('2K')
    expect(text).toContain('16:9')
    // #661: the quality row is gone (the value stays in the record, unshown),
    // and the detail shows the picture's pixel size instead.
    expect(text).not.toContain('画质')
    expect(text).not.toContain('high')
    expect(text).toContain('64 × 32 像素')
    expect(text).toContain('¥0.44')
    expect(text).toContain('上一张图')
    expect(text).toContain('entry-1-0.png')
    expect(text).toContain('entry-1-1.png')
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  it('pages through the images of one entry', async () => {
    const { store } = await storeWith(entry())
    act(() => {
      root.render(<LibraryDetail store={store} entryId="entry-1" onClose={() => {}} />)
    })
    const next = [...container.querySelectorAll('button')].find(button => button.textContent === '→')
    expect(next).toBeDefined()
    act(() => { next!.click() })
    expect(container.textContent).toContain('2 / 2')
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toContain('entry-1-1.png')
  })

  it('shows 未知 for the size when the record carries no pixel dimensions (#661)', async () => {
    // An old or hand-written index row can lack the size: the row must still
    // render, saying honestly that the size is unknown rather than showing a hole.
    const { store } = await storeWith(entry({
      images: [{ url: '/api/dsh-seework/library/image/entry-1-0.png', file: 'entry-1-0.png', mime: 'image/png' }],
    }))
    act(() => {
      root.render(<LibraryDetail store={store} entryId="entry-1" onClose={() => {}} />)
    })
    const text = container.textContent ?? ''
    expect(text).toContain('尺寸')
    expect(text).toContain('未知')
  })

  it('follows the picture on screen when the entry has several sizes (#661)', async () => {
    const { store } = await storeWith(entry({
      images: [
        { url: '/api/dsh-seework/library/image/entry-1-0.png', file: 'entry-1-0.png', mime: 'image/png', width: 64, height: 32 },
        { url: '/api/dsh-seework/library/image/entry-1-1.png', file: 'entry-1-1.png', mime: 'image/png', width: 128, height: 96 },
      ],
    }))
    act(() => {
      root.render(<LibraryDetail store={store} entryId="entry-1" onClose={() => {}} />)
    })
    expect(container.textContent).toContain('64 × 32 像素')
    const next = [...container.querySelectorAll('button')].find(button => button.textContent === '→')
    act(() => { next!.click() })
    expect(container.textContent).toContain('128 × 96 像素')
  })

  it('copies the prompt and reports it', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { store } = await storeWith(entry())
    act(() => {
      root.render(<LibraryDetail store={store} entryId="entry-1" onClose={() => {}} />)
    })
    const copy = [...container.querySelectorAll('button')].find(button => button.textContent === '复制提示词')
    expect(copy).toBeDefined()
    // The prompt itself is not a control: the copy action has to be its own
    // button, sitting on the section header rather than under the text.
    expect(copy!.tagName).toBe('BUTTON')
    expect(container.querySelector('pre')?.textContent).toBe('把天空换成星空')
    await act(async () => { copy!.click() })
    expect(writeText).toHaveBeenCalledWith('把天空换成星空')
    expect(container.textContent).toContain('已复制')
  })

  it('puts the picture on screen onto the canvas', async () => {
    const added: Array<{ file: string; prompt?: string | undefined }> = []
    const restore = setCanvasAddFace({
      add: async target => { added.push({ file: target.file, prompt: target.prompt }); return true },
    })
    try {
      const { store } = await storeWith(entry())
      act(() => {
        root.render(<LibraryDetail store={store} entryId="entry-1" onClose={() => {}} />)
      })
      const button = container.querySelector<HTMLButtonElement>('[data-dsh-seework-add-to-canvas]')
      expect(button).not.toBeNull()
      act(() => { button!.click() })
      // The FIRST image is on screen; paging changes which one the action places.
      expect(added).toEqual([{ file: 'entry-1-0.png', prompt: '把天空换成星空' }])

      const next = [...container.querySelectorAll('button')].find(candidate => candidate.textContent === '→')
      act(() => { next!.click() })
      act(() => { container.querySelector<HTMLButtonElement>('[data-dsh-seework-add-to-canvas]')!.click() })
      expect(added[1]?.file).toBe('entry-1-1.png')
    } finally {
      restore()
    }
  })

  it('offers no canvas action when there is no canvas to add to', async () => {
    const { store } = await storeWith(entry())
    act(() => {
      root.render(<LibraryDetail store={store} entryId="entry-1" onClose={() => {}} />)
    })
    expect(container.querySelector('[data-dsh-seework-add-to-canvas]')).toBeNull()
  })

  it('offers 「加入到对话框」 only while a session-scope tab is mounted', async () => {
    const { store } = await storeWith(entry())
    const created: string[] = []
    const restoreService = setComposerProbe(() => ({
      createDrafts: (_sessionId: string, files: readonly File[]) => {
        created.push(...files.map(file => file.name))
        return files.map((_file, index) => ({ id: `draft-${index}` }))
      },
      releaseDraftAttachments: () => {},
    }))
    const added: string[][] = []
    const restoreFace = setComposerFace({
      sessionId: 'session-1',
      input: { addAttachments: ids => { added.push([...ids]); return true } },
    })
    try {
      act(() => {
        root.render(<LibraryDetail store={store} entryId="entry-1" onClose={() => {}} />)
      })
      const button = container.querySelector<HTMLButtonElement>('[data-dsh-seework-add-to-composer]')
      expect(button).not.toBeNull()
      // The bytes come from the picture's own route, so it must be fetched.
      vi.stubGlobal('fetch', async () => new Response(
        new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        { status: 200, headers: { 'content-type': 'image/png' } },
      ))
      await act(async () => { button!.click() })
      expect(created).toEqual(['entry-1-0.png'])
      expect(added).toEqual([['draft-0']])
      expect(container.textContent).toContain('已放进输入框')
    } finally {
      restoreFace()
      restoreService()
      vi.unstubAllGlobals()
    }
  })

  it('hides 「加入到对话框」 with no session scope (the floating drawer)', async () => {
    const { store } = await storeWith(entry())
    act(() => {
      root.render(<LibraryDetail store={store} entryId="entry-1" onClose={() => {}} />)
    })
    expect(container.querySelector('[data-dsh-seework-add-to-composer]')).toBeNull()
  })

  it('asks before deleting, then removes the entry and closes', async () => {
    const { store, removed } = await storeWith(entry())
    const closed: string[] = []
    act(() => {
      root.render(<LibraryDetail store={store} entryId="entry-1" onClose={() => { closed.push('closed') }} />)
    })
    const del = [...container.querySelectorAll('button')].find(button => button.textContent === '删除这条记录')
    expect(del).toBeDefined()
    act(() => { del!.click() })
    // First click only asks; nothing is deleted yet.
    expect(removed).toEqual([])
    expect(container.textContent).toContain('确定删除')

    const confirm = [...container.querySelectorAll('button')].find(button => button.textContent === '确定删除')
    await act(async () => { confirm!.click() })
    expect(removed).toEqual(['entry-1'])
    expect(closed).toEqual(['closed'])
  })

  it('stays quiet when the entry is gone (deleted elsewhere)', async () => {
    const { store } = await storeWith(entry())
    act(() => {
      root.render(<LibraryDetail store={store} entryId="entry-1" onClose={() => {}} />)
    })
    await act(async () => { await store.remove('entry-1') })
    expect(container.textContent).toBe('')
  })

  it('closes on Escape', async () => {
    const { store } = await storeWith(entry())
    const closed: string[] = []
    act(() => {
      root.render(<LibraryDetail store={store} entryId="entry-1" onClose={() => { closed.push('closed') }} />)
    })
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(closed).toEqual(['closed'])
  })
})
