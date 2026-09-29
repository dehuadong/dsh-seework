/**
 * Noticing a finished generation from the browser half.
 *
 * The host gives the page no push channel: an agent-side `generate_image` writes
 * a library entry and nothing tells the tab. So the page polls the library's
 * *identity* (newest entry id + total, a few dozen bytes) and, when it changes,
 * refreshes the shared library store — which is what updates the library tab, the
 * canvas's picture picker, and the launcher's count.
 *
 * What it deliberately does NOT do is touch the canvas. Auto-opening the column
 * and dropping the new picture onto the open board was the earlier behaviour, and
 * it turned a background generation into the user's screen rearranging itself;
 * placement is the user's call now (the canvas's own 「从素材库选图」）。 The
 * watcher therefore does not even receive the canvas store.
 *
 * Polling is the honest option here: a websocket into the shell is private, and
 * an SSE route would still be a long-lived connection the console is happy to
 * burn. The interval is skipped while the page is hidden, and a failed poll
 * changes nothing — a transient 500 from the host must not disturb the page.
 */

import type { SeeWorkApi } from './api.ts'
import type { LibraryStore } from './library-store.ts'

/** How often the page asks the host what the newest entry is. */
export const WATCH_INTERVAL_MS = 2000

/** What the watcher needs from the composition root. */
export interface GenerationWatchDeps {
  api: SeeWorkApi
  library: LibraryStore
  /** Poll interval; tests shorten it. */
  intervalMs?: number
  /** Timer injectors, so tests can drive the loop without real time. */
  setTimer?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>
  clearTimer?: (handle: ReturnType<typeof setInterval>) => void
}

/**
 * Start watching for generations that finished in the host.
 * @param deps - the api and the shared library store.
 * @returns disposer stopping the watch.
 */
export function watchGenerations(deps: GenerationWatchDeps): () => void {
  const setTimer = deps.setTimer ?? ((handler, ms) => setInterval(handler, ms))
  const clearTimer = deps.clearTimer ?? (handle => { clearInterval(handle) })
  /** Newest id already accounted for. */
  let newestId: string | undefined
  /** False until the first successful look, which only adopts. */
  let observed = false
  let stopped = false
  let polling = false

  const poll = async (): Promise<void> => {
    if (stopped || polling) return
    // A hidden page is not being looked at; skipping keeps an idle background tab
    // quiet. The next poll after the page becomes visible catches up.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    polling = true
    try {
      const result = await deps.api.libraryHead()
      if (stopped) return
      if (!result.ok) return
      const head = result.value
      if (!observed) {
        // First look: adopt what is already there. A page load must never treat
        // the whole existing library as brand new.
        observed = true
        newestId = head.newestId
        return
      }
      // An empty library reports no id: the FIRST generation into it is a change
      // from `undefined`, not something to adopt away.
      if (head.newestId === undefined || head.newestId === newestId) return
      newestId = head.newestId
      await deps.library.refresh()
    } finally {
      polling = false
    }
  }

  const handle = setTimer(() => { void poll() }, deps.intervalMs ?? WATCH_INTERVAL_MS)
  return () => {
    stopped = true
    clearTimer(handle)
  }
}
