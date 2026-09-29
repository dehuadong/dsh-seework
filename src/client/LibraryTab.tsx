/**
 * The material library as a right-sidebar tab body.
 *
 * The body renders the same panel the floating drawer renders, and the store is
 * the shared one, so a refresh triggered elsewhere (a new generation) is visible
 * here without this component doing anything.
 */

import { useEffect, useState } from 'react'
import type { LibraryStore } from './library-store.ts'
import { setComposerFace, type ComposerInput } from './composer-draft.ts'
import { LibraryPanel } from './LibraryPanel.tsx'
import { LibraryDetail } from './library-detail.tsx'

/**
 * Props the sidebar seat supplies: the shared store, plus the session-scope facts
 * 「加入到对话框」 needs (the seat is session-scoped; the floating drawer is not).
 */
export interface LibraryTabBodyProps {
  /** Injected by the shell's tab seat; unused until the library needs tab actions. */
  hooks?: { tabInfo?: unknown }
  /** The session this tab is showing. */
  sessionId?: string
  /** The composer's attachment actions for that session. */
  inputActions?: ComposerInput
}

/**
 * Build the tab body for one store.
 *
 * The shell renders tab bodies without plugin-provided props, so the store is
 * bound here and the component receives only the seat's own props.
 * @param store - the shared library store.
 * @returns a component the tab seat can render.
 */
export function libraryTabBody(store: LibraryStore): (props: LibraryTabBodyProps) => JSX.Element {
  return function LibraryTabBody(props: LibraryTabBodyProps): JSX.Element {
    const [detailId, setDetailId] = useState<string | undefined>(undefined)
    // Opening the tab is the user asking "what do I have?": re-read, because the
    // store may have been loaded before the conversation generated anything.
    useEffect(() => { void store.refresh() }, [store])
    const sessionId = props.sessionId
    const inputActions = props.inputActions
    // Same contract as the canvas tab: the seat owns the session scope, so the
    // composer face is published for exactly as long as this tab is mounted.
    useEffect(() => {
      if (sessionId === undefined || inputActions === undefined) return
      return setComposerFace({ sessionId, input: inputActions })
    }, [inputActions, sessionId])
    return (
      <>
        <LibraryPanel
          store={store}
          tab
          hideClose
          onClose={() => { setDetailId(undefined) }}
          onOpen={id => { setDetailId(id) }}
        />
        {detailId === undefined
          ? null
          : <LibraryDetail store={store} entryId={detailId} onClose={() => { setDetailId(undefined) }} />}
      </>
    )
  }
}

/**
 * Factory form used by the tab registry: the registry closes over the store.
 * Kept separate from {@link LibraryTabBodyProps} so tests can render the body
 * without a shell.
 */
export type LibraryTabBodyFactory = ReturnType<typeof libraryTabBody>
