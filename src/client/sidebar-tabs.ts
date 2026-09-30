/**
 * SeeWork's right-sidebar tabs: the material library and the canvas.
 *
 * The shell owns the right column, so both surfaces are contributed as tab
 * types rather than mounted on `document.body`:
 *
 *  1. `ctx.sidebarRightTabs.register({ id, kind, title })` declares the type;
 *  2. the body registers into the keyed `sidebar.right.pane.tab` seat under the
 *     same id, and the chip title into `sidebar.right.pane.tab.title`.
 *
 * Opening is `ctx.sidebarRight.openTab(kind)`: the controller expands the column
 * if it was collapsed, which is what "auto-open" means for the shell — the
 * plugin never touches layout itself.
 *
 * Degradation: every call is guarded, and the caller keeps the floating dock. A
 * shell without the right sidebar must still be able to show these surfaces.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { LibraryStore } from './library-store.ts'
import type { CanvasStore } from './canvas-store.ts'
import type { LibraryEntry } from '../protocol.ts'
import { libraryTabBody } from './LibraryTab.tsx'
import { canvasTabBody } from './CanvasTab.tsx'

/** Tab type ids, also the keys the bodies and titles register under. */
export const LIBRARY_TAB_ID = 'dsh-seework/library'
export const CANVAS_TAB_ID = 'dsh-seework/canvas'

/** Tab kinds: what `openTab` names. */
export const LIBRARY_TAB_KIND = 'seework-library'
export const CANVAS_TAB_KIND = 'seework-canvas'

/**
 * One surface's guide entry: the capsule the right column's guide page offers.
 *
 * Picking that capsule opens the type as a page in the capsule's place, which is
 * what makes this the way in on a shell whose home screen has no session header
 * to put a button in.
 */
export interface SeeWorkGuideEntry {
  /** Entry identity inside this tab type; the registry requires it. */
  id: string
  /** Ascending position among every registered type's entries. */
  order: number
  /** One line under the capsule's title; the guide drops it when the list grows long. */
  description: string
}

/** The two surfaces as tab types. */
export interface SeeWorkTabTarget {
  id: string
  kind: string
  title: string
  /** Guide-page capsule, offered beside the shipped cards. */
  guide: SeeWorkGuideEntry
}

/** Both tab types in strip order. */
export const TAB_TARGETS: readonly SeeWorkTabTarget[] = [
  {
    id: LIBRARY_TAB_ID,
    kind: LIBRARY_TAB_KIND,
    title: '素材库',
    guide: { id: 'library', order: 40, description: '查看用 SeeWork 生成过的图片' },
  },
  {
    id: CANVAS_TAB_ID,
    kind: CANVAS_TAB_KIND,
    title: '画布',
    guide: { id: 'canvas', order: 50, description: '把生成过的图片摆到画布上' },
  },
]

/** The stores the tab bodies render from (the same ones the fallback panels use). */
export interface TabStores {
  library: LibraryStore
  canvas: CanvasStore
  /** Library entries for the canvas picture picker. */
  entries: () => LibraryEntry[]
  /** Load the library when the picker asks for it. */
  onNeedLibrary: () => void
}

/**
 * The slice of `ctx` these registrations use.
 *
 * Services come through `ctx.get(name)`, never `ctx.<name>`: the client
 * runner's guard refuses an undeclared property read (and reports it as a
 * plugin failure), while `get` is the sanctioned probe that answers `undefined`
 * for a service this page does not have. Declaring the sidebar services in
 * `inject` is not an option either — a package whose provider is ordered
 * differently parks the whole plugin, which takes the settings, library and
 * canvas surfaces down with the tabs.
 */
interface SidebarClientFace {
  get?: (name: string) => unknown
}

/** The tab registry as this module uses it. */
interface TabRegistry {
  register: (definition: unknown) => () => void
}

/** The column controller as this module uses it. */
interface SidebarController {
  openTab: (kind: string, options?: { revealIfOpened?: boolean }) => void
  active: () => { id: string; kind: string } | undefined
  close: (tabId: string) => void
}

/** The slot registry as this module uses it. */
interface SlotRegistry {
  inject: (name: string, callback: () => void) => () => void
  register: (options: unknown, component: unknown) => () => void
}

/** Look up one optional service without tripping the client guard. */
function service<T>(ctx: ClientContext, name: string): T | undefined {
  try {
    const value = (ctx as unknown as SidebarClientFace).get?.(name)
    return value === null || value === undefined ? undefined : value as T
  } catch (error) {
    console.warn(`[dsh-seework] service "${name}" is unavailable:`, error)
    return undefined
  }
}

/**
 * Is the right column part of this page at all?
 * @param ctx - client root context.
 * @returns true when both sidebar services are present.
 */
export function sidebarAvailable(ctx: ClientContext): boolean {
  return service<TabRegistry>(ctx, 'sidebarRightTabs') !== undefined
    && service<SidebarController>(ctx, 'sidebarRight') !== undefined
}

/**
 * Register both tab types and their bodies.
 * @param ctx - client root context carrying `slots`, `sidebarRightTabs` and `sidebarRight`.
 * @param stores - the shared stores the bodies render from.
 * @returns the disposer plus whether the tabs actually landed (a shell without
 *   the column keeps its floating launchers).
 */
export function registerSidebarTabs(ctx: ClientContext, stores: TabStores): {
  dispose: () => void
  tabsAvailable: boolean
} {
  const tabs = service<TabRegistry>(ctx, 'sidebarRightTabs')
  const slots = service<SlotRegistry>(ctx, 'slots')
  const disposers: Array<() => void> = []
  let registered = 0
  const guard = (work: () => (() => void) | undefined): void => {
    try {
      const dispose = work()
      if (dispose !== undefined) disposers.push(dispose)
    } catch (error) {
      console.warn('[dsh-seework] right sidebar rejected a tab:', error)
    }
  }

  for (const target of TAB_TARGETS) {
    guard(() => {
      const dispose = tabs?.register({
        id: target.id,
        kind: target.kind,
        title: () => target.title,
        // The guide page's capsule. Without it the column has no door into
        // SeeWork on a screen that shows no session header (the home screen):
        // the floating dock is the only way in, and the canvas it opens is the
        // plugin's own full-viewport overlay rather than a page in this column.
        guide: [{
          id: target.guide.id,
          order: target.guide.order,
          title: () => target.title,
          description: () => target.guide.description,
        }],
      })
      if (dispose !== undefined) registered += 1
      return dispose
    })
    const body = target.kind === LIBRARY_TAB_KIND
      ? libraryTabBody(stores.library)
      : canvasTabBody({
        store: stores.canvas,
        get library() { return { entries: stores.entries() } },
        onNeedLibrary: stores.onNeedLibrary,
      })
    // The deferred callback is guarded on its own: `slots.inject` may run it
    // immediately (a shell that already declared the slot), and a registry that
    // refuses the key throws from inside it rather than from `inject`.
    guard(() => slots?.inject('sidebar.right.pane.tab', () => {
      try {
        return slots.register({
          name: 'sidebar.right.pane.tab',
          key: target.id,
        }, body)
      } catch (error) {
        console.warn('[dsh-seework] right sidebar rejected the tab body:', error)
        return undefined
      }
    }))
    guard(() => slots?.inject('sidebar.right.pane.tab.title', () => {
      try {
        return slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: target.id,
        }, () => target.title)
      } catch (error) {
        console.warn('[dsh-seework] right sidebar rejected the tab title:', error)
        return undefined
      }
    }))
  }

  return {
    dispose: () => {
      for (const dispose of disposers.reverse()) dispose()
    },
    tabsAvailable: registered === TAB_TARGETS.length,
  }
}

/**
 * Show one tab, expanding the column when it was collapsed.
 * @param ctx - client root context carrying `sidebarRight`.
 * @param kind - the tab kind to reveal.
 * @returns true when the request was accepted.
 */
export function openSeeWorkTab(ctx: ClientContext, kind: string): boolean {
  const controller = service<SidebarController>(ctx, 'sidebarRight')
  if (controller === undefined) return false
  try {
    controller.openTab(kind, { revealIfOpened: true })
    return true
  } catch (error) {
    console.warn('[dsh-seework] could not open the sidebar tab:', error)
    return false
  }
}

/**
 * Is that tab the one the column is showing right now?
 * @param ctx - client root context carrying `sidebarRight`.
 * @param kind - the tab kind to test.
 * @returns true when it is the active tab.
 */
export function isSeeWorkTabActive(ctx: ClientContext, kind: string): boolean {
  const controller = service<SidebarController>(ctx, 'sidebarRight')
  try {
    return controller?.active()?.kind === kind
  } catch {
    return false
  }
}

/**
 * Put one tab away.
 * @param ctx - client root context carrying `sidebarRight`.
 * @param kind - the tab kind to close, when it is the active one.
 * @returns true when a tab was closed.
 */
export function closeSeeWorkTab(ctx: ClientContext, kind: string): boolean {
  const controller = service<SidebarController>(ctx, 'sidebarRight')
  try {
    const active = controller?.active()
    if (active === undefined || active.kind !== kind) return false
    controller?.close(active.id)
    return true
  } catch (error) {
    console.warn('[dsh-seework] could not close the sidebar tab:', error)
    return false
  }
}
