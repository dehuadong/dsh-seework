/**
 * The `/api/dsh-seework` route family.
 *
 *  - settings bridge  — the plugin's own namespace over the host settings seam
 *    (describe/mutate), because third-party namespaces are not served by the
 *    shell's settings transport. Loopback-only, same-origin fenced.
 *  - catalog          — model discovery for the settings card.
 *  - verify           — "does this address + key work" probe (never persists).
 *  - generate/tasks   — the generation proxy; credentials stay host-side.
 *  - library          — the material library list and its image files.
 *
 * Handlers read the live config per request, so saving the settings card takes
 * effect without a restart. The settings bridge deliberately keeps serving
 * while the plugin is disabled — it is how the user turns it back on.
 */

import { promises as fs } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { SettingsConflictError, type SettingsDescriptor, type SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { SeeWorkError } from './engine.ts'
import { discoverModels } from './catalog.ts'
import type { CatalogRefresher } from './catalog-refresh.ts'
import { GenerationRuntime, SeeWorkRuntimeError } from './generation-runtime.ts'
import { effectiveConfig, type Config } from './settings.ts'
import { clearLibrary, libraryImagePath, listLibrary, readLibraryHead, readLibraryImage, removeLibraryEntry } from './library.ts'
import { canvasAssetPath, deleteCanvasAssets, listCanvasAssetFiles, readCanvasAsset, writeCanvasAsset } from './canvas-assets.ts'
import { directoryPickerStatus, pickDirectory } from './directory-picker.ts'
import { CanvasConflictError, CanvasInputError, createCanvas, listCanvases, readCanvas, referencedCanvasFiles, removeCanvas, saveCanvas } from './canvas-store.ts'
import { revealInFileManager } from './reveal.ts'
import {
  ATTACHMENT_API,
  CANVAS_API,
  CATALOG_API,
  GENERATE_API,
  IMAGE_API,
  LIBRARY_API,
  SETTINGS_API,
  SEEWORK_SETTINGS_NAMESPACE,
  TASK_API,
  UPDATE_API,
  isImageMedia,
  type CanvasCardSource,
  type GenerateRequest,
  type UpdateStart,
} from './protocol.ts'
import { PACKAGE_NAME, UPDATE_SPEC, checkForUpdate, exemptVersion, latestVersionFrom, profileDirectory, readInstallKind, readOwnVersion, registryOf, type UpdateHost } from './update.ts'

/** Cap on JSON request bodies (edit requests carry data-URL reference images). */
const MAX_JSON_BODY_BYTES = 48 * 1024 * 1024

/** How long a synchronous generate call waits before handing back a task id. */
const SYNC_WAIT_MS = 300_000

/** The service face the settings bridge needs from the host settings provider. */
export interface SettingsSeam {
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptor[]
  mutate(ns: unknown, ops: unknown, expectedRevision?: number): Promise<void>
  readonly writable?: boolean
}

export interface SeeWorkRoutesDeps {
  /** The settings seam (namespace storage). */
  settings: SettingsSeam
  /** Read the currently authoritative config. */
  resolve: () => Config
  /** The shared generation queue. */
  runtime: GenerationRuntime
  /**
   * The durable attachment store, read back by the conversation card. Absent on
   * a host that composes no attachment store, in which case that one route
   * answers "unavailable" instead of failing the whole family.
   */
  attachments?: AttachmentSeam
  /**
   * Reads the host's directory-picker service, **per request**: the backend may
   * attach after this plugin does, and a deployment without one must keep working
   * (the folder-picking routes then answer "unavailable" instead of failing).
   */
  directoryPicker?: () => unknown
  /**
   * The automatic detection rounds (#652).
   *
   * Probed per request, and answers `undefined` before the settings provider has
   * attached: the two catalog routes then reply "unavailable" rather than
   * pretending a round ran.
   */
  catalogRefresh?: () => CatalogRefresher | undefined
  /**
   * The host's plugin manager, probed **per request**.
   *
   * Absent on a host that composes none, and the update routes then answer
   * "unavailable" rather than pretending an install could be started. The probe
   * is also what keeps this plugin loadable on 0.1.x, where the service is
   * shaped differently.
   */
  updateHost?: () => UpdateHost | undefined
  /**
   * How the reveal route asks the desktop to show a file.
   *
   * Defaults to the real file manager; a test stands in for it so grading the
   * route never opens a window on the machine running the suite.
   */
  reveal?: (path: string) => Promise<void>
}

/** The attachment-store face the tool-result image route needs. */
export interface AttachmentSeam {
  readImage(
    ref: ImageAttachmentRef,
  ): Promise<{ ref: ImageAttachmentRef; data: Uint8Array }>
}

/** Loopback literal check plus browser same-origin markers. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/** One success envelope. */
function ok(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

/** One failure envelope (stable `code` + human `message`). */
function fail(res: ServerResponse, status: number, code: string, message: string): void {
  writeJson(res, status, { ok: false, code, message })
}

/** Read a bounded JSON request body. */
async function readJsonBody(req: IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    total += buffer.byteLength
    if (total > maxBytes) return undefined
    chunks.push(buffer)
  }
  if (total === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/** Serialize one descriptor into the bridge wire shape (secrets redacted). */
function toView(descriptor: SettingsDescriptor): Record<string, unknown> {
  return {
    ns: descriptor.ns,
    schema: descriptor.schema,
    value: descriptor.value,
    revision: descriptor.revision,
    ...descriptor.base === undefined ? {} : { base: descriptor.base },
    ...descriptor.user === undefined ? {} : { user: descriptor.user },
    secrets: (descriptor.secrets ?? []).map(secret => ({ path: [...secret.path], set: secret.set })),
  }
}

/** Turn a thrown value into the bridge failure envelope. */
function failureOf(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof SettingsConflictError) {
    return { status: 409, code: 'conflict', message: `设置已被其它位置修改（期望版本 ${error.expected}，当前 ${error.actual}），请重试。` }
  }
  if (error instanceof CanvasConflictError) {
    return { status: 409, code: 'canvas_conflict', message: error.message }
  }
  if (error instanceof CanvasInputError) {
    return { status: 400, code: 'canvas_invalid', message: error.message }
  }
  if (error instanceof SeeWorkError || error instanceof SeeWorkRuntimeError) {
    // Configuration and validation refusals are the caller's to fix; only
    // genuinely unexpected failures fall through to 500.
    return { status: 400, code: error.code, message: error.message }
  }
  return { status: 500, code: 'internal', message: error instanceof Error ? error.message : String(error) }
}

/** Validate and normalize a generate request body. */
function parseGenerateRequest(body: Record<string, unknown>): GenerateRequest | undefined {
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  const model = typeof body.model === 'string' ? body.model : ''
  if (prompt.trim() === '' || model.trim() === '') return undefined
  const mode = body.mode === 'edit' ? 'edit' : 'text'
  const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
  const imageUrls: string[] = []
  if (Array.isArray(body.imageUrls)) {
    for (const item of body.imageUrls) {
      if (typeof item === 'string' && item.trim() !== '') imageUrls.push(item.trim())
    }
  }
  const refNames = Array.isArray(body.refNames)
    ? body.refNames.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
    : undefined
  return {
    mode: mode === 'edit' && imageUrls.length > 0 ? 'edit' : 'text',
    model: model.trim(),
    prompt,
    resolution: text(body.resolution),
    aspectRatio: text(body.aspectRatio),
    outputFormat: text(body.outputFormat),
    n: typeof body.n === 'number' && Number.isFinite(body.n) ? Math.trunc(body.n) : 1,
    imageUrls: mode === 'edit' ? imageUrls : [],
    ...refNames === undefined || refNames.length === 0 ? {} : { refNames },
  }
}

/** Serve one library image file (prefix route). */
async function serveLibraryImage(res: ServerResponse, file: string): Promise<void> {
  const image = await readLibraryImage(file)
  if (image === undefined) {
    fail(res, 404, 'image_not_found', '图片不存在或文件名非法。')
    return
  }
  res.writeHead(200, {
    'content-type': image.mime,
    'content-length': image.data.byteLength,
    'cache-control': 'private, max-age=31536000, immutable',
  })
  res.end(image.data)
}

/**
 * Whether one path is a file that is really there.
 *
 * The stores answer "is this a name I would write"; this answers "did it land
 * here", which is a different question the moment the material directory moves.
 *
 * @param target - absolute path to check.
 * @returns true when a file exists there.
 */
async function fileExists(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile()
  } catch {
    return false
  }
}

/**
 * Absolute path of one of this plugin's pictures, or undefined when the name is
 * not one its store writes.
 *
 * This is the only place a reveal request becomes a filesystem path, and it goes
 * through each store's own name rule — so the route cannot be pointed at a file
 * the plugin did not write.
 *
 * @param file - the picture's file name.
 * @param source - which store holds it.
 * @returns the path on disk, or undefined for a name that store would not write.
 */
function imagePathFor(file: string, source: CanvasCardSource): string | undefined {
  return source === 'canvas' ? canvasAssetPath(file) : libraryImagePath(file)
}

/**
 * Rebuild one durable attachment reference from a tool-result image request.
 *
 * Every field is re-validated here rather than trusted: the values arrive in a
 * URL a page composed, and the route reads a store shared with every other
 * attachment in the harness. An incomplete or malformed reference is refused
 * outright — a partial one must never reach the store.
 *
 * @param rawUrl - the request URL (query carries the reference).
 * @returns the reference, or undefined when it is not complete and well-formed.
 */
function attachmentRefFrom(rawUrl: string | undefined): ImageAttachmentRef | undefined {
  if (rawUrl === undefined) return undefined
  let url: URL
  try {
    url = new URL(rawUrl, 'http://localhost')
  } catch {
    return undefined
  }
  if (url.pathname !== ATTACHMENT_API.image) return undefined
  const attachmentId = url.searchParams.get('attachment_id') ?? ''
  const mediaType = url.searchParams.get('media_type') ?? ''
  const bytes = Number(url.searchParams.get('bytes'))
  const width = Number(url.searchParams.get('width'))
  const height = Number(url.searchParams.get('height'))
  if (attachmentId === '' || !isImageMedia(mediaType)) return undefined
  if (!Number.isSafeInteger(bytes) || bytes < 1) return undefined
  if (!Number.isSafeInteger(width) || width < 1) return undefined
  if (!Number.isSafeInteger(height) || height < 1) return undefined
  return {
    attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType,
    bytes,
    width,
    height,
  }
}

/** Serve one durable attachment a tool result references (prefix route). */
async function serveAttachmentImage(
  attachments: AttachmentSeam | undefined,
  res: ServerResponse,
  ref: ImageAttachmentRef,
): Promise<void> {
  if (attachments === undefined) {
    fail(res, 503, 'attachments_unavailable', '宿主没有挂载附件存储，无法读取这张图片。')
    return
  }
  try {
    const stored = await attachments.readImage(ref)
    res.writeHead(200, {
      'content-type': stored.ref.mediaType,
      'content-length': stored.data.byteLength,
      'cache-control': 'private, max-age=31536000, immutable',
    })
    res.end(Buffer.from(stored.data))
  } catch {
    // A pruned or unknown attachment is a missing image, not a server error.
    fail(res, 404, 'image_not_found', '这张图片已不在宿主的附件存储里。')
  }
}

/** Build the plugin's routes. */
export function makeRoutes(deps: SeeWorkRoutesDeps): WebRoute[] {
  const loopback = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (isLoopbackRequest(req)) return true
    fail(res, 403, 'loopback_only', '该接口只允许本机访问。')
    return false
  }
  const route = (
    kind: WebRoute['kind'],
    path: string,
    handler: WebRoute['handler'],
  ): WebRoute => ({ kind, path, handler })

  return [
    // ---- settings bridge -------------------------------------------------
    route('exact', SETTINGS_API.describe, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      try {
        const writable = deps.settings.writable !== false
        const view = deps.settings.describe({ redactSecrets: true })
          .find(descriptor => descriptor.ns === SEEWORK_SETTINGS_NAMESPACE)
        ok(res, {
          namespaces: view === undefined ? [] : [toView(view)],
          writable,
        })
      } catch (error) {
        const failure = failureOf(error)
        fail(res, failure.status, failure.code, failure.message)
      }
    }),

    route('exact', SETTINGS_API.mutate, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const body = await readJsonBody(req)
      if (body === undefined) return fail(res, 400, 'invalid_body', '请求体不是合法 JSON 对象。')
      const ops = Array.isArray(body.ops) ? body.ops as SettingsPathOp[] : undefined
      if (ops === undefined) return fail(res, 400, 'invalid_body', '缺少设置操作 ops。')
      const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
      try {
        await deps.settings.mutate(SEEWORK_SETTINGS_NAMESPACE, ops, expectedRevision)
        // The stores follow the settings, and this is where they just changed: a
        // data root that moves has to move its files, which no later read can do.
        deps.resolve()
        const view = deps.settings.describe({ redactSecrets: true })
          .find(descriptor => descriptor.ns === SEEWORK_SETTINGS_NAMESPACE)
        ok(res, view === undefined ? { ns: SEEWORK_SETTINGS_NAMESPACE, revision: 0, value: {}, secrets: [] } : toView(view))
      } catch (error) {
        const failure = failureOf(error)
        fail(res, failure.status, failure.code, failure.message)
      }
    }),

    // ---- folder choosing (the host's directoryPicker seam) ---------------
    route('exact', SETTINGS_API.directoryPicker, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      // Reports the capability only; nothing is opened and nothing is stored.
      ok(res, directoryPickerStatus(deps.directoryPicker?.()))
    }),

    route('exact', SETTINGS_API.pickDirectory, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      // A client that goes away must not leave a dialog on the host's screen.
      const controller = new AbortController()
      req.on('close', () => { controller.abort() })
      const outcome = await pickDirectory(deps.directoryPicker?.(), controller.signal)
      if (res.writableEnded || res.destroyed) return
      if (outcome.kind === 'cancelled') return ok(res, { cancelled: true })
      if (outcome.kind === 'failed') return fail(res, 503, outcome.code, outcome.message)
      ok(res, { path: outcome.path })
    }),

    // ---- discovery -------------------------------------------------------
    route('exact', CATALOG_API.models, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const body = await readJsonBody(req) ?? {}
      // Unpersisted overrides let the card probe an address and key before saving.
      const config = effectiveConfig(deps.resolve())
      const apiUrl = typeof body.apiUrl === 'string' && body.apiUrl.trim() !== '' ? body.apiUrl.trim() : config.apiUrl
      const serviceUrl = typeof body.serviceUrl === 'string' && body.serviceUrl.trim() !== ''
        ? body.serviceUrl.trim()
        : config.serviceUrl
      const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() !== '' ? body.apiKey.trim() : config.apiKey
      try {
        ok(res, await discoverModels({ serviceUrl, apiUrl, apiKey }))
      } catch (error) {
        const failure = failureOf(error)
        fail(res, failure.status, failure.code, failure.message)
      }
    }),

    // ---- automatic detection (#652) --------------------------------------
    route('exact', CATALOG_API.refresh, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const refresher = deps.catalogRefresh?.()
      if (refresher === undefined) return fail(res, 503, 'unavailable', '这台宿主没有可用的设置服务，无法自动检测。')
      // Throttled by the refresher: this is the "card just opened" trigger, and
      // it shares its window with the background timer.
      try {
        ok(res, await refresher.refresh({ automatic: true }))
      } catch (error) {
        // The refresher itself never throws on a discovery failure; this catches
        // a programming error rather than turning it into a stack trace.
        const failure = failureOf(error)
        fail(res, failure.status, failure.code, failure.message)
      }
    }),

    // ---- generation ------------------------------------------------------
    route('exact', GENERATE_API, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const body = await readJsonBody(req)
      if (body === undefined) return fail(res, 400, 'invalid_body', '请求体不是合法 JSON 对象，或超过了体积上限。')
      const request = parseGenerateRequest(body)
      if (request === undefined) return fail(res, 400, 'invalid_request', '缺少必填的 model 或 prompt。')
      const config = effectiveConfig(deps.resolve())
      let task
      try {
        task = deps.runtime.submit(request, 'panel')
      } catch (error) {
        const failure = failureOf(error)
        return fail(res, failure.status, failure.code, failure.message)
      }
      if (body.waitForCompletion === false) return ok(res, { task })
      try {
        const settled = await deps.runtime.waitFor(task.id, AbortSignal.timeout(SYNC_WAIT_MS))
        ok(res, { task: settled })
      } catch (error) {
        // A timeout is not a failure: the task keeps running and the panel
        // falls back to polling its status.
        const current = deps.runtime.get(task.id) ?? task
        ok(res, { task: current })
      }
    }),

    route('exact', TASK_API.list, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      ok(res, { tasks: deps.runtime.list() })
    }),

    route('exact', TASK_API.cancel, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const body = await readJsonBody(req)
      const taskId = typeof body?.taskId === 'string' ? body.taskId : ''
      if (taskId === '') return fail(res, 400, 'invalid_body', '缺少 taskId。')
      const task = deps.runtime.cancel(taskId)
      if (task === undefined) return fail(res, 404, 'task_not_found', '找不到该生图任务。')
      ok(res, { task })
    }),

    // ---- self-update (published installs only) ----------------------------
    route('exact', UPDATE_API.status, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      // Read per request, not once at mount: the running version comes from the
      // packaged manifest and the install kind from the profile, so both change
      // the moment an update lands.
      const current = readOwnVersion()
      const kind = readInstallKind(profileDirectory())
      ok(res, await checkForUpdate({ host: deps.updateHost?.(), current, kind }))
    }),

    route('exact', UPDATE_API.apply, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      const host = deps.updateHost?.()
      if (host === undefined) return fail(res, 503, 'unavailable', '宿主没有提供插件管理服务。')
      if (readInstallKind(profileDirectory()) === 'local') {
        return fail(res, 409, 'local_install', '这是本地目录安装，更新请用 pnpm build && pnpm sync。')
      }
      // Resolve the target version first. The install needs an exact spec rather
      // than `@latest` — and that exact version is what has to be exempted from
      // pnpm's release-age gate, which otherwise refuses anything published less
      // than 24 hours ago and quietly leaves the old version in place.
      let target: string | undefined
      try {
        target = await latestVersionFrom({
          registry: registryOf(await host.registries()),
          packageName: PACKAGE_NAME,
        })
        await exemptVersion(profileDirectory(), PACKAGE_NAME, target)
      } catch (error) {
        // Not fatal here: fall back to `@latest` and let pnpm report its own
        // refusal through the install path.
        console.warn('[dsh-seework] could not resolve or exempt the target version:', error)
      }
      // Answer first, install after. Applying the install re-composes the
      // profile and tears these routes down, so a handler that awaited it could
      // not deliver its own response — the browser would see a dropped
      // connection and could not tell that from a real failure.
      ok(res, { started: true, ...target === undefined ? {} : { to: target } } satisfies UpdateStart)
      setTimeout(() => {
        void host.installBundle(target === undefined ? UPDATE_SPEC : `${PACKAGE_NAME}@${target}`).catch((error: unknown) => {
          // Nobody is left to receive this: the install unloaded this plugin, and
          // with it the route that started it. The host log is the only place the
          // reason can land.
          console.warn('[dsh-seework] self-update failed:', error)
        })
      }, 0)
    }),

    // ---- material library ------------------------------------------------
    route('exact', LIBRARY_API.list, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      ok(res, await listLibrary())
    }),

    // Cheap enough for the browser to poll: it is how a page notices a
    // generation the AGENT finished (the host never pushes that to the tab).
    route('exact', LIBRARY_API.head, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      ok(res, await readLibraryHead())
    }),

    route('exact', LIBRARY_API.remove, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const body = await readJsonBody(req)
      const id = typeof body?.id === 'string' ? body.id : ''
      if (id === '') return fail(res, 400, 'invalid_body', '缺少素材 id。')
      ok(res, { entries: await removeLibraryEntry(id) })
    }),

    route('exact', LIBRARY_API.clear, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      ok(res, { entries: await clearLibrary() })
    }),

    route('prefix', LIBRARY_API.image, async (req, res) => {
      if (req.method !== 'GET') return fail(res, 405, 'method_not_allowed', '请使用 GET。')
      // Same fence as every other route in this family: the web server can be
      // bound to all interfaces, and generated images are the user's content.
      // A same-origin `<img>` request has no Origin header and passes.
      if (!loopback(req, res)) return
      const path = (req.url ?? '').split('?')[0] ?? ''
      let file = ''
      try {
        file = decodeURIComponent(path.slice(LIBRARY_API.image.length + 1))
      } catch {
        // A malformed percent-escape is a bad request, not a crash.
        return fail(res, 400, 'invalid_body', '图片文件名编码不合法。')
      }
      if (file === '') return fail(res, 400, 'invalid_body', '缺少图片文件名。')
      await serveLibraryImage(res, file)
    }),

    // ---- tool-result images ----------------------------------------------
    // The conversation card shows the images of an Agent tool result, which are
    // deliberately NOT part of the model-visible session content — so the shell's
    // own `session.readAttachment` refuses them, and the card fetches the durable
    // attachment here instead, with the complete reference the tool persisted.
    route('prefix', ATTACHMENT_API.image, async (req, res) => {
      if (req.method !== 'GET') return fail(res, 405, 'method_not_allowed', '请使用 GET。')
      if (!loopback(req, res)) return
      const ref = attachmentRefFrom(req.url)
      if (ref === undefined) return fail(res, 400, 'invalid_body', '图片引用不完整或不合法。')
      await serveAttachmentImage(deps.attachments, res, ref)
    }),

    // ---- canvas-owned pictures (annotations, crops) ----------------------
    // They never enter the material library: the library records what was
    // generated, and a marked-up copy is the board's own material. Same loopback
    // fence as everything else, because it is the user's picture too.
    route('exact', CANVAS_API.asset, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const body = await readJsonBody(req)
      if (body === undefined) return fail(res, 400, 'invalid_body', '请求体不是合法 JSON 对象。')
      if (typeof body.dataUrl !== 'string') return fail(res, 400, 'invalid_body', '缺少图片数据。')
      try {
        const image = await writeCanvasAsset({ dataUrl: body.dataUrl })
        if (image === undefined) return fail(res, 400, 'invalid_body', '图片数据不合法（只接受 PNG/JPEG/WebP/GIF 的 data URL）。')
        ok(res, { image })
      } catch (error) {
        const failure = failureOf(error)
        fail(res, failure.status, failure.code, failure.message)
      }
    }),

    // ---- showing a picture's file in the host's file manager --------------
    // The client sends a file name and its store, never a path: the absolute
    // path is composed here from the store's own directory, after that store's
    // own name check. So a page cannot ask this route to reveal anything except
    // a picture this plugin wrote.
    route('exact', IMAGE_API.reveal, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const body = await readJsonBody(req)
      if (body === undefined) return fail(res, 400, 'invalid_body', '请求体不是合法 JSON 对象。')
      const source = body.source === 'library' || body.source === 'canvas' ? body.source : undefined
      if (typeof body.file !== 'string' || source === undefined) {
        return fail(res, 400, 'invalid_body', '需要图片文件名与来源（library / canvas）。')
      }
      // The stores follow the settings, so reading them here makes sure the root is
      // the one the settings name — a directory change moves the library before it
      // takes effect, and this route composes a path out of that root.
      deps.resolve()
      const target = imagePathFor(body.file, source)
      if (target === undefined) return fail(res, 400, 'invalid_body', '图片文件名不合法。')
      // A name this store could have written is not the same as a file that is
      // there: changing the material directory leaves the old files where they
      // were, and a board written under the previous root still names them. Handing
      // the file manager a path that is not there opens a folder with nothing
      // selected, which reads as "it did not work" rather than as why.
      if (!(await fileExists(target))) {
        return fail(res, 404, 'image_not_found',
          `这张图的文件不在当前素材目录（${path.dirname(target)}）里。换过素材目录后，旧目录里的文件不会自动搬过来。`)
      }
      try {
        await (deps.reveal ?? revealInFileManager)(target)
        ok(res, { revealed: true })
      } catch (error) {
        // The file is there; a failure here is the desktop's (no file manager, or
        // the command never answered).
        fail(res, 500, 'reveal_failed', `打开文件所在位置失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }),

    // Housekeeping. These exact paths are registered BEFORE the `asset` prefix
    // route above, because `asset/remove` would otherwise be read as a file name by
    // whichever matcher runs first.
    route('exact', CANVAS_API.assets, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      try {
        const referenced = await referencedCanvasFiles()
        const files = (await listCanvasAssetFiles()).map(file => ({ ...file, referenced: referenced.has(file.file) }))
        const orphans = files.filter(file => !file.referenced)
        ok(res, {
          files,
          orphans: orphans.length,
          orphanBytes: orphans.reduce((sum, file) => sum + file.bytes, 0),
        })
      } catch (error) {
        const failure = failureOf(error)
        fail(res, failure.status, failure.code, failure.message)
      }
    }),

    route('exact', CANVAS_API.pruneAssets, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      try {
        const referenced = await referencedCanvasFiles()
        const orphans = (await listCanvasAssetFiles()).filter(file => !referenced.has(file.file)).map(file => file.file)
        ok(res, await deleteCanvasAssets(orphans))
      } catch (error) {
        const failure = failureOf(error)
        fail(res, failure.status, failure.code, failure.message)
      }
    }),

    route('exact', CANVAS_API.removeAsset, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const body = await readJsonBody(req)
      if (body === undefined) return fail(res, 400, 'invalid_body', '请求体不是合法 JSON 对象。')
      if (typeof body.file !== 'string' || body.file === '') return fail(res, 400, 'invalid_body', '缺少图片文件名。')
      try {
        const referenced = await referencedCanvasFiles()
        if (referenced.has(body.file)) {
          return fail(res, 409, 'asset_in_use', '这张图还在画布上，先移除卡片再删它。')
        }
        ok(res, await deleteCanvasAssets([body.file]))
      } catch (error) {
        const failure = failureOf(error)
        fail(res, failure.status, failure.code, failure.message)
      }
    }),

    route('prefix', CANVAS_API.asset, async (req, res) => {      if (req.method !== 'GET') return fail(res, 405, 'method_not_allowed', '请使用 GET。')
      if (!loopback(req, res)) return
      const path = (req.url ?? '').split('?')[0] ?? ''
      let file = ''
      try {
        file = decodeURIComponent(path.slice(CANVAS_API.asset.length + 1))
      } catch {
        return fail(res, 400, 'invalid_body', '图片文件名编码不合法。')
      }
      if (file === '') return fail(res, 400, 'invalid_body', '缺少图片文件名。')
      const image = await readCanvasAsset(file)
      if (image === undefined) return fail(res, 404, 'image_not_found', '图片不存在或文件名非法。')
      res.writeHead(200, {
        'content-type': image.mime,
        'content-length': image.data.byteLength,
        'cache-control': 'private, max-age=31536000, immutable',
      })
      res.end(image.data)
    }),

    // ---- canvas ----------------------------------------------------------
    route('exact', CANVAS_API.list, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      try {
        ok(res, await listCanvases())
      } catch (error) {
        const failure = failureOf(error)
        fail(res, failure.status, failure.code, failure.message)
      }
    }),

    route('exact', CANVAS_API.create, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const body = await readJsonBody(req) ?? {}
      try {
        const canvas = await createCanvas(typeof body.title === 'string' ? body.title : undefined)
        ok(res, { canvas })
      } catch (error) {
        const failure = failureOf(error)
        fail(res, failure.status, failure.code, failure.message)
      }
    }),

    route('exact', CANVAS_API.read, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const body = await readJsonBody(req)
      const id = typeof body?.id === 'string' ? body.id : ''
      if (id === '') return fail(res, 400, 'invalid_body', '缺少画布 id。')
      const canvas = await readCanvas(id)
      if (canvas === undefined) return fail(res, 404, 'canvas_not_found', '画布不存在。')
      ok(res, { canvas })
    }),

    route('exact', CANVAS_API.save, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const body = await readJsonBody(req)
      if (body === undefined) return fail(res, 400, 'invalid_body', '请求体不是合法 JSON 对象。')
      const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
      if (expectedRevision === undefined) return fail(res, 400, 'invalid_body', '缺少 expectedRevision。')
      try {
        const canvas = await saveCanvas(body.canvas, expectedRevision)
        ok(res, { canvas })
      } catch (error) {
        const failure = failureOf(error)
        fail(res, failure.status, failure.code, failure.message)
      }
    }),

    route('exact', CANVAS_API.remove, async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', '请使用 POST。')
      if (!loopback(req, res)) return
      const body = await readJsonBody(req)
      const id = typeof body?.id === 'string' ? body.id : ''
      if (id === '') return fail(res, 400, 'invalid_body', '缺少画布 id。')
      try {
        ok(res, await removeCanvas(id))
      } catch (error) {
        const failure = failureOf(error)
        fail(res, failure.status, failure.code, failure.message)
      }
    }),
  ]
}
