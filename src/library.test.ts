/**
 * Material-library tests: the library is what the sidebar (phase 2) and the
 * canvas (phase 3) read, so a generation must land on disk with its metadata
 * intact and a corrupt entry must never take the list down.
 */

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyDataDirectory,
  appendLibraryEntry,
  clearLibrary,
  dataRootMove,
  imageSize,
  libraryDataRoot,
  libraryImageLocation,
  listLibrary,
  migrateDataRoot,
  readLibraryHead,
  readLibraryImage,
  removeLibraryEntry,
  setLibraryDataRoot,
} from './library.ts'
import { fixtureRequest as request, pngBuffer } from './fixtures.ts'

describe('imageSize', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    expect(imageSize(pngBuffer(320, 180))).toEqual({ width: 320, height: 180 })
  })

  it('returns undefined for a non-image payload', () => {
    expect(imageSize(Buffer.from('not an image at all'))).toBeUndefined()
    expect(imageSize(Buffer.alloc(0))).toBeUndefined()
  })
})

describe('library store', () => {
  let root: string
  const previous = libraryDataRoot()

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'dsh-seework-test-'))
    setLibraryDataRoot(root)
  })

  afterEach(async () => {
    setLibraryDataRoot(previous === '' ? undefined : previous)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('writes image files and returns served URLs, never base64', async () => {
    const entry = await appendLibraryEntry({
      request: request(),
      images: [{ b64: pngBuffer(64, 32).toString('base64'), mime: 'image/png' }],
      cost: 0.22,
      source: 'agent',
      sessionId: 'session-1',
    })

    expect(entry.images).toHaveLength(1)
    const image = entry.images[0]!
    expect(image.url).toBe(`/api/dsh-seework/library/image/${image.file}`)
    expect(image).not.toHaveProperty('b64')
    expect(image.width).toBe(64)
    expect(image.height).toBe(32)
    expect(entry.cost).toBe(0.22)
    expect(entry.source).toBe('agent')

    const stored = await readLibraryImage(image.file)
    expect(stored?.mime).toBe('image/png')
    expect(stored?.data.byteLength).toBe(pngBuffer(64, 32).byteLength)
  })

  it('tells the Agent the very file the writer created', async () => {
    // The model cannot see the picture, so the location it reports has to be the
    // file that really landed on disk — the naming rule is shared, not retyped.
    const entry = await appendLibraryEntry({
      request: request(),
      images: [{ b64: pngBuffer(8, 8).toString('base64'), mime: 'image/jpeg' }],
      source: 'agent',
    })

    const image = entry.images[0]!
    const location = libraryImageLocation(entry.id, 0, 'image/jpeg')
    expect(location.file).toBe(image.file)
    expect(location.url).toBe(image.url)
    expect(location.path).toBe(path.join(root, 'images', image.file))
    await expect(fs.stat(location.path)).resolves.toBeTruthy()
  })

  it('lists newest first and reports storage facts for the sidebar', async () => {
    await appendLibraryEntry({ request: request({ prompt: '第一张' }), images: [{ b64: pngBuffer().toString('base64'), mime: 'image/png' }], source: 'panel' })
    await appendLibraryEntry({
      request: request({ prompt: '第二张' }),
      images: [
        { b64: pngBuffer(4, 4).toString('base64'), mime: 'image/png' },
        { b64: pngBuffer(4, 4).toString('base64'), mime: 'image/png' },
      ],
      source: 'agent',
    })

    const listing = await listLibrary()
    expect(listing.total).toBe(2)
    expect(listing.imageCount).toBe(3)
    expect(listing.dataRoot).toBe(root)
    expect(listing.entries.map(entry => entry.prompt)).toEqual(['第二张', '第一张'])
  })

  it('reports its identity for the poll, newest entry first', async () => {
    // The page has no push channel: this head is how it notices a generation
    // that finished in the host, so it must name the newest entry and stay tiny.
    expect(await readLibraryHead()).toEqual({ total: 0 })

    await appendLibraryEntry({ request: request({ prompt: '第一张' }), images: [{ b64: pngBuffer().toString('base64'), mime: 'image/png' }], source: 'panel' })
    const older = await readLibraryHead()
    expect(older.total).toBe(1)
    expect(typeof older.newestId).toBe('string')

    await appendLibraryEntry({ request: request({ prompt: '第二张' }), images: [{ b64: pngBuffer().toString('base64'), mime: 'image/png' }], source: 'agent' })
    const newest = await readLibraryHead()
    expect(newest.total).toBe(2)
    expect(newest.newestId).not.toBe(older.newestId)
    expect(typeof newest.newestAt).toBe('number')
  })

  it('removes one entry together with its files', async () => {
    const entry = await appendLibraryEntry({
      request: request(),
      images: [{ b64: pngBuffer().toString('base64'), mime: 'image/png' }],
      source: 'panel',
    })
    const file = entry.images[0]!.file

    const remaining = await removeLibraryEntry(entry.id)
    expect(remaining).toHaveLength(0)
    await expect(fs.stat(path.join(root, 'images', file))).rejects.toThrow()
  })

  it('clears everything', async () => {
    await appendLibraryEntry({ request: request(), images: [{ b64: pngBuffer().toString('base64'), mime: 'image/png' }], source: 'panel' })
    expect((await clearLibrary())).toHaveLength(0)
    expect((await listLibrary()).total).toBe(0)
  })

  it('refuses file names that try to escape the images directory', async () => {
    for (const file of ['../../settings.yaml', 'a/b.png', 'index.json', '..\\win.png', 'x.png.bak']) {
      await expect(readLibraryImage(file)).resolves.toBeUndefined()
    }
  })

  it('survives a corrupt index instead of failing the sidebar', async () => {
    await fs.writeFile(path.join(root, 'index.json'), '{ this is not json', 'utf8')
    await expect(listLibrary()).resolves.toMatchObject({ entries: [], total: 0 })
  })

  it('drops malformed entries while keeping the good ones', async () => {
    await appendLibraryEntry({ request: request(), images: [{ b64: pngBuffer().toString('base64'), mime: 'image/png' }], source: 'panel' })
    const raw = JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8')) as { entries: unknown[] }
    raw.entries.push({ id: 42, createdAt: 'yesterday' })
    await fs.writeFile(path.join(root, 'index.json'), JSON.stringify(raw), 'utf8')

    const listing = await listLibrary()
    expect(listing.total).toBe(1)
  })
})

describe('moving the library to another directory', () => {
  /**
   * Changing the material directory moves the library (the user asked for it: the
   * old files used to be left behind, which reads as "my pictures are gone").
   *
   * What these protect: nothing is ever overwritten, the moved pictures stay
   * listed, a cross-volume move copies instead of failing, and a move that could
   * not finish leaves the old directory in force rather than splitting the library
   * across two.
   */
  let root: string
  let other: string
  const previous = libraryDataRoot()

  /** Put one generated picture into the library rooted at `dir`. */
  async function seed(dir: string, size = 8): Promise<string> {
    setLibraryDataRoot(dir)
    const entry = await appendLibraryEntry({
      request: request(),
      images: [{ b64: pngBuffer(size, size).toString('base64'), mime: 'image/png' }],
      source: 'panel',
    })
    return entry.images[0]!.file
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'dsh-seework-move-from-'))
    other = await fs.mkdtemp(path.join(tmpdir(), 'dsh-seework-move-to-'))
    setLibraryDataRoot(root)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    setLibraryDataRoot(previous === '' ? undefined : previous)
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(other, { recursive: true, force: true })
  })

  it('brings the pictures and the index along, and leaves nothing behind', async () => {
    const file = await seed(root)

    expect(await migrateDataRoot(root, other)).toEqual({ moved: 1, kept: 0 })

    // The picture is in the new directory and the index still knows about it, so
    // the library shows it there rather than on disk and invisible.
    setLibraryDataRoot(other)
    expect((await listLibrary()).entries).toHaveLength(1)
    await expect(readLibraryImage(file)).resolves.toBeDefined()
    await expect(fs.readdir(path.join(root, 'images'))).resolves.toEqual([])
  })

  it('never overwrites: a name the new directory already has stays where it is', async () => {
    const file = await seed(root)
    // The same picture is already in the destination (the user moved the directory
    // back and forth): its copy wins, and the source's is left alone.
    await fs.mkdir(path.join(other, 'images'), { recursive: true })
    await fs.writeFile(path.join(other, 'images', file), Buffer.from('the one that wins'))

    expect(await migrateDataRoot(root, other)).toEqual({ moved: 0, kept: 1 })
    await expect(fs.readFile(path.join(other, 'images', file), 'utf8')).resolves.toBe('the one that wins')
    await expect(fs.stat(path.join(root, 'images', file))).resolves.toBeDefined()
  })

  it('copies when the two directories are on different volumes', async () => {
    const file = await seed(root)
    // Renaming across volumes fails with EXDEV, which is the ordinary case when the
    // new directory is on another drive — so the move copies, verifies, then removes.
    const rename = vi.spyOn(fs, 'rename').mockImplementation(async () => {
      const error: NodeJS.ErrnoException = new Error('EXDEV: cross-device link not permitted')
      error.code = 'EXDEV'
      throw error
    })
    let report: { moved: number; kept: number; error?: string }
    try {
      report = await migrateDataRoot(root, other)
    } finally {
      rename.mockRestore()
    }
    expect(report).toEqual({ moved: 1, kept: 0 })
    expect((await fs.readFile(path.join(other, 'images', file))).length).toBeGreaterThan(0)
    await expect(fs.stat(path.join(root, 'images', file))).rejects.toThrow()
  })

  it('switches only after the move, and reports what it did', async () => {
    await seed(root)

    await applyDataDirectory(other)

    expect(libraryDataRoot()).toBe(other)
    expect(dataRootMove()).toMatchObject({ to: other, moved: 1, kept: 0, pending: false })
    expect((await listLibrary()).dataRootMove).toMatchObject({ to: other, pending: false })
  })

  it('keeps the old directory in force when the move fails', async () => {
    const file = await seed(root)
    // A destination that cannot be created: the move stops, and the library keeps
    // working from where it is instead of half-following the setting.
    const blocked = path.join(other, 'images')
    await fs.writeFile(blocked, 'not a directory', 'utf8')

    await applyDataDirectory(path.join(other, 'images', 'deeper'))

    expect(libraryDataRoot()).toBe(root)
    expect(dataRootMove()).toMatchObject({ pending: false })
    expect(dataRootMove()?.error).toBeDefined()
    await expect(readLibraryImage(file)).resolves.toBeDefined()
  })
})
