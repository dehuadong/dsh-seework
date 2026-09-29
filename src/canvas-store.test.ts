/**
 * Canvas store tests: one JSON document per board, saved atomically behind a
 * revision fence. The fence is the whole reason two windows can edit the same
 * board safely, so it gets the most attention here.
 */

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CanvasConflictError,
  CanvasInputError,
  createCanvas,
  isCanvasId,
  listCanvases,
  normalizeCard,
  normalizeViewport,
  readCanvas,
  removeCanvas,
  saveCanvas,
} from './canvas-store.ts'
import { CANVAS_MAX_CARDS, CANVAS_ZOOM_MAX, CANVAS_ZOOM_MIN } from './canvas-limits.ts'
import { libraryDataRoot, setLibraryDataRoot } from './library.ts'
import type { CanvasCard } from './protocol.ts'

/** A minimal valid image card. */
function imageCard(overrides: Partial<CanvasCard> = {}): CanvasCard {
  return {
    id: 'card-1',
    kind: 'image',
    x: 10,
    y: 20,
    width: 320,
    height: 240,
    z: 1,
    file: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-0.png',
    ...overrides,
  }
}

describe('isCanvasId', () => {
  it('accepts only the uuid shape the store writes', () => {
    expect(isCanvasId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(true)
    expect(isCanvasId('../../settings')).toBe(false)
    expect(isCanvasId('board.json')).toBe(false)
    expect(isCanvasId('')).toBe(false)
  })
})

describe('normalizeViewport', () => {
  it('clamps zoom and rejects non-finite numbers', () => {
    expect(normalizeViewport({ x: 5, y: -5, k: 99 })).toEqual({ x: 5, y: -5, k: CANVAS_ZOOM_MAX })
    expect(normalizeViewport({ k: 0.0001 })).toEqual({ x: 0, y: 0, k: CANVAS_ZOOM_MIN })
    expect(normalizeViewport({ x: Number.NaN, y: Number.POSITIVE_INFINITY, k: Number.NaN })).toEqual({ x: 0, y: 0, k: 1 })
    expect(normalizeViewport(undefined)).toEqual({ x: 0, y: 0, k: 1 })
  })
})

describe('normalizeCard', () => {
  it('keeps a well-formed image card', () => {
    const card = normalizeCard(imageCard())
    expect(card).toMatchObject({ id: 'card-1', kind: 'image', width: 320, height: 240 })
  })

  it('drops cards with no id or unknown kind', () => {
    expect(normalizeCard({ kind: 'image', file: 'x-0.png' })).toBeUndefined()
    expect(normalizeCard({ id: 'a', kind: 'video' })).toBeUndefined()
    expect(normalizeCard(null)).toBeUndefined()
  })

  it('drops an image card with no file (nothing to render)', () => {
    expect(normalizeCard({ id: 'a', kind: 'image' })).toBeUndefined()
    expect(normalizeCard({ id: 'a', kind: 'image', file: '' })).toBeUndefined()
  })

  it('refuses a file name that is not a library file', () => {
    // A board referencing anything else would be a path into the host.
    expect(() => normalizeCard({ id: 'a', kind: 'image', file: '../../settings.yaml' })).toThrow(CanvasInputError)
    expect(() => normalizeCard({ id: 'a', kind: 'image', file: '/etc/passwd' })).toThrow(CanvasInputError)
  })

  it('clamps card geometry instead of trusting the client', () => {
    const card = normalizeCard(imageCard({ width: 1, height: 999999 }))
    expect(card?.width).toBe(24)
    expect(card?.height).toBe(10_000)
  })

  it('gives a text card a body and a font size', () => {
    const card = normalizeCard({ id: 't', kind: 'text', text: '备注', fontSize: 999 })
    expect(card).toMatchObject({ id: 't', kind: 'text', text: '备注', fontSize: 96 })
  })
})

describe('canvas store', () => {
  let root: string
  const previous = libraryDataRoot()

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'dsh-seework-canvas-'))
    setLibraryDataRoot(root)
  })

  afterEach(async () => {
    setLibraryDataRoot(previous === '' ? undefined : previous)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('creates an empty board and lists it', async () => {
    const created = await createCanvas('我的画布')
    expect(created.revision).toBe(1)
    expect(created.cards).toEqual([])
    expect(created.title).toBe('我的画布')

    const listing = await listCanvases()
    expect(listing.canvases).toHaveLength(1)
    expect(listing.canvases[0]).toMatchObject({ id: created.id, title: '我的画布', revision: 1, cardCount: 0 })
    expect(listing.dataRoot).toBe(root)
  })

  it('names a board when the caller does not', async () => {
    expect((await createCanvas()).title).toBe('未命名画布')
    expect((await createCanvas('   ')).title).toBe('未命名画布')
  })

  it('reads back exactly what was saved', async () => {
    const created = await createCanvas()
    const saved = await saveCanvas({
      id: created.id,
      title: '板子',
      viewport: { x: -120, y: 40, k: 1.5 },
      cards: [imageCard({ id: 'a' }), { id: 'b', kind: 'text', x: 0, y: 0, width: 200, height: 80, z: 2, text: '说明' }],
    }, created.revision)

    expect(saved.revision).toBe(2)
    expect(saved.viewport).toEqual({ x: -120, y: 40, k: 1.5 })
    expect(saved.cards.map(card => card.id)).toEqual(['a', 'b'])

    const reread = await readCanvas(created.id)
    expect(reread?.cards).toHaveLength(2)
    expect(reread?.title).toBe('板子')
    expect(reread?.revision).toBe(2)
  })

  it('refuses a save built on a stale revision', async () => {
    const created = await createCanvas()
    await saveCanvas({ id: created.id, viewport: { x: 0, y: 0, k: 1 }, cards: [] }, created.revision)
    // Second writer still holds revision 1.
    await expect(saveCanvas({ id: created.id, viewport: { x: 0, y: 0, k: 1 }, cards: [] }, created.revision))
      .rejects.toThrow(CanvasConflictError)
    // The stored board is untouched by the refused write.
    expect((await readCanvas(created.id))?.revision).toBe(2)
  })

  it('reports the actual revision on a conflict', async () => {
    const created = await createCanvas()
    await saveCanvas({ id: created.id, viewport: { x: 0, y: 0, k: 1 }, cards: [] }, 1)
    await saveCanvas({ id: created.id, viewport: { x: 0, y: 0, k: 1 }, cards: [] }, 2)
    try {
      await saveCanvas({ id: created.id, viewport: { x: 0, y: 0, k: 1 }, cards: [] }, 1)
      expect.unreachable('a stale save must be refused')
    } catch (error) {
      expect(error).toBeInstanceOf(CanvasConflictError)
      expect((error as CanvasConflictError).actual).toBe(3)
      expect((error as CanvasConflictError).expected).toBe(1)
    }
  })

  it('refuses an unknown or malformed board id', async () => {
    await expect(saveCanvas({ id: 'nope', viewport: { x: 0, y: 0, k: 1 }, cards: [] }, 1)).rejects.toThrow(CanvasInputError)
    await expect(saveCanvas({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', viewport: { x: 0, y: 0, k: 1 }, cards: [] }, 1)).rejects.toThrow(CanvasInputError)
    expect(await readCanvas('../../settings')).toBeUndefined()
  })

  it('drops unusable cards but keeps the good ones', async () => {
    const created = await createCanvas()
    const saved = await saveCanvas({
      id: created.id,
      viewport: { x: 0, y: 0, k: 1 },
      cards: [
        imageCard({ id: 'good' }),
        { id: 'no-kind' },
        { id: 'no-file', kind: 'image' },
        { id: 'good', kind: 'text', text: 'duplicate id' },
        'not an object',
      ],
    }, created.revision)
    expect(saved.cards.map(card => card.id)).toEqual(['good'])
  })

  it('refuses a save that points a card outside the library', async () => {
    // Dropping the card silently would hide a client bug; the file name is the
    // one field a board must never get wrong.
    const created = await createCanvas()
    await expect(saveCanvas({
      id: created.id,
      viewport: { x: 0, y: 0, k: 1 },
      cards: [{ id: 'bad-file', kind: 'image', file: 'x.png' }],
    }, created.revision)).rejects.toThrow(CanvasInputError)
  })

  it('refuses a board past the card cap', async () => {
    const created = await createCanvas()
    const cards = Array.from({ length: CANVAS_MAX_CARDS + 1 }, (_, index) => imageCard({ id: `card-${index}` }))
    await expect(saveCanvas({ id: created.id, viewport: { x: 0, y: 0, k: 1 }, cards }, created.revision))
      .rejects.toThrow(CanvasInputError)
  })

  it('keeps the previous title when a save omits it', async () => {
    const created = await createCanvas('保留标题')
    const saved = await saveCanvas({ id: created.id, viewport: { x: 0, y: 0, k: 1 }, cards: [] }, created.revision)
    expect(saved.title).toBe('保留标题')
  })

  it('removes a board and its file', async () => {
    const created = await createCanvas()
    const file = path.join(root, 'canvas', `${created.id}.json`)
    await expect(fs.access(file)).resolves.toBeUndefined()
    const listing = await removeCanvas(created.id)
    expect(listing.canvases).toHaveLength(0)
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('survives a corrupt board file', async () => {
    const created = await createCanvas()
    await fs.writeFile(path.join(root, 'canvas', `${created.id}.json`), '{ not json', 'utf8')
    expect(await readCanvas(created.id)).toBeUndefined()
    // …and the list still answers instead of failing.
    await expect(listCanvases()).resolves.toMatchObject({ canvases: [] })
  })

  it('ignores a save that is not an object', async () => {
    const created = await createCanvas()
    await expect(saveCanvas(null, created.revision)).rejects.toThrow(CanvasInputError)
    await expect(saveCanvas('nope', created.revision)).rejects.toThrow(CanvasInputError)
  })

  it('lists boards newest-updated first', async () => {
    const first = await createCanvas('第一个')
    await new Promise(resolve => { setTimeout(resolve, 5) })
    const second = await createCanvas('第二个')
    await saveCanvas({ id: first.id, viewport: { x: 0, y: 0, k: 1 }, cards: [] }, first.revision)
    const listing = await listCanvases()
    expect(listing.canvases[0]?.id).toBe(first.id)
    expect(listing.canvases[1]?.id).toBe(second.id)
  })
})
