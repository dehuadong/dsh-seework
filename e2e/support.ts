import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test as base, type Locator, type Page } from '@playwright/test'

/**
 * What the running host left behind: the authenticated URL, and the plugin's own
 * routes' base.
 *
 * The token is minted afresh on every host start and printed only on the host's
 * stdout, so `e2e/host.mjs` records it in `.tmp-e2e/runtime.json` — the one
 * channel that reaches these worker processes.
 */
export interface HostRuntime {
  /** Authenticated URL: opening it exchanges the token for the session cookie. */
  url: string
  /** Authority the cookie is bound to; `localhost` would be rejected with 401. */
  baseUrl: string
  token: string
  /** The throwaway `DSH_HOME` this run owns. */
  home: string
}

const runtimeFile = path.join(
  path.resolve(fileURLToPath(new URL('..', import.meta.url))), '.tmp-e2e', 'runtime.json',
)

/** Read what the host reported, failing with the reason rather than a parse error. */
export function hostRuntime(): HostRuntime {
  let raw: string
  try {
    raw = readFileSync(runtimeFile, 'utf8')
  } catch {
    throw new Error(`没有找到 ${runtimeFile}：E2E 必须先由 e2e/host.mjs 起一个实例，单独跑 spec 不行。`)
  }
  return JSON.parse(raw) as HostRuntime
}

/** One of the plugin's own host routes (all of them are same-origin POST + loopback). */
export async function callRoute<T>(page: Page, route: string, body: unknown = {}): Promise<T> {
  return page.evaluate(async ([route, body]) => {
    const response = await fetch(route as string, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await response.json()
  }, [route, body] as const) as Promise<T>
}

/**
 * The plugin's own DOM anchors, as the client half writes them.
 *
 * The floating settings launcher is deliberately absent: on a shell that accepts
 * the settings nav page the plugin retires it, so asserting on it would fail on
 * the very shell these specs run against.
 */
export const SELECTORS = {
  dock: '[data-dsh-seework-dock]',
  libraryLauncher: '[data-dsh-seework-library-launcher]',
  canvasLauncher: '[data-dsh-seework-canvas-launcher]',
  version: '[data-dsh-seework-version]',
  dataDir: '[data-dsh-seework-datadir]',
  /** The right column's canvas page, its board, and the board's own chrome. */
  canvasTab: '[data-dsh-seework-canvas-tab]',
  canvasBoard: '[data-dsh-seework-board]',
  canvasMenu: '[data-dsh-seework-canvas-menu]',
  canvasZoom: '[data-dsh-seework-canvas-zoom]',
  /** One card, its body (a picture's drag handle), and its origin badge. */
  card: '[data-seework-card]',
  cardBody: '[data-dsh-seework-card-body]',
  cardOrigin: '[data-dsh-seework-card-origin]',
} as const

/** One picture file handed to a file picker. */
export interface PictureFile {
  name: string
  mimeType: string
  buffer: Buffer
}

/** A real 1×1 PNG. The host reads a picture's size out of its container header. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * Open the right column's canvas page and return the panel the board lives in.
 * @param app - an authenticated page.
 * @returns the right column's panel.
 */
export async function openCanvas(app: Page): Promise<Locator> {
  await app.getByRole('button', { name: '打开右侧边栏' }).click()
  const panel = app.locator('[data-sidebar-right-panel]')
  await expect(panel).toHaveAttribute('data-sidebar-right-open', 'true')
  await panel.locator('[data-sidebar-right-guide-entry="seework-canvas"]').click()
  await expect(panel.locator(SELECTORS.canvasTab)).toBeVisible()
  return panel
}

/**
 * The ids of the cards on the board.
 *
 * Read before and after an action rather than asserted absolutely: the board is
 * a document in the throwaway `DSH_HOME`, so it already holds whatever earlier
 * runs of the suite put there.
 *
 * @param panel - the right column's panel.
 * @returns the card ids in DOM order, which is stacking order from lowest up.
 */
export async function canvasCardIds(panel: Locator): Promise<string[]> {
  return panel.locator(SELECTORS.card)
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-seework-card') ?? ''))
}

/**
 * A point on the board that no card (and no open menu) covers.
 *
 * Scanned rather than assumed: the throwaway home keeps the boards of earlier
 * runs, and pictures are placed in the middle of the view, so "the corner is
 * empty" is not something a spec can rely on.
 *
 * @param panel - the right column's panel.
 * @returns a position inside the board element, in its own coordinates.
 */
export async function emptyBoardPoint(panel: Locator): Promise<{ x: number; y: number }> {
  const point = await panel.locator(SELECTORS.canvasBoard).evaluate((surface, selectors) => {
    const box = surface.getBoundingClientRect()
    for (let y = box.bottom - 12; y > box.top + 12; y -= 16) {
      for (let x = box.left + 12; x < box.right - 12; x += 16) {
        const hit = document.elementFromPoint(x, y)
        if (hit === null) continue
        if (hit.closest(selectors.card) !== null) continue
        if (hit.closest(selectors.menu) !== null) continue
        return { x: Math.round(x - box.left), y: Math.round(y - box.top) }
      }
    }
    return undefined
  }, { card: SELECTORS.card, menu: SELECTORS.canvasMenu })
  if (point === undefined) throw new Error('画布上找不到没有被卡片盖住的位置')
  return point
}

/**
 * Right-click the board's own space, and return the menu that opens.
 * @param panel - the right column's panel.
 * @returns the menu locator, already asserted visible.
 */
export async function openCanvasMenu(panel: Locator): Promise<Locator> {
  const menu = panel.locator(SELECTORS.canvasMenu)
  await panel.locator(SELECTORS.canvasBoard).click({ button: 'right', position: await emptyBoardPoint(panel) })
  await expect(menu).toBeVisible()
  return menu
}

/**
 * Start a board with nothing on it.
 *
 * The throwaway home keeps the boards of earlier runs, and every picture lands in
 * the middle of the view — so a spec that worked against "the last card" would be
 * reading a pile of them, and two specs running at once would be editing one
 * board. A fresh board per test is both the isolation and what a user does.
 *
 * @param panel - the right column's panel.
 */
export async function openFreshBoard(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: '画布列表' }).click()
  await panel.getByRole('button', { name: '新建' }).click()
  await expect(panel.locator(SELECTORS.card)).toHaveCount(0)
  // Put the list away again: it is a strip above the board, and these specs want
  // the pane's whole height for the picture.
  await panel.getByRole('button', { name: '收起列表' }).click()
}

/**
 * Put one picture on the board through the board menu's upload item.
 *
 * Only the pick is driven here: the upload lands as a request plus a save, and a
 * file the board refuses lands as nothing at all — so what to wait for is the
 * caller's to say.
 *
 * @param app - an authenticated page.
 * @param panel - the right column's panel.
 * @param file - the picture to hand the picker.
 */
export async function uploadPicture(app: Page, panel: Locator, file: PictureFile): Promise<void> {
  const menu = await openCanvasMenu(panel)
  // The native dialog is the real path: the item asks the hidden input to open.
  const chooser = app.waitForEvent('filechooser')
  await menu.getByRole('button', { name: '上传图片素材' }).click()
  await (await chooser).setFiles(file)
}

/**
 * The shell's own settings entry, in the sidebar.
 *
 * Locale-tolerant because `use.locale` pins zh-CN but a shell that resolves its
 * language from the settings document could still answer in English.
 */
export function settingsTrigger(page: Page): Locator {
  return page.getByRole('button', { name: /^(设置|Settings)$/ })
}

/** Wait until the shell's own chrome is on screen, i.e. React has mounted. */
async function whenShellMounted(page: Page): Promise<void> {
  await settingsTrigger(page).waitFor({ state: 'visible', timeout: 20_000 })
}

/**
 * The modal shell raises over an untouched home, and how to defer each.
 *
 * A brand-new `DSH_HOME` has no credentials and no acknowledgements, so the
 * shell stacks its first-run dialogs in front of everything. Each one's mask
 * covers the whole window, so every click behind it is swallowed — which reads in
 * a failure log as "the element is visible but something else intercepts pointer
 * events". Declining them is what the shell itself offers ("继续", "稍后配置");
 * nothing here is dismissed by reaching into the DOM.
 */
const FIRST_RUN_MODALS = [
  { dialog: '预览版说明', dismiss: '继续' },
  { dialog: '添加一个 API Key 开始使用', dismiss: '稍后配置' },
] as const

/**
 * Defer the first-run dialogs until none is left or the budget runs out.
 *
 * Dismissing one reveals the next, so this repeats. A budget is needed because
 * the API-key prompt renders only after its own credential query settles — check
 * once, right after the shell mounts, and it silently answers "nothing here".
 * It also returns for every fresh browser context, since it reports the absence
 * of a credential rather than an acknowledgement.
 *
 * @param page - an authenticated page.
 * @param waitMs - how long to keep looking for a dialog that has not rendered yet.
 */
async function declineFirstRunModals(page: Page, waitMs = 0): Promise<void> {
  const deadline = Date.now() + waitMs
  for (;;) {
    const found = await firstVisibleModal(page)
    if (found !== undefined) {
      await found.dialog.getByRole('button', { name: found.modal.dismiss, exact: true }).click()
      await found.dialog.waitFor({ state: 'hidden' })
      continue
    }
    if (Date.now() >= deadline) return
    await page.waitForTimeout(150)
  }
}

/** The first known first-run dialog currently on screen, if any. */
async function firstVisibleModal(page: Page): Promise<{ modal: typeof FIRST_RUN_MODALS[number], dialog: Locator } | undefined> {
  for (const modal of FIRST_RUN_MODALS) {
    const dialog = page.getByRole('dialog', { name: modal.dialog })
    if (await dialog.isVisible()) return { modal, dialog }
  }
  return undefined
}

/**
 * Open the settings dialog, with the first-run dialogs out of the way first.
 * @param page - an authenticated page.
 */
export async function openSettings(page: Page): Promise<void> {
  await whenShellMounted(page)
  await declineFirstRunModals(page)
  await settingsTrigger(page).click()
}

export const test = base.extend<{ app: Page }>({
  /**
   * A page already authenticated against this run's host.
   *
   * Going through the token URL rather than a bare `/` is what makes the
   * session: the fence answers `/?token=…` with a 303 that sets an HttpOnly
   * cookie, and every later request — the shell's own API calls included — rides
   * on it. Each test gets a fresh context, so each pays this one navigation.
   *
   * Uncaught page errors fail the test at teardown. The plugin's contract is that
   * it must never take the GUI down with it: a throw during `apply` fails the
   * whole shell boot, and the user sees a dead page rather than a broken plugin.
   */
  app: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const runtime = hostRuntime()
    await page.goto(runtime.url, { waitUntil: 'load' })
    // A dialog left open would swallow the clicks of every spec behind it, and
    // the API-key prompt arrives a beat after the shell does — hence the budget.
    await whenShellMounted(page)
    await declineFirstRunModals(page, 3_000)
    await use(page)
    expect(errors, '页面抛出了未捕获异常').toEqual([])
  },
})

export { expect }
