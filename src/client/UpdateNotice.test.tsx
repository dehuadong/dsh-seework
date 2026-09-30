/**
 * @vitest-environment jsdom
 *
 * The boot-time update notice.
 *
 * The rule this file exists to protect: the notice only ever **reports**. It
 * runs one check, it renders nothing when there is nothing to say, and it never
 * installs anything the user did not click.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStart, UpdateStatus } from '../protocol.ts'
import type { SeeWorkApi } from './api.ts'
import { UpdateNotice } from './UpdateNotice.tsx'

/** The envelope shape the API answers with (kept local: the module keeps it private). */
type Envelope<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

/** How long the component waits before its one check — mirrors the module. */
const FIRST_CHECK_MS = 4000

/** A route client answering a canned status. */
function fakeApi(status: Partial<UpdateStatus>, apply: () => Promise<Envelope<UpdateStart>> = async () => ({
  ok: true,
  value: { started: true },
})): { api: SeeWorkApi; statusCalls: () => number; applyCalls: () => number } {
  let statusCalls = 0
  let applyCalls = 0
  const answer: UpdateStatus = {
    current: '0.1.0',
    kind: 'registry',
    updateAvailable: false,
    ...status,
  }
  const api = {
    updateStatus: async () => {
      statusCalls += 1
      return { ok: true, value: answer } as Envelope<UpdateStatus>
    },
    applyUpdate: async () => {
      applyCalls += 1
      return apply()
    },
  } as unknown as SeeWorkApi
  return { api, statusCalls: () => statusCalls, applyCalls: () => applyCalls }
}

/** Let the component's deferred check fire and settle. */
async function settleBootCheck(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(FIRST_CHECK_MS)
    await Promise.resolve()
    await Promise.resolve()
  })
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** The notice element, or null. */
function notice(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-dsh-seework-update-notice]')
}

describe('UpdateNotice', () => {
  it('says nothing until the check has answered', () => {
    const { api } = fakeApi({ updateAvailable: true, latest: '0.2.0' })
    act(() => { root.render(<UpdateNotice api={api} />) })
    // Nothing on screen before the delay elapses: no flash of a notice that
    // might turn out to be wrong.
    expect(notice()).toBeNull()
  })

  it('names the new version once an update is found', async () => {
    const { api, statusCalls } = fakeApi({ updateAvailable: true, latest: '0.2.0' })
    act(() => { root.render(<UpdateNotice api={api} />) })
    await settleBootCheck()
    expect(statusCalls()).toBe(1)
    expect(notice()).not.toBeNull()
    expect(notice()!.textContent).toContain('0.2.0')
    expect(notice()!.textContent).toContain('0.1.0')
  })

  it('stays away when the running version is the newest', async () => {
    const { api } = fakeApi({ updateAvailable: false })
    act(() => { root.render(<UpdateNotice api={api} />) })
    await settleBootCheck()
    expect(notice()).toBeNull()
  })

  it('stays away when the check could not answer at all', async () => {
    const api = {
      updateStatus: async () => ({ ok: false, code: 'unavailable', message: 'no plugin manager' }),
    } as unknown as SeeWorkApi
    act(() => { root.render(<UpdateNotice api={api} />) })
    await settleBootCheck()
    expect(notice()).toBeNull()
  })

  it('goes away when dismissed', async () => {
    const { api } = fakeApi({ updateAvailable: true, latest: '0.2.0' })
    act(() => { root.render(<UpdateNotice api={api} />) })
    await settleBootCheck()
    const dismiss = container.querySelector<HTMLButtonElement>('[data-dsh-seework-update-notice-dismiss]')
    expect(dismiss).not.toBeNull()
    await act(async () => { dismiss!.click(); await Promise.resolve() })
    expect(notice()).toBeNull()
  })

  it('installs only when the update button is clicked', async () => {
    const { api, applyCalls } = fakeApi({ updateAvailable: true, latest: '0.2.0' })
    act(() => { root.render(<UpdateNotice api={api} />) })
    await settleBootCheck()
    // Rendering alone must never install anything.
    expect(applyCalls()).toBe(0)
    const apply = container.querySelector<HTMLButtonElement>('[data-dsh-seework-update-notice-apply]')
    expect(apply).not.toBeNull()
    await act(async () => { apply!.click(); await Promise.resolve() })
    expect(applyCalls()).toBe(1)
    // The install tears this plugin down; the notice does not linger on screen.
    expect(notice()).toBeNull()
  })

  it('renders without an api from the slot', async () => {
    // `shell.overlay` declares no owner props, so a registration-time inject may
    // never reach the component. It must build its own client rather than crash.
    act(() => { root.render(<UpdateNotice />) })
    await settleBootCheck()
    expect(container.querySelector('[data-dsh-seework-update-notice]')).toBeNull()
  })
})
