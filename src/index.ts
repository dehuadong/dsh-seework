/**
 * dsh-seework — host half.
 *
 * Mounts the plugin's settings section (SeeAI Hub address, user API key, model
 * catalog, local data root), the `/api/dsh-seework` route family (loopback-only
 * settings bridge + model discovery + generation proxy + material library), the
 * agent image tools, and the system-prompt announcement.
 *
 * The browser half (`./client`) renders the settings card; the sidebar material
 * library and the canvas build on the same library records and routes.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer Context merge (route registration).
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: pulls the systemPrompt Context merge (announcement section).
import type {} from '@deepseek-ai/dsh-system-prompt'
// Type-only: pulls the tools / attachments Context merges (agent tools).
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-attachment'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { registerAgentImageTools } from './agent-tools.ts'
import { registerCapabilitiesSkill, SKILL_NAME } from './capabilities-skill.ts'
import { hasRetiredModelKeys } from './capability.ts'
import { createCatalogRefresher, type CatalogRefresher, type CatalogRefresherDeps } from './catalog-refresh.ts'
import { DEFAULT_API_URL, SEEWORK_SETTINGS_NAMESPACE } from './protocol.ts'
import type { ModelConfig } from './protocol.ts'
import { summarizeSavedModels } from './model-summary.ts'
import { GenerationRuntime } from './generation-runtime.ts'
import type { UpdateHost } from './update.ts'
import { catalogUrl, gatewayUrl } from './engine.ts'
import { setLibraryDataRoot } from './library.ts'
import { makeRoutes, type SettingsSeam } from './routes.ts'
import {
  Config as ConfigSchema,
  effectiveConfig,
  installSettingsSection,
  type Config as SettingsEntry,
  type EffectiveConfig,
} from './settings.ts'

/** Stable cordis plugin name. */
export const name = 'seework'

/** Services required before the host surfaces can mount. */
export const inject = ['webServer', 'systemPrompt', 'tools', 'attachments']

/**
 * The schemastery config schema. The loader validates the composition entry
 * with the same-named export of this module.
 */
export const Config = ConfigSchema

/** The composition-entry shape (alias of the settings section's config). */
export type SeeWorkConfigEntry = SettingsEntry

// Internals re-exported for tests and host-side debugging; the plugin contract
// only requires name / inject / Config / apply.
export { makeRoutes } from './routes.ts'
export { generateImage, buildGenerationBody, SeeWorkError, catalogUrl, gatewayUrl } from './engine.ts'
export { discoverModels } from './catalog.ts'
export { catalogEntryToModel, openAiEntryToModel, looksLikeImageModel } from './capability.ts'
// The refresher alone is host plumbing the smoke script drives; the rest of the
// module is imported by its own test directly, not re-exported here. The
// retired-key probe rides along so the settings-document cleanup (#659) can be
// measured against a real document without reaching into the module's internals
// (it lives in `capability.ts` since #669 — it is a fact about the model shape).
export { createCatalogRefresher } from './catalog-refresh.ts'
export { hasRetiredModelKeys } from './capability.ts'
export { createCapabilitiesSkillProvider, registerCapabilitiesSkill, SKILL_NAME } from './capabilities-skill.ts'
export { capabilityLineFor, summarizeSavedModels } from './model-summary.ts'
export { GenerationRuntime, SeeWorkRuntimeError, isFinalStatus } from './generation-runtime.ts'
export { registerAgentImageTools, ensureConfigured } from './agent-tools.ts'
export { effectiveConfig, resolveModel, modelName } from './settings.ts'
export {
  appendLibraryEntry,
  clearLibrary,
  listLibrary,
  readLibraryImage,
  removeLibraryEntry,
  imageSize,
  libraryDataRoot,
  setLibraryDataRoot,
} from './library.ts'
export type { EffectiveConfig } from './settings.ts'

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 150

/**
 * Model-facing announcement: **plugin-level facts only**.
 *
 * What belongs here, and what deliberately does not, is design discipline 13 of
 * `docs/design/2026-09-15-agent-visible-surface.md`: the announcement carries
 * identity, the one tool, the live addresses, the default model's one
 * capability line, the other saved models' identifiers, where the library and
 * canvas live, how to configure the plugin, the plugin-level limits (one
 * generation per model at a time, the cost and quality disclaimers), and the
 * **order to load the skill** before generating (#665).
 *
 * The **tool-level call and result conventions** (confirm the prompt first,
 * never invent parameters, where defaults come from, what the result fields
 * mean, showing the picture in the reply body, serialize per model, passing
 * `reference_images` back unchanged) live in the tool description in
 * `src/agent-tools.ts`. That is not a cosmetic split: a tool description stays
 * resident with the tool definition and is **not** governed by
 * `announceToAgent`, so those sentences only survive with the announcement
 * switched off if they live there. One fact, one home — a fact stated twice
 * drifts (#651).
 *
 * What stays here and must not move: the **per-model generation limit** and the
 * cost/quality disclaimer (plugin-level facts), while the "do not retry" rule
 * itself is stated once, in `generate_image`'s description.
 *
 * The **capability boundary** is a plugin-level fact and is stated here once:
 * this plugin sends the five regular parameters (plus the optional
 * `reference_images` on the same tool) and nothing else — a model's own extra
 * gateway fields are not something the plugin can send, and since #661 the
 * announcement no longer points anywhere for them (there is no route from this
 * plugin to an extra field, so a pointer would only suggest one). Since #664
 * there is **one** tool rather than a generator plus an editor: the same call
 * is an edit when it carries reference images.
 */
/**
 * The order to load the bundled skill before using the tool (#665).
 *
 * A skill is loaded on demand, so "the details are in the skill" is advice the
 * model may never take: the announcement has to **order** the load, with the
 * name spelled out. `generate_image`'s description carries the same order, so
 * it survives with the announcement switched off.
 *
 * Its own constant rather than inlined twice: `SEEWORK_GUIDANCE` is
 * interpolated into both announcement branches, and one shared string cannot
 * drift between them.
 */
const LOAD_SKILL_INSTRUCTION = `用这个工具生图 / 改图之前，先加载技能 \`${SKILL_NAME}\`。`

export const SEEWORK_GUIDANCE = '本机已安装 SeeWork 插件（dsh-seework）：让 Agent 用用户自己的 SeeAI Hub 额度在对话里直接生图与改图。一个工具 `generate_image`：不带参考图就是文生图，带上可选的 `reference_images` 就是改图。'
  + LOAD_SKILL_INSTRUCTION
  + '图片生成是同步的：一次调用就拿到结果，没有任务号可以查询或取消。每张成图自动存进本地素材库（会话右上角的「素材库」入口，没有会话时在右下角浮动按钮；画布同理），不需要另外保存。API 地址与用户 API Key 在「设置 → 插件 → SeeWork」（侧边栏）配置，密钥仅存于本机设置文档，生图请求由本地宿主代理转发，浏览器拿不到密钥。限制：生图消耗 SeeAI Hub 账户额度，余额不足时网关会直接拒绝（响应里的 cost 即本次扣费）；一次调用就是一次生成请求，同一模型同时只允许 1 个；插件不排队、不自动重试，失败要如实告知用户并经其许可后再发；`n` 的上限按模型（有的模型一次只能出 1 张）；图片内容由上游模型生成，可能不符合预期。插件只发五个常规参数（`model` / `n` / `resolution` / `aspect_ratio` / `output_format`）外加可选的 `reference_images`，模型特有的额外字段插件不发；目录条目列出的是本插件可发参数的字段面，缺键不等于上游一定拒绝。用户提到「生图 / 画图 / 生成图片 / 文生图 / 图生图 / 改图 / 素材库 / 画布」时即指本插件。'

/**
 * Model-facing announcement: plugin presence, the live endpoints, the default
 * model with **one** capability line, the other saved models' identifiers, where
 * the library and canvas live, and how to configure the plugin.
 *
 * Everything else lives in the on-demand skill (a fixed procedure) or in the
 * tool description: per-model capabilities, the model-specific extra
 * gateway fields and pixel `size` are deliberately absent, so the
 * announcement's length is essentially independent of how many models the user
 * saved (one more model costs one more identifier). The capability line itself
 * is rendered from `src/model-summary.ts`, never recomputed here.
 * **Tool-level call and result conventions are not here either**: they live in
 * the tool description, which `announceToAgent` does not govern (see design
 * discipline 13).
 *
 * Both branches build on `SEEWORK_GUIDANCE`, so the order to load the skill
 * (#665) reaches the agent whether or not the connection is configured yet.
 * The branches add state-specific sentences only — repeating the order here
 * would be the second home that drifts (#651).
 *
 * Which fields a given model accepts is **not** something this plugin carries
 * any more (#659), and since #661 the announcement does not point at a model's
 * own guide document either: the plugin states its own boundary — five regular
 * parameters, nothing else — and adds that a field missing from the catalog
 * entry is not a promise that upstream would refuse it (#663).
 *
 * @param config - the live settings view.
 * @returns the announcement text for the system prompt.
 */
export function guidanceFor(config: EffectiveConfig): string {
  if (config.apiKey.trim() === '' || config.models.length === 0) {
    // Clearing the key leaves the saved selection in the document, so this
    // branch must still say where the details will be once it is filled in.
    return `${SEEWORK_GUIDANCE} 当前尚未配置完成：请在 GUI 里打开「设置 → 插件 → SeeWork」（侧边栏），填写 API 地址（默认 ${DEFAULT_API_URL}）与用户 API Key，点「检测可用模型」并保存。`
  }
  const { defaultModel, others } = summarizeSavedModels(config)
  const catalog = catalogUrl(config.serviceUrl)
  const parts = [
    SEEWORK_GUIDANCE,
    `当前网关 ${gatewayUrl(config.apiUrl, '/images/generations')}，模型目录 ${catalog}。`,
    defaultModel === undefined
      ? ''
      : `默认模型：${defaultModel.identifier}（默认）（${defaultModel.capabilityLine}）。`,
    // Identifiers only: the point of the split is that a model the agent never
    // uses costs one name, not five capability items.
    others.length === 0 ? '' : `其他已保存模型：${others.map(summary => summary.identifier).join('；')}。`,
    '用户指定模型时用它的名字；未指定时用默认模型，不要自行挑选别的模型。',
  ].filter(part => part !== '')
  return parts.join('')
}

/**
 * How `apply` builds the automatic-detection refresher.
 *
 * A seam with a real default, so the assembly test can prove the **startup round
 * and the background timer are actually wired** without discovery reaching for
 * the network. Production passes nothing and gets {@link createCatalogRefresher}.
 */
export type RefresherFactory = (deps: CatalogRefresherDeps) => CatalogRefresher

/**
 * The presentation-policy seam of the settings service (DSH 0.2 and later).
 *
 * `configure({ auto: false }, owner)` records that the owning plugin renders its
 * own page, so the host does not additionally project a form from the entry's
 * Config. Absent on 0.1.x, which projects nothing either way.
 */
interface SettingsPresentationFace {
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void
}

/**
 * Mount the settings section, routes, agent tools, and announcement.
 * @param ctx - host plugin context carrying webServer/systemPrompt/tools.
 * @param config - the composition entry (schema defaults + fallback source).
 * @param makeRefresher - test seam for the automatic-detection refresher.
 */
export function apply(ctx: Context, config?: SettingsEntry, makeRefresher: RefresherFactory = createCatalogRefresher): void {
  // The live source the surfaces read: the settings section once the provider
  // is attached, the composition entry otherwise. `installSettingsSection`
  // swaps the source in place, so every closure below sees live values.
  //
  // `hooks.onChange` is called synchronously by the real provider, but never
  // *inside* `apply`: cordis activates an `inject` callback in a separate
  // microtask (`Fiber._reload` awaits `Promise.resolve()` first), so the
  // handlers declared below this call are initialised by the time it fires.
  const read = installSettingsSection(ctx, config ?? {}, {
    onChange: () => {
      syncAnnouncement()
      syncSkill()
    },
  })

  /** Resolved view of the current settings. */
  const resolve = (): EffectiveConfig => {
    const value = effectiveConfig(read())
    setLibraryDataRoot(value.dataDir)
    return value
  }

  /** The shared generation queue, created lazily so settings exist first. */
  let runtime: GenerationRuntime | undefined
  const runtimeOf = (): GenerationRuntime => {
    runtime ??= new GenerationRuntime(() => resolve())
    return runtime
  }

  // ---- automatic catalog detection (#652) --------------------------------
  // One refresher per plugin, created with the settings provider (it needs the
  // write seam) and shared by all three triggers: startup, the settings card
  // opening, and the low-frequency background timer. Sharing it is what makes
  // "one request, not two" a property of the object rather than a hope about
  // timing.
  let refresher: CatalogRefresher | undefined
  const refresherOf = (): CatalogRefresher | undefined => refresher

  /**
   * Adopt refreshed capabilities into the saved models.
   *
   * Read-modify-write rather than a whole-document write: only `models` travels,
   * so the key, the defaults and `defaultModel` cannot be touched by a background
   * round. A concurrent write (the user saving the card while a round lands) is
   * retried once against the fresh document — adoption always re-applies to
   * whatever is saved at that moment, so re-reading is the correct recovery, not
   * a workaround.
   */
  const adoptRefreshedModels = async (seam: SettingsSeam, models: ModelConfig[]): Promise<void> => {
    const op = { op: 'set' as const, path: ['models'], value: models }
    try {
      await seam.mutate(SEEWORK_SETTINGS_NAMESPACE, [op])
    } catch (error) {
      if (!(error instanceof SettingsConflictError)) throw error
      await seam.mutate(SEEWORK_SETTINGS_NAMESPACE, [op])
    }
  }

  // ---- announcement -----------------------------------------------------
  let disposeSection: (() => void) | undefined
  const syncAnnouncement = (): void => {
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    const value = resolve()
    if (!value.enabled || !value.announceToAgent) return
    disposeSection = ctx.systemPrompt.section({
      name: 'plugin:dsh-seework',
      order: SECTION_ORDER,
      text: guidanceFor(value),
    })
  }

  // ---- routes -----------------------------------------------------------
  // Route registration belongs INSIDE the settings injection, not beside it:
  // the bridge cannot exist without the provider, and `ctx.effect` runs
  // immediately, so registering out here would check for the service before it
  // has attached and quietly register nothing at all.
  ctx.inject(['settings'], (sctx) => {
    // This plugin ships its own settings page, so a host that can project a
    // form from the entry's Config must not also do so: two entries for one
    // plugin is the same clutter the client half avoids when it prefers the nav
    // page over the Plugins tab. `configure` is the 0.2-and-later seam and is
    // absent on 0.1.x, where nothing is auto-generated anyway.
    const presentation = sctx.get('settings') as unknown as SettingsPresentationFace | undefined
    if (typeof presentation?.configure === 'function') {
      sctx.effect(
        () => presentation.configure!({ auto: false }, ctx.fiber),
        'dsh-seework: settings presentation',
      )
    }

    sctx.effect(
      () => mountRoutes(sctx, read, runtimeOf, refresherOf, () => probeUpdateHost(sctx)),
      'dsh-seework: routes',
    )

    // The refresher itself is plugin state (it needs the settings write seam, and
    // the card's route reads it per request), so the fiber owns only its teardown.
    const seam = sctx.get('settings') as unknown as SettingsSeam | undefined
    if (seam !== undefined) {
      refresher = makeRefresher({
        resolveModels: () => resolve().models,
        sources: () => {
          const value = resolve()
          return { serviceUrl: value.serviceUrl, apiUrl: value.apiUrl, apiKey: value.apiKey }
        },
        mutate: (models) => adoptRefreshedModels(seam, models),
        // Read from the **raw** document, not from `resolveModels()`: that view
        // is normalized and has already dropped the retired keys (#659), so it
        // could never report the residue this round exists to take out.
        hasRetiredKeys: () => hasRetiredModelKeys(read().models),
      })
    }
    sctx.effect(() => {
      // Startup round, then the low-frequency timer. Both are automatic (they
      // share the throttle), and neither may hold the plugin's activation: the
      // promise is deliberately not awaited.
      void refresher?.refresh({ automatic: true })
      const stop = refresher?.startBackground()
      return () => { stop?.() }
    }, 'dsh-seework: automatic catalog detection')
  })

  // ---- capability skill (optional seam) ---------------------------------
  // Skills are an enhancement, not the product: a host without a skill
  // registry must keep mounting the tools, routes, library and canvas. So this
  // is a deferred optional injection, deliberately NOT a fifth `inject` entry.
  //
  // `enabled` governs the skill exactly as it governs the announcement: turning
  // the plugin off must take the skill out of the host's catalog, not just stop
  // the prompt section. `announceToAgent` deliberately does NOT: it saves
  // prompt budget only, and the skill is loaded on demand (see ADR-0001).
  let skillContext: Context | undefined
  let disposeSkill: (() => void) | undefined

  /** Register or unregister the skill so it follows the current `enabled`. */
  const syncSkill = (): void => {
    if (skillContext === undefined) return
    if (!resolve().enabled) {
      disposeSkill?.()
      disposeSkill = undefined
      return
    }
    disposeSkill ??= registerCapabilitiesSkill(skillContext)
  }

  ctx.inject(['skills'], (sctx) => {
    skillContext = sctx
    // The registration is plugin state (a settings commit can flip it), so the
    // fiber owns only the teardown and `syncSkill` owns the registration.
    sctx.effect(() => () => {
      disposeSkill?.()
      disposeSkill = undefined
      skillContext = undefined
    }, 'dsh-seework: capability skill')
    syncSkill()
  })

  // ---- agent tools ------------------------------------------------------
  ctx.effect(() => registerAgentImageTools(ctx, runtimeOf(), () => resolve()), 'dsh-seework: agent image tools')

  // First announcement from the composition entry; every later settings commit
  // re-runs it through the `onChange` above.
  syncAnnouncement()

  // The announcement is plugin state, not a fiber effect: settings commits
  // re-create it, so it needs an explicit teardown on plugin unload.
  ctx.effect(() => () => {
    disposeSection?.()
    disposeSection = undefined
  }, 'dsh-seework: announcement teardown')
}

/**
 * The host's plugin manager, when this host composes one.
 *
 * Probed rather than injected, and structurally rather than by type: the service
 * is optional, its shape differs between host generations, and an install that
 * cannot update itself must still load. A missing service costs the two update
 * routes only — they answer "unavailable" and the card hides the button.
 *
 * @param ctx - the context whose `pluginManager` may be attached.
 * @returns the seam, or undefined when this host has none.
 */
function probeUpdateHost(ctx: Context): UpdateHost | undefined {
  const service = (ctx as unknown as { get(name: string): unknown }).get('pluginManager')
  if (service === null || service === undefined) return undefined
  const candidate = service as Partial<UpdateHost>
  if (typeof candidate.registries !== 'function' || typeof candidate.installBundle !== 'function') return undefined
  return candidate as UpdateHost
}

/**
 * Register the route family with the host web server.
 *
 * @param ctx - the context whose `settings` and `webServer` are attached.
 * @param read - reads the live settings entry.
 * @param runtimeOf - the shared generation queue (created on first use).
 * @param updateHostOf - the host's plugin manager, when it composes one (the
 *   two self-update routes answer "unavailable" otherwise).
 * @param catalogRefreshOf - the automatic detection refresher, when the host has
 *   a settings provider (the two catalog routes answer "unavailable" otherwise).
 * @returns disposer removing every route.
 */
export function mountRoutes(
  ctx: Context,
  read: () => SettingsEntry,
  runtimeOf: () => GenerationRuntime,
  catalogRefreshOf?: () => CatalogRefresher | undefined,
  updateHostOf?: () => UpdateHost | undefined,
): () => void {
  const seam = ctx.get('settings') as unknown as SettingsSeam | undefined
  // Defensive: the caller injects `settings` first, so this only fires if a
  // deployment wires `webServer` without a settings provider.
  if (seam === undefined) return () => {}
  const disposers = makeRoutes({
    settings: seam,
    resolve: read,
    runtime: runtimeOf(),
    // The conversation card reads a tool result's durable attachment back from
    // here; a host without a store leaves that one route answering unavailable.
    ...ctx.attachments === undefined ? {} : { attachments: ctx.attachments },
    // Probed per request, never injected: `dsh web` composes a directory picker
    // (native OS chooser locally, listing primitives for remote clients), but a
    // deployment without one must keep working — the card then hides the button.
    directoryPicker: () => (ctx as unknown as { get(name: string): unknown }).get('directoryPicker'),
    ...catalogRefreshOf === undefined ? {} : { catalogRefresh: catalogRefreshOf },
    ...updateHostOf === undefined ? {} : { updateHost: updateHostOf },
  }).map(route => ctx.webServer.register(route))
  // The library path resolves per request, so a settings change needs no
  // re-registration; only the routes themselves are torn down here.
  return () => {
    for (const dispose of disposers) dispose()
  }
}

/** The settings namespace this plugin owns, re-exported for tooling. */
export { SEEWORK_SETTINGS_NAMESPACE }
