/**
 * Canvas-owned image assets (host half).
 *
 * The board's own pictures: an annotation burned onto a copy, or a crop of one.
 * They deliberately do NOT enter the material library — the library is the record
 * of what was generated, and a marked-up copy is not a generation; it belongs to
 * the board that produced it. So they live under `<data root>/canvas/assets/`,
 * with their own route, and a card that points at one says so (`source: 'canvas'`).
 *
 * Naming follows the same shape as the library (`<uuid>-<n>.<ext>`) so the board's
 * existing file-name validation keeps working, while the two directories stay
 * separate: a library route can never read a canvas asset and vice versa.
 */

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { extensionOf, imageSize, libraryDataRoot } from './library.ts'
import { CANVAS_API, type CanvasImageRef } from './protocol.ts'

/** Ceiling on one uploaded asset (a burned annotation of a 4K picture fits). */
export const MAX_CANVAS_ASSET_BYTES = 32 * 1024 * 1024

/** The file-name shape both stores share (also the board's validation rule). */
export const CANVAS_FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*-[0-9]+\.(png|jpg|jpeg|webp|gif)$/

/** Where canvas-owned assets live: `<data root>/canvas/assets`. */
export function canvasAssetsDir(): string {
  return path.join(libraryDataRoot(), 'canvas', 'assets')
}

/** One asset's file name, matching the board's validation shape. */
function assetFileName(id: string, index: number, mime: string): string {
  return `${id}-${index}.${extensionOf(mime)}`
}

/** Media type of one stored asset, from its extension. */
function mimeOfAsset(file: string): string {
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg'
  if (file.endsWith('.webp')) return 'image/webp'
  if (file.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

/** Parse a `data:image/...;base64,...` URL. */
function parseImageDataUrl(value: string): { mime: string; data: Buffer } | undefined {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/u.exec(value.trim())
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined
  const data = Buffer.from(match[2], 'base64')
  if (data.byteLength === 0 || data.byteLength > MAX_CANVAS_ASSET_BYTES) return undefined
  return { mime: match[1], data }
}

/**
 * Write one canvas asset and report where it landed.
 *
 * @param input - the image as a data URL.
 * @returns the file name and its served URL, or undefined when the payload is
 *   not an acceptable image (the route answers 400 then, never a partial write).
 */
export async function writeCanvasAsset(input: { dataUrl: string }): Promise<CanvasImageRef | undefined> {
  const parsed = parseImageDataUrl(input.dataUrl)
  if (parsed === undefined) return undefined
  await fs.mkdir(canvasAssetsDir(), { recursive: true })
  const id = randomUUID()
  const file = assetFileName(id, 0, parsed.mime)
  await fs.writeFile(path.join(canvasAssetsDir(), file), parsed.data)
  const size = imageSize(parsed.data)
  return {
    file,
    url: `${CANVAS_API.asset}/${file}`,
    mime: parsed.mime,
    ...size === undefined ? {} : { width: size.width, height: size.height },
  }
}

/**
 * Read one canvas asset back.
 *
 * The name shape is re-checked here as well as in the card validator: this is the
 * only place a name becomes a filesystem path, so it is the place that has to be
 * sure the name cannot escape the directory.
 *
 * @param file - the asset's file name.
 * @returns the bytes and their media type, or undefined when it is not there.
 */
export async function readCanvasAsset(file: string): Promise<{ mime: string; data: Buffer } | undefined> {
  if (!CANVAS_FILE_PATTERN.test(file)) return undefined
  try {
    return { mime: mimeOfAsset(file), data: await fs.readFile(path.join(canvasAssetsDir(), file)) }
  } catch {
    return undefined
  }
}

/** One canvas-owned picture as it sits on disk. */
export interface CanvasAssetFile {
  file: string
  bytes: number
}

/**
 * Every canvas-owned picture on disk, whatever references it.
 *
 * Names that do not match the shape are skipped rather than reported: the store
 * only ever writes that shape, so anything else was not put there by the plugin
 * and is none of its business to delete.
 *
 * @returns the files, sorted by name.
 */
export async function listCanvasAssetFiles(): Promise<CanvasAssetFile[]> {
  let names: string[] = []
  try {
    names = await fs.readdir(canvasAssetsDir())
  } catch {
    return []
  }
  const files: CanvasAssetFile[] = []
  for (const name of names) {
    if (!CANVAS_FILE_PATTERN.test(name)) continue
    try {
      const stat = await fs.stat(path.join(canvasAssetsDir(), name))
      if (stat.isFile()) files.push({ file: name, bytes: stat.size })
    } catch {
      // Raced with a delete (or a directory): nothing to report.
    }
  }
  files.sort((left, right) => left.file.localeCompare(right.file))
  return files
}

/**
 * Delete canvas-owned pictures by name.
 *
 * Unsafe or unknown names are ignored instead of throwing: this runs after the
 * board stopped referencing them, and a file that is already gone is the outcome
 * the caller wanted.
 *
 * @param files - the file names to delete.
 * @returns how many files went away and how many bytes that freed.
 */
export async function deleteCanvasAssets(files: readonly string[]): Promise<{ removed: number; bytes: number }> {
  let removed = 0
  let bytes = 0
  for (const file of files) {
    if (!CANVAS_FILE_PATTERN.test(file)) continue
    const target = path.join(canvasAssetsDir(), file)
    try {
      const stat = await fs.stat(target)
      if (!stat.isFile()) continue
      await fs.rm(target)
      removed += 1
      bytes += stat.size
    } catch {
      // Already gone (or gone by now): the caller's intent is satisfied.
    }
  }
  return { removed, bytes }
}
