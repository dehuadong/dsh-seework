/**
 * The SeeWork material library (host half): every image this plugin generates
 * is written under the plugin data root and indexed in `index.json`, so the
 * sidebar library (phase 2) and the canvas (phase 3) read the same records the
 * conversation produced. Images live as files and are served back through the
 * `library/image` prefix route — list responses carry metadata only, never
 * base64.
 *
 * Framework-free (node:fs + node:crypto only) so the route layer and the
 * generation runtime can both drive it directly.
 */

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  DEFAULT_DATA_DIR_NAME,
  LIBRARY_API,
  type GenerateRequest,
  type GeneratedImage,
  type LibraryEntry,
  type LibraryHead,
  type LibraryImageRef,
  type LibraryListResult,
} from './protocol.ts'

/** Default data root: `<DSH_HOME|~/.dsh>/dsh-seework`. */
function defaultDataRoot(): string {
  const home = process.env.DSH_HOME?.trim()
  return path.join(home !== undefined && home !== '' ? home : path.join(homedir(), '.dsh'), DEFAULT_DATA_DIR_NAME)
}

let dataRoot = defaultDataRoot()

/** The directory every library image and its index live under. */
export function libraryDataRoot(): string {
  return dataRoot
}

/**
 * Point the library at another root (settings `dataDir`; empty restores the
 * default). The host half calls this on every settings resolution, so an
 * unchanged value is a no-op and never disturbs in-flight writes.
 */
export function setLibraryDataRoot(value: string | undefined): void {
  const trimmed = value?.trim()
  const next = trimmed === undefined || trimmed === '' ? defaultDataRoot() : path.resolve(trimmed)
  if (next !== dataRoot) dataRoot = next
}

function indexPath(): string { return path.join(dataRoot, 'index.json') }
function imagesDir(): string { return path.join(dataRoot, 'images') }

/** Entries kept in the index (oldest generations are trimmed, files removed). */
export const LIBRARY_MAX_ENTRIES = 2_000

/** One entry as persisted: image files, never base64. */
interface StoredImage {
  file: string
  mime: string
  width?: number
  height?: number
  revisedPrompt?: string
}

interface StoredEntry {
  id: string
  createdAt: number
  mode: GenerateRequest['mode']
  model: string
  prompt: string
  resolution: string
  aspectRatio: string
  /** Legacy field: always '' for entries written since #661. */
  quality: string
  outputFormat: string
  n: number
  images: StoredImage[]
  cost?: number
  refNames?: string[]
  source: LibraryEntry['source']
  sessionId?: string
  tags?: string[]
}

interface IndexFile {
  version: 1
  entries: StoredEntry[]
}

/**
 * Library mutations read and replace one shared index; serialize them so two
 * concurrent generations cannot each read an old index and drop the other's row.
 */
let pendingMutation: Promise<unknown> = Promise.resolve()

function mutateLibrary<T>(operation: () => Promise<T>): Promise<T> {
  const next = pendingMutation.then(operation, operation)
  pendingMutation = next.then(() => undefined, () => undefined)
  return next
}

/** File extension for a media type. */
export function extensionOf(mime: string): string {
  switch (mime.split(';')[0]!.trim().toLowerCase()) {
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    default: return 'png'
  }
}

/** Media type for a stored file name. */
export function mimeOfFile(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return 'image/png'
  }
}

/**
 * Intrinsic pixel size read straight from the container header — no image
 * library needed, and a malformed header just yields undefined.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // PNG: 8-byte signature, then the IHDR chunk (length, type, width, height).
  if (bytes.byteLength >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  // GIF: logical screen descriptor right after the 6-byte signature.
  if (bytes.byteLength >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  // WebP: RIFF container with a VP8/VP8L/VP8X chunk.
  if (bytes.byteLength >= 30
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const fourCC = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)
    if (fourCC.startsWith('VP8X')) {
      const width = 1 + (bytes[24]! | bytes[25]! << 8 | bytes[26]! << 16)
      const height = 1 + (bytes[27]! | bytes[28]! << 8 | bytes[29]! << 16)
      return { width, height }
    }
    if (fourCC.startsWith('VP8L') && bytes.byteLength >= 25) {
      const bits = bytes[21]! | bytes[22]! << 8 | bytes[23]! << 16 | bytes[24]! << 24
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (fourCC.startsWith('VP8 ') && bytes.byteLength >= 30) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    }
  }
  // JPEG: walk the marker segments to the start-of-frame.
  if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) { offset++; continue }
      const marker = bytes[offset + 1]!
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
      const length = view.getUint16(offset + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
      }
      offset += 2 + length
    }
  }
  return undefined
}

/** Structural guard for one persisted entry. */
function isStoredEntry(value: unknown): value is StoredEntry {
  if (value === null || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string'
    && typeof entry.createdAt === 'number'
    && (entry.mode === 'text' || entry.mode === 'edit')
    && typeof entry.model === 'string'
    && typeof entry.prompt === 'string'
    && Array.isArray(entry.images)
    && entry.images.every(image => {
      if (image === null || typeof image !== 'object') return false
      const record = image as Record<string, unknown>
      return typeof record.file === 'string' && typeof record.mime === 'string'
    })
}

/** Read the index, tolerating a missing or corrupt file. */
async function readIndex(): Promise<StoredEntry[]> {
  try {
    const raw = await fs.readFile(indexPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return []
    const entries = (parsed as { entries?: unknown }).entries
    if (!Array.isArray(entries)) return []
    return entries.filter(isStoredEntry)
  } catch {
    return []
  }
}

/** Persist the index atomically (temp file + rename). */
async function writeIndex(entries: StoredEntry[]): Promise<void> {
  await fs.mkdir(imagesDir(), { recursive: true })
  const payload: IndexFile = { version: 1, entries }
  const tmp = `${indexPath()}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, indexPath())
}

/** Project a stored entry onto the wire shape (served image URLs). */
function toWire(entry: StoredEntry): LibraryEntry {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    mode: entry.mode,
    model: entry.model,
    prompt: entry.prompt,
    resolution: entry.resolution,
    aspectRatio: entry.aspectRatio,
    quality: entry.quality,
    outputFormat: entry.outputFormat,
    n: entry.n,
    images: entry.images.map(toWireImage),
    ...entry.cost === undefined ? {} : { cost: entry.cost },
    ...entry.refNames === undefined ? {} : { refNames: entry.refNames },
    source: entry.source,
    ...entry.sessionId === undefined ? {} : { sessionId: entry.sessionId },
    ...entry.tags === undefined ? {} : { tags: entry.tags },
  }
}

function toWireImage(image: StoredImage): LibraryImageRef {
  return {
    url: `${LIBRARY_API.image}/${image.file}`,
    file: image.file,
    mime: image.mime,
    ...image.width === undefined ? {} : { width: image.width },
    ...image.height === undefined ? {} : { height: image.height },
    ...image.revisedPrompt === undefined ? {} : { revisedPrompt: image.revisedPrompt },
  }
}

/** Everything the library list route reports. */
export async function listLibrary(): Promise<LibraryListResult> {
  const entries = await readIndex()
  let imageCount = 0
  for (const entry of entries) imageCount += entry.images.length
  return {
    entries: entries.map(toWire),
    total: entries.length,
    imageCount,
    dataRoot,
  }
}

/**
 * The library's identity, cheap enough for a poll.
 *
 * The browser has no push channel from the host, so "did a generation just
 * finish?" is answered by watching the newest entry id. This deliberately does
 * NOT return the list: the caller polls it every couple of seconds, and the
 * full list carries every entry's metadata.
 *
 * @returns the newest entry's id and the total, or just the total when empty.
 */
export async function readLibraryHead(): Promise<LibraryHead> {
  const entries = await readIndex()
  let newest: StoredEntry | undefined
  for (const entry of entries) {
    if (newest === undefined || entry.createdAt > newest.createdAt) newest = entry
  }
  return {
    total: entries.length,
    ...newest === undefined ? {} : { newestId: newest.id, newestAt: newest.createdAt },
  }
}

/** What the caller supplies when storing one generation. */
export interface LibraryWriteInput {
  request: GenerateRequest
  images: GeneratedImage[]
  cost?: number
  source: LibraryEntry['source']
  sessionId?: string
}

/** Remove one entry's image files (best effort). */
async function removeEntryFiles(entry: StoredEntry): Promise<void> {
  for (const image of entry.images) {
    try { await fs.rm(path.join(imagesDir(), image.file), { force: true }) } catch { /* best effort */ }
  }
}

/** File name of one stored image: `<entry id>-<index>.<ext>`. */
function imageFileName(entryId: string, index: number, mime: string): string {
  return `${entryId}-${index}.${extensionOf(mime)}`
}

/**
 * Where one generated image lives, in the three forms a caller may need.
 *
 * The naming rule is shared with the writer below rather than repeated, so the
 * file/URL/path an Agent tool reports can never drift from what actually landed
 * on disk. That matters because the model cannot see the picture: these strings
 * are the only way it can say where the image is.
 *
 * @param entryId - the library entry the generation was stored as.
 * @param index - 0-based image position inside that entry.
 * @param mime - the image's media type (decides the extension).
 * @returns the file name, its same-origin URL, and its absolute path.
 */
export function libraryImageLocation(entryId: string, index: number, mime: string): { file: string; url: string; path: string } {
  const file = imageFileName(entryId, index, mime)
  return {
    file,
    url: `${LIBRARY_API.image}/${file}`,
    path: path.join(imagesDir(), file),
  }
}

/**
 * Write one generation's images to disk and prepend its index entry.
 * @returns the stored wire entry.
 * @throws when an image cannot be written (no partial entry is left behind).
 */
export async function appendLibraryEntry(input: LibraryWriteInput): Promise<LibraryEntry> {
  return mutateLibrary(async () => {
    await fs.mkdir(imagesDir(), { recursive: true })
    const id = randomUUID()
    const stored: StoredImage[] = []
    try {
      for (let index = 0; index < input.images.length; index++) {
        const image = input.images[index]!
        const bytes = Buffer.from(image.b64, 'base64')
        const file = imageFileName(id, index, image.mime)
        await fs.writeFile(path.join(imagesDir(), file), bytes)
        const size = imageSize(bytes)
        stored.push({
          file,
          mime: image.mime,
          ...size === undefined ? {} : size,
          ...image.revisedPrompt === undefined ? {} : { revisedPrompt: image.revisedPrompt },
        })
      }
    } catch (error) {
      await removeEntryFiles({ images: stored } as StoredEntry)
      throw error
    }
    const entry: StoredEntry = {
      id,
      createdAt: Date.now(),
      mode: input.request.mode,
      model: input.request.model,
      prompt: input.request.prompt,
      resolution: input.request.resolution,
      aspectRatio: input.request.aspectRatio,
      // Quality stopped being a plugin parameter in #661, so every new entry
      // records it empty. The field itself stays: entries written before that
      // change carry a real value and the library must still read them back.
      quality: '',
      outputFormat: input.request.outputFormat,
      n: input.request.n,
      images: stored,
      ...input.cost === undefined ? {} : { cost: input.cost },
      ...input.request.refNames === undefined ? {} : { refNames: input.request.refNames },
      source: input.source,
      ...input.sessionId === undefined ? {} : { sessionId: input.sessionId },
    }
    const previous = await readIndex()
    const merged = [entry, ...previous].slice(0, LIBRARY_MAX_ENTRIES)
    await writeIndex(merged)
    // Trim: anything past the cap loses its files too.
    const keptIds = new Set(merged.map(candidate => candidate.id))
    for (const candidate of previous) {
      if (!keptIds.has(candidate.id)) await removeEntryFiles(candidate)
    }
    return toWire(entry)
  })
}

/** Remove one entry (and its image files); returns the remaining entries. */
export async function removeLibraryEntry(id: string): Promise<LibraryEntry[]> {
  return mutateLibrary(async () => {
    const entries = await readIndex()
    const target = entries.find(entry => entry.id === id)
    if (target !== undefined) await removeEntryFiles(target)
    const kept = entries.filter(entry => entry.id !== id)
    await writeIndex(kept)
    return kept.map(toWire)
  })
}

/** Remove every entry and image file. */
export async function clearLibrary(): Promise<LibraryEntry[]> {
  return mutateLibrary(async () => {
    const entries = await readIndex()
    for (const entry of entries) await removeEntryFiles(entry)
    await writeIndex([])
    return []
  })
}

/**
 * The names this store writes, and the only thing that turns one into a path.
 *
 * Both the read route and the reveal route go through here, so the rule lives
 * once: a caller holding a name cannot reach a file outside the images
 * directory, whatever it passes.
 */
const LIBRARY_IMAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9-]*-[0-9]+\.(png|jpg|jpeg|webp|gif)$/

/** Read one stored image file by its (validated) file name. */
export async function readLibraryImage(file: string): Promise<{ data: Buffer; mime: string } | undefined> {
  // Only accept `<uuid>-<index>.<ext>` — the exact names this store writes — so
  // the route can never read outside the images directory.
  if (!LIBRARY_IMAGE_NAME.test(file)) return undefined
  try {
    const data = await fs.readFile(path.join(imagesDir(), file))
    return { data, mime: mimeOfFile(file) }
  } catch {
    return undefined
  }
}

/**
 * Absolute path of one stored image, or undefined when the name is not one this
 * store writes.
 * @param file - the image's file name.
 * @returns the path on disk, for a name this store could have written.
 */
export function libraryImagePath(file: string): string | undefined {
  return LIBRARY_IMAGE_NAME.test(file) ? path.join(imagesDir(), file) : undefined
}
