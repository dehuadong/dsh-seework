/**
 * The capability table: what one saved model **is**, and how two descriptions of
 * it are compared.
 *
 * One job lives here — the **shape of a model** and the **rules that turn a
 * request into the request this model actually accepts**: the settings schema
 * fragment it is stored with, how a raw document entry is read back, how two
 * entries with the same id are merged, which keys an older version wrote and this
 * one no longer stores, whether a fresh catalog description differs from the saved
 * one, and how a caller's request is resolved against the model's declared
 * capabilities (defaults filled, values this model refuses left out and reported).
 *
 * Why it is its own module (#669): the field list used to be restated in
 * `settings.ts` (schema, read-back, merge), `catalog-refresh.ts` (compare,
 * rebuild, retire), `catalog.ts` (discovery mapping) and the settings card (save,
 * fill), while the resolution rules sat next to the settings document. One field
 * addition was several coordinated edits and the copies could drift silently —
 * #668 fixed two such drifts. Discovery produces this shape, the settings
 * document stores it, the request builder resolves against it, and the
 * model-facing surfaces render it: one type, one field list, one set of rules.
 *
 * Nothing here reaches the network and nothing here discovers models: every value
 * is either a raw document entry or a catalog answer handed in by a caller.
 */

import z from 'schemastery'
import { effectiveImageCount, includesIgnoringCase, type DroppedParameter, type GenerateRequest, type ModelConfig } from './protocol.ts'

/**
 * The stored shape of one model (also the settings card's field contract).
 *
 * Declared once and reused by the settings schema: a field the document stores is
 * exactly a field this module knows how to read, merge and compare.
 */
export const modelSchema = z.object({
  id: z.string(),
  label: z.string().default(''),
  resolutions: z.array(z.string()).default([]),
  // The model's declared default tier (catalog v2's `resolution.default`).
  // Deliberately not derived from `resolutions[0]`: they can differ.
  resolutionDefault: z.string().default(''),
  aspectRatios: z.array(z.string()).default([]),
  outputFormats: z.array(z.string()).default([]),
  maxImages: z.number().default(1),
  maxReferenceImages: z.number().default(0),
  capabilitiesKnown: z.boolean().default(false),
  // When the catalog was last read for this model; **absent means unknown**
  // (a document written before the field existed). No default on purpose: a
  // default of 0 would be a second way to spell "unknown".
  discoveredAt: z.number(),
})

/**
 * Normalize a raw model entry (schema-adjacent guard for hand-built values).
 */
export function normalizeModel(value: unknown): ModelConfig | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '') return undefined
  const list = (input: unknown): string[] => Array.isArray(input)
    ? input.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
    : []
  const positive = (input: unknown, fallback: number): number =>
    typeof input === 'number' && Number.isFinite(input) && input >= 0 ? Math.trunc(input) : fallback
  return {
    id,
    label: typeof raw.label === 'string' ? raw.label.trim() : '',
    resolutions: list(raw.resolutions),
    resolutionDefault: typeof raw.resolutionDefault === 'string' ? raw.resolutionDefault.trim() : '',
    aspectRatios: list(raw.aspectRatios),
    outputFormats: list(raw.outputFormats),
    maxImages: positive(raw.maxImages, 1),
    maxReferenceImages: positive(raw.maxReferenceImages, 0),
    capabilitiesKnown: raw.capabilitiesKnown === true,
    // A document written before this field existed (or a hand-edited one) has
    // nothing here; "unknown" is the absence of the field, never "now" and
    // never a sentinel.
    ...typeof raw.discoveredAt === 'number' && Number.isFinite(raw.discoveredAt) && raw.discoveredAt > 0
      ? { discoveredAt: Math.trunc(raw.discoveredAt) }
      : {},
  }
}

/** Union of two string lists, first occurrence order, no duplicates. */
function unionList(left: string[], right: string[]): string[] {
  const out = [...left]
  for (const item of right) if (!out.includes(item)) out.push(item)
  return out
}

/**
 * Keep the newer of two discovery stamps, or nothing when neither knows.
 *
 * Spread-friendly so the caller does not have to spell the "absent means
 * unknown" rule again: an unstamped copy stays unstamped instead of acquiring a
 * `0` that other code would then have to special-case.
 *
 * @param left - one copy's stamp.
 * @param right - the other copy's stamp.
 * @returns `{ discoveredAt }` when at least one is known, otherwise `{}`.
 */
function newestStamp(left: number | undefined, right: number | undefined): { discoveredAt?: number } {
  const known = [left, right].filter((stamp): stamp is number => stamp !== undefined)
  return known.length === 0 ? {} : { discoveredAt: Math.max(...known) }
}

/**
 * Fold a duplicate catalog entry into the one already collected.
 *
 * The capability arrays are unioned rather than first-wins: a repeated id can
 * only mean the same model was described twice, and keeping the union makes the
 * request builder *more* permissive, never less. The declared default tier is
 * the one thing a union cannot reconstruct, so a copy that carries one keeps it
 * (there is exactly one default per model).
 */
export function mergeModel(into: ModelConfig, extra: ModelConfig): ModelConfig {
  return {
    id: into.id,
    label: into.label !== undefined && into.label !== '' ? into.label : extra.label,
    resolutions: unionList(into.resolutions, extra.resolutions),
    resolutionDefault: into.resolutionDefault !== undefined && into.resolutionDefault !== ''
      ? into.resolutionDefault
      : extra.resolutionDefault ?? '',
    aspectRatios: unionList(into.aspectRatios, extra.aspectRatios),
    outputFormats: unionList(into.outputFormats, extra.outputFormats),
    maxImages: Math.max(into.maxImages, extra.maxImages),
    maxReferenceImages: Math.max(into.maxReferenceImages, extra.maxReferenceImages),
    capabilitiesKnown: into.capabilitiesKnown === true || extra.capabilitiesKnown === true,
    // Two copies of one id are one model described twice; the newer read is the
    // one that describes the catalog as it is now. A copy with no stamp at all
    // stays unstamped ("unknown") unless its twin knows better.
    ...newestStamp(into.discoveredAt, extra.discoveredAt),
  }
}

/**
 * Read a whole raw `models` list: normalize every entry, drop the unusable ones,
 * and merge entries that repeat an id.
 *
 * @param value - the raw document value (anything; only an array is read).
 * @returns the normalized models, in first-occurrence order.
 */
export function normalizeModels(value: unknown): ModelConfig[] {
  const models: ModelConfig[] = []
  const byId = new Map<string, number>()
  for (const candidate of Array.isArray(value) ? value : []) {
    const model = normalizeModel(candidate)
    if (model === undefined) continue
    const existing = byId.get(model.id)
    if (existing === undefined) {
      byId.set(model.id, models.length)
      models.push(model)
      continue
    }
    models[existing] = mergeModel(models[existing]!, model)
  }
  return models
}

/** Substrings that mark a non-image model even when no type field is present. */
const NON_IMAGE_HINTS = [
  'embedding', 'embed', 'rerank', 'moderation', 'whisper', 'tts', 'audio',
  'realtime', 'transcribe', 'speech', 'ocr', 'chat', 'instruct', 'vision',
]

/** Substrings that mark an image model when no type field is present. */
const IMAGE_HINTS = [
  'image', 'dall-e', 'dalle', 'flux', 'seedream', 'seededit', 'imagen',
  'kolors', 'qwen-image', 'wanx', 'grok-imagine', 'stable-diffusion', 'sdxl',
]

/** Read a string array from an unknown value, dropping blanks and duplicates. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const text = typeof item === 'string' ? item.trim() : typeof item === 'number' ? String(item) : ''
    if (text !== '' && !out.includes(text)) out.push(text)
  }
  return out
}

/**
 * One descriptor from the entry's `supported_parameters` map.
 *
 * Catalog v2 describes **every field this deployment can send** with one
 * self-describing descriptor (`enum` / `range` / `boolean` / `array`). The key
 * existing is the permission: a key that is absent is a field this contract did
 * not publish — which is **not** a claim that upstream would refuse it.
 *
 * @param parameters - the entry's `supported_parameters`, when it carried one.
 * @param field - the Canonical field name (`resolution`, `n`, `image_urls`…).
 * @returns the descriptor, or undefined when the entry declared none.
 */
function descriptor(parameters: Record<string, unknown> | undefined, field: string): Record<string, unknown> | undefined {
  const value = parameters?.[field]
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

/**
 * The `values` of one `enum` descriptor, in the order it declares.
 *
 * **That order is the contract's order** — lowest to highest / display order —
 * so the returned list is used verbatim as the model's tier ranking. A
 * descriptor of any other shape declares no enum, and an entry without the key
 * declares the field not sendable at all.
 */
function enumValues(parameters: Record<string, unknown> | undefined, field: string): string[] {
  const meta = descriptor(parameters, field)
  return meta?.type === 'enum' ? stringList(meta.values) : []
}

/**
 * The `max` of one `range` or `array` descriptor — a field's own ceiling.
 *
 * The ceiling rides on the field it belongs to since v2 (`n.max` = images per
 * request, `image_urls.max` = reference images), replacing the old side keys.
 * `array`'s `max` counts elements; `range`'s is the numeric upper bound.
 *
 * @returns the ceiling, or undefined when the field declares none.
 */
function descriptorMax(parameters: Record<string, unknown> | undefined, field: string): number | undefined {
  const meta = descriptor(parameters, field)
  if (meta === undefined || (meta.type !== 'range' && meta.type !== 'array')) return undefined
  const max = meta.max
  return typeof max === 'number' && Number.isFinite(max) && max >= 0 ? Math.trunc(max) : undefined
}

/**
 * The `default` one descriptor declares, when it declares a string one.
 *
 * Read **verbatim**: the plugin never derives a default from the value list
 * (`values[0]` is not a substitute for a declared default), and the catalog's
 * own guarantee is that `resolution.default` is always published.
 *
 * @returns the declared default, or '' when there is none to read.
 */
function descriptorDefault(parameters: Record<string, unknown> | undefined, field: string): string {
  const meta = descriptor(parameters, field)
  return meta !== undefined && typeof meta.default === 'string' ? meta.default.trim() : ''
}

/** Whether a model id / type pair reads as an image model. */
export function looksLikeImageModel(id: string, type: unknown): boolean {
  if (typeof type === 'string' && type.trim() !== '') return type.trim().toLowerCase() === 'image'
  const lower = id.toLowerCase()
  const firstAt = (hints: string[]): number => hints.reduce((best, hint) => {
    const at = lower.indexOf(hint)
    return at >= 0 && (best < 0 || at < best) ? at : best
  }, -1)
  const imageAt = firstAt(IMAGE_HINTS)
  if (imageAt < 0) return false
  const otherAt = firstAt(NON_IMAGE_HINTS)
  // A name can carry both ("image-chat"); whichever hint comes first wins.
  return otherAt < 0 || imageAt < otherAt
}

/**
 * Map one SeeAI Hub catalog entry onto the model shape.
 *
 * Catalog v2 (`docs/api/catalog.md`) describes the sendable field surface with
 * `supported_parameters` descriptors; there is **one** reading path and no v1
 * fallback (#663/D-2). An entry that carries no `supported_parameters` at all
 * (a pre-v2 snapshot, or an older deployment) becomes **capabilities unknown**:
 * discovery still reports the model, and the request builder stops trimming
 * rather than reading "absent" as "refused" (#663/D-1).
 *
 * The result **is** the shape the settings document stores (#669): discovery used
 * to answer with a second, nearly identical type that every consumer projected by
 * hand. `discoveredAt` is stamped on the whole round by discovery, not here.
 *
 * @returns the model, or undefined when the entry is not an image model.
 */
export function catalogEntryToModel(value: unknown): ModelConfig | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const entry = value as Record<string, unknown>
  const id = typeof entry.name === 'string' ? entry.name.trim() : ''
  if (id === '' || !looksLikeImageModel(id, entry.type)) return undefined
  const declared = entry.supported_parameters
  const parameters = declared !== null && typeof declared === 'object'
    ? declared as Record<string, unknown>
    : undefined
  const displayName = typeof entry.display_name === 'string' && entry.display_name.trim() !== ''
    ? entry.display_name.trim()
    : id
  const maxReferenceImages = descriptorMax(parameters, 'image_urls') ?? 0
  return {
    id,
    label: displayName,
    // `values` order is the declared order (lowest first) — never sorted here.
    resolutions: enumValues(parameters, 'resolution'),
    resolutionDefault: descriptorDefault(parameters, 'resolution'),
    aspectRatios: enumValues(parameters, 'aspect_ratio'),
    outputFormats: enumValues(parameters, 'output_format'),
    maxImages: Math.max(1, descriptorMax(parameters, 'n') ?? 1),
    maxReferenceImages,
    capabilitiesKnown: parameters !== undefined,
  }
}

/** Map an OpenAI-compatible `/models` list onto the model shape. */
export function openAiEntryToModel(value: unknown): ModelConfig | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const entry = value as Record<string, unknown>
  const id = typeof entry.id === 'string' ? entry.id.trim() : ''
  if (id === '' || !looksLikeImageModel(id, entry.type ?? entry.model_type)) return undefined
  return {
    id,
    label: id,
    resolutions: [],
    resolutionDefault: '',
    aspectRatios: [],
    outputFormats: [],
    maxImages: 1,
    maxReferenceImages: 0,
    // A bare `/models` list carries ids only: nothing here says a parameter is
    // unsupported, so the request builder must not treat "no list" as "no".
    capabilitiesKnown: false,
  }
}

/** Whether two string lists are equal, order included. */
function sameList(left: readonly string[] | undefined, right: readonly string[]): boolean {
  const from = left ?? []
  return from.length === right.length && from.every((item, index) => item === right[index])
}

/**
 * Keys the settings schema no longer stores (#659 / #661 / #663).
 *
 * A document written before those batches carries them on every model. There is
 * no migration pass: an adopted entry is rebuilt field by field, so the residue
 * rides out with the next whole-`models` write. What these helpers add is the
 * **trigger** — see {@link CatalogRefresherDeps.hasRetiredKeys}.
 *
 * `qualities` joined the list in #661, when `quality` stopped being a plugin
 * parameter altogether. `orderedResolutions` / `resolutionOrderReliable` joined
 * it in #663, when catalog v2 made the enum descriptor's `values` order the one
 * declared order: both keys would be a second copy of `resolutions` itself.
 */
const RETIRED_MODEL_KEYS = [
  'parameters', 'parameterDocs', 'parameterRules', 'guidePath', 'qualities',
  'orderedResolutions', 'resolutionOrderReliable',
] as const

/**
 * Whether one saved entry still carries keys this plugin no longer stores.
 *
 * Takes `unknown` on purpose: the caller usually holds the **raw** document
 * entry. The normalized view ({@link normalizeModels}) has already dropped these
 * keys, so asking it would always answer "clean" — which is exactly why the
 * cleanup signal has to be read from the document.
 */
export function carriesRetiredKeys(entry: unknown): boolean {
  if (entry === null || typeof entry !== 'object') return false
  const record = entry as Record<string, unknown>
  return RETIRED_MODEL_KEYS.some(key => key in record)
}

/** Whether any entry of a raw `models` list still carries those keys. */
export function hasRetiredModelKeys(models: unknown): boolean {
  return Array.isArray(models) && models.some(entry => carriesRetiredKeys(entry))
}

/**
 * Whether one saved model's catalog description differs from the advertisement.
 *
 * Compared field by field rather than by serializing both objects: a
 * `discoveredAt` stamp or a key order would otherwise read as "changed" on every
 * round and write the document for nothing.
 *
 * @param saved - the saved model.
 * @param fresh - what the catalog says now.
 * @returns true when at least one advertised capability moved.
 */
export function capabilityChanged(saved: ModelConfig, fresh: ModelConfig): boolean {
  return saved.label !== fresh.label
    // Order included, on purpose: since v2 the array order *is* the declared
    // ranking, so a reordered list is a real capability change, not a set change.
    || !sameList(saved.resolutions, fresh.resolutions)
    || (saved.resolutionDefault ?? '') !== fresh.resolutionDefault
    || !sameList(saved.aspectRatios, fresh.aspectRatios)
    || !sameList(saved.outputFormats, fresh.outputFormats)
    || saved.maxImages !== fresh.maxImages
    || saved.maxReferenceImages !== fresh.maxReferenceImages
    // Direction matters: "described" → "unknown" (a pre-v2 snapshot) and back
    // both change what the request builder is allowed to trim.
    || saved.capabilitiesKnown !== fresh.capabilitiesKnown
    // The stamp is part of the comparison only in the "there was none" direction:
    // a model saved before the field existed must acquire one.
    || saved.discoveredAt === undefined
}

/**
 * The saved entry for a model the catalog just described.
 *
 * Field by field rather than a spread (#669 kept it that way on purpose): the
 * discovery answer and the stored entry are now the same type, so the only thing
 * this adds over `{ ...saved, ...fresh }` is the id and any unadvertised field
 * surviving, plus the stamp rule below. It stays explicit because the settings
 * schema is the authority on what may travel into the document.
 *
 * @param saved - the saved entry, whose id and any unadvertised field survive.
 * @param fresh - the catalog's current description.
 * @returns the entry to persist.
 */
function withRefreshedCapabilities(saved: ModelConfig, fresh: ModelConfig): ModelConfig {
  return {
    id: saved.id,
    label: fresh.label,
    resolutions: fresh.resolutions,
    resolutionDefault: fresh.resolutionDefault,
    aspectRatios: fresh.aspectRatios,
    outputFormats: fresh.outputFormats,
    maxImages: fresh.maxImages,
    maxReferenceImages: fresh.maxReferenceImages,
    capabilitiesKnown: fresh.capabilitiesKnown,
    // The whole round carries one stamp from discovery; a catalog answer that
    // somehow lacks one leaves the saved stamp alone rather than clearing it.
    ...fresh.discoveredAt === undefined
      ? saved.discoveredAt === undefined ? {} : { discoveredAt: saved.discoveredAt }
      : { discoveredAt: fresh.discoveredAt },
  }
}

/**
 * Apply one catalog round to the saved models.
 *
 * Pure on purpose: this is the whole of the "what may change automatically"
 * decision, so it is exercised directly rather than through a fake catalog.
 *
 * @param saved - the saved models, in their current order.
 * @param catalog - the models the catalog just reported.
 * @returns the list to persist (identical to `saved` when nothing changed) and
 *   the ids that were adopted, added, or vanished.
 */
export function adoptRefreshedCapabilities(
  saved: ModelConfig[],
  catalog: ModelConfig[],
): { models: ModelConfig[]; adopted: string[]; added: string[]; missing: string[] } {
  const byId = new Map(catalog.map(model => [model.id, model]))
  const savedIds = new Set(saved.map(model => model.id))
  /** Saved models the catalog still describes and that actually moved. */
  const refreshed = new Set<number>()
  saved.forEach((model, index) => {
    const fresh = byId.get(model.id)
    // A model the catalog no longer describes keeps its snapshot: the round is
    // not allowed to erase capabilities the user may still be using.
    if (fresh !== undefined && capabilityChanged(model, fresh)) refreshed.add(index)
  })
  // The same array when nothing was adopted, not merely an equal one: callers
  // use "nothing adopted" as their signal to leave the settings document alone,
  // and returning a fresh array would make that signal depend on `adopted` alone.
  const models = refreshed.size === 0
    ? saved
    : saved.map((model): ModelConfig => {
      const fresh = byId.get(model.id)
      // Once the round writes at all, **every** entry the catalog still
      // describes is rebuilt from the current shape — not only the ones whose
      // capabilities moved. A model the catalog no longer describes keeps its
      // snapshot by reference (this round is not allowed to erase it).
      return fresh === undefined ? model : withRefreshedCapabilities(model, fresh)
    })
  return {
    models,
    adopted: [...refreshed].map(index => saved[index]!.id),
    added: catalog.filter(model => !savedIds.has(model.id)).map(model => model.id),
    missing: saved.filter(model => !byId.has(model.id)).map(model => model.id),
  }
}

/** One parameter dropped because the selected model does not accept that value. */
export type { DroppedParameter } from './protocol.ts'

/** A request resolved against one model's declared capabilities. */
export interface ResolvedRequest {
  request: GenerateRequest
  /** The five regular parameters left out, and why. */
  dropped: DroppedParameter[]
}

/** Keep a value only when the model accepts it. */
function accepted(field: string, value: string, allowed: string[], dropped: DroppedParameter[], capabilitiesKnown: boolean): string {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'auto') return ''
  // No list and no catalog description = we know nothing, so the caller's
  // value is the best information available.
  if (allowed.length === 0 && !capabilitiesKnown) return trimmed
  const match = allowed.find(candidate => candidate.toLowerCase() === trimmed.toLowerCase())
  if (match !== undefined) {
    // Send the model's own spelling, not whatever the caller typed.
    return match
  }
  dropped.push({ field, value: trimmed, allowed, reason: 'invalid_value' })
  return ''
}

/**
 * The tier a request uses when the caller names none.
 *
 * It is **exactly what the catalog declared** (`resolution.default`), never the
 * first entry of the tier list: a model may declare a default that is not its
 * lowest tier, so `resolutions[0]` is not a substitute (#663/D-3). An empty
 * answer means the contract declared none — a breach of the "always published"
 * invariant — and the caller then omits the field rather than guessing one
 * (#663/P3). The missing default is reported in the announcement instead.
 */
export function defaultResolutionFor(model: ModelConfig): string {
  return model.resolutionDefault?.trim() ?? ''
}

/**
 * A configured default the model actually declares, or `''` to omit the field.
 *
 * The plugin's own defaults are not values the caller named: a model that does
 * not declare one — or whose capabilities are unknown, so the plugin has no
 * evidence either way — gets the field omitted, and nothing is ever reported as
 * a dropped parameter. `accepted()` is the caller-facing half of the same rule.
 *
 * Spelling: a value the caller named is echoed back in the **model's** spelling
 * (`accepted()`); the plugin's configured default travels **verbatim** or not at
 * all, because there is no model spelling to prefer for a value the plugin chose.
 *
 * @param model - the selected model's catalog entry.
 * @param configured - the value from the plugin settings.
 * @param allowed - the values this model declares for that field.
 */
function configuredWhenAccepted(model: ModelConfig, configured: string, allowed: string[]): string {
  const wanted = configured.trim()
  if (wanted === '' || model.capabilitiesKnown !== true) return ''
  return includesIgnoringCase(allowed, wanted) ? wanted : ''
}

/**
 * The configured output format, when this model can actually take it (#658/D-13).
 *
 * A format the model does not declare (or a model whose capabilities are unknown)
 * yields '' so the field is simply omitted — the plugin must not gamble a field
 * on a model it knows nothing about.
 */
export function defaultOutputFormatFor(model: ModelConfig, configured: string): string {
  return configuredWhenAccepted(model, configured, model.outputFormats)
}

/**
 * The configured aspect ratio, when this model can actually take it (#668).
 *
 * Same rule as {@link defaultOutputFormatFor}, and for the same reason: the
 * contract publishes **no** default for `aspect_ratio` (`docs/api/images.md`), so
 * the plugin's own setting is the only candidate — and a model that does not
 * declare it (or whose capabilities are unknown) simply gets the field omitted.
 * The configured value is not the caller's, so it is never reported as a dropped
 * parameter.
 */
export function defaultAspectRatioFor(model: ModelConfig, configured: string): string {
  return configuredWhenAccepted(model, configured, model.aspectRatios)
}

/**
 * The plugin's own generation defaults, as the settings document spells them.
 *
 * A named type rather than an inline bag (#669): these two travel together
 * wherever a request is resolved, and they are **not** caller values — see
 * {@link resolveRequest}.
 */
export interface GenerationDefaults {
  /** Configured aspect ratio, used when the caller names none. */
  aspectRatio?: string
  /** Configured output format, used when the caller names none. */
  outputFormat?: string
}

/**
 * Resolve a request against the selected model's capability table.
 *
 * SeeAI Hub validates every parameter against the model: a value outside the
 * model's enum is a 400, and so is a parameter the model does not take at all.
 * What an empty list means depends on where the model came from — see
 * {@link ModelConfig.capabilitiesKnown}.
 *
 * Two kinds of value meet here, and they are treated differently on purpose:
 * a value the **caller** named goes through `accepted()` (kept in the model's own
 * spelling, or reported as dropped), while a value the **plugin** configured goes
 * through {@link configuredWhenAccepted} (sent verbatim, or silently omitted and
 * never reported as the caller's mistake).
 *
 * @param request - the caller's request, already resolved to a configured model.
 * @param model - that model's catalog entry.
 * @param defaults - the configured defaults, used when the caller names neither.
 * @returns the request to send, plus what was left out.
 */
export function resolveRequest(
  request: GenerateRequest,
  model: ModelConfig,
  defaults: GenerationDefaults = {},
): ResolvedRequest {
  const dropped: DroppedParameter[] = []
  const known = model.capabilitiesKnown === true
  // #658/D-15: `n` defaults to 1 in code (there is no "images per request" setting).
  // The composition itself lives in `protocol.ts` (#668): this record, the
  // library entry and the outgoing body all carry the same number instead of
  // three spellings of the same clamp.
  const count = effectiveImageCount(request.n, model.maxImages)
  const wantsReferences = request.imageUrls.length > 0
  // A bare `/models` discovery cannot say "no reference images"; only a real
  // descriptor set can, and there the `image_urls` ceiling is explicit.
  const referencesAllowed = model.maxReferenceImages > 0 || !known
  if (wantsReferences && !referencesAllowed) {
    dropped.push({ field: 'image_urls', value: `${request.imageUrls.length} 张参考图`, allowed: [], reason: 'unsupported_field' })
  }
  // #658/D-17 + #663/D-3: a caller that names no tier gets the model's declared
  // default (`resolution.default`), which is **always sent explicitly** — the
  // gateway does not pick a tier for you, so omitting is not equivalent to
  // declaring one. A model whose contract declared no default leaves the field
  // out rather than guessing. A tier the plugin filled is never recorded as
  // dropped, exactly like the configured format below: the plugin's own default
  // must not surface as "the caller sent a value this model refuses".
  const requestedResolution = request.resolution.trim()
  const normalized: GenerateRequest = {
    ...request,
    n: count,
    resolution: requestedResolution !== ''
      ? accepted('resolution', requestedResolution, model.resolutions, dropped, known)
      : defaultResolutionFor(model),
    aspectRatio: request.aspectRatio.trim() !== ''
      ? accepted('aspect_ratio', request.aspectRatio, model.aspectRatios, dropped, known)
      : defaultAspectRatioFor(model, defaults.aspectRatio ?? ''),
    // #658/D-13: the configured format is the fallback, and only for a model that
    // declares it — the default must never be recorded as a dropped parameter.
    outputFormat: accepted('output_format', request.outputFormat.trim() || defaultOutputFormatFor(model, defaults.outputFormat ?? ''), model.outputFormats, dropped, known),
    imageUrls: wantsReferences && referencesAllowed ? request.imageUrls : [],
    ...wantsReferences && !referencesAllowed ? { refNames: undefined } : {},
    mode: wantsReferences && referencesAllowed ? 'edit' : 'text',
  }
  return { request: normalized, dropped }
}
