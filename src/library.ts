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
import { systemDocumentsDirectory } from './documents-dir.ts'

/**
 * The directory this plugin used before its default moved under Documents:
 * `<DSH_HOME|~/.dsh>/dsh-seework`, which is where every installation kept its
 * library until then.
 */
function legacyDataRoot(): string {
  const home = process.env.DSH_HOME?.trim()
  return path.join(home !== undefined && home !== '' ? home : path.join(homedir(), '.dsh'), DEFAULT_DATA_DIR_NAME)
}

/**
 * The root in force, and the root that "no configured directory" means.
 *
 * Both start where the data already is, because the system's Documents directory
 * is answered asynchronously ({@link primeDefaultDataRoot}): a default that
 * pointed elsewhere from the first request would move the library twice — once to
 * a guess, then to the answer.
 */
let dataRoot = legacyDataRoot()
let defaultRoot = dataRoot
/** The directory the settings last asked for, which a pending switch targets. */
let targetRoot = dataRoot
/** Switches run one at a time: two moves must never interleave. */
let switching: Promise<void> = Promise.resolve()
/** What the last switch did, for the settings card to report. */
let lastMove: DataRootMove | undefined
let moveSeq = 0

/** What one directory switch did. */
export interface DataRootMove {
  /** Increases per switch, so a reader can tell a new report from an old one. */
  id: number
  /** The directory the data is being moved into. */
  to: string
  /** How many files are across. */
  moved: number
  /** Files left in the old directory because the new one already had that name. */
  kept: number
  /** Whether the move is still running. */
  pending: boolean
  /** Why the move could not finish; absent when it did. */
  error?: string
}

/** The directory every library image, canvas asset and index lives under. */
export function libraryDataRoot(): string {
  return dataRoot
}

/** What the last directory switch did, or undefined when none has happened. */
export function dataRootMove(): DataRootMove | undefined {
  return lastMove
}

/**
 * Put the stores at a directory, now, moving nothing.
 *
 * This is the primitive: the root changes on the spot, so a caller with data to
 * bring along must move it first — {@link applyDataDirectory} is the one that
 * does. A test putting the store in a temp directory calls this, and deliberately
 * moves nothing: the directory it is switching away from may be a real user's
 * library, and moving it into a temp directory that the test then deletes would
 * destroy it.
 *
 * @param value - the configured directory, or empty for the default.
 */
export function setLibraryDataRoot(value: string | undefined): void {
  dataRoot = resolveRoot(value)
  targetRoot = dataRoot
  lastMove = undefined
}

/**
 * Follow the settings value, moving the library when it points somewhere new.
 *
 * Called wherever the settings are read, because on the hosts this plugin runs on
 * the value is a live reference a write changes in place — there is no change event
 * to hang this on. An unchanged value is a no-op; a change is handed to
 * {@link applyDataDirectory}, which moves the library before the root changes.
 *
 * @param value - the configured directory, or empty for the default.
 */
export function followDataDirectory(value: string | undefined): void {
  if (resolveRoot(value) === targetRoot) return
  void applyDataDirectory(value)
}

/**
 * Follow the settings to another directory, bringing what the current one holds.
 *
 * The move happens first and the root changes second: a library split across two
 * directories would show neither half completely, so reads and writes keep going
 * to the old root until everything is across. A move that could not finish leaves
 * the old root in force and keeps the reason for the settings card.
 *
 * @param value - the configured directory, or empty for the default.
 */
export async function applyDataDirectory(value: string | undefined): Promise<void> {
  const next = resolveRoot(value)
  if (next === targetRoot) return
  targetRoot = next
  switching = switching.then(() => switchDataRoot(next), () => switchDataRoot(next))
  await switching
}

/** Resolve a configured value against the default in force. */
function resolveRoot(value: string | undefined): string {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? defaultRoot : path.resolve(trimmed)
}

/** Move everything across, then switch — or keep the old root and say why. */
async function switchDataRoot(next: string): Promise<void> {
  if (next === dataRoot) {
    // Nothing to move (the setting came back to where the data already is), so the
    // previous report no longer describes anything.
    lastMove = undefined
    return
  }
  moveSeq += 1
  const id = moveSeq
  lastMove = { id, to: next, moved: 0, kept: 0, pending: true }
  const report = await migrateDataRoot(dataRoot, next)
  // Assigned here rather than through `setLibraryDataRoot`: that primitive clears
  // the report, and this report is exactly what the caller needs to see.
  lastMove = {
    id,
    to: next,
    moved: report.moved,
    kept: report.kept,
    pending: false,
    ...report.error === undefined ? {} : { error: report.error },
  }
  if (report.error === undefined) dataRoot = next
}

/**
 * Adopt the system's Documents directory as the default root.
 *
 * The answer needs a command, so it arrives after boot; until it does, the default
 * is the directory the data is already in. When the settings name no directory of
 * their own, this is also the moment the library moves out of the hidden `.dsh` —
 * and everything in the old default comes with it.
 *
 * @param usesDefault - whether the settings currently name no directory.
 */
export async function primeDefaultDataRoot(usesDefault: () => boolean): Promise<void> {
  const documents = await systemDocumentsDirectory()
  const next = path.join(documents ?? path.join(homedir(), 'Documents'), DEFAULT_DATA_DIR_NAME)
  if (next === defaultRoot) return
  defaultRoot = next
  // A configured directory is the user's own choice: the default is not in play.
  if (!usesDefault()) return
  await applyDataDirectory(undefined)
}

/** What the plugin keeps under its data root, in the order a move takes them. */
const DATA_ROOT_ENTRIES = ['index.json', 'images', 'canvas'] as const

/**
 * Move one data root's contents into another.
 *
 * Only the plugin's own entries are considered, and **nothing is overwritten**: a
 * name the destination already has stays in the source and is counted as kept, so
 * a move can never destroy a file. The index is merged by entry id — a picture
 * moved without its entry would be on disk and invisible.
 *
 * The source directory itself is left in place: an empty shell is safer than a
 * recursive delete that could race with a file somebody just put there.
 *
 * @param from - the directory in force.
 * @param to - the directory to move into.
 * @returns how many pictures moved, how many were kept, and why it stopped early.
 */
export async function migrateDataRoot(from: string, to: string): Promise<{ moved: number; kept: number; error?: string }> {
  let moved = 0
  let kept = 0
  try {
    if (path.resolve(from) === path.resolve(to)) return { moved, kept }
    if (!(await isDirectory(from))) return { moved, kept }
    await fs.mkdir(to, { recursive: true })
    for (const entry of DATA_ROOT_ENTRIES) {
      const source = path.join(from, entry)
      const destination = path.join(to, entry)
      if (!(await isDirectory(source)) && !(await isFile(source))) continue
      if (entry === 'index.json') {
        // Bookkeeping, not a picture: it is moved (or merged) so the pictures that
        // moved stay listed, and it is deliberately not counted in the report —
        // the number the user reads is how many pictures came along.
        await mergeIndexAt(source, destination)
        continue
      }
      const nested = await moveTree(source, destination)
      moved += nested.moved
      kept += nested.kept
    }
  } catch (error) {
    return { moved, kept, error: error instanceof Error ? error.message : String(error) }
  }
  return { moved, kept }
}

/** Move every file under one directory into another, never overwriting. */
async function moveTree(source: string, destination: string): Promise<{ moved: number; kept: number }> {
  await fs.mkdir(destination, { recursive: true })
  let moved = 0
  let kept = 0
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      const nested = await moveTree(from, to)
      moved += nested.moved
      kept += nested.kept
      continue
    }
    if (!entry.isFile()) continue
    if (await isFile(to)) {
      kept += 1
      continue
    }
    await moveFile(from, to)
    moved += 1
  }
  return { moved, kept }
}

/** Move one file, copying when the two directories are on different volumes. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
  }
  // Different volumes: copy first, and only remove the source once the copy is
  // whole. A half-copied file is worse than one that stayed put.
  await fs.copyFile(from, to)
  const [source, copy] = await Promise.all([fs.stat(from), fs.stat(to)])
  if (source.size !== copy.size) throw new Error(`复制后大小不一致，已留在原处：${path.basename(from)}`)
  await fs.rm(from)
}

/**
 * Bring one index file's entries into another, by entry id.
 *
 * The pictures themselves were just moved; an entry left behind would leave them
 * on disk and invisible, so a source entry the destination does not know is
 * appended. Entries the destination already has win — its files are the ones the
 * images now resolve to.
 *
 * @param source - the index being moved away from.
 * @param destination - the index being moved into.
 */
async function mergeIndexAt(source: string, destination: string): Promise<void> {
  const incoming = await readIndexFile(source)
  if (incoming.length === 0) return
  if (!(await isFile(destination))) {
    await moveFile(source, destination)
    return
  }
  const current = await readIndexFile(destination)
  const known = new Set(current.map(entry => entry.id))
  const added = incoming.filter(entry => !known.has(entry.id))
  if (added.length === 0) return
  await writeIndexFile(destination, [...current, ...added])
}

/** Whether a path is a directory that is really there. */
async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

/** Whether a path is a file that is really there. */
async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile()
  } catch {
    return false
  }
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

/** Read the index in force, tolerating a missing or corrupt file. */
async function readIndex(): Promise<StoredEntry[]> {
  return await readIndexFile(indexPath())
}

/** Read one index file by path, tolerating a missing or corrupt file. */
async function readIndexFile(file: string): Promise<StoredEntry[]> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return []
    const entries = (parsed as { entries?: unknown }).entries
    if (!Array.isArray(entries)) return []
    return entries.filter(isStoredEntry)
  } catch {
    return []
  }
}

/** Persist the index in force atomically (temp file + rename). */
async function writeIndex(entries: StoredEntry[]): Promise<void> {
  await writeIndexFile(indexPath(), entries)
}

/** Persist one index file by path atomically (temp file + rename). */
async function writeIndexFile(file: string, entries: StoredEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const payload: IndexFile = { version: 1, entries }
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, file)
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
    // What the last directory change did: the settings card reads it back to say
    // what happened instead of claiming the change already took effect.
    dataRootMove: lastMove === undefined ? undefined : { ...lastMove },
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
