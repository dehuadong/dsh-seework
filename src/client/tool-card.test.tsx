/**
 * @vitest-environment jsdom
 *
 * Conversation-card tests: the row a SeeWork image tool call renders as inside
 * the conversation.
 *
 * The card is the only place a user sees a generated picture without opening the
 * library, and the references it draws from are unvalidated wire data, so these
 * tests pin both halves: what it accepts out of the persisted metadata, and what
 * it actually renders for each call state.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ATTACHMENT_API } from '../protocol.ts'
import { setCanvasAddFace } from './canvas-add.ts'
import { TOOL_CARD_KEYS, ToolCard, imageUrl, imagesOf, registerToolCards } from './tool-card.tsx'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

/** One well-formed image record as the host persists it. */
function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attachment_id: 'sha256:abc',
    media_type: 'image/png',
    bytes: 1574094,
    width: 1024,
    height: 1024,
    name: 'seework-task-1.png',
    ...overrides,
  }
}

/** A settled result block carrying our JSON text and the persisted metadata. */
function settled(images: unknown[]): Record<string, unknown> {
  return {
    kind: 'tool-result',
    content: [{ type: 'text', text: JSON.stringify({ status: 'completed', message: '生成完成。' }) }],
    meta: { images },
  }
}

describe('imagesOf', () => {
  it('keeps well-formed records in order', () => {
    const images = imagesOf({ images: [record(), record({ attachment_id: 'sha256:def' })] })
    expect(images.map(image => image.attachment_id)).toEqual(['sha256:abc', 'sha256:def'])
  })

  it('drops anything it cannot request, rather than rendering a broken picture', () => {
    // A route request needs every field; a half-valid record would answer 400
    // for a picture the row claims to have.
    expect(imagesOf({ images: [record({ bytes: 0 })] })).toEqual([])
    expect(imagesOf({ images: [record({ media_type: 'image/tiff' })] })).toEqual([])
    expect(imagesOf({ images: [record({ attachment_id: '' })] })).toEqual([])
    expect(imagesOf({ images: [record({ width: '1024' })] })).toEqual([])
    expect(imagesOf(undefined)).toEqual([])
    expect(imagesOf({ images: 'nope' })).toEqual([])
  })
})

describe('imageUrl', () => {
  it('carries the complete reference to the plugin route', () => {
    const [image] = imagesOf({ images: [record()] })
    const url = new URL(imageUrl(image!), 'http://127.0.0.1:3080')
    expect(url.pathname).toBe(ATTACHMENT_API.image)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      attachment_id: 'sha256:abc',
      media_type: 'image/png',
      bytes: '1574094',
      width: '1024',
      height: '1024',
    })
  })
})

describe('ToolCard', () => {
  const render = (props: Parameters<typeof ToolCard>[0]): void => {
    act(() => { root.render(<ToolCard {...props} />) })
  }

  it('shows one picture per recorded image', () => {
    render({ toolName: 'generate_image', block: settled([record(), record({ attachment_id: 'sha256:def' })]) })
    const images = [...container.querySelectorAll('img')]
    expect(images).toHaveLength(2)
    expect(images[0]!.getAttribute('src')).toContain('attachment_id=sha256%3Aabc')
    expect(images[0]!.getAttribute('alt')).toBe('seework-task-1.png')
    // Clicking a thumbnail opens the original.
    expect(container.querySelector('a')?.getAttribute('href')).toContain(ATTACHMENT_API.image)
    expect(container.textContent).toContain('已生成')
    expect(container.textContent).toContain('SeeWork 生图')
    expect(container.textContent).toContain('生成完成。')
    // The wire tool name stays on the row as a DOM fact (dispatch and tests).
    expect(container.querySelector('section')?.dataset.tool).toBe('generate_image')
  })

  it('reports a running call as generating, with nothing to show yet', () => {
    render({ toolName: 'generate_image', block: {} })
    expect(container.textContent).toContain('生成中')
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('reports a failed call and keeps the refusal text', () => {
    render({
      toolName: 'generate_image',
      block: {
        kind: 'tool-result',
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ status: 'failed', message: '生成失败。' }) }],
      },
    })
    expect(container.textContent).toContain('生成失败')
    expect(container.querySelector('section')?.dataset.state).toBe('failed')
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('renders a metadata-free result without inventing pictures', () => {
    render({
      toolName: 'get_seework_task',
      block: { kind: 'tool-result', content: [{ type: 'text', text: '{"status":"queued","message":"排队中"}' }] },
    })
    expect(container.textContent).toContain('生成中')
    expect(container.textContent).toContain('排队中')
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })
})

describe('the card’s 「加到画布」 button', () => {
  const render = (props: Parameters<typeof ToolCard>[0]): void => {
    act(() => { root.render(<ToolCard {...props} />) })
  }
  const added: Array<{ file: string }> = []

  beforeEach(() => {
    added.splice(0)
    setCanvasAddFace({ add: async target => { added.push({ file: target.file }); return true } })
  })

  afterEach(() => {
    setCanvasAddFace(undefined)
  })

  it('adds exactly the picture the button belongs to', () => {
    render({
      toolName: 'generate_image',
      block: settled([record({ file: 'entry-1-0.png' }), record({ attachment_id: 'sha256:def', file: 'entry-1-1.png' })]),
    })
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-dsh-seework-add-to-canvas]')]
    expect(buttons).toHaveLength(2)
    act(() => { buttons[1]!.click() })
    expect(added).toEqual([{ file: 'entry-1-1.png' }])
  })

  it('takes the file name from the result text when the metadata has none', () => {
    // Rows recorded before the metadata carried `file` keep their button.
    render({
      toolName: 'generate_image',
      block: {
        kind: 'tool-result',
        meta: { images: [record()] },
        content: [{ type: 'text', text: JSON.stringify({ status: 'completed', images: [{ file: 'old-0.png' }] }) }],
      },
    })
    const button = container.querySelector<HTMLButtonElement>('[data-dsh-seework-add-to-canvas]')!
    act(() => { button.click() })
    expect(added).toEqual([{ file: 'old-0.png' }])
  })

  it('offers nothing when there is no canvas to add to', () => {
    setCanvasAddFace(undefined)
    render({ toolName: 'generate_image', block: settled([record({ file: 'entry-1-0.png' })]) })
    expect(container.querySelectorAll('[data-dsh-seework-add-to-canvas]')).toHaveLength(0)
  })

  it('offers nothing for a picture with no library file', () => {
    render({ toolName: 'generate_image', block: settled([record()]) })
    expect(container.querySelectorAll('[data-dsh-seework-add-to-canvas]')).toHaveLength(0)
  })
})

describe('registerToolCards', () => {
  /** A stand-in slots service that records what was registered. */
  function fakeSlots(): { registered: Array<{ name: string; key?: string; priority?: number }>; inject: unknown; register: unknown } {
    const registered: Array<{ name: string; key?: string; priority?: number }> = []
    return {
      registered,
      inject: (_name: string, callback: () => void) => { callback(); return () => {} },
      register: (options: { name: string; key?: string; priority?: number }) => {
        registered.push(options)
        return () => {}
      },
    }
  }

  it('registers one view per image-bearing tool name', () => {
    const slots = fakeSlots()
    const dispose = registerToolCards({ slots })
    expect(slots.registered.map(entry => entry.key)).toEqual([...TOOL_CARD_KEYS])
    expect(slots.registered.every(entry => entry.name === 'tool.call.toolview')).toBe(true)
    dispose()
  })

  it('no longer claims the retired `edit_image` key (#664 / AC-4)', () => {
    // The tool was merged into `generate_image` during development, and the user
    // decided historical edit rows need no bespoke card — so the key is simply
    // gone, unlike `get_seework_task` (whose historical rows the plugin keeps
    // rendering).
    expect(TOOL_CARD_KEYS).not.toContain('edit_image')
    expect(TOOL_CARD_KEYS).toContain('generate_image')
    const slots = fakeSlots()
    const dispose = registerToolCards({ slots })
    expect(slots.registered.map(entry => entry.key)).not.toContain('edit_image')
    dispose()
  })

  it('claims a distinct priority, so another plugin on the same tool name still loads', () => {
    // Same key at the same priority makes the slot registry reject the loser AND
    // fail that plugin's whole loader entry (seen live against the reference
    // image plugin, which registers `generate_image` too). A lower
    // priority both avoids that and wins the render.
    const slots = fakeSlots()
    registerToolCards({ slots })
    const priorities = new Set(slots.registered.map(entry => entry.priority))
    expect(priorities.size).toBe(1)
    expect([...priorities][0]).toBeLessThan(0)
  })

  it('stays quiet on a shell without the slot service', () => {
    expect(() => registerToolCards({})()).not.toThrow()
  })
})
