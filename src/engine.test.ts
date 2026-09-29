/**
 * Engine tests: the request mapping must match the SeeAI Hub contract exactly
 * (`docs/api/images.md`) — unknown fields are rejected with 400, so a stray
 * parameter name is a hard failure, not a harmless extra.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildGenerationBody, catalogUrl, gatewayUrl, generateImage, SeeWorkError } from './engine.ts'
import { resolveRequest } from './capability.ts'
import type { GenerateRequest, ModelConfig } from './protocol.ts'
import { pngBuffer, pngDataUrl } from './fixtures.ts'

const upstream = { apiUrl: 'http://127.0.0.1:8080/v1', apiKey: 'sk-test' }

function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    mode: 'text',
    model: 'seedream-5-0-lite',
    prompt: '一只坐着看夕阳的橘猫',
    resolution: '2K',
    aspectRatio: '16:9',
    outputFormat: 'png',
    n: 1,
    imageUrls: [],
    ...overrides,
  }
}

describe('url helpers', () => {
  it('appends the gateway path to a base URL with or without a trailing slash', () => {
    expect(gatewayUrl('http://127.0.0.1:8080/v1', '/images/generations')).toBe('http://127.0.0.1:8080/v1/images/generations')
    expect(gatewayUrl('http://127.0.0.1:8080/v1/', '/images/generations')).toBe('http://127.0.0.1:8080/v1/images/generations')
  })

  it('derives the catalog URL from the gateway base', () => {
    expect(catalogUrl('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080/api/v1/catalog/models')
    // A base without the version suffix keeps its own prefix (reverse proxy).
    expect(catalogUrl('https://example.com/api')).toBe('https://example.com/api/api/v1/catalog/models')
  })
})

describe('buildGenerationBody', () => {
  it('sends only the documented fields', () => {
    expect(buildGenerationBody(request())).toEqual({
      model: 'seedream-5-0-lite',
      prompt: '一只坐着看夕阳的橘猫',
      n: 1,
      resolution: '2K',
      aspect_ratio: '16:9',
      output_format: 'png',
    })
  })

  it('omits unset and auto-valued optional fields', () => {
    const body = buildGenerationBody(request({ resolution: 'auto', aspectRatio: '', outputFormat: '' }))
    expect(body).not.toHaveProperty('resolution')
    expect(body).not.toHaveProperty('aspect_ratio')
    expect(body).not.toHaveProperty('quality')
    expect(body).not.toHaveProperty('output_format')
  })

  it('carries the declared default tier when the caller names none (#663/P3, P9)', () => {
    // `resolution` is not omit-equivalent: the gateway does not choose a tier,
    // so the body must carry the catalog's declared default — which is a fact of
    // its own and may differ from the lowest tier of the list.
    const declared: ModelConfig = {
      id: 'seedream-5-0-pro',
      label: 'Seedream 5.0 Pro',
      resolutions: ['1K', '2K'],
      resolutionDefault: '2K',
      aspectRatios: [],
      outputFormats: [],
      maxImages: 1,
      maxReferenceImages: 0,
      capabilitiesKnown: true,
    }
    const { request: normalized, dropped } = resolveRequest(request({ resolution: '', aspectRatio: '', outputFormat: '' }), declared)
    expect(dropped).toEqual([])
    expect(buildGenerationBody(normalized)).toMatchObject({ resolution: '2K' })
  })

  it('leaves the tier out when the contract declared no default (#663/P3)', () => {
    // A breach of the "always published" invariant: omit rather than guess
    // `resolutions[0]`.
    const breach: ModelConfig = {
      id: 'seedream-5-0-pro',
      label: 'Seedream 5.0 Pro',
      resolutions: ['1K', '2K'],
      resolutionDefault: '',
      aspectRatios: [],
      outputFormats: [],
      maxImages: 1,
      maxReferenceImages: 0,
      capabilitiesKnown: true,
    }
    const { request: normalized } = resolveRequest(request({ resolution: '', aspectRatio: '', outputFormat: '' }), breach)
    expect(buildGenerationBody(normalized)).not.toHaveProperty('resolution')
  })

  it('never sends a `quality` a caller still carries (#661)', () => {
    // `quality` is not a plugin parameter any more, so the body builder has no
    // branch for it at all — a lingering field on the request object stays out.
    const lingering = { ...request(), quality: 'high' } as unknown as GenerateRequest
    expect(buildGenerationBody(lingering)).not.toHaveProperty('quality')
  })

  it('carries reference images in image_urls, which is what makes it an edit', () => {
    const body = buildGenerationBody(request({ mode: 'edit', imageUrls: [pngDataUrl()] }))
    expect(body.image_urls).toEqual([pngDataUrl()])
    // The alias `image` must not be sent alongside it: only one of the two is allowed.
    expect(body).not.toHaveProperty('image')
  })

  it('clamps n into the documented 1..10 range', () => {
    expect(buildGenerationBody(request({ n: 0 })).n).toBe(1)
    expect(buildGenerationBody(request({ n: 99 })).n).toBe(10)
  })

  it('sends nothing beyond the five regular parameters (#659 / #661)', () => {
    // #659 deleted the passthrough channel and #661 dropped `quality`: the body
    // is exactly the documented fields the request carries, so an extra key can
    // only come from a bug.
    const body = buildGenerationBody(request())
    expect(Object.keys(body).sort()).toEqual(['aspect_ratio', 'model', 'n', 'output_format', 'prompt', 'resolution'])
  })

  it('refuses an empty model or prompt before touching the network', () => {
    expect(() => buildGenerationBody(request({ model: '  ' }))).toThrow(SeeWorkError)
    expect(() => buildGenerationBody(request({ prompt: '' }))).toThrow(SeeWorkError)
  })
})

describe('generateImage', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads the uniform response shape and reports the charged amount', async () => {
    const bytes = pngBuffer(64, 32)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      created: 1,
      data: [{ url: 'https://cdn.example.com/a.png' }],
      cost: 0.22,
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    const download = new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/a.png' }], cost: 0.22 }), { status: 200 }))
      .mockResolvedValueOnce(download)
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImage(upstream, request())
    expect(result.cost).toBe(0.22)
    expect(result.images).toHaveLength(1)
    expect(result.images[0]!.mime).toBe('image/png')
    expect(Buffer.from(result.images[0]!.b64, 'base64').byteLength).toBe(bytes.byteLength)
  })

  it('reads the GPT-Image passthrough shape (inline b64_json)', async () => {
    const bytes = pngBuffer(8, 8)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      created: 1,
      quality: 'low',
      data: [{ b64_json: bytes.toString('base64') }],
      cost: 0.3,
    }), { status: 200 })))

    const result = await generateImage(upstream, request({ model: 'gpt-image-2' }))
    expect(result.cost).toBe(0.3)
    expect(result.images[0]!.mime).toBe('image/png')
  })

  it('does not retry a failure the gateway will repeat', async () => {
    // Only the one-request-per-model conflict is worth retrying; a validation
    // refusal must surface immediately instead of burning the user's quota.
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: 'invalid_value', message: 'n 超出范围' }),
      { status: 400 },
    ))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateImage(upstream, request())).rejects.toThrow(/n 超出范围/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces the gateway error vocabulary in the message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'invalid_parameter', message: "resolution 非法: '1K'（支持的档位: 2K, 3K, 4K）" }),
      { status: 400 },
    )))
    await expect(generateImage(upstream, request({ resolution: '1K' }))).rejects.toThrow(/resolution 非法/)
  })

  it('refuses to call the gateway without credentials', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateImage({ apiUrl: '', apiKey: '' }, request())).rejects.toThrow(SeeWorkError)
    await expect(generateImage({ apiUrl: 'http://127.0.0.1:8080/v1', apiKey: '' }, request())).rejects.toThrow(/API Key/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
