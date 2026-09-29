/**
 * @vitest-environment jsdom
 *
 * Browser-half tests for the settings bridge scope. The shell's own settings
 * transport cannot serve this namespace, so this scope is the only read/write
 * path the card has — its ordering and secret handling are load-bearing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_API } from '../protocol.ts'
import { bindSeeWorkScope } from './settings-scope.ts'

/** One bridge view as the host serves it (secrets already stripped). */
function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ns: 'dsh-seework',
    schema: {},
    value: { apiUrl: 'http://127.0.0.1:8080/v1', models: [] },
    revision: 3,
    user: { apiUrl: 'http://127.0.0.1:8080/v1' },
    secrets: [{ path: ['apiKey'], set: true }],
    ...overrides,
  }
}

/** A fetch stub that answers the bridge routes. */
function bridgeFetch(responses: Array<{ status?: number; body: unknown }>): { fetch: typeof fetch; calls: Array<{ url: string; body: Record<string, unknown> }> } {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  let index = 0
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
    const next = responses[Math.min(index, responses.length - 1)]!
    index++
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }) as unknown as typeof fetch
  return { fetch: fetchFn, calls }
}

/** Wait for the queued bridge work to settle. */
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

afterEach(() => { vi.unstubAllGlobals() })

describe('settings bridge scope', () => {
  it('reads the namespace and reports the stored secret', async () => {
    const bridge = bridgeFetch([{ body: { ok: true, value: { namespaces: [view()], writable: true } } }])
    const scope = bindSeeWorkScope(bridge.fetch)
    await settle()

    const snapshot = scope.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.revision).toBe(3)
    expect(snapshot.writable).toBe(true)
    expect(snapshot.value?.apiUrl).toBe('http://127.0.0.1:8080/v1')
    expect(scope.getSecretSet('apiKey')).toBe(true)
    expect(bridge.calls[0]!.url).toBe(SETTINGS_API.describe)
  })

  it('writes one field by path and folds the answer back in', async () => {
    const bridge = bridgeFetch([
      { body: { ok: true, value: { namespaces: [view()], writable: true } } },
      { body: { ok: true, value: view({ revision: 4, value: { apiUrl: 'http://other:8080/v1' } }) } },
    ])
    const scope = bindSeeWorkScope(bridge.fetch)
    await settle()

    await scope.set('apiUrl', 'http://other:8080/v1')
    expect(bridge.calls[1]!.url).toBe(SETTINGS_API.mutate)
    expect(bridge.calls[1]!.body).toEqual({
      ns: 'dsh-seework',
      ops: [{ op: 'set', path: ['apiUrl'], value: 'http://other:8080/v1' }],
      // The write is fenced by the revision the scope last read.
      expectedRevision: 3,
    })
    expect(scope.getSnapshot().revision).toBe(4)
  })

  it('sends several path ops in one fenced call (an atomic save)', async () => {
    const bridge = bridgeFetch([
      { body: { ok: true, value: { namespaces: [view()], writable: true } } },
      { body: { ok: true, value: view({ revision: 4 }) } },
    ])
    const scope = bindSeeWorkScope(bridge.fetch)
    await settle()

    await scope.mutateOps([
      { op: 'set', path: ['apiUrl'], value: 'http://other:8080/v1' },
      { op: 'set', path: ['apiKey'], value: 'sk-new' },
    ])
    const ops = bridge.calls[1]!.body.ops as unknown[]
    expect(ops).toHaveLength(2)
  })

  it('re-reads after a refused write instead of guessing the outcome', async () => {
    const bridge = bridgeFetch([
      { body: { ok: true, value: { namespaces: [view()], writable: true } } },
      { status: 409, body: { ok: false, code: 'conflict', message: '设置已被其它位置修改' } },
      { body: { ok: true, value: { namespaces: [view({ revision: 9 })], writable: true } } },
    ])
    const scope = bindSeeWorkScope(bridge.fetch)
    await settle()

    await scope.set('apiUrl', 'http://other:8080/v1')
    expect(bridge.calls).toHaveLength(3)
    expect(bridge.calls[2]!.url).toBe(SETTINGS_API.describe)
    expect(scope.getSnapshot().revision).toBe(9)
  })

  it('reports an unreachable bridge as unavailable instead of throwing', async () => {
    const failing = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const scope = bindSeeWorkScope(failing)
    await settle()
    expect(scope.getSnapshot().status).toBe('unavailable')
  })

  it('notifies subscribers on every change', async () => {
    const bridge = bridgeFetch([
      { body: { ok: true, value: { namespaces: [view()], writable: true } } },
      { body: { ok: true, value: view({ revision: 4, secrets: [{ path: ['apiKey'], set: false }] }) } },
    ])
    const scope = bindSeeWorkScope(bridge.fetch)
    await settle()

    let changes = 0
    scope.subscribe(() => { changes++ })
    scope.subscribeSecrets(() => { changes++ })
    await scope.unset('apiKey')
    expect(changes).toBeGreaterThanOrEqual(2)
    expect(scope.getSecretSet('apiKey')).toBe(false)
  })
})
