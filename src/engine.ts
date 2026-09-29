/**
 * SeeAI Hub image generation engine (host half): maps a normalized request onto
 * the gateway's `/v1/images/generations` field vocabulary, performs the call,
 * and normalizes every documented success shape into base64 images.
 *
 * Contract authority: `docs/api/images.md` in this repository. Points that
 * matter here:
 *  - the body is always a JSON object (multipart is rejected by the gateway);
 *  - reference images ride `image_urls` (data URLs are supported) and their
 *    presence is what makes the request an edit — there is no separate mode
 *    field and `/v1/images/edits` is the same entry point;
 *  - `resolution` + `aspect_ratio` and explicit `size` are mutually exclusive;
 *  - responses are either `{data:[{url|b64_json}], cost}` or the GPT-Image
 *    passthrough shape with the same `data[]` and an injected `cost`;
 *  - errors are `{error, message}` and unknown fields are rejected with 400
 *    `unknown_field`, so this module must never invent parameter names.
 */

import { effectiveImageCount, type GenerateRequest, type GeneratedImage } from './protocol.ts'

/** Upstream credentials resolved from the plugin settings. */
export interface UpstreamConfig {
  /** OpenAI-compatible root, e.g. `http://127.0.0.1:8080/v1`. */
  apiUrl: string
  /** SeeAI Hub device API key (`sk-…`). */
  apiKey: string
}

/** A generation failure with a stable machine code and a user-facing message. */
export class SeeWorkError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** Extra machine-readable detail (e.g. which catalog sources were tried). */
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'SeeWorkError'
  }
}

/** Cap on one downloaded/stored image, guarding against a runaway upstream. */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024

/** Per-request timeout: image generation is synchronous and can be slow. */
const REQUEST_TIMEOUT_MS = 300_000

/** Join the configured base URL with the gateway path (tolerates a trailing slash). */
export function gatewayUrl(apiUrl: string, path: string): string {
  return `${apiUrl.trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/**
 * Derive a catalog URL from a configured base.
 * `http://host:8081` -> `http://host:8081/api/v1/catalog/models`.
 * A base that already ends in `/v1` (a gateway base) drops that suffix, so a
 * reverse proxy that mounts both surfaces under one host still resolves.
 */
export function catalogUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const root = /\/v1$/.test(trimmed) ? trimmed.slice(0, -'/v1'.length) : trimmed
  return `${root}/api/v1/catalog/models`
}

/** The `image_urls` field name (the documented alias `image` is equivalent). */
const IMAGE_URLS_FIELD = 'image_urls'

/** Build the gateway request body for one normalized request. */
export function buildGenerationBody(request: GenerateRequest): Record<string, unknown> {
  const model = request.model.trim()
  if (model === '') throw new SeeWorkError('未选择模型：请先在「设置 → 插件 → SeeWork」检测并勾选模型。', 'model-missing')
  const prompt = request.prompt.trim()
  if (prompt === '') throw new SeeWorkError('提示词不能为空。', 'prompt-missing')

  const body: Record<string, unknown> = {
    model,
    prompt,
    // The last-mile guard, over the same composition the normalizer applied: the
    // model's own ceiling is not known here, so only the wire ceiling can be
    // enforced — and it must not change the count the record carries (#668).
    n: effectiveImageCount(request.n),
  }

  // Size: a resolution tier + aspect ratio, or nothing at all. An explicit
  // `size` pixel pair is never sent — the catalog's 24-slot table is model
  // specific and sending a value outside it fails the whole request.
  const resolution = request.resolution.trim()
  if (resolution !== '' && resolution.toLowerCase() !== 'auto') body.resolution = resolution
  const aspectRatio = request.aspectRatio.trim()
  if (aspectRatio !== '' && aspectRatio.toLowerCase() !== 'auto') body.aspect_ratio = aspectRatio

  const outputFormat = request.outputFormat.trim()
  if (outputFormat !== '' && outputFormat.toLowerCase() !== 'auto') body.output_format = outputFormat

  const references = request.imageUrls.filter(url => typeof url === 'string' && url.trim() !== '')
  if (references.length > 0) body[IMAGE_URLS_FIELD] = references

  return body
}

/** Parse the `{error, message}` failure envelope the gateway documents. */
function gatewayFailure(status: number, payload: unknown): SeeWorkError {
  const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : undefined
  const code = typeof record?.error === 'string' && record.error !== '' ? record.error : `http_${status}`
  const detail = typeof record?.message === 'string' && record.message !== '' ? record.message : ''
  return new SeeWorkError(friendlyGatewayMessage(status, code, detail), code)
}

/** Turn a gateway error into something a human can act on. */
function friendlyGatewayMessage(status: number, code: string, detail: string): string {
  const suffix = detail === '' ? '' : `：${detail}`
  // #658/D-8: every failure says what happened and stops there; what to do next is
  // the user's call, so the "you may send it again once the user allows it" tail is
  // written once and reused.
  const needsPermission = '请如实告知用户，得到许可后再发'
  switch (code) {
    case 'unknown_field':
    case 'invalid_parameter':
    case 'unsupported_parameter':
    case 'constraint_conflict':
    case 'no_compatible_image_offering':
    case 'invalid_resource':
    case 'invalid_value':
      return `该模型不接受这次请求的参数组合（${code}）${suffix}`
    case 'invalid_json_body':
      return `请求体被网关判为非法 JSON（${code}）${suffix}`
    case 'model_protocol_mismatch':
      return `端点和模型协议不匹配（${code}）${suffix}`
    case 'model_not_found':
      return `模型不存在或未发布${suffix}`
    case 'image_task_in_progress':
      return `该模型已有任务在跑：本次没有发起生成，也没有扣费。${needsPermission}${suffix}`
    default:
      break
  }
  if (status === 401) return `API Key 无效或缺失，请在「设置 → 插件 → SeeWork」重新填写${suffix}`
  if (status === 402) return `余额不足，请先充值${suffix}`
  if (status === 403) return `账户已停用${suffix}`
  if (status === 429) return `触发限流：本次没有发起生成。${needsPermission}${suffix}`
  if (status === 502) return `上游不可达：本次没有交付。${needsPermission}${suffix}`
  if (status === 504) return `上游超时：本次没有交付。${needsPermission}${suffix}`
  if (status === 503) return `当前没有可用的供给：本次没有交付。${needsPermission}${suffix}`
  return `生图失败（HTTP ${status}${code === `http_${status}` ? '' : ` / ${code}`}）${suffix}`
}

/** One JSON POST to the gateway, with the documented error mapping. */
async function postJson(
  upstream: UpstreamConfig,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (upstream.apiUrl.trim() === '') {
    throw new SeeWorkError('尚未配置 API 地址：请在「设置 → 插件 → SeeWork」填写 SeeAI Hub 网关地址。', 'api-url-missing')
  }
  if (upstream.apiKey.trim() === '') {
    throw new SeeWorkError('尚未配置 API Key：请在「设置 → 插件 → SeeWork」填写 SeeAI Hub 用户 API Key。', 'api-key-missing')
  }
  const url = gatewayUrl(upstream.apiUrl, '/images/generations')
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${upstream.apiKey.trim()}`,
      },
      body: JSON.stringify(body),
      signal: composed,
    })
  } catch (error) {
    if (signal?.aborted === true) throw new SeeWorkError('生图已取消。', 'cancelled')
    if (error instanceof SeeWorkError) throw error
    const reason = error instanceof Error ? error.message : String(error)
    const timedOut = timeout.aborted
    throw new SeeWorkError(
      timedOut ? `生图超时（超过 ${REQUEST_TIMEOUT_MS / 1000} 秒）` : `连接网关失败：${reason}`,
      timedOut ? 'timeout' : 'network',
    )
  }
  const text = await response.text()
  let payload: unknown
  try {
    payload = text === '' ? undefined : JSON.parse(text)
  } catch {
    payload = undefined
  }
  if (response.ok) {
    if (typeof payload !== 'object' || payload === null) {
      throw new SeeWorkError('网关返回了非 JSON 的成功响应。', 'bad_response')
    }
    return payload as Record<string, unknown>
  }
  // No retry, deliberately. The gateway allows one in-flight generation per user
  // and model, and releases that lock only when the request ends — and a
  // generation runs for tens of seconds. Re-sending after a couple of seconds
  // would therefore hit the same lock, which is exactly the rule the caller is
  // told not to break. The queue keeps this process from colliding with itself,
  // so a 409 here means somebody else holds the lock; report it and stop.
  throw gatewayFailure(response.status, payload)
}

/** Sniff a data URL's media type, falling back to a declared/assumed one. */
function mediaTypeOf(bytes: Uint8Array, declared: string | undefined): string {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (declared !== undefined && declared.startsWith('image/')) return declared.split(';')[0]!.trim()
  return 'image/png'
}

/** Read an image from `data[]`: a remote URL to download, or inline base64. */
async function readImageItem(item: Record<string, unknown>, signal?: AbortSignal): Promise<GeneratedImage | undefined> {
  const revisedPrompt = typeof item.revised_prompt === 'string'
    ? item.revised_prompt
    : typeof item.revisedPrompt === 'string' ? item.revisedPrompt : undefined
  const b64 = typeof item.b64_json === 'string' && item.b64_json !== '' ? item.b64_json : undefined
  if (b64 !== undefined) {
    // Base64 inflates by 4/3; check before decoding rather than after.
    if (Math.floor(b64.length * 3 / 4) > MAX_IMAGE_BYTES) {
      throw new SeeWorkError(`生成结果超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB，已放弃保存。`, 'image_too_large')
    }
    const bytes = Buffer.from(b64, 'base64')
    if (bytes.byteLength === 0) return undefined
    return {
      b64,
      mime: mediaTypeOf(bytes, undefined),
      ...revisedPrompt === undefined ? {} : { revisedPrompt },
    }
  }
  const url = typeof item.url === 'string' && item.url !== '' ? item.url : undefined
  if (url === undefined) return undefined
  const response = await fetch(url, signal === undefined ? {} : { signal })
  if (!response.ok) {
    throw new SeeWorkError(`下载生成结果失败（HTTP ${response.status}）。`, 'download_failed')
  }
  // Refuse a declared oversize before reading the body at all…
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new SeeWorkError(`生成结果超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB，已放弃下载。`, 'image_too_large')
  }
  const buffer = await readBounded(response, MAX_IMAGE_BYTES)
  if (buffer === undefined) {
    throw new SeeWorkError(`生成结果超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB，已放弃下载。`, 'image_too_large')
  }
  if (buffer.byteLength === 0) throw new SeeWorkError('下载到的图片为空。', 'download_failed')
  return {
    b64: buffer.toString('base64'),
    mime: mediaTypeOf(buffer, response.headers.get('content-type') ?? undefined),
    ...revisedPrompt === undefined ? {} : { revisedPrompt },
  }
}

/**
 * Read a response body, giving up as soon as it exceeds `limit`.
 *
 * A server that lies about (or omits) `content-length` must not be able to make
 * the host allocate an unbounded buffer.
 *
 * @returns the bytes, or undefined when the body exceeded the limit.
 */
async function readBounded(response: Response, limit: number): Promise<Buffer | undefined> {
  if (response.body === null) {
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.byteLength > limit ? undefined : buffer
  }
  const chunks: Buffer[] = []
  let total = 0
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done === true) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => {})
        return undefined
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

/**
 * Run one generation against the gateway.
 * @param upstream - resolved credentials.
 * @param request - the normalized request.
 * @param options - cancellation signal.
 * @returns the generated images plus the charged amount when reported.
 */
export async function generateImage(
  upstream: UpstreamConfig,
  request: GenerateRequest,
  options: { signal?: AbortSignal } = {},
): Promise<{ images: GeneratedImage[]; cost?: number }> {
  const body = buildGenerationBody(request)
  const payload = await postJson(upstream, body, options.signal)
  const data = Array.isArray(payload.data) ? payload.data : []
  if (data.length === 0) {
    throw new SeeWorkError('网关没有返回任何图片数据。', 'empty_result')
  }
  const images: GeneratedImage[] = []
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue
    const image = await readImageItem(item as Record<string, unknown>, options.signal)
    if (image !== undefined) images.push(image)
  }
  if (images.length === 0) {
    throw new SeeWorkError('网关返回的 data[] 里没有可用的图片地址或数据。', 'empty_result')
  }
  const rawCost = payload.cost
  const cost = typeof rawCost === 'number' && Number.isFinite(rawCost) ? rawCost : undefined
  return { images, ...cost === undefined ? {} : { cost } }
}
