/**
 * 「加到画布」: put the picture the user is looking at onto a board.
 *
 * The automatic version of this (a finished generation opening the column and
 * dropping itself onto the board) was removed on request — a background
 * generation must not rearrange the screen. What remains is the deliberate,
 * one-click version: the user says "this one", and only then does the plugin
 * place the card and bring the canvas up so the result is visible.
 *
 * The button lives on surfaces this plugin owns (the enlarged-image lightbox and
 * the conversation card), and they reach the canvas through the injected
 * {@link CanvasAddFace}: those modules are mounted inside shell render trees, so
 * they cannot import the composition root — the same reason the header launchers
 * take their controls as a face.
 *
 * Placement reuses the picker's maths (centre of the visible stage, card sized
 * to the picture's own aspect ratio) and, like the old automatic path, waits
 * briefly for the revealed board to report a usable stage: a card placed against
 * a zero stage lands in the viewport's corner.
 */

import { centeredImageCard, stageCentre, usableStage } from '../canvas-placement.ts'
import type { CanvasCardOrigin } from '../protocol.ts'
import type { LibraryStore } from './library-store.ts'
import { unusedCardId, type CanvasStore } from './canvas-store.ts'

/** How long one measurement step waits, and how many are taken before giving up. */
export const STAGE_WAIT_STEP_MS = 50
export const STAGE_WAIT_ATTEMPTS = 30

/** One picture to put on a board, as the callers know it. */
export interface CanvasAddTarget {
  /** Library file name the board's card will reference. */
  file: string
  width?: number | undefined
  height?: number | undefined
  /** Model that produced it, shown on the card. */
  model?: string | undefined
  /** Prompt snapshot, shown on the card. */
  prompt?: string | undefined
  /** Where it came from, shown as the card badge (read off the library otherwise). */
  origin?: CanvasCardOrigin | undefined
}

/** What a surface needs to offer 「加到画布」. */
export interface CanvasAddFace {
  /**
   * Place one picture and bring the canvas into view.
   * @param target - the picture to place.
   * @returns true once a card was added.
   */
  add: (target: CanvasAddTarget) => Promise<boolean>
}

/** The face in force, or undefined while the composition root has not set one. */
let face: CanvasAddFace | undefined

/**
 * Install the face the surfaces call.
 * @param next - the face, or undefined to remove it.
 * @returns disposer restoring the previous face.
 */
export function setCanvasAddFace(next: CanvasAddFace | undefined): () => void {
  const previous = face
  face = next
  return () => { face = previous }
}

/** Whether 「加到画布」 can do anything right now (surfaces hide the button when not). */
export function canvasAddAvailable(): boolean {
  return face !== undefined
}

/**
 * Ask for one picture to be placed.
 *
 * Fire-and-forget by design: a click on a button must not make the caller wait,
 * and a failure leaves the picture exactly where it already is — in the library,
 * which is where the user would look for it anyway.
 *
 * @param target - the picture to place.
 */
export function addToCanvas(target: CanvasAddTarget): void {
  const current = face
  if (current === undefined) return
  void current.add(target).catch(() => {})
}

/** What the controller needs from the composition root. */
export interface CanvasAddDeps {
  library: LibraryStore
  canvas: CanvasStore
  /** Bring the canvas into view (right-sidebar tab, or the floating overlay). */
  reveal: () => void
  /** Visible stage size, measured from the board that is actually on screen. */
  stageSize: () => { width: number; height: number }
  /** Sleep seam; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Build the face the surfaces use.
 * @param deps - both stores, how to reveal the canvas, and the stage measurement.
 * @returns the face.
 */
export function createCanvasAddFace(deps: CanvasAddDeps): CanvasAddFace {
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => { setTimeout(resolve, ms) }))

  /** An open board, creating one when the user has none yet. */
  const openBoard = async (): Promise<void> => {
    if (deps.canvas.getSnapshot().board !== undefined) return
    await deps.canvas.refreshList()
    const first = deps.canvas.getSnapshot().boards[0]
    // 'open' with an empty id creates a board; the canvas tab would do the same
    // a moment later, so an empty deployment behaves like a fresh canvas.
    await deps.canvas.open(first?.id ?? '')
  }

  /**
   * Wait briefly for the board on screen to report its size.
   *
   * Counted in attempts rather than wall-clock: the step is the same 50 ms either
   * way, and a caller that injects `sleep` (tests) drives it without real time.
   */
  const waitForStage = async (): Promise<void> => {
    for (let attempt = 0; attempt < STAGE_WAIT_ATTEMPTS; attempt += 1) {
      const size = deps.stageSize()
      if (size.width > 0 && size.height > 0) return
      await sleep(STAGE_WAIT_STEP_MS)
    }
  }

  /** Fill in anything the caller did not know, from the library record. */
  const complete = (target: CanvasAddTarget): CanvasAddTarget => {
    if (target.width !== undefined && target.height !== undefined && target.origin !== undefined) return target
    const entry = deps.library.getSnapshot().entries.find(candidate =>
      candidate.images.some(image => image.file === target.file))
    if (entry === undefined) return target
    const image = entry.images.find(candidate => candidate.file === target.file)
    return {
      ...target,
      width: target.width ?? image?.width,
      height: target.height ?? image?.height,
      model: target.model ?? entry.model,
      prompt: target.prompt ?? entry.prompt,
      origin: target.origin ?? (entry.source === 'panel' ? 'panel' : 'chat'),
    }
  }

  return {
    async add(target) {
      await openBoard()
      // Reveal BEFORE placing: the card goes to the middle of what is on screen,
      // and only a board that is up can say how big that is.
      deps.reveal()
      await waitForStage()
      const board = deps.canvas.getSnapshot().board
      if (board === undefined) return false
      const picture = complete(target)
      const centre = stageCentre(board.viewport, usableStage(deps.stageSize()))
      deps.canvas.addCards([centeredImageCard({
        file: picture.file,
        width: picture.width,
        height: picture.height,
        model: picture.model,
        prompt: picture.prompt,
        origin: picture.origin,
      }, centre, unusedCardId(board))])
      // Persist right away: the user is watching the board, and the next thing
      // they may do is close the panel.
      await deps.canvas.saveNow()
      return true
    },
  }
}

/**
 * The library file a plugin image URL serves, when it is one.
 * @param src - an image URL (relative or absolute).
 * @returns the file name, or undefined for another route.
 */
export function libraryFileFromUrl(src: string): string | undefined {
  const marker = '/api/dsh-seework/library/image/'
  const at = src.indexOf(marker)
  if (at < 0) return undefined
  const file = src.slice(at + marker.length).split(/[?#]/)[0] ?? ''
  try {
    return file === '' ? undefined : decodeURIComponent(file)
  } catch {
    return undefined
  }
}
