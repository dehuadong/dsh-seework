/**
 * The SeeWork canvas: a free spatial board.
 *
 * Deliberately not a node graph — there are no ports and no connections. A card
 * is a rectangle at a coordinate; the user arranges pictures and notes by hand,
 * which is what SeeAI TV's board does and what the user asked for. Cards come
 * from the material library (the images already generated) or are plain notes.
 *
 * All pointer handling goes through `canvas-viewport`'s linear map, so dragging
 * and zooming stay correct at any zoom level instead of drifting.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CANVAS_NEW_IMAGE_SIZE } from '../canvas-limits.ts'
import { centeredImageCard, stageCentre } from '../canvas-placement.ts'
import { boardToScreen, fitViewport, panBy, zoomAt, zoomTo } from '../canvas-viewport.ts'
import { canvasImageUrl, canvasOriginLabel, type CanvasCard, type CanvasCardOrigin, type CanvasViewport, type LibraryEntry } from '../protocol.ts'
import { AnnotationEditor } from './AnnotationEditor.tsx'
import { CropOverlay } from './CropOverlay.tsx'
import { burnAnnotations, burnCrop } from './burn-image.ts'
import { attachmentNameFor, sendImageToConversation } from './composer-draft.ts'
import { cropNodePosition, croppedNodeSize, type CropRect } from './crop-rect.ts'
import { NodeFloatingBar } from './NodeFloatingBar.tsx'
import { Button, TextInput } from './controls.tsx'
import { unusedCardId, type CanvasState, type CanvasStore } from './canvas-store.ts'
import type { CanvasStore as CanvasStoreType } from './canvas-store.ts'
import { isUploadableImage, readImageDataUrl } from './canvas-upload.ts'
import css from './canvas.module.css'

/** How far a click must travel before it counts as a drag. */
const DRAG_THRESHOLD_PX = 3

/** Gap between pictures uploaded in one go, in board pixels. */
const UPLOAD_GAP_PX = 24

/** How much of a card must be on screen before the layer list leaves the view alone. */
const LAYER_REVEAL_MARGIN = 24

/**
 * How long a housekeeping notice stays up.
 *
 * It reports a finished action ("已清理 4 张…"), not a state the user has to keep
 * reading — a notice bar that never goes away just eats the board (user report:
 * 「一直存在提示条，不消失」).
 */
export const NOTICE_MS = 4000

/** A byte count for a notice, e.g. `12.4 MB`. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * What the ✕ on one card promises.
 *
 * Only the board's own pictures are deleted with the card; a library picture is
 * the record of a generation, and saying otherwise would be a lie the user acts on.
 *
 * @param card - the card about to be removed.
 * @returns the tooltip text.
 */
function removeHint(card: CanvasCard): string {
  // A board-owned picture takes its file with it — but an uploaded one is not a
  // composite, and calling it one would be a lie the user acts on.
  if (card.source === 'canvas') {
    return card.origin === 'upload'
      ? '从画布移除（这张上传图片的文件也会一起删掉）'
      : '从画布移除（这张合成图的文件也会一起删掉）'
  }
  if (card.kind === 'image') return '从画布移除（不会删除素材库里的文件）'
  return '从画布移除'
}

/**
 * One line of the layer list.
 * @param card - the card.
 * @returns a short description (its prompt, its note, or its file name).
 */
function layerName(card: CanvasCard): string {
  const text = (card.kind === 'text' ? card.text : card.prompt) ?? ''
  const trimmed = text.trim()
  if (trimmed !== '') return trimmed
  return card.kind === 'text' ? '（空备注）' : card.file ?? '图片'
}

/**
 * Visible stage size per board store, as the board last measured it.
 *
 * The conversation's 「加到画布」 runs outside any board render, so the size is
 * recorded here instead of being asked of the DOM from there.
 */
const stageSizes = new WeakMap<object, { width: number; height: number }>()

/**
 * Record the stage size the board just measured.
 * @param store - the board's store.
 * @param size - the stage size in screen pixels.
 */
export function publishStageSize(store: CanvasStoreType, size: { width: number; height: number }): void {
  stageSizes.set(store, size)
}

/**
 * The last stage size a board measured.
 * @param store - the board's store.
 * @returns the size, or zeros before the board has rendered.
 */
export function stageSizeFor(store: CanvasStoreType): { width: number; height: number } {
  return stageSizes.get(store) ?? { width: 0, height: 0 }
}

/** Pointer gesture currently in progress. */
type Gesture =
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'move'; cardId: string; startX: number; startY: number; cardX: number; cardY: number; moved: boolean }
  | { kind: 'resize'; cardId: string; startX: number; startY: number; width: number; height: number; moved: boolean }

/** Props for the canvas workspace. */
export interface CanvasBoardProps {
  store: CanvasStore
  /** The material library, for picking pictures to place. */
  library: { entries: LibraryEntry[] }
  /** Load the library (the picker needs it even if the drawer was never opened). */
  onNeedLibrary: () => void
}

/** One node's rectangle in stage (screen) coordinates. */
function nodeScreenRect(
  card: CanvasCard,
  viewport: CanvasViewport,
): { x: number; y: number; width: number; height: number } {
  const topLeft = boardToScreen(viewport, card.x, card.y)
  return { x: topLeft.x, y: topLeft.y, width: card.width * viewport.k, height: card.height * viewport.k }
}

/** A new node's board size for one burned picture: its own aspect, comparable width. */
function sizeKeepingAspect(
  referenceWidth: number,
  width: number,
  height: number,
): { width: number; height: number } {
  const aspect = height === 0 ? 1 : width / height
  const nodeWidth = Math.max(64, Math.min(480, referenceWidth))
  return { width: Math.round(nodeWidth), height: Math.round(nodeWidth / aspect) }
}

/** Read a burned data URL's real pixel size (the new node is sized from it). */
async function loadBurnedSize(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise(resolve => {
    const image = new Image()
    image.onload = () => { resolve({ dataUrl, width: image.naturalWidth, height: image.naturalHeight }) }
    image.onerror = () => { resolve({ dataUrl, width: 0, height: 0 }) }
    image.src = dataUrl
  })
}

/** The canvas workspace: toolbar + board + library picker. */export function CanvasBoard({ store, library, onNeedLibrary }: CanvasBoardProps): JSX.Element {
  const [tick, setTick] = useState(0)
  useEffect(() => store.subscribe(() => { setTick(value => value + 1) }), [store])
  void tick
  const state = store.getSnapshot()
  const board = state.board
  const api = store.client

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const [gestureTick, setGestureTick] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  /** The card whose marks are being edited (modal), or undefined. */
  const [annotating, setAnnotating] = useState<string | undefined>(undefined)
  /** The card in crop mode (in place), or undefined. */
  const [cropping, setCropping] = useState<string | undefined>(undefined)
  /** The picture behind the active edit mode, with the size it really is. */
  const [modePicture, setModePicture] = useState<{ url: string; natural: { width: number; height: number } } | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  /** What the last housekeeping action did (or why it failed). */
  const [assetNotice, setAssetNotice] = useState<string | undefined>(undefined)
  const noticeTimer = useRef<number | undefined>(undefined)
  /** Show a housekeeping notice, replacing any previous one (and any pending fade). */
  const showAssetNotice = useCallback((text: string): void => {
    if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current)
    setAssetNotice(text)
    noticeTimer.current = window.setTimeout(() => {
      noticeTimer.current = undefined
      setAssetNotice(undefined)
    }, NOTICE_MS)
  }, [])
  useEffect(() => () => {
    if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current)
  }, [])
  /** Whether the compact layer list is open. */
  const [layersOpen, setLayersOpen] = useState(false)
  /**
   * The board's right-click menu: where it is, in stage coordinates, and the card
   * it was opened on (absent when it was opened on the board's own space).
   */
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number; cardId?: string } | undefined>(undefined)
  /** The picture being looked at enlarged, or undefined. */
  const [zoomCard, setZoomCard] = useState<CanvasCard | undefined>(undefined)
  /** The hidden picker the menu's upload item opens. */
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  // Escape puts the board's menu away, like every other transient surface here.
  useEffect(() => {
    if (canvasMenu === undefined) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setCanvasMenu(undefined)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [canvasMenu])

  // Escape closes the enlarged picture too; it is the same kind of transient
  // surface as the menu above.
  useEffect(() => {
    if (zoomCard === undefined) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setZoomCard(undefined)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [zoomCard])

  /**
   * Open one edit mode for a card.
   *
   * The picture's natural size decides the coordinate system both modes work in
   * (marks and the crop box are stored in picture pixels), and only the loaded
   * image knows it — a card's board size is whatever the user dragged it to.
   */
  const openMode = (kind: 'annotate' | 'crop', card: CanvasCard): void => {
    const file = card.file ?? ''
    if (file === '') return
    const url = canvasImageUrl(file, card.source)
    const enter = (natural: { width: number; height: number }): void => {
      setModePicture({ url, natural })
      if (kind === 'annotate') setAnnotating(card.id)
      else setCropping(card.id)
    }
    const image = new Image()
    image.onload = () => { enter({ width: image.naturalWidth || card.width, height: image.naturalHeight || card.height }) }
    image.onerror = () => { enter({ width: card.width, height: card.height }) }
    image.src = url
  }

  /** Leave whichever edit mode is open. */
  const closeMode = (): void => {
    setAnnotating(undefined)
    setCropping(undefined)
    setModePicture(undefined)
  }

  /**
   * Turn one burned picture into a new card on the board.
   *
   * The composite goes to the canvas asset store — deliberately not the material
   * library — and the card says so (`source: 'canvas'` + its `origin`), so a
   * marked-up copy can never be mistaken for a generation.
   */
  const addBurnedCard = async (burned: { dataUrl: string; width: number; height: number }, placement: { x: number; y: number; width: number; height: number }, origin: 'annotation' | 'crop'): Promise<void> => {
    const current = store.getSnapshot().board
    if (current === undefined) return
    const label = canvasOriginLabel(origin) ?? '合成图'
    setBusy(true)
    try {
      const result = await api.writeCanvasAsset(burned.dataUrl)
      if (!result.ok) {
        console.warn('[dsh-seework] storing the marked-up picture failed:', result.message)
        return
      }
      store.addCards([{
        id: unusedCardId(current),
        kind: 'image',
        x: Math.round(placement.x),
        y: Math.round(placement.y),
        width: Math.round(placement.width),
        height: Math.round(placement.height),
        z: 0,
        file: result.value.image.file,
        source: 'canvas',
        origin,
        model: label,
        prompt: label,
      }])
      await store.saveNow()
    } finally {
      setBusy(false)
    }
  }

  const viewport = board?.viewport ?? { x: 0, y: 0, k: 1 }
  // A gesture mutates the viewport through the store, so the render below is
  // already up to date; gestureTick only exists to re-render the cursor state.
  void gestureTick

  // Stage size, used by "fit", by placement maths, and by the automatic
  // placement the plugin runs when a generation lands while the canvas is open
  // (that path has no DOM access of its own, so the size is recorded here).
  const stageRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  /**
   * The visible stage size, measured NOW.
   *
   * Measuring on demand matters: the recorded value can be a stale zero (this
   * board has not been laid out yet, or a hidden sibling — the floating overlay
   * and the sidebar tab share one store — measured 0×0 and overwrote it). A
   * zero here used to mean "fit" silently reset the view to 100% at the origin,
   * which reads to the user as "my pictures disappeared".
   */
  const stageSize = useCallback((): { width: number; height: number } => {
    const surface = surfaceRef.current
    if (surface === null) return stageRef.current
    const width = surface.offsetWidth
    const height = surface.offsetHeight
    return width > 0 && height > 0 ? { width, height } : stageRef.current
  }, [])

  // Measure the stage without ever measuring the transformed world layer: its
  // client rect already includes the zoom, and fitting against that feeds the
  // zoom back in on every press.
  useEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return
    const measure = (): void => {
      const size = { width: surface.offsetWidth, height: surface.offsetHeight }
      stageRef.current = size
      // Never publish a zero: a hidden sibling board would otherwise wipe the
      // size a visible one reported, and a placement that reads it would aim at
      // the viewport's corner instead of its middle.
      if (size.width > 0 && size.height > 0) publishStageSize(store, size)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(surface)
    return () => { observer.disconnect() }
  }, [store])

  /** Zoom one step around the stage centre (a toolbar press, not a cursor). */
  const zoomCentre = useCallback((direction: 1 | -1): void => {
    if (board === undefined) return
    const { width, height } = stageSize()
    if (width <= 0 || height <= 0) return
    store.setViewport(zoomAt(board.viewport, direction, width / 2, height / 2))
  }, [board, stageSize, store])

  /** Zoom to an exact factor around the stage centre. */
  const zoomExact = useCallback((k: number): void => {
    if (board === undefined) return
    const { width, height } = stageSize()
    if (width <= 0 || height <= 0) return
    store.setViewport(zoomTo(board.viewport, k, width / 2, height / 2))
  }, [board, stageSize, store])

  /**
   * Show everything on the board.
   *
   * A board with nothing to fit against is left alone rather than reset: the
   * degenerate fit returns the identity viewport, which throws away wherever
   * the user had scrolled to.
   */
  const fit = useCallback((): void => {
    if (board === undefined) return
    const { width, height } = stageSize()
    if (width <= 0 || height <= 0 || board.cards.length === 0) return
    store.setViewport(fitViewport(board.cards, width, height))
  }, [board, stageSize, store])

  // Wheel zoom: the board point under the cursor stays under the cursor.
  useEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return
    const onWheel = (event: WheelEvent): void => {
      if (board === undefined) return
      event.preventDefault()
      const bounds = surface.getBoundingClientRect()
      const anchorX = event.clientX - bounds.left
      const anchorY = event.clientY - bounds.top
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08
      const current = store.getSnapshot().board?.viewport
      if (current === undefined) return
      store.setViewport(zoomTo(current, current.k * factor, anchorX, anchorY))
    }
    surface.addEventListener('wheel', onWheel, { passive: false })
    return () => { surface.removeEventListener('wheel', onWheel) }
  }, [board, store])

  // Global pointer handlers for the active gesture: the pointer can leave the
  // card (or the stage) mid-drag and must keep working.
  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const gesture = gestureRef.current
      const current = store.getSnapshot().board
      if (gesture === null || current === undefined) return
      if (gesture.kind === 'pan') {
        // Pan by the step between this event and the previous one, never by the
        // total distance from the gesture's start. The current viewport is read
        // fresh each time, so a second handler (or a replayed event) can only
        // re-apply the same step to an already-advanced viewport: the board
        // races away under the pointer instead of following it.
        store.setViewport(panBy(current.viewport, event.clientX - gesture.lastX, event.clientY - gesture.lastY))
        gesture.lastX = event.clientX
        gesture.lastY = event.clientY
        return
      }
      const dx = (event.clientX - gesture.startX) / current.viewport.k
      const dy = (event.clientY - gesture.startY) / current.viewport.k
      if (gesture.kind === 'move') {
        if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < DRAG_THRESHOLD_PX) return
        gesture.moved = true
        store.updateCard(gesture.cardId, { x: Math.round(gesture.cardX + dx), y: Math.round(gesture.cardY + dy) })
        return
      }
      gesture.moved = true
      store.updateCard(gesture.cardId, {
        width: Math.max(24, Math.round(gesture.width + dx)),
        height: Math.max(24, Math.round(gesture.height + dy)),
      })
    }
    const onUp = (): void => {
      const gesture = gestureRef.current
      gestureRef.current = null
      setGestureTick(value => value + 1)
      if (gesture !== null && gesture.kind !== 'pan' && gesture.moved) void store.saveNow()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [store])

  // Delete removes the selected card; Escape drops the selection.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (selected === undefined) return
      const target = event.target as HTMLElement | null
      const typing = target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (typing) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        store.removeCard(selected)
        setSelected(undefined)
        void store.saveNow()
      }
      if (event.key === 'Escape') setSelected(undefined)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [selected, store])

  const beginPan = (event: React.PointerEvent<HTMLDivElement>): void => {
    // Any press on the board puts the menu away, whichever button it came from:
    // a right-click reopens it where the cursor now is (see `openCanvasMenu`).
    setCanvasMenu(undefined)
    if (event.button !== 0) return
    // Pressing the board puts the work back on the board: the layer list is a
    // look-up aid, not a panel that stays in the way (user report: 「图层展开后，
    // 再画布点击后应该消失，现在一直占着」). Presses inside the list itself stop
    // propagation, so reading it does not close it.
    setLayersOpen(false)
    // Only the empty surface pans; a card's own handler stops propagation.
    const target = event.target as HTMLElement
    if (target.closest('[data-seework-card]') !== null) return
    setSelected(undefined)
    gestureRef.current = {
      kind: 'pan',
      lastX: event.clientX,
      lastY: event.clientY,
    }
    setGestureTick(value => value + 1)
  }

  const beginMove = (event: React.PointerEvent<HTMLElement>, card: CanvasCard): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    setSelected(card.id)
    gestureRef.current = {
      kind: 'move',
      cardId: card.id,
      startX: event.clientX,
      startY: event.clientY,
      cardX: card.x,
      cardY: card.y,
      moved: false,
    }
    setGestureTick(value => value + 1)
  }

  const beginResize = (event: React.PointerEvent<HTMLElement>, card: CanvasCard): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    gestureRef.current = {
      kind: 'resize',
      cardId: card.id,
      startX: event.clientX,
      startY: event.clientY,
      width: card.width,
      height: card.height,
      moved: false,
    }
    setGestureTick(value => value + 1)
  }

  /** Place a library picture in the middle of the current view. */
  const placeImage = useCallback((entry: LibraryEntry, imageIndex = 0): void => {
    if (board === undefined) return
    const image = entry.images[imageIndex]
    if (image === undefined) return
    const centre = stageCentre(board.viewport, stageSize())
    // Keep the picture's own aspect ratio; the card is sized to the picture,
    // not the picture squashed into a default card. The geometry comes from
    // `canvas-placement`, which the automatic placement shares.
    store.addCards([centeredImageCard({
      file: image.file,
      width: image.width,
      height: image.height,
      model: entry.model,
      prompt: entry.prompt,
      origin: entry.source === 'panel' ? 'panel' : 'chat',
    }, centre, unusedCardId(board))])
    setSelected(undefined)
    setPickerOpen(false)
  }, [board, stageSize, store])

  /** Add a note in the middle of the current view. */
  const addNote = useCallback((): void => {
    if (board === undefined) return
    const centre = stageCentre(board.viewport, stageSize())
    const id = unusedCardId(board)
    store.addCards([{
      id,
      kind: 'text',
      x: Math.round(centre.x - 120),
      y: Math.round(centre.y - 50),
      width: 240,
      height: 100,
      z: 0,
      text: '',
      fontSize: 16,
    }])
    setSelected(id)
  }, [board, stageSize, store])

  const boardCards = useMemo(() => [...(board?.cards ?? [])].sort((left, right) => left.z - right.z), [board?.cards])

  /**
   * Open the board's own menu where the user right-clicked.
   *
   * The menu follows what was under the cursor: on a picture it offers that
   * picture's own action, and on the board's space it offers to put a new picture
   * there. One surface for both, so closing it, Escape and repositioning behave
   * the same way whichever was opened.
   */
  const openCanvasMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    // The browser's own menu would otherwise cover this one.
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const cardId = (event.target as HTMLElement).closest('[data-seework-card]')?.getAttribute('data-seework-card') ?? undefined
    setCanvasMenu({
      x: Math.round(event.clientX - rect.left),
      y: Math.round(event.clientY - rect.top),
      ...cardId === undefined ? {} : { cardId },
    })
  }

  /**
   * Show one picture's file in the host's file manager.
   *
   * The board holds a file name, not a path: where the picture really lives is
   * the host's business, and it is the host that opens the folder. A failure is
   * reported rather than swallowed — the user asked for a window to appear.
   */
  const revealPicture = useCallback(async (card: CanvasCard): Promise<void> => {
    const file = card.file
    if (file === undefined || file === '') return
    const result = await api.revealImage(file, card.source ?? 'library')
    if (!result.ok) showAssetNotice(`打开文件所在位置失败：${result.message}`)
  }, [api, showAssetNotice])

  /**
   * Put the pictures the user picked onto the board.
   *
   * Each file becomes its own canvas asset and its own card, laid out in a row
   * across the middle of the view — the same place 「从素材库添加」 puts one, so
   * an upload never lands off-screen. A file that is not a PNG or a JPEG is
   * named in a notice instead of being written.
   */
  const uploadImages = useCallback(async (files: readonly File[]): Promise<void> => {
    if (files.length === 0) return
    const refused = files.filter(file => !isUploadableImage(file))
    if (refused.length > 0) {
      showAssetNotice(`只支持 PNG / JPEG：${refused.map(file => file.name).join('、')} 没有上传。`)
    }
    const accepted = files.filter(isUploadableImage)
    if (accepted.length === 0) return
    const current = store.getSnapshot().board
    if (current === undefined) return
    setBusy(true)
    try {
      const centre = stageCentre(current.viewport, stageSize())
      const label = canvasOriginLabel('upload') ?? '上传素材'
      let placed = 0
      for (const file of accepted) {
        const dataUrl = await readImageDataUrl(file)
        if (dataUrl === undefined) {
          showAssetNotice(`「${file.name}」读不出来，没有上传。`)
          continue
        }
        const result = await api.writeCanvasAsset(dataUrl)
        if (!result.ok) {
          showAssetNotice(`「${file.name}」没存上：${result.message}`)
          continue
        }
        // Re-read the board each round: the id has to miss what the previous
        // round just added. `centeredImageCard` owns the sizing, so a slot here
        // is only a centre point.
        const boardNow = store.getSnapshot().board
        if (boardNow === undefined) return
        const offset = (placed - (accepted.length - 1) / 2) * (CANVAS_NEW_IMAGE_SIZE + UPLOAD_GAP_PX)
        const image = result.value.image
        store.addCards([centeredImageCard({
          file: image.file,
          source: 'canvas',
          width: image.width,
          height: image.height,
          model: label,
          prompt: label,
          origin: 'upload',
        }, { x: centre.x + offset, y: centre.y }, unusedCardId(boardNow))])
        placed += 1
      }
      if (placed > 0) await store.saveNow()
    } finally {
      setBusy(false)
    }
  }, [api, showAssetNotice, stageSize, store])

  /**
   * Selecting a card also lifts it to the front.
   *
   * New cards land on top of everything (`addCards`), so without this a card you
   * click in order to move it can sit under pictures that were added later and be
   * impossible to drag out from underneath them. Only a card that is not already
   * on top is restacked, so clicking around does not rewrite the document.
   */
  const selectCard = useCallback((card: CanvasCard): void => {
    setSelected(card.id)
    const cards = store.getSnapshot().board?.cards ?? []
    const top = cards.reduce((highest, item) => Math.max(highest, item.z), card.z)
    if (card.z < top) store.updateCard(card.id, { z: top + 1 })
  }, [store])

  /**
   * Where one card's picture came from, for its badge.
   *
   * Cards written before the `origin` field existed have none, so it is inferred:
   * a board's own picture is a composite (its label says which kind), and a
   * library picture is looked up in the library the panel already holds.
   */
  const originOf = useCallback((card: CanvasCard): CanvasCardOrigin | undefined => {
    if (card.origin !== undefined) return card.origin
    if (card.source === 'canvas') return card.model === '裁剪' || card.model === '裁剪合成' ? 'crop' : 'annotation'
    for (const entry of library.entries) {
      if (entry.images.some(image => image.file === card.file)) return entry.source === 'panel' ? 'panel' : 'chat'
    }
    return undefined
  }, [library.entries])

  /**
   * Remove one card, and the file behind it when the board owns that file.
   *
   * The order matters: the board has to stop referencing the picture — and say so
   * on disk — before the delete route will agree to drop it, which is also what
   * keeps a second board's copy safe.
   */
  const removeCard = useCallback((card: CanvasCard): void => {
    store.removeCard(card.id)
    setSelected(undefined)
    void (async () => {
      await store.saveNow()
      if (card.source !== 'canvas' || card.file === undefined) return
      const result = await api.removeCanvasAsset(card.file)
      if (!result.ok) {
        showAssetNotice(`卡片已移除，但它的合成图文件没删掉：${result.message}`)
        return
      }
      showAssetNotice(result.value.removed === 0 ? '卡片已移除（合成图文件之前就不在了）。' : '卡片和它的合成图文件都已删除。')
    })()
  }, [api, store])

  /** Drop every board picture no card shows any more. */
  const pruneAssets = useCallback((): void => {
    void (async () => {
      const result = await api.pruneCanvasAssets()
      if (!result.ok) {
        showAssetNotice(`清理失败：${result.message}`)
        return
      }
      const { removed, bytes } = result.value
      showAssetNotice(removed === 0 ? '没有可清理的图片。' : `已清理 ${removed} 张没有用到的图片，释放 ${formatBytes(bytes)}。`)
    })()
  }, [api])

  /**
   * Pick one card from the layer list: select it, raise it, and bring it into view.
   *
   * A card that is completely covered by others cannot be clicked on the board at
   * all, so the list is the way back to it — and a card that is off-screen would be
   * selected invisibly, so the view follows it there too.
   */
  const pickFromLayers = useCallback((card: CanvasCard): void => {
    selectCard(card)
    const stage = stageSize()
    if (stage.width === 0 || stage.height === 0) return
    const centreX = card.x + card.width / 2
    const centreY = card.y + card.height / 2
    const screen = boardToScreen(viewport, centreX, centreY)
    const inside = screen.x > LAYER_REVEAL_MARGIN
      && screen.x < stage.width - LAYER_REVEAL_MARGIN
      && screen.y > LAYER_REVEAL_MARGIN
      && screen.y < stage.height - LAYER_REVEAL_MARGIN
    if (inside) return
    store.setViewport({
      ...viewport,
      x: Math.round(stage.width / 2 - centreX * viewport.k),
      y: Math.round(stage.height / 2 - centreY * viewport.k),
    })
  }, [selectCard, stageSize, store, viewport])

  /**
   * The selected card, when it is a picture the bar can act on. A note card has
   * no picture to send anywhere, so it gets no bar.
   */
  const selectedImageCard = useMemo(() => {
    if (selected === undefined) return undefined
    const card = board?.cards.find(candidate => candidate.id === selected)
    return card === undefined || card.kind !== 'image' || (card.file ?? '') === '' ? undefined : card
  }, [board?.cards, selected])
  /** The cards the two edit modes belong to, if they still exist. */
  const cropCard = board?.cards.find(candidate => candidate.id === cropping)
  const annotateCard = board?.cards.find(candidate => candidate.id === annotating)

  if (state.status === 'loading' && board === undefined) {
    return <p className={css.muted}>正在读取画布…</p>
  }
  if (board === undefined) {
    return <p className={css.muted}>{state.message ?? '没有打开的画布。'}</p>
  }

  const gridSize = 32 * viewport.k

  return (
    <div className={css.workspace}>
      <div className={css.toolbar}>
        <strong className={css.boardTitle} title="更换画布请用左侧列表">{board.title}</strong>
        <Button onClick={() => { zoomCentre(-1) }} title="缩小">−</Button>
        <span className={css.zoomLabel}>{Math.round(viewport.k * 100)}%</span>
        <Button onClick={() => { zoomCentre(1) }} title="放大">＋</Button>
        <Button onClick={() => { zoomExact(1) }} title="回到 100%">100%</Button>
        <Button onClick={fit} title="让全部内容可见">适应内容</Button>
        <span className={css.toolbarGap} />
        <Button onClick={addNote}>加备注</Button>
        <Button
          onClick={() => { setLayersOpen(open => !open) }}
          title="按图层从下到上列出板上的卡片；点一行就选中它并提到最上层"
          data-dsh-seework-layers-toggle=""
        >
          图层
        </Button>
        <Button onClick={pruneAssets} title="删掉板上没有任何卡片引用的画布图片（标注/裁剪合成图、上传的图片）">清理无用图片</Button>
        <Button
          variant="primary"
          onClick={() => {
            onNeedLibrary()
            setPickerOpen(open => !open)
          }}
        >
          从素材库添加
        </Button>
        <SaveState save={state.save} dirty={state.dirty} />
      </div>

      {assetNotice === undefined ? null : <p className={css.notice}>{assetNotice}</p>}

      {state.message !== undefined && state.save !== 'error'
        ? <p className={css.notice}>{state.message}</p>
        : null}

      <div
        className={css.surface}
        ref={surfaceRef}
        data-dsh-seework-board=""
        onPointerDown={beginPan}
        onContextMenu={openCanvasMenu}
        style={{ cursor: gestureRef.current?.kind === 'pan' ? 'grabbing' : 'default' }}
      >
        <div
          className={css.grid}
          style={{ backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px` }}
        />
        <div className={css.world} style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` }}>
          {boardCards.map(card => (
            <CardView
              key={card.id}
              card={card}
              selected={selected === card.id}
              onSelect={() => { selectCard(card) }}
              onBeginMove={event => { beginMove(event, card) }}
              onBeginResize={event => { beginResize(event, card) }}
              onZoom={() => { setZoomCard(card) }}
              onText={text => { store.updateCard(card.id, { text }) }}
              onRemove={() => { removeCard(card) }}
              badge={canvasOriginLabel(originOf(card))}
              removeHint={removeHint(card)}
            />
          ))}
        </div>
        {/* The layer list. A card buried under others cannot be clicked on the board
            at all, so this is the way back to it — and the only place the whole
            board's stacking order is visible at once. Top of the stack first. */}
        {layersOpen
          ? (
            <div
              className={css.layers}
              data-dsh-seework-layers=""
              role="list"
              aria-label="图层"
              onPointerDown={event => { event.stopPropagation() }}
            >
              <p className={css.layersHead}>图层（上面的是最上层）</p>
              {[...boardCards].reverse().map((card, index) => (
                <button
                  key={card.id}
                  type="button"
                  role="listitem"
                  className={[css.layerRow, selected === card.id ? css.layerRowActive : ''].filter(Boolean).join(' ')}
                  data-seework-layer-row={card.id}
                  data-seework-layer-active={selected === card.id ? 'true' : undefined}
                  onPointerDown={event => { event.stopPropagation() }}
                  onClick={() => { pickFromLayers(card) }}
                >
                  <span className={css.layerIndex}>{index + 1}</span>
                  <span className={css.layerBadge}>{card.kind === 'image' ? canvasOriginLabel(originOf(card)) ?? '图片' : '备注'}</span>
                  <span className={css.layerName}>{layerName(card)}</span>
                </button>
              ))}
            </div>
          )
          : null}

        {/* The command bar for the selected picture. It is HTML over the board,
            so it keeps its size at every zoom and never scales with the world.
            Hidden while an edit mode is open: those modes own the picture. */}
        {selectedImageCard === undefined || annotating !== undefined || cropping !== undefined
          ? null
          : (
            <NodeFloatingBar
              node={selectedImageCard}
              viewport={viewport}
              stageSize={stageSize()}
              onAddToConversation={() => {
                const file = selectedImageCard.file ?? ''
                if (file === '') return false
                return sendImageToConversation({
                  url: canvasImageUrl(file, selectedImageCard.source),
                  name: attachmentNameFor(file),
                })
              }}
              onAnnotate={() => { openMode('annotate', selectedImageCard) }}
              onCrop={() => { openMode('crop', selectedImageCard) }}
            />
          )}

        {/* Crop mode draws over the node in SCREEN coordinates, so its box and
            handles keep a constant size while the board is zoomed. */}
        {cropCard === undefined || modePicture === undefined
          ? null
          : (
            <CropOverlay
              node={nodeScreenRect(cropCard, viewport)}
              natural={modePicture.natural}
              onCancel={closeMode}
              onConfirm={rect => {
                void (async () => {
                  const burned = await burnCrop(modePicture.url, rect)
                  if (burned === undefined) return
                  const size = croppedNodeSize(rect)
                  const position = cropNodePosition(cropCard, size)
                  await addBurnedCard(burned, { ...position, ...size }, 'crop')
                  closeMode()
                })()
              }}
            />
          )}

        {/* The board's own menu. HTML over the board, in stage coordinates, so
            it keeps its size at every zoom and never scales with the world. What
            it offers depends on what was right-clicked. */}
        {canvasMenu === undefined
          ? null
          : (
            <div
              className={css.boardMenu}
              data-dsh-seework-canvas-menu=""
              role="group"
              aria-label={canvasMenu.cardId === undefined ? '画布菜单' : '图片菜单'}
              style={{ left: canvasMenu.x, top: canvasMenu.y }}
              onPointerDown={event => { event.stopPropagation() }}
            >
              {canvasMenu.cardId === undefined
                ? (
                  <button
                    type="button"
                    className={css.boardMenuItem}
                    onClick={() => {
                      setCanvasMenu(undefined)
                      uploadInputRef.current?.click()
                    }}
                  >
                    上传图片素材
                  </button>
                )
                : (
                  <button
                    type="button"
                    className={css.boardMenuItem}
                    onClick={() => {
                      const card = boardCards.find(entry => entry.id === canvasMenu.cardId)
                      setCanvasMenu(undefined)
                      if (card !== undefined) void revealPicture(card)
                    }}
                  >
                    打开文件所在位置
                  </button>
                )}
            </div>
          )}

        {/* The picker the menu's upload item opens. It stays out of the layout
            and out of the pointer's way; only that item clicks it. */}
        <input
          ref={uploadInputRef}
          className={css.uploadInput}
          data-dsh-seework-upload-input=""
          type="file"
          accept="image/png,image/jpeg"
          multiple
          onChange={event => {
            const picked = [...(event.target.files ?? [])]
            // Clearing it lets the same file be picked twice in a row.
            event.target.value = ''
            void uploadImages(picked)
          }}
        />
      </div>

      {/* One picture, enlarged. The same bounded panel as the annotation editor:
          the pane can be stretched to the whole window (分栏 / 全屏), and a
          picture that stretched with it would be no easier to look at. */}
      {zoomCard === undefined
        ? null
        : (
          <div
            className={css.zoomOverlay}
            data-dsh-seework-canvas-zoom=""
            role="dialog"
            aria-modal="true"
            aria-label="查看图片"
            onPointerDown={event => {
              // Only the backdrop closes it: a press inside the panel is the
              // user reading the picture, not dismissing it.
              if (event.target === event.currentTarget) setZoomCard(undefined)
            }}
          >
            <div className={css.zoomPanel} data-dsh-seework-canvas-zoom-panel="">
              <header className={css.zoomHeader}>
                <span className={css.zoomTitle}>{canvasOriginLabel(originOf(zoomCard)) ?? '图片'}</span>
                <Button onClick={() => { setZoomCard(undefined) }}>关闭</Button>
              </header>
              <img
                className={css.zoomImage}
                src={canvasImageUrl(zoomCard.file ?? '', zoomCard.source)}
                alt={zoomCard.prompt ?? ''}
                draggable={false}
              />
            </div>
          </div>
        )}

      {/* The annotation editor takes the whole panel: the picture is the work
          surface, and the board behind it would only compete for attention. */}
      {annotateCard === undefined || modePicture === undefined
        ? null
        : (
          <AnnotationEditor
            url={modePicture.url}
            natural={modePicture.natural}
            onCancel={closeMode}
            onSave={async dataUrl => {
              const image = await loadBurnedSize(dataUrl)
              await addBurnedCard(image, {
                x: annotateCard.x + annotateCard.width + 24,
                y: annotateCard.y,
                ...sizeKeepingAspect(annotateCard.width, image.width, image.height),
              }, 'annotation')
              closeMode()
            }}
          />
        )}
      {busy ? <p className={css.notice}>正在保存图片…</p> : null}

      {pickerOpen
        ? (
          <LibraryPicker
            entries={library.entries}
            onPick={placeImage}
            onClose={() => { setPickerOpen(false) }}
          />
        )
        : null}
    </div>
  )
}

/** The save indicator. */
function SaveState({ save, dirty }: { save: CanvasState['save']; dirty: boolean }): JSX.Element {
  const text = save === 'saving'
    ? '保存中…'
    : save === 'conflict'
      ? '已在别处被改动'
      : save === 'error'
        ? '保存失败'
        : dirty
          ? '待保存'
          : '已保存'
  const tone = save === 'conflict' ? css.saveWarn : save === 'error' ? css.saveError : dirty ? css.saveIdle : css.saveOk
  return <span className={`${css.saveState} ${tone}`}>{text}</span>
}

/** One card on the board. */
function CardView({
  card,
  selected,
  badge,
  removeHint,
  onSelect,
  onBeginMove,
  onBeginResize,
  onZoom,
  onText,
  onRemove,
}: {
  card: CanvasCard
  selected: boolean
  /** Origin badge text (「标注合成」…), when the picture's source is known. */
  badge?: string | undefined
  /** What the ✕ promises to delete. */
  removeHint: string
  onSelect: () => void
  onBeginMove: (event: React.PointerEvent<HTMLElement>) => void
  onBeginResize: (event: React.PointerEvent<HTMLElement>) => void
  /** Look at this picture enlarged. */
  onZoom: () => void
  onText: (text: string) => void
  onRemove: () => void
}): JSX.Element {
  const picture = card.kind === 'image'
  return (
    <div
      data-seework-card={card.id}
      className={[css.card, selected ? css.cardSelected : ''].filter(Boolean).join(' ')}
      style={{ left: card.x, top: card.y, width: card.width, height: card.height, zIndex: Math.round(card.z) }}
      onPointerDown={onSelect}
    >
      <header className={css.cardBar} onPointerDown={onBeginMove} title="拖动移动">
        <span className={css.cardKind} data-dsh-seework-card-origin={badge ?? ''}>
          {card.kind === 'image' ? badge ?? '图片' : '备注'}
        </span>
        <button
          type="button"
          className={css.cardClose}
          title={removeHint}
          onPointerDown={event => { event.stopPropagation() }}
          onClick={onRemove}
        >
          ✕
        </button>
      </header>
      {/* A picture is dragged by its body, not only by the title bar: the whole
          card is what the user points at. A note keeps the title bar, because its
          body is where text is selected and edited. */}
      <div
        className={picture ? `${css.cardBody} ${css.cardBodyPicture}` : css.cardBody}
        data-dsh-seework-card-body=""
        onPointerDown={picture ? onBeginMove : undefined}
        onDoubleClick={picture ? onZoom : undefined}
      >
        {card.kind === 'image' && card.file !== undefined
          ? <img className={css.cardImage} src={canvasImageUrl(card.file, card.source)} alt={card.prompt ?? ''} draggable={false} />
          : (
            <textarea
              className={css.cardText}
              value={card.text ?? ''}
              placeholder="写点什么…"
              style={{ fontSize: card.fontSize ?? 16 }}
              onPointerDown={event => { event.stopPropagation() }}
              onChange={event => { onText(event.target.value) }}
            />
          )}
      </div>
      <span className={css.resizeHandle} onPointerDown={onBeginResize} title="拖动调整大小" />
    </div>
  )
}

/** The picture picker, shown as a panel over the board. */
function LibraryPicker({
  entries,
  onPick,
  onClose,
}: {
  entries: LibraryEntry[]
  onPick: (entry: LibraryEntry, imageIndex: number) => void
  onClose: () => void
}): JSX.Element {
  return (
    <>
      <div className={css.pickerBackdrop} onClick={onClose} />
      <div className={css.picker} role="dialog" aria-label="从素材库添加">
        <header className={css.pickerHeader}>
          <strong>从素材库添加</strong>
          <Button onClick={onClose}>关闭</Button>
        </header>
        {entries.length === 0
          ? <p className={css.muted}>素材库还是空的：先在对话里让 Agent 画一张。</p>
          : (
            <div className={css.pickerGrid}>
              {entries.flatMap(entry => entry.images.map((image, index) => (
                <button
                  key={`${entry.id}-${index}`}
                  type="button"
                  className={css.pickerItem}
                  title={entry.prompt}
                  onClick={() => { onPick(entry, index) }}
                >
                  <img src={image.url} alt="" loading="lazy" />
                </button>
              )))}
            </div>
          )}
      </div>
    </>
  )
}

/** Board list + open/create/delete, shown beside the board. */
export function CanvasBoardList({ store }: { store: CanvasStore }): JSX.Element {
  const [tick, setTick] = useState(0)
  useEffect(() => store.subscribe(() => { setTick(value => value + 1) }), [store])
  void tick
  const state = store.getSnapshot()
  const [renaming, setRenaming] = useState(false)
  return (    <aside className={css.list}>
      <header className={css.listHeader}>
        <strong>画布</strong>
        <Button variant="primary" onClick={() => { void store.open('') }}>新建</Button>
      </header>
      {state.boards.length === 0
        ? <p className={css.muted}>还没有画布。</p>
        : (
          <ul className={css.boardList}>
            {state.boards.map(summary => (
              <li key={summary.id}>
                <button
                  type="button"
                  className={[css.boardRow, state.board?.id === summary.id ? css.boardRowActive : ''].filter(Boolean).join(' ')}
                  onClick={() => { void store.open(summary.id) }}
                >
                  <span className={css.boardName}>{summary.title}</span>
                  <span className={css.boardMeta}>{summary.cardCount} 个卡片</span>
                </button>
                <button
                  type="button"
                  className={css.boardDelete}
                  title="删除这块画布"
                  onClick={() => {
                    void store.deleteBoard(summary.id)
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      {state.board === undefined
        ? null
        : (
          <div className={css.listFooter}>
            {renaming
              ? (
                <TextInput
                  defaultValue={state.board.title}
                  autoFocus
                  onBlur={event => {
                    store.setTitle(event.target.value.trim() === '' ? state.board!.title : event.target.value.trim())
                    setRenaming(false)
                    void store.saveNow()
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                  }}
                />
              )
              : <Button onClick={() => { setRenaming(true) }}>重命名当前画布</Button>}
            <span className={css.muted}>{state.boards.length} 块画布</span>
          </div>
        )}
    </aside>
  )
}
