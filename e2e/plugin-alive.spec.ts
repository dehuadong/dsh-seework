import { SELECTORS, callRoute, expect, openSettings, test } from './support.ts'

/**
 * The plugin is alive in a real GUI.
 *
 * This is the guard the unit suite cannot give: `pnpm test` renders the client
 * components under jsdom, so it stays green while the shipped bundle fails to
 * load, or loads and renders nothing. Both failure modes reach the user as "the
 * buttons never appeared", with no error in the host log — which is why the
 * assertion is on the placed anchors rather than on module state.
 *
 * Zero cost: nothing here generates a picture or touches the developer's own
 * material library, because the host runs on its own `DSH_HOME`.
 */

test('首页上插件的客户端半边加载成功，入口只有右栏开始页一处', async ({ app }) => {
  // The shell renders this when a plugin's browser half throws during boot. It
  // is a literal English string in the shell's boot page, not a translated one.
  await expect(app.getByText('Failed to load plugins')).toHaveCount(0)

  // The right column's guide page is where these surfaces are reachable on a
  // screen with no session header, so the corner launchers stand down: two entry
  // points for two surfaces is one too many. They stay in the DOM (the header's
  // buttons disappear with the session, so these have to be able to come back)
  // and the empty dock is dropped, leaving nothing in the corner.
  await expect(app.locator(SELECTORS.dock)).toHaveCount(0)
  await expect(app.locator(SELECTORS.libraryLauncher)).toBeHidden()
  await expect(app.locator(SELECTORS.canvasLauncher)).toBeHidden()

  await app.getByRole('button', { name: '打开右侧边栏' }).click()
  const panel = app.locator('[data-sidebar-right-panel]')
  await expect(panel).toHaveAttribute('data-sidebar-right-open', 'true')
  await expect(panel.locator('[data-sidebar-right-guide-entry="seework-library"]')).toBeVisible()
  await expect(panel.locator('[data-sidebar-right-guide-entry="seework-canvas"]')).toBeVisible()
})

test('宿主半边在线：插件自己的路由应答', async ({ app }) => {
  // Same call the client half makes when it refreshes the library: a `{ ok: true }`
  // here means the host half mounted and its route family is serving.
  //
  // Polled rather than asserted once: the plugin registers its routes inside a
  // deferred `settings` injection, so the host is already serving pages while its
  // route family may still be a tick away. The GUI never races this — it loads
  // its bundle after the boot settled — but a spec that fetches the moment the
  // page renders can, and once did.
  await expect.poll(
    async () => (await callRoute<{ ok?: boolean }>(app, '/api/dsh-seework/library/list')).ok,
  ).toBe(true)
})

test('设置里出现 SeeWork 这一页，且卡片内容渲染出来', async ({ app }) => {
  await openSettings(app)
  const dialog = app.getByRole('dialog', { name: '设置' })

  // A first-class page in the nav, not a tab hidden inside the Plugins section.
  const section = dialog.getByRole('navigation').getByRole('button', { name: 'SeeWork', exact: true })
  await section.click()
  await expect(section).toHaveAttribute('aria-current', 'true')

  // The version row is filled from the host's own report, and the material
  // directory from its `library` route: both prove the card is bound to real
  // data rather than to defaults it fell back to.
  await expect(dialog.locator(SELECTORS.version)).not.toBeEmpty()
  await expect(dialog.locator(SELECTORS.dataDir)).toBeVisible()
})

test('「本地与行为」只剩两个开关，且这一节没有保存按钮', async ({ app }) => {
  await openSettings(app)
  const dialog = app.getByRole('dialog', { name: '设置' })
  await dialog.getByRole('navigation').getByRole('button', { name: 'SeeWork', exact: true }).click()

  // The plugin's own master switch is retired: the host's plugin enable/disable is
  // the switch a user reaches for, and for the agent it meant the same thing as the
  // switch below it (#5).
  await expect(dialog.getByLabel('启用插件')).toHaveCount(0)
  await expect(dialog.getByLabel('允许 Agent 生图')).toBeVisible()
  await expect(dialog.getByLabel('把插件与模型告知 Agent')).toBeVisible()

  // These take effect as they are changed, so the section offers nothing to save —
  // the one save button belongs to the connection, which is staged because its API
  // key is a secret the wire never returns.
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '保存连接', exact: true })).toBeVisible()
})
