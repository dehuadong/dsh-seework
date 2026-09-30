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

test('首页上插件的客户端半边加载成功', async ({ app }) => {
  // The shell renders this when a plugin's browser half throws during boot. It
  // is a literal English string in the shell's boot page, not a translated one.
  await expect(app.getByText('Failed to load plugins')).toHaveCount(0)

  // The floating launchers are the home screen's only way in: the conversation
  // header does not exist without a session, so these must be on screen there.
  await expect(app.locator(SELECTORS.dock)).toBeVisible()
  await expect(app.locator(SELECTORS.libraryLauncher)).toBeVisible()
  await expect(app.locator(SELECTORS.canvasLauncher)).toBeVisible()
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
