/**
 * The plugin's settings section: the SeeAI Hub connection (API address + user
 * API key), the model catalog the user selected, generation limits, and the
 * local data root.
 *
 * The composition entry (`cordis.yml` / the bundle patch) declares the same
 * shape and acts as the schema defaults plus the fallback when no settings
 * provider is attached — exactly the optional-settings contract
 * `SettingsProvider.installSection` implements. The API key is a
 * `role('secret')` field, so every wire surface (including this plugin's own
 * settings bridge) reads it redacted and writes it by path-op only.
 */

import type { Context } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { modelSchema, normalizeModels } from './capability.ts'
import { DEFAULT_API_URL, DEFAULT_ASPECT_RATIO, DEFAULT_OUTPUT_FORMAT, DEFAULT_SERVICE_URL, SEEWORK_SETTINGS_NAMESPACE, type ModelConfig } from './protocol.ts'

/** The branded settings namespace of this plugin. */
export const SeeWorkSettingsNamespace = SEEWORK_SETTINGS_NAMESPACE as SettingsNamespace

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Whether agents may generate images through this plugin. */
  allowAgentGeneration?: boolean
  /** Announce the plugin, its models, and its limits in every agent's system prompt. */
  announceToAgent?: boolean
  /** OpenAI-compatible gateway root, e.g. `http://127.0.0.1:8080/v1`. */
  apiUrl?: string
  /**
   * SeeAI Hub service base for the model catalog, e.g.
   * `http://127.0.0.1:8081`. The catalog lives on the service, not the
   * Gateway; leave it at the default unless your deployment differs.
   */
  serviceUrl?: string
  /** SeeAI Hub user API key (`sk-…`); stored redacted, never returned on the wire. */
  apiKey?: string
  /** Models the user picked from the gateway catalog. */
  models?: ModelConfig[]
  /** Default model id; empty falls back to the first catalog entry. */
  defaultModel?: string
  /** Default aspect ratio for a request that names none (#658/D-16 统一集合，出厂 `3:4`). */
  defaultAspectRatio?: string
  /** Default output format (#658/D-13 出厂 `png`；空串表示不发送该字段). */
  outputFormat?: string
  /** Local data root for the material library; empty uses `<DSH_HOME>/dsh-seework`. */
  dataDir?: string
}

/**
 * The generation defaults the plugin ships with, defined once.
 *
 * The config schema below fills a document that omits them and
 * {@link effectiveConfig} fills a source that does; both read the values from
 * their owner in `protocol.ts` rather than typing them again. A user's explicit
 * value always wins; a value the selected model does not accept is dropped before
 * sending (`capability.ts::resolveRequest`), while the plugin's own fallbacks are
 * omitted without being recorded as the caller's mistake. `resolution` has no
 * setting (#658/D-17) — it is derived per model.
 */
export { DEFAULT_ASPECT_RATIO, DEFAULT_OUTPUT_FORMAT } from './protocol.ts'

/**
 * The plugin's field contract, without the live-reference marker.
 *
 * This is what tests and tooling validate a raw document against; the loader
 * validates the entry with {@link Config} below, which is the same shape wrapped
 * once more.
 *
 * The assertion is load-bearing, not decoration: this fork's `object()` helper
 * leaves each field's mode generic in its output type (`SetRequired<Mode, true>`
 * rather than the resolved `'defined'`), so an inferred schema no longer
 * satisfies `z<Config>` even though it resolves to exactly that shape at
 * runtime — the same schema this plugin shipped before the fork.
 */
export const ConfigShape = z.object({
  allowAgentGeneration: z.boolean().default(true),
  announceToAgent: z.boolean().default(true),
  apiUrl: z.string().default(DEFAULT_API_URL),
  serviceUrl: z.string().default(DEFAULT_SERVICE_URL),
  apiKey: z.string().role('secret').default(''),
  models: z.array(modelSchema).default([]),
  defaultModel: z.string().default(''),
  defaultAspectRatio: z.string().default(DEFAULT_ASPECT_RATIO),
  outputFormat: z.string().default(DEFAULT_OUTPUT_FORMAT),
  dataDir: z.string().default(''),
}) as z<Config>

/**
 * The plugin config schema the loader validates the profile entry with (also the
 * settings card's field contract).
 *
 * The trailing `.volatile()` is what makes these fields editable at all from
 * DSH 0.2 onwards: that host projects a settings form **out of this schema** and
 * admits only fields under a volatile node, so a schema without one yields an
 * empty form and every write is refused with "has no volatile fields". The same
 * marker is also how the plugin receives its values — the loader swaps one live
 * reference in place instead of re-applying the plugin, which is what
 * {@link installSettingsSection} unwraps.
 *
 * On 0.1.x the marker is inert (that host has no schema-projected forms and the
 * section registration below owns the values), so the same schema serves both.
 */
export const Config = ConfigShape.volatile()

/** Resolved runtime view of the settings the host half acts on. */
export interface EffectiveConfig {
  allowAgentGeneration: boolean
  announceToAgent: boolean
  apiUrl: string
  serviceUrl: string
  apiKey: string
  models: ModelConfig[]
  defaultModel: string
  defaultAspectRatio: string
  outputFormat: string
  dataDir: string
}

/**
 * The one seam this module needs from a settings provider.
 *
 * Spelled structurally rather than as `SettingsProvider['installSection']`: the
 * 0.1.x declaration is typed against that generation's schemastery, and this
 * plugin builds its schema with the vendored `@deepseek-ai/schemastery` that
 * carries `.volatile()`. The two are the same object at runtime, so the seam is
 * described by the call this module makes and nothing else.
 */
interface SettingsProviderFace {
  installSection(owner: Context, ns: unknown, schema: unknown, entry: unknown, hooks: unknown): void
}

/**
 * Read the current value out of whatever the host handed over.
 *
 * DSH 0.2 and later resolve a volatile schema to one live reference and swap the
 * value in place, so the reference itself is the freshest answer on every call.
 * Older hosts and bare compositions pass a plain object.
 *
 * @param value - the resolved config, possibly wrapped in a volatile reference.
 * @returns the plain config.
 */
function readConfig(value: unknown): Config {
  return (isVolatile(value) ? value.get() : value) as Config
}

/**
 * Bind the plugin to its settings section.
 *
 * Two host generations, one read seam:
 *
 *  - A host exposing `installSection` (DSH 0.1.x) keeps the section as the
 *    authoritative source and re-notifies the caller on every commit.
 *  - A host without it (DSH 0.2 onwards, where forms are projected from the
 *    profile entry's own Config) has nothing to register: the value arrives as
 *    a live reference, and there is no change notification to subscribe to
 *    because the reference never goes stale.
 *
 * Either way the returned thunk answers a plain `Config`, so callers below are
 * independent of which generation is in force. The namespace registration is an
 * effect on the calling fiber, so unloading the plugin removes both the section
 * and its observers.
 *
 * @param ctx - host plugin context.
 * @param entry - the composition entry used as the base layer and fallback.
 * @param hooks - notified whenever the authoritative source or its value changes.
 * @returns a thunk reading the currently authoritative raw value.
 */
export function installSettingsSection(
  ctx: Context,
  entry: Config,
  hooks: { onChange: () => void },
): () => Config {
  let current: () => Config = () => readConfig(entry)
  ctx.inject(['settings'], (sctx) => {
    const provider = sctx.get('settings') as unknown as SettingsProviderFace | undefined
    if (provider === undefined || typeof provider.installSection !== 'function') return
    provider.installSection(ctx, SeeWorkSettingsNamespace, Config, entry, {
      setSource: (source: unknown) => {
        current = () => readConfig((source as () => unknown)())
        hooks.onChange()
      },
      onChange: hooks.onChange,
    })
  })
  return () => current()
}

/**
 * Whether a stored document still carries the retired plugin master switch.
 *
 * Read from the document rather than from {@link effectiveConfig}: the key is no
 * longer part of the schema, so the resolved view could never report it — and it is
 * the resolved view's silence that has to be turned into a cleanup (#5).
 *
 * @param document - the raw settings document.
 * @returns true when `enabled` is still there.
 */
export function hasRetiredEnableSwitch(document: unknown): boolean {
  return document !== null && typeof document === 'object' && 'enabled' in document
}

/**
 * Apply schema defaults and normalize a raw config into the runtime view.
 *
 * Keys an older plugin version wrote and this one no longer stores are
 * **deliberately not read** (#653 / #659 / #661 / #663): `defaultQuality` is not
 * read (the plugin never decides a picture's quality), a per-model `qualities`
 * list is not read either, and `orderedResolutions` / `resolutionOrderReliable`
 * are gone with catalog v1 (the declared order now *is* the `resolutions` array,
 * so keeping either would be a second truth). An old document keeps working with
 * those keys simply ignored; the per-model residue rides out with the next
 * whole-`models` write: `catalog-refresh.ts` triggers it when
 * `capability.ts::hasRetiredModelKeys` reports a raw document that still carries
 * them (the dep it is handed is `hasRetiredKeys`).
 *
 * `enabled` is retired the same way (#5): the plugin's own master switch
 * duplicated the host's plugin enable/disable, which is the switch a user
 * actually reaches for, and it meant the same thing as
 * {@link EffectiveConfig.allowAgentGeneration} for everything the agent could do.
 * A document that still carries `enabled: false` keeps working — the key is simply
 * ignored, and the plugin is as enabled as the host says it is.
 *
 * The per-model shape itself is `capability.ts`'s business (#669): this module
 * owns the document — the connection, the generation defaults, the data root —
 * and hands the model list to {@link normalizeModels}.
 */
export function effectiveConfig(value: Config | undefined): EffectiveConfig {
  const source = value ?? {}
  const models = normalizeModels(source.models)
  const requestedDefault = typeof source.defaultModel === 'string' ? source.defaultModel.trim() : ''
  return {
    allowAgentGeneration: source.allowAgentGeneration ?? true,
    announceToAgent: source.announceToAgent ?? true,
    apiUrl: typeof source.apiUrl === 'string' && source.apiUrl.trim() !== '' ? source.apiUrl.trim() : DEFAULT_API_URL,
    serviceUrl: typeof source.serviceUrl === 'string' && source.serviceUrl.trim() !== '' ? source.serviceUrl.trim() : DEFAULT_SERVICE_URL,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : '',
    models,
    defaultModel: models.some(model => model.id === requestedDefault) ? requestedDefault : (models[0]?.id ?? ''),
    defaultAspectRatio: typeof source.defaultAspectRatio === 'string' && source.defaultAspectRatio.trim() !== ''
      ? source.defaultAspectRatio.trim()
      : DEFAULT_ASPECT_RATIO,
    outputFormat: typeof source.outputFormat === 'string' && source.outputFormat.trim() !== ''
      ? source.outputFormat.trim()
      : DEFAULT_OUTPUT_FORMAT,
    dataDir: typeof source.dataDir === 'string' ? source.dataDir.trim() : '',
  }
}

/** The model entry a request should use, or undefined when nothing matches. */
export function resolveModel(config: EffectiveConfig, requested: string | undefined): ModelConfig | undefined {
  const wanted = requested?.trim() ?? ''
  if (wanted !== '') {
    const exact = config.models.find(model => model.id === wanted)
    if (exact !== undefined) return exact
    const byLabel = config.models.find(model => model.label === wanted)
    if (byLabel !== undefined) return byLabel
  }
  if (config.defaultModel !== '') {
    return config.models.find(model => model.id === config.defaultModel)
  }
  return config.models[0]
}

/** Human-readable model name (label when set, else the id). */
export function modelName(model: ModelConfig): string {
  return model.label !== undefined && model.label !== '' ? model.label : model.id
}
