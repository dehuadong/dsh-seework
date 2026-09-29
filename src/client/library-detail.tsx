/**
 * The large preview for one material-library entry: full-size images with
 * paging, the complete prompt with a copy action, the generation parameters,
 * and the destructive actions.
 *
 * It reads the entry out of the live library state rather than taking a copy,
 * so a refresh or a deletion elsewhere is reflected here instead of showing a
 * stale record.
 */

import type { LibraryEntry } from '../protocol.ts'
import { useEffect, useState } from 'react'
import { addToCanvas, canvasAddAvailable } from './canvas-add.ts'
import { attachmentNameFor, composerAvailable, sendImageToConversation } from './composer-draft.ts'
import { entryCost } from './library-store.ts'
import type { LibraryStore } from './library-store.ts'
import { Button, copyText } from './controls.tsx'
import css from './library-detail.module.css'

/** Human label for where a generation came from. */
export function SourceBadge({ source }: { source: LibraryEntry['source'] }): JSX.Element {
  const label = source === 'agent' ? '对话' : source === 'canvas' ? '画布' : '面板'
  return <span className={`${css.badge} ${source === 'agent' ? css.badgeAgent : source === 'canvas' ? css.badgeCanvas : css.badgePanel}`}>{label}</span>
}

/** Props for the detail overlay. */
export interface LibraryDetailProps {
  store: LibraryStore
  /** Entry to show; the overlay closes itself when the id disappears. */
  entryId: string
  onClose: () => void
}

/** The detail overlay. */
export function LibraryDetail({ store, entryId, onClose }: LibraryDetailProps): JSX.Element | null {
  const [tick, setTick] = useState(0)
  useEffect(() => store.subscribe(() => { setTick(value => value + 1) }), [store])
  void tick
  const [index, setIndex] = useState(0)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const entry = store.getSnapshot().entries.find(candidate => candidate.id === entryId)
  /** Whether the plugin can place pictures right now (no canvas face, no action). */
  const addable = canvasAddAvailable()
  /** Whether a session-scope tab is mounted to hand the picture to (see composer-draft). */
  const toComposer = composerAvailable()
  const [composerState, setComposerState] = useState<'idle' | 'sent' | 'failed'>('idle')

  /** Hand the picture on screen to the conversation composer. */
  const sendCurrentToComposer = async (): Promise<void> => {
    if (image === undefined) return
    const ok = await sendImageToConversation({
      url: image.url,
      name: attachmentNameFor(image.file),
    }).catch(() => false)
    setComposerState(ok ? 'sent' : 'failed')
    setTimeout(() => { setComposerState('idle') }, 2500)
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      if (entry === undefined) return
      if (event.key === 'ArrowRight') setIndex(current => Math.min(entry.images.length - 1, current + 1))
      if (event.key === 'ArrowLeft') setIndex(current => Math.max(0, current - 1))
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [entry, onClose])

  if (entry === undefined) {
    // Deleted while open (here or in another window): nothing left to show.
    return null
  }
  const image = entry.images[Math.min(index, entry.images.length - 1)]

  const copyPrompt = (): void => {
    void copyText(entry.prompt).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1500)
    }).catch(() => { setCopied(false) })
  }

  return (
    <div className={css.overlay} role="dialog" aria-modal="true" aria-label="素材详情">
      <div className={css.sheet}>
        <div className={css.stage}>
          {image !== undefined
            ? (
              <img
                className={css.image}
                src={image.url}
                alt={entry.prompt.slice(0, 40)}
              />
            )
            : <p className={css.muted}>这条记录没有图片。</p>}
          {entry.images.length > 1
            ? (
              <div className={css.pager}>
                <Button
                  onClick={() => { setIndex(current => Math.max(0, current - 1)) }}
                  disabled={index === 0}
                  title="上一张"
                >
                  ←
                </Button>
                <span className={css.pagerText}>{Math.min(index, entry.images.length - 1) + 1} / {entry.images.length}</span>
                <Button
                  onClick={() => { setIndex(current => Math.min(entry.images.length - 1, current + 1)) }}
                  disabled={index >= entry.images.length - 1}
                  title="下一张"
                >
                  →
                </Button>
              </div>
            )
            : null}
        </div>

        <div className={css.side}>
          <div className={css.sideHeader}>
            <SourceBadge source={entry.source} />
            <span className={css.muted}>{new Date(entry.createdAt).toLocaleString('zh-CN')}</span>
            <Button onClick={onClose} title="关闭（Esc）">关闭</Button>
          </div>

          {image !== undefined
            ? (
              <div className={css.stageActions}>
                {addable
                  ? (
                    <Button
                      variant="primary"
                      data-dsh-seework-add-to-canvas=""
                      title="把当前这张图放到画布上"
                      onClick={() => {
                        addToCanvas({
                          file: image.file,
                          width: image.width,
                          height: image.height,
                          model: entry.model,
                          prompt: entry.prompt,
                        })
                      }}
                    >
                      加到画布
                    </Button>
                  )
                  : null}
                {toComposer
                  ? (
                    <Button
                      variant="outline"
                      data-dsh-seework-add-to-composer=""
                      title="把当前这张图放进对话输入框当草稿附件"
                      onClick={() => { void sendCurrentToComposer() }}
                    >
                      加入到对话框
                    </Button>
                  )
                  : null}
                <span className={css.muted}>
                  当前这张 {image.file}
                  {composerState === 'sent' ? ' · 已放进输入框' : ''}
                  {composerState === 'failed' ? ' · 放入输入框失败' : ''}
                </span>
              </div>
            )
            : null}

          <section className={css.block}>
            <div className={css.blockHead}>
              <h3 className={css.blockTitle}>提示词</h3>
              {/* A real button, on its own row: sitting under the text made it
                  read as part of the prompt instead of as the copy control. */}
              <Button
                variant="outline"
                className={css.copyButton}
                onClick={copyPrompt}
                title="复制这段提示词到剪贴板"
                aria-label="复制提示词"
              >
                {copied ? '已复制 ✓' : '复制提示词'}
              </Button>
            </div>
            <pre className={css.prompt}>{entry.prompt}</pre>
          </section>

          <section className={css.block}>
            <h3 className={css.blockTitle}>生成参数</h3>
            <dl className={css.facts}>
              <dt>模型</dt><dd>{entry.model}</dd>
              <dt>档位</dt><dd>{entry.resolution === '' ? '（未指定）' : entry.resolution}</dd>
              <dt>比例</dt><dd>{entry.aspectRatio === '' ? '（未指定）' : entry.aspectRatio}</dd>
              <dt>尺寸</dt><dd>{image === undefined || image.width === undefined || image.height === undefined ? '未知' : `${image.width} × ${image.height} 像素`}</dd>
              <dt>格式</dt><dd>{entry.outputFormat === '' ? '（网关默认）' : entry.outputFormat}</dd>
              <dt>张数</dt><dd>{entry.n}</dd>
              {entry.cost === undefined ? null : <><dt>扣费</dt><dd>{entryCost(entry)}</dd></>}
              {entry.refNames === undefined || entry.refNames.length === 0
                ? null
                : <><dt>参考图</dt><dd>{entry.refNames.join('、')}</dd></>}
            </dl>
          </section>

          <section className={css.block}>
            <h3 className={css.blockTitle}>文件</h3>
            <ul className={css.files}>
              {entry.images.map((item, position) => (
                <li key={item.file}>
                  <a className={css.fileLink} href={item.url} target="_blank" rel="noreferrer">
                    {item.file}
                  </a>
                  <span className={css.muted}>
                    {item.width !== undefined && item.height !== undefined ? `${item.width}×${item.height}` : ''}
                    {' '}
                    {item.mime}
                    {position === Math.min(index, entry.images.length - 1) ? '（当前）' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className={css.block}>
            {confirming
              ? (
                <div className={css.confirm}>
                  <span>删除后图片文件也会从磁盘移除，确定吗？</span>
                  <div className={css.confirmActions}>
                    <Button
                      onClick={() => {
                        void store.remove(entry.id).then(ok => {
                          if (ok) onClose()
                          else setConfirming(false)
                        })
                      }}
                    >
                      确定删除
                    </Button>
                    <Button onClick={() => { setConfirming(false) }}>取消</Button>
                  </div>
                </div>
              )
              : (
                <Button onClick={() => { setConfirming(true) }}>删除这条记录</Button>
              )}
          </section>
        </div>
      </div>
    </div>
  )
}
