/**
 * Model discovery for the SeeAI Hub gateway.
 *
 * Sources, in order, and why there is more than one:
 *  1. `GET {service}/api/v1/catalog/models` — the SeeAI Hub service's catalog.
 *     Per `docs/api/README.md` the catalog belongs to **service**, not the
 *     Gateway, and neither answers the other's paths, so this address is its
 *     own setting.
 *  2. `GET {gateway}/api/v1/catalog/models` — the same path on the Gateway
 *     host. Deployments that put both surfaces behind one reverse proxy (the
 *     shipped development stack among them) answer here, so it is tried before
 *     giving up on the rich catalog.
 *  3. `GET {gateway base}/models` — the OpenAI-compatible list. It carries ids
 *     only, so those models keep an empty capability table and requests omit
 *     the optional fields.
 *
 * The catalog is public (no credentials), but the request still carries the
 * configured key when there is one: a deployment may front its whole host with
 * an auth gate, and a public endpoint is unharmed by an extra header.
 *
 * Every attempt is reported back, so "扫到 0 个模型" can always be explained by
 * the status each address actually returned.
 *
 * Reading an answer into the model shape is `capability.ts`'s business (#669):
 * this module owns *where* to look and *what each address answered*.
 */

import { catalogEntryToModel, openAiEntryToModel } from './capability.ts'
import { catalogUrl, gatewayUrl, SeeWorkError } from './engine.ts'
import type { CatalogAttempt, CatalogResult, ModelConfig } from './protocol.ts'

/** Timeout for one discovery round trip. */
const DISCOVERY_TIMEOUT_MS = 20_000

/** One JSON GET, reporting what happened rather than throwing. */
type GetOutcome =
  | { kind: 'ok'; payload: unknown }
  | { kind: 'http'; status: number }

/**
 * Perform one JSON GET.
 * @param timeoutMs - how long this request may take.
 */
async function getJson(url: string, apiKey: string, timeoutMs: number = DISCOVERY_TIMEOUT_MS): Promise<GetOutcome> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (apiKey.trim() !== '') headers.authorization = `Bearer ${apiKey.trim()}`
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return { kind: 'http', status: response.status }
    return { kind: 'ok', payload: await response.json() }
  } catch {
    return { kind: 'http', status: 0 }
  }
}

/** Deduplicate models by id, keeping the first occurrence. */
function uniqueModels(models: ModelConfig[]): ModelConfig[] {
  const seen = new Set<string>()
  const out: ModelConfig[] = []
  for (const model of models) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out
}

/** Read a catalog payload's `models` array, when it looks like one. */
function catalogEntries(payload: unknown): unknown[] | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const list = (payload as { models?: unknown }).models
  return Array.isArray(list) ? list : undefined
}

/** Read an OpenAI `/models` payload's `data` array, when it looks like one. */
function modelEntries(payload: unknown): unknown[] | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const list = (payload as { data?: unknown }).data
  return Array.isArray(list) ? list : undefined
}

/**
 * Stamp a successful discovery with the time it happened.
 *
 * The stamp is what lets a dated surface say how fresh the saved snapshot is, and
 * it is written **here** rather than when the user saves the selection: "when we
 * last read the catalog" is the fact that matters, and a selection saved an hour
 * after the probe must not look an hour fresher. A failed discovery throws
 * before this runs, so the previous data keeps its old stamp — which is exactly
 * the honest "this may be stale" signal.
 */
function stampDiscovery(models: ModelConfig[]): ModelConfig[] {
  const discoveredAt = Date.now()
  return models.map(model => ({ ...model, discoveredAt }))
}

/**
 * The family-document follow-up that used to fill tier order lived here.
 *
 * It is gone for good: since catalog v2 the declared order **is** the enum
 * descriptor's `values` array, so discovery needs **one** request per source and
 * the plugin never addresses a family/semantics route. An entry that declares no
 * order is simply an entry without that descriptor — capabilities unknown, never
 * guessed from position.
 */

/** Where discovery may look, in order. */
export interface DiscoverSources {
  /** SeeAI Hub service base (`http://127.0.0.1:8081`), or '' to skip. */
  serviceUrl: string
  /** Gateway base (`http://127.0.0.1:8080/v1`). */
  apiUrl: string
  /** Credentials to accompany the requests (the catalog itself is public). */
  apiKey: string
}

/**
 * Discover the image models a deployment offers.
 * @param sources - the candidate addresses, most specific first.
 * @returns the image models, which source answered, and every attempt made.
 * @throws {SeeWorkError} when no source answered with a usable list at all.
 */
export async function discoverModels(sources: DiscoverSources): Promise<CatalogResult> {
  const attempts: CatalogAttempt[] = []
  const catalogHosts: string[] = []
  if (sources.serviceUrl.trim() !== '') catalogHosts.push(catalogUrl(sources.serviceUrl))
  const fromGateway = catalogUrl(sources.apiUrl)
  if (!catalogHosts.includes(fromGateway)) catalogHosts.push(fromGateway)

  for (const url of catalogHosts) {
    const outcome = await getJson(url, sources.apiKey)
    if (outcome.kind === 'http') {
      attempts.push({ url, outcome: outcome.status === 0 ? 'unreachable' : `http ${outcome.status}`, models: 0 })
      continue
    }
    const entries = catalogEntries(outcome.payload)
    if (entries === undefined) {
      // Something answered, but not with a catalog: keep looking rather than
      // reporting an empty model list.
      attempts.push({ url, outcome: 'unusable', models: 0 })
      continue
    }
    const models = uniqueModels(entries
      .map(entry => catalogEntryToModel(entry))
      .filter((model): model is ModelConfig => model !== undefined))
    // Log the catalog answer first: every fact the plugin stores rides on this
    // one response (#657 T-6b — there is no follow-up request any more).
    attempts.push({ url, outcome: 'ok', models: models.length })
    if (models.length > 0 || entries.length > 0) {
      return { models: stampDiscovery(models), origin: 'catalog', catalogUrl: url, scanned: entries.length, attempts }
    }
  }

  const modelsUrl = gatewayUrl(sources.apiUrl, '/models')
  const fallback = await getJson(modelsUrl, sources.apiKey)
  if (fallback.kind === 'ok') {
    const entries = modelEntries(fallback.payload)
    if (entries !== undefined) {
      const models = uniqueModels(entries
        .map(entry => openAiEntryToModel(entry))
        .filter((model): model is ModelConfig => model !== undefined))
      attempts.push({ url: modelsUrl, outcome: 'ok', models: models.length })
      return { models: stampDiscovery(models), origin: 'models', catalogUrl: modelsUrl, scanned: entries.length, attempts }
    }
    attempts.push({ url: modelsUrl, outcome: 'unusable', models: 0 })
  } else {
    attempts.push({ url: modelsUrl, outcome: fallback.status === 0 ? 'unreachable' : `http ${fallback.status}`, models: 0 })
  }

  // Nothing answered usefully. The attempts list is what makes this actionable.
  const detailed = attempts.map(attempt => `${attempt.url} → ${attempt.outcome}`).join('；')
  const unreachable = attempts.every(attempt => attempt.outcome === 'unreachable')
  throw new SeeWorkError(
    unreachable
      ? `连接不上你填的地址。已尝试：${detailed}。请确认网关地址与目录（service）地址是否可达。`
      : `没有读到可用的模型清单。已尝试：${detailed}。`,
    unreachable ? 'catalog_unreachable' : 'catalog_failed',
    attempts,
  )
}
