/**
 * @vitest-environment jsdom
 *
 * Conversation-image tests: the display cap and click-to-enlarge that make a
 * generated picture readable instead of window-filling.
 *
 * Both behaviours hang off markup this plugin does NOT render (the shell renders
 * the assistant's markdown), so the selector scope is the contract: only images
 * from this plugin's own routes, inside chat nodes, get capped — the library and
 * the canvas keep their own layout.
 */

import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { libraryFileFromUrl, setCanvasAddFace, type CanvasAddTarget } from './canvas-add.ts'
import {
  CARD_IMAGE_ATTR,
  CHAT_IMAGE_CSS,
  LIGHTBOX_ATTR,
  closeChatImage,
  installChatImageZoom,
  openChatImage,
} from './chat-images.tsx'

/** Installers created by the current test, so none of them outlives it. */
const installed: Array<() => void> = []

/** Install one watcher, remembering how to remove it. */
function install(resolveTarget?: (src: string) => CanvasAddTarget | undefined): void {
  installed.push(installChatImageZoom(document, resolveTarget))
}

/** One chat node containing an image, as the shell renders it. */
function chatImage(src: string, options: { card?: boolean } = {}): HTMLImageElement {
  const row = document.createElement('div')
  row.setAttribute('data-chat-anchor-key', 'node:1')
  const image = document.createElement('img')
  image.src = src
  if (options.card === true) image.setAttribute(CARD_IMAGE_ATTR, '')
  row.appendChild(image)
  document.body.appendChild(row)
  return image
}

/** React flushes its work asynchronously, so interactions run inside `act`. */
function click(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
  act(() => { target.dispatchEvent(event) })
  return event
}

/** The overlay, if one is mounted right now. */
function overlay(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${LIGHTBOX_ATTR}]`)
}

afterEach(() => {
  act(() => {
    for (const dispose of installed.splice(0)) dispose()
    closeChatImage()
  })
  document.body.innerHTML = ''
  document.head.querySelectorAll('style[data-dsh-seework]').forEach(node => { node.remove() })
})

/** The overlay's picture source, as the browser resolved it. */
function overlaySrc(): string {
  const src = overlay()?.querySelector('img')?.getAttribute('src') ?? ''
  return new URL(src, 'http://localhost').pathname
}

describe('installChatImageZoom', () => {
  it('caps the rendered size of plugin images inside a chat node', () => {
    install()
    const style = document.head.querySelector('style[data-dsh-seework]')
    expect(style?.textContent).toBe(CHAT_IMAGE_CSS)
    // The cap has to be keyed on our own URL prefix and scoped to the chat: a
    // rule that caught the library or the canvas would break their layouts.
    expect(CHAT_IMAGE_CSS).toContain('data-chat-anchor-key')
    expect(CHAT_IMAGE_CSS).toContain('/api/dsh-seework/')
    expect(CHAT_IMAGE_CSS).toContain('max-width: 320px')
    // Our card's thumbnails size themselves.
    expect(CHAT_IMAGE_CSS).toContain(CARD_IMAGE_ATTR)
  })

  it('opens the original in a lightbox on a plain click', () => {
    install()
    const image = chatImage('/api/dsh-seework/library/image/entry-1-0.png')
    const event = click(image)
    expect(event.defaultPrevented).toBe(true)
    expect(overlay()).not.toBeNull()
    expect(overlaySrc()).toBe('/api/dsh-seework/library/image/entry-1-0.png')
    expect(overlay()?.querySelector('img')?.getAttribute('alt')).toBeTruthy()
  })

  it('leaves clicks the user aimed at the browser alone', () => {
    install()
    const image = chatImage('/api/dsh-seework/library/image/entry-1-0.png')
    // Ctrl/middle click means "open in a new tab"; the shell's link must win.
    expect(click(image, { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(click(image, { button: 1 }).defaultPrevented).toBe(false)
    expect(overlay()).toBeNull()
  })

  it('ignores other people’s images and anything outside a chat node', () => {
    install()
    expect(click(chatImage('https://example.test/photo.png')).defaultPrevented).toBe(false)
    const loose = document.createElement('img')
    loose.src = '/api/dsh-seework/library/image/entry-1-0.png'
    document.body.appendChild(loose)
    expect(click(loose).defaultPrevented).toBe(false)
    expect(overlay()).toBeNull()
  })

  it('closes with Escape and by clicking outside the picture', () => {
    install()
    const image = chatImage('/api/dsh-seework/library/image/entry-1-0.png')
    click(image)
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(overlay()).toBeNull()

    click(image)
    // A click on the picture itself must not close it; one on the backdrop does.
    click(overlay()!.querySelector('img')!)
    expect(overlay()).not.toBeNull()
    click(overlay()!.querySelector('[role="dialog"]')!)
    expect(overlay()).toBeNull()
  })

  it('only ever keeps one lightbox around', () => {
    install()
    const first = chatImage('/api/dsh-seework/library/image/entry-1-0.png')
    const second = chatImage('/api/dsh-seework/library/image/entry-2-0.png')
    click(first)
    click(second)
    const overlays = document.querySelectorAll(`[${LIGHTBOX_ATTR}]`)
    expect(overlays).toHaveLength(1)
    expect(overlaySrc()).toBe('/api/dsh-seework/library/image/entry-2-0.png')
  })

  it('removes its style, its listener and any open lightbox on dispose', () => {
    install()
    const image = chatImage('/api/dsh-seework/library/image/entry-1-0.png')
    click(image)
    act(() => { openChatImage('/api/dsh-seework/library/image/entry-1-0.png', document) })
    const dispose = installed.pop()!
    act(() => { dispose() })
    expect(document.head.querySelector('style[data-dsh-seework]')).toBeNull()
    expect(overlay()).toBeNull()
    expect(click(image).defaultPrevented).toBe(false)
  })
})

describe('the lightbox’s 「加到画布」 action', () => {
  const added: string[] = []

  beforeEach(() => {
    added.splice(0)
    setCanvasAddFace({ add: async target => { added.push(target.file); return true } })
  })

  afterEach(() => {
    setCanvasAddFace(undefined)
  })

  it('offers the action for a picture the plugin can place, and adds it after closing', () => {
    install(src => {
      const file = libraryFileFromUrl(src)
      return file === undefined ? undefined : { file }
    })
    click(chatImage('/api/dsh-seework/library/image/entry-1-0.png'))
    const button = overlay()!.querySelector<HTMLButtonElement>('[data-dsh-seework-add-to-canvas]')!
    act(() => { button.click() })
    // The overlay covers the window, so it closes first: the point of adding is
    // to see the board the picture landed on.
    expect(overlay()).toBeNull()
    expect(added).toEqual(['entry-1-0.png'])
  })

  it('omits the action for an image it cannot place', () => {
    install(() => undefined)
    click(chatImage('/api/dsh-seework/attachment/image?attachment_id=x'))
    expect(overlay()).not.toBeNull()
    expect(overlay()!.querySelector('[data-dsh-seework-add-to-canvas]')).toBeNull()
  })

  it('omits the action when there is no canvas face at all', () => {
    setCanvasAddFace(undefined)
    install(src => ({ file: libraryFileFromUrl(src) ?? 'x.png' }))
    click(chatImage('/api/dsh-seework/library/image/entry-1-0.png'))
    expect(overlay()!.querySelector('[data-dsh-seework-add-to-canvas]')).toBeNull()
  })
})
