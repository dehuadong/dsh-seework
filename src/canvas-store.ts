/**
 * Canvas storage (host half): one JSON document per board under
 * `<data root>/canvas/`.
 *
 * The board model is spatial, not a node graph — cards are placed rectangles
 * and nothing connects them (see `docs/architecture.md`). That keeps the whole
 * document a plain JSON value, so saving is one atomic file write and two
 * windows editing the same board are reconciled by a revision fence instead of
 * a merge algorithm.
 */

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { CANVAS_MAX_BOARDS, CANVAS_MAX_CARDS, CANVAS_ZOOM_MAX, CANVAS_ZOOM_MIN } from './canvas-limits.ts'
import { CANVAS_FILE_PATTERN } from './canvas-assets.ts'
import { libraryDataRoot } from './library.ts'
import type { CanvasCard, CanvasDocument, CanvasListResult, CanvasSummary, CanvasViewport } from './protocol.ts'


/** Board coordinate range accepted from a client (keeps NaN/Infinity out). */
const CANVAS_COORD_LIMIT = 1_000_000

/** Card size range in board pixels. */
const CANVAS_CARD_MIN = 24
const CANVAS_CARD_MAX = 10_000

/** A save refused because the board moved since the caller read it. */
export class CanvasConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`画布已被其它窗口修改（期望版本 ${expected}，当前 ${actual}）。`)
    this.name = 'CanvasConflictError'
  }
}

/** A save or read refused because the input is unusable. */
export class CanvasInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanvasInputError'
  }
}

/** The directory boards live in (resolved per call, so a settings change applies). */
function canvasDir(): string {
  return path.join(libraryDataRoot(), 'canvas')
}

/** File name of one board, from its id. */
function boardPath(id: string): string {
  return path.join(canvasDir(), `${id}.json`)
}

/** Whether an id names a board the store could have written. */
export function isCanvasId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
}

/** Clamp a number into a range, rejecting non-finite input. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Clamp a viewport into the supported zoom range and coordinate space. */
export function normalizeViewport(value: unknown): CanvasViewport {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const k = Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, finite(raw.k, 1)))
  return {
    x: Math.min(CANVAS_COORD_LIMIT, Math.max(-CANVAS_COORD_LIMIT, finite(raw.x, 0))),
    y: Math.min(CANVAS_COORD_LIMIT, Math.max(-CANVAS_COORD_LIMIT, finite(raw.y, 0))),
    k: Math.round(k * 1000) / 1000,
  }
}

/**
 * Normalize one card, or drop it when it is unusable.
 *
 * A dropped card is the right failure mode for a board: a malformed card should
 * cost the user one card, not the whole document.
 */
export function normalizeCard(value: unknown): CanvasCard | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : undefined
  if (id === undefined) return undefined
  const kind = raw.kind === 'text' ? 'text' : raw.kind === 'image' ? 'image' : undefined
  if (kind === undefined) return undefined
  const size = (input: unknown, fallback: number): number =>
    Math.min(CANVAS_CARD_MAX, Math.max(CANVAS_CARD_MIN, finite(input, fallback)))
  const card: CanvasCard = {
    id,
    kind,
    x: Math.min(CANVAS_COORD_LIMIT, Math.max(-CANVAS_COORD_LIMIT, finite(raw.x, 0))),
    y: Math.min(CANVAS_COORD_LIMIT, Math.max(-CANVAS_COORD_LIMIT, finite(raw.y, 0))),
    width: size(raw.width, kind === 'image' ? 320 : 240),
    height: size(raw.height, kind === 'image' ? 320 : 120),
    z: finite(raw.z, 0),
  }
  if (kind === 'image') {
    // An image card with no file has nothing to render; the store refuses it
    // rather than writing a card that can never draw.
    if (typeof raw.file !== 'string' || raw.file === '') return undefined
    if (!CANVAS_FILE_PATTERN.test(raw.file)) {
      throw new CanvasInputError(`画布引用了非法的图片文件名：${raw.file}`)
    }
    card.file = raw.file
    // Absent means the material library, which is what every board written before
    // canvas-owned assets (annotations, crops) already means.
    card.source = raw.source === 'canvas' ? 'canvas' : 'library'
    card.origin = raw.origin === 'chat' || raw.origin === 'panel' || raw.origin === 'annotation' || raw.origin === 'crop'
      ? raw.origin
      : undefined
    if (typeof raw.model === 'string') card.model = raw.model.slice(0, 200)
    if (typeof raw.prompt === 'string') card.prompt = raw.prompt.slice(0, 4000)
  } else {
    card.text = typeof raw.text === 'string' ? raw.text.slice(0, 8000) : ''
    card.fontSize = Math.min(96, Math.max(8, finite(raw.fontSize, 16)))
  }
  return card
}

/** Build a document from untrusted input (a client save). */
export function normalizeDocument(value: unknown, previous: CanvasDocument): CanvasDocument {
  if (value === null || typeof value !== 'object') throw new CanvasInputError('画布数据不是对象。')
  const raw = value as Record<string, unknown>
  const rawCards = Array.isArray(raw.cards) ? raw.cards : []
  if (rawCards.length > CANVAS_MAX_CARDS) throw new CanvasInputError(`画布最多支持 ${CANVAS_MAX_CARDS} 个卡片。`)
  const cards: CanvasCard[] = []
  const seen = new Set<string>()
  for (const entry of rawCards) {
    const card = normalizeCard(entry)
    if (card === undefined || seen.has(card.id)) continue
    seen.add(card.id)
    cards.push(card)
  }
  const title = typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title.trim().slice(0, 120) : previous.title
  return {
    id: previous.id,
    title,
    revision: previous.revision,
    viewport: normalizeViewport(raw.viewport),
    cards,
    createdAt: previous.createdAt,
    updatedAt: previous.updatedAt,
  }
}

/** Project a document onto the list shape. */
function toSummary(document: CanvasDocument): CanvasSummary {
  return {
    id: document.id,
    title: document.title,
    revision: document.revision,
    cardCount: document.cards.length,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

/** Structural check for a document read back from disk. */
function isDocument(value: unknown): value is CanvasDocument {
  if (value === null || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return typeof raw.id === 'string'
    && typeof raw.title === 'string'
    && typeof raw.revision === 'number'
    && Array.isArray(raw.cards)
    && typeof raw.createdAt === 'number'
    && typeof raw.updatedAt === 'number'
}

/** Read one board file, tolerating a missing or corrupt document. */
async function readDocument(id: string): Promise<CanvasDocument | undefined> {
  if (!isCanvasId(id)) return undefined
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(boardPath(id), 'utf8'))
    if (!isDocument(parsed)) return undefined
    // Re-normalize on read too: a hand-edited file must not crash a board.
    const normalized = normalizeDocument(parsed, parsed)
    return { ...normalized, id: parsed.id, revision: parsed.revision, createdAt: parsed.createdAt, updatedAt: parsed.updatedAt }
  } catch {
    return undefined
  }
}

/** Write one document atomically. */
async function writeDocument(document: CanvasDocument): Promise<void> {
  await fs.mkdir(canvasDir(), { recursive: true })
  const target = boardPath(document.id)
  const tmp = `${target}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(document, null, 2), 'utf8')
  await fs.rename(tmp, target)
}

/**
 * Every canvas-owned picture that some board still shows.
 *
 * Used by the housekeeping routes: a picture is only deletable once no board
 * references it, so deleting a card and pruning the file behind it can never pull
 * a picture out from under a second board.
 *
 * @returns the set of referenced file names.
 */
export async function referencedCanvasFiles(): Promise<Set<string>> {
  const files = new Set<string>()
  let names: string[] = []
  try {
    names = await fs.readdir(canvasDir())
  } catch {
    return files
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const document = await readDocument(name.slice(0, -'.json'.length))
    if (document === undefined) continue
    for (const card of document.cards) {
      if (card.source === 'canvas' && card.file !== undefined) files.add(card.file)
    }
  }
  return files
}

/** Every board on disk, newest first. */
export async function listCanvases(): Promise<CanvasListResult> {
  let names: string[] = []
  try {
    names = await fs.readdir(canvasDir())
  } catch {
    names = []
  }
  const summaries: CanvasSummary[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const document = await readDocument(name.slice(0, -'.json'.length))
    if (document !== undefined) summaries.push(toSummary(document))
  }
  summaries.sort((left, right) => right.updatedAt - left.updatedAt)
  return { canvases: summaries.slice(0, CANVAS_MAX_BOARDS), dataRoot: libraryDataRoot() }
}

/** Create an empty board. */
export async function createCanvas(title?: string): Promise<CanvasDocument> {
  const now = Date.now()
  const document: CanvasDocument = {
    id: randomUUID(),
    title: title !== undefined && title.trim() !== '' ? title.trim().slice(0, 120) : '未命名画布',
    revision: 1,
    viewport: { x: 0, y: 0, k: 1 },
    cards: [],
    createdAt: now,
    updatedAt: now,
  }
  await writeDocument(document)
  await trimBoards()
  return document
}

/** Read one board. */
export async function readCanvas(id: string): Promise<CanvasDocument | undefined> {
  return readDocument(id)
}

/**
 * Save a board.
 * @param incoming - the client's document (its `revision` is ignored).
 * @param expectedRevision - the revision the client read; a mismatch refuses.
 * @returns the stored document (with the next revision).
 * @throws {CanvasConflictError} when the board moved on since the client read it.
 */
export async function saveCanvas(incoming: unknown, expectedRevision: number): Promise<CanvasDocument> {
  const raw = incoming !== null && typeof incoming === 'object' ? incoming as Record<string, unknown> : {}
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!isCanvasId(id)) throw new CanvasInputError('画布 id 不合法。')
  const previous = await readDocument(id)
  if (previous === undefined) throw new CanvasInputError('画布不存在。')
  if (previous.revision !== expectedRevision) throw new CanvasConflictError(expectedRevision, previous.revision)
  const next = normalizeDocument(raw, previous)
  const stored: CanvasDocument = {
    ...next,
    revision: previous.revision + 1,
    updatedAt: Date.now(),
  }
  await writeDocument(stored)
  return stored
}

/** Delete one board. */
export async function removeCanvas(id: string): Promise<CanvasListResult> {
  if (!isCanvasId(id)) throw new CanvasInputError('画布 id 不合法。')
  try {
    await fs.rm(boardPath(id), { force: true })
  } catch {
    // A missing file is the desired end state.
  }
  return listCanvases()
}

/** Drop the oldest boards past the retention cap. */
async function trimBoards(): Promise<void> {
  const { canvases } = await listCanvases()
  if (canvases.length <= CANVAS_MAX_BOARDS) return
  for (const stale of canvases.slice(CANVAS_MAX_BOARDS)) {
    try {
      await fs.rm(boardPath(stale.id), { force: true })
    } catch {
      // Best effort: retention never blocks a create.
    }
  }
}
