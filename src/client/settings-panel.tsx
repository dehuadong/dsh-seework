/**
 * The DOM-mounted settings surface: the guaranteed way into the plugin's
 * settings when the shell does not expose a plugin-configuration slot to
 * third-party packages.
 *
 * It renders a quiet floating button in the lower-left corner of the viewport;
 * clicking it opens the same card the slot registration would render, inside a
 * local overlay. Nothing here depends on the shell's internal layout classes,
 * so it cannot break when the shell layout changes.
 */

import { createRoot, type Root } from 'react-dom/client'
import { SeeWorkApi } from './api.ts'
import { SeeWorkSettingsCard } from './SettingsCard.tsx'
import type { SeeWorkScope } from './settings-scope.ts'
import { attachLauncher } from './surfaces.ts'
import launcherCss from './surfaces.module.css'
import css from './settings-panel.module.css'

/** Marks the mounted launcher (a stable hook for tests and DOM inspection). */
export const SETTINGS_LAUNCHER_ATTR = 'data-dsh-seework-settings-launcher'

/** Cross-surface event: detail is the name of the surface that just opened. */
export const ACTIVATE_EVENT = 'dsh-seework-activate'

/** The SeeWork surfaces subject to the single-open rule. */
export type SeeWorkSurface = 'settings' | 'library' | 'canvas'

/**
 * Ask sibling SeeWork surfaces to step aside, and report which one is opening.
 * The DOM-mounted surfaces are siblings in `document.body`, so this is how they
 * avoid stacking on top of each other without sharing React state.
 * @param name - the surface that is opening.
 */
export function announceActivation(name: SeeWorkSurface): void {
  document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: name }))
}

/**
 * Ask one SeeWork surface to open, from anywhere.
 *
 * The header launcher lives in the shell's toolbar rather than in this plugin's
 * tree, so it cannot call a component's `setOpen` directly; announcing the
 * surface is the same path its own launcher takes, which means one code path
 * opens a surface however it was asked for.
 * @param surface - the surface to bring up.
 */
export function requestSurface(surface: SeeWorkSurface): void {
  if (typeof document === 'undefined') return
  announceActivation(surface)
}

/** The surface whose activation was announced last, for launcher highlighting. */
let activeSurface: SeeWorkSurface | undefined

/**
 * The surface currently showing, as far as the shared activation event knows.
 * @returns the surface name, or undefined while none has been announced.
 */
export function activeSeeWorkSurface(): SeeWorkSurface | undefined {
  return activeSurface
}

/**
 * Follow the activation stream.
 * @param listener - called after each announcement with the surface it names.
 * @returns disposer removing the listener.
 */
export function onActivation(listener: (surface: SeeWorkSurface) => void): () => void {
  const handler = (event: Event): void => {
    const surface = (event as CustomEvent<SeeWorkSurface>).detail
    activeSurface = surface
    listener(surface)
  }
  document.addEventListener(ACTIVATE_EVENT, handler)
  return () => { document.removeEventListener(ACTIVATE_EVENT, handler) }
}

/** Mount the launcher + overlay.
 * @param scope - the bound settings scope.
 * @param api - the plugin route client.
 * @returns disposer unmounting everything this created.
 */
export function mountSettingsPanel(scope: SeeWorkScope, api: SeeWorkApi): () => void {
  const launcher = document.createElement('button')
  launcher.type = 'button'
  launcher.setAttribute(SETTINGS_LAUNCHER_ATTR, '')
  launcher.className = launcherCss.launcher
  launcher.textContent = 'SeeWork 设置'
  launcher.title = '设置 SeeAI Hub 地址、API Key 与图片模型'

  const overlay = document.createElement('div')
  overlay.className = css.overlay
  overlay.hidden = true
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'SeeWork 设置')

  const panel = document.createElement('div')
  panel.className = css.panel
  overlay.appendChild(panel)
  document.body.append(overlay)
  const detachLauncher = attachLauncher(launcher)

  const root: Root = createRoot(panel)
  root.render(<SeeWorkSettingsCard scope={scope} api={api} />)

  const close = (): void => { overlay.hidden = true }
  const onLauncher = (): void => {
    const next = overlay.hidden
    overlay.hidden = !next
    // Only one SeeWork surface should be open at a time; opening this one
    // retires the library drawer.
    if (next) announceActivation('settings')
  }
  const onOtherActivate = (event: Event): void => {
    if ((event as CustomEvent).detail === 'library') close()
  }
  const onOverlay = (event: MouseEvent): void => {
    if (event.target === overlay) close()
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !overlay.hidden) close()
  }
  launcher.addEventListener('click', onLauncher)
  overlay.addEventListener('click', onOverlay)
  document.addEventListener('keydown', onKey)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)

  return () => {
    launcher.removeEventListener('click', onLauncher)
    overlay.removeEventListener('click', onOverlay)
    document.removeEventListener('keydown', onKey)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    root.unmount()
    detachLauncher()
    overlay.remove()
  }
}
