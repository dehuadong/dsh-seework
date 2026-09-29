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
import type { SettingsNamespace, SettingsProvider } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { modelSchema, normalizeModels } from './capability.ts'
import { DEFAULT_API_URL, DEFAULT_ASPECT_RATIO, DEFAULT_OUTPUT_FORMAT, DEFAULT_SERVICE_URL, SEEWORK_SETTINGS_NAMESPACE, type ModelConfig } from './protocol.ts'

/** The branded settings namespace of this plugin. */
export const SeeWorkSettingsNamespace = SEEWORK_SETTINGS_NAMESPACE as SettingsNamespace

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch for the agent tools and the routes they need. */
  enabled?: boolean
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

/** The plugin config schema (also the settings card's field contract). */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
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
})

/** Resolved runtime view of the settings the host half acts on. */
export interface EffectiveConfig {
  enabled: boolean
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

/** Service face this module needs from the settings provider. */
interface SettingsProviderFace {
  installSection: SettingsProvider['installSection']
}

/**
 * Bind the plugin to its settings section.
 *
 * While a settings provider is attached the section's resolved value is
 * authoritative and every commit re-notifies the caller; without a provider
 * (bare composition, tests) the composition entry itself is the source. The
 * namespace registration is an effect on the calling fiber, so unloading the
 * plugin removes both the section and its observers.
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
  let current: () => Config = () => entry
  ctx.inject(['settings'], (sctx) => {
    const provider = sctx.get('settings') as unknown as SettingsProviderFace | undefined
    if (provider === undefined || typeof provider.installSection !== 'function') {
      throw new TypeError('dsh-seework: the settings service does not expose installSection')
    }
    provider.installSection(ctx, SeeWorkSettingsNamespace, Config, entry, {
      setSource: (source) => {
        current = source as () => Config
        hooks.onChange()
      },
      onChange: hooks.onChange,
    })
  })
  return () => current()
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
 * The per-model shape itself is `capability.ts`'s business (#669): this module
 * owns the document — the connection, the generation defaults, the data root —
 * and hands the model list to {@link normalizeModels}.
 */
export function effectiveConfig(value: Config | undefined): EffectiveConfig {
  const source = value ?? {}
  const models = normalizeModels(source.models)
  const requestedDefault = typeof source.defaultModel === 'string' ? source.defaultModel.trim() : ''
  return {
    enabled: source.enabled ?? true,
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
