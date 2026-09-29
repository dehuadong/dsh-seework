/**
 * Catalog discovery tests: the SeeAI Hub catalog is the authority on which
 * models exist and what each one accepts, so the mapping has to keep the
 * capability vocabulary intact — the settings card and the request builder both
 * read it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { catalogEntryToModel, looksLikeImageModel, openAiEntryToModel } from './capability.ts'
import { discoverModels } from './catalog.ts'
import { SeeWorkError } from './engine.ts'

/** One SeeAI Hub catalog entry (shape from docs/api/catalog.md, v2). */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'seedream-5-0-lite',
    display_name: 'Seedream 5.0 Lite',
    type: 'image',
    protocol: 'image.generations.sync.v1',
    supported_parameters: {
      resolution: { type: 'enum', values: ['1K', '2K', '3K', '4K'], default: '2K' },
      aspect_ratio: { type: 'enum', values: ['16:9', '1:1'] },
      size: { type: 'enum', values: ['1K', '2K', '3K', '4K'] },
      n: { type: 'range', min: 1, max: 15 },
      image_urls: { type: 'array', items: { type: 'string' }, max: 14 },
      output_format: { type: 'enum', values: ['jpeg', 'png'] },
      // A `boolean` descriptor is part of the closed vocabulary but describes a
      // field this plugin cannot send (it has no watermark argument), so it must
      // contribute nothing to the mapped model.
      watermark: { type: 'boolean', default: false },
    },
    endpoints: {
      guide: '/api/v1/catalog/models/seedream-5-0-lite/guide',
      display_pricing: '/api/v1/catalog/models/seedream-5-0-lite/display-pricing',
    },
    ...overrides,
  }
}

/**
 * One catalog payload whose single model declares tiers containing `512`.
 *
 * The declared order is published verbatim (v2): the descriptor's `values` array
 * **is** the ranking, so this fixture is the positive counter-example to the old
 * lexicographic-array trap.
 */
function catalogResponse(): Response {
  return new Response(JSON.stringify({
    models: [entry({
      name: 'gemini-3-1-flash-image',
      supported_parameters: {
        resolution: { type: 'enum', values: ['512', '1K', '2K', '4K'], default: '512' },
        aspect_ratio: { type: 'enum', values: ['1:1'] },
        n: { type: 'range', min: 1, max: 1 },
        image_urls: { type: 'array', items: { type: 'string' }, max: 3 },
      },
    })],
  }), { status: 200 })
}

describe('looksLikeImageModel', () => {
  it('trusts the catalog type when it is present', () => {
    expect(looksLikeImageModel('whatever', 'image')).toBe(true)
    expect(looksLikeImageModel('gpt-image-2', 'chat')).toBe(false)
  })

  it('falls back to naming heuristics, keeping chat and embedding out', () => {
    expect(looksLikeImageModel('gpt-image-2', undefined)).toBe(true)
    expect(looksLikeImageModel('doubao-seedream-5-0-260128', undefined)).toBe(true)
    expect(looksLikeImageModel('grok-imagine-image', undefined)).toBe(true)
    expect(looksLikeImageModel('text-embedding-3-large', undefined)).toBe(false)
    expect(looksLikeImageModel('deepseek-chat', undefined)).toBe(false)
    expect(looksLikeImageModel('gpt-4o-mini', undefined)).toBe(false)
  })
})

describe('catalogEntryToModel', () => {
  it('keeps the capability vocabulary the request builder needs', () => {
    const model = catalogEntryToModel(entry())
    expect(model).toEqual({
      id: 'seedream-5-0-lite',
      label: 'Seedream 5.0 Lite',
      resolutions: ['1K', '2K', '3K', '4K'],
      resolutionDefault: '2K',
      aspectRatios: ['16:9', '1:1'],
      outputFormats: ['jpeg', 'png'],
      maxImages: 15,
      maxReferenceImages: 14,
      // The entry described the model, so an empty list would mean "the model
      // does not take it" — not "we do not know".
      capabilitiesKnown: true,
    })
  })

  it('maps the closed descriptor vocabulary, and only the fields the plugin sends', () => {
    // `enum` → values, `range` → its own max, `array` → its own element ceiling,
    // `boolean` → nothing the plugin can send (it has no such argument).
    const model = catalogEntryToModel(entry({
      supported_parameters: {
        resolution: { type: 'enum', values: ['1K', '2K'] },
        aspect_ratio: { type: 'enum', values: ['1:1'] },
        output_format: { type: 'enum', values: ['png'] },
        n: { type: 'range', min: 1, max: 4 },
        image_urls: { type: 'array', items: { type: 'string' }, max: 3 },
        watermark: { type: 'boolean', default: false },
      },
    }))
    expect(model?.maxImages).toBe(4)
    expect(model?.maxReferenceImages).toBe(3)
    // The boolean "can it take references" is derived where it is shown
    // (`maxReferenceImages > 0`) rather than carried as a second field (#669).
    expect(model).not.toHaveProperty('supportsReference')
    // The boolean field exists in the contract but not in the plugin's argument
    // surface: it must leave no trace on the model.
    expect(model).not.toHaveProperty('watermark')
  })

  it('never re-sorts the declared enum order (#663/P2)', () => {
    const model = catalogEntryToModel(entry({
      supported_parameters: {
        resolution: { type: 'enum', values: ['512', '1K', '2K', '4K'], default: '512' },
      },
    }))
    // Not the lexicographic ["1K","2K","4K","512"]: the array is the order.
    expect(model?.resolutions).toEqual(['512', '1K', '2K', '4K'])
  })

  it('reads the declared default tier verbatim, and never falls back to the first value (#663/D-3, P3)', () => {
    const declared = catalogEntryToModel(entry({
      supported_parameters: {
        // A default that is not the lowest tier: the two are different facts.
        resolution: { type: 'enum', values: ['1K', '2K', '4K'], default: '2K' },
      },
    }))
    expect(declared?.resolutionDefault).toBe('2K')

    // No declared default = a breach of the "always published" invariant. The
    // plugin must not guess one from the value list.
    const breach = catalogEntryToModel(entry({
      supported_parameters: { resolution: { type: 'enum', values: ['1K', '2K'] } },
    }))
    expect(breach?.capabilitiesKnown).toBe(true)
    expect(breach?.resolutions).toEqual(['1K', '2K'])
    expect(breach?.resolutionDefault).toBe('')
  })

  it('does not adopt declared defaults for the fields the plugin keeps its own settings for (#663/AC-10)', () => {
    // `aspect_ratio` / `output_format` declare no default in the contract (D-11):
    // the plugin maintains its own setting for both, so a stray `default` on the
    // descriptor must not create a field or change the value list.
    const model = catalogEntryToModel(entry({
      supported_parameters: {
        resolution: { type: 'enum', values: ['1K', '2K'], default: '1K' },
        aspect_ratio: { type: 'enum', values: ['1:1'], default: '16:9' },
        output_format: { type: 'enum', values: ['png'], default: 'jpeg' },
      },
    }))
    expect(model?.aspectRatios).toEqual(['1:1'])
    expect(model?.outputFormats).toEqual(['png'])
    expect(model).not.toHaveProperty('aspectRatioDefault')
    expect(model).not.toHaveProperty('outputFormatDefault')
  })

  it('reads absence ceilings as zero/none instead of inventing a limit', () => {
    const model = catalogEntryToModel(entry({
      supported_parameters: { resolution: { type: 'enum', values: ['1K'], default: '1K' } },
    }))
    expect(model?.maxImages).toBe(1)
    expect(model?.maxReferenceImages).toBe(0)
    expect(model?.aspectRatios).toEqual([])
    expect(model?.outputFormats).toEqual([])
  })

  it('treats a missing descriptor set as capabilities unknown, v1 keys or not (#663/D-1, AC-6)', () => {
    // A pre-v2 snapshot (or an older deployment): the whole key is absent. The
    // model is still discovered — it is not corruption — but nothing may be
    // trimmed for it, and the retired v1 members must not be read as a fallback.
    const model = catalogEntryToModel(entry({
      supported_parameters: undefined,
      capabilities: {
        resolution: ['2K', '3K', '4K'],
        aspect_ratios: ['16:9', '1:1'],
        max_images: 15,
        max_reference_images: 14,
        output_format: ['jpeg', 'png'],
        gpt_image_product_profile: { resolutions: ['1K', '2K'], aspect_ratios: ['1:1'] },
      },
      values: { resolution_order: ['2K', '3K', '4K'] },
    }))
    expect(model).toEqual({
      id: 'seedream-5-0-lite',
      label: 'Seedream 5.0 Lite',
      resolutions: [],
      resolutionDefault: '',
      aspectRatios: [],
      outputFormats: [],
      maxImages: 1,
      maxReferenceImages: 0,
      capabilitiesKnown: false,
    })
  })

  it('maps exactly the stored field set — no retired key may ride through (#663/P8)', () => {
    const model = catalogEntryToModel(entry({
      supported_parameters: {
        // A stray unknown member on a descriptor must not become a model field
        // either: the exact key set below is the assertion.
        resolution: { type: 'enum', values: ['1K'], default: '1K', filled_by: 'gateway' },
      },
    }))
    // The exact key set is the guard: the v1 tier-order pair is gone, and no
    // "who supplies the default" key can ride through a descriptor.
    expect(Object.keys(model ?? {}).sort()).toEqual([
      'aspectRatios', 'capabilitiesKnown', 'id', 'label', 'maxImages',
      'maxReferenceImages', 'outputFormats', 'resolutionDefault', 'resolutions',
    ])
  })

  it('ignores the retired per-field structures entirely (#659)', () => {
    // #659 deleted the extra-parameter passthrough: the entry's `parameters`
    // docs and `guide_path` are not read at all, so none of them may reach the
    // mapped model.
    const model = catalogEntryToModel(entry({
      supported_parameters: {
        resolution: { type: 'enum', values: ['1K'], default: '1K' },
      },
      parameters: { n: { type: 'integer', range: { min: 1, max: 4 }, description: '这次要几张' } },
      guide_path: '/api/v1/catalog/models/seedream-5-0-lite/guide',
    }))
    // The descriptor is the only authority.
    expect(model?.resolutions).toEqual(['1K'])
    for (const retired of ['parameters', 'parameterDocs', 'parameterRules', 'guidePath']) {
      expect(model).not.toHaveProperty(retired)
    }
  })

  it('marks a text-only model as not reference-capable', () => {
    const model = catalogEntryToModel(entry({
      supported_parameters: {
        resolution: { type: 'enum', values: ['1K'], default: '1K' },
        n: { type: 'range', min: 1, max: 4 },
        image_urls: { type: 'array', items: { type: 'string' }, max: 0 },
      },
    }))
    expect(model?.maxReferenceImages).toBe(0)
  })

  it('skips non-image entries and entries without a name', () => {
    expect(catalogEntryToModel(entry({ type: 'chat' }))).toBeUndefined()
    expect(catalogEntryToModel({ display_name: 'no name' })).toBeUndefined()
    expect(catalogEntryToModel(null)).toBeUndefined()
  })

  it('never reports fewer than one image per request', () => {
    expect(catalogEntryToModel(entry({ supported_parameters: {} }))?.maxImages).toBe(1)
  })
})

describe('openAiEntryToModel', () => {
  it('keeps image ids and drops everything else', () => {
    expect(openAiEntryToModel({ id: 'dall-e-3' })?.id).toBe('dall-e-3')
    expect(openAiEntryToModel({ id: 'gpt-4o' })).toBeUndefined()
  })

  it('marks the capabilities as unknown so the request builder stays permissive', () => {
    // `/models` lists ids only; treating its empty lists as "unsupported" would
    // break every gateway without a SeeAI Hub catalog.
    const model = openAiEntryToModel({ id: 'dall-e-3' })
    expect(model?.capabilitiesKnown).toBe(false)
    expect(model?.resolutionDefault).toBe('')
  })
})

describe('discoverModels', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  /** The addresses discovery may consult, in order. */
  const sources = { serviceUrl: 'http://127.0.0.1:8081', apiUrl: 'http://127.0.0.1:8080/v1', apiKey: 'sk-test' }

  it('stamps a successful discovery with its time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => catalogResponse()))
    const before = Date.now()
    const result = await discoverModels(sources)
    // The stamp is what lets the settings card save "when we last read the
    // catalog" with the selection; a failed discovery throws before it, so the
    // previous data keeps its old (honest) stamp instead of looking fresh.
    expect(result.models.every(model => typeof model.discoveredAt === 'number')).toBe(true)
    expect(result.models[0]!.discoveredAt).toBeGreaterThanOrEqual(before)
    expect(result.models[0]!.discoveredAt).toBeLessThanOrEqual(Date.now())
  })

  it('takes the tier order from the descriptor, verbatim (#663/P2)', async () => {
    const fetchMock = vi.fn(async () => catalogResponse())
    vi.stubGlobal('fetch', fetchMock)

    const result = await discoverModels(sources)
    const model = result.models[0]!
    // The declared order, not the lexicographic ["1K","2K","4K","512"].
    expect(model.resolutions).toEqual(['512', '1K', '2K', '4K'])
    expect(model.resolutionDefault).toBe('512')
    expect(model.maxImages).toBe(1)
    expect(model.maxReferenceImages).toBe(3)
    // One request, one source — no family follow-up any more.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.attempts).toEqual([
      { url: 'http://127.0.0.1:8081/api/v1/catalog/models', outcome: 'ok', models: 1 },
    ])
  })

  it('still discovers a model whose entry carries no descriptor set (#663/P4)', async () => {
    // A pre-v2 snapshot: discovery reports the model as capabilities-unknown and
    // does not throw, does not guess, and does not drop it.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      models: [entry({ name: 'gemini-3-1-flash-image', supported_parameters: undefined })],
    }), { status: 200 })))

    const result = await discoverModels(sources)
    expect(result.models.map(model => model.id)).toEqual(['gemini-3-1-flash-image'])
    expect(result.models[0]!.capabilitiesKnown).toBe(false)
    expect(result.models[0]!.resolutions).toEqual([])
    expect(result.models[0]!.resolutionDefault).toBe('')
    expect(result.attempts.map(attempt => attempt.outcome)).toEqual(['ok'])
  })

  it('never asks the retired family-document route', async () => {
    const fetchMock = vi.fn(async (_url: string) => catalogResponse())
    vi.stubGlobal('fetch', fetchMock)

    await discoverModels(sources)
    const urls = fetchMock.mock.calls.map(call => String(call[0]))
    expect(urls.some(url => url.includes('/catalog/semantics'))).toBe(false)
  })

  it('reads the catalog from the service address first', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      models: [entry(), entry({ name: 'gpt-4o-mini', type: 'chat' })],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await discoverModels(sources)
    expect(result.origin).toBe('catalog')
    expect(result.catalogUrl).toBe('http://127.0.0.1:8081/api/v1/catalog/models')
    expect(result.scanned).toBe(2)
    expect(result.models.map(model => model.id)).toEqual(['seedream-5-0-lite'])
    expect(result.attempts).toEqual([{ url: 'http://127.0.0.1:8081/api/v1/catalog/models', outcome: 'ok', models: 1 }])
    // The catalog is public, but the key still rides along: a deployment may
    // front its whole host with an auth gate, and a public route is unharmed.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8081/api/v1/catalog/models')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
  })

  it('tries the gateway host when the service address has no catalog', async () => {
    // The shipped development stack answers the catalog on the Gateway host.
    const fetchMock = vi.fn(async (url: string) => url.startsWith('http://127.0.0.1:8081')
      ? new Response('{"error":"not_found"}', { status: 404 })
      : new Response(JSON.stringify({ models: [entry()] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await discoverModels(sources)
    expect(result.catalogUrl).toBe('http://127.0.0.1:8080/api/v1/catalog/models')
    expect(result.models.map(model => model.id)).toEqual(['seedream-5-0-lite'])
    expect(result.attempts.map(attempt => attempt.outcome)).toEqual(['http 404', 'ok'])
  })

  it('skips the service address when the user left it empty', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ models: [entry()] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await discoverModels({ ...sources, serviceUrl: '' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.catalogUrl).toBe('http://127.0.0.1:8080/api/v1/catalog/models')
  })

  it('falls back to the OpenAI-compatible /models list', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/models')
      ? new Response(JSON.stringify({ data: [{ id: 'gpt-image-2' }, { id: 'text-embedding-3-large' }] }), { status: 200 })
      : new Response('{"error":"not_found"}', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await discoverModels({ ...sources, serviceUrl: 'https://other.example.com' })
    expect(result.origin).toBe('models')
    expect(result.models.map(model => model.id)).toEqual(['gpt-image-2'])
  })

  it('keeps looking when a host answers with something that is not a catalog', async () => {
    // A 200 that carries no `models` array must not read as "zero models".
    const fetchMock = vi.fn(async (url: string) => url.startsWith('http://127.0.0.1:8081')
      ? new Response(JSON.stringify({ hello: 'world' }), { status: 200 })
      : new Response(JSON.stringify({ models: [entry()] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await discoverModels(sources)
    expect(result.attempts[0]).toEqual({ url: 'http://127.0.0.1:8081/api/v1/catalog/models', outcome: 'unusable', models: 0 })
    expect(result.models).toHaveLength(1)
  })

  it('reports every address it tried when nothing works', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"nope"}', { status: 404 })))
    let failure: SeeWorkError | undefined
    try {
      await discoverModels(sources)
    } catch (error) {
      failure = error as SeeWorkError
    }
    expect(failure).toBeInstanceOf(SeeWorkError)
    expect(failure!.message).toContain('http://127.0.0.1:8081/api/v1/catalog/models')
    expect(failure!.message).toContain('http://127.0.0.1:8080/api/v1/catalog/models')
    expect(failure!.message).toContain('/models')
    expect(failure!.detail).toHaveLength(3)
  })

  it('names an unreachable address as a connection problem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    await expect(discoverModels({ serviceUrl: '', apiUrl: 'http://127.0.0.1:9/v1', apiKey: '' })).rejects.toThrow(SeeWorkError)
    await expect(discoverModels({ serviceUrl: '', apiUrl: 'http://127.0.0.1:9/v1', apiKey: '' })).rejects.toThrow(/连接不上/)
  })
})
