/**
 * Browser-side settings scope for the `dsh-seework` namespace.
 *
 * The shell's own settings transport only serves namespaces it knows, so a
 * third-party plugin re-serves its namespace over its own same-origin,
 * loopback-only HTTP pair (the settings bridge mounted by the host half). This
 * module implements the same read/write contract the shell's scopes expose —
 * serialized writes, revision-fenced mutations, a recovery read after a
 * refusal — over that bridge.
 */

import { SnapshotStore } from './snapshot-store.ts'
import { SETTINGS_API, type ModelConfig } from '../protocol.ts'

/** The fields this plugin's settings card edits. */
export interface SeeWorkConfig {
  allowAgentGeneration?: boolean
  announceToAgent?: boolean
  apiUrl?: string
  /** SeeAI Hub service base used only for the model catalog. */
  serviceUrl?: string
  /** Redacted on the wire: presence comes from the `secrets` sidecar. */
  apiKey?: string
  models?: ModelConfig[]
  defaultModel?: string
  defaultAspectRatio?: string
  outputFormat?: string
  dataDir?: string
}

/** One settings path-op as the bridge consumes it. */
export type SettingsOp = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }

/** Snapshot shape shared with the shell's `SettingsScope` consumers. */
export interface ScopeSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  base: unknown
  user: unknown
  revision: number | undefined
  writable: boolean
}

/** The bound scope plus the secret-presence view the card needs. */
export interface SeeWorkScope {
  getSnapshot(): ScopeSnapshot<SeeWorkConfig>
  subscribe(listener: () => void): () => void
  /** Queue a bridge refresh. */
  load(): Promise<void>
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
  /** Apply several path ops in one revision-fenced call (atomic save). */
  mutateOps(ops: SettingsOp[]): Promise<void>
  /** Whether a stored API key currently exists (the wire never returns it). */
  getSecretSet(field: string): boolean
  subscribeSecrets(listener: () => void): () => void
}

/** Wire shape of one namespace view from the bridge. */
interface BridgeView {
  ns: string
  value: unknown
  base?: unknown
  user?: unknown
  revision: number
  secrets?: Array<{ path: string[]; set: boolean }>
}

/** The bridge response envelope. */
type BridgeEnvelope =
  | { ok: true; value: { namespaces?: BridgeView[]; writable?: boolean } | BridgeView }
  | { ok: false; code: string; message: string }

/** POST one bridge request and decode its envelope. */
async function post(path: string, body: unknown, fetchFn: typeof fetch): Promise<BridgeEnvelope> {
  try {
    const response = await fetchFn(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      return { ok: false, code: 'internal', message: `设置接口返回 HTTP ${response.status}` }
    }
    return await response.json() as BridgeEnvelope
  } catch {
    return { ok: false, code: 'internal', message: '设置接口不可达' }
  }
}

/** The scope implementation over the bridge. */
class BridgeScope implements SeeWorkScope {
  private readonly store: SnapshotStore<ScopeSnapshot<SeeWorkConfig>>
  private readonly secrets: SnapshotStore<Record<string, boolean>>
  private tail: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(private readonly fetchFn: typeof fetch) {
    this.store = new SnapshotStore<ScopeSnapshot<SeeWorkConfig>>({
      status: 'loading',
      value: undefined,
      base: undefined,
      user: undefined,
      revision: undefined,
      writable: false,
    })
    this.secrets = new SnapshotStore<Record<string, boolean>>({})
  }

  getSnapshot(): ScopeSnapshot<SeeWorkConfig> {
    return this.store.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  subscribeSecrets(listener: () => void): () => void {
    return this.secrets.subscribe(listener)
  }

  getSecretSet(field: string): boolean {
    return this.secrets.getSnapshot()[field] === true
  }

  load(): Promise<void> {
    return this.enqueue(() => this.read())
  }

  set(field: string, value: unknown): Promise<void> {
    return this.enqueue(() => this.write([{ op: 'set', path: [field], value }]))
  }

  unset(field: string): Promise<void> {
    return this.enqueue(() => this.write([{ op: 'unset', path: [field] }]))
  }

  mutateOps(ops: SettingsOp[]): Promise<void> {
    return this.enqueue(() => this.write(ops))
  }

  /** Queue one operation behind every earlier one. */
  private enqueue(operation: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const task = this.tail.then(async () => {
      if (this.disposed) return
      await operation()
    })
    this.tail = task.catch(() => {})
    return task
  }

  private async read(): Promise<void> {
    const envelope = await post(SETTINGS_API.describe, {}, this.fetchFn)
    if (this.disposed) return
    if (!envelope.ok) {
      this.store.update(draft => { draft.status = 'unavailable' })
      return
    }
    const { namespaces, writable } = envelope.value as { namespaces?: BridgeView[]; writable?: boolean }
    const view = namespaces?.[0]
    if (view === undefined) {
      this.store.update(draft => {
        draft.status = 'unavailable'
        draft.writable = writable === true
      })
      this.secrets.set({})
      return
    }
    this.accept(view, writable)
  }

  private async write(ops: SettingsOp[]): Promise<void> {
    const revision = this.getSnapshot().revision
    const envelope = await post(SETTINGS_API.mutate, {
      ns: 'dsh-seework',
      ops,
      ...revision === undefined ? {} : { expectedRevision: revision },
    }, this.fetchFn)
    if (this.disposed) return
    if (!envelope.ok) {
      // A refused write (validation or revision conflict) leaves the form to
      // re-read the authoritative document rather than guessing the outcome.
      await this.read()
      return
    }
    this.accept(envelope.value as BridgeView, undefined)
  }

  /** Fold one bridge view into the snapshot and the secret-presence sidecar. */
  private accept(view: BridgeView, writable: boolean | undefined): void {
    this.store.update(draft => {
      draft.revision = view.revision
      draft.base = view.base
      draft.user = view.user
      if (writable !== undefined) draft.writable = writable
      draft.status = 'ready'
      draft.value = view.value as SeeWorkConfig
    })
    const bits: Record<string, boolean> = {}
    for (const secret of view.secrets ?? []) bits[secret.path.join('.')] = secret.set
    this.secrets.set(bits)
  }
}

/**
 * Bind the plugin's settings scope and start its initial read.
 * @param fetchFn - the fetch implementation (the page's own fetch on loopback).
 * @returns the bound scope.
 */
export function bindSeeWorkScope(fetchFn: typeof fetch = fetch): SeeWorkScope {
  const scope = new BridgeScope(fetchFn)
  void scope.load()
  return scope
}
