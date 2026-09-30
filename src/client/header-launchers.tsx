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
import { onActivation, type SeeWorkSurface } from './activation.ts'
import css from './header-launchers.module.css'

/**
 * Who is visibly showing, as reported by the surfaces themselves.
 *
 * The launcher cannot infer this from the activation event alone: a page in the
 * right column can be closed from its own tab strip, and only the column knows
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

/** The controls in force. */
let controls: LauncherControls | undefined

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
 * the surfaces themselves, because the column's pages are not React children of
 * the header. Pressing the button of the surface that is already up puts it away
 * again.
 */
export function HeaderLaunchers(_props: HeaderLaunchersProps): JSX.Element {
  const [active, setActive] = useState<SeeWorkSurface | undefined>(undefined)
  useEffect(() => onActivation(surface => { setActive(surface) }), [])
  const press = (surface: SeeWorkSurface): void => {
    const current = controls
    if (current === undefined) return
    if (current.isOpen(surface)) current.close(surface)
    else current.open(surface)
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
