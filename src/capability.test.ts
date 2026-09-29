/**
 * The capability table's own tests (#669): the model shape (read-back, merge,
 * discovery mapping) and the request resolution rules — defaults, trimming, the
 * count the plugin actually sends.
 *
 * These used to live in `settings.test.ts`, where the module that owns the rules
 * was not the module under test. Same assertions, moved to the seam they test.
 */

import { describe, expect, it } from 'vitest'
import { defaultAspectRatioFor, defaultOutputFormatFor, defaultResolutionFor, normalizeModels, resolveRequest } from './capability.ts'
import type { GenerateRequest, ModelConfig } from './protocol.ts'
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

/** A request with the given fields set. */
function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    mode: 'text',
    model: 'seedream-5-0-lite',
    prompt: '雪山',
    resolution: '',
    aspectRatio: '',
    outputFormat: '',
    n: 1,
    imageUrls: [],
    ...overrides,
  }
}


describe('reading a model back from the settings document', () => {
  it('keeps a stamp the discovery wrote, and reads a missing one as unknown', () => {
    const stamped = normalizeModels([model({ discoveredAt: 1_760_000_000_000 })])
    expect(stamped[0]!.discoveredAt).toBe(1_760_000_000_000)
    // A settings document written before the field existed (or a hand-built
    // one) must keep loading, and must read as "unknown" rather than "now".
    // Unknown is the **absence** of the field — there is no sentinel value.
    const legacy = normalizeModels([{ ...model(), discoveredAt: undefined } as ModelConfig])
    expect(legacy[0]!.discoveredAt).toBeUndefined()
    expect('discoveredAt' in legacy[0]!).toBe(false)
    const nonsense = normalizeModels([model({ discoveredAt: -5 })])
    expect(nonsense[0]!.discoveredAt).toBeUndefined()
  })

  it('keeps the newer stamp when one id was described twice, and invents none', () => {
    const merged = normalizeModels([
      model({ discoveredAt: 1_000 }),
      model({ discoveredAt: 2_000, resolutions: ['2K'] }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.discoveredAt).toBe(2_000)

    // Neither copy stamped: the merge must not turn "unknown" into a number.
    const unstamped = normalizeModels([
      model({ discoveredAt: undefined }),
      model({ resolutions: ['2K'] }),
    ])
    expect(unstamped[0]!.discoveredAt).toBeUndefined()

    // One copy knows: the merge keeps what is known.
    const halfKnown = normalizeModels([
      model({ discoveredAt: undefined }),
      model({ discoveredAt: 3_000, resolutions: ['2K'] }),
    ])
    expect(halfKnown[0]!.discoveredAt).toBe(3_000)
  })
})
describe('resolveRequest', () => {
  it('passes values the model declares, in the model own spelling', () => {
    const { request: normalized, dropped } = resolveRequest(
      request({ resolution: '2k', aspectRatio: '16:9', outputFormat: 'PNG' }),
      model(),
    )
    expect(dropped).toEqual([])
    expect(normalized.resolution).toBe('2K')
    expect(normalized.aspectRatio).toBe('16:9')
    expect(normalized.outputFormat).toBe('png')
  })

  it('omits a value outside the model enum instead of sending a 400', () => {
    const { request: normalized, dropped } = resolveRequest(
      request({ resolution: '1K', outputFormat: 'webp' }),
      model(),
    )
    expect(normalized.resolution).toBe('')
    expect(normalized.outputFormat).toBe('')
    expect(dropped).toEqual([
      { field: 'resolution', value: '1K', allowed: ['2K', '3K', '4K'], reason: 'invalid_value' },
      { field: 'output_format', value: 'webp', allowed: ['jpeg', 'png'], reason: 'invalid_value' },
    ])
  })

  it('omits an optional field a catalog-described model does not list', () => {
    // `output_format` is a closed enum per model: a value the catalog does not
    // list is left out rather than sent into a 400.
    const { request: normalized, dropped } = resolveRequest(request({ outputFormat: 'webp' }), model())
    expect(normalized.outputFormat).toBe('')
    expect(dropped).toEqual([{ field: 'output_format', value: 'webp', allowed: ['jpeg', 'png'], reason: 'invalid_value' }])
  })

  it('returns exactly the plugin’s own request fields — no `quality` (#661)', () => {
    // #661 deleted the `accepted('quality', …)` branch. The guard is the shape of
    // the result: if that branch ever came back, the object below would gain a
    // `quality` key even for a caller that never sent one.
    const { request: normalized } = resolveRequest(request(), model())
    expect(Object.keys(normalized).sort()).toEqual([
      'aspectRatio', 'imageUrls', 'mode', 'model', 'n', 'outputFormat', 'prompt', 'resolution',
    ])
  })

  it('passes optional fields through when only the model id was known', () => {
    // A bare OpenAI-compatible gateway has no capability table; guessing
    // "unsupported" would break every such deployment.
    const unknown = model({ resolutions: [], aspectRatios: [], outputFormats: [], capabilitiesKnown: false })
    const { request: normalized, dropped } = resolveRequest(
      request({ resolution: '1K', aspectRatio: '21:9', outputFormat: 'webp' }),
      unknown,
    )
    expect(dropped).toEqual([])
    expect(normalized.resolution).toBe('1K')
    expect(normalized.aspectRatio).toBe('21:9')
    expect(normalized.outputFormat).toBe('webp')
  })

  it('still treats a catalog-described model with an empty list as "does not take it"', () => {
    // An empty resolution list on a described model means the model declares no
    // tiers, so a tier must not be invented for it.
    const described = model({ resolutions: [] })
    const { request: normalized } = resolveRequest(request({ resolution: '2K' }), described)
    expect(normalized.resolution).toBe('')
  })

  it('treats auto and empty as "omit" without reporting a drop', () => {
    const { request: normalized, dropped } = resolveRequest(
      request({ resolution: 'auto', aspectRatio: '  ' }),
      model(),
    )
    expect(normalized).toEqual(expect.objectContaining({ resolution: '', aspectRatio: '' }))
    expect(dropped).toEqual([])
  })

  it('clamps the image count to what the model accepts', () => {
    expect(resolveRequest(request({ n: 99 }), model()).request.n).toBe(4)
    expect(resolveRequest(request({ n: 0 }), model()).request.n).toBe(1)
    expect(resolveRequest(request({ n: 2.7 }), model()).request.n).toBe(2)
  })

  it('caps the count at the plugin own ceiling too, so the record equals what is sent (#668)', () => {
    // A model may declare more images than one request may ask for. The wire
    // contract caps at 10, and the request the task and the library record is
    // the request that goes out — recording 15 while sending 10 is how the
    // detail pane ends up printing a number no request ever carried.
    const generous = model({ maxImages: 15 })
    expect(resolveRequest(request({ n: 15 }), generous).request.n).toBe(10)
    expect(resolveRequest(request({ n: 99 }), generous).request.n).toBe(10)
    // The model's own cap still wins when it is the smaller one.
    expect(resolveRequest(request({ n: 99 }), model()).request.n).toBe(4)
  })

  it('fills the configured aspect ratio only when the model takes it, and never as the caller mistake (#668)', () => {
    const applied = resolveRequest(request(), model(), { aspectRatio: '16:9' })
    expect(applied.request.aspectRatio).toBe('16:9')
    expect(applied.dropped).toEqual([])

    // The plugin's own default is not a value the caller named: a model that
    // does not take it gets "omit", and nothing is reported as dropped.
    const refused = resolveRequest(request(), model(), { aspectRatio: '3:4' })
    expect(refused.request.aspectRatio).toBe('')
    expect(refused.dropped).toEqual([])
  })

  it('lets the caller own value win over the configured aspect ratio (#668)', () => {
    const { request: normalized, dropped } = resolveRequest(
      request({ aspectRatio: '1:1' }),
      model(),
      { aspectRatio: '16:9' },
    )
    expect(normalized.aspectRatio).toBe('1:1')
    expect(dropped).toEqual([])
  })

  it('drops reference images for a text-only model and reports it', () => {
    const textOnly = model({ maxReferenceImages: 0 })
    const { request: normalized, dropped } = resolveRequest(
      request({ mode: 'edit', imageUrls: ['data:image/png;base64,AAAA'], refNames: ['参考图'] }),
      textOnly,
    )
    expect(normalized.imageUrls).toEqual([])
    expect(normalized.mode).toBe('text')
    expect(dropped).toEqual([{ field: 'image_urls', value: '1 张参考图', allowed: [], reason: 'unsupported_field' }])
  })

  it('lets reference images through when the model id came from a bare list', () => {
    const unknown = model({ maxReferenceImages: 0, capabilitiesKnown: false })
    const { request: normalized } = resolveRequest(
      request({ mode: 'edit', imageUrls: ['data:image/png;base64,AAAA'] }),
      unknown,
    )
    expect(normalized.imageUrls).toHaveLength(1)
    expect(normalized.mode).toBe('edit')
  })

  it('keeps reference images for a reference-capable model', () => {
    const { request: normalized, dropped } = resolveRequest(
      request({ mode: 'edit', imageUrls: ['data:image/png;base64,AAAA'] }),
      model(),
    )
    expect(normalized.imageUrls).toHaveLength(1)
    expect(normalized.mode).toBe('edit')
    expect(dropped).toEqual([])
  })
})


describe('the configured generation defaults', () => {
  it('takes the resolution default from the declared default, never from the tier list (#663/D-3)', () => {
    const declared = model({ resolutions: ['1K', '2K', '4K'], resolutionDefault: '2K' })
    expect(defaultResolutionFor(declared)).toBe('2K')
    // A contract breach (no declared default): the plugin omits the field rather
    // than guessing `resolutions[0]` (#663/P3).
    expect(defaultResolutionFor(model({ resolutions: ['1K', '2K'] }))).toBe('')
    expect(defaultResolutionFor(model({ resolutionDefault: '   ' }))).toBe('')
  })

  it('sends the declared default tier even when the tier list came back empty (#663/P3, P9)', () => {
    // `resolution` is **not** omit-equivalent: a request that names no tier must
    // carry one explicitly, and the declared default is the only source.
    const declared = model({ resolutions: [], resolutionDefault: '2K' })
    const { request: normalized, dropped } = resolveRequest(request(), declared)
    expect(normalized.resolution).toBe('2K')
    expect(dropped).toEqual([])
  })

  it('omits the tier when the contract declared no default, without reporting a drop (#663/P3)', () => {
    // Not a caller mistake: the plugin's own missing default must not surface as
    // "you sent a value the model refuses".
    const breach = model({ resolutions: ['1K', '2K'], resolutionDefault: '' })
    const { request: normalized, dropped } = resolveRequest(request(), breach)
    expect(normalized.resolution).toBe('')
    expect(dropped).toEqual([])
  })

  it('still refuses a tier the caller named explicitly and the model does not take', () => {
    const declared = model({ resolutions: ['2K', '3K', '4K'], resolutionDefault: '2K' })
    const { request: normalized, dropped } = resolveRequest(request({ resolution: '8K' }), declared)
    expect(normalized.resolution).toBe('')
    expect(dropped.map(entry => entry.field)).toEqual(['resolution'])
  })

  it('only defaults `output_format` when the model declares and allows it (#658/D-13)', () => {
    const takesPng = model({ capabilitiesKnown: true, outputFormats: ['png', 'jpeg'] })
    expect(defaultOutputFormatFor(takesPng, 'png')).toBe('png')
    // Declared, but not this value: omit rather than send something it rejects.
    expect(defaultOutputFormatFor(model({ capabilitiesKnown: true, outputFormats: ['jpeg'] }), 'png')).toBe('')
    // Capabilities unknown (bare `/models`): never gamble a field on it.
    expect(defaultOutputFormatFor(model({ capabilitiesKnown: false, outputFormats: [] }), 'png')).toBe('')
    // No configured default: nothing to fill.
    expect(defaultOutputFormatFor(takesPng, '')).toBe('')
  })

  it('only defaults `aspect_ratio` when the model declares and allows it (#668)', () => {
    const takesPortrait = model({ capabilitiesKnown: true, aspectRatios: ['3:4', '16:9'] })
    expect(defaultAspectRatioFor(takesPortrait, '3:4')).toBe('3:4')
    // Declared, but not this value: omit rather than send something it rejects.
    expect(defaultAspectRatioFor(model({ capabilitiesKnown: true, aspectRatios: ['16:9', '1:1'] }), '3:4')).toBe('')
    // Capabilities unknown (a bare `/models` deployment): never gamble a field on
    // a model the plugin knows nothing about. Deliberate, and the one place the
    // plugin's configured ratio is dropped rather than passed through — the
    // caller's *own* value still passes through (`accepted()`).
    expect(defaultAspectRatioFor(model({ capabilitiesKnown: false, aspectRatios: [] }), '3:4')).toBe('')
    // No configured default: nothing to fill.
    expect(defaultAspectRatioFor(takesPortrait, '')).toBe('')
  })

})
