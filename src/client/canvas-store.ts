/**
 * Browser-side canvas access: board listing, the open board, and autosave.
 *
 * The board is a spatial document (see `docs/architecture.md`), so the
 * interesting part is not the model but the save protocol:
 *
 *  - edits touch the in-memory document and mark it dirty;
 *  - a debounced save sends the document with the revision it was read at;
 *  - a conflict (another window saved first) re-reads the board, adopts that
 *    revision, and retries — the user's board is the working copy, so it is
 *    never replaced by the remote document;
 *  - a failed save keeps the document dirty so the next tick retries.
 *
 * Nothing here draws anything: the board component renders whatever this store
 * holds, so the same document can be saved, reloaded, or thrown away without
 * the view knowing.
 */

import type { CanvasCard, CanvasDocument, CanvasSummary, CanvasViewport } from '../protocol.ts'
import { SeeWorkApi } from './api.ts'
import { SnapshotStore } from './snapshot-store.ts'

/** How long edits settle before a save is attempted. */
export const AUTOSAVE_DELAY_MS = 800

/** Canvas state as the workspace renders it. */
export interface CanvasState {
  status: 'loading' | 'ready' | 'error'
  boards: CanvasSummary[]
  /** The open board, when one is open. */
  board?: CanvasDocument
  /** Whether the open board has edits that are not stored yet. */
  dirty: boolean
  /** `saving` is in flight; `conflict` needs the user to look; `error` is a failure. */
  save: 'idle' | 'saving' | 'saved' | 'conflict' | 'error'
  /** Human-readable reason for the current save state. */
  message?: string
}
/** Create a card id (board-local, only needs to be unique within one board). */
export function newCardId(): string {
  const cryptoObj: Crypto | undefined = globalThis.crypto
  if (cryptoObj?.randomUUID !== undefined) return cryptoObj.randomUUID()
  return `card-${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`
}

/** The board store. */
export class CanvasStore {
  private readonly store = new SnapshotStore<CanvasState>({ status: 'loading', boards: [], dirty: false, save: 'idle' })
  private readonly api: SeeWorkApi
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private saveInFlight = false
  /**
   * Monotonic local-edit counter, and the fence a save response is judged by.
   *
   * The host echoes the document it stored; that echo is a snapshot of what was
   * sent. Any edit made AFTER the request went out is newer than the echo, and
   * comparing this counter is how the response knows not to overwrite it.
   */
  private editSeq = 0
  private disposed = false

  constructor(api: SeeWorkApi) {
    this.api = api
  }

  /**
   * The route client this store writes through.
   *
   * Exposed for the board's own picture work (a burned annotation, a crop): those
   * write to the canvas asset store, and threading a second client through every
   * mount point just to upload one image would be worse.
   */
  get client(): SeeWorkApi {
    return this.api
  }

  getSnapshot(): CanvasState {
    return this.store.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  /** Stop the autosave timer (the surface is going away). */
  dispose(): void {
    this.disposed = true
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
  }

  /** Re-read the board list; the open board is left alone. */
  async refreshList(): Promise<void> {
    const result = await this.api.canvases()
    if (this.disposed) return
    if (!result.ok) {
      this.store.update(draft => {
        draft.status = 'error'
        draft.message = result.message
      })
      return
    }
    this.store.update(draft => {
      draft.status = 'ready'
      draft.boards = result.value.canvases
      delete draft.message
    })
  }

  /**
   * Open a board.
   * @param id - board id, or '' to create a fresh one.
   * @returns the board that is now open, or undefined when it could not be opened.
   */
  async open(id = ''): Promise<CanvasDocument | undefined> {
    const result = id === '' ? await this.api.createCanvas() : await this.api.readCanvas(id)
    if (this.disposed) return undefined
    if (!result.ok) {
      this.store.update(draft => {
        draft.status = 'error'
        draft.message = result.message
      })
      return undefined
    }
    const board = result.value.canvas
    this.store.update(draft => {
      draft.board = board
      draft.dirty = false
      draft.save = 'idle'
      delete draft.message
    })
    void this.refreshList()
    return board
  }

  /** Close the open board, saving first when it has unsaved edits. */
  async close(): Promise<void> {
    if (this.store.getSnapshot().dirty) await this.saveNow()
    this.store.update(draft => {
      delete draft.board
      draft.dirty = false
      draft.save = 'idle'
      delete draft.message
    })
  }

  /** Delete a board (closing it first when it is the open one). */
  async deleteBoard(id: string): Promise<void> {
    if (this.store.getSnapshot().board?.id === id) await this.close()
    const result = await this.api.removeCanvas(id)
    if (this.disposed) return
    if (!result.ok) {
      this.store.update(draft => {
        draft.save = 'error'
        draft.message = `删除失败：${result.message}`
      })
      return
    }
    this.store.update(draft => { draft.boards = result.value.canvases })
  }

  /** Replace the board document as part of an edit. */
  private edit(mutate: (board: CanvasDocument) => void): void {
    const current = this.store.getSnapshot().board
    if (current === undefined) return
    // A shallow copy keeps React's identity checks meaningful while the nested
    // arrays are replaced by the callers that touch them.
    const next: CanvasDocument = { ...current, cards: [...current.cards] }
    mutate(next)
    this.editSeq += 1
    this.store.update(draft => {
      draft.board = next
      draft.dirty = true
      if (draft.save !== 'conflict') draft.save = 'idle'
    })
    this.scheduleSave()
  }

  /** Move, resize or restack one card. */
  updateCard(id: string, patch: Partial<CanvasCard>): void {
    this.edit(board => {
      board.cards = board.cards.map(card => card.id === id ? { ...card, ...patch } : card)
    })
  }

  /** Remove one card. */
  removeCard(id: string): void {
    this.edit(board => {
      board.cards = board.cards.filter(card => card.id !== id)
    })
  }

  /** Place new cards on the board, on top of everything already there. */
  addCards(cards: CanvasCard[]): void {
    if (cards.length === 0) return
    this.edit(board => {
      const top = board.cards.reduce((highest, card) => Math.max(highest, card.z), 0)
      board.cards = [...board.cards, ...cards.map((card, index) => ({ ...card, z: top + index + 1 }))]
    })
  }

  /** Move the viewport (and remember it). */
  setViewport(viewport: CanvasViewport): void {
    this.edit(board => { board.viewport = viewport })
  }

  /** Rename the board. */
  setTitle(title: string): void {
    this.edit(board => { board.title = title })
  }

  /** Save immediately, cancelling the debounce. */
  async saveNow(): Promise<void> {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    await this.save()
  }

  /** Queue a save after the edits settle. */
  private scheduleSave(): void {
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      void this.save()
    }, AUTOSAVE_DELAY_MS)
  }

  /**
   * Write the open board.
   *
   * A save that fails or conflicts must never lose the local edit: the document
   * stays in memory and dirty, and the user is told what happened.
   */
  private async save(): Promise<void> {
    const snapshot = this.store.getSnapshot()
    const board = snapshot.board
    if (board === undefined || !snapshot.dirty) return
    if (this.saveInFlight) {
      // Coalesce: the in-flight response re-schedules when it sees that edits
      // arrived after its request went out (see `changedSince` below).
      return
    }
    this.saveInFlight = true
    const sentAt = this.editSeq
    this.store.update(draft => { draft.save = 'saving' })
    const reading = board.revision
    const result = await this.api.saveCanvas(board, reading)
    this.saveInFlight = false
    if (this.disposed) return
    if (result.ok) {
      const changedSince = this.editSeq !== sentAt
      this.store.update(draft => {
        // The host's reply is the document it STORED, i.e. a snapshot of what
        // was sent. The local document is the working copy, so only its
        // revision comes back from that reply: adopting the echo wholesale
        // would silently drop every edit made after the request left — a
        // viewport change ("适应内容") or a card move included — and marking the
        // board clean would then stop it from ever being saved.
        if (draft.board !== undefined) {
          draft.board = { ...draft.board, revision: result.value.canvas.revision }
        }
        draft.dirty = changedSince
        draft.save = changedSince ? 'idle' : 'saved'
      })
      if (changedSince) this.scheduleSave()
      void this.refreshList()
      return
    }
    if (result.code === 'canvas_conflict') {
      // Another window saved first. The user's board stays exactly as they left
      // it — this is their working copy, and replacing it with the remote
      // document would throw their layout away. What changes is the revision we
      // fence on, which the re-read supplies; the retry then persists the
      // user's whole board, which is what "last writer wins" means for a
      // deliberately single-document board.
      const reread = await this.api.readCanvas(board.id)
      if (this.disposed) return
      const current = this.store.getSnapshot().board
      this.store.update(draft => {
        draft.save = 'conflict'
        draft.dirty = true
        draft.message = reread.ok
          ? '这块画布在别处也被改过：正在把你的版本保存为最新版本。'
          : '这块画布在别处也被改过，且重新读取失败；改动还在这里，稍后会自动重试。'
        if (reread.ok && current !== undefined) {
          draft.board = { ...current, revision: reread.value.canvas.revision }
        }
      })
      if (reread.ok) {
        // Retry immediately on the fresh revision so the user is not left
        // staring at a conflict they cannot act on.
        await this.save()
      }
      return
    }
    this.store.update(draft => {
      draft.save = 'error'
      draft.message = `保存失败：${result.message}`
      draft.dirty = true
    })
  }
}

/** A card id that does not collide with what is already on the board. */
export function unusedCardId(board: CanvasDocument | undefined): string {
  const existing = new Set((board?.cards ?? []).map(card => card.id))
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = newCardId()
    if (!existing.has(id)) return id
  }
  return `card-${Date.now().toString(36)}`
}
