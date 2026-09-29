/**
 * One dock for every SeeWork launcher.
 *
 * The surfaces are mounted independently (settings panel, library drawer, canvas
 * overlay), so their buttons cannot be laid out by a shared parent component.
 * Instead each surface renders its button into the dock element this module
 * owns, which is why a single owner exists at all: three buttons at fixed
 * coordinates would overlap, and each new surface would need another offset.
 */

import css from './surfaces.module.css'

/** Marks the dock element. */
export const SURFACE_DOCK_ATTR = 'data-dsh-seework-dock'

/**
 * The dock element, created on first use.
 *
 * Reuse is by attribute lookup, so a hot reload that mounts the surfaces again
 * does not leave a second dock behind.
 * @returns the dock element, or undefined when there is no document.
 */
export function surfaceDock(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined
  // The attribute selector must pin the empty value: a bare `[attr]` matches
  // descendants too (the launcher buttons carry no such attribute, but the
  // selector reads as "any element that has it", which is how a nested lookup
  // could hand back the wrong node).
  const existing = document.querySelector<HTMLElement>(`[${SURFACE_DOCK_ATTR}=""]`)
  if (existing !== null) return existing
  const dock = document.createElement('div')
  dock.setAttribute(SURFACE_DOCK_ATTR, '')
  dock.className = css.dock
  document.body.appendChild(dock)
  return dock
}

/**
 * Put one launcher button in the dock.
 * @param button - the button element (its classes come from the surface).
 * @returns disposer removing the button and the dock once it is empty.
 */
export function attachLauncher(button: HTMLElement): () => void {
  const dock = surfaceDock()
  if (dock === undefined) return () => {}
  dock.appendChild(button)
  return () => {
    button.remove()
    if (dock.childElementCount === 0) dock.remove()
  }
}
