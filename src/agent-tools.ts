/**
 * Agent-facing image tools backed by the shared host generation queue.
 *
 * The result shape is the load-bearing part: the model receives a canonical
 * JSON value with durable attachment references (so a follow-up edit call can
 * cite them), while `presentationMeta` carries the same references to the
 * UI, which renders the images beside the tool call. That keeps image
 * generation usable from text-only conversation models and never fabricates a
 * user message.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { defineTool, type ToolResult, type ToolResultView } from '@deepseek-ai/dsh-tools'
import { SKILL_NAME } from './capabilities-skill.ts'
import { SeeWorkError } from './engine.ts'
import { GenerationRuntime } from './generation-runtime.ts'
import { libraryImageLocation } from './library.ts'
import { DEFAULT_ASPECT_RATIO, DEFAULT_OUTPUT_FORMAT, effectiveConfig, modelName, resolveModel, type EffectiveConfig } from './settings.ts'
import type { DroppedParameter, GenerateRequest, GenerationTask } from './protocol.ts'
import { effectiveImageCount, isImageMedia, UNIFIED_ASPECT_RATIOS } from './protocol.ts'

/** How long one agent tool call may stay pending before it gives up waiting. */
const AGENT_WAIT_MS = 300_000

/** Options the agent tool accepts; a subset is resolved per call. */
interface GenerateArgs {
  prompt: string
  model?: string
  resolution?: string
  aspect_ratio?: string
  output_format?: string
  n?: number
  reference_images?: ImageRefArg[]
}

/** One durable image reference as it crosses the tool boundary. */
interface ImageRefArg {
  attachment_id: string
  media_type: string
  bytes: number
  width: number
  height: number
  name?: string
}

/** One image reference in the tool result. */
interface ImageRefResult extends ImageRefArg {
  /** Library file name, when this image was stored in the material library. */
  file?: string
  /** Same-origin URL serving that library file. */
  url?: string
  /** Absolute path of that library file on the host. */
  path?: string
  /**
   * Fully qualified http URL, when the host knows the GUI's port.
   *
   * The conversation card renders inside the tool-call row, and the transcript
   * folds that row away by default — while the assistant's OWN reply is markdown
   * rendered in the transcript body. A markdown image pointing at this URL is
   * therefore how the picture reaches the user without expanding anything.
   */
  absolute_url?: string
}

/**
 * The canonical tool result value.
 *
 * Deliberately carries no task id: SeeAI Hub's image API is synchronous and has
 * no task concept (`docs/api/images.md` — "图片生成只有同步"), so a handle the
 * model could poll would name a capability that does not exist.
 */
interface GenerationResult {
  status: string
  message: string
  error?: string
  images: ImageRefResult[]
  /** Library entry id, so the user can find this generation in the library. */
  library_entry_id?: string
}

/**
 * Shape of one image reference on the tool boundary. The trailing fields are
 * filled in on the way out (where the image lives in the material library) and
 * merely tolerated on the way in: the model is told to hand a previous result
 * back unchanged, so an object that still carries them must keep validating.
 * `restoreRef` reads only the attachment fields and ignores the rest.
 */
const imageRefSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachment_id: { type: 'string', required: true },
    media_type: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    file: { type: 'string' },
    url: { type: 'string' },
    path: { type: 'string' },
    absolute_url: { type: 'string' },
  },
} as const

const generationResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true },
    message: { type: 'string', required: true },
    error: { type: 'string' },
    images: { type: 'array', required: true, items: imageRefSchema },
    library_entry_id: { type: 'string' },
  },
} as const

/**
 * Wording for the tool's regular arguments (#658/D-10).
 *
 * One short sentence per argument: what it does and its default. Nothing about
 * where a value comes from, what its cap is, or where to look it up — every
 * earlier attempt to explain that grew into wording models misread as an
 * instruction to manage queues and retries themselves.
 *
 * The defaults are interpolated from their owner in `src/settings.ts` rather
 * than typed again.
 */
const SHARED_ARG_DESCRIPTION = {
  model: 'Which saved model to use. Defaults to the default model.',
  n: 'How many images this request returns. Default 1 — confirm with the user before requesting more.',
  resolution: 'Resolution tier, e.g. 1K or 2K. Omit to use the default tier the catalog declares for this model.',
  aspect_ratio: `Aspect ratio: ${UNIFIED_ASPECT_RATIOS.join(', ')}. Default ${DEFAULT_ASPECT_RATIO}.`,
  output_format: `png, jpeg or webp. Default ${DEFAULT_OUTPUT_FORMAT}.`,
} as const

/**
 * The one tool's description: a single, self-contained statement (#664).
 *
 * It used to be a paragraph two tools shared word for word, with each tool
 * adding its own first sentence (#658/D-9). Merging them into one tool removed
 * that structure: editing is no longer a second tool, it is this tool **with**
 * `reference_images`, so the sentence that says so lives here in the same
 * paragraph rather than in a second description.
 *
 * The capability boundary is stated here as well as in the announcement (#659):
 * this text is resident with the tool definition and is **not** governed by
 * `announceToAgent`, so it is the only place the honest "these five arguments
 * (plus the optional reference image list) and nothing else" survives once the
 * user switches the announcement off.
 *
 * The **order to load the bundled skill** lives in the sentence before this
 * block (#665): a skill is loaded on demand, so merely mentioning that the
 * details are over there reads as an option the model may never take. The same
 * order is in the announcement, with the same name — the requirement is stated
 * once per carrier, and the tool's copy is the one that survives with the
 * announcement off.
 */
const SHARED_TOOL_DESCRIPTION = '**One call is one generation request and returns synchronously** — there is no task id to poll. **Only one request per model runs at a time, and the plugin neither queues nor retries**: if this call fails, report it to the user and send another only after the user asks for it. **With `reference_images` this call edits those images; without it, it generates from the prompt alone** — the request carries no mode field of its own, so an absent or empty reference list simply means text-to-image. The result carries the image references plus the material-library entry id, and for each image where it lives: `file` (library file name), `url` (same-origin address), `path` (absolute path on this machine) and, when the GUI address is known, `absolute_url` (a fully qualified http URL). The model cannot see the picture itself — quote those fields when the user asks where an image is, and **show the finished picture in your own reply** with a markdown image (`![short description](absolute_url)`), because the images beside the tool call sit in the folded tool-call row while your reply does not.'

/**
 * Wording for the optional `reference_images` argument (#664).
 *
 * This one argument is what makes the single tool both a generator and an
 * editor: SeeAI Hub decides the mode from whether the reference list is
 * non-empty (`docs/api/images.md`), so the wording has to carry both halves —
 * omit it for text-to-image, hand a picture back unchanged to edit it. It is
 * the wording the second tool used to carry, now on this argument.
 */
const REFERENCE_IMAGES_DESCRIPTION = 'Optional. Reference image(s) for this call — a picture already available in this conversation (a user-uploaded attachment, or an image from an earlier SeeWork result). They may be the image being edited, or a reference for subject, style or composition. Omit it (or pass an empty list) and the call is plain text-to-image from `prompt`; pass one or more and the model works from them. Pass each attachment object exactly as you received it — do not reconstruct it.'

// Wording note: the fallback floating button only exists on hosts that offer no
// settings slot, so the message points at the sidebar entry — not at a button most
// users will never see. (This line was once hand-edited inside `lib/index.js`,
// where the next `pnpm build` silently dropped it; change it here instead.)
const NOT_CONFIGURED = '还没有配置 SeeAI Hub：请打开「设置 → 插件 → SeeWork」（侧边栏），填写 API 地址与用户 API Key，检测并保存图片模型。'

/** Throw the actionable failure for a not-yet-usable configuration. */
export function ensureConfigured(config: EffectiveConfig, options: { useAgent?: boolean } = {}): void {
  if (!config.enabled) {
    throw new SeeWorkError('SeeWork 插件已停用，请先在设置里启用。', 'plugin-disabled')
  }
  if (options.useAgent === true && !config.allowAgentGeneration) {
    throw new SeeWorkError('Agent 生图已在设置里关闭。', 'agent-generation-disabled')
  }
  if (config.apiUrl.trim() === '' || config.apiKey.trim() === '') {
    throw new SeeWorkError(NOT_CONFIGURED, 'not-configured')
  }
  if (config.models.length === 0) {
    throw new SeeWorkError(`还没有可用的图片模型。${NOT_CONFIGURED}`, 'no-models-configured')
  }
}

/** Build the normalized request from the tool arguments. */
function toRequest(config: EffectiveConfig, args: GenerateArgs, referenceUrls: string[], refNames: string[]): GenerateRequest {
  const model = resolveModel(config, args.model)
  if (model === undefined) {
    const options = config.models.map(entry => `"${modelName(entry)}"`).join('、')
    throw new SeeWorkError(`没有可用的图片模型。可用模型：${options}。`, 'no-models-configured')
  }
  // Whatever the catalog allows, one request never asks for more than the wire
  // contract's cap — the composition is shared with the normalizer and the
  // announcement, so the tool cannot ask for more than gets sent (#668).
  const n = effectiveImageCount(args.n ?? 1, model.maxImages)
  return {
    mode: referenceUrls.length > 0 ? 'edit' : 'text',
    model: model.id,
    prompt: args.prompt.trim(),
    // `resolution` / `aspectRatio` / `outputFormat` are left empty on purpose:
    // the normalizer fills them from the model's declared default tier and the
    // configured ratio and format (#658/D-13/D-17, #668), so the rule — including
    // "a default this model refuses is omitted, not reported" — lives in exactly
    // one place.
    resolution: args.resolution?.trim() ?? '',
    aspectRatio: args.aspect_ratio?.trim() ?? '',
    outputFormat: args.output_format?.trim() ?? '',
    n,
    imageUrls: referenceUrls,
    ...refNames.length === 0 ? {} : { refNames },
  }
}

/** Media types the attachment store accepts. */
function isImageMediaType(value: string): value is ImageMediaType {
  return isImageMedia(value)
}

/** Restore a durable reference from the model-supplied argument. */
function restoreRef(value: ImageRefArg): ImageAttachmentRef {
  if (!isImageMediaType(value.media_type)) {
    throw new SeeWorkError('reference_images[].media_type 不是受支持的图片类型。', 'bad-reference-image')
  }
  if (!Number.isInteger(value.bytes) || value.bytes < 1
    || !Number.isInteger(value.width) || value.width < 1
    || !Number.isInteger(value.height) || value.height < 1) {
    throw new SeeWorkError('reference_images[] 的元数据不合法。', 'bad-reference-image')
  }
  return {
    attachmentId: value.attachment_id as ImageAttachmentRef['attachmentId'],
    mediaType: value.media_type,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...value.name === undefined ? {} : { name: value.name },
  }
}

/** Project a durable reference onto the tool-boundary shape. */
function projectRef(ref: ImageAttachmentRef): ImageRefResult {
  return {
    attachment_id: String(ref.attachmentId),
    media_type: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...ref.name === undefined ? {} : { name: ref.name },
  }
}

/**
 * Tell the model which arguments never reached the gateway.
 *
 * Silent dropping is the failure worth spending words on: the caller asked for
 * something, a picture came back, and nothing said the request differed from
 * what was asked for. The five regular parameters are the whole vocabulary now,
 * so the only drop left is a value this model does not accept.
 */
function droppedNotice(dropped: DroppedParameter[] | undefined): string {
  if (dropped === undefined || dropped.length === 0) return ''
  const parts = dropped.map(entry => `${entry.field}（${entry.reason}）`)
  return ` 有参数没有发给网关：${parts.join('；')}。`
}

/** The model-facing render: a compact textual status plus the JSON value. */
function renderResult(value: GenerationResult): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/**
 * The GUI's own origin, used to hand the model a fully qualified image URL.
 *
 * The web server binds before this plugin's tools are ever called, so the port
 * is the live one (including an OS-assigned port). A host that reports none
 * leaves the absolute URL out rather than inventing an address — a wrong URL in
 * a reply is worse than a relative one.
 *
 * @param ctx - the host context (its `webServer` service owns the port).
 * @returns `http://127.0.0.1:<port>`, or undefined when no usable port is known.
 */
export function guiOrigin(ctx: unknown): string | undefined {
  const port = (ctx as { webServer?: { port?: unknown } }).webServer?.port
  return typeof port === 'number' && Number.isSafeInteger(port) && port > 0
    ? `http://127.0.0.1:${port}`
    : undefined
}

/**
 * Attach the library location to one result image.
 *
 * The model never receives the pixels, so these strings are the only way it can
 * tell the user where a generated image actually is — and `absolute_url` is the
 * one it can put into its own markdown reply. The paths come from
 * `libraryImageLocation` — the same rule the library writer uses to place the
 * file — so the reported location cannot drift from what landed on disk.
 *
 * @param entryId - the library entry this generation was stored as, if it was.
 * @param image - the projected attachment reference.
 * @param index - 0-based image position inside that entry.
 * @param origin - the GUI origin, when known (see {@link guiOrigin}).
 * @returns the image carrying the location fields, or unchanged without an entry.
 */
export function withLibraryLocation(
  entryId: string | undefined,
  image: ImageRefResult,
  index: number,
  origin?: string,
): ImageRefResult {
  if (entryId === undefined) return image
  const location = libraryImageLocation(entryId, index, image.media_type)
  return {
    ...image,
    ...location,
    ...origin === undefined ? {} : { absolute_url: `${origin}${location.url}` },
  }
}

/**
 * The UI-only projection that keeps images beside the tool call. Returned as
 * plain JSON records (the presentation contract forbids unknown class
 * instances and React nodes).
 */
function presentationMeta(value: GenerationResult): { images: Array<Record<string, string | number>> } {
  return {
    images: value.images.map((image, index) => {
      const record: Record<string, string | number> = {
        attachment_id: image.attachment_id,
        media_type: image.media_type,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
      }
      if (image.name !== undefined) record.name = image.name
      // The conversation card offers 「加到画布」, and a board's card references the
      // library FILE. Sending it here keeps that view from re-parsing its own
      // prose, and the name comes from the writer's own rule so it cannot drift.
      if (value.library_entry_id !== undefined) {
        record.file = libraryImageLocation(value.library_entry_id, index, image.media_type).file
      }
      return record
    }),
  }
}

/** Rehydrate image attachments for the host-computed tool result view. */
function presentResult(_args: unknown, result: ToolResult): ToolResultView | undefined {
  if (result.isError) return undefined
  const meta = result.meta
  if (typeof meta !== 'object' || meta === null) return undefined
  const images = (meta as { images?: unknown }).images
  if (!Array.isArray(images)) return undefined
  const content: Array<{ type: 'image'; attachment: ImageAttachmentRef }> = []
  for (const item of images) {
    if (typeof item !== 'object' || item === null) continue
    const raw = item as Record<string, unknown>
    if (typeof raw.attachment_id !== 'string' || typeof raw.media_type !== 'string') continue
    if (typeof raw.bytes !== 'number' || typeof raw.width !== 'number' || typeof raw.height !== 'number') continue
    try {
      content.push({
        type: 'image',
        attachment: restoreRef({
          attachment_id: raw.attachment_id,
          media_type: raw.media_type,
          bytes: raw.bytes,
          width: raw.width,
          height: raw.height,
          ...typeof raw.name === 'string' ? { name: raw.name } : {},
        }),
      })
    } catch {
      // A malformed stored reference degrades to no preview, never a crash.
    }
  }
  return content.length === 0 ? undefined : { card: 'generic', content }
}

/**
 * Register the plugin's agent tool.
 * @param ctx - host context providing `tools` and `attachments`.
 * @param runtime - the shared generation queue.
 * @param resolveConfig - reads the live settings per call.
 * @returns disposer unregistering the tool.
 */
export function registerAgentImageTools(
  ctx: Context,
  runtime: GenerationRuntime,
  resolveConfig: () => EffectiveConfig,
): () => void {
  /** Persist a task's images as durable attachments (memoized per task). */
  const attachmentCache = new Map<string, Promise<ImageRefResult[]>>()
  /** Bound the cache: the runtime only retains a fixed number of tasks. */
  const ATTACHMENT_CACHE_MAX = 64
  const materialize = (task: GenerationTask): Promise<ImageRefResult[]> => {
    if (task.status !== 'completed') return Promise.resolve([])
    const cached = attachmentCache.get(task.id)
    if (cached !== undefined) return cached
    const images = task.result?.images ?? []
    const pending = ctx.attachments.saveImages(images.map((image, index) => ({
      data: Buffer.from(image.b64, 'base64'),
      mediaType: (isImageMediaType(image.mime) ? image.mime : 'image/png') as ImageMediaType,
      name: `seework-${task.id}-${index + 1}.${image.mime === 'image/jpeg' ? 'jpg' : image.mime.slice('image/'.length)}`,
    }))).then(refs => refs.map(projectRef))
    attachmentCache.set(task.id, pending)
    // Bound the cache: the runtime only retains a fixed number of tasks, so the
    // oldest entries are dropped. Evicting a promise that is still in flight is
    // harmless — whoever awaited it already holds the reference.
    while (attachmentCache.size > ATTACHMENT_CACHE_MAX) {
      const oldest = attachmentCache.keys().next()
      if (oldest.done === true || oldest.value === task.id) break
      attachmentCache.delete(oldest.value)
    }
    void pending.catch(() => {
      if (attachmentCache.get(task.id) === pending) attachmentCache.delete(task.id)
    })
    return pending
  }

  const toResult = async (task: GenerationTask): Promise<GenerationResult> => {
    const origin = guiOrigin(ctx)
    const images = (await materialize(task)).map((image, index) => withLibraryLocation(task.entryId, image, index, origin))
    // The standing conventions (what the fields mean, showing the picture in the
    // reply) are stated once, in the tool descriptions above. This message only
    // reports what happened for *this* call — including the one thing the
    // description cannot promise: whether this host could give an absolute URL
    // at all (no GUI port known means no `absolute_url` on the images).
    const summary = task.status === 'completed'
        ? (origin === undefined
            ? '生成完成：图片已存入素材库。这台宿主没有报出 GUI 端口，所以结果里没有 absolute_url——不要编一个地址，图片就在素材库里。'
            : '生成完成：图片已存入素材库，absolute_url 可直接放进回复正文。')
        : task.status === 'failed'
          ? '生成失败。'
          : task.status === 'cancelled'
            ? '生成已取消。'
            : '生成仍在进行中：这次调用等待超时了，但请求本身没有失败——图片生成完成后会自己进入素材库，在「素材库」里就能看到，不需要再查任务。'
    return {
      status: task.status,
      message: `${summary}${droppedNotice(task.droppedParameters)}`,
      ...task.error === undefined ? {} : { error: task.error },
      images,
      ...task.entryId === undefined ? {} : { library_entry_id: task.entryId },
    }
  }

  const waitFor = (id: string, signal: AbortSignal): Promise<GenerationTask> => {
    const timeout = AbortSignal.timeout(AGENT_WAIT_MS)
    return runtime
      .waitFor(id, AbortSignal.any([signal, timeout]))
      .catch((error: unknown) => {
        // The wait gave up but the request did not: report the live task instead
        // of a bare timeout. Nothing polls it — the image is written into the
        // material library when it finishes, which is where the user finds it.
        if (timeout.aborted) {
          const task = runtime.get(id)
          if (task !== undefined) return task
        }
        throw error
      })
  }

  /** Turn durable references into the data URLs the gateway accepts. */
  const referenceUrls = async (refs: ImageRefArg[] | undefined, signal: AbortSignal): Promise<{ urls: string[]; names: string[] }> => {
    const urls: string[] = []
    const names: string[] = []
    for (const ref of refs ?? []) {
      const stored = await ctx.attachments.readImage(restoreRef(ref), signal)
      urls.push(`data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`)
      names.push(stored.ref.name ?? `参考图 ${names.length + 1}`)
    }
    return { urls, names }
  }

  const disposers = [
    ctx.tools.register(defineTool({
      name: 'generate_image',
      // Tool-level conventions live HERE, not in the system-prompt announcement
      // (design discipline 13): this text is resident with the tool definition
      // and is not governed by `announceToAgent`, so it is the only place these
      // sentences survive once the user turns the announcement off (#651).
      description: `Generate images with SeeAI Hub (SeeWork plugin). **Before generating or editing with this plugin, load the skill \`${SKILL_NAME}\` first.** ${SHARED_TOOL_DESCRIPTION}`,
      parameters: {
        prompt: { type: 'string', required: true, description: 'Detailed image prompt: the picture to generate, or — with `reference_images` — what to change in them.' },
        model: { type: 'string', description: SHARED_ARG_DESCRIPTION.model },
        n: { type: 'integer', description: SHARED_ARG_DESCRIPTION.n },
        resolution: { type: 'string', description: SHARED_ARG_DESCRIPTION.resolution },
        aspect_ratio: { type: 'string', description: SHARED_ARG_DESCRIPTION.aspect_ratio },
        output_format: { type: 'string', description: SHARED_ARG_DESCRIPTION.output_format },
        // Optional on purpose (#664): absent means text-to-image, which is also
        // what the gateway concludes from an empty `image_urls`. Nothing else
        // selects the mode — there is deliberately no `mode` argument.
        reference_images: {
          type: 'array',
          items: imageRefSchema,
          description: REFERENCE_IMAGES_DESCRIPTION,
        },
      },
      output: {
        schema: generationResultSchema,
        render: (_args, value) => renderResult(value),
        presentationMeta: (_args, value) => presentationMeta(value),
      },
      presentResult,
      async execute(args, exec) {
        const config = resolveConfig()
        ensureConfigured(config, { useAgent: true })
        const input = args as GenerateArgs
        // With references the same call is an edit; without them the list is
        // empty and `toRequest` marks the request as text-to-image. The route
        // from "attachment reference" to `image_urls` is unchanged (#664).
        const references = await referenceUrls(input.reference_images, exec.signal)
        const task = runtime.submit(
          toRequest(config, input, references.urls, references.names),
          'agent',
          exec.agent === undefined ? undefined : String(exec.agent.id),
        )
        return toResult(await waitFor(task.id, exec.signal))
      },
    })),
  ]

  return () => {
    for (const dispose of disposers) dispose()
  }
}
