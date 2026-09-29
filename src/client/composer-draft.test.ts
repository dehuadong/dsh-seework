/**
 * @vitest-environment jsdom
 *
 * 「加入到对话框」: the picture has to reach the composer as a draft attachment,
 * and a composer that refuses it must leave nothing behind.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachmentNameFor,
  composerAvailable,
  sendImageToConversation,
  setComposerFace,
  setComposerProbe,
  type ComposerDrafts,
} from './composer-draft.ts'

/** A conversation service that records what was registered. */
function service(overrides: Partial<ComposerDrafts> = {}): { service: ComposerDrafts; created: Array<{ sessionId: string; files: readonly File[] }>; released: unknown[] } {
  const created: Array<{ sessionId: string; files: readonly File[] }> = []
  const released: unknown[] = []
  return {
    created,
    released,
    service: {
      createDrafts: (sessionId, files) => {
        created.push({ sessionId, files })
        return files.map((_file, index) => ({ id: `draft-${index}` }))
      },
      releaseDraftAttachments: attachments => { released.push(attachments) },
      ...overrides,
    },
  }
}

/** A fetch stub answering one PNG blob. */
function stubFetch(ok = true): void {
  vi.stubGlobal('fetch', async () => new Response(
    ok ? new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) : 'nope',
    { status: ok ? 200 : 404, headers: { 'content-type': 'image/png' } },
  ))
}

afterEach(() => {
  setComposerProbe(undefined)
  setComposerFace(undefined)
  vi.unstubAllGlobals()
})

describe('sendImageToConversation', () => {
  it('registers the picture as a draft and puts it in the composer', async () => {
    stubFetch()
    const fake = service()
    setComposerProbe(() => fake.service)
    const added: string[][] = []
    setComposerFace({ sessionId: 'session-1', input: { addAttachments: ids => { added.push([...ids]); return true } } })
    expect(composerAvailable()).toBe(true)

    await expect(sendImageToConversation({ url: '/api/dsh-seework/library/image/a-0.png', name: 'a-0.png' })).resolves.toBe(true)
    expect(fake.created).toHaveLength(1)
    expect(fake.created[0]!.sessionId).toBe('session-1')
    expect(fake.created[0]!.files[0]!.name).toBe('a-0.png')
    expect(fake.created[0]!.files[0]!.type).toBe('image/png')
    expect(added).toEqual([['draft-0']])
    expect(fake.released).toEqual([])
  })

  it('releases the draft when the composer is busy', async () => {
    stubFetch()
    const fake = service()
    setComposerProbe(() => fake.service)
    setComposerFace({ sessionId: 'session-1', input: { addAttachments: () => false } })

    await expect(sendImageToConversation({ url: '/x.png' })).resolves.toBe(false)
    expect(fake.released).toEqual([[{ id: 'draft-0' }]])
  })

  it('does nothing without a session-scope tab mounted', async () => {
    stubFetch()
    setComposerProbe(() => service().service)
    expect(composerAvailable()).toBe(false)
    await expect(sendImageToConversation({ url: '/x.png' })).resolves.toBe(false)
  })

  it('does nothing without the conversation service', async () => {
    stubFetch()
    setComposerFace({ sessionId: 'session-1', input: { addAttachments: () => true } })
    await expect(sendImageToConversation({ url: '/x.png' })).resolves.toBe(false)
  })

  it('fails quietly when the picture cannot be fetched', async () => {
    stubFetch(false)
    const fake = service()
    setComposerProbe(() => fake.service)
    setComposerFace({ sessionId: 'session-1', input: { addAttachments: () => true } })
    await expect(sendImageToConversation({ url: '/missing.png' })).resolves.toBe(false)
    expect(fake.created).toEqual([])
  })

  it('names the attachment after the file it came from', () => {
    expect(attachmentNameFor('e6762353-2a17-48c2-9c31-99f48680019d-0.png')).toBe('e6762353-2a17-48c2-9c31-99f48680019d-0.png')
    expect(attachmentNameFor('')).toBe('seework-image.png')
  })
})
