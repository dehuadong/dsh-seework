/**
 * The host folder-chooser seam, as the plugin consumes it.
 *
 * The service belongs to DSH (`ctx.directoryPicker`), and the plugin reads it
 * structurally: these tests pin the three capability shapes it has to survive
 * (native, browse, missing) plus the cancellation and abort paths — the parts a
 * live check cannot drive, because a native chooser needs a human in front of the
 * host's screen.
 */

import { describe, expect, it, vi } from 'vitest'
import { directoryPickerStatus, pickDirectory } from './directory-picker.ts'

/** A service whose capability is the given object. */
function service(capability: unknown): unknown {
  return { capability: () => capability }
}

describe('directoryPickerStatus', () => {
  it('reports native when the host drives one OS chooser', () => {
    expect(directoryPickerStatus(service({ kind: 'native', pick: async () => null }))).toEqual({ kind: 'native' })
  })

  it('reports browse for a remote host, with an explanation instead of a button', () => {
    const status = directoryPickerStatus(service({ kind: 'browse', list: async () => ({}) }))
    expect(status.kind).toBe('browse')
    expect(status.message).toContain('dataDir')
  })

  it('reports none when nothing is composed, or the shape is foreign', () => {
    expect(directoryPickerStatus(undefined).kind).toBe('none')
    expect(directoryPickerStatus({}).kind).toBe('none')
    expect(directoryPickerStatus(service({ kind: 'something-new' })).kind).toBe('none')
    // A service that throws while describing itself must not take the card down.
    expect(directoryPickerStatus({ capability: () => { throw new Error('nope') } }).kind).toBe('none')
  })
})

describe('pickDirectory', () => {
  it('returns the chosen absolute path', async () => {
    const pick = vi.fn(async () => '/srv/pictures')
    const outcome = await pickDirectory(service({ kind: 'native', pick }), new AbortController().signal)
    expect(outcome).toEqual({ kind: 'picked', path: '/srv/pictures' })
    expect(pick).toHaveBeenCalledTimes(1)
  })

  it('treats null and blank as a cancellation, not a failure', async () => {
    for (const answer of [null, '', '   ']) {
      const outcome = await pickDirectory(service({ kind: 'native', pick: async () => answer }), new AbortController().signal)
      expect(outcome).toEqual({ kind: 'cancelled' })
    }
  })

  it('refuses a relative path from the host', async () => {
    const outcome = await pickDirectory(service({ kind: 'native', pick: async () => 'pictures' }), new AbortController().signal)
    expect(outcome.kind).toBe('failed')
    expect(outcome.kind === 'failed' && outcome.code).toBe('picker_relative')
  })

  it('explains why it cannot run instead of failing the request', async () => {
    const browse = await pickDirectory(service({ kind: 'browse' }), new AbortController().signal)
    expect(browse.kind === 'failed' && browse.code).toBe('picker_browse')
    const missing = await pickDirectory(undefined, new AbortController().signal)
    expect(missing.kind === 'failed' && missing.code).toBe('picker_none')
  })

  it('passes the caller signal through, so nobody leaves a dialog on the host', async () => {
    const controller = new AbortController()
    const signals: AbortSignal[] = []
    const pick = async (signal: AbortSignal): Promise<string | null> => {
      signals.push(signal)
      controller.abort()
      throw new Error('aborted')
    }
    const outcome = await pickDirectory(service({ kind: 'native', pick }), controller.signal)
    expect(signals[0]).toBe(controller.signal)
    expect(outcome.kind === 'failed' && outcome.code).toBe('picker_aborted')
  })
})
