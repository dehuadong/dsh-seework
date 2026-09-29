/**
 * Automatic catalog detection.
 *
 * Until this module existed, the model catalog was read **only** when the user
 * pressed 「检测可用模型」 (`routes.ts` → `discoverModels`). That left two gaps:
 * a model the deployment added stayed invisible until someone happened to
 * re-detect, and a saved model's capabilities could silently age with nothing
 * to make a fresh read happen.
 *
 * Three triggers share this one path (issue #652):
 *
 *  1. **host startup** — one round, early;
 *  2. **the settings card opening** — via `POST catalog/refresh`, throttled so
 *     reopening the card does not re-request;
 *  3. **a low-frequency background refresh** — {@link DEFAULT_REFRESH_INTERVAL_MS},
 *     for the deployment where the host stays up and nobody opens the card.
 *
 * What a round is allowed to change is the load-bearing decision:
 *
 *  - **saved models' capabilities are adopted automatically** — the user already
 *    chose the model, and refreshing what the catalog says about it does not
 *    change that choice;
 *  - **new models are only reported** (`added`) — adopting one would change the
 *    announcement and the user's selection, which is the user's call;
 *  - **models that vanished from the catalog are only reported** (`missing`) —
 *    the snapshot stays, so nothing is dropped behind the user's back.
 *
 * Everything else about a refresh is deliberately quiet: a failure keeps the
 * previous data, reports nothing, and leaves the settings document alone.
 */

import { discoverModels, type DiscoverSources } from './catalog.ts'
import { adoptRefreshedCapabilities } from './capability.ts'
import type {
  CatalogRefreshOutcome,
  CatalogRefreshSummary,
  CatalogResult,
  ModelConfig,
} from './protocol.ts'

// The wire shapes of a round live in `protocol.ts` (the browser half consumes
// them), so this module re-exports them rather than declaring a second copy.
export type { CatalogRefreshOutcome, CatalogRefreshSummary }

/**
 * How often the background refresh runs.
 *
 * A constant rather than a setting: the value only decides how stale a snapshot
 * may get while nobody looks, and a knob for it would cost more (a field, a
 * validation rule, a card control) than it explains. Six hours matches how often
 * a deployment realistically changes its model catalog.
 */
export const DEFAULT_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * How long two automatic rounds must be apart.
 *
 * Shared by the card-opening trigger and the background timer, so the two can
 * never stack into duplicate requests (AC-2 / AC-9). The user's own
 * 「检测可用模型」 is deliberately **not** throttled: it probes exactly what is on
 * screen, and a silent no-op there would be a bug, not a saving.
 */
export const AUTO_REFRESH_THROTTLE_MS = 60 * 1000

/**
 * What one refresh round reads and writes.
 *
 * The settings document is touched through {@link CatalogRefresherDeps.mutate}
 * rather than a whole-document write: the saved model list travels as one `set`
 * op, which is also what keeps the user's other fields (key, defaults,
 * `defaultModel`) out of the round's hands entirely.
 */
export interface CatalogRefresherDeps {
  /** The saved models, already normalized. */
  resolveModels(): ModelConfig[]
  /** The addresses and key to discover with. */
  sources(): DiscoverSources
  /**
   * Adopt refreshed capabilities, or do nothing.
   *
   * Called when at least one saved model's description actually changed **or**
   * when {@link hasRetiredKeys} reports a document that still carries retired
   * keys — a round that found nothing new must not write the settings document
   * for nothing, or every startup and every card opening would announce a change.
   *
   * @param models - the saved list with adopted capabilities applied.
   */
  mutate(models: ModelConfig[]): Promise<void>
  /**
   * Whether the saved document still carries keys this plugin no longer stores
   * (#659).
   *
   * The trigger for the cleanup write, and it has to be answered from the **raw
   * document**: {@link resolveModels} is normalized and has already dropped those
   * keys, so it can never report them. When this says yes, the round writes
   * `models` even if no advertised capability moved — the write payload is the
   * normalized list, so the residue simply leaves with it.
   */
  hasRetiredKeys?: () => boolean
  /** Discovery, injectable so tests need no network. */
  discover?: (sources: DiscoverSources) => Promise<CatalogResult>
  /** Clock, injectable so throttle and interval behaviour is testable. */
  now?: () => number
  /**
   * Lifecycle seam for the background timer, injectable for the same reason.
   * Defaults to Node's `setInterval` / `clearInterval`.
   */
  setTimer?: (callback: () => void, intervalMs: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/** One refresher bound to a live settings view. */
export interface CatalogRefresher {
  /**
   * Run one round.
   * @param options - `automatic: false` skips the throttle (the user asked).
   */
  refresh(options?: { automatic?: boolean }): Promise<CatalogRefreshOutcome>
  /**
   * Start the low-frequency timer.
   * @param intervalMs - override for the interval (tests).
   * @returns the disposer that stops it; the host calls it on unload.
   */
  startBackground(intervalMs?: number): () => void
}

/** Build one refresher bound to a live settings view. */
export function createCatalogRefresher(deps: CatalogRefresherDeps): CatalogRefresher {
  const now = deps.now ?? ((): number => Date.now())
  const discover = deps.discover ?? discoverModels
  const setTimer = deps.setTimer ?? ((callback: () => void, intervalMs: number): unknown => setInterval(callback, intervalMs))
  const clearTimer = deps.clearTimer ?? ((handle: unknown): void => { clearInterval(handle as NodeJS.Timeout) })

  /** The last round that reached the network: what throttling compares against. */
  let lastAttemptAt: number | undefined
  /** The last successful round's summary, returned to a throttled trigger. */
  let lastResult: CatalogRefreshSummary | undefined
  let lastCatalog: CatalogResult | undefined
  /** The in-flight round, so a second trigger joins it instead of duplicating. */
  let inFlight: Promise<CatalogRefreshOutcome> | undefined
  let backgroundStop: (() => void) | undefined

  const skipped = (why: 'throttled' | 'not-configured' | 'failed'): CatalogRefreshOutcome => ({
    ran: false,
    skipped: why,
    ...lastResult === undefined ? {} : { result: lastResult },
    ...lastCatalog === undefined ? {} : { catalog: lastCatalog },
  })

  const run = async (): Promise<CatalogRefreshOutcome> => {
    lastAttemptAt = now()
    try {
      const catalog = await discover(deps.sources())
      lastCatalog = catalog
      const saved = deps.resolveModels()
      // Nothing saved: there is no snapshot to refresh. The catalog is still
      // reported so a card that opens after the user saved nothing can stage it.
      if (saved.length === 0) return skipped('not-configured')
      const next = adoptRefreshedCapabilities(saved, catalog.models)
      // Two reasons to write, and only ever the `models` field: something was
      // adopted, or the document still carries keys this plugin no longer stores
      // (#659 — `saved` is normalized, so the residue is only visible on the raw
      // document, which is what the dep reads). The second is silent: it is not
      // a capability refresh, so `adopted` stays empty and no notice is shown.
      const cleanup = deps.hasRetiredKeys?.() === true
      if (next.adopted.length > 0 || cleanup) await deps.mutate(next.models)
      lastResult = {
        refreshedAt: now(),
        adopted: next.adopted,
        added: next.added,
        missing: next.missing,
      }
      return { ran: true, result: lastResult, catalog }
    } catch {
      // Failure is silent by design: the previous snapshot and its timestamp
      // stay, and the card's own display already says "may be stale".
      return skipped('failed')
    }
  }

  const refresh: CatalogRefresher['refresh'] = async (options = {}) => {
    // An unconfigured plugin has nothing to refresh: no saved model means there
    // is no snapshot to update, and no key means discovery is not authenticated
    // — a round must never run against a half-configured deployment and adopt
    // whatever a stray public answer reported (AC-9).
    if (deps.sources().apiKey.trim() === '' || deps.resolveModels().length === 0) {
      return skipped('not-configured')
    }
    const withinWindow = lastAttemptAt !== undefined && now() - lastAttemptAt < AUTO_REFRESH_THROTTLE_MS
    // An automatic trigger inside the window returns the previous summary right
    // away. It deliberately does **not** join an in-flight round: that round is
    // already the answer, and waiting for it would put the background timer on
    // the critical path of an unrelated mount.
    if (options.automatic !== false && withinWindow) return skipped('throttled')
    // A round already running **is** the round this caller is asking for — and
    // this one has no throttle to fall back on, so joining is what keeps two
    // simultaneous triggers at one request.
    if (inFlight !== undefined) return inFlight
    const pending = run()
    inFlight = pending
    try {
      return await pending
    } finally {
      if (inFlight === pending) inFlight = undefined
    }
  }

  return {
    refresh,
    startBackground(intervalMs = DEFAULT_REFRESH_INTERVAL_MS) {
      backgroundStop?.()
      const handle = setTimer(() => { void refresh({ automatic: true }) }, intervalMs)
      const stop = (): void => {
        clearTimer(handle)
        if (backgroundStop === stop) backgroundStop = undefined
      }
      backgroundStop = stop
      return stop
    },
  }
}
