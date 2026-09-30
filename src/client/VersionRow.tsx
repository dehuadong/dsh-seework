/**
 * The version row: what is running, what the registry offers, and the button
 * that installs it.
 *
 * Starting an update unloads this plugin — the profile is re-composed and these
 * routes go away with it — so the request that asked for the install is the last
 * one the old code serves. The row therefore never waits for an outcome: it
 * polls the status route until the running version changes, and reads a failed
 * poll as "still working" rather than as an error, because that failure is
 * exactly what a host in the middle of a reload looks like.
 *
 * The page itself is still running the bundle it booted with, so the last word
 * is always "refresh": the host is on the new version the moment the install
 * lands, the tab is not.
 */

import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '../protocol.ts'
import type { SeeWorkApi } from './api.ts'
import { Button } from './controls.tsx'
import css from './settings-card.module.css'

/** How often the row asks again while an install is running. */
const POLL_MS = 2000

/** How many polls before the row stops waiting and asks for a page refresh. */
const MAX_POLLS = 45

/** Wait one interval. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/** What the row is doing right now. */
type Phase = 'checking' | 'idle' | 'updating' | 'done'

/**
 * Render the settings card's version section.
 * @param props.api - the plugin route client.
 */
export function VersionRow({ api }: { api: SeeWorkApi }): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>('checking')
  const [note, setNote] = useState<string | undefined>(undefined)

  const check = useCallback(async (): Promise<void> => {
    setPhase('checking')
    setNote(undefined)
    const answer = await api.updateStatus()
    if (answer.ok) {
      setStatus(answer.value)
      setNote(answer.value.error)
    } else {
      setNote(answer.message)
    }
    setPhase('idle')
  }, [api])

  useEffect(() => { void check() }, [check])

  const apply = useCallback(async (): Promise<void> => {
    setPhase('updating')
    setNote(undefined)
    const started = await api.applyUpdate()
    if (!started.ok) {
      setNote(started.message)
      setPhase('idle')
      return
    }
    const from = status?.current
    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      await sleep(POLL_MS)
      const answer = await api.updateStatus()
      // A failed poll is the reload in progress, not a failure.
      if (!answer.ok) continue
      if (answer.value.current !== from) {
        setStatus(answer.value)
        setPhase('done')
        return
      }
    }
    // Either the host came back on the same version or it never came back; both
    // leave the tab running a bundle older than the host, so refreshing is the
    // next step either way.
    setPhase('done')
  }, [api, status?.current])

  const local = status?.kind === 'local'

  return (
    <>
      <div className={css.field}>
        <span className={css.label}>当前版本</span>
        <div className={css.dirRow}>
          <span className={css.fixedValue} data-dsh-seework-version="" title={status?.current}>
            {status?.current ?? '…'}
          </span>
          <Button
            variant="outline"
            disabled={phase === 'checking' || phase === 'updating'}
            onClick={() => { void check() }}
          >
            {phase === 'checking' ? '检查中…' : '检查更新'}
          </Button>
        </div>
      </div>

      {local
        ? (
            <p className={css.hint} data-dsh-seework-version-kind="local">
              这是本地目录安装，更新走 <code>pnpm build &amp;&amp; pnpm sync</code>，这里不提供更新。
            </p>
          )
        : phase === 'updating'
          ? <p className={css.hint}>正在更新：宿主重载插件期间界面可能短暂失联，属正常。</p>
          : phase === 'done'
            ? (
                <p className={css.ok} data-dsh-seework-version-state="done">
                  更新已开始。请<strong>重启 DeepSeek Harness</strong> 让新版本生效——桌面客户端没有刷新页面的入口。
                </p>
              )
            : status?.updateAvailable === true && status.latest !== undefined
              ? (
                  <div className={css.row}>
                    <Button variant="primary" onClick={() => { void apply() }}>
                      更新到 {status.latest}
                    </Button>
                  </div>
                )
              : status?.latest !== undefined
                ? <p className={css.muted}>已是最新版本（注册表上是 {status.latest}）。</p>
                : null}

      {note !== undefined ? <p className={css.warn}>{note}</p> : null}
    </>
  )
}
