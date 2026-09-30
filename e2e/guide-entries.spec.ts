import { expect, test } from './support.ts'

/**
 * The right column's guide page on a sessionless home.
 *
 * What the user reported: without a session the plugin's only way in is the
 * floating dock in the bottom-right corner, and the canvas it opens is the
 * plugin's own full-viewport overlay — which covers that very dock, leaving the
 * overlay's small 关闭 as the only way out. The column itself exists on the home
 * screen: the shell renders a retained session's right sidebar there and the
 * header's expand button opens it ("开始" is the column's own guide tab).
 *
 * The guide page has a seat for exactly this: `sidebar.right.tab.guide.entry`,
 * the slot every provider registers its card into (the shipped 工作区文件 /
 * 新建终端 / 浏览器 cards are three such registrations). This spec grades that
 * the plugin takes that seat, so the columns' own doors lead into SeeWork.
 *
 * Zero cost: the host runs on its own throwaway `DSH_HOME`.
 */

/** The plugin's two guide entries as the registry names them (kinds). */
const SEEWORK_KINDS = ['seework-library', 'seework-canvas'] as const

/**
 * Open the right column from the home screen and return its panel.
 *
 * The expand control lives in the conversation header's corner seat and renders
 * only while the panel is collapsed — the same button a user presses. Ready when
 * the panel reports itself open, not merely present: a collapsed panel is still
 * in the DOM, translated off the frame's right edge.
 */
async function openRightColumn(app: import('@playwright/test').Page) {
  const panel = app.locator('[data-sidebar-right-panel]')
  await app.getByRole('button', { name: '打开右侧边栏' }).click()
  await expect(panel).toHaveAttribute('data-sidebar-right-open', 'true')
  return panel
}

/** The guide's own container: the shipped fallback the entries are drawn into. */
function guide(app: import('@playwright/test').Page) {
  return app.locator('[data-sidebar-right-guide]')
}

test('首页打开右侧栏：开始页出现 SeeWork 的两张卡片', async ({ app }) => {
  const panel = await openRightColumn(app)

  const library = panel.locator('[data-sidebar-right-guide-entry="seework-library"]')
  const canvas = panel.locator('[data-sidebar-right-guide-entry="seework-canvas"]')
  await expect(library).toBeVisible()
  await expect(canvas).toBeVisible()
  await expect(library).toContainText('素材库')
  await expect(canvas).toContainText('画布')
})

test('点开始页的「画布」卡片：在右栏里打开画布，不落全屏浮层', async ({ app }) => {
  const panel = await openRightColumn(app)

  await panel.locator('[data-sidebar-right-guide-entry="seework-canvas"]').click()

  // The card is a door: it opens the type as a page in the guide's place.
  await expect(panel.locator('[data-dsh-seework-canvas-tab]')).toBeVisible()
  // The plugin's own fallback overlay must not be what answered the click.
  await expect(app.getByRole('dialog', { name: 'SeeWork 画布' })).toHaveCount(0)
})

test('开始页的每个 SeeWork 卡片都开一个自己的 tab', async ({ app }) => {
  const panel = await openRightColumn(app)

  for (const kind of SEEWORK_KINDS) {
    // Picking a capsule replaces the guide with the page it opened, so the
    // second card is only reachable after asking the strip for a new tab —
    // which is exactly how a user gets back to the guide.
    await panel.locator(`[data-sidebar-right-guide-entry="${kind}"]`).click()
    const body = kind === 'seework-library'
      ? panel.locator('aside[aria-label="SeeWork 素材库"]')
      : panel.locator('[data-dsh-seework-canvas-tab]')
    await expect(body).toBeVisible()
    await panel.getByRole('button', { name: '新标签页' }).click()
    await expect(panel.locator('[data-sidebar-right-guide-entry="seework-library"]')).toBeVisible()
  }
})
