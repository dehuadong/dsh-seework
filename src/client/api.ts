/**
 * Browser-side API client for the plugin's own routes. Every call goes to the
 * same origin and the host half talks to SeeAI Hub, so the API key never
 * reaches the page.
 */

import {
  CANVAS_API,
  CATALOG_API,
  GENERATE_API,
  LIBRARY_API,
  SETTINGS_API,
  TASK_API,
  type CanvasAssetListing,
  type CanvasDocument,
  type CanvasImageRef,
  type CanvasListResult,
  type CanvasSummary,
  type CatalogResult,
  type CatalogRefreshOutcome,
  type DirectoryPickerStatus,
  type GenerateRequest,
  type GenerationTask,
  type LibraryEntry,
  type LibraryHead,
  type LibraryListResult,
  type PickDirectoryResult,
} from '../protocol.ts'

/** One decoded bridge/route response. */
type Envelope<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

/** POST one JSON request and decode the envelope. */
async function postJson<T>(path: string, body: unknown): Promise<Envelope<T>> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json() as Envelope<T>
    if (typeof payload === 'object' && payload !== null && 'ok' in payload) return payload
    return { ok: false, code: 'internal', message: `接口返回了未知形状（HTTP ${response.status}）` }
  } catch {
    return { ok: false, code: 'internal', message: '接口不可达' }
  }
}

/** The generation and library routes the panel/canvas consume. */
export class SeeWorkApi {
  /** Discover the deployment's image models (never persists anything). */
  catalog(input: { apiUrl?: string; serviceUrl?: string; apiKey?: string } = {}): Promise<Envelope<CatalogResult>> {
    return postJson<CatalogResult>(CATALOG_API.models, input)
  }

  /**
   * Run one automatic detection round and adopt refreshed capabilities (#652).
   *
   * Called when the card opens. The host throttles it against its own background
   * timer, so reopening the card does not re-request; an unconfigured plugin
   * answers `skipped: 'not-configured'` without touching the network.
   *
   * @returns what the round changed — the catalog answer is included so the card
   *   can stage models the user has not saved yet.
   */
  catalogRefresh(): Promise<Envelope<CatalogRefreshOutcome>> {
    return postJson<CatalogRefreshOutcome>(CATALOG_API.refresh, {})
  }

  /** Submit one generation and wait for its task to settle. */
  generate(request: GenerateRequest & { waitForCompletion?: boolean }): Promise<Envelope<{ task: GenerationTask }>> {
    return postJson<{ task: GenerationTask }>(GENERATE_API, request)
  }

  /** Every retained task, newest first. */
  tasks(): Promise<Envelope<{ tasks: GenerationTask[] }>> {
    return postJson<{ tasks: GenerationTask[] }>(TASK_API.list, {})
  }

  /** Cancel a queued or running task. */
  cancel(taskId: string): Promise<Envelope<{ task: GenerationTask }>> {
    return postJson<{ task: GenerationTask }>(TASK_API.cancel, { taskId })
  }

  /** The material library, newest first. */
  library(): Promise<Envelope<LibraryListResult>> {
    return postJson<LibraryListResult>(LIBRARY_API.list, {})
  }

  /**
   * The library's identity only — what the page polls to notice a generation
   * that finished in the host.
   */
  libraryHead(): Promise<Envelope<LibraryHead>> {
    return postJson<LibraryHead>(LIBRARY_API.head, {})
  }

  /** Remove one library entry and its files. */
  removeEntry(id: string): Promise<Envelope<{ entries: LibraryEntry[] }>> {
    return postJson<{ entries: LibraryEntry[] }>(LIBRARY_API.remove, { id })
  }

  /** Remove every library entry. */
  clearLibrary(): Promise<Envelope<{ entries: LibraryEntry[] }>> {
    return postJson<{ entries: LibraryEntry[] }>(LIBRARY_API.clear, {})
  }

  /** Every stored board, newest-updated first. */
  canvases(): Promise<Envelope<CanvasListResult>> {
    return postJson<CanvasListResult>(CANVAS_API.list, {})
  }

  /** Create a fresh board. */
  createCanvas(title?: string): Promise<Envelope<{ canvas: CanvasDocument }>> {
    return postJson<{ canvas: CanvasDocument }>(CANVAS_API.create, title === undefined ? {} : { title })
  }

  /** Read one board. */
  readCanvas(id: string): Promise<Envelope<{ canvas: CanvasDocument }>> {
    return postJson<{ canvas: CanvasDocument }>(CANVAS_API.read, { id })
  }

  /** Save a board, fenced by the revision it was read at. */
  saveCanvas(canvas: CanvasDocument, expectedRevision: number): Promise<Envelope<{ canvas: CanvasDocument }>> {
    return postJson<{ canvas: CanvasDocument }>(CANVAS_API.save, { canvas, expectedRevision })
  }

  /** Delete a board. */
  removeCanvas(id: string): Promise<Envelope<{ canvases: CanvasSummary[] }>> {
    return postJson<{ canvases: CanvasSummary[] }>(CANVAS_API.remove, { id })
  }

  /**
   * Ask how the host can choose a folder (opens nothing).
   *
   * `native` means one OS chooser on the host's screen; `browse` means the shell's
   * own in-app browser serves listings instead, and `none` means there is no picker
   * at all — in both latter cases the card offers no button.
   */
  directoryPicker(): Promise<Envelope<DirectoryPickerStatus>> {
    return postJson<DirectoryPickerStatus>(SETTINGS_API.directoryPicker, {})
  }

  /**
   * Open the host's folder chooser and wait for the operator.
   * @returns the chosen absolute directory, or `cancelled: true`.
   */
  pickDirectory(): Promise<Envelope<PickDirectoryResult>> {
    return postJson<PickDirectoryResult>(SETTINGS_API.pickDirectory, {})
  }

  /**
   * Store one canvas-owned picture (a burned annotation or a crop).
   *
   * It never enters the material library: the library records what was generated,
   * and a marked-up copy belongs to the board that produced it.
   *
   * @param dataUrl - the image as a PNG data URL.
   * @returns the stored image's file name and URL, or an error envelope.
   */
  writeCanvasAsset(dataUrl: string): Promise<Envelope<{ image: CanvasImageRef }>> {
    return postJson<{ image: CanvasImageRef }>(CANVAS_API.asset, { dataUrl })
  }

  /**
   * Enumerate the board's own pictures and how much of them is unreferenced.
   * @returns each file with its size and whether a card still shows it.
   */
  canvasAssets(): Promise<Envelope<CanvasAssetListing>> {
    return postJson<CanvasAssetListing>(CANVAS_API.assets, {})
  }

  /** Delete every board picture no card shows any more. */
  pruneCanvasAssets(): Promise<Envelope<{ removed: number; bytes: number }>> {
    return postJson<{ removed: number; bytes: number }>(CANVAS_API.pruneAssets, {})
  }

  /**
   * Delete one board picture.
   *
   * Refused while a card still shows it, so removing a card and dropping its file
   * has to happen in that order (and a second board's copy is never pulled away).
   *
   * @param file - the picture's file name.
   */
  removeCanvasAsset(file: string): Promise<Envelope<{ removed: number; bytes: number }>> {
    return postJson<{ removed: number; bytes: number }>(CANVAS_API.removeAsset, { file })
  }
}
