/**
 * Automatic catalog detection (#652).
 *
 * The properties worth pinning here are the ones a fake gateway cannot show:
 *
 *  - **what a round may change** — capabilities of a saved model yes, the
 *    selection and the new models no;
 *  - **what a round must not do** — write the settings document when nothing
 *    changed, erase a snapshot the catalog stopped describing, or surface a
 *    failure;
 *  - **when a round happens at all** — throttled when automatic, never throttled
 *    when the user asked, and one request when two triggers meet.
 *
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import {
  adoptRefreshedCapabilities,
  capabilityChanged,
  carriesRetiredKeys,
  hasRetiredModelKeys,
} from './capability.ts'
import {
  AUTO_REFRESH_THROTTLE_MS,
  createCatalogRefresher,
  DEFAULT_REFRESH_INTERVAL_MS,
  type CatalogRefresherDeps,
} from './catalog-refresh.ts'
import { effectiveConfig } from './settings.ts'
import type { CatalogResult, ModelConfig } from './protocol.ts'
/** One saved model with every advertised field filled in. */
function saved(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'image-model-a',
    label: 'Image Model A',
    resolutions: ['1K', '2K'],
    resolutionDefault: '1K',
    aspectRatios: ['1:1'],
    outputFormats: ['png'],
    maxImages: 2,
    maxReferenceImages: 1,
    capabilitiesKnown: true,
    discoveredAt: 1_000,
    ...overrides,
  }
}

/** One catalog model, matching {@link saved} unless overridden. */
function catalogModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'image-model-a',
    label: 'Image Model A',
    resolutions: ['1K', '2K'],
    resolutionDefault: '1K',
    aspectRatios: ['1:1'],
    outputFormats: ['png'],
    maxImages: 2,
    maxReferenceImages: 1,
    capabilitiesKnown: true,
    discoveredAt: 2_000,
    ...overrides,
  }
}

/** A catalog answer carrying the given models. */
function catalogResult(models: ModelConfig[], overrides: Partial<CatalogResult> = {}): CatalogResult {
  return {
    models,
    origin: 'catalog',
    catalogUrl: 'http://127.0.0.1:8081/api/v1/catalog/models',
    scanned: models.length,
    attempts: [{ url: 'http://127.0.0.1:8081/api/v1/catalog/models', outcome: 'ok', models: models.length }],
    ...overrides,
  }
}

describe('capabilityChanged', () => {
  it('sees no change when the catalog repeats what is saved', () => {
    expect(capabilityChanged(saved(), catalogModel())).toBe(false)
  })

  it('notices each advertised capability moving', () => {
    const cases: Array<Partial<ModelConfig>> = [
      { label: 'Renamed' },
      { resolutions: ['1K', '2K', '4K'] },
      { resolutions: ['2K', '1K'] },
      { resolutionDefault: '2K' },
      { resolutionDefault: '' },
      { aspectRatios: ['1:1', '16:9'] },
      { outputFormats: ['jpeg'] },
      { maxImages: 3 },
      { maxReferenceImages: 4 },
      { capabilitiesKnown: false },
    ]
    for (const override of cases) {
      expect(capabilityChanged(saved(), catalogModel(override)), JSON.stringify(override)).toBe(true)
    }
  })

  it('treats a reordered tier list as a capability change, not a set change (#663/P6)', () => {
    // Since catalog v2 the array order *is* the declared ranking, so a moved
    // order must be adopted rather than compared as a set.
    const reordered = catalogModel({ resolutions: ['512', '1K', '2K'] })
    expect(capabilityChanged(saved({ resolutions: ['1K', '2K', '512'] }), reordered)).toBe(true)
  })

  it('adopts a capabilitiesKnown flip in either direction (#663/P6)', () => {
    // A pre-v2 snapshot (unknown) that starts describing the model, and a
    // described model that falls back to an old snapshot, both change what the
    // request builder may trim.
    expect(capabilityChanged(saved({ capabilitiesKnown: false }), catalogModel())).toBe(true)
    expect(capabilityChanged(saved(), catalogModel({ capabilitiesKnown: false }))).toBe(true)
  })

  it('does not treat a catalog `qualities` list as a capability any more (#661)', () => {
    // The catalog still reports `capabilities.quality` (seeaitv reads it), but the
    // plugin no longer stores it, so a moved list must not trigger an adoption.
    const fresh = { ...catalogModel(), qualities: ['high', 'low'] } as unknown as ModelConfig
    expect(capabilityChanged(saved(), fresh)).toBe(false)
  })

  it('treats a missing discovery stamp as a change, so an old model acquires one', () => {
    expect(capabilityChanged(saved({ discoveredAt: undefined }), catalogModel())).toBe(true)
  })

  it('ignores the stamp itself when both sides have one', () => {
    // A newer timestamp is not a capability change: writing the document for it
    // would make every round look like it adopted something.
    expect(capabilityChanged(saved({ discoveredAt: 1 }), catalogModel({ discoveredAt: 99 }))).toBe(false)
  })
})

describe('adoptRefreshedCapabilities', () => {
  it('adopts a saved model’s new capabilities and keeps its place in the list', () => {
    const savedModels = [saved(), saved({ id: 'image-model-b', label: 'B' })]
    const result = adoptRefreshedCapabilities(savedModels, [
      catalogModel({ id: 'image-model-b', label: 'B', maxImages: 5 }),
      catalogModel({ maxImages: 9, discoveredAt: 3_000 }),
    ])
    expect(result.adopted).toEqual(['image-model-a', 'image-model-b'])
    expect(result.added).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.models.map(model => model.id)).toEqual(['image-model-a', 'image-model-b'])
    expect(result.models[0]!.maxImages).toBe(9)
    expect(result.models[0]!.discoveredAt).toBe(3_000)
    expect(result.models[1]!.maxImages).toBe(5)
  })

  it('reports new models without adopting them', () => {
    // The one product decision this feature must not make for the user: an
    // unselected model changes the announcement, so it is only reported.
    const result = adoptRefreshedCapabilities([saved()], [catalogModel(), catalogModel({ id: 'image-model-new' })])
    expect(result.added).toEqual(['image-model-new'])
    expect(result.models.map(model => model.id)).toEqual(['image-model-a'])
  })

  it('reports a vanished model and leaves its snapshot alone', () => {
    const result = adoptRefreshedCapabilities([saved(), saved({ id: 'image-model-gone' })], [catalogModel()])
    expect(result.missing).toEqual(['image-model-gone'])
    expect(result.models).toHaveLength(2)
    expect(result.models[1]!.id).toBe('image-model-gone')
    expect(result.models[1]!.resolutions).toEqual(['1K', '2K'])
  })

  it('does not treat a retired key as a capability change (the cleanup is its own trigger)', () => {
    // #659 / #661 / #663: `capabilityChanged` answers "did an advertised
    // capability move" — the residue on an old entry is not one. The cleanup has
    // its own trigger, because the production caller only ever hands over the
    // *normalized* models (`resolveModels`), where those keys do not exist at all.
    const legacy = {
      ...saved(),
      parameters: ['moderation'],
      parameterDocs: { moderation: { description: '内容审核档位' } },
      parameterRules: { moderation: { values: ['low', 'high'] } },
      guidePath: '/api/v1/catalog/models/image-model-a/guide',
      // #663 retired the v1 tier-order pair: it is `resolutions`'s second copy.
      orderedResolutions: ['1K', '2K'],
      resolutionOrderReliable: true,
    } as unknown as ModelConfig
    expect(capabilityChanged(legacy, catalogModel())).toBe(false)
    // The document-level question is the exported helper's job.
    expect(carriesRetiredKeys(legacy)).toBe(true)
    expect(carriesRetiredKeys(saved())).toBe(false)
    expect(carriesRetiredKeys({ ...saved(), orderedResolutions: [] })).toBe(true)
    expect(carriesRetiredKeys({ ...saved(), resolutionOrderReliable: false })).toBe(true)
    expect(hasRetiredModelKeys([saved(), legacy])).toBe(true)
    expect(hasRetiredModelKeys([saved()])).toBe(false)
    expect(hasRetiredModelKeys(undefined)).toBe(false)
  })

  it('rebuilds every catalog-described entry, not only the ones whose capabilities moved', () => {
    // Adopting one model makes the round write the whole array; the entries that
    // did not move ride in that same write, rebuilt from the current shape and
    // stamped by this round. That is what guarantees residue cannot survive on a
    // model whose capabilities happened to stay put.
    const moved = saved({ maxImages: 3 })
    const untouched = saved({ id: 'image-model-b', label: 'B', discoveredAt: 1_000 })
    const result = adoptRefreshedCapabilities(
      [moved, untouched],
      [catalogModel({ maxImages: 9 }), catalogModel({ id: 'image-model-b', label: 'B' })],
    )
    expect(result.adopted).toEqual(['image-model-a'])
    expect(result.models[0]!.maxImages).toBe(9)
    // Not adopted, but still rebuilt: the round's stamp replaces the old one.
    expect(result.models[1]!.discoveredAt).toBe(2_000)
    expect(result.models[1]).not.toBe(untouched)
  })

  it('leaves an entry the catalog stopped describing completely alone', () => {
    // The exception to "rebuilt when the round writes": a vanished model keeps
    // its snapshot (and therefore any residue it has) — the round is never
    // allowed to erase capabilities the user may still be using.
    const gone = {
      ...saved({ id: 'image-model-gone', label: 'Gone', discoveredAt: 1_000 }),
      parameters: ['moderation'],
    } as unknown as ModelConfig
    const result = adoptRefreshedCapabilities([saved({ maxImages: 3 }), gone], [catalogModel({ maxImages: 9 })])
    expect(result.missing).toEqual(['image-model-gone'])
    expect(result.models[1]).toBe(gone)
  })

  it('returns the very same list when nothing changed and nothing is residue', () => {
    const savedModels = [saved()]
    const result = adoptRefreshedCapabilities(savedModels, [catalogModel()])
    expect(result.adopted).toEqual([])
    // Identity, not just equality: the caller uses "nothing adopted" as its
    // signal not to write the settings document at all, and the same array also
    // proves no entry object was rebuilt.
    expect(result.models).toBe(savedModels)
    expect(result.models[0]).toBe(savedModels[0])
  })

  it('adopts the catalog description onto the saved entry, keeping the stored field set', () => {
    // Discovery answers with the stored shape since #669, so the assertion is
    // the **field set** rather than "one type's extra field did not ride in":
    // whatever a round writes must be exactly what the settings schema stores.
    const result = adoptRefreshedCapabilities([saved()], [catalogModel({ maxImages: 9 })])
    expect(Object.keys(result.models[0]!).sort()).toEqual([
      'aspectRatios', 'capabilitiesKnown', 'discoveredAt', 'id', 'label',
      'maxImages', 'maxReferenceImages', 'outputFormats', 'resolutionDefault',
      'resolutions',
    ])
    expect(result.models[0]!.id).toBe('image-model-a')
    expect(result.models[0]!.maxImages).toBe(9)
  })

  it('writes the retired per-model keys off the entry (#659 / #663 / D-3)', () => {
    // The proof that residue really goes: the saved entry here is a document
    // written before #659 / #663, so it carries `parameters` / `parameterDocs` /
    // `parameterRules` / `guidePath` / the v1 tier-order pair. A round that
    // adopts the entry rebuilds it field by field, so the written model has none
    // of them — no migration code, just the whole-`models` rewrite doing what it
    // always did.
    const legacy = {
      ...saved(),
      parameters: ['background', 'moderation'],
      parameterDocs: { background: { description: '背景' } },
      parameterRules: { background: { values: ['opaque'] } },
      guidePath: '/api/v1/catalog/models/image-model-a/guide',
      orderedResolutions: ['1K', '2K'],
      resolutionOrderReliable: true,
    } as unknown as ModelConfig
    const result = adoptRefreshedCapabilities([legacy], [catalogModel({ maxImages: 9 })])
    expect(result.adopted).toEqual(['image-model-a'])
    for (const retired of ['parameters', 'parameterDocs', 'parameterRules', 'guidePath', 'orderedResolutions', 'resolutionOrderReliable']) {
      expect(result.models[0]).not.toHaveProperty(retired)
    }
    // The fields the plugin does keep travelled through.
    expect(result.models[0]!.maxImages).toBe(9)
    expect(result.models[0]!.resolutions).toEqual(['1K', '2K'])
    expect(result.models[0]!.resolutionDefault).toBe('1K')
  })

  it('ignores the catalog’s own ordering when deciding what is new', () => {
    const result = adoptRefreshedCapabilities(
      [saved({ id: 'b' }), saved({ id: 'a' })],
      [catalogModel({ id: 'a' }), catalogModel({ id: 'b' })],
    )
    expect(result.models.map(model => model.id)).toEqual(['b', 'a'])
    expect(result.added).toEqual([])
  })
})

describe('the refresher', () => {
  /** A controllable clock, timer and discovery call log. */
  function harness(overrides: Partial<CatalogRefresherDeps> = {}): {
    deps: CatalogRefresherDeps
    written: ModelConfig[][]
    discoveries: number
    tick: (ms: number) => void
    timers: Array<{ callback: () => void; intervalMs: number; cleared: boolean }>
  } {
    let clock = 1_000
    let discoveries = 0
    const written: ModelConfig[][] = []
    const timers: Array<{ callback: () => void; intervalMs: number; cleared: boolean }> = []
    const deps: CatalogRefresherDeps = {
      resolveModels: () => [saved()],
      sources: () => ({ serviceUrl: 'http://127.0.0.1:8081', apiUrl: 'http://127.0.0.1:8080/v1', apiKey: 'sk-x' }),
      mutate: async (models) => { written.push(models) },
      discover: async () => { discoveries += 1; return catalogResult([catalogModel()]) },
      now: () => clock,
      setTimer: (callback, intervalMs) => {
        const record = { callback, intervalMs, cleared: false }
        timers.push(record)
        return record
      },
      clearTimer: (handle) => { (handle as { cleared: boolean }).cleared = true },
      ...overrides,
    }
    return { deps, written, get discoveries() { return discoveries }, tick: (ms) => { clock += ms }, timers }
  }

  it('adopts changed capabilities and stamps the round', async () => {
    const local = harness({
      now: () => 5_000,
      discover: async () => catalogResult([catalogModel({ maxImages: 7 })]),
    })
    const refresher = createCatalogRefresher(local.deps)
    const outcome = await refresher.refresh({ automatic: false })
    expect(outcome.ran).toBe(true)
    expect(outcome.result?.adopted).toEqual(['image-model-a'])
    expect(outcome.result?.refreshedAt).toBe(5_000)
    expect(local.written).toHaveLength(1)
    expect(local.written[0]![0]!.maxImages).toBe(7)
  })

  it('does not write anything when the catalog repeats the saved snapshot', async () => {
    const local = harness()
    const refresher = createCatalogRefresher(local.deps)
    const outcome = await refresher.refresh({ automatic: false })
    expect(outcome.ran).toBe(true)
    expect(outcome.result?.adopted).toEqual([])
    // A write here would announce a change on every startup and card opening.
    expect(local.written).toHaveLength(0)
  })

  it('stays quiet when discovery fails, keeping the previous snapshot', async () => {
    const local = harness({
      discover: async () => { throw new Error('connection refused') },
    })
    const refresher = createCatalogRefresher(local.deps)
    const outcome = await refresher.refresh({ automatic: false })
    expect(outcome).toEqual({ ran: false, skipped: 'failed' })
    expect(local.written).toHaveLength(0)
  })

  it('keeps the last good summary after a later failure', async () => {
    let failing = false
    const local = harness({
      discover: async () => {
        if (failing) throw new Error('connection refused')
        return catalogResult([catalogModel()])
      },
    })
    const refresher = createCatalogRefresher(local.deps)
    const first = await refresher.refresh({ automatic: false })
    failing = true
    const second = await refresher.refresh({ automatic: false })
    expect(second.ran).toBe(false)
    expect(second.result).toEqual(first.result)
  })

  it('does not run while nothing is saved', async () => {
    const local = harness({ resolveModels: () => [] })
    const refresher = createCatalogRefresher(local.deps)
    const outcome = await refresher.refresh()
    expect(outcome).toEqual({ ran: false, skipped: 'not-configured' })
    expect(local.discoveries).toBe(0)
  })

  it('does not run without a configured key', async () => {
    // AC-9: a half-configured deployment must not be probed — the previous
    // snapshot stays, and a catalog that answered anyway cannot rewrite it.
    const local = harness({
      sources: () => ({ serviceUrl: 'http://127.0.0.1:8081', apiUrl: 'http://127.0.0.1:8080/v1', apiKey: '' }),
    })
    const refresher = createCatalogRefresher(local.deps)
    expect(await refresher.refresh()).toEqual({ ran: false, skipped: 'not-configured' })
    expect(local.discoveries).toBe(0)
    expect(local.written).toHaveLength(0)
  })

  it('throttles automatic rounds but never the user’s own', async () => {
    const local = harness()
    const refresher = createCatalogRefresher(local.deps)
    expect((await refresher.refresh()).ran).toBe(true)
    expect(local.discoveries).toBe(1)

    local.tick(AUTO_REFRESH_THROTTLE_MS - 1)
    expect((await refresher.refresh()).skipped).toBe('throttled')
    expect(local.discoveries).toBe(1)

    // The card's 「检测可用模型」 probes what is on screen: it must always run,
    // even inside the automatic window…
    expect((await refresher.refresh({ automatic: false })).ran).toBe(true)
    expect(local.discoveries).toBe(2)

    // …and it re-arms the window, so the timer cannot follow right behind it.
    expect((await refresher.refresh()).skipped).toBe('throttled')
    expect(local.discoveries).toBe(2)

    local.tick(AUTO_REFRESH_THROTTLE_MS)
    expect((await refresher.refresh()).ran).toBe(true)
    expect(local.discoveries).toBe(3)
  })

  it('leaves a second automatic trigger inside the window with one request only', async () => {
    const calls: string[] = []
    let release: (() => void) | undefined
    const local = harness({
      discover: () => {
        calls.push('discover')
        return new Promise<CatalogResult>(resolve => {
          release = () => { resolve(catalogResult([catalogModel()])) }
        })
      },
    })
    const refresher = createCatalogRefresher(local.deps)
    const first = refresher.refresh()
    // The round is in flight, but the throttle already covers this moment: the
    // second automatic trigger answers from the previous round without adding a
    // request (AC-2 / AC-9).
    expect(calls).toHaveLength(1)
    const second = await refresher.refresh()
    expect(second.skipped).toBe('throttled')
    expect(calls).toHaveLength(1)
    release?.()
    expect((await first).ran).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('joins an in-flight round rather than starting a second one', async () => {
    // The user's own detection skips the throttle, so this is where the in-flight
    // guard is the only thing standing between two triggers and two requests.
    const calls: string[] = []
    let release: (() => void) | undefined
    const local = harness({
      discover: () => {
        calls.push('discover')
        return new Promise<CatalogResult>(resolve => {
          release = () => { resolve(catalogResult([catalogModel()])) }
        })
      },
    })
    const refresher = createCatalogRefresher(local.deps)
    const first = refresher.refresh({ automatic: false })
    expect(calls).toHaveLength(1)
    const second = refresher.refresh({ automatic: false })
    expect(calls).toHaveLength(1)
    release?.()
    const [left, right] = await Promise.all([first, second])
    expect(left.ran).toBe(true)
    expect(right.ran).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('cleans retired keys off the document even when the catalog reports no change (#659 / #663 / D-3)', async () => {
    // The shape the production host wires: `resolveModels` is the normalized
    // view (which no longer has the retired keys), while `hasRetiredKeys` reads
    // the raw document still sitting on disk. Nothing about the model moved in
    // the catalog, so the residue is the only reason this round writes — and the
    // write payload is the normalized list, so the keys leave with it.
    const document = {
      ...saved(),
      parameters: ['moderation'],
      parameterDocs: { moderation: { description: '内容审核档位' } },
      parameterRules: { moderation: { values: ['low', 'high'] } },
      guidePath: '/api/v1/catalog/models/image-model-a/guide',
      // #661: the per-model `qualities` list is retired too.
      qualities: ['low', 'high'],
      // #663: so is the v1 tier-order pair — `resolutions` carries the order now.
      orderedResolutions: ['1K', '2K'],
      resolutionOrderReliable: true,
    } as unknown as ModelConfig
    const local = harness({
      resolveModels: () => effectiveConfig({ models: [document] }).models,
      hasRetiredKeys: () => hasRetiredModelKeys([document]),
      discover: async () => catalogResult([catalogModel()]),
    })
    // Guard: the normalized view really is clean, so nothing but the raw
    // document can be what triggers the write below.
    expect(local.deps.resolveModels()[0]).not.toHaveProperty('parameters')
    expect(local.deps.resolveModels()[0]).not.toHaveProperty('qualities')
    expect(local.deps.resolveModels()[0]).not.toHaveProperty('orderedResolutions')

    const refresher = createCatalogRefresher(local.deps)
    const outcome = await refresher.refresh({ automatic: false })
    expect(outcome.ran).toBe(true)
    // Silent cleanup: no capability was adopted, so nothing is reported.
    expect(outcome.result?.adopted).toEqual([])
    expect(local.written).toHaveLength(1)
    const written = local.written[0]!
    expect(written).toHaveLength(1)
    for (const retired of ['parameters', 'parameterDocs', 'parameterRules', 'guidePath', 'qualities', 'orderedResolutions', 'resolutionOrderReliable']) {
      expect(written[0]).not.toHaveProperty(retired)
    }
    // ...and the payload is exactly the fields the plugin stores: the round
    // never carries anything else into the document.
    expect(Object.keys(written[0]!).sort()).toEqual([
      'aspectRatios', 'capabilitiesKnown', 'discoveredAt', 'id', 'label', 'maxImages',
      'maxReferenceImages', 'outputFormats', 'resolutionDefault', 'resolutions',
    ])
  })

  it('stops writing the cleanup once the document is clean', async () => {
    // One write, then silence: the second round finds a clean document (the dep
    // re-reads it) and the catalog unchanged, so it writes nothing again.
    let document = {
      ...saved(),
      parameters: ['moderation'],
    } as unknown as ModelConfig
    const local = harness({
      resolveModels: () => effectiveConfig({ models: [document] }).models,
      hasRetiredKeys: () => hasRetiredModelKeys([document]),
      discover: async () => catalogResult([catalogModel()]),
      mutate: async (models) => {
        local.written.push(models)
        // The settings seam wrote `set models`, so the document becomes what the
        // round handed over — exactly as the real provider does.
        document = models[0]!
      },
    })
    const refresher = createCatalogRefresher(local.deps)
    await refresher.refresh({ automatic: false })
    expect(local.written).toHaveLength(1)
    // Re-arm the throttle by moving on: this is a fresh user-triggered round.
    await refresher.refresh({ automatic: false })
    expect(local.written).toHaveLength(1)
  })

  it('runs the background timer on the fixed interval and stops on dispose', async () => {
    const local = harness()
    const refresher = createCatalogRefresher(local.deps)
    const stop = refresher.startBackground()
    expect(local.timers).toHaveLength(1)
    expect(local.timers[0]!.intervalMs).toBe(DEFAULT_REFRESH_INTERVAL_MS)
    local.timers[0]!.callback()
    await vi.waitFor(() => { expect(local.discoveries).toBe(1) })
    // The timer and the card share the throttle, so a tick right after a round
    // does not add a request.
    await refresher.refresh()
    expect(local.discoveries).toBe(1)
    stop()
    expect(local.timers[0]!.cleared).toBe(true)
  })

  it('replaces the previous timer when restarted and leaks no disposer', () => {
    const local = harness()
    const refresher = createCatalogRefresher(local.deps)
    refresher.startBackground()
    const stop = refresher.startBackground(1_000)
    expect(local.timers).toHaveLength(2)
    expect(local.timers[0]!.cleared).toBe(true)
    stop()
    expect(local.timers[1]!.cleared).toBe(true)
    // Stopping twice is harmless.
    stop()
  })
})
