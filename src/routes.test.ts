/**
 * Route-family integration tests: the settings bridge, model discovery, the
 * generation proxy, and the material library, exercised over a real HTTP server
 * against a stub SeeAI Hub gateway.
 *
 * What these protect: the API key never crosses the wire, the bridge only
 * answers loopback requests, a generation lands in the library, and the gateway
 * error vocabulary reaches the caller unchanged.
 */

import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { GenerationRuntime } from './generation-runtime.ts'
import { createCatalogRefresher } from './catalog-refresh.ts'
import { libraryDataRoot, listLibrary, setLibraryDataRoot } from './library.ts'
import {
  ATTACHMENT_API,
  CANVAS_API,
  CATALOG_API,
  GENERATE_API,
  IMAGE_API,
  LIBRARY_API,
  SEEWORK_SETTINGS_NAMESPACE,
  SETTINGS_API,
  type CanvasDocument,
  type CatalogRefreshOutcome,
  TASK_API,
  type ModelConfig,
} from './protocol.ts'
import { makeRoutes, type SettingsSeam } from './routes.ts'
import { effectiveConfig, type Config } from './settings.ts'
import { pngBuffer } from './fixtures.ts'

/** A settings document the fake provider owns (user layer only). */
interface FakeSettingsDocument {
  apiUrl?: string
  /**
   * The catalog lives on the service, not the gateway, and it defaults to the
   * developer's own `127.0.0.1:8081` — so a test that leaves it out silently
   * asserts against whatever that machine happens to be serving. Always point it
   * at the stub.
   */
  serviceUrl?: string
  apiKey?: string
  models?: ModelConfig[]
  defaultModel?: string
  /** The configured generation defaults (#668: the ratio is applied here too). */
  defaultAspectRatio?: string
  enabled?: boolean
}

/** The fake settings provider: describe (redacted) + mutate for one namespace. */
function fakeSettings(initial: FakeSettingsDocument): { seam: SettingsSeam; document: FakeSettingsDocument; revisions: () => number } {
  const document: FakeSettingsDocument = { ...initial }
  let revision = 1
  return {
    document,
    revisions: () => revision,
    seam: {
      writable: true,
      describe: (options) => {
        const value: Record<string, unknown> = { ...document }
        if (options?.redactSecrets === true) delete value.apiKey
        return [{
          ns: SEEWORK_SETTINGS_NAMESPACE as never,
          schema: {},
          value,
          revision,
          user: options?.redactSecrets === true ? { ...document, apiKey: undefined } : { ...document },
          applies: 'live',
          secrets: [{ path: ['apiKey'], set: document.apiKey !== undefined && document.apiKey !== '' }],
        }]
      },
      mutate: async (_ns, ops, expectedRevision) => {
        if (expectedRevision !== undefined && expectedRevision !== revision) {
          throw new SettingsConflictError('dsh-seework' as never, expectedRevision, revision)
        }
        for (const op of ops as Array<{ op: string; path: string[]; value?: unknown }>) {
          const field = op.path[0]!
          if (op.op === 'unset') delete (document as Record<string, unknown>)[field]
          else (document as Record<string, unknown>)[field] = op.value
        }
        revision++
      },
    },
  }
}

/** Start an HTTP server that serves a plugin route table. */
function serveRoutes(routes: ReturnType<typeof makeRoutes>): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/'
    for (const route of routes) {
      const matches = route.kind === 'exact' ? url === route.path : url === route.path || url.startsWith(`${route.path}/`)
      if (!matches) continue
      void Promise.resolve(route.handler(req, res)).catch(() => {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ server, base: `http://127.0.0.1:${port}` })
    })
  })
}

/** A stub SeeAI Hub gateway: catalog, models, and image generation. */
function startGateway(behavior: { failGeneration?: { status: number; body: unknown } } = {}): Promise<{ server: Server; base: string; calls: Array<Record<string, unknown>> }> {
  const calls: Array<Record<string, unknown>> = []
  const server = createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0]
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const respond = (status: number, body: unknown): void => {
        const payload = JSON.stringify(body)
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(payload)
      }
      if (url === '/api/v1/catalog/models') {
        respond(200, {
          models: [
            {
              name: 'seedream-5-0-lite',
              display_name: 'Seedream 5.0 Lite',
              type: 'image',
              // Catalog v2: every sendable field is a self-describing descriptor.
              supported_parameters: {
                resolution: { type: 'enum', values: ['2K', '3K', '4K'], default: '2K' },
                aspect_ratio: { type: 'enum', values: ['16:9', '1:1'] },
                n: { type: 'range', min: 1, max: 4 },
                image_urls: { type: 'array', items: { type: 'string' }, max: 2 },
                output_format: { type: 'enum', values: ['png', 'jpeg'] },
              },
            },
            // video / chat entries are not v2 yet (#663/D-8): they keep the v1
            // shape, which the plugin does not read for image models at all.
            { name: 'deepseek-chat', type: 'chat', capabilities: {} },
          ],
        })
        return
      }
      if (url === '/v1/images/generations') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        calls.push(body)
        if (behavior.failGeneration !== undefined) {
          respond(behavior.failGeneration.status, behavior.failGeneration.body)
          return
        }
        respond(200, {
          created: 1,
          data: [{ b64_json: pngBuffer(48, 48).toString('base64') }],
          cost: 0.22,
        })
        return
      }
      respond(404, { error: 'not_found' })
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ server, base: `http://127.0.0.1:${port}`, calls })
    })
  })
}

describe('route family', () => {
  let dataRoot: string
  let plugin: { server: Server; base: string }
  let gateway: Awaited<ReturnType<typeof startGateway>>
  let settings: ReturnType<typeof fakeSettings>
  let config: Config

  const previousRoot = libraryDataRoot()

  beforeAll(async () => {
    dataRoot = await fs.mkdtemp(path.join(tmpdir(), 'dsh-seework-routes-'))
    setLibraryDataRoot(dataRoot)
  })

  afterAll(async () => {
    setLibraryDataRoot(previousRoot === '' ? undefined : previousRoot)
    await fs.rm(dataRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    gateway = await startGateway()
    settings = fakeSettings({
      apiUrl: `${gateway.base}/v1`,
      serviceUrl: gateway.base,
      apiKey: 'sk-secret-value',
      models: [{
        id: 'seedream-5-0-lite',
        label: 'Seedream 5.0 Lite',
        resolutions: ['2K', '3K', '4K'],
        aspectRatios: ['16:9', '1:1'],
        outputFormats: ['png', 'jpeg'],
        maxImages: 4,
        maxReferenceImages: 2,
      }],
      defaultModel: 'seedream-5-0-lite',
    })
    config = settings.document as Config
    const runtime = new GenerationRuntime(() => effectiveConfig(settings.document as Config))
    plugin = await serveRoutes(makeRoutes({ settings: settings.seam, resolve: () => config, runtime }))
  })

  afterEach(async () => {
    await new Promise<void>(resolve => { plugin.server.close(() => resolve()) })
    await new Promise<void>(resolve => { gateway.server.close(() => resolve()) })
  })

  const post = (path: string, body: unknown = {}): Promise<Response> =>
    fetch(`${plugin.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('serves the settings namespace with the API key redacted', async () => {
    const response = await post(SETTINGS_API.describe)
    const payload = await response.json() as { ok: boolean; value: { namespaces: Array<Record<string, unknown>> } }
    expect(payload.ok).toBe(true)
    const view = payload.value.namespaces[0]!
    expect(view.ns).toBe('dsh-seework')
    expect(view.value).not.toHaveProperty('apiKey')
    expect(JSON.stringify(payload)).not.toContain('sk-secret-value')
    expect(view.secrets).toEqual([{ path: ['apiKey'], set: true }])
  })

  it('writes through the bridge and reports the new secret presence', async () => {
    const response = await post(SETTINGS_API.mutate, {
      ops: [{ op: 'set', path: ['apiKey'], value: 'sk-new-value' }],
    })
    const payload = await response.json() as { ok: boolean; value: Record<string, unknown> }
    expect(payload.ok).toBe(true)
    expect(settings.document.apiKey).toBe('sk-new-value')
    expect(payload.value).not.toHaveProperty('apiKey')
  })

  it('answers a stale write with a conflict instead of overwriting', async () => {
    const response = await post(SETTINGS_API.mutate, {
      ops: [{ op: 'set', path: ['apiUrl'], value: 'http://elsewhere/v1' }],
      expectedRevision: 999,
    })
    expect(response.status).toBe(409)
  })

  it('rejects a cross-site request to the bridge', async () => {
    const response = await fetch(`${plugin.base}${SETTINGS_API.describe}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: '{}',
    })
    expect(response.status).toBe(403)
  })

  it('runs one automatic detection round for the card, over the real catalog route (#652)', async () => {
    // The whole path, no stub between the pieces: the refresher reads the live
    // settings, discovers against the same stub catalog the card would, and
    // writes adopted capabilities back through the settings seam. The saved
    // model deliberately differs from what the catalog advertises, which is what
    // makes "adopted" observable.
    // One instance for the server's life — its throttle *is* the shared state the
    // two triggers rely on, so a per-request instance would be no test at all.
    const refresher = createCatalogRefresher({
      resolveModels: () => effectiveConfig(settings.document as Config).models,
      sources: () => ({
        serviceUrl: settings.document.serviceUrl ?? '',
        apiUrl: settings.document.apiUrl ?? '',
        apiKey: settings.document.apiKey ?? '',
      }),
      mutate: async models => {
        await settings.seam.mutate(SEEWORK_SETTINGS_NAMESPACE, [{ op: 'set', path: ['models'], value: models }])
      },
    })
    const refreshPlugin = await serveRoutes(makeRoutes({
      settings: settings.seam,
      resolve: () => config,
      runtime: new GenerationRuntime(() => effectiveConfig(settings.document as Config)),
      catalogRefresh: () => refresher,
    }))
    try {
      const response = await fetch(`${refreshPlugin.base}${CATALOG_API.refresh}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const payload = await response.json() as { ok: boolean; value: CatalogRefreshOutcome }
      expect(payload.ok).toBe(true)
      expect(payload.value.ran).toBe(true)
      // The saved entry had no `maxImages` / no stamp; the catalog's answer is now
      // persisted, and the user's selection is untouched.
      expect(payload.value.result?.adopted).toEqual(['seedream-5-0-lite'])
      const saved = settings.document.models ?? []
      expect(saved.map(model => model.id)).toEqual(['seedream-5-0-lite'])
      expect(saved[0]!.maxImages).toBe(4)
      expect(typeof saved[0]!.discoveredAt).toBe('number')

      // A second call inside the throttle window answers from the previous round
      // without re-requesting — the card-mount trigger shares it with the timer.
      const again = await fetch(`${refreshPlugin.base}${CATALOG_API.refresh}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const second = await again.json() as { value: CatalogRefreshOutcome }
      expect(second.value.ran).toBe(false)
      expect(second.value.skipped).toBe('throttled')
      // AC-3's other half: the round never touches the user's default model.
      expect(settings.document.defaultModel).toBe('seedream-5-0-lite')
    } finally {
      await new Promise<void>(resolve => { refreshPlugin.server.close(() => resolve()) })
    }
  })

  it('answers the catalog round routes with unavailable when no refresher is composed', async () => {
    const response = await post(CATALOG_API.refresh)
    expect(response.status).toBe(503)
    const payload = await response.json() as { code: string }
    expect(payload.code).toBe('unavailable')
  })

  it('reports how the host can choose a folder, and opens one on request', async () => {
    // This suite's route family has no picker composed, so both routes explain
    // themselves instead of failing.
    const missing = await post(SETTINGS_API.directoryPicker)
    expect(missing.status).toBe(200)
    expect(((await missing.json()) as { value: { kind: string } }).value.kind).toBe('none')
    const refused = await post(SETTINGS_API.pickDirectory)
    expect(refused.status).toBe(503)
    expect(((await refused.json()) as { code: string }).code).toBe('picker_none')

    /** Run one request against a route family composed with the given picker. */
    const withPicker = async (picker: () => unknown): Promise<{ probe: unknown; pick: { status: number; payload: { ok: boolean; value?: { path?: string; cancelled?: boolean }; code?: string } } }> => {
      const server = await serveRoutes(makeRoutes({
        settings: settings.seam,
        resolve: () => config,
        runtime: new GenerationRuntime(() => effectiveConfig(settings.document as Config)),
        directoryPicker: picker,
      }))
      try {
        const probe = await fetch(`${server.base}${SETTINGS_API.directoryPicker}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        })
        const pick = await fetch(`${server.base}${SETTINGS_API.pickDirectory}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        })
        return {
          probe: ((await probe.json()) as { value: unknown }).value,
          pick: { status: pick.status, payload: await pick.json() as { ok: boolean; value?: { path?: string; cancelled?: boolean }; code?: string } },
        }
      } finally {
        await new Promise<void>(resolve => { server.server.close(() => { resolve() }) })
      }
    }

    // A native chooser: the probe says so, and a pick hands back its path.
    const native = await withPicker(() => ({ capability: () => ({ kind: 'native', pick: async () => '/srv/pictures' }) }))
    expect(native.probe).toEqual({ kind: 'native' })
    expect(native.pick.payload.value?.path).toBe('/srv/pictures')

    // A cancelled chooser is a normal answer, not an error.
    const cancelled = await withPicker(() => ({ capability: () => ({ kind: 'native', pick: async () => null }) }))
    expect(cancelled.pick.status).toBe(200)
    expect(cancelled.pick.payload.value?.cancelled).toBe(true)

    // A browse-only host keeps the button away and is told why.
    const browse = await withPicker(() => ({ capability: () => ({ kind: 'browse' }) }))
    expect((browse.probe as { kind: string }).kind).toBe('browse')
    expect(browse.pick.payload.code).toBe('picker_browse')
  })

  it('discovers the gateway image models and drops the chat ones', async () => {
    const response = await post(CATALOG_API.models)
    const payload = await response.json() as {
      ok: boolean
      value: { models: Array<{ id: string; maxReferenceImages: number; capabilitiesKnown: boolean }>; origin: string; attempts: Array<{ url: string; outcome: string }> }
    }
    expect(payload.ok).toBe(true)
    expect(payload.value.origin).toBe('catalog')
    // The image model comes back; the chat one is filtered out.
    expect(payload.value.models.map(model => model.id).sort()).toEqual(['seedream-5-0-lite'])
    // The stub catalog declares 2 reference images for this model.
    expect(payload.value.models.find(model => model.id === 'seedream-5-0-lite')!.maxReferenceImages).toBe(2)
    expect(payload.value.models.every(model => model.capabilitiesKnown)).toBe(true)
    // …and it came from the stub, not from whatever the developer's own service
    // happens to be serving (the default service address is the local one).
    expect(payload.value.attempts.length).toBeGreaterThan(0)
    expect(payload.value.attempts[0]!.url).toBe(`${gateway.base}/api/v1/catalog/models`)
  })

  it('generates an image, maps the request fields, and stores it in the library', async () => {
    const response = await post(GENERATE_API, {
      model: 'seedream-5-0-lite',
      prompt: '雪山下的木屋',
      resolution: '2K',
      aspectRatio: '16:9',
      n: 2,
    })
    const payload = await response.json() as { ok: boolean; value: { task: { status: string; entryId?: string; result?: { images: unknown[]; cost?: number } } } }
    expect(payload.ok).toBe(true)
    expect(payload.value.task.status).toBe('completed')
    expect(payload.value.task.result?.cost).toBe(0.22)
    expect(payload.value.task.entryId).toBeDefined()

    // The upstream body uses the gateway's own vocabulary.
    expect(gateway.calls[0]).toMatchObject({
      model: 'seedream-5-0-lite',
      prompt: '雪山下的木屋',
      resolution: '2K',
      aspect_ratio: '16:9',
      n: 2,
    })
    expect(gateway.calls[0]).not.toHaveProperty('size')

    // …and the result is on disk, reachable through the library route.
    const listing = await listLibrary()
    expect(listing.total).toBe(1)
    const file = listing.entries[0]!.images[0]!.file
    const image = await fetch(`${plugin.base}${LIBRARY_API.image}/${file}`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
  })

  it('applies the configured aspect ratio on the panel path, and omits it silently when the model refuses (#668)', async () => {
    const model = settings.document.models![0]!
    // A real catalog-discovered model: its capabilities are declared.
    model.capabilitiesKnown = true
    settings.document.defaultAspectRatio = '3:4'

    // The model declares the configured default, so the panel sends it — this is
    // the path that used to leave `aspect_ratio` out entirely.
    model.aspectRatios = ['3:4', '16:9']
    await post(GENERATE_API, { model: 'seedream-5-0-lite', prompt: '竖构图' })
    expect(gateway.calls.at(-1)!.aspect_ratio).toBe('3:4')

    // The model does not declare it: the field is omitted, and the plugin's own
    // default is not reported as a value the caller got wrong.
    model.aspectRatios = ['16:9', '1:1']
    const response = await post(GENERATE_API, { model: 'seedream-5-0-lite', prompt: '横构图' })
    const payload = await response.json() as { value: { task: { droppedParameters?: unknown } } }
    expect(gateway.calls.at(-1)).not.toHaveProperty('aspect_ratio')
    expect(payload.value.task.droppedParameters).toBeUndefined()
  })

  it('passes the gateway error vocabulary through to the caller', async () => {
    const failing = await startGateway({ failGeneration: { status: 400, body: { error: 'invalid_parameter', message: "resolution 非法: '1K'" } } })
    try {
      settings.document.apiUrl = `${failing.base}/v1`
      const response = await post(GENERATE_API, { model: 'seedream-5-0-lite', prompt: 'x', resolution: '1K' })
      const payload = await response.json() as { ok: boolean; value: { task: { status: string; error?: string } } }
      expect(payload.ok).toBe(true)
      expect(payload.value.task.status).toBe('failed')
      expect(payload.value.task.error).toContain('resolution 非法')
    } finally {
      await new Promise<void>(resolve => { failing.server.close(() => resolve()) })
    }
  })

  it('refuses a request without model or prompt', async () => {
    const response = await post(GENERATE_API, { prompt: '   ' })
    expect(response.status).toBe(400)
  })

  it('requires a model the catalog actually holds', async () => {
    const response = await post(GENERATE_API, { model: 'nope', prompt: 'x' })
    expect(response.status).toBe(400)
    const payload = await response.json() as { code: string; message: string }
    // An explicit unknown name must not silently fall back to the default model.
    expect(payload.code).toBe('model-not-configured')
    expect(payload.message).toContain('seedream-5-0-lite')
  })

  it('lists and cancels tasks', async () => {
    await post(GENERATE_API, { model: 'seedream-5-0-lite', prompt: '一张图' })
    const listed = await fetch(`${plugin.base}${TASK_API.list}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const payload = await listed.json() as { value: { tasks: Array<{ id: string; status: string }> } }
    expect(payload.value.tasks).toHaveLength(1)
    const cancelled = await post(TASK_API.cancel, { taskId: payload.value.tasks[0]!.id })
    expect(cancelled.status).toBe(200)
  })

  it('keeps a task alive when a caller only stops waiting for it', async () => {
    const runtime = new GenerationRuntime(() => effectiveConfig(settings.document as Config))
    const task = runtime.submit({
      mode: 'text',
      model: 'seedream-5-0-lite',
      prompt: '慢慢画',
      resolution: '',
      aspectRatio: '',
      outputFormat: '',
      n: 1,
      imageUrls: [],
    }, 'panel')

    const controller = new AbortController()
    const waiting = runtime.waitFor(task.id, controller.signal)
    controller.abort()
    // The caller learns the wait ended; the generation itself must not be killed.
    await expect(waiting).rejects.toThrow(/等待生图结果已中断/)
    const settled = await runtime.waitFor(task.id)
    expect(settled.status).toBe('completed')
  })

  it('removes a library entry and its file', async () => {
    const before = (await listLibrary()).total
    await post(GENERATE_API, { model: 'seedream-5-0-lite', prompt: '待删除' })
    const target = (await listLibrary()).entries[0]!
    const response = await post(LIBRARY_API.remove, { id: target.id })
    expect(response.status).toBe(200)
    expect((await listLibrary()).total).toBe(before)
  })

  it('answers the cheap library head the page polls for new generations', async () => {
    const empty = await post(LIBRARY_API.head, {})
    expect(empty.status).toBe(200)
    const before = (await empty.json() as { value: { total: number; newestId?: string } }).value

    await post(GENERATE_API, { model: 'seedream-5-0-lite', prompt: '刚生成的一张' })
    const after = (await (await post(LIBRARY_API.head, {})).json() as { value: { total: number; newestId?: string } }).value

    expect(after.total).toBe(before.total + 1)
    expect(after.newestId).toBeDefined()
    expect(after.newestId).not.toBe(before.newestId)
  })

  it('404s an unknown library image file', async () => {
    const response = await fetch(`${plugin.base}${LIBRARY_API.image}/does-not-exist-0.png`)
    expect(response.status).toBe(404)
  })
})

describe('tool-result images', () => {
  /**
   * The conversation card's byte source. The reference arrives in a URL, so the
   * route has to re-validate every field before touching the store, and a host
   * without a store must degrade instead of failing the whole route family.
   */
  async function serve(attachments?: { readImage: (ref: ImageAttachmentRef) => Promise<{ ref: ImageAttachmentRef; data: Uint8Array }> }): Promise<{ server: Server; base: string; seen: string[] }> {
    const seen: string[] = []
    const settings = fakeSettings({})
    const server = createServer((req, res) => {
      const url = (req.url ?? '/').split('?')[0] ?? '/'
      for (const route of makeRoutes({
        settings: settings.seam,
        resolve: () => settings.document as Config,
        runtime: new GenerationRuntime(() => effectiveConfig(settings.document as Config)),
        ...attachments === undefined ? {} : { attachments: {
          readImage: async (ref: ImageAttachmentRef) => {
            seen.push(String(ref.attachmentId))
            return attachments.readImage(ref)
          },
        } },
      })) {
        const matches = route.kind === 'exact' ? url === route.path : url === route.path || url.startsWith(`${route.path}/`)
        if (!matches) continue
        void Promise.resolve(route.handler(req, res)).catch(() => {
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
        return
      }
      res.writeHead(404)
      res.end()
    })
    return new Promise(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const port = typeof address === 'object' && address !== null ? address.port : 0
        resolve({ server, base: `http://127.0.0.1:${port}`, seen })
      })
    })
  }

  const query = (overrides: Record<string, string> = {}): string => new URLSearchParams({
    attachment_id: 'sha256:abc',
    media_type: 'image/png',
    bytes: '4',
    width: '2',
    height: '2',
    ...overrides,
  }).toString()

  const close = (server: Server): Promise<void> => new Promise(resolve => { server.close(() => resolve()) })

  it('serves the durable attachment the reference names', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71])
    const plugin = await serve({
      readImage: async () => ({
        ref: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 4, width: 2, height: 2 },
        data: bytes,
      }),
    })
    try {
      const response = await fetch(`${plugin.base}${ATTACHMENT_API.image}?${query()}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/png')
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
      expect(plugin.seen).toEqual(['sha256:abc'])
    } finally {
      await close(plugin.server)
    }
  })

  it('refuses an incomplete or non-image reference before touching the store', async () => {
    const plugin = await serve({ readImage: async () => { throw new Error('the store must not be reached') } })
    try {
      for (const bad of [
        query({ attachment_id: '' }),
        query({ media_type: 'image/tiff' }),
        query({ bytes: '0' }),
        query({ width: '2.5' }),
        query({ height: '' }),
      ]) {
        const response = await fetch(`${plugin.base}${ATTACHMENT_API.image}?${bad}`)
        expect(response.status).toBe(400)
      }
      expect(plugin.seen).toEqual([])
    } finally {
      await close(plugin.server)
    }
  })

  it('answers 404 when the store no longer holds that attachment', async () => {
    const plugin = await serve({ readImage: async () => { throw new Error('pruned') } })
    try {
      const response = await fetch(`${plugin.base}${ATTACHMENT_API.image}?${query()}`)
      expect(response.status).toBe(404)
    } finally {
      await close(plugin.server)
    }
  })

  it('degrades to 503 on a host with no attachment store', async () => {
    const plugin = await serve()
    try {
      const response = await fetch(`${plugin.base}${ATTACHMENT_API.image}?${query()}`)
      expect(response.status).toBe(503)
    } finally {
      await close(plugin.server)
    }
  })

  it('only answers GET', async () => {
    const plugin = await serve()
    try {
      const response = await fetch(`${plugin.base}${ATTACHMENT_API.image}?${query()}`, { method: 'POST' })
      expect(response.status).toBe(405)
    } finally {
      await close(plugin.server)
    }
  })
})

describe('canvas-owned pictures', () => {
  /**
   * Marks and crops live on the board, not in the material library: the library
   * records what was generated, and a marked-up copy is not a generation. These
   * tests pin the store's own route family — write, read back, and refuse.
   */
  let dataRoot = ''
  let server: Server
  let base = ''

  beforeAll(async () => {
    dataRoot = await fs.mkdtemp(path.join(tmpdir(), 'dsh-seework-assets-'))
    setLibraryDataRoot(dataRoot)
    const settings = fakeSettings({})
    server = createServer((req, res) => {
      const url = (req.url ?? '/').split('?')[0] ?? '/'
      for (const route of makeRoutes({
        settings: settings.seam,
        resolve: () => settings.document as Config,
        runtime: new GenerationRuntime(() => effectiveConfig(settings.document as Config)),
      })) {
        const matches = route.kind === 'exact' ? url === route.path : url === route.path || url.startsWith(`${route.path}/`)
        if (!matches) continue
        void Promise.resolve(route.handler(req, res)).catch(() => {
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', () => { resolve() }) })
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    setLibraryDataRoot(undefined)
    await fs.rm(dataRoot, { recursive: true, force: true })
  })

  const png = (): string => `data:image/png;base64,${pngBuffer(6, 4).toString('base64')}`

  it('stores a marked-up picture and serves it back', async () => {
    const created = await fetch(`${base}${CANVAS_API.asset}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl: png() }),
    })
    expect(created.status).toBe(200)
    const payload = await created.json() as { value: { image: { file: string; url: string; width?: number; height?: number } } }
    const image = payload.value.image
    // Same naming shape as the library, so the board's file-name rule keeps working.
    expect(image.file).toMatch(/^[0-9a-f-]+-0\.png$/)
    expect(image.url).toBe(`${CANVAS_API.asset}/${image.file}`)
    expect(image.width).toBe(6)
    expect(image.height).toBe(4)
    // It landed in the canvas asset directory, NOT the library's images directory.
    await expect(fs.stat(path.join(dataRoot, 'canvas', 'assets', image.file))).resolves.toBeTruthy()

    const served = await fetch(`${base}${image.url}`)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect((await served.arrayBuffer()).byteLength).toBe(pngBuffer(6, 4).byteLength)
  })

  it('refuses anything that is not an image data URL', async () => {
    for (const dataUrl of ['', 'https://example.test/x.png', 'data:text/plain;base64,aGk=', 'data:image/png;base64,']) {
      const response = await fetch(`${base}${CANVAS_API.asset}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      })
      expect(response.status).toBe(400)
    }
  })

  it('refuses a name that tries to leave the assets directory', async () => {
    const response = await fetch(`${base}${CANVAS_API.asset}/${encodeURIComponent('../index.json')}`)
    expect([400, 404]).toContain(response.status)
    const missing = await fetch(`${base}${CANVAS_API.asset}/00000000-0000-0000-0000-000000000000-0.png`)
    expect(missing.status).toBe(404)
  })

  it('reports which board pictures are still shown, and cleans up the rest', async () => {
    // One picture a card points at, one nothing references any more.
    const stored = async (): Promise<string> => {
      const created = await fetch(`${base}${CANVAS_API.asset}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataUrl: png() }),
      })
      const payload = await created.json() as { value: { image: { file: string } } }
      return payload.value.image.file
    }
    const used = await stored()
    const orphan = await stored()
    const board = await fetch(`${base}${CANVAS_API.create}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '清理测试' }),
    })
    const canvas = (await board.json() as { value: { canvas: CanvasDocument } }).value.canvas
    canvas.cards = [{
      id: 'card-1', kind: 'image', x: 0, y: 0, width: 100, height: 100, z: 1, file: used, source: 'canvas', origin: 'annotation',
    }]
    const saved = await fetch(`${base}${CANVAS_API.save}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvas, expectedRevision: canvas.revision }),
    })
    expect(saved.status).toBe(200)

    const listed = await fetch(`${base}${CANVAS_API.assets}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const listing = (await listed.json() as { value: { files: Array<{ file: string; referenced: boolean }>; orphans: number; orphanBytes: number } }).value
    expect(listing.files.find(file => file.file === used)?.referenced).toBe(true)
    expect(listing.files.find(file => file.file === orphan)?.referenced).toBe(false)
    // Other tests in this suite leave pictures behind in the same data root, so the
    // count is "at least this one", and the sweep is checked by its outcome below.
    expect(listing.orphans).toBeGreaterThanOrEqual(1)
    expect(listing.orphanBytes).toBeGreaterThan(0)

    // One picture: refused while a card still shows it, allowed once it does not.
    const refused = await fetch(`${base}${CANVAS_API.removeAsset}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: used }),
    })
    expect(refused.status).toBe(409)
    await expect(fs.stat(path.join(dataRoot, 'canvas', 'assets', used))).resolves.toBeTruthy()

    const removed = await fetch(`${base}${CANVAS_API.removeAsset}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: orphan }),
    })
    expect(removed.status).toBe(200)
    expect((await removed.json() as { value: { removed: number } }).value.removed).toBe(1)
    await expect(fs.stat(path.join(dataRoot, 'canvas', 'assets', orphan))).rejects.toThrow()

    // …and the bulk route sweeps what is left: nothing unreferenced remains, and
    // the picture a card still shows survives it.
    const pruned = await fetch(`${base}${CANVAS_API.pruneAssets}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(pruned.status).toBe(200)
    await expect(fs.stat(path.join(dataRoot, 'canvas', 'assets', used))).resolves.toBeTruthy()
    const swept = await fetch(`${base}${CANVAS_API.assets}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const sweptListing = (await swept.json() as { value: { files: Array<{ file: string }>; orphans: number } }).value
    expect(sweptListing.orphans).toBe(0)
    expect(sweptListing.files.map(file => file.file)).toEqual([used])

    // A name that is not the store's shape never becomes a path.
    const hostile = await fetch(`${base}${CANVAS_API.removeAsset}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: '../index.json' }),
    })
    expect((await hostile.json() as { value: { removed: number } }).value.removed).toBe(0)
  })

  it('drops a card’s picture with the card, in that order', async () => {
    const created = await fetch(`${base}${CANVAS_API.asset}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl: png() }),
    })
    const file = ((await created.json() as { value: { image: { file: string } } }).value.image.file)
    const board = await fetch(`${base}${CANVAS_API.create}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const canvas = (await board.json() as { value: { canvas: CanvasDocument } }).value.canvas
    canvas.cards = [{ id: 'card-1', kind: 'image', x: 0, y: 0, width: 100, height: 100, z: 1, file, source: 'canvas', origin: 'crop' }]
    await fetch(`${base}${CANVAS_API.save}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvas, expectedRevision: canvas.revision }),
    })
    // Removing the card first is what makes the delete acceptable…
    const emptied = { ...canvas, cards: [], revision: canvas.revision + 1 }
    await fetch(`${base}${CANVAS_API.save}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvas: emptied, expectedRevision: canvas.revision + 1 }),
    })
    const removed = await fetch(`${base}${CANVAS_API.removeAsset}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file }),
    })
    expect(removed.status).toBe(200)
    await expect(fs.stat(path.join(dataRoot, 'canvas', 'assets', file))).rejects.toThrow()
  })
})

describe('showing a picture in the file manager', () => {
  /**
   * The reveal route takes a file name and its store, never a path: it composes
   * the path from that store's own directory, after that store's own name check.
   *
   * The desktop call is a seam here, so grading this route never opens a window
   * on the machine running the suite; what the real file manager is asked to do
   * is pinned in `reveal.test.ts`.
   */
  let dataRoot = ''
  let server: Server
  let base = ''
  /** The stubbed desktop: the paths it was asked for, and whether it refuses. */
  let desktop: { asked: string[]; fail: boolean }

  beforeEach(() => { desktop = { asked: [], fail: false } })

  beforeAll(async () => {
    dataRoot = await fs.mkdtemp(path.join(tmpdir(), 'dsh-seework-reveal-'))
    setLibraryDataRoot(dataRoot)
    const settings = fakeSettings({})
    server = createServer((req, res) => {
      const url = (req.url ?? '/').split('?')[0] ?? '/'
      for (const route of makeRoutes({
        settings: settings.seam,
        resolve: () => settings.document as Config,
        runtime: new GenerationRuntime(() => effectiveConfig(settings.document as Config)),
        reveal: async file => {
          if (desktop.fail) throw new Error('这个平台没有可用的文件管理器')
          desktop.asked.push(file)
        },
      })) {
        const matches = route.kind === 'exact' ? url === route.path : url === route.path || url.startsWith(`${route.path}/`)
        if (!matches) continue
        void Promise.resolve(route.handler(req, res)).catch(() => {
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', () => { resolve() }) })
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    setLibraryDataRoot(undefined)
    await fs.rm(dataRoot, { recursive: true, force: true })
  })

  const post = (body: unknown): Promise<Response> =>
    fetch(`${base}${IMAGE_API.reveal}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('composes the path from the name, under the store that owns it', async () => {
    const file = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-0.png'

    const library = await post({ file, source: 'library' })
    expect(library.status).toBe(200)
    expect(await library.json()).toEqual({ ok: true, value: { revealed: true } })
    expect(desktop.asked).toEqual([path.join(dataRoot, 'images', file)])

    // The same name in the other store is a different file, in its own directory.
    expect((await post({ file, source: 'canvas' })).status).toBe(200)
    expect(desktop.asked[1]).toBe(path.join(dataRoot, 'canvas', 'assets', file))
  })

  it('refuses anything it cannot turn into one of its own files', async () => {
    const file = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-0.png'
    const refused = [
      // Not the name shape either store writes, so not a path at all.
      { file: '../../settings.yaml', source: 'library' },
      { file: '/etc/passwd', source: 'canvas' },
      { file: 'shot.png', source: 'library' },
      // A store that does not exist, and one that is missing entirely.
      { file, source: 'elsewhere' },
      { file },
    ]
    for (const body of refused) expect((await post(body)).status).toBe(400)
    expect(desktop.asked).toEqual([])
  })

  it('reports a desktop that refused instead of claiming it revealed anything', async () => {
    desktop.fail = true
    const response = await post({ file: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-0.png', source: 'library' })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, code: 'reveal_failed' })
  })
})

describe('plugin metadata', () => {
  it('exports the cordis plugin contract with its config schema', async () => {
    const plugin = await import('./index.ts')
    expect(plugin.name).toBe('seework')
    expect(plugin.inject).toContain('tools')
    expect(plugin.inject).toContain('webServer')
    expect(typeof plugin.Config).toBe('function')
    // The exported schema is the volatile one the loader validates the profile
    // entry with, so its resolved value arrives as a live reference.
    const defaults = plugin.Config({}).get()!
    expect(defaults.apiUrl).toBe('http://127.0.0.1:8080/v1')
    expect(defaults.models).toEqual([])
    expect(defaults.enabled).toBe(true)
  })

  it('tells the agent where to configure the plugin when it is not set up yet', async () => {
    const plugin = await import('./index.ts')
    const text = plugin.guidanceFor(effectiveConfig({}))
    expect(text).toContain('SeeWork')
    // The sidebar entry, not a floating button most hosts never show.
    expect(text).toContain('设置 → 插件 → SeeWork')
    expect(text).toContain('侧边栏')
  })

  it('lists the configured models in the agent announcement', async () => {
    const plugin = await import('./index.ts')
    const text = plugin.guidanceFor(effectiveConfig({
      apiUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'sk-x',
      models: [{
        id: 'seedream-5-0-lite',
        label: 'Seedream 5.0 Lite',
        resolutions: ['2K'],
        aspectRatios: ['16:9'],
        outputFormats: [],
        maxImages: 4,
        maxReferenceImages: 2,
        capabilitiesKnown: true,
      }],
      defaultModel: 'seedream-5-0-lite',
    }))
    expect(text).toContain('Seedream 5.0 Lite')
    expect(text).toContain('可带参考图')
  })
})
