import type { Locator } from '@playwright/test'
import { PNG_1X1, SELECTORS, expect, openCanvas, openFreshBoard, test, uploadPicture } from './support.ts'

/**
 * The board's pointer gestures on a picture.
 *
 * Three of them, each about the picture the user is pointing at: look at it
 * closely (double-click), move it (press anywhere on it), and find its file
 * (right-click). All three are things a board is expected to do with a picture,
 * and none of them was possible before — the picture could only be moved by its
 * title bar, seen at card size, and located by reading a path in the library.
 *
 * Zero cost: the pictures here are uploaded from the spec, never generated.
 */

/** Open the canvas page on a fresh board holding one uploaded picture. */
async function boardWithPicture(app: Parameters<typeof openCanvas>[0]): Promise<{ panel: Locator; card: Locator }> {
  const panel = await openCanvas(app)
  await openFreshBoard(panel)
  await uploadPicture(app, panel, { name: 'shot.png', mimeType: 'image/png', buffer: PNG_1X1 })
  // The upload lands as a request plus a save, so the picture is not on the board
  // the moment the picker closes — and everything below acts on it.
  await expect(panel.locator(SELECTORS.card)).toHaveCount(1)
  return { panel, card: panel.locator(SELECTORS.card) }
}

test('双击图片：放大查看，Esc 收起', async ({ app }) => {
  const { panel, card } = await boardWithPicture(app)
  const cardBox = await card.boundingBox()

  const zoom = panel.locator(SELECTORS.canvasZoom)
  await expect(zoom).toHaveCount(0)

  await card.locator(SELECTORS.cardBody).dblclick()
  await expect(zoom).toBeVisible()

  // The board's own asset, shown enlarged rather than at card size.
  const shown = zoom.locator('img')
  await expect(shown).toHaveAttribute('src', /\/api\/dsh-seework\/canvas\/asset\//u)
  await expect.poll(async () => (await shown.boundingBox())?.width ?? 0)
    .toBeGreaterThan(cardBox?.width ?? 0)

  // Bounded like the annotation editor's panel, not stretched to the pane: the
  // canvas pane itself can be pulled out to the whole window.
  const frame = await zoom.locator('[data-dsh-seework-canvas-zoom-panel]').boundingBox()
  expect(frame?.width ?? 0).toBeLessThanOrEqual(1000)

  await app.keyboard.press('Escape')
  await expect(zoom).toHaveCount(0)
})

test('左键按住图片主体就能拖动，光标是手形', async ({ app }) => {
  const { card } = await boardWithPicture(app)
  const body = card.locator(SELECTORS.cardBody)

  // The hand cursor is what tells the user the picture itself is the handle.
  await expect(body).toHaveCSS('cursor', 'grab')

  const before = await card.boundingBox()
  const grip = await body.boundingBox()
  if (before === null || grip === null) throw new Error('卡片还没有布局')
  const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }

  // A real press-move-release, the way a hand does it.
  await app.mouse.move(from.x, from.y)
  await app.mouse.down()
  await app.mouse.move(from.x + 70, from.y + 45, { steps: 10 })
  await app.mouse.up()

  const after = await card.boundingBox()
  expect(Math.round((after?.x ?? 0) - before.x), '卡片应当跟着指针向右').toBeGreaterThan(30)
  expect(Math.round((after?.y ?? 0) - before.y), '卡片应当跟着指针向下').toBeGreaterThan(15)
})

test('图片上右键：菜单是这张图的动作，不是板面的', async ({ app }) => {
  const { panel, card } = await boardWithPicture(app)

  await card.click({ button: 'right' })
  const menu = panel.locator(SELECTORS.canvasMenu)
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('button', { name: '打开文件所在位置' })).toBeVisible()
  // The two scopes stay distinct: the board's own item belongs to its space.
  await expect(menu.getByRole('button', { name: '上传图片素材' })).toHaveCount(0)
})

test('点「打开文件所在位置」：请宿主去定位那张图', async ({ app }) => {
  const { panel, card } = await boardWithPicture(app)
  const file = (await card.locator('img').getAttribute('src'))?.split('/').pop() ?? ''

  // The route is answered here, not by the host: this suite must not pop a
  // file-manager window on the machine running it. What is graded is the request
  // the page makes — the host half's own side is covered by unit tests.
  const seen: unknown[] = []
  await app.route('**/api/dsh-seework/image/reveal', async route => {
    seen.push(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, value: { revealed: true } }),
    })
  })

  await card.click({ button: 'right' })
  await panel.locator(SELECTORS.canvasMenu).getByRole('button', { name: '打开文件所在位置' }).click()

  await expect.poll(() => seen.length).toBe(1)
  expect(seen[0]).toEqual({ file, source: 'canvas' })
})
