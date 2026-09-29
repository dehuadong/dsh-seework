/**
 * Mount point for the canvas surface.
 *
 * The canvas opens as a full-surface overlay rather than a drawer: a board
 * needs room, and the user is arranging pictures rather than reading a list.
 * Its launcher sits in the shared SeeWork dock, and the shared activation event
 * keeps only one SeeWork surface open at a time.
 */

import { createRoot, type Root } from 'react-dom/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SeeWorkApi } from './api.ts'
import { LibraryStore } from './library-store.ts'
import { CanvasStore } from './canvas-store.ts'
import { CanvasBoard, CanvasBoardList } from './CanvasBoard.tsx'
import { reportSurfaceOpen } from './header-launchers.tsx'
import { ACTIVATE_EVENT, announceActivation, onActivation } from './settings-panel.tsx'
import { attachLauncher } from './surfaces.ts'
import launcherCss from './surfaces.module.css'
import css from './canvas-shell.module.css'

/** Marks the canvas launcher. */
export const CANVAS_LAUNCHER_ATTR = 'data-dsh-seework-canvas-launcher'

/** Everything the canvas surface owns, mounted into the dock's host element. */
function CanvasSurface({ library, store, launcher }: {
  library: LibraryStore
  store: CanvasStore
  launcher: HTMLElement
}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)

  /** Open or close, doing whatever the transition needs. */
  const setSurfaceOpen = useCallback((next: boolean): void => {
    if (openRef.current === next) return
    openRef.current = next
    setOpen(next)
    if (!next) {
      // Leaving the surface saves what is unsaved; the store survives so
      // reopening shows the same board.
      void store.close()
      return
    }
    announceActivation('canvas')
    void library.refresh()
    if (store.getSnapshot().board !== undefined) {
      void store.refreshList()
      return
    }
    void (async () => {
      await store.refreshList()
      const first = store.getSnapshot().boards[0]
      await store.open(first?.id ?? '')
    })()
  }, [library, store])

  // The launcher lives in the dock, outside this tree, so its label and click
  // handler are wired imperatively.
  useEffect(() => {
    const render = (): void => {
      const count = store.getSnapshot().boards.length
      launcher.textContent = count === 0 ? '画布' : `画布 ${count}`
      launcher.title = '把生成过的图片摆到画布上'
      launcher.setAttribute('aria-expanded', String(openRef.current))
    }
    render()
    const stop = store.subscribe(render)
    const onClick = (): void => { setSurfaceOpen(!openRef.current) }
    launcher.addEventListener('click', onClick)
    return () => {
      stop()
      launcher.removeEventListener('click', onClick)
    }
  }, [launcher, store, setSurfaceOpen])

  // Only one SeeWork surface is open at a time, and announcing this surface is
  // how anything outside this tree (the conversation header) asks for it.
  useEffect(() => {
    const onOtherActivate = (event: Event): void => {
      if ((event as CustomEvent).detail !== 'canvas') setSurfaceOpen(false)
    }
    document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
    return () => { document.removeEventListener(ACTIVATE_EVENT, onOtherActivate) }
  }, [setSurfaceOpen])

  useEffect(() => onActivation(surface => {
    if (surface === 'canvas') setSurfaceOpen(true)
  }), [setSurfaceOpen])

  // The header button toggles, so it needs the surface's real open state.
  useEffect(() => reportSurfaceOpen('canvas', () => openRef.current), [])

  // Mounted only while open. Hiding it with `display: none` instead would leave
  // a second live board over the same store: every card rendered twice, two sets
  // of pointer listeners, and a 0×0 "stage" whose measurement could overwrite the
  // size the visible board (the sidebar tab) just reported.
  if (!open) return null
  return (
    <div className={css.overlay} role="dialog" aria-modal="true" aria-label="SeeWork 画布">
      <header className={css.header}>
        <strong>SeeWork 画布</strong>
        <span className={css.headerHint}>把素材库里的图片摆到板上：拖标题栏移动、右下角调整大小、滚轮缩放；不做连线。</span>
        <button type="button" className={css.close} onClick={() => { setSurfaceOpen(false) }}>关闭</button>
      </header>
      <div className={css.body}>
        <CanvasBoardList store={store} />
        <CanvasBoard
          store={store}
          library={{ entries: library.getSnapshot().entries }}
          onNeedLibrary={() => { void library.refresh() }}
        />
      </div>
    </div>
  )
}

/**
 * Mount the canvas launcher and fallback overlay.
 * @param api - the plugin route client (unused here; the store is resolved by the caller).
 * @param library - the shared material-library store (the picture source).
 * @param store - the shared canvas store, also rendered by the right-sidebar tab.
 * @returns disposer unmounting everything this created.
 */
export function mountCanvasSurfaces(api: SeeWorkApi, library: LibraryStore, store: CanvasStore): () => void {
  void api
  const host = document.createElement('div')
  document.body.appendChild(host)
  const launcher = document.createElement('button')
  launcher.type = 'button'
  launcher.setAttribute(CANVAS_LAUNCHER_ATTR, '')
  launcher.className = launcherCss.launcher
  const detachLauncher = attachLauncher(launcher)

  const root: Root = createRoot(host)
  root.render(<CanvasSurface library={library} store={store} launcher={launcher} />)
  return () => {
    root.unmount()
    detachLauncher()
    host.remove()
  }
}

/** Re-exported so the composition root can measure the board without importing it. */
export { stageSizeFor } from './CanvasBoard.tsx'
