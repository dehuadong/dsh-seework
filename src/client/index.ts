/**
 * Browser-half entry for the dsh-seework plugin — runs inside the dsh web GUI.
 *
 * Responsibilities:
 *  1. bind the plugin's own settings scope (its bridge routes serve the
 *     namespace the shell's settings transport does not know about);
 *  2. register the settings card into the shell's plugin-configuration slot
 *     when that slot exists, and fall back to a DOM-mounted settings panel
 *     when it does not — a plugin must never be un-configurable;
 *  3. declare the not-yet-typed slot.
 *
 * Failure policy: DOM and slot problems are logged, never thrown. The web shell
 * fails the whole boot when a plugin apply throws, and an external plugin must
 * not take the GUI down.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { SeeWorkApi } from './api.ts'
import { SeeWorkSettingsCard, type SettingsCardFace } from './SettingsCard.tsx'
import { mountCanvasSurfaces, stageSizeFor } from './canvas-panel.tsx'
import { CanvasStore } from './canvas-store.ts'
import { watchGenerations } from './generation-watch.ts'
import { HeaderLaunchers, onHeaderPresence, setLauncherControls, type LauncherControls } from './header-launchers.tsx'
import { LibraryStore } from './library-store.ts'
import { mountLibraryPanel } from './library-panel.tsx'
import { bindSeeWorkScope, type SeeWorkScope } from './settings-scope.ts'
import { mountSettingsPanel, requestSurface } from './settings-panel.tsx'
import { installChatImageZoom } from './chat-images.tsx'
import { UpdateNotice } from './UpdateNotice.tsx'
import { createCanvasAddFace, libraryFileFromUrl, setCanvasAddFace } from './canvas-add.ts'
import { setComposerProbe, type ComposerDrafts } from './composer-draft.ts'
import { registerToolCards } from './tool-card.tsx'
import {
  CANVAS_TAB_KIND,
  LIBRARY_TAB_KIND,
  closeSeeWorkTab,
  isSeeWorkTabActive,
  openSeeWorkTab,
  registerSidebarTabs,
  sidebarAvailable,
  type TabStores,
} from './sidebar-tabs.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One page inside the Plugins settings section, declared at runtime by the
     * feature that owns that section. Spelled here so this package can register
     * without depending on the sibling UI package; a shell that does not declare
     * it makes the registration throw, which the client half turns into the
     * DOM-mounted fallback instead of a boot failure.
     */
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

/** The slot face registered into `settings.plugin.item`. */
interface PluginCardProps extends SettingsPluginItemOwnerProps, SettingsCardFace {}

/**
 * The plugin's client half declares only `slots` as a required service.
 *
 * The right-sidebar services are optional for this plugin: declaring them would
 * park the WHOLE plugin (settings, library and canvas included) whenever the
 * boot graph orders the column's own plugin differently, which is a worse
 * failure than not having tabs. They are probed through `ctx.get` instead.
 */
export const inject = ['slots']

/** Settings namespace this plugin owns. */
const NS = 'dsh-seework'

/**
 * Position of the SeeWork page among the settings dialog's nav entries.
 * The shipped sections use 10 (models), 15 (plugins) and 20 (agent presets), so
 * a larger number lands after them — the end of the list, where a third-party
 * plugin belongs.
 */
const SETTINGS_SECTION_ORDER = 40

/**
 * Mount the plugin's browser surfaces.
 * @param ctx - client root context (services: slots).
 */
export function apply(ctx: ClientContext): void {
  const scope: SeeWorkScope = bindSeeWorkScope()
  const api = new SeeWorkApi()

  // The floating panel mounts first and is removed once the shell takes a
  // settings surface. Ordering it this way (rather than predicting the shell's
  // answer up front) means there is never a window in which SeeWork has no
  // reachable settings UI at all — a slot's answer only arrives on a later tick.
  const disposeFloatingSettings = mountFallback(scope, api)
  let floatingSettingsRetired = false
  const retireFloatingSettings = (): void => {
    if (floatingSettingsRetired) return
    floatingSettingsRetired = true
    disposeFloatingSettings?.()
  }
  // One settings page, one place. The nav page is the home; the tab inside the
  // Plugins section is only the fallback for a shell that has no nav slot at
  // all, because offering the same card twice is just clutter.
  //
  // The nav slot may already be declared when this runs (its callback fires
  // immediately) or be declared later (its callback fires then), so both orders
  // have to end up at the same place: if the section landed, do not keep a tab.
  let sectionLanded = false
  let disposeSlot: (() => void) | undefined
  const disposeSection = registerSettingsSection(ctx, scope, api, () => {
    sectionLanded = true
    retireFloatingSettings()
    disposeSlot?.()
    disposeSlot = undefined
  })
  if (!sectionLanded) disposeSlot = registerSettingsSlot(ctx, scope, api, retireFloatingSettings, () => sectionLanded)

  // The canvas store is created here rather than inside the panel mount: the
  // right-sidebar tab and the floating fallback must render the SAME board, and
  // two stores would mean two boards fighting over one document.
  const canvas = new CanvasStore(api)

  // The library store is shared: the drawer and the library tab show it, the
  // canvas picks pictures from it, and two stores would mean one of them showing
  // a stale list.
  const library = new LibraryStore(api)
  // The floating launchers mount first: the right column's services only exist
  // once its own plugin has applied, which the boot graph may order after this
  // one. When the tabs do land, the launchers retire themselves.
  const disposeLibrary = mountLibrary(api, library)
  const disposeCanvas = mountCanvas(api, library, canvas)
  // A floating launcher is hidden — never removed — while the conversation
  // header shows its own buttons, and comes back the moment those go away (the
  // home screen has no session, so it has no header). Removing them instead
  // would leave a shell with no way in at all.
  const stopPresence = onHeaderPresence(present => { setFloatingLaunchersHidden(present) })
  const attachTabs = registerSidebarTabsWhenReady(ctx, {
    library,
    canvas,
    entries: () => library.getSnapshot().entries,
    onNeedLibrary: () => { void library.refresh() },
  })
  // Top-right entry points. The floating dock stays even when the header slot
  // accepts them: an external plugin must remain reachable on a shell that does
  // not expose the header slot or the right column at all.
  const launchers = registerHeaderLaunchers(ctx)
  // The conversation card for this plugin's own tool results. The result text is
  // JSON on purpose (text-only models must keep working), so without this view a
  // finished generation shows up as a wall of JSON instead of its pictures.
  const disposeToolCards = registerToolCards(ctx)
  // A published update is otherwise invisible: the version card lives on a
  // settings page the user has to choose to open. This is a report only — the
  // check runs once shortly after boot, nothing installs itself, and the strip
  // is dismissible.
  const disposeUpdateNotice = registerUpdateNotice(ctx, api)
  // Generated pictures are big; the transcript shows them capped and one click
  // opens the original in place. Independent of the view above, because the
  // assistant's own markdown reply renders images in the shell's markup.
  const disposeChatImageZoom = installChatImageZoom(document, src => {
    // A markdown reply image points at the library route, so its file name is in
    // the URL and the library record supplies the rest.
    const file = libraryFileFromUrl(src)
    return file === undefined ? undefined : { file }
  })
  // 「加到画布」: the user points at one picture, and only then does the plugin
  // place a card and bring the canvas up. Automatic placement stayed removed.
  const restoreCanvasAdd = setCanvasAddFace(createCanvasAddFace({
    library,
    canvas,
    reveal: () => {
      if (openSeeWorkTab(ctx, CANVAS_TAB_KIND)) return
      requestSurface('canvas')
    },
    stageSize: () => stageSizeFor(canvas),
  }))
  // 「加入到对话框」 needs the shell's conversation service; the session identity
  // comes from whichever of our tab bodies is mounted (they are session-scoped).
  // A probe, not a captured value: plugins attach in boot order, so resolving at
  // call time is the only thing that cannot come up empty by accident.
  const restoreComposer = setComposerProbe(() => probeService<ComposerDrafts>(ctx, 'conversation'))
  // Point the header buttons at the right-sidebar tabs; without the column they
  // keep working through the floating surfaces.
  const restoreControls = setLauncherControls(launchers.controls)
  // The host pushes nothing, so the page asks what the newest entry is; a change
  // means a generation finished (an agent one included) and the shared library
  // store is refreshed. Deliberately nothing else: the canvas is NOT opened and
  // nothing is placed on it — a background generation must not rearrange the
  // screen, and adding a picture to a board is the canvas's own 「从素材库选图」.
  const stopWatching = watchGenerations({ api, library })

  ctx.effect(() => () => {
    stopWatching()
    stopPresence()
    restoreControls()
    launchers.dispose()
    disposeToolCards()
    disposeUpdateNotice()
    disposeChatImageZoom()
    restoreCanvasAdd()
    restoreComposer()
    attachTabs.dispose()
    disposeSection?.()
    disposeSlot?.()
    disposeFloatingSettings?.()
    disposeLibrary?.()
    disposeCanvas?.()
  }, 'dsh-seework: settings, library and canvas surfaces')
}

/**
 * Probe one optional service without tripping the client guard.
 *
 * Services come through `ctx.get(name)`, never `ctx.<name>` (the guard refuses
 * an undeclared property read), and never through `inject` (a package ordered
 * differently would park the whole plugin — settings, library and canvas with it).
 *
 * @param ctx - client root context.
 * @param name - the service name.
 * @returns the service, or undefined when this page has none.
 */
function probeService<T>(ctx: ClientContext, name: string): T | undefined {
  try {
    const value = (ctx as unknown as { get?: (name: string) => unknown }).get?.(name)
    return value === null || value === undefined ? undefined : value as T
  } catch (error) {
    console.warn(`[dsh-seework] service "${name}" is unavailable:`, error)
    return undefined
  }
}

/**
 * Show or hide the floating library/canvas launchers.
 *
 * Hidden rather than removed: they are the home screen's only way into the two
 * surfaces (the conversation header, and with it the header buttons, exists
 * only inside a session), so they have to be able to come back. The settings
 * button is left alone — its slot is the one a shell is most likely to lack.
 *
 * @param hidden - true while the conversation header's own buttons are on screen.
 */
function setFloatingLaunchersHidden(hidden: boolean): void {
  if (typeof document === 'undefined') return
  for (const attr of ['data-dsh-seework-library-launcher', 'data-dsh-seework-canvas-launcher']) {
    document.querySelectorAll<HTMLElement>(`[${attr}]`).forEach(button => {
      button.style.display = hidden ? 'none' : ''
    })
  }
}

/**
 * Register the right-sidebar tabs as soon as the column's services exist.
 *
 * The services are optional (see the `inject` note), so this probes for them on
 * an interval — cheap, bounded, and it never throws when they never appear. The
 * tabs only matter once the user opens something, so a short delay costs
 * nothing, while parking the whole plugin on the dependency would take the
 * settings, library and canvas surfaces down with it.
 *
 * @param ctx - client root context.
 * @param stores - the shared stores the tab bodies render from.
 * @param onAvailable - called once the tabs actually registered.
 * @returns disposer cancelling the watch and unregistering what landed.
 */
function registerSidebarTabsWhenReady(
  ctx: ClientContext,
  stores: TabStores,
): { dispose: () => void } {
  let tabs: { dispose: () => void; tabsAvailable: boolean } | undefined
  let cancelled = false
  let attempts = 0
  const MAX_ATTEMPTS = 40
  const attempt = (): void => {
    if (cancelled || tabs !== undefined) return
    attempts += 1
    if (sidebarAvailable(ctx)) {
      const registered = registerSidebarTabs(ctx, stores)
      if (registered.tabsAvailable) {
        tabs = registered
        return
      }
      // Services exist but the registry refused: retrying will not help.
      registered.dispose()
      cancelled = true
      return
    }
    if (attempts < MAX_ATTEMPTS) setTimeout(attempt, 250)
  }
  // The column's plugin may already have applied (a reload), in which case the
  // very next tick is enough.
  setTimeout(attempt, 0)
  return {
    dispose: () => {
      cancelled = true
      tabs?.dispose()
      tabs = undefined
    },
  }
}

/**
 * Contribute the SeeWork entry buttons to the conversation header's utilities,
 * and teach them to work the right-sidebar tabs.
 *
 * Same degradation contract as the settings slot: a shell without the utilities
 * slot simply never calls the injection callback, leaving the floating dock as
 * the way in. A shell with the header but without the right column keeps the
 * buttons working through the floating surfaces.
 *
 * @param ctx - client root context (services: slots).
 * @returns the disposer and the launcher controller face.
 */
function registerHeaderLaunchers(ctx: ClientContext): {
  dispose: () => void
  controls: LauncherControls
} {
  const controls: LauncherControls = {
    isOpen: surface => isSeeWorkTabActive(ctx, surface === 'library' ? LIBRARY_TAB_KIND : CANVAS_TAB_KIND),
    open: surface => {
      const kind = surface === 'library' ? LIBRARY_TAB_KIND : CANVAS_TAB_KIND
      if (openSeeWorkTab(ctx, kind)) return true
      // No right column on this shell: fall back to the floating surface.
      requestSurface(surface)
      return false
    },
    close: surface => {
      const kind = surface === 'library' ? LIBRARY_TAB_KIND : CANVAS_TAB_KIND
      if (closeSeeWorkTab(ctx, kind)) return true
      requestSurface(surface === 'library' ? 'canvas' : 'library')
      return false
    },
  }

  try {
    const slots = (ctx as unknown as { slots?: { inject?: unknown; register?: unknown } }).slots
    if (slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
      return { dispose: () => {}, controls }
    }
    let dispose: (() => void) | undefined
    const injected = slots.inject as (name: string, callback: () => void) => () => void
    const stop = injected.call(slots, 'conversation.session.header.utilities', () => {
      try {
        dispose = (slots.register as (options: unknown, component: unknown) => () => void).call(slots, {
          name: 'conversation.session.header.utilities',
          id: NS,
          order: -20,
        }, HeaderLaunchers as unknown as () => JSX.Element)
      } catch (error) {
        console.warn('[dsh-seework] header utilities slot rejected the launchers:', error)
      }
    })
    return {
      dispose: () => {
        dispose?.()
        stop()
      },
      controls,
    }
  } catch (error) {
    console.warn('[dsh-seework] header utilities slot unavailable:', error)
    return { dispose: () => {}, controls }
  }
}

/**
 * Contribute the update notice to the shell's frame-wide overlay.
 *
 * Same degradation contract as the other optional slots here: a shell that does
 * not declare `shell.overlay` never runs the callback, and the plugin keeps
 * working with one surface fewer — the version card in settings still reports
 * the update, which is where it lived before this existed.
 *
 * @param ctx - client root context (services: slots).
 * @param api - the plugin route client.
 * @returns the disposer.
 */
function registerUpdateNotice(ctx: ClientContext, api: SeeWorkApi): () => void {
  try {
    const slots = (ctx as unknown as { slots?: { inject?: unknown; register?: unknown } }).slots
    if (slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
      return () => {}
    }
    let dispose: (() => void) | undefined
    const injected = slots.inject as (name: string, callback: () => void) => () => void
    const stop = injected.call(slots, 'shell.overlay', () => {
      try {
        dispose = (slots.register as (options: unknown, component: unknown) => () => void).call(slots, {
          name: 'shell.overlay',
          id: NS,
          order: 20,
          // The slot declares no owner props, so this may be ignored; the
          // component builds its own client when it is.
          inject: () => ({ api }),
        }, UpdateNotice as unknown as (props: { api?: SeeWorkApi }) => JSX.Element | null)
      } catch (error) {
        console.warn('[dsh-seework] overlay slot rejected the update notice:', error)
      }
    })
    return () => {
      dispose?.()
      stop()
    }
  } catch (error) {
    console.warn('[dsh-seework] overlay slot unavailable:', error)
    return () => {}
  }
}

/**
 * Contribute the SeeWork page to the settings dialog's own navigation.
 *
 * `settings.plugin.item` is a tab INSIDE the Plugins section, which is easy to
 * miss; `settings.section` is a first-class page in the nav list beside
 * 通用设置 / 模型 / 插件 / Agent 预设, which is where a user looks for a plugin
 * they just installed. The shipped sections order themselves 10 / 15 / 20, so
 * this one sits after them.
 *
 * While this section is accepted, {@link registerSettingsSlot} is not kept: the
 * same card in two places is clutter. A shell without the nav slot still gets
 * the Plugins tab, and one without either keeps the floating panel.
 *
 * @param ctx - client root context (services: slots).
 * @param scope - the bound settings scope the card reads and writes.
 * @param api - the plugin route client.
 * @param onAccepted - called once the nav actually took the section.
 * @returns the disposer when the slot exists, undefined when it does not.
 */
function registerSettingsSection(
  ctx: ClientContext,
  scope: SeeWorkScope,
  api: SeeWorkApi,
  onAccepted: () => void,
): (() => void) | undefined {
  try {
    const slots = (ctx as unknown as { slots?: { inject?: unknown; register?: unknown } }).slots
    if (slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return undefined
    const face: SettingsCardFace = { scope, api }
    let dispose: (() => void) | undefined
    const injected = slots.inject as (name: string, callback: () => void) => () => void
    const stop = injected.call(slots, 'settings.section', () => {
      try {
        dispose = (slots.register as (options: unknown, component: unknown) => () => void).call(slots, {
          name: 'settings.section',
          id: NS,
          order: SETTINGS_SECTION_ORDER,
          label: () => 'SeeWork',
          inject: () => face,
        }, SeeWorkSettingsCard as unknown as (props: { close: () => void } & SettingsCardFace) => JSX.Element)
        onAccepted()
      } catch (error) {
        console.warn('[dsh-seework] settings navigation rejected the section:', error)
      }
    })
    return () => {
      dispose?.()
      stop()
    }
  } catch (error) {
    console.warn('[dsh-seework] settings navigation slot unavailable:', error)
    return undefined
  }
}

/**
 * Contribute the settings card to the shell's plugin-configuration slot.
 *
 * Both the registration AND the deferred `inject` callback are guarded. A shell
 * that never declares the slot simply never runs the callback — that is the
 * `slots.inject` contract, not an error — so the fallback panel stays until
 * `onAccepted` says a card actually landed. A callback that throws (the
 * registry refuses a slot it considers occupied, say) is logged and leaves the
 * fallback in place; it must not fail the plugin's fiber, because the shell
 * reports a failed fiber to the user as a boot problem.
 *
 * @param onAccepted - called once the slot has actually accepted the card, so
 *   the caller can retire its fallback surface.
 * @returns the disposer when the slot exists, undefined when it does not.
 */
function registerSettingsSlot(
  ctx: ClientContext,
  scope: SeeWorkScope,
  api: SeeWorkApi,
  onAccepted: () => void,
  /**
   * Asked when this slot's deferred callback finally runs: true means another
   * settings surface already won, so this registration must not happen at all.
   * Without it, a nav page that lands first would leave this tab registered by a
   * callback that arrives afterwards — the duplicate this fallback exists to
   * avoid.
   */
  skipWhen?: () => boolean,
): (() => void) | undefined {
  try {
    const slots = (ctx as unknown as { slots?: { inject?: unknown; register?: unknown } }).slots
    if (slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return undefined
    const face: SettingsCardFace = { scope, api }
    let dispose: (() => void) | undefined
    const injected = slots.inject as (name: string, callback: () => void) => () => void
    const stop = injected.call(slots, 'settings.plugin.item', () => {
      if (skipWhen?.() === true) return
      try {
        dispose = (slots.register as (options: unknown, component: unknown) => () => void).call(slots, {
          name: 'settings.plugin.item',
          key: NS,
          inject: () => face,
        }, SeeWorkSettingsCard as unknown as (props: PluginCardProps) => JSX.Element)
        onAccepted()
      } catch (error) {
        console.warn('[dsh-seework] settings slot rejected the card:', error)
      }
    })
    return () => {
      dispose?.()
      stop()
    }
  } catch (error) {
    console.warn('[dsh-seework] settings slot unavailable:', error)
    return undefined
  }
}

/** DOM-mounted settings launcher (the no-slot path). */
function mountFallback(scope: SeeWorkScope, api: SeeWorkApi): (() => void) | undefined {
  try {
    return mountSettingsPanel(scope, api)
  } catch (error) {
    console.warn('[dsh-seework] settings panel mount failed:', error)
    return undefined
  }
}

/**
 * Mount the material-library launcher and drawer. A DOM mount failure degrades
 * the library only — the plugin never takes the GUI down with it.
 */
function mountLibrary(api: SeeWorkApi, store: LibraryStore): (() => void) | undefined {
  try {
    return mountLibraryPanel(api, store)
  } catch (error) {
    console.warn('[dsh-seework] library panel mount failed:', error)
    return undefined
  }
}

/**
 * Mount the canvas launcher and overlay. Sharing the library store means the
 * picture picker shows what the drawer shows.
 */
function mountCanvas(api: SeeWorkApi, store: LibraryStore, canvas: CanvasStore): (() => void) | undefined {
  try {
    return mountCanvasSurfaces(api, store, canvas)
  } catch (error) {
    console.warn('[dsh-seework] canvas mount failed:', error)
    return undefined
  }
}
