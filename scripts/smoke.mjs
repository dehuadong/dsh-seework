/**
 * End-to-end smoke test for dsh-seework's HOST half, run against the built
 * bundle (`lib/index.js`) rather than the sources.
 *
 * It stands up a stub SeeAI Hub gateway (catalog + image generation) and drives
 * the real plugin the way the DSH host does: an in-process settings provider
 * backed by a temporary document, the real routes over a real HTTP server, and
 * the real generation runtime. Nothing here needs the DSH GUI, so it is the
 * check to run after every change.
 *
 *   node scripts/smoke.mjs
 *
 * Exits non-zero on the first unmet expectation.
 */

import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

let failures = 0

/** How many upcoming generation calls the stub gateway should reject with 409. */
let rejectNext = 0

/** Assert one condition, reporting every failure instead of stopping at the first. */
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures++
  console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

/** CRC32 for PNG chunks. */
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Build a structurally valid PNG of the requested size. */
function pngBuffer(width = 64, height = 32) {
  const chunk = (type, payload) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(payload.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), payload])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const idat = deflateSync(Buffer.alloc((width * 3 + 1) * height))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Start a stub SeeAI Hub gateway. */
function startGateway() {
  const calls = []
  const server = createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0]
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const json = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (url === '/api/v1/catalog/models') {
        json(200, {
          models: [
            {
              name: 'seedream-5-0-lite',
              display_name: 'Seedream 5.0 Lite',
              type: 'image',
              // Catalog v2 (see dsh-seework/docs/design/2026-09-16-catalog-entry-v2.md):
              // every sendable field is a self-describing descriptor.
              supported_parameters: {
                resolution: { type: 'enum', values: ['2K', '3K', '4K'], default: '2K' },
                aspect_ratio: { type: 'enum', values: ['16:9', '1:1'] },
                n: { type: 'range', min: 1, max: 4 },
                image_urls: { type: 'array', items: { type: 'string' }, max: 2 },
                output_format: { type: 'enum', values: ['png', 'jpeg'] },
              },
            },
            {
              name: 'gpt-image-2',
              display_name: 'GPT Image 2',
              type: 'image',
              supported_parameters: {
                resolution: { type: 'enum', values: ['1K', '2K'], default: '1K' },
                n: { type: 'range', min: 1, max: 4 },
                image_urls: { type: 'array', items: { type: 'string' }, max: 4 },
              },
            },
            { name: 'deepseek-chat', type: 'chat', capabilities: {} },
          ],
        })
        return
      }
      if (url === '/v1/images/generations') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        calls.push(body)
        // Injected by `failNext()`: the 409 refusal scenario in section 7. The
        // plugin must report it, never retry it.
        if (rejectNext > 0) {
          rejectNext--
          json(409, { error: 'image_task_in_progress', message: '同一时间只允许一个生图请求' })
          return
        }
        json(200, {
          created: Math.floor(Date.now() / 1000),
          data: Array.from({ length: body.n ?? 1 }, () => ({ b64_json: pngBuffer(48, 48).toString('base64') })),
          cost: 0.22 * (body.n ?? 1),
        })
        return
      }
      json(404, { error: 'not_found' })
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}`, calls, failNext: () => { rejectNext++ } })
    })
  })
}

/**
 * A minimal in-process settings provider matching the host seam. Like the real
 * provider it strips `role('secret')` fields from the resolved value AND from
 * the raw user layer, so the wire really is free of the key.
 */
function fakeSettings() {
  const document = {}
  let revision = 1
  const strip = (source) => {
    const copy = { ...source }
    delete copy.apiKey
    return copy
  }
  return {
    document,
    seam: {
      writable: true,
      describe: (options) => {
        const redact = options?.redactSecrets === true
        return [{
          ns: 'dsh-seework',
          schema: {},
          value: redact ? strip(document) : { ...document },
          revision,
          user: redact ? strip(document) : { ...document },
          applies: 'live',
          secrets: [{ path: ['apiKey'], set: typeof document.apiKey === 'string' && document.apiKey !== '' }],
        }]
      },
      mutate: async (_ns, ops) => {
        for (const op of ops) {
          if (op.op === 'unset') delete document[op.path[0]]
          else document[op.path[0]] = op.value
        }
        revision++
      },
    },
  }
}

/** Whether a path exists. */
async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/** Serve the plugin's route table over HTTP. */
function serveRoutes(routes) {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]
    for (const route of routes) {
      const matches = route.kind === 'exact' ? url === route.path : url === route.path || url.startsWith(`${route.path}/`)
      if (!matches) continue
      void Promise.resolve(route.handler(req, res)).catch(error => {
        if (!res.headersSent) res.writeHead(500)
        res.end(String(error))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }))
  })
}

/** POST JSON and decode the plugin envelope. */
async function post(base, route, body = {}) {
  const response = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: await response.json() }
}

const plugin = await import('../lib/index.js')

console.log('dsh-seework host smoke test')
console.log(`  plugin name: ${plugin.name}`)

const dataRoot = await fs.mkdtemp(path.join(tmpdir(), 'dsh-seework-smoke-'))
plugin.setLibraryDataRoot(dataRoot)

const gateway = await startGateway()
const { document, seam } = fakeSettings()
const runtime = new plugin.GenerationRuntime(() => plugin.effectiveConfig(document))
const routes = plugin.makeRoutes({ settings: seam, resolve: () => document, runtime })
const pluginServer = await serveRoutes(routes)

try {
  console.log('\n1. gateway discovery')
  document.apiUrl = `${gateway.base}/v1`
  // The catalog lives on the service, and its DEFAULT is the developer's own
  // `127.0.0.1:8081` — pointing it at the stub is what makes this run hermetic
  // (and the model list below a check of the stub, not of one machine's setup).
  document.serviceUrl = gateway.base
  document.apiKey = 'sk-smoke-test'
  const catalog = await post(pluginServer.base, '/api/dsh-seework/catalog/models')
  check('catalog responds ok', catalog.payload.ok === true, JSON.stringify(catalog.payload).slice(0, 200))
  const ids = catalog.payload.value?.models?.map(model => model.id) ?? []
  check('image models discovered', ids.includes('seedream-5-0-lite') && ids.includes('gpt-image-2'), ids.join(','))
  check('chat model filtered out', !ids.includes('deepseek-chat'), ids.join(','))

  console.log('\n2. settings bridge')
  const described = await post(pluginServer.base, '/api/dsh-seework/settings/describe')
  check('bridge responds ok', described.payload.ok === true)
  check('API key is redacted on the wire', !JSON.stringify(described.payload).includes('sk-smoke-test'))
  check('secret presence reported', described.payload.value?.namespaces?.[0]?.secrets?.[0]?.set === true)

  console.log('\n2b. automatic detection round (#652)')
  // Hand-wired here rather than through `apply()`: this script has no cordis
  // host, and its job is the *route + module* behaviour. The assembly itself
  // (startup round, background timer, stop on unload) is covered by
  // `src/index.test.ts`, which does run `apply()` against a stub host.
  const refresher = plugin.createCatalogRefresher({
    resolveModels: () => plugin.effectiveConfig(document).models,
    sources: () => ({
      serviceUrl: document.serviceUrl ?? '',
      apiUrl: document.apiUrl ?? '',
      apiKey: document.apiKey ?? '',
    }),
    mutate: async models => {
      await seam.mutate('dsh-seework', [{ op: 'set', path: ['models'], value: models }])
    },
  })
  const refresherRoutes = await serveRoutes(plugin.makeRoutes({
    settings: seam,
    resolve: () => document,
    runtime,
    catalogRefresh: () => refresher,
  }))
  try {
    // The catalog round is what the settings card calls when it opens.
    const round = await post(refresherRoutes.base, '/api/dsh-seework/catalog/refresh')
    check('automatic round responds ok', round.payload.ok === true, JSON.stringify(round.payload).slice(0, 200))
    // Nothing saved yet at this point in the run: the round says so without
    // touching the network, which is the AC-9 "unconfigured never runs" rule.
    check('round declines while nothing is saved', round.payload.value?.ran === false && round.payload.value?.skipped === 'not-configured', JSON.stringify(round.payload.value))

    document.models = [{
      id: 'seedream-5-0-lite',
      label: 'Seedream 5.0 Lite',
      resolutions: [],
      aspectRatios: [],
      qualities: ['low', 'high'],
      outputFormats: [],
      maxImages: 1,
      maxReferenceImages: 0,
    }]
    // A stale snapshot: the catalog says 4 images / reference 2 / 3 tiers.
    const adopted = await post(refresherRoutes.base, '/api/dsh-seework/catalog/refresh')
    check('round runs once a model is saved', adopted.payload.value?.ran === true, JSON.stringify(adopted.payload.value))
    check('capabilities were adopted', adopted.payload.value?.result?.adopted?.includes('seedream-5-0-lite') === true, JSON.stringify(adopted.payload.value?.result))
    check('the saved model now carries the catalog capabilities', (document.models[0]?.maxImages ?? 0) === 4, JSON.stringify(document.models[0]))
    // #661: `qualities` is a retired per-model key. It is neither read nor kept:
    // the round's whole-`models` rewrite takes it off the document (AC-3).
    check('a retired per-model qualities list is cleaned off', document.models[0]?.qualities === undefined, JSON.stringify(document.models[0]))
    check('the round stamped the snapshot', typeof document.models[0]?.discoveredAt === 'number')
    // An unseen catalog model is reported, never adopted (AC-4).
    check('a new catalog model is reported, not adopted', adopted.payload.value?.result?.added?.includes('gpt-image-2') === true, JSON.stringify(adopted.payload.value?.result))
    check('the selection is unchanged by a round', (document.models ?? []).length === 1, String((document.models ?? []).length))

    const throttled = await post(refresherRoutes.base, '/api/dsh-seework/catalog/refresh')
    check('a second automatic round is throttled', throttled.payload.value?.ran === false && throttled.payload.value?.skipped === 'throttled', JSON.stringify(throttled.payload.value))

    // AC-6: the announcement is "default model line + the others' names", so a
    // round can change it only through the capability line it refreshed.
    const announced = plugin.guidanceFor(plugin.effectiveConfig(document))
    check('announcement still names the model after a round', announced.includes('Seedream 5.0 Lite'))
    check('announcement still lists no per-model capability detail beyond one line',
      (announced.match(/档位 /g) ?? []).length === 1, announced)
  } finally {
    await new Promise(resolve => refresherRoutes.server.close(resolve))
  }

  console.log('\n3. model selection')
  const seedream = catalog.payload.value.models.find(model => model.id === 'seedream-5-0-lite')
  document.models = [{ ...seedream }]
  document.defaultModel = 'seedream-5-0-lite'
  document.enabled = true

  console.log('\n4. text-to-image through the gateway')
  const generated = await post(pluginServer.base, '/api/dsh-seework/generate', {
    model: 'seedream-5-0-lite',
    prompt: '雪山下的木屋，黄昏，暖光',
    resolution: '2K',
    aspectRatio: '16:9',
    // A stale client that still sends it: #661 dropped `quality`, so the route
    // must ignore it rather than map it into the gateway body.
    quality: 'high',
    n: 1,
  })
  const task = generated.payload.value?.task
  check('generation completed', task?.status === 'completed', task?.error ?? '')
  check('gateway received the documented fields', gateway.calls.at(-1)?.resolution === '2K' && gateway.calls.at(-1)?.aspect_ratio === '16:9')
  check('a stray quality is ignored, never forwarded', gateway.calls.at(-1)?.quality === undefined, JSON.stringify(gateway.calls.at(-1)))
  check('gateway never received an unknown size field', gateway.calls.at(-1)?.size === undefined)
  check('cost reported back', task?.result?.cost === 0.22, String(task?.result?.cost))
  check('library entry recorded', typeof task?.entryId === 'string' && task.entryId.length > 0)

  console.log('\n5. material library')
  const listing = await post(pluginServer.base, '/api/dsh-seework/library/list')
  check('library lists the generation', listing.payload.value?.total === 1, String(listing.payload.value?.total))
  const entry = listing.payload.value?.entries?.[0]
  check('library entry keeps the prompt', entry?.prompt === '雪山下的木屋，黄昏，暖光')
  check('library entry exposes an image URL', typeof entry?.images?.[0]?.url === 'string')
  const image = await fetch(`${pluginServer.base}${entry.images[0].url}`)
  check('library image is served', image.status === 200 && image.headers.get('content-type') === 'image/png', String(image.status))
  check('library image bytes look like a PNG', Buffer.from(await image.arrayBuffer()).subarray(0, 4).toString('hex') === '89504e47')
  check('image dimensions were read from the header', entry?.images?.[0]?.width === 48 && entry?.images?.[0]?.height === 48)
  check('library entry carries what the sidebar filters on', entry?.source === 'panel' && entry?.model === 'seedream-5-0-lite' && entry?.cost === 0.22)
  check('data root is reported for the sidebar footer', typeof listing.payload.value?.dataRoot === 'string' && listing.payload.value.dataRoot.length > 0)

  console.log('\n6. image-to-image with a reference image')
  const edited = await post(pluginServer.base, '/api/dsh-seework/generate', {
    mode: 'edit',
    model: 'seedream-5-0-lite',
    prompt: '把天空换成星空',
    imageUrls: [`data:image/png;base64,${pngBuffer(64, 64).toString('base64')}`],
    refNames: ['上一张图'],
    n: 1,
  })
  const editTask = edited.payload.value?.task
  check('edit generation completed', editTask?.status === 'completed', editTask?.error ?? '')
  check('reference image travelled in image_urls', Array.isArray(gateway.calls.at(-1)?.image_urls) && gateway.calls.at(-1).image_urls.length === 1)
  check('the equivalent `image` alias was not also sent', gateway.calls.at(-1)?.image === undefined)
  check('edit is recorded as an edit', listing.payload.value?.entries?.[0]?.mode === 'text' && (await post(pluginServer.base, '/api/dsh-seework/library/list')).payload.value?.entries?.[0]?.mode === 'edit')

  console.log('\n7. refusals')
  const badModel = await post(pluginServer.base, '/api/dsh-seework/generate', { model: 'nope', prompt: 'x' })
  check('unknown model is refused with a useful code', badModel.status === 400 && badModel.payload.code === 'model-not-configured', JSON.stringify(badModel.payload))
  const noPrompt = await post(pluginServer.base, '/api/dsh-seework/generate', { model: 'seedream-5-0-lite', prompt: '  ' })
  check('empty prompt is refused', noPrompt.status === 400, String(noPrompt.status))
  // The gateway's 409 is its one-generation-per-user-and-model lock. The plugin no
  // longer queues (so it cannot collide with itself): a 409 here means somebody
  // else holds the lock, and the caller is told what happened — never told to
  // retry. #658/D-8.
  const callsBeforeConflict = gateway.calls.length
  gateway.failNext()
  const conflicted = await post(pluginServer.base, '/api/dsh-seework/generate', { model: 'seedream-5-0-lite', prompt: '会被占用' })
  const conflictTask = conflicted.payload.value?.task
  check('a 409 fails the task instead of being retried', conflictTask?.status === 'failed', conflictTask?.status ?? '')
  check('the failure states what happened and asks for permission, not a retry',
    String(conflictTask?.error ?? '').includes('本次没有发起生成')
    && String(conflictTask?.error ?? '').includes('得到许可后再发'),
    conflictTask?.error ?? '')
  check('exactly one request reached the gateway', gateway.calls.length - callsBeforeConflict === 1, String(gateway.calls.length - callsBeforeConflict))
  const crossSite = await fetch(`${pluginServer.base}/api/dsh-seework/settings/describe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    body: '{}',
  })
  check('cross-site bridge call is refused', crossSite.status === 403, String(crossSite.status))

  console.log('\n8. library management (the sidebar deletes through these)')
  const beforeDelete = (await post(pluginServer.base, '/api/dsh-seework/library/list')).payload.value
  const victim = beforeDelete.entries[0]
  const victimFile = path.join(dataRoot, 'images', victim.images[0].file)
  check('the file exists before deletion', await exists(victimFile))
  const removed = await post(pluginServer.base, '/api/dsh-seework/library/remove', { id: victim.id })
  check('removal accepted', removed.status === 200, String(removed.status))
  check('entry left the index', (await post(pluginServer.base, '/api/dsh-seework/library/list')).payload.value.total === beforeDelete.total - 1)
  check('the image file was deleted from disk', !(await exists(victimFile)))
  const gone = await fetch(`${pluginServer.base}/api/dsh-seework/library/image/${victim.images[0].file}`)
  check('the deleted image is no longer served', gone.status === 404, String(gone.status))

  const cleared = await post(pluginServer.base, '/api/dsh-seework/library/clear')
  check('clear empties the library', cleared.status === 200 && cleared.payload.value.entries.length === 0)
  const afterClear = await post(pluginServer.base, '/api/dsh-seework/library/list')
  check('the cleared library still answers (not an error)', afterClear.payload.ok === true && afterClear.payload.value.total === 0)
  check('the images directory is empty', (await fs.readdir(path.join(dataRoot, 'images'))).length === 0)

  console.log('\n9. canvas (the spatial board, not a node graph)')
  const emptyList = await post(pluginServer.base, '/api/dsh-seework/canvas/list')
  check('canvas list starts empty', emptyList.payload.ok === true && emptyList.payload.value.canvases.length === 0)

  const created = await post(pluginServer.base, '/api/dsh-seework/canvas/create', { title: '冒烟画布' })
  const canvasId = created.payload.value?.canvas?.id
  check('canvas created with revision 1', created.payload.value?.canvas?.revision === 1 && typeof canvasId === 'string')
  check('canvas lands on disk', await exists(path.join(dataRoot, 'canvas', `${canvasId}.json`)))

  const saved = await post(pluginServer.base, '/api/dsh-seework/canvas/save', {
    expectedRevision: 1,
    canvas: {
      id: canvasId,
      title: '冒烟画布',
      viewport: { x: -40, y: 20, k: 1.25 },
      cards: [
        { id: 'card-1', kind: 'image', x: 10, y: 10, width: 320, height: 240, z: 1, file: `${victim.images[0].file}`, model: 'seedream-5-0-lite', prompt: '放在板上的图' },
        { id: 'card-2', kind: 'text', x: 380, y: 10, width: 240, height: 100, z: 2, text: '一句备注' },
      ],
    },
  })
  check('canvas saved and revision advanced', saved.payload.value?.canvas?.revision === 2, JSON.stringify(saved.payload).slice(0, 160))
  check('viewport round-trips', saved.payload.value?.canvas?.viewport?.k === 1.25)

  const reread = await post(pluginServer.base, '/api/dsh-seework/canvas/read', { id: canvasId })
  check('canvas reads back both cards', reread.payload.value?.canvas?.cards?.length === 2)

  const stale = await post(pluginServer.base, '/api/dsh-seework/canvas/save', {
    expectedRevision: 1,
    canvas: { id: canvasId, viewport: { x: 0, y: 0, k: 1 }, cards: [] },
  })
  check('a stale save is refused with a conflict', stale.status === 409 && stale.payload.code === 'canvas_conflict', JSON.stringify(stale.payload))

  const badFile = await post(pluginServer.base, '/api/dsh-seework/canvas/save', {
    expectedRevision: 2,
    canvas: { id: canvasId, viewport: { x: 0, y: 0, k: 1 }, cards: [{ id: 'x', kind: 'image', x: 0, y: 0, width: 10, height: 10, z: 1, file: '../../settings.yaml' }] },
  })
  check('a card pointing outside the library is refused', badFile.status === 400 && badFile.payload.code === 'canvas_invalid', JSON.stringify(badFile.payload).slice(0, 160))

  const malformed = await post(pluginServer.base, '/api/dsh-seework/canvas/save', {
    expectedRevision: 2,
    canvas: {
      id: canvasId,
      viewport: { x: 0, y: 0, k: 1 },
      cards: [{ id: 'keep', kind: 'text', x: 0, y: 0, width: 100, height: 100, z: 1, text: 'ok' }, { id: 'drop-me' }, 'nonsense'],
    },
  })
  check('unusable cards are dropped, the good one survives', malformed.payload.value?.canvas?.cards?.map(card => card.id).join(',') === 'keep', JSON.stringify(malformed.payload.value?.canvas?.cards))

  const canvasRemoved = await post(pluginServer.base, '/api/dsh-seework/canvas/remove', { id: canvasId })
  check('canvas removed from the list', canvasRemoved.payload.ok === true && canvasRemoved.payload.value.canvases.length === 0)
  check('canvas file deleted', !(await exists(path.join(dataRoot, 'canvas', `${canvasId}.json`))))

  console.log('\n10. agent announcement')
  const configured = plugin.guidanceFor(plugin.effectiveConfig(document))
  check('announcement names the configured model', configured.includes('Seedream 5.0 Lite'))
  check('announcement states the five-parameter boundary', configured.includes('插件只发五个常规参数'))
  // #661: the plugin no longer offers any /guide pointer, in either branch.
  check('configured announcement points at no /guide endpoint', !configured.includes('/guide') && !configured.includes('引导文档'))
  const unconfigured = plugin.guidanceFor(plugin.effectiveConfig({}))
  check('announcement routes an unconfigured user to the settings UI', unconfigured.includes('设置 → 插件 → SeeWork'))
  check('unconfigured announcement points at no /guide endpoint either', !unconfigured.includes('/guide') && !unconfigured.includes('引导文档'))
} finally {
  await new Promise(resolve => pluginServer.server.close(resolve))
  await new Promise(resolve => gateway.server.close(resolve))
  await fs.rm(dataRoot, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nSMOKE PASSED' : `\nSMOKE FAILED (${failures} check(s))`)
process.exit(failures === 0 ? 0 : 1)
