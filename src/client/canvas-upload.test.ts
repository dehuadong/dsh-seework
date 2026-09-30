/**
 * @vitest-environment jsdom
 *
 * Upload intake: which files the board takes, and what it hands the host.
 *
 * The picker's `accept` is only what the user sees; this predicate is what
 * decides. And the data URL it produces has to carry a type the host's own
 * parser knows — both are cheap to pin here and neither is visible in a browser
 * until somebody picks a real file.
 */

import { describe, expect, it } from 'vitest'
import { isUploadableImage, readImageDataUrl } from './canvas-upload.ts'

/** A file as a picker reports it. */
function picked(type: string, name: string): { type: string; name: string } {
  return { type, name }
}

describe('isUploadableImage', () => {
  it('takes PNG and JPEG', () => {
    expect(isUploadableImage(picked('image/png', 'shot.png'))).toBe(true)
    expect(isUploadableImage(picked('image/jpeg', 'photo.jpg'))).toBe(true)
    expect(isUploadableImage(picked('image/jpeg', 'photo.jpeg'))).toBe(true)
    // Not a registered media type, but systems do report it.
    expect(isUploadableImage(picked('image/jpg', 'photo.jpg'))).toBe(true)
  })

  it('refuses every other picture format', () => {
    expect(isUploadableImage(picked('image/gif', 'clip.gif'))).toBe(false)
    expect(isUploadableImage(picked('image/webp', 'shot.webp'))).toBe(false)
    expect(isUploadableImage(picked('image/svg+xml', 'logo.svg'))).toBe(false)
    expect(isUploadableImage(picked('application/pdf', 'doc.pdf'))).toBe(false)
  })

  it('falls back to the extension only when the browser reports no type', () => {
    expect(isUploadableImage(picked('', 'shot.PNG'))).toBe(true)
    expect(isUploadableImage(picked('', 'photo.JPEG'))).toBe(true)
    expect(isUploadableImage(picked('', 'clip.gif'))).toBe(false)
    // A type the browser did report is what decides, extension or not: a PNG
    // renamed to something else is not a PNG the board will show.
    expect(isUploadableImage(picked('text/plain', 'shot.png'))).toBe(false)
  })
})

describe('readImageDataUrl', () => {
  it('normalizes the non-standard jpg type to the one the host parses', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpg' })
    expect((await readImageDataUrl(file))?.startsWith('data:image/jpeg;base64,')).toBe(true)
  })

  it('leaves a PNG data URL as it is', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    expect((await readImageDataUrl(file))?.startsWith('data:image/png;base64,')).toBe(true)
  })
})
