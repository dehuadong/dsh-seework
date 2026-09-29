/**
 * The canvas as a right-sidebar tab body.
 *
 * The board is the same component the full-screen overlay renders; only the
 * frame changes. The board list becomes a collapsible strip instead of a fixed
 * column, because a 320px tab cannot afford a 200px sidebar next to the board.
 */

import { useEffect, useState } from 'react'
import type { CanvasStore } from './canvas-store.ts'
import type { LibraryEntry } from '../protocol.ts'
import { CanvasBoard, CanvasBoardList } from './CanvasBoard.tsx'
import { setComposerFace, type ComposerInput } from './composer-draft.ts'
import { Button } from './controls.tsx'
import css from './canvas-shell.module.css'

/** What the tab body needs from the plugin's composition root. */
export interface CanvasTabDeps {
  store: CanvasStore
  /** The shared library, for the picture picker. */
  library: { entries: LibraryEntry[] }
  /** Load the library (the picker needs it even if the drawer was never opened). */
  onNeedLibrary: () => void
}

/**
 * Props the sidebar seat supplies.
 *
 * The seat is session-scoped, which is what makes 「加入到对话框」 possible at
 * all: it hands over the session identity and the composer's input actions.
 */
export interface CanvasTabBodyProps {
  /** Injected by the shell's tab seat. */
  hooks?: { tabInfo?: unknown }
  /** The session this tab is showing. */
  sessionId?: string
  /** The composer's attachment actions for that session. */
  inputActions?: ComposerInput
}

/**
 * Build the canvas tab body for one store.
 * @param deps - the canvas store and the shared library face.
 * @returns a component the tab seat can render.
 */
export function canvasTabBody(deps: CanvasTabDeps): (props: CanvasTabBodyProps) => JSX.Element {
  return function CanvasTabBody(props: CanvasTabBodyProps): JSX.Element {
    const [listOpen, setListOpen] = useState(false)
    const store = deps.store
    const sessionId = props.sessionId
    const inputActions = props.inputActions
    // The session-scope seat is the only place that knows which conversation the
    // user is looking at, so the composer face lives exactly as long as this tab.
    useEffect(() => {
      if (sessionId === undefined || inputActions === undefined) return
      return setComposerFace({ sessionId, input: inputActions })
    }, [inputActions, sessionId])
    // Opening a board is normally the overlay's job; the tab is its own way in,
    // so it has to load the list and open something itself — otherwise the
    // board area just says "正在读取画布…" forever.
    useEffect(() => {
      if (store.getSnapshot().board !== undefined) {
        void store.refreshList()
        return
      }
      void (async () => {
        await store.refreshList()
        if (store.getSnapshot().board !== undefined) return
        const first = store.getSnapshot().boards[0]
        await store.open(first?.id ?? '')
      })()
    }, [store])
    return (
      <div className={css.tabOverlay} data-dsh-seework-canvas-tab="">
        <header className={css.tabHeader}>
          <Button onClick={() => { setListOpen(open => !open) }} title="切换画布列表">
            {listOpen ? '收起列表' : '画布列表'}
          </Button>
          <span className={css.headerHint}>拖标题栏移动、右下角调整大小、滚轮缩放</span>
        </header>
        {listOpen
          ? (
            <div className={css.tabList}>
              <CanvasBoardList store={store} />
            </div>
          )
          : null}
        <CanvasBoard
          store={store}
          library={deps.library}
          onNeedLibrary={deps.onNeedLibrary}
        />
      </div>
    )
  }
}

/** The factory's component type, for tests. */
export type CanvasTabBodyFactory = ReturnType<typeof canvasTabBody>
