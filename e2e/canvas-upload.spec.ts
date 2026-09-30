import {
  PNG_1X1, SELECTORS, canvasCardIds, expect, openCanvas, openCanvasMenu, openFreshBoard, test, uploadPicture,
} from './support.ts'

/**
 * Putting a local picture on a board.
 *
 * A board's pictures used to come from two places: the material library, and the
 * board's own annotation/crop composites. The user's own file is a third, and
 * the entry is a right-click on the board's own space — the picture is placed
 * where the user is looking, not through the toolbar.
 *
 * PNG and JPEG only, and that is a contract rather than a hint: the picker
 * filters, and the check behind it rejects anything else instead of writing it.
 *
 * Zero cost: nothing here generates a picture or touches the developer's own
 * material library — the host runs on its own throwaway `DSH_HOME`.
 */

test('画布空白处右键：出现菜单，里面有「上传图片素材」', async ({ app }) => {
  const panel = await openCanvas(app)
  await openFreshBoard(panel)
  const menu = await openCanvasMenu(panel)
  await expect(menu.getByRole('button', { name: '上传图片素材' })).toBeVisible()
})

test('上传一张 PNG：板上多一张「上传素材」卡片，图片真的能读回来', async ({ app }) => {
  const panel = await openCanvas(app)
  await openFreshBoard(panel)

  await uploadPicture(app, panel, { name: 'shot.png', mimeType: 'image/png', buffer: PNG_1X1 })

  await expect(panel.locator(SELECTORS.card)).toHaveCount(1)
  const card = panel.locator(SELECTORS.card)
  await expect(card.locator(SELECTORS.cardOrigin)).toHaveText('上传素材')
  // It is the board's own asset, and the bytes came back over that route.
  await expect(card.locator('img')).toHaveAttribute('src', /\/api\/dsh-seework\/canvas\/asset\//u)
  await expect.poll(
    async () => card.locator('img').evaluate(node => (node as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0)
})

test('不是 PNG / JPEG 的文件被挡下：只给提示，不落卡片', async ({ app }) => {
  const panel = await openCanvas(app)
  await openFreshBoard(panel)

  await uploadPicture(app, panel, { name: 'clip.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a', 'ascii') })

  await expect(panel.getByText(/只支持 PNG \/ JPEG/u)).toBeVisible()
  expect(await canvasCardIds(panel), '被挡下的文件不该产生卡片').toEqual([])
})
