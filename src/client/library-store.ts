/**
 * Browser-side access to the local material library plus the pure view helpers
 * the sidebar filters with.
 *
 * The host serves every entry (metadata + image URLs) from one route, so the
 * sidebar filters locally: that keeps typing in the search box instant and
 * means a filter never costs a round trip.
 */

import type { LibraryEntry, LibraryListResult } from '../protocol.ts'
import { SeeWorkApi } from './api.ts'
import { SnapshotStore } from './snapshot-store.ts'

/** Library state as the sidebar renders it. */
export interface LibraryState {
  status: 'loading' | 'ready' | 'error'
  entries: LibraryEntry[]
  imageCount: number
  dataRoot: string
  /** Human-readable reason when `status` is 'error'. */
  error?: string
}

/** What the sidebar needs from the library. */
export class LibraryStore {
  private readonly store = new SnapshotStore<LibraryState>({
    status: 'loading',
    entries: [],
    imageCount: 0,
    dataRoot: '',
  })
  private inFlight: Promise<void> | undefined

  constructor(private readonly api: SeeWorkApi) {}

  getSnapshot(): LibraryState {
    return this.store.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  /** Re-read the library; concurrent calls share one request. */
  refresh(): Promise<void> {
    if (this.inFlight !== undefined) return this.inFlight
    const pending = this.load().finally(() => {
      if (this.inFlight === pending) this.inFlight = undefined
    })
    this.inFlight = pending
    return pending
  }

  /**
   * Delete one entry and its files.
   * @returns true when the host accepted the deletion.
   */
  async remove(id: string): Promise<boolean> {
    const result = await this.api.removeEntry(id)
    if (!result.ok) {
      this.store.update(draft => {
        draft.status = 'error'
        draft.error = result.message
      })
      return false
    }
    await this.refresh()
    return true
  }

  /** Delete every entry. */
  async clear(): Promise<boolean> {
    const result = await this.api.clearLibrary()
    if (!result.ok) {
      this.store.update(draft => {
        draft.status = 'error'
        draft.error = result.message
      })
      return false
    }
    await this.refresh()
    return true
  }

  private async load(): Promise<void> {
    const result = await this.api.library()
    if (!result.ok) {
      // A failed refresh keeps the entries already on screen: a transient
      // bridge hiccup must not blank the sidebar.
      this.store.update(draft => {
        draft.status = 'error'
        draft.error = result.message
      })
      return
    }
    const value: LibraryListResult = result.value
    this.store.update(draft => {
      draft.status = 'ready'
      draft.entries = value.entries
      draft.imageCount = value.imageCount
      draft.dataRoot = value.dataRoot
      delete draft.error
    })
  }
}

/** What a generation was for, as the filter chips present it. */
export type SourceFilter = 'all' | LibraryEntry['source']

/** One active filter set. */
export interface LibraryFilter {
  /** Free text matched against the prompt. */
  query: string
  /** Model id, or '' for every model. */
  model: string
  source: SourceFilter
  /** Only entries that day, as `YYYY-MM-DD`, or '' for every day. */
  day: string
}

/** The empty filter (everything). */
export const EMPTY_FILTER: LibraryFilter = { query: '', model: '', source: 'all', day: '' }

/** Model ids present in the library, most used first, for the filter menu. */
export function libraryModels(entries: LibraryEntry[]): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.model, (counts.get(entry.model) ?? 0) + 1)
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))
}

/** Apply the sidebar filter (case-insensitive substring match on the prompt). */
export function filterEntries(entries: LibraryEntry[], filter: LibraryFilter): LibraryEntry[] {
  const query = filter.query.trim().toLowerCase()
  return entries.filter(entry => {
    if (filter.model !== '' && entry.model !== filter.model) return false
    if (filter.source !== 'all' && entry.source !== filter.source) return false
    if (filter.day !== '' && dayOf(entry.createdAt) !== filter.day) return false
    if (query !== '' && !entry.prompt.toLowerCase().includes(query)) return false
    return true
  })
}

/** Local calendar day of a timestamp, as `YYYY-MM-DD`. */
export function dayOf(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** One day's entries, for the sidebar's date grouping. */
export interface LibraryDay {
  day: string
  /** Human label: 今天 / 昨天 / the date. */
  label: string
  entries: LibraryEntry[]
}

/** Group entries into day sections, newest first (input order is preserved). */
export function groupByDay(entries: LibraryEntry[], now = Date.now()): LibraryDay[] {
  const today = dayOf(now)
  const yesterday = dayOf(now - 24 * 60 * 60 * 1000)
  const groups = new Map<string, LibraryEntry[]>()
  for (const entry of entries) {
    const day = dayOf(entry.createdAt)
    const bucket = groups.get(day)
    if (bucket === undefined) groups.set(day, [entry])
    else bucket.push(entry)
  }
  return [...groups.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([day, bucket]) => ({
      day,
      label: day === today ? '今天' : day === yesterday ? '昨天' : day,
      entries: bucket,
    }))
}

/** Prompt text clipped to a preview length. */
export function promptPreview(prompt: string, max = 60): string {
  const flat = prompt.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** Total bytes the library occupies, when every image reports a size. */
export function entryCost(entry: LibraryEntry): string | undefined {
  return entry.cost === undefined ? undefined : `¥${entry.cost.toFixed(2)}`
}
