/**
 * The SeeWork material library sidebar (phase 2).
 *
 * Everything the user ever generated through this plugin is already on disk and
 * indexed host-side, so this surface is a view over `library/list`: search,
 * filter by model / source / day, group by day, and open a large preview.
 *
 * Mounted at the DOM level (a launcher button plus a left drawer) rather than
 * through a shell slot, for the same reason the settings surface is: a
 * third-party plugin must not depend on shell-private layout.
 */

import { useEffect, useMemo, useState } from 'react'
import type { LibraryEntry } from '../protocol.ts'
import {
  EMPTY_FILTER,
  entryCost,
  filterEntries,
  groupByDay,
  libraryModels,
  promptPreview,
  type LibraryFilter,
  type LibraryState,
  type LibraryStore,
} from './library-store.ts'
import { Button, TextInput } from './controls.tsx'
import { addToCanvas, canvasAddAvailable } from './canvas-add.ts'
import { SourceBadge } from './library-detail.tsx'
import css from './library-panel.module.css'

/** Sidebar props (it owns no lifecycle of its own — the mount point does). */
export interface LibraryPanelProps {
  store: LibraryStore
  /** Close the drawer (the launcher toggles it). */
  onClose: () => void
  /** Open one entry in the large preview. */
  onOpen: (id: string) => void
  /**
   * Hide the 收起 button. In the right sidebar the tab strip's own ✕ closes the
   * surface, so a second close control would be redundant chrome.
   */
  hideClose?: boolean
  /**
   * Render as a right-sidebar tab body: fill the shell's panel instead of
   * floating over the viewport.
   */
  tab?: boolean
}

/** The library drawer body. */
export function LibraryPanel({ store, onClose, onOpen, hideClose = false, tab = false }: LibraryPanelProps): JSX.Element {
  const [tick, setTick] = useState(0)
  useEffect(() => store.subscribe(() => { setTick(value => value + 1) }), [store])
  void tick

  const state: LibraryState = store.getSnapshot()
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_FILTER)
  const [refreshing, setRefreshing] = useState(false)
  /** Whether the plugin can place pictures right now (no canvas face, no button). */
  const addable = canvasAddAvailable()

  const filtered = useMemo(() => filterEntries(state.entries, filter), [state.entries, filter])
  const days = useMemo(() => groupByDay(filtered), [filtered])
  const models = useMemo(() => libraryModels(state.entries), [state.entries])
  const active = filter.query !== '' || filter.model !== '' || filter.source !== 'all' || filter.day !== ''

  const refresh = (): void => {
    setRefreshing(true)
    void store.refresh().finally(() => { setRefreshing(false) })
  }

  return (
    <aside className={tab ? `${css.panel} ${css.tabPanel}` : css.panel} aria-label="SeeWork 素材库">
      <header className={css.header}>
        <div className={css.titleRow}>
          <h2 className={css.title}>SeeWork 素材库</h2>
          <div className={css.headerActions}>
            <Button onClick={refresh} disabled={refreshing} title="重新读取素材库">
              {refreshing ? '刷新中…' : '刷新'}
            </Button>
            {hideClose
              ? null
              : <Button onClick={onClose} title="收起素材库">收起</Button>}
          </div>
        </div>
        <TextInput
          value={filter.query}
          placeholder="搜索提示词…"
          spellCheck={false}
          onChange={event => { setFilter(current => ({ ...current, query: event.target.value })) }}
        />
        <div className={css.filters}>
          <label className={css.filter}>
            <span className={css.filterLabel}>模型</span>
            <select
              className={css.select}
              value={filter.model}
              onChange={event => { setFilter(current => ({ ...current, model: event.target.value })) }}
            >
              <option value="">全部</option>
              {models.map(model => (
                <option key={model.id} value={model.id}>{model.id}（{model.count}）</option>
              ))}
            </select>
          </label>
          <label className={css.filter}>
            <span className={css.filterLabel}>来源</span>
            <select
              className={css.select}
              value={filter.source}
              onChange={event => { setFilter(current => ({ ...current, source: event.target.value as LibraryFilter['source'] })) }}
            >
              <option value="all">全部</option>
              <option value="agent">对话生成</option>
              <option value="panel">面板生成</option>
              <option value="canvas">画布生成</option>
            </select>
          </label>
        </div>
        {filter.day !== ''
          ? (
            <div className={css.activeFilters}>
              <button type="button" className={css.chip} onClick={() => { setFilter(current => ({ ...current, day: '' })) }}>
                只看 {filter.day} ✕
              </button>
            </div>
          )
          : null}
      </header>

      <div className={css.body}>
        {state.status === 'error'
          ? <p className={css.error}>{state.error ?? '素材库读取失败。'}{state.entries.length > 0 ? '（下面是上次读到的内容）' : ''}</p>
          : null}
        {state.status === 'loading' && state.entries.length === 0
          ? <p className={css.muted}>正在读取素材库…</p>
          : null}
        {state.status !== 'loading' && state.entries.length === 0
          ? (
            <div className={css.empty}>
              <p className={css.emptyTitle}>还没有生成过图片</p>
              <p className={css.muted}>在对话里让 Agent 画一张图，成品就会出现在这里。</p>
            </div>
          )
          : null}
        {state.entries.length > 0 && filtered.length === 0
          ? (
            <p className={css.muted}>
              没有符合当前条件的图片。
              <button type="button" className={css.linkButton} onClick={() => { setFilter(EMPTY_FILTER) }}>清除筛选</button>
            </p>
          )
          : null}

        {days.map(day => (
          <section key={day.day} className={css.day}>
            <button
              type="button"
              className={css.dayHeader}
              title={`只看 ${day.day}`}
              onClick={() => { setFilter(current => ({ ...current, day: current.day === day.day ? '' : day.day })) }}
            >
              <span>{day.label}</span>
              <span className={css.dayCount}>{day.entries.length}</span>
            </button>
            <ul className={css.list}>
              {day.entries.map(entry => {
                const first = entry.images[0]
                return (
                <li key={entry.id}>
                  <article className={css.card}>
                    <button
                      type="button"
                      className={css.thumbButton}
                      onClick={() => { onOpen(entry.id) }}
                      title="查看大图"
                    >
                      <img
                        className={css.thumb}
                        src={first?.url ?? ''}
                        alt={promptPreview(entry.prompt, 24)}
                        loading="lazy"
                      />
                      {entry.images.length > 1
                        ? <span className={css.imageCount}>{entry.images.length}</span>
                        : null}
                    </button>
                    <div className={css.cardBody}>
                      <button type="button" className={css.promptButton} onClick={() => { onOpen(entry.id) }}>
                        {promptPreview(entry.prompt)}
                      </button>
                      <div className={css.meta}>
                        <SourceBadge source={entry.source} />
                        <span className={css.metaText}>{entry.model}</span>
                        {entry.cost !== undefined
                          ? <span className={css.metaText}>{entryCost(entry)}</span>
                          : null}
                        <time className={css.metaText} dateTime={new Date(entry.createdAt).toISOString()}>
                          {new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </time>
                        {/* Puts the picture the card shows onto the board, and brings
                            the canvas up so the result is visible. */}
                        {addable && first !== undefined
                          ? (
                            <button
                              type="button"
                              className={css.addButton}
                              data-dsh-seework-add-to-canvas=""
                              title="把这张图放到画布上"
                              onClick={() => {
                                addToCanvas({
                                  file: first.file,
                                  width: first.width,
                                  height: first.height,
                                  model: entry.model,
                                  prompt: entry.prompt,
                                })
                              }}
                            >
                              加到画布
                            </button>
                          )
                          : null}
                      </div>
                    </div>
                  </article>
                </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      <footer className={css.footer}>
        <span>
          {filtered.length === state.entries.length
            ? `${state.entries.length} 次生成 · ${state.imageCount} 张图`
            : `筛出 ${filtered.length} / ${state.entries.length} 次生成`}
        </span>
        {state.dataRoot !== ''
          ? <span className={css.footerPath} title={state.dataRoot}>{state.dataRoot}</span>
          : null}
        {active
          ? <button type="button" className={css.linkButton} onClick={() => { setFilter(EMPTY_FILTER) }}>清除筛选</button>
          : null}
      </footer>
    </aside>
  )
}
