/**
 * SeeWork's entry points in the shell's conversation header (top-right).
 *
 * The shell owns that toolbar, so these are registered into its utilities slot
 * rather than mounted on `document.body`. That is deliberate: buttons floating
 * over the viewport cover whatever the shell puts in the same corner, and the
 * header is where a user looks for "open the side panel".
 *
 * Degradation: a shell without the slot simply never calls the injection
 * callback, in which case the floating dock from `surfaces.ts` stays in place —
 * a plugin must not become unreachable because a slot moved.
 */

import { useEffect, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { announceActivation, onActivation, requestSurface, type SeeWorkSurface } from './settings-panel.tsx'
import css from './header-launchers.module.css'

/**
 * Who is visibly showing, as reported by the surfaces themselves.
 *
 * The launcher cannot infer this from the activation event alone: a surface can
 * be closed from its own chrome (the drawer's 收起), and only the surface knows
 * that happened. Registration is the surface's job; the launcher only asks.
 */
const openProbes = new Map<SeeWorkSurface, () => boolean>()

/**
 * Report whether a surface is currently showing.
 * @param surface - the surface.
 * @param probe - reads the surface's own open state.
 * @returns disposer retiring the report.
 */
export function reportSurfaceOpen(surface: SeeWorkSurface, probe: () => boolean): () => void {
  openProbes.set(surface, probe)
  return () => {
    if (openProbes.get(surface) === probe) openProbes.delete(surface)
  }
}

/**
 * Is that surface up right now?
 * @param surface - the surface to ask about.
 * @returns true when the surface is showing.
 */
export function isSurfaceOpen(surface: SeeWorkSurface): boolean {
  return openProbes.get(surface)?.() === true
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Right-aligned conversation-header utilities. The shell declares it as a
     * `list`, so this plugin's entry sits beside the shell's own controls
     * instead of taking the header's single far-right corner.
     */
    'conversation.session.header.utilities': { kind: 'list'; scope: 'session'; owner: { children?: never } }
  }
}

/** One launcher button: the surface it opens and how it reads. */
interface LauncherTarget {
  surface: SeeWorkSurface
  label: string
  title: string
}

/** The two entries, in display order. */
export const LAUNCHER_TARGETS: readonly LauncherTarget[] = [
  { surface: 'library', label: '素材库', title: '查看用 SeeWork 生成过的图片' },
  { surface: 'canvas', label: '画布', title: '把生成过的图片摆到画布上' },
]

/** Props the shell hands a utilities entry (it supplies nothing of its own). */
export interface HeaderLaunchersProps {
  children?: never
}

/**
 * How a launcher changes the state of the surface behind it.
 *
 * Production passes the sidebar-backed controller; a shell without the right
 * column passes the floating-surface fallback instead, which is why this is an
 * injected face rather than a direct call.
 */
export interface LauncherControls {
  /** Show the surface (expanding the column when it is collapsed). */
  open: (surface: SeeWorkSurface) => boolean
  /** Put the surface away when it is the visible one. */
  close: (surface: SeeWorkSurface) => boolean
  /** Whether that surface is showing right now. */
  isOpen: (surface: SeeWorkSurface) => boolean
}

/** What the launchers module needs from the composition root. */
export interface HeaderLauncherOptions {
  controls?: LauncherControls
}

/** The controls in force; the floating-surface fallback until proven otherwise. */
let controls: LauncherControls | undefined

/**
 * Whether the header buttons are on screen.
 *
 * The conversation header only exists inside a session, so its buttons come and
 * go: on the home screen there are none, which is why the floating dock must
 * come back rather than be torn down for good.
 */
let headerPresent = false
const presenceListeners = new Set<(present: boolean) => void>()

/**
 * Report whether the header's SeeWork buttons are mounted (called by the
 * component itself, so the answer is what is actually rendered).
 * @param present - true while the buttons are on screen.
 */
export function reportHeaderPresence(present: boolean): void {
  if (headerPresent === present) return
  headerPresent = present
  for (const listener of [...presenceListeners]) listener(present)
}

/**
 * Watch the header buttons' presence.
 * @param listener - called now and on every change.
 * @returns disposer removing the listener.
 */
export function onHeaderPresence(listener: (present: boolean) => void): () => void {
  presenceListeners.add(listener)
  listener(headerPresent)
  return () => { presenceListeners.delete(listener) }
}

/**
 * Install the launcher controls.
 * @param next - the controls to use.
 * @returns disposer restoring the previous set.
 */
export function setLauncherControls(next: LauncherControls | undefined): () => void {
  const previous = controls
  controls = next
  return () => { controls = previous }
}

/**
 * The header buttons.
 *
 * The open surface is tracked from the shared activation event rather than from
 * the surfaces themselves, because those are mounted as siblings in
 * `document.body` and share no React state with the header. Pressing the button
 * of the surface that is already up puts it away again.
 */
export function HeaderLaunchers(_props: HeaderLaunchersProps): JSX.Element {
  const [active, setActive] = useState<SeeWorkSurface | undefined>(undefined)
  useEffect(() => onActivation(surface => { setActive(surface) }), [])
  // The buttons' own lifetime is the truthful "the header is here" signal: it
  // covers entering and leaving a session without guessing from the DOM.
  useEffect(() => {
    reportHeaderPresence(true)
    return () => { reportHeaderPresence(false) }
  }, [])
  const press = (surface: SeeWorkSurface): void => {
    const current = controls
    if (current !== undefined) {
      if (current.isOpen(surface)) current.close(surface)
      else current.open(surface)
      return
    }
    if (isSurfaceOpen(surface)) {
      // Floating fallback: closing is the same shape of message as opening — a
      // surface whose name is not announced stands down, and announcing a
      // neighbour keeps "exactly one SeeWork surface is up" true.
      const other = LAUNCHER_TARGETS.find(target => target.surface !== surface)
      announceActivation(other?.surface ?? 'settings')
      return
    }
    requestSurface(surface)
  }
  return (
    <div className={css.group} data-dsh-seework-header-launchers="">
      {LAUNCHER_TARGETS.map(target => (
        <button
          key={target.surface}
          type="button"
          className={css.button}
          data-surface={target.surface}
          data-active={active === target.surface ? 'true' : undefined}
          title={target.title}
          aria-expanded={active === target.surface}
          onClick={() => { press(target.surface) }}
        >
          {target.label}
        </button>
      ))}
    </div>
  )
}
