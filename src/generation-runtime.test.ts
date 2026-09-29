/**
 * The concurrency guard — the plugin-side half of "one generation per user and
 * model at a time" (#658).
 *
 * Two claims are pinned here: a second same-model submission is **refused**, not
 * queued (one task is one request), and a 409 is never retried — that 409 now
 * means somebody else holds the lock, because the plugin no longer collides with
 * itself. A real stub gateway is used so both claims are measured at the HTTP
 * boundary.
 *
 * @vitest-environment node
 */

import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GenerationRuntime, SeeWorkRuntimeError } from './generation-runtime.ts'
import { listLibrary, setLibraryDataRoot } from './library.ts'
import { effectiveConfig, type Config } from './settings.ts'
import { fixtureRequest, pngBuffer } from './fixtures.ts'

/** What the stub gateway saw while it was being called. */
interface GatewayLog {
  /** Request bodies, in arrival order. */
  bodies: Array<Record<string, unknown>>
  /** Most requests in flight at once, overall. */
  peakTotal: number
  /** Most requests in flight at once, per model. */
  peakPerModel: Map<string, number>
}

/** A stub gateway that records overlap and can fail or stall on request. */
function startGateway(
  options: { delayMs?: number; status?: number; body?: unknown } = {},
): Promise<{ server: Server; base: string; log: GatewayLog }> {
  const log: GatewayLog = { bodies: [], peakTotal: 0, peakPerModel: new Map() }
  let inFlight = 0
  const perModel = new Map<string, number>()
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      log.bodies.push(body)
      const model = String(body.model)
      inFlight++
      perModel.set(model, (perModel.get(model) ?? 0) + 1)
      log.peakTotal = Math.max(log.peakTotal, inFlight)
      log.peakPerModel.set(model, Math.max(log.peakPerModel.get(model) ?? 0, perModel.get(model)!))
      const finish = (): void => {
        inFlight--
        perModel.set(model, (perModel.get(model) ?? 1) - 1)
        if (options.status !== undefined) {
          res.writeHead(options.status, { 'content-type': 'application/json' })
          res.end(JSON.stringify(options.body ?? {}))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ created: 1, data: [{ b64_json: pngBuffer(8, 8).toString('base64') }], cost: 0.1 }))
      }
      if (options.delayMs === undefined) finish()
      else setTimeout(finish, options.delayMs)
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ server, base: `http://127.0.0.1:${port}`, log })
    })
  })
}

/** A settings document pointing at the stub, offering the given models. */
function configFor(base: string, models: string[]): Config {
  return {
    apiUrl: `${base}/v1`,
    serviceUrl: base,
    apiKey: 'sk-x',
    models: models.map(id => ({
      id,
      label: id,
      resolutions: [],
      aspectRatios: [],
      outputFormats: [],
      maxImages: 4,
      maxReferenceImages: 0,
      capabilitiesKnown: false,
    })),
    defaultModel: models[0]!,
  }
}

describe('the generation queue concurrency guard', () => {
  let root = ''
  let previousDataRoot = ''
  let gateway: Awaited<ReturnType<typeof startGateway>> | undefined

  beforeEach(() => {
    previousDataRoot = process.env.DSH_HOME ?? ''
    root = path.join(tmpdir(), `dsh-seework-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    setLibraryDataRoot(root)
  })

  afterEach(async () => {
    setLibraryDataRoot(previousDataRoot === '' ? undefined : previousDataRoot)
    await fs.rm(root, { recursive: true, force: true })
    if (gateway !== undefined) {
      const closing = gateway
      gateway = undefined
      await new Promise<void>(resolve => { closing.server.close(() => resolve()) })
    }
  })

  it('refuses a second request for the same model instead of queueing it (#658)', async () => {
    gateway = await startGateway({ delayMs: 30 })
    const runtime = new GenerationRuntime(() => effectiveConfig(configFor(gateway!.base, ['model-a'])))
    const running = runtime.submit(fixtureRequest({ model: 'model-a', prompt: '第 1 张' }), 'panel')

    // One task is one request: while the model is busy the second submission is
    // refused outright — nothing waits in a queue, and nothing extra is billed.
    let refusal: unknown
    try {
      runtime.submit(fixtureRequest({ model: 'model-a', prompt: '第 2 张' }), 'panel')
    } catch (error) {
      refusal = error
    }
    expect(refusal).toBeInstanceOf(SeeWorkRuntimeError)
    expect(String((refusal as Error).message)).toContain('得到许可后再发')

    const settled = await runtime.waitFor(running.id)
    expect(settled.status).toBe('completed')
    expect(gateway.log.peakPerModel.get('model-a')).toBe(1)
    expect(gateway.log.bodies.map(body => body.prompt)).toEqual(['第 1 张'])
    // ...and the model is free again once it finishes, so the user can send the
    // next one deliberately.
    const next = runtime.submit(fixtureRequest({ model: 'model-a', prompt: '第 2 张' }), 'panel')
    expect((await runtime.waitFor(next.id)).status).toBe('completed')
  })

  it('still runs different models side by side', async () => {
    gateway = await startGateway({ delayMs: 40 })
    const runtime = new GenerationRuntime(() => effectiveConfig(configFor(gateway!.base, ['model-a', 'model-b'])))
    const first = runtime.submit(fixtureRequest({ model: 'model-a' }), 'panel')
    const second = runtime.submit(fixtureRequest({ model: 'model-b' }), 'panel')

    await Promise.all([runtime.waitFor(first.id), runtime.waitFor(second.id)])

    // Per-model serialisation must not serialise the whole plugin: concurrency is
    // where it is allowed to buy something.
    expect(gateway.log.peakTotal).toBe(2)
  })

  it('reports a 409 once instead of retrying into a running generation', async () => {
    gateway = await startGateway({
      status: 409,
      body: { error: 'image_task_in_progress', message: '同一模型已有任务在跑' },
    })
    const runtime = new GenerationRuntime(() => effectiveConfig(configFor(gateway!.base, ['model-a'])))
    const task = runtime.submit(fixtureRequest({ model: 'model-a' }), 'panel')

    const settled = await runtime.waitFor(task.id)

    expect(settled.status).toBe('failed')
    // Exactly one attempt: this 409 means somebody ELSE holds the lock (the
    // plugin no longer queues, so it cannot collide with itself).
    expect(gateway.log.bodies).toHaveLength(1)
    // And the caller is told what happened, not told to retry.
    expect(settled.error).toContain('本次没有发起生成')
    expect(settled.error).toContain('得到许可后再发')
  })

  /** A model entry that declares exactly the given capabilities. */
  function declaring(aspectRatios: string[], maxImages: number): Config {
    return {
      ...configFor(gateway!.base, ['model-a']),
      defaultAspectRatio: '3:4',
      models: [{
        id: 'model-a',
        label: 'model-a',
        resolutions: ['2K'],
        aspectRatios,
        outputFormats: ['png'],
        maxImages,
        maxReferenceImages: 0,
        capabilitiesKnown: true,
      }],
    }
  }

  it('records the count it actually sends — task, library entry and upstream body (#668)', async () => {
    gateway = await startGateway()
    const runtime = new GenerationRuntime(() => effectiveConfig(declaring(['16:9'], 15)))
    const task = runtime.submit(fixtureRequest({ model: 'model-a', n: 15 }), 'panel')

    // The task carries the effective request, so what the detail pane prints is
    // what the gateway was asked for — the same number on the settled record the
    // task list serves, on disk in the library, and on the wire.
    const settled = await runtime.waitFor(task.id)
    expect(settled.status).toBe('completed')
    expect(runtime.get(task.id)!.request.n).toBe(10)
    expect(gateway.log.bodies[0]!.n).toBe(10)
    expect((await listLibrary()).entries[0]!.n).toBe(10)
  })

  it('applies the configured aspect ratio on both sources, and omits it silently when the model refuses (#668)', async () => {
    gateway = await startGateway()

    // Panel path: the model takes the configured default, so it is sent.
    const takes = new GenerationRuntime(() => effectiveConfig(declaring(['3:4', '16:9'], 1)))
    const taken = takes.submit(fixtureRequest({ model: 'model-a', aspectRatio: '' }), 'panel')
    await takes.waitFor(taken.id)
    expect(gateway.log.bodies[0]!.aspect_ratio).toBe('3:4')

    // Tool path: the model does not take it, so the field is omitted — and the
    // plugin's own default is not reported as a value the caller got wrong.
    const refuses = new GenerationRuntime(() => effectiveConfig(declaring(['16:9', '1:1'], 1)))
    const omitted = refuses.submit(fixtureRequest({ model: 'model-a', aspectRatio: '' }), 'agent')
    const settled = await refuses.waitFor(omitted.id)

    expect(settled.request.aspectRatio).toBe('')
    expect(settled.droppedParameters).toBeUndefined()
    expect(gateway.log.bodies[1]).not.toHaveProperty('aspect_ratio')
  })
})
