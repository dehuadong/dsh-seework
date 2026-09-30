/**
 * The DOM-mounted settings surface: the guaranteed way into the plugin's
 * settings when the shell does not expose a plugin-configuration slot to
 * third-party packages.
 *
 * It renders a quiet floating button in the lower-left corner of the viewport;
 * clicking it opens the same card the slot registration would render, inside a
 * local overlay. Nothing here depends on the shell's internal layout classes,
 * so it cannot break when the shell layout changes.
 *
 * This is the last remaining DOM-mounted surface: the library and the canvas are
 * pages in the shell's right column only, so they need no floating chrome and
 * this button carries its own.
 */

import { createRoot, type Root } from 'react-dom/client'
import { SeeWorkApi } from './api.ts'
import { SeeWorkSettingsCard } from './SettingsCard.tsx'
import type { SeeWorkScope } from './settings-scope.ts'
import { ACTIVATE_EVENT, announceActivation } from './activation.ts'
import css from './settings-panel.module.css'

/** Marks the mounted launcher (a stable hook for tests and DOM inspection). */
export const SETTINGS_LAUNCHER_ATTR = 'data-dsh-seework-settings-launcher'

/** Mount the launcher + overlay.
 * @param scope - the bound settings scope.
 * @param api - the plugin route client.
 * @returns disposer unmounting everything this created.
 */
export function mountSettingsPanel(scope: SeeWorkScope, api: SeeWorkApi): () => void {
  const host = document.createElement('div')
  host.className = css.host

  const launcher = document.createElement('button')
  launcher.type = 'button'
  launcher.setAttribute(SETTINGS_LAUNCHER_ATTR, '')
  launcher.className = css.launcher
  launcher.textContent = 'SeeWork 设置'
  launcher.title = '设置 SeeAI Hub 地址、API Key 与图片模型'
  host.appendChild(launcher)

  const overlay = document.createElement('div')
  overlay.className = css.overlay
  overlay.hidden = true
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'SeeWork 设置')

  const panel = document.createElement('div')
  panel.className = css.panel
  overlay.appendChild(panel)
  document.body.append(host, overlay)

  const root: Root = createRoot(panel)
  root.render(<SeeWorkSettingsCard scope={scope} api={api} />)

  const close = (): void => { overlay.hidden = true }
  const onLauncher = (): void => {
    const next = overlay.hidden
    overlay.hidden = !next
    // Keep the conversation header's highlight truthful: opening this one is
    // still an activation, even though nothing else listens for it any more.
    if (next) announceActivation('settings')
  }
  const onOtherActivate = (event: Event): void => {
    if ((event as CustomEvent).detail !== 'settings') close()
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
    host.remove()
    overlay.remove()
  }
}
