/**
 * Conversation images: show them small, open them big.
 *
 * The transcript renders our images itself (the assistant's markdown reply, and
 * the card we register into the tool row), so this module owns the two things
 * that make them usable rather than obnoxious:
 *
 *  1. **A display cap.** A 1K–4K result is a multi-megabyte picture; rendered at
 *     its natural size one image fills the whole window. Markdown cannot carry a
 *     size, and the shell's own `<img>` is not ours to class, so the cap is a
 *     style rule keyed on the plugin's own URL prefix — it cannot leak onto
 *     anybody else's images, and the card's own thumbnails (which have their own
 *     attribute) keep their own smaller size.
 *  2. **Click to enlarge.** The shell's markdown renders a bare `<img>` with no
 *     link, and our card's link opens a raw tab; instead a plain left click on
 *     one of these images opens an in-app lightbox (Esc or a click outside
 *     closes it). Ctrl/middle click still falls through to the browser, so
 *     "open the original in a tab" stays available.
 *
 * Failure policy matches the rest of the plugin: no slot, no shell hook, nothing
 * here throws — a page without the chat (the home screen) simply never matches.
 */

import { createRoot, type Root } from 'react-dom/client'
import { addToCanvas, canvasAddAvailable, type CanvasAddTarget } from './canvas-add.ts'
import css from './chat-images.module.css'

/** Marker on the card's own thumbnails, which size themselves. */
export const CARD_IMAGE_ATTR = 'data-dsh-seework-card-image'

/** Attribute marking the lightbox host, so anything can find it. */
export const LIGHTBOX_ATTR = 'data-dsh-seework-image-zoom'

/**
 * Images this module sizes and zooms: images the chat nodes render, whose source
 * is one of this plugin's routes. Scoped to the chat, so the material library and
 * the canvas keep their own layout.
 */
export const CHAT_IMAGE_SELECTOR = `[data-chat-anchor-key] img[src*="/api/dsh-seework/"]:not([${CARD_IMAGE_ATTR}])`

/** Same scope, but including the card's thumbnails, for the zoom click. */
const ZOOMABLE_SELECTOR = `[data-chat-anchor-key] img[src*="/api/dsh-seework/"]`

/** Cap on a conversation image's rendered size (the original opens on click). */
const THUMBNAIL_MAX_PX = 320

/** The style rule that keeps a generated picture from taking the whole window. */
export const CHAT_IMAGE_CSS = `${CHAT_IMAGE_SELECTOR} {
  max-width: ${THUMBNAIL_MAX_PX}px;
  max-height: ${THUMBNAIL_MAX_PX}px;
  width: auto;
  height: auto;
  border-radius: 10px;
  cursor: zoom-in;
}
${ZOOMABLE_SELECTOR} {
  cursor: zoom-in;
}
`

/** Is this element one of the conversation images we own? */
function zoomableImage(target: EventTarget | null): HTMLImageElement | undefined {
  if (!(target instanceof Element)) return undefined
  const image = target.closest('img')
  if (image === null || !(image instanceof HTMLImageElement)) return undefined
  return image.matches(ZOOMABLE_SELECTOR) ? image : undefined
}

/** Whether this click should open the lightbox rather than the browser's own. */
function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * The enlarged view: the picture at up to the viewport, closed by a click
 * outside. When the picture is one the plugin can place, it also offers
 * 「加到画布」 — the deliberate, one-click way to put it on a board.
 */
export function ChatImageLightbox(
  { src, onClose, onAddToCanvas }: { src: string; onClose: () => void; onAddToCanvas?: (() => void) | undefined },
): JSX.Element {
  return (
    <div
      className={css.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="查看大图"
      onClick={onClose}
    >
      <img
        className={css.full}
        src={src}
        alt="生成的图片（大图）"
        onClick={event => { event.stopPropagation() }}
      />
      {onAddToCanvas === undefined ? null : (
        <div className={css.actions} onClick={event => { event.stopPropagation() }}>
          <button
            type="button"
            className={css.action}
            data-dsh-seework-add-to-canvas=""
            onClick={onAddToCanvas}
          >
            加到画布
          </button>
        </div>
      )}
    </div>
  )
}

/** One lightbox at a time, mounted on demand. */
let lightbox: { host: HTMLElement; root: Root } | undefined

/**
 * Show one conversation image enlarged.
 * @param src - the image's source (the original, not a thumbnail copy).
 * @param doc - the document to mount into (tests pass their jsdom document).
 * @param target - the library picture behind it, when the plugin can place it.
 */
export function openChatImage(src: string, doc: Document = document, target?: CanvasAddTarget): void {
  closeChatImage()
  const host = doc.createElement('div')
  host.setAttribute(LIGHTBOX_ATTR, '')
  doc.body.appendChild(host)
  const root = createRoot(host)
  lightbox = { host, root }
  const onAdd = target === undefined || !canvasAddAvailable()
    ? undefined
    : () => {
        // Close first: the overlay covers the window, and the point of adding is
        // to see the board it landed on.
        closeChatImage()
        addToCanvas(target)
      }
  root.render(<ChatImageLightbox src={src} onClose={() => { closeChatImage() }} onAddToCanvas={onAdd} />)
}

/** Put the enlarged view away, when there is one. */
export function closeChatImage(): void {
  const current = lightbox
  if (current === undefined) return
  lightbox = undefined
  current.root.unmount()
  current.host.remove()
}

/**
 * Install the cap and the click-to-enlarge behaviour.
 *
 * @param doc - the document to watch (tests pass their jsdom document).
 * @param resolveTarget - turns an image URL into the library picture behind it,
 *   when the plugin can place that picture (see {@link CanvasAddTarget}).
 * @returns disposer removing the style, the listeners, and any open lightbox.
 */
export function installChatImageZoom(
  doc: Document = document,
  resolveTarget?: (src: string) => CanvasAddTarget | undefined,
): () => void {
  const style = doc.createElement('style')
  style.setAttribute('data-dsh-seework', 'chat-image-zoom')
  style.textContent = CHAT_IMAGE_CSS
  doc.head.appendChild(style)

  const onClick = (event: MouseEvent): void => {
    const image = zoomableImage(event.target)
    if (image === undefined || !isPlainLeftClick(event)) return
    // The image sits inside shell chrome (and, in the card, inside a link): take
    // the click before either of them turns it into a page navigation.
    event.preventDefault()
    event.stopPropagation()
    const src = image.currentSrc === '' ? image.src : image.currentSrc
    const target = resolveTarget === undefined ? undefined : resolveTarget(src)
    // The card tells us which library picture its thumbnail shows; a markdown
    // image says it through the URL. Either way the lightbox can offer the action.
    openChatImage(src, doc, target)
  }
  doc.addEventListener('click', onClick, true)

  // Escape closes the enlarged view. Owned here rather than inside the lightbox
  // component: the overlay lives in its own React root, while the plugin's own
  // lifetime is exactly the lifetime of this listener.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeChatImage()
  }
  doc.addEventListener('keydown', onKey)

  return () => {
    doc.removeEventListener('click', onClick, true)
    doc.removeEventListener('keydown', onKey)
    style.remove()
    closeChatImage()
  }
}
