/**
 * Settings-document tests: how a raw document becomes the runtime view.
 *
 * The per-model shape and the request-resolution rules moved to
 * `capability.test.ts` with their module (#669); what is left here is the
 * document itself — defaults, the model list as a whole, and model resolution.
 */

import { describe, expect, it } from 'vitest'
import { defaultResolutionFor } from './capability.ts'
import { Config as ConfigSchema, effectiveConfig, modelName, resolveModel, type Config } from './settings.ts'
import type { ModelConfig } from './protocol.ts'

/** A seedream-like model: 2K/3K/4K, jpeg/png only, reference-capable. */
function model(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'seedream-5-0-lite',
    label: 'Seedream 5.0 Lite',
    resolutions: ['2K', '3K', '4K'],
    aspectRatios: ['16:9', '1:1'],
    outputFormats: ['jpeg', 'png'],
    maxImages: 4,
    maxReferenceImages: 2,
    capabilitiesKnown: true,
    ...overrides,
  }
}

describe('effectiveConfig', () => {
  it('normalizes a model list and drops unusable entries', () => {
    const config = effectiveConfig({
      models: [
        model(),
        { id: '  ' } as ModelConfig,
        model({ id: 'gpt-image-2' }),
      ],
    })
    expect(config.models.map(entry => entry.id)).toEqual(['seedream-5-0-lite', 'gpt-image-2'])
  })

  it('merges a repeated model id by unioning its capabilities', () => {
    // A duplicated id can only mean the same model described twice; keeping the
    // union means the request builder gets *more* room, never less.
    const config = effectiveConfig({
      models: [
        model({ resolutions: ['2K'], maxImages: 2, maxReferenceImages: 1 }),
        model({ resolutions: ['4K'], maxImages: 4, maxReferenceImages: 3 }),
      ],
    })
    expect(config.models).toHaveLength(1)
    expect(config.models[0]!.resolutions).toEqual(['2K', '4K'])
    expect(config.models[0]!.maxImages).toBe(4)
    expect(config.models[0]!.maxReferenceImages).toBe(3)
  })

  it('keeps the declared default tier when one id is described twice (#663/D-4)', () => {
    // The default is the one fact a union cannot reconstruct, so a copy that
    // carries one keeps it instead of being averaged with an empty twin.
    const config = effectiveConfig({
      models: [
        model({ resolutionDefault: '' }),
        model({ resolutions: ['4K'], resolutionDefault: '4K' }),
      ],
    })
    expect(config.models).toHaveLength(1)
    expect(config.models[0]!.resolutionDefault).toBe('4K')
  })

  it('keeps the service address separate from the gateway address', () => {
    const config = effectiveConfig({ apiUrl: 'https://gw.example.com/v1', serviceUrl: 'https://api.example.com' })
    expect(config.apiUrl).toBe('https://gw.example.com/v1')
    expect(config.serviceUrl).toBe('https://api.example.com')
    // Both have documented development defaults.
    expect(effectiveConfig({}).serviceUrl).toBe('http://127.0.0.1:8081')
  })

  it('falls back to the first model when the default names a model that is gone', () => {
    const config = effectiveConfig({ models: [model({ id: 'a' }), model({ id: 'b' })], defaultModel: 'gone' })
    expect(config.defaultModel).toBe('a')
    expect(resolveModel(config, undefined)?.id).toBe('a')
    expect(resolveModel(config, 'b')?.id).toBe('b')
  })

  it('resolves an explicit unknown name to the default model, which the runtime then refuses', () => {
    // `resolveModel` answers "which configured model would serve this?" and the
    // runtime separately rejects a named model it cannot honor, so an unknown
    // name can never be silently downgraded to the default.
    const config = effectiveConfig({ models: [model({ id: 'a' }), model({ id: 'b' })], defaultModel: 'a' })
    expect(resolveModel(config, 'nope')?.id).toBe('a')
  })

  it('resolves a model by its display label', () => {
    const config = effectiveConfig({ models: [model({ id: 'seedream-5-0-lite', label: 'Seedream 5.0 Lite' })] })
    expect(resolveModel(config, 'Seedream 5.0 Lite')?.id).toBe('seedream-5-0-lite')
  })

  it('applies the agreed generation defaults to a source that omits them', () => {
    // The schema's defaults and this function's fallback are two ways into the
    // same setting, so they must not be able to disagree. `resolution` is no
    // longer among them: it is derived per model (#658/D-17).
    const config = effectiveConfig({})
    expect(config.defaultAspectRatio).toBe('3:4')
    expect(config.outputFormat).toBe('png')
  })

  it('falls back to the factory defaults for a legacy document that emptied them', () => {
    // #658/D-13/D-16: the card no longer offers "leave it to the gateway", and the
    // request layer reads "no value" as "use the factory one" — an emptied field in
    // an old document therefore resolves to `3:4` / `png`, not to a hole.
    const config = effectiveConfig({ defaultAspectRatio: '', outputFormat: '' })
    expect(config.defaultAspectRatio).toBe('3:4')
    expect(config.outputFormat).toBe('png')
  })

  it('does not read the retired per-model keys (#659 / #661 / #663)', () => {
    // #659 dropped the extra-parameter passthrough, #661 dropped `qualities`,
    // #663 dropped the v1 tier-order pair. A document written before those still
    // holds them on every model: none is read, none is part of the normalized
    // model, and the schema does not blow up on them. They disappear from disk on
    // the next whole-`models` rewrite (see the refresh test).
    const legacy = {
      ...model(),
      parameters: ['background', 'moderation'],
      parameterDocs: { background: { description: '背景' } },
      parameterRules: { background: { values: ['opaque'] } },
      guidePath: '/api/v1/catalog/models/seedream-5-0-lite/guide',
      qualities: ['low', 'high'],
      orderedResolutions: ['2K', '3K', '4K'],
      resolutionOrderReliable: true,
    } as unknown as ModelConfig
    const resolved = ConfigSchema({ models: [legacy] })
    const config = effectiveConfig(resolved)
    expect(config.models).toHaveLength(1)
    for (const retired of ['parameters', 'parameterDocs', 'parameterRules', 'guidePath', 'qualities', 'orderedResolutions', 'resolutionOrderReliable']) {
      expect(config.models[0]).not.toHaveProperty(retired)
    }
    // The retired order pair is not a fallback for the declared default either:
    // `resolutionDefault` is the only source, and this document has none.
    expect(defaultResolutionFor(config.models[0]!)).toBe('')
  })

  it('safely ignores keys an older version saved (#653 / #658)', () => {
    // The plugin must neither honour the key nor blow up on it: an old document
    // keeps working and the key is simply not read. Deliberately plugin-level
    // here: an unused scalar is left alone rather than rewritten by a read.
    // (Per-model passthrough keys are a different case — #659 cleans those off
    // whenever `models` is rewritten as a whole; see the refresh test.)
    const legacy = {
      defaultQuality: 'high',
      defaultResolution: '2K',
      imagesPerRequest: 4,
    } as unknown as Config
    const config = effectiveConfig(legacy)
    expect(config).not.toHaveProperty('defaultQuality')
    expect(config).not.toHaveProperty('defaultResolution')
    expect(config).not.toHaveProperty('imagesPerRequest')
    // The schema still validates the document (no throw), and none of those keys
    // is part of what the rest of the plugin reads.
    const resolved = ConfigSchema(legacy)
    expect(effectiveConfig(resolved)).not.toHaveProperty('defaultResolution')
    expect(effectiveConfig(resolved)).not.toHaveProperty('imagesPerRequest')
    expect(effectiveConfig(resolved)).not.toHaveProperty('defaultQuality')
  })
})

describe('modelName', () => {
  it('prefers the display label', () => {
    expect(modelName(model())).toBe('Seedream 5.0 Lite')
    expect(modelName(model({ label: '' }))).toBe('seedream-5-0-lite')
  })
})
