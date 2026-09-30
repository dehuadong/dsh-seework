import type { Locator, Page } from '@playwright/test'
import { expect, test } from './support.ts'

/**
 * Putting a local picture on a board.
 *
 * A board's pictures used to come from two places: the material library, and the
 * board's own annotation/crop composites. The user's own file is a third, and
 * the entry is a right-click on the board itself — the picture is placed where
 * the user is looking, not through the toolbar.
 *
 * PNG and JPEG only, and that is a contract rather than a hint: the picker
 * filters, and the check behind it rejects anything else instead of writing it.
 *
 * Zero cost: nothing here generates a picture or touches the developer's own
 * material library — the host runs on its own throwaway `DSH_HOME`.
 */

/** A real 1×1 PNG. The host reads a picture's size out of its container header. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

/** Open the right column's canvas page and return its panel. */
async function openCanvas(app: Page): Promise<Locator> {
  await app.getByRole('button', { name: '打开右侧边栏' }).click()
  const panel = app.locator('[data-sidebar-right-panel]')
  await expect(panel).toHaveAttribute('data-sidebar-right-open', 'true')
  await panel.locator('[data-sidebar-right-guide-entry="seework-canvas"]').click()
  await expect(panel.locator('[data-dsh-seework-canvas-tab]')).toBeVisible()
  return panel
}

/**
 * The ids of the cards on the board.
 *
 * Read before and after an action rather than asserted absolutely: the board is
 * a document in the throwaway `DSH_HOME`, so it already holds whatever earlier
 * runs of this suite put there.
 */
async function cardIds(panel: Locator): Promise<string[]> {
  return panel.locator('[data-seework-card]')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-seework-card') ?? ''))
}

/** Right-click the board, take the upload item, and hand the picker a file. */
async function uploadVia(app: Page, panel: Locator, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await panel.locator('[data-dsh-seework-board]').click({ button: 'right' })
  const menu = panel.locator('[data-dsh-seework-board-menu]')
  await expect(menu).toBeVisible()
  // The native dialog is the real path: the item asks the hidden input to open.
  const chooser = app.waitForEvent('filechooser')
  await menu.getByRole('button', { name: '上传图片素材' }).click()
  await (await chooser).setFiles(file)
}

test('画布上右键：出现菜单，里面有「上传图片素材」', async ({ app }) => {
  const panel = await openCanvas(app)
  await panel.locator('[data-dsh-seework-board]').click({ button: 'right' })

  const menu = panel.locator('[data-dsh-seework-board-menu]')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('button', { name: '上传图片素材' })).toBeVisible()
})

test('上传一张 PNG：板上多一张「上传素材」卡片，图片真的能读回来', async ({ app }) => {
  const panel = await openCanvas(app)
  const before = await cardIds(panel)

  await uploadVia(app, panel, { name: 'shot.png', mimeType: 'image/png', buffer: PNG_1X1 })

  await expect(panel.locator('[data-seework-card]')).toHaveCount(before.length + 1)
  const added = (await cardIds(panel)).filter(id => !before.includes(id))
  expect(added, '上传应当只多一张卡片').toHaveLength(1)

  const card = panel.locator(`[data-seework-card="${added[0]}"]`)
  await expect(card.locator('[data-dsh-seework-card-origin]')).toHaveText('上传素材')
  // It is the board's own asset, and the bytes came back over that route.
  await expect(card.locator('img')).toHaveAttribute('src', /\/api\/dsh-seework\/canvas\/asset\//u)
  await expect.poll(
    async () => card.locator('img').evaluate(node => (node as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0)
})

test('不是 PNG / JPEG 的文件被挡下：只给提示，不落卡片', async ({ app }) => {
  const panel = await openCanvas(app)
  const before = await cardIds(panel)

  await uploadVia(app, panel, { name: 'clip.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a', 'ascii') })

  await expect(panel.getByText(/只支持 PNG \/ JPEG/u)).toBeVisible()
  expect(await cardIds(panel), '被挡下的文件不该产生卡片').toEqual(before)
})
