/**
 * SeeWork's image card inside the conversation (the tool-call row).
 *
 * A generated image is deliberately NOT part of the model-visible tool result:
 * the result text stays JSON so text-only conversation models keep working, and
 * the attachment references ride the result's presentation metadata instead.
 * That leaves the row itself generic — a wall of JSON — unless the plugin that
 * owns the tool supplies its own view, which is what this module does.
 *
 * Why the images are fetched here rather than through the shell:
 *
 *  - the shell's `tool.call.images` gallery slot is declared as a child slot by
 *    the built-in `read_image` row and a slot has exactly one owner, so a second
 *    declarer would make the whole client bundle fail to load;
 *  - the shell's session-authorized `loadImage` resolves attachments the session
 *    log references, and a tool result's images are not in it (by design), so it
 *    would refuse them;
 *  - therefore the references come from the persisted `block.meta` and the bytes
 *    from this plugin's own loopback-only attachment route.
 *
 * Failure policy: this view never throws. Anything it cannot read simply does
 * not render, and the shell's flattened result text remains the fallback.
 */

import { useMemo, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ATTACHMENT_API, isImageMedia } from '../protocol.ts'
import { addToCanvas, canvasAddAvailable } from './canvas-add.ts'
import css from './tool-card.module.css'

/** One image record as the host persists it in the tool result's metadata. */
export interface ToolCardImage {
  attachment_id: string
  media_type: string
  bytes: number
  width: number
  height: number
  name?: string
  /** Library file name, when the host sent one (see `presentationMeta`). */
  file?: string
}

/**
 * The frozen call/result node the shell hands a keyed tool view.
 *
 * Spelled here (like this package's other slot contracts) instead of importing
 * the sibling UI package: only the fields this view reads are declared, and
 * every one of them is treated as unvalidated wire data.
 */
export interface ToolCardBlock {
  /** Absent while the call is still running (the shell's running-call shape). */
  kind?: string
  content?: unknown
  meta?: unknown
  isError?: boolean
}

/** Owner payload the shell supplies to a `tool.call.toolview` registration. */
export interface ToolCardProps {
  callId?: string
  toolName?: string
  block?: ToolCardBlock
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Keyed per wire Tool name: a hit REPLACES the shell's generic row with the
     * registered view, which is how SeeWork's results render as picture cards.
     */
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: ToolCardProps }
  }
}

/**
 * Tool names whose results carry images.
 *
 * `get_seework_task` is no longer registered by the host half — SeeAI Hub's image
 * API is synchronous, so the plugin stopped offering a task handle — but this key
 * stays on purpose: results of that name are already persisted in session logs,
 * and dropping the key would turn those historical rows back into raw JSON. Same
 * reasoning as the board still reading cards written before `origin` existed.
 *
 * `edit_image` deliberately does **not** get that treatment (#664): the tool was
 * merged into `generate_image` while this plugin is still in development, and a
 * historical edit row is allowed to fall back to the shell's generic row. Its
 * images are still in the material library, so nothing is lost by not having a
 * bespoke card for it.
 */
export const TOOL_CARD_KEYS = ['generate_image', 'get_seework_task'] as const

/**
 * Priority of these registrations inside the keyed slot.
 *
 * Two plugins can (and on a real machine do) claim the same wire tool name — the
 * reference image plugin registers its own view for `generate_image`. The slot
 * registry refuses a second registration at the SAME priority and fails the
 * whole plugin that lost the race (observed live: the other plugin's loader
 * entry failed with "already has an entry for key generate_image at priority 0 …
 * register at a different priority to shadow it"), so claiming a distinct, lower
 * priority is not a nicety — it is how both plugins stay loadable, and "lowest
 * renders" makes this card the one shown.
 *
 * That is the right winner here: this view reads the images from the result's
 * persisted `meta`, which both plugins emit under the same field names, while a
 * view that reads them out of the result content has nothing to show (tool
 * results are not model-visible content).
 */
const TOOL_CARD_PRIORITY = -10

/** Human-readable state for the result JSON's `status`. */
function statusLabel(status: string): string {
  if (status === 'running' || status === 'queued') return '生成中'
  if (status === 'failed') return '生成失败'
  if (status === 'cancelled') return '已取消'
  return '已生成'
}

/**
 * Card titles. The shell prints the wire tool name above the row, which is not
 * something a user should have to read, so the card says what it did instead.
 * @param toolName - the wire tool name.
 * @returns the display title.
 */
function cardTitle(toolName: string): string {
  if (toolName === 'get_seework_task') return 'SeeWork 生图任务'
  return 'SeeWork 生图'
}

/** Whether the node is a settled result rather than a running call. */
function isSettled(block: ToolCardBlock | undefined): boolean {
  return block !== undefined && typeof block.kind === 'string'
}

/** The result's own JSON text, if the row carries exactly what we wrote. */
function resultText(block: ToolCardBlock | undefined): string {
  if (block === undefined || !Array.isArray(block.content)) return ''
  return block.content
    .flatMap(part => {
      if (typeof part !== 'object' || part === null) return []
      const { type, text } = part as { type?: unknown; text?: unknown }
      return type === 'text' && typeof text === 'string' ? [text] : []
    })
    .join('\n')
}

/** `status` / `message` from that JSON, degrading to the raw text. */
function resultInfo(block: ToolCardBlock | undefined): { status: string; message: string } {
  if (!isSettled(block)) return { status: 'running', message: '正在生成图片…' }
  const text = resultText(block)
  try {
    const parsed = JSON.parse(text) as { status?: unknown; message?: unknown }
    return {
      status: typeof parsed.status === 'string' ? parsed.status : block?.isError === true ? 'failed' : 'completed',
      message: typeof parsed.message === 'string' ? parsed.message : '',
    }
  } catch {
    return { status: block?.isError === true ? 'failed' : 'completed', message: text }
  }
}

/**
 * Narrow the persisted metadata's `images` into references we can request.
 *
 * All-or-nothing per record: a half-valid reference would make the route answer
 * 400 for a picture the row claims to have, so it is dropped instead.
 *
 * @param meta - the result's persisted presentation metadata, of unknown shape.
 * @returns the valid image records, in result order.
 */
export function imagesOf(meta: unknown): ToolCardImage[] {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return []
  const images = (meta as { images?: unknown }).images
  if (!Array.isArray(images)) return []
  const out: ToolCardImage[] = []
  for (const value of images) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const raw = value as Record<string, unknown>
    const { attachment_id: attachmentId, media_type: mediaType, bytes, width, height, name, file } = raw
    if (typeof attachmentId !== 'string' || attachmentId === '') continue
    if (typeof mediaType !== 'string' || !isImageMedia(mediaType)) continue
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1) continue
    if (typeof width !== 'number' || !Number.isSafeInteger(width) || width < 1) continue
    if (typeof height !== 'number' || !Number.isSafeInteger(height) || height < 1) continue
    out.push({
      attachment_id: attachmentId,
      media_type: mediaType,
      bytes,
      width,
      height,
      ...typeof name === 'string' && name !== '' ? { name } : {},
      ...typeof file === 'string' && file !== '' ? { file } : {},
    })
  }
  return out
}

/**
 * Library file names carried by the result's own JSON text.
 *
 * A row recorded before `presentationMeta` included `file` still has the name in
 * its model-facing JSON, and those older rows keep their button this way.
 *
 * @param block - the settled result node.
 * @returns the file names in result order (empty strings where absent).
 */
export function filesFromResultText(block: ToolCardBlock | undefined): string[] {
  try {
    const parsed = JSON.parse(resultText(block)) as { images?: unknown }
    if (!Array.isArray(parsed.images)) return []
    return parsed.images.map(image => {
      const file = typeof image === 'object' && image !== null ? (image as { file?: unknown }).file : undefined
      return typeof file === 'string' ? file : ''
    })
  } catch {
    return []
  }
}

/**
 * The URL that serves one such record back.
 * @param image - one validated image record.
 * @returns the same-origin route URL with the complete reference.
 */
export function imageUrl(image: ToolCardImage): string {
  const query = new URLSearchParams({
    attachment_id: image.attachment_id,
    media_type: image.media_type,
    bytes: String(image.bytes),
    width: String(image.width),
    height: String(image.height),
  })
  return `${ATTACHMENT_API.image}?${query.toString()}`
}

/**
 * The conversation card for one SeeWork image-generating tool call.
 * @param props - the shell's owner payload for this call.
 * @returns the card row.
 */
export function ToolCard(props: ToolCardProps): JSX.Element {
  const block = props.block
  const { status, message } = resultInfo(block)
  const images = useMemo(() => imagesOf(block?.meta), [block?.meta])
  // Older rows carry the library file name only in their model-facing JSON.
  const fallbackFiles = useMemo(() => filesFromResultText(block), [block])
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set())
  const name = props.toolName ?? 'generate_image'

  return (
    <section className={css.root} data-state={status} data-tool={name}>
      <header className={css.header}>
        <strong className={css.title}>{cardTitle(name)}</strong>
        <span className={css.status}>{statusLabel(status)}</span>
      </header>
      {message === '' ? null : <p className={css.message}>{message}</p>}
      {images.length === 0 ? null : (
        <div className={css.images}>
          {images.map((image, index) => {
            const url = imageUrl(image)
            if (broken.has(image.attachment_id)) {
              return <span key={image.attachment_id} className={css.missing}>图片已不可读</span>
            }
            // The board references the library file, so the action needs one; a
            // picture whose entry was pruned has none to offer.
            const file = image.file ?? fallbackFiles[index] ?? ''
            const addable = file !== '' && canvasAddAvailable()
            return (
              <div key={image.attachment_id} className={css.thumb}>
                <a
                  className={css.imageLink}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  title={image.name ?? '打开原图'}
                >
                  <img
                    className={css.image}
                    src={url}
                    alt={image.name ?? '生成的图片'}
                    width={image.width}
                    height={image.height}
                    loading="lazy"
                    data-dsh-seework-card-image=""
                    onError={() => {
                      setBroken(previous => new Set(previous).add(image.attachment_id))
                    }}
                  />
                </a>
                {addable ? (
                  <button
                    type="button"
                    className={css.action}
                    data-dsh-seework-add-to-canvas=""
                    title="把这张图放到画布上"
                    onClick={() => {
                      // Model and prompt come from the library record; the card
                      // only knows what it is showing.
                      addToCanvas({ file, width: image.width, height: image.height })
                    }}
                  >
                    加到画布
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/**
 * Register the card for every image-bearing tool name.
 *
 * The registration is deferred through `slots.inject` because the slot exists
 * only while the shell's tool-presentation package is mounted; a shell that
 * never declares it simply never calls back, leaving the generic row. A refused
 * registration (an occupied key, say) is logged and must not fail the fiber.
 *
 * @param ctx - client root context (services: slots).
 * @returns disposer unregistering the views.
 */
export function registerToolCards(ctx: unknown): () => void {
  const context = ctx as { slots?: { inject?: unknown; register?: unknown } }
  const slots = context.slots
  if (slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    return () => {}
  }
  const disposers: Array<() => void> = []
  const stop = (slots.inject as (name: string, callback: () => void) => () => void).call(slots, 'tool.call.toolview', () => {
    for (const key of TOOL_CARD_KEYS) {
      try {
        disposers.push((slots.register as (options: unknown, component: unknown) => () => void).call(slots, {
          name: 'tool.call.toolview',
          key,
          priority: TOOL_CARD_PRIORITY,
        }, ToolCard as unknown as (props: ToolCardProps) => JSX.Element))
      } catch (error) {
        console.warn(`[dsh-seework] tool card rejected for ${key}:`, error)
      }
    }
  })
  return () => {
    stop()
    for (const dispose of disposers.splice(0)) dispose()
  }
}
