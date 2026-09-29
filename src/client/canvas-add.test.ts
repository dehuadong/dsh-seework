/**
 * @vitest-environment jsdom
 *
 * 「加到画布」 controller tests.
 *
 * The user asked for the deliberate version of a feature that used to be
 * automatic: one click places THIS picture and brings the canvas up so the result
 * is visible. What matters is therefore the order (a board exists → the canvas is
 * revealed → a measurable stage → the card lands in the middle → it is saved) and
 * that the picture's own aspect ratio and library metadata survive.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { CanvasCard, CanvasDocument, LibraryEntry, LibraryImageRef } from '../protocol.ts'
import { ASSUMED_STAGE } from '../canvas-placement.ts'
import { screenToBoard } from '../canvas-viewport.ts'
import {
  addToCanvas,
  canvasAddAvailable,
  createCanvasAddFace,
  libraryFileFromUrl,
  setCanvasAddFace,
  type CanvasAddTarget,
} from './canvas-add.ts'
import type { CanvasStore } from './canvas-store.ts'
import type { LibraryStore } from './library-store.ts'

/** One library image record. */
function image(overrides: Partial<LibraryImageRef> = {}): LibraryImageRef {
  return { file: 'entry-1-0.png', url: '/api/dsh-seework/library/image/entry-1-0.png', mime: 'image/png', width: 1536, height: 864, ...overrides }
}

/** One library entry. */
function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: 'entry-1',
    createdAt: 1,
    mode: 'text',
    model: 'gpt-image-2',
    prompt: '一只戴草帽的橘猫',
    resolution: '1K',
    aspectRatio: '16:9',
    quality: '',
    outputFormat: 'png',
    n: 1,
    source: 'agent',
    images: [image()],
    ...overrides,
  }
}

/** One board document. */
function board(overrides: Partial<CanvasDocument> = {}): CanvasDocument {
  return {
    id: 'board-1',
    title: '板',
    revision: 1,
    viewport: { x: 0, y: 0, k: 1 },
    cards: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

/** A controller harness with both stores faked and every step recorded. */
function harness(options: {
  board?: CanvasDocument | undefined
  boards?: Array<{ id: string }>
  entries?: LibraryEntry[]
  stage?: { width: number; height: number }
  openResult?: CanvasDocument | undefined
} = {}): {
  face: ReturnType<typeof createCanvasAddFace>
  events: string[]
  cards: () => CanvasCard[]
} {
  const events: string[] = []
  let currentBoard = options.board
  let cards: CanvasCard[] = []
  const canvas = {
    getSnapshot: () => ({
      status: 'ready' as const,
      board: currentBoard,
      boards: (options.boards ?? (currentBoard === undefined ? [] : [{ id: currentBoard.id }])) as never,
      dirty: false,
    }),
    refreshList: async (): Promise<void> => { events.push('refreshList') },
    open: async (): Promise<CanvasDocument | undefined> => {
      events.push('open')
      // An explicitly undefined `openResult` means "opening a board fails".
      currentBoard = Object.hasOwn(options, 'openResult') ? options.openResult : board()
      return currentBoard
    },
    addCards: (added: CanvasCard[]): void => { events.push('addCards'); cards = [...cards, ...added] },
    saveNow: async (): Promise<void> => { events.push('saveNow') },
  } as unknown as CanvasStore
  const library = {
    getSnapshot: () => ({ entries: options.entries ?? [entry()] }),
  } as unknown as LibraryStore

  return {
    face: createCanvasAddFace({
      library,
      canvas,
      reveal: () => { events.push('reveal') },
      stageSize: () => options.stage ?? { width: 800, height: 600 },
      sleep: async () => {},
    }),
    events,
    cards: () => cards,
  }
}

const TARGET: CanvasAddTarget = { file: 'entry-1-0.png' }

afterEach(() => {
  setCanvasAddFace(undefined)
})

describe('createCanvasAddFace', () => {
  it('reveals the canvas, places the picture in the middle of the visible stage, and saves', async () => {
    const test = harness({ board: board() })
    expect(await test.face.add(TARGET)).toBe(true)
    // Reveal comes before placing: only a board that is up can report its size.
    expect(test.events).toEqual(['reveal', 'addCards', 'saveNow'])

    const card = test.cards()[0]!
    expect(card.kind).toBe('image')
    expect(card.file).toBe('entry-1-0.png')
    // Model and prompt come from the library record, so the board card can show them.
    expect(card.model).toBe('gpt-image-2')
    expect(card.prompt).toContain('橘猫')
    // …and so does where it came from: this entry was generated in a conversation.
    expect(card.origin).toBe('chat')

    // Centred on the stage middle, sized to the picture's own 16:9 ratio.
    const centre = screenToBoard({ x: 0, y: 0, k: 1 }, 400, 300)
    expect(card.x + card.width / 2).toBeCloseTo(centre.x, 5)
    expect(card.y + card.height / 2).toBeCloseTo(centre.y, 5)
    expect(card.width / card.height).toBeCloseTo(1536 / 864, 2)
  })

  it('marks a panel-generated picture as such, and takes an explicit origin as final', async () => {
    const fromPanel = harness({ board: board(), entries: [entry({ source: 'panel' })] })
    expect(await fromPanel.face.add(TARGET)).toBe(true)
    expect(fromPanel.cards()[0]!.origin).toBe('panel')

    const stated = harness({ board: board() })
    expect(await stated.face.add({ ...TARGET, origin: 'crop' })).toBe(true)
    expect(stated.cards()[0]!.origin).toBe('crop')
  })

  it('creates a board when the user has none open yet', async () => {
    const test = harness({ board: undefined })
    expect(await test.face.add(TARGET)).toBe(true)
    expect(test.events).toEqual(['refreshList', 'open', 'reveal', 'addCards', 'saveNow'])
  })

  it('does not disturb the list when a board is already open', async () => {
    const test = harness({ board: board() })
    await test.face.add(TARGET)
    expect(test.events).not.toContain('refreshList')
    expect(test.events).not.toContain('open')
  })

  it('falls back to an assumed stage rather than the viewport corner', async () => {
    // A board that never becomes measurable must not put the picture at (0,0).
    const test = harness({ board: board(), stage: { width: 0, height: 0 } })
    await test.face.add(TARGET)
    const card = test.cards()[0]!
    const centre = screenToBoard({ x: 0, y: 0, k: 1 }, ASSUMED_STAGE.width / 2, ASSUMED_STAGE.height / 2)
    expect(card.x + card.width / 2).toBeCloseTo(centre.x, 5)
    expect(card.x).toBeGreaterThan(0)
  })

  it('places a picture the library does not know about', async () => {
    // Nothing to enrich from: the card is still placed, square, with no metadata.
    const test = harness({ board: board(), entries: [] })
    expect(await test.face.add({ file: 'unknown-0.png' })).toBe(true)
    const card = test.cards()[0]!
    expect(card.file).toBe('unknown-0.png')
    expect(card.width).toBe(card.height)
    expect(card.model).toBe('')
  })

  it('reports failure when no board can be opened', async () => {
    const test = harness({ board: undefined, openResult: undefined })
    expect(await test.face.add(TARGET)).toBe(false)
    expect(test.events).not.toContain('addCards')
  })
})

describe('the shared face', () => {
  it('is unavailable until the composition root installs one', () => {
    expect(canvasAddAvailable()).toBe(false)
    const restore = setCanvasAddFace({ add: async () => true })
    expect(canvasAddAvailable()).toBe(true)
    restore()
    expect(canvasAddAvailable()).toBe(false)
  })

  it('swallows a failure: the picture stays in the library, which is where it already is', async () => {
    setCanvasAddFace({ add: async () => { throw new Error('no board') } })
    expect(() => { addToCanvas(TARGET) }).not.toThrow()
    await Promise.resolve()
  })

  it('does nothing at all without a face', () => {
    expect(() => { addToCanvas(TARGET) }).not.toThrow()
  })
})

describe('libraryFileFromUrl', () => {
  it('reads the file a library image URL serves', () => {
    expect(libraryFileFromUrl('/api/dsh-seework/library/image/entry-1-0.png')).toBe('entry-1-0.png')
    expect(libraryFileFromUrl('http://127.0.0.1:3080/api/dsh-seework/library/image/a%20b.png?x=1')).toBe('a b.png')
  })

  it('ignores anything that is not a library image', () => {
    expect(libraryFileFromUrl('/api/dsh-seework/attachment/image?attachment_id=x')).toBeUndefined()
    expect(libraryFileFromUrl('https://example.test/photo.png')).toBeUndefined()
    expect(libraryFileFromUrl('/api/dsh-seework/library/image/')).toBeUndefined()
  })
})
