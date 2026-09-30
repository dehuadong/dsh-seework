/**
 * Which SeeWork surface is showing, as one document-wide announcement.
 *
 * The right column renders both surfaces itself, so nothing here opens or closes
 * anything: this is only how the conversation header's buttons learn which one
 * is in front. It used to be the coordination seam for independently mounted
 * floating panels, which no longer exist.
 */

/** Cross-surface event: detail is the name of the surface that just opened. */
export const ACTIVATE_EVENT = 'dsh-seework-activate'

/** The SeeWork surfaces the header can point at. */
export type SeeWorkSurface = 'settings' | 'library' | 'canvas'

/** The surface whose activation was announced last, for launcher highlighting. */
let activeSurface: SeeWorkSurface | undefined

/**
 * Report that a surface just came to the front.
 * @param name - the surface that is opening.
 */
export function announceActivation(name: SeeWorkSurface): void {
  document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: name }))
}

/**
 * The surface currently showing, as far as the announcements know.
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
