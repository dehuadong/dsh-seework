/**
 * A frame-wide notice that a newer version has been published.
 *
 * It lives on `shell.overlay` rather than inside the settings card because the
 * card is somewhere the user has to *choose* to go — an update nobody notices is
 * the same as no update at all. The notice only reports: installing stays a
 * deliberate click, on a button that names the version it will install.
 *
 * The check runs once, a few seconds after boot, and never again on its own.
 * There is no polling and no automatic install.
 */

import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '../protocol.ts'
import { SeeWorkApi } from './api.ts'
import css from './update-notice.module.css'

/**
 * Used when the slot does not hand one over.
 *
 * `shell.overlay` declares no owner props, so whether a registration-time
 * `inject` reaches the component depends on the slot's own contract — and a
 * notice that renders but cannot call its route is worse than one that builds
 * its own client. The class is a stateless wrapper around the plugin's route
 * URLs, so a second instance costs nothing.
 */
const ownApi = new SeeWorkApi()

/**
 * Delay before the first (and only) check.
 *
 * Long enough that it never competes with the shell's own boot, short enough
 * that the notice appears while the user is still looking at the window.
 */
const FIRST_CHECK_MS = 4000

/**
 * Render the update notice, or nothing.
 * @param props.api - the plugin route client; the slot may or may not supply it.
 */
export function UpdateNotice({ api }: { api?: SeeWorkApi }): JSX.Element | null {
  const client = api ?? ownApi
  const [status, setStatus] = useState<UpdateStatus | undefined>(undefined)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      void client.updateStatus().then(answer => {
        if (answer.ok) setStatus(answer.value)
      })
    }, FIRST_CHECK_MS)
    return () => { clearTimeout(timer) }
  }, [client])

  const install = useCallback(async (): Promise<void> => {
    setBusy(true)
    await client.applyUpdate()
    setBusy(false)
    // The install unloads this plugin; the notice has done its job either way.
    setDismissed(true)
  }, [client])

  if (dismissed || status?.updateAvailable !== true || status.latest === undefined) return null

  return (
    <div className={css.notice} data-dsh-seework-update-notice="">
      <span className={css.text}>
        SeeWork 有新版本 <strong>{status.latest}</strong>
        <span className={css.current}>（当前 {status.current}）</span>
      </span>
      <button
        type="button"
        className={css.action}
        data-dsh-seework-update-notice-apply=""
        disabled={busy}
        onClick={() => { void install() }}
      >
        {busy ? '更新中…' : '更新'}
      </button>
      <button
        type="button"
        className={css.dismiss}
        data-dsh-seework-update-notice-dismiss=""
        aria-label="关闭"
        onClick={() => { setDismissed(true) }}
      >
        ✕
      </button>
    </div>
  )
}
