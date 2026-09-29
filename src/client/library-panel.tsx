/**
 * Mount point for the material-library surfaces: a launcher button in the
 * shared SeeWork dock, the left drawer, and the detail overlay.
 *
 * The store is passed in rather than created here: the canvas also reads the
 * library (its picture picker), and two stores would mean two caches of the
 * same list — one of them stale.
 */

import { createRoot, type Root } from 'react-dom/client'
import type { SeeWorkApi } from './api.ts'
import type { LibraryStore } from './library-store.ts'
import { LibraryPanel } from './LibraryPanel.tsx'
import { LibraryDetail } from './library-detail.tsx'
import { reportSurfaceOpen } from './header-launchers.tsx'
import { ACTIVATE_EVENT, announceActivation, onActivation } from './settings-panel.tsx'
import { attachLauncher } from './surfaces.ts'
import { useEffect, useRef, useState } from 'react'
import launcherCss from './surfaces.module.css'
import css from './library-panel.module.css'

/** Marks the library launcher so other surfaces can find it by selector. */
export const LIBRARY_LAUNCHER_ATTR = 'data-dsh-seework-library-launcher'

/** The drawer and its detail overlay; the launcher lives in the dock. */
function LibrarySurfaces({ store, api, launcher }: {
  store: LibraryStore
  api: SeeWorkApi
  launcher: HTMLElement
}): JSX.Element | null {
  void api
  const [open, setOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | undefined>(undefined)
  const [tick, setTick] = useState(0)
  useEffect(() => store.subscribe(() => { setTick(value => value + 1) }), [store])
  void tick

  const state = store.getSnapshot()

  // The launcher button is outside this tree (it lives in the shared dock), so
  // its label and click handler are wired imperatively.
  useEffect(() => {
    const render = (): void => {
      const current = store.getSnapshot()
      launcher.textContent = ''
      launcher.append('素材库')
      if (current.entries.length > 0) {
        const badge = document.createElement('span')
        badge.className = launcherCss.launcherCount
        badge.textContent = String(current.imageCount)
        launcher.append(badge)
      }
      launcher.title = '查看用 SeeWork 生成过的图片'
      launcher.setAttribute('aria-expanded', String(open))
    }
    render()
    const stop = store.subscribe(render)
    return () => { stop() }
  }, [launcher, open, store])

  useEffect(() => {
    const onClick = (): void => {
      const next = !open
      setOpen(next)
      if (next) {
        announceActivation('library')
        // The conversation may have generated something since the last look.
        void store.refresh()
      }
    }
    launcher.addEventListener('click', onClick)
    return () => { launcher.removeEventListener('click', onClick) }
  }, [launcher, open, store])

  // Only one SeeWork surface is open at a time, and announcing this surface is
  // how anything outside this tree (the conversation header) asks for it.
  useEffect(() => {
    const onOtherActivate = (event: Event): void => {
      if ((event as CustomEvent).detail !== 'library') setOpen(false)
    }
    document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
    return () => { document.removeEventListener(ACTIVATE_EVENT, onOtherActivate) }
  }, [])

  // The header launcher asks for the library by announcing it; the surface has
  // this one entry point so there is no second way to open it.
  useEffect(() => onActivation(surface => {
    if (surface !== 'library') return
    setOpen(true)
    // The conversation may have generated something since the last look.
    void store.refresh()
  }), [store])

  // The header button toggles, which means it has to know whether this surface
  // is really up — the drawer can also be closed from its own chrome.
  const openRef = useRef(false)
  openRef.current = open
  useEffect(() => reportSurfaceOpen('library', () => openRef.current), [])

  if (!open) return null
  return (
    <>
      <LibraryPanel
        store={store}
        onClose={() => {
          setOpen(false)
          setDetailId(undefined)
        }}
        onOpen={id => { setDetailId(id) }}
      />
      {detailId === undefined
        ? null
        : <LibraryDetail store={store} entryId={detailId} onClose={() => { setDetailId(undefined) }} />}
    </>
  )
}

/**
 * Mount the library launcher, drawer and detail overlay.
 * @param api - the plugin route client.
 * @param store - the shared library store (also read by the canvas).
 * @returns disposer unmounting everything this created.
 */
export function mountLibraryPanel(api: SeeWorkApi, store: LibraryStore): () => void {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const launcher = document.createElement('button')
  launcher.type = 'button'
  launcher.setAttribute(LIBRARY_LAUNCHER_ATTR, '')
  launcher.className = launcherCss.launcher
  const detachLauncher = attachLauncher(launcher)
  // Warm the count badge so the launcher is meaningful before it is opened.
  void store.refresh()

  const root: Root = createRoot(host)
  root.render(<LibrarySurfaces store={store} api={api} launcher={launcher} />)
  return () => {
    root.unmount()
    detachLauncher()
    host.remove()
  }
}
