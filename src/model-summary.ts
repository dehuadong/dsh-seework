/**
 * The single data owner for what the agent is told about saved models.
 *
 * One job lives here: **the capability vocabulary** — the tier line (declared
 * order, declared default, and the wording for the two degraded states), the
 * per-request image cap — which the every-turn **announcement**
 * (`src/index.ts::guidanceFor`) renders as one line for the default model.
 * Computing the capability vocabulary twice is how an announcement starts
 * promising a value the request builder then drops.
 *
 * Scope note (do not let the name overpromise): this is the **model-facing**
 * owner, not the request-side one. The request builder keeps its own landing
 * points in `src/settings.ts`, and the per-request image cap is shared through
 * `MAX_IMAGES_PER_REQUEST` (`protocol.ts`) rather than decided here a second
 * time.
 *
 * Nothing here reaches the network and nothing here discovers models: every
 * value is read from the **saved settings document** alone (design discipline 3:
 * same source as the announcement, no second discovery, no request at render
 * time).
 *
 * Two rules this module must never get wrong:
 *
 *  - **The tier list is already ordered** (catalog v2: an enum descriptor's
 *    `values` order *is* the declared order, lowest first). There is no second
 *    "published order" key left to consult, and no lexicographic array to
 *    distrust — `["512","1K","2K","4K"]` arrives as written.
 *  - **A model the catalog never described is "details unknown", not "nothing
 *    supported".** A bare `/models` entry carries no descriptor set at all, so
 *    the honest line lists the identifier and says the rest cannot be read from
 *    the plugin — inventing "text-to-image only, 1 image" there would be a claim
 *    nobody made.
 */

import type { EffectiveConfig } from './settings.ts'
import { defaultResolutionFor } from './capability.ts'
import { modelName } from './settings.ts'
import { imageCountCeiling, type ModelConfig } from './protocol.ts'

/**
 * The wording for a model whose entry declared no default tier.
 *
 * The contract always publishes `resolution.default`, so this state is a breach
 * of that invariant rather than a normal kind of model: the plugin omits the
 * field instead of guessing a tier (#663/P3), and the agent should ask the user
 * to name one of the listed tiers. Kept as a constant because it is a *claim
 * about the data*, not decoration.
 */
export const RESOLUTION_DEFAULT_MISSING = '目录未提供缺省档，不指定时不发这一项'

/**
 * The wording for a model the catalog never described (a bare `/models` entry,
 * or a settings document written by hand).
 */
export const DETAILS_UNKNOWN =
  '细节未知：这个模型不是从 SeeAI Hub 目录读到的（可能只来自裸 `/models` 列表），插件不知道它收哪些字段。'
  + '只用工具 schema 里的常用参数，并按设置里的默认值来；不要猜扩展字段。'

/** One saved model, reduced to what the model-facing surface renders. */
export interface ModelSummary {
  /** Request identifier (`model.id`) — the value that actually goes on the wire. */
  id: string
  /** `name[id]` when a distinct display name exists, otherwise just the id. */
  identifier: string
  /** Whether the catalog described this model at all. */
  known: boolean
  /** The one-line capability the announcement shows for the default model. */
  capabilityLine: string
}

/** The saved models, split into the default one and the rest (announcement shape). */
export interface SavedModelSummaries {
  /** The model a request uses when the caller names none, if any is saved. */
  defaultModel?: ModelSummary
  /**
   * Position of the default entry within {@link all}, or -1 when nothing is
   * saved. Position, not id: a hand-built document may repeat an id, and the
   * surface must then agree on **which entry** is the default instead of
   * marking both.
   */
  defaultIndex: number
  /** Every other saved model, in settings order — identifiers only in the announcement. */
  others: ModelSummary[]
}

/**
 * Images one request may ask for.
 *
 * Both halves of the limit are shared rather than restated: the per-model cap is
 * the catalog's `maxImages`, and the composition with the wire ceiling lives in
 * `protocol.ts` — the same one the request side clamps `n` with (#668).
 */
export function maxImagesPerRequest(model: ModelConfig): number {
  return imageCountCeiling(model.maxImages)
}

/**
 * The tier clause of a capability line.
 *
 * The list is already in declared order, so the clause states it as a ranking
 * and only adds a caveat when the model's contract declared no default tier (in
 * which case a request that names no tier sends none at all).
 *
 * @param model - the configured model.
 * @returns the clause; it never claims a ranking the list does not carry,
 *   because a list that carries none is empty.
 */
export function tierLine(model: ModelConfig): string {
  const tiers = model.resolutions
  if (tiers.length === 0) return '档位由上游决定'
  const line = `档位 ${tiers.join('/')}（低到高）`
  return defaultResolutionFor(model) === '' ? `${line}（${RESOLUTION_DEFAULT_MISSING}）` : line
}

/**
 * The one line the announcement shows for a model.
 *
 * @param model - the configured model.
 * @returns tier order, ratios, reference-image cap and per-request image cap.
 */
export function capabilityLineFor(model: ModelConfig): string {
  if (model.capabilitiesKnown !== true) return DETAILS_UNKNOWN
  return [
    tierLine(model),
    model.aspectRatios.length > 0 ? `比例 ${model.aspectRatios.join('/')}` : '比例由上游决定',
    model.maxReferenceImages > 0 ? `可带参考图 ≤${model.maxReferenceImages}` : '仅文生图',
    `一次最多 ${maxImagesPerRequest(model)} 张`,
  ].join('，')
}

/** The model's identifier as the agent must spell it: `label[id]`, or the id. */
export function modelIdentifier(model: ModelConfig): string {
  const name = modelName(model)
  return name === model.id ? model.id : `${name}[${model.id}]`
}

/**
 * Reduce one saved model to its identifier and capability line.
 *
 * @param model - the configured model.
 * @returns the summary the model-facing surface renders.
 */
export function summarizeModel(model: ModelConfig): ModelSummary {
  return {
    id: model.id,
    identifier: modelIdentifier(model),
    known: model.capabilitiesKnown === true,
    capabilityLine: capabilityLineFor(model),
  }
}

/**
 * Split the saved models the way the announcement needs them.
 *
 * The default model is the one a request falls back to ({@link EffectiveConfig}
 * already resolved that), so "other models" means "every saved model except
 * it".
 *
 * @param config - the live settings view.
 * @returns the default summary, its position, and the others.
 */
export function summarizeSavedModels(config: EffectiveConfig): SavedModelSummaries {
  const all = config.models.map(model => summarizeModel(model))
  // Matched by id, but everything downstream compares the **position**: a
  // document whose `defaultModel` names nothing saved falls back to the first
  // entry, and that entry must not also show up under "other models".
  const found = all.findIndex(summary => summary.id === config.defaultModel)
  const defaultIndex = found >= 0 ? found : (all.length > 0 ? 0 : -1)
  return {
    defaultModel: defaultIndex >= 0 ? all[defaultIndex] : undefined,
    defaultIndex,
    others: all.filter((_summary, index) => index !== defaultIndex),
  }
}
