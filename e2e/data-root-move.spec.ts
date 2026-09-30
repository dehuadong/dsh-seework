import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG_1X1, SELECTORS, callRoute, expect, openCanvas, openFreshBoard, test, uploadPicture } from './support.ts'

/**
 * Changing the material directory moves the library.
 *
 * The old behaviour left the files where they were and simply started reading
 * somewhere else — which reads as "my pictures are gone", and is what the user
 * reported. The move belongs to the host, so this grades the host: the pictures are
 * on disk in the new directory, gone from the old one, and still served.
 *
 * Zero cost: the picture is uploaded from the spec, never generated.
 */

const SETTINGS_MUTATE = '/api/dsh-seework/settings/mutate'
const LIBRARY_LIST = '/api/dsh-seework/library/list'

/** The move report the library list carries while it is worth reporting. */
interface MoveReport {
  id: number
  to: string
  moved: number
  kept: number
  pending: boolean
  error?: string
}

/** Every plugin route answers with this envelope. */
interface Envelope<T> {
  ok: boolean
  value?: T
  message?: string
}

test('换素材目录：图片真的搬过去了，而且还能正常读回来', async ({ app }) => {
  const panel = await openCanvas(app)
  await openFreshBoard(panel)
  await uploadPicture(app, panel, { name: 'shot.png', mimeType: 'image/png', buffer: PNG_1X1 })
  await expect(panel.locator(SELECTORS.card)).toHaveCount(1)

  const card = panel.locator(SELECTORS.card)
  const source = await card.locator('img').getAttribute('src')
  const file = source?.split('/').pop() ?? ''
  const from = (await callRoute<Envelope<{ dataRoot: string }>>(app, LIBRARY_LIST)).value?.dataRoot ?? ''
  const to = path.join(os.tmpdir(), `dsh-seework-e2e-moved-${Date.now()}`)

  try {
    await callRoute(app, SETTINGS_MUTATE, {
      ns: 'dsh-seework', ops: [{ op: 'set', path: ['dataDir'], value: to }],
    })

    // The host reports the move it made — the settings card watches exactly this to
    // say what happened instead of claiming the change already took effect.
    let report: MoveReport | undefined
    await expect.poll(async () => {
      const listing = await callRoute<Envelope<{ dataRootMove?: MoveReport }>>(app, LIBRARY_LIST)
      const seen = listing.value?.dataRootMove
      if (seen === undefined || seen.to !== to || seen.pending) return null
      report = seen
      return seen.to
    }, { timeout: 30_000 }).toBe(to)
    expect(report?.error).toBeUndefined()
    expect(report?.moved ?? 0, '板上那张图应当搬过去了').toBeGreaterThanOrEqual(1)

    // The picture is in the new directory and no longer in the old one. The board
    // document travels with it, which is what keeps it on the board afterwards.
    expect(existsSync(path.join(to, 'canvas', 'assets', file)), `新目录里应当有 ${file}`).toBe(true)
    expect(existsSync(path.join(from, 'canvas', 'assets', file)), '旧目录里不该还留着它').toBe(false)

    // And the host serves it from there. A cache-busting query keeps the browser's
    // immutable copy of the picture out of the answer.
    const status = await app.evaluate(
      async src => (await fetch(`${src as string}?cache-bust=${Date.now()}`)).status,
      source,
    )
    expect(status, '搬完之后这张图还得能读回来').toBe(200)
  } finally {
    // Back to the default: the host moves everything home again, so the rest of the
    // run sees the directory it started with. The throwaway directory is left in
    // place — removing it while the host is still reading it would break the move.
    await callRoute(app, SETTINGS_MUTATE, {
      ns: 'dsh-seework', ops: [{ op: 'unset', path: ['dataDir'] }],
    })
  }
})
