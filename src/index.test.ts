/**
 * Plugin assembly tests: the one thing the smoke script cannot prove.
 *
 * `scripts/smoke.mjs` drives `makeRoutes` and `GenerationRuntime` directly, so
 * it would keep passing if `apply()` forgot to register the tools, mis-wired the
 * settings source, or left the announcement behind. These tests build a stub
 * cordis-shaped host context, run `apply()` once, and drive what it registered —
 * the closest thing to "the host loaded the plugin" without a live process.
 *
 * Two load-bearing checks:
 *  - the agent tool is registered with a schema the model can call, and
 *    `generate_image` refuses with the actionable "not configured" message;
 *  - the system-prompt announcement is re-issued (never stacked) on every
 *    settings commit, and disappears when the user turns it off.
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { SkillRegistry, type SkillSummary } from '@deepseek-ai/dsh-skill'
import { apply, guidanceFor, inject, name, SEEWORK_GUIDANCE, SKILL_NAME, type RefresherFactory } from './index.ts'
import type { CatalogRefresher, CatalogRefresherDeps } from './catalog-refresh.ts'
import { capabilityLineFor } from './model-summary.ts'
import { SEEWORK_SETTINGS_NAMESPACE } from './protocol.ts'
import { effectiveConfig, DEFAULT_ASPECT_RATIO, DEFAULT_OUTPUT_FORMAT, type Config, type EffectiveConfig } from './settings.ts'
import type { ModelConfig } from './protocol.ts'

/** One registered tool as the stub host records it (defineTool materializes JSON Schema). */
interface RegisteredTool {
  name: string
  description: string
  /** JSON Schema: `{ type: 'object', properties, required }`. */
  parameters: {
    type: string
    properties?: Record<string, unknown>
    required?: string[]
  }
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown>
}

/** One registered prompt section. */
interface Section {
  name: string
  order: number
  text: string
  disposed: boolean
}

/** The stub host: everything the plugin can touch, plus the knobs a test needs. */
interface Harness {
  /** Every tool the plugin registered. */
  tools: RegisteredTool[]
  /** Every prompt section the plugin ever created (disposed ones included). */
  sections: Section[]
  /** Every route the plugin registered. */
  routes: Array<{ path: string; kind: string; disposed: boolean }>
  /** Every `ctx.effect` the plugin opened. */
  effects: Array<{ label: string | undefined; disposed: boolean }>
  /** The live settings document the seam resolves. */
  document: Config
  /** Attach a settings provider, which runs the plugin's deferred injection. */
  attachSettings(): void
  /**
   * Attach a skill registry, which runs the plugin's deferred skill injection.
   * Leaving it unattached is the "host without a skill subsystem" case.
   */
  attachSkills(): void
  /**
   * The host's skill catalog, read from the **real** `SkillRegistry`.
   *
   * Asserting the skill against the host's own catalog (rather than against an
   * array this test file maintains) is the point: "registered" means the model can
   * see the skill, and only the registry can say so. Answers `[]` while no registry
   * is attached.
   */
  skillCatalog(): Promise<SkillSummary[]>
  /**
   * The body the host would serve for the bundled skill (undefined while no
   * registry is attached). This is the self-sufficiency check: with the
   * announcement switched off, the body is all the agent has.
   */
  skillContent(): Promise<string | undefined>
  /** Fire a settings commit, as the real provider does on every write. */
  commit(): void
  /** Run every effect disposer, as plugin unload does. */
  unload(): void
  /** The resolved config the host half is currently acting on. */
  effective(): EffectiveConfig
  /** Every path op the plugin wrote through the settings seam. */
  mutations: Array<{ ops: unknown[] }>
}

/** Build a stub host context and assemble the plugin once against it. */
function assemble(entry: Config = {}, makeRefresher?: RefresherFactory): Harness {
  const tools: RegisteredTool[] = []
  const sections: Section[] = []
  const routes: Array<{ path: string; kind: string; disposed: boolean }> = []
  const effects: Array<{ label: string | undefined; disposed: boolean }> = []
  const document: Config = { ...entry }
  /** Every path op the plugin wrote through the settings seam. */
  const mutations: Array<{ ops: unknown[] }> = []
  /** Deferred `ctx.inject` callbacks, run once every named service is attached. */
  const pendingInjections: Array<{ names: string[]; callback: (scoped: Context) => void }> = []
  const cleanups: Array<() => void> = []
  /** Names of the services this stub host has attached so far. */
  const attached = new Set<string>()
  /** The provider the plugin waits for; set by `attachSettings`. */
  let settingsProvider: unknown
  /** The skill registry the plugin waits for; set by `attachSkills`. */
  let skillsRegistry: SkillRegistry | undefined
  /** The settings hooks the provider handed the plugin, used by `commit`. */
  let settingsHooks: { setSource: (source: () => Config) => void; onChange: () => void } | undefined

  /** Run every deferred injection whose services have all attached. */
  const runPendingInjections = (): void => {
    for (const injection of pendingInjections.splice(0)) {
      if (injection.names.every(service => attached.has(service))) {
        injection.callback(ctx as unknown as Context)
      } else {
        pendingInjections.push(injection)
      }
    }
  }

  const effect = (callback: () => unknown, label?: string): void => {
    const record = { label, disposed: false }
    effects.push(record)
    const result = callback()
    if (typeof result === 'function') cleanups.push(result as () => void)
  }

  const ctx = {
    effect,
    inject: (names: string[], callback: (scoped: Context) => void) => {
      if (names.every(service => attached.has(service))) {
        callback(ctx as unknown as Context)
        return
      }
      pendingInjections.push({ names, callback })
    },
    get: (service: string) => {
      if (service === 'settings') return settingsProvider
      if (service === 'skills') return skillsRegistry
      return undefined
    },
    // The real context exposes attached services as properties too; the plugin
    // reads `ctx.skills` inside the injection, so the stub must answer both ways.
    get skills() {
      return skillsRegistry
    },
    webServer: {
      register: (route: { path: string; kind: string }) => {
        const record = { path: route.path, kind: route.kind, disposed: false }
        routes.push(record)
        return () => { record.disposed = true }
      },
    },
    systemPrompt: {
      section: (section: { name: string; order: number; text: string }) => {
        const record: Section = { ...section, disposed: false }
        sections.push(record)
        return () => { record.disposed = true }
      },
    },
    tools: {
      register: (tool: RegisteredTool) => {
        tools.push(tool)
        return () => {}
      },
    },
    attachments: {
      imageLimits: {},
      saveImages: async (images: unknown[]) => images.map((_image, index) => ({
        attachmentId: `attachment-${index}`,
        mediaType: 'image/png',
        bytes: 10,
        width: 4,
        height: 4,
      })),
      readImage: async (ref: Record<string, unknown>) => ({
        ref: { ...ref, mediaType: 'image/png', bytes: 4, width: 2, height: 2 },
        data: new Uint8Array([1, 2, 3, 4]),
      }),
    },
  } as unknown as Context

  if (makeRefresher === undefined) apply(ctx, entry)
  else apply(ctx, entry, makeRefresher)

  return {
    tools,
    sections,
    routes,
    effects,
    mutations,
    document,
    attachSettings: () => {
      settingsProvider = {
        writable: true,
        describe: () => [],
        mutate: async (_ns: unknown, ops: unknown[]) => { mutations.push({ ops }) },
        installSection: (
          _owner: unknown,
          _ns: SettingsNamespace,
          _schema: unknown,
          _entry: Config,
          hooks: { setSource: (source: () => Config) => void; onChange: () => void },
        ) => {
          // The real provider hands the owner a reader over the committed
          // section and then notifies once, synchronously (see
          // `@deepseek-ai/dsh-settings`); the stub reads the mutable document.
          settingsHooks = hooks
          hooks.setSource(() => document)
          hooks.onChange()
        },
      }
      attached.add('settings')
      // Attaching the service runs the injections that were deferred for it —
      // exactly once, as the real runtime does.
      runPendingInjections()
    },
    attachSkills: () => {
      // The host's **real** registry, on its own cordis context: the plugin's
      // register/unregister path is only meaningfully asserted against the
      // catalog the model would actually read.
      skillsRegistry = new SkillRegistry(new Context())
      attached.add('skills')
      runPendingInjections()
    },
    skillCatalog: () => skillsRegistry === undefined ? Promise.resolve([]) : skillsRegistry.list(),
    skillContent: async () => skillsRegistry === undefined
      ? undefined
      : (await skillsRegistry.get(SKILL_NAME))?.content,
    commit: () => { settingsHooks?.onChange() },
    unload: () => {
      for (const cleanup of cleanups.splice(0)) cleanup()
      for (const record of effects) record.disposed = true
    },
    effective: () => effectiveConfig(document),
  }
}

describe('plugin contract', () => {
  it('declares the services it needs', () => {
    expect(name).toBe('seework')
    expect(inject).toContain('tools')
    expect(inject).toContain('webServer')
    expect(inject).toContain('systemPrompt')
    expect(inject).toContain('attachments')
    // `settings` is deliberately NOT declared here: it is injected where it is
    // used (the route bridge), because declaring it would hold the whole plugin
    // — including the agent tools — until a settings provider exists.
    expect(inject).not.toContain('settings')
  })
})

describe('the capability skill seam', () => {
  it('registers its provider once a skill registry attaches', async () => {
    const harness = assemble()
    // Nothing is registered while no registry exists — the injection is deferred.
    expect(await harness.skillCatalog()).toEqual([])

    harness.attachSkills()
    const catalog = await harness.skillCatalog()
    expect(catalog).toHaveLength(1)
    expect(catalog[0]!.name).toBe('seework-image-capabilities')
    expect(catalog[0]!.provider).toBe('seework')
    expect(catalog[0]!.invocation.modelInvocable).toBe(true)
  })

  it('keeps the rest of the plugin mounted when no skill registry exists', async () => {
    const harness = assemble()
    harness.attachSettings()
    // Skills are an enhancement, never a precondition: a host without a skill
    // registry still gets the tools and the routes, and assembly must not throw.
    expect(harness.tools.map(tool => tool.name).sort()).toEqual(['generate_image'])
    expect(harness.routes.length).toBeGreaterThan(0)
    expect(await harness.skillCatalog()).toEqual([])
  })

  it('keeps the skill when only the announcement is turned off, and the skill stands alone', async () => {
    // The chosen semantics (A): `announceToAgent=false` saves prompt budget and
    // nothing else — the skill is load-on-demand and costs no prefix.
    const harness = assemble({
      announceToAgent: false,
      apiKey: 'sk-x',
      serviceUrl: 'https://hub.example.com',
      models: [{
        id: 'gemini-3-1-flash-image',
        label: 'Gemini 3.1 Flash Image',
        resolutions: ['1K', '2K', '4K', '512'],
        aspectRatios: ['1:1'],
        outputFormats: ['png'],
        maxImages: 1,
        maxReferenceImages: 0,
        capabilitiesKnown: true,
      }],
      defaultModel: 'gemini-3-1-flash-image',
    })
    harness.attachSettings()
    harness.attachSkills()
    expect(harness.sections.filter(section => !section.disposed)).toHaveLength(0)
    expect(await harness.skillCatalog()).toHaveLength(1)

    // Self-sufficiency: with no announcement at all, the body must still carry
    // the procedure — since #666 that is the understand → infer → confirm →
    // generate flow, not the retired capability boundary. It is a fixed
    // document now, so it holds no per-model data even though a model is saved,
    // and since #661 it points nowhere for extra fields.
    const body = await harness.skillContent()
    expect(body).toContain('理解 → 推断 → 确认 → 生成')
    expect(body).toContain('确认后生成')
    expect(body).not.toContain('/guide')
    expect(body).not.toContain('/catalog/semantics')
    expect(body).not.toContain('gemini-3-1-flash-image')
    expect(body).not.toContain('hub.example.com')

    harness.document.announceToAgent = true
    harness.commit()
    expect(harness.sections.filter(section => !section.disposed)).toHaveLength(1)
    expect(await harness.skillCatalog()).toHaveLength(1)
  })
})

describe('apply', () => {
  it('registers the single agent tool with a model-callable schema (#664 / AC-1, AC-2)', () => {
    const harness = assemble()
    // AC-1: exactly one tool. The generator and the former editor are one row.
    expect(harness.tools.map(tool => tool.name)).toEqual(['generate_image'])

    const generate = harness.tools.find(tool => tool.name === 'generate_image')!
    // defineTool materializes the parameter spec into JSON Schema, so this is
    // what the model actually receives.
    expect(generate.parameters.type).toBe('object')
    expect(generate.parameters.properties?.prompt).toMatchObject({ type: 'string' })
    expect(generate.parameters.properties?.model).toMatchObject({ type: 'string' })
    expect(generate.parameters.required).toContain('prompt')
    // AC-2: the seven arguments, and `reference_images` is the optional one —
    // omitting it is text-to-image, so it must never be required.
    expect(Object.keys(generate.parameters.properties ?? {}).sort())
      .toEqual(['aspect_ratio', 'model', 'n', 'output_format', 'prompt', 'reference_images', 'resolution'])
    expect(generate.parameters.properties?.reference_images).toMatchObject({ type: 'array' })
    expect(generate.parameters.required).not.toContain('reference_images')
    // The description says what "no reference images" means, and does so once.
    expect(generate.description).toContain('With `reference_images` this call edits those images; without it, it generates from the prompt alone')
    // Image generation is synchronous, so nothing may hand the model a task
    // handle to poll afterwards.
    expect(generate.description).toContain('synchronous')
    expect(generate.parameters.properties).not.toHaveProperty('wait_for_completion')
    // The image count is the gateway's own field name (`docs/api/images.md`), not
    // a plugin-invented alias.
    expect(generate.parameters.properties).toHaveProperty('n')
    expect(generate.parameters.properties).not.toHaveProperty('count')
    // The result reports where each image landed, and the model is told to hand
    // an earlier result back unchanged — so those same fields have to validate on
    // the way in too, or "pass it unchanged" would be rejected.
    const refItems = (generate.parameters.properties?.reference_images as {
      items?: { properties?: Record<string, unknown> }
    }).items
    expect(Object.keys(refItems?.properties ?? {}))
      .toEqual(expect.arrayContaining(['file', 'url', 'path']))
  })

  it('refuses a generation with an actionable message while nothing is configured', async () => {
    const harness = assemble()
    const generate = harness.tools.find(tool => tool.name === 'generate_image')!
    await expect(generate.execute({ prompt: '一只猫' }, {
      signal: new AbortController().signal,
      agent: undefined,
    })).rejects.toThrow(/SeeWork/)
  })

  it('tells the agent which model to use once the catalog is configured', async () => {
    const harness = assemble()
    harness.attachSettings()
    Object.assign(harness.document, {
      apiUrl: 'http://127.0.0.1:8080/v1',
      serviceUrl: 'http://127.0.0.1:8081',
      apiKey: 'sk-x',
      models: [{
        id: 'seedream-5-0-lite',
        label: 'Seedream 5.0 Lite',
        resolutions: ['2K', '3K', '4K'],
        aspectRatios: ['16:9', '1:1'],
        outputFormats: ['jpeg', 'png'],
        maxImages: 15,
        maxReferenceImages: 14,
        capabilitiesKnown: true,
      }],
      defaultModel: 'seedream-5-0-lite',
    })
    const text = harness.effective()
    expect(text.defaultModel).toBe('seedream-5-0-lite')
    expect(text.models).toHaveLength(1)
  })

  it('announces the tool names, the live addresses and the default model to the agent', () => {
    // This text is what lands in the system prompt. The tool is registered in
    // the tool registry (covered above); this is the other half — the agent
    // being told it exists, where requests go, and which model to pick.
    //
    // What may appear here is bounded by design discipline 13: the announcement
    // carries **plugin-level facts** only. The tool-level call/result
    // conventions live in the tool description (asserted by the
    // "tool-level conventions" block below), so that turning this text off with
    // `announceToAgent=false` does not take them away (#651).
    const harness = assemble({
      apiUrl: 'http://127.0.0.1:8080/v1',
      serviceUrl: 'http://127.0.0.1:8081',
      apiKey: 'sk-x',
      models: [{
        id: 'seedream-5-0-lite',
        label: 'Seedream 5.0 Lite',
        resolutions: ['2K', '3K', '4K'],
        aspectRatios: ['16:9', '1:1'],
        outputFormats: ['jpeg', 'png'],
        maxImages: 15,
        maxReferenceImages: 14,
        capabilitiesKnown: true,
      }],
      defaultModel: 'seedream-5-0-lite',
    })
    const text = harness.sections.find(section => !section.disposed)!.text
    // The one tool the agent is meant to call, by its registered name — a
    // description of capabilities without a name does not tell the model what
    // to call. #664: there is no second tool, and the announcement says so.
    expect(text).toContain('generate_image')
    expect(text).toContain('一个工具 `generate_image`')
    expect(text).not.toContain('edit_image')
    // …and it must not advertise a task vocabulary the image API does not have:
    // SeeAI Hub's image endpoint is synchronous, so there is no task id to poll
    // or cancel, and the plugin owns no such tool any more.
    expect(text).not.toContain('wait_for_completion')
    expect(text).not.toContain('cancel_seework_task')
    expect(text).not.toContain('get_seework_task')
    // Where the requests actually go, and the live model with its abilities.
    expect(text).toContain('http://127.0.0.1:8080/v1/images/generations')
    expect(text).toContain('http://127.0.0.1:8081/api/v1/catalog/models')
    expect(text).toContain('Seedream 5.0 Lite')
    expect(text).toContain('可带参考图')
    // The count is capped by the request builder, so the promise is capped too.
    expect(text).toContain('一次最多 10 张')
    // Where the user finds the results and how the plugin is reached.
    expect(text).toContain('素材库')
    expect(text).toContain('画布')
    expect(text).toContain('设置 → 插件 → SeeWork')
    // Parameter facts are not the announcement's job: model-declared extras
    // (`watermark` and friends) are not something this plugin can send at all
    // (#659), so no plugin-level sentence about them belongs here either.
    expect(text).not.toContain('默认不加水印')
    // The plugin-level half of the concurrency and cost facts: the rule itself
    // stays here, while what to DO about a failure is stated once, in the tool.
    expect(text).toContain('一次调用就是一次生成请求，同一模型同时只允许 1 个')
    expect(text).toContain('插件不排队、不自动重试')
    expect(text).not.toContain('请勿重试')
    expect(text).not.toContain('等它结束后再试')
    // The one instruction out of the announcement: the plugin's own procedure,
    // in the skill. Since #661 there is deliberately **no** guide pointer (the
    // plugin cannot send an extra field, so a pointer would only suggest a route
    // that does not exist) — and since #665 the skill is not a "look over there
    // if you want" pointer either: the announcement orders the load by name.
    expect(text).not.toContain('引导文档')
    expect(text).not.toContain('/guide')
    expect(text).toContain(`先加载技能 \`${SKILL_NAME}\``)
    expect(text).not.toContain('看 SeeWork 技能')
    // The capability boundary is stated as a plugin-level fact (#659 / #661).
    expect(text).toContain('插件只发五个常规参数')
    expect(text).not.toContain('quality')
    expect(text).toContain('模型特有的额外字段插件不发')
    // The image count is named after the gateway field the plugin actually sends,
    // and it is the upstream model's own capability: one call can come back with
    // several pictures, so the tool's `n` description must send the model to the
    // prompt for variety and to `n` for the count. Telling it to "use separate
    // calls for different pictures" is what caused the original incident — one
    // request turned into four — so its return is a regression, not a rewording.
    expect(text).not.toContain('分别调用')
    expect(text).not.toContain('同一条提示词')
    // The agent has no tool that reads the catalog, so the announcement must not
    // send it there on its own — and since #661 it does not point at a model's
    // guide document either.
    expect(text).not.toContain('看目录')
    // And it must not leak the key.
    expect(text).not.toContain('sk-x')
  })

  /** One model row with every field the announcement reads. */
  function configuredModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
    return {
      id: 'gemini-3-1-flash-image',
      label: 'Gemini 3.1 Flash Image',
      // The declared order, lowest first — `512` is the cheapest tier, not the
      // "highest" (catalog v2 publishes the ranking as the array order).
      resolutions: ['512', '1K', '2K', '4K'],
      resolutionDefault: '512',
      aspectRatios: ['1:1'],
      outputFormats: ['png'],
      maxImages: 1,
      maxReferenceImages: 0,
      capabilitiesKnown: true,
      ...overrides,
    }
  }

  /** The argument descriptions of one tool, keyed by argument name. */
  function argumentDescriptions(tool: RegisteredTool): Record<string, string> {
    const properties = tool.parameters.properties ?? {}
    return Object.fromEntries(Object.entries(properties).map(([name, node]) => [
      name,
      String((node as { description?: string }).description ?? ''),
    ]))
  }

  /**
   * The sentences that **really were** in the old announcement, paired with the
   * tool that now owns them.
   *
   * The list is deliberately restricted to strings the pre-#651 announcement
   * contained: an assertion that a never-used phrase is absent from the new text
   * can never fail, so it would look like AC-3 coverage while proving nothing.
   * Each `was` is quoted from the previous wording, each `now` from the new tool
   * description — so this one table asserts both halves of the move (gone from
   * the announcement, present in the tool) and AC-5's "exactly one home" with it.
   */
  const MOVED = [
    { was: '撞上时**请勿重试**、等它结束再发', now: 'neither queues nor retries' },
    { was: '请在回复正文里用 Markdown 图片语法', now: 'show the finished picture in your own reply' },
    { was: '你看不到图片本身，用户问「图在哪」时用它们回答', now: 'quote those fields when the user asks where an image is' },
    { was: '把上一次结果里的 images 引用原样传给 reference_images', now: 'exactly as you received it' },
  ]

  it('keeps the moved tool-level sentences out of the announcement, and in the tools that own them', () => {
    // AC-3 / AC-5: a sentence that moved must be deleted where it came from AND
    // readable where it went. Two homes is how the two drift apart — the failure
    // this batch exists to stop; zero homes is how the announcement-off state
    // loses the instruction entirely.
    const harness = assemble({
      apiUrl: 'http://127.0.0.1:8080/v1',
      serviceUrl: 'http://127.0.0.1:8081',
      apiKey: 'sk-x',
      models: [{ ...configuredModel(), maxImages: 15, maxReferenceImages: 14 }],
      defaultModel: 'gemini-3-1-flash-image',
    })
    const text = harness.sections.find(section => !section.disposed)!.text
    const toolText = harness.tools
      .map(tool => [tool.description, ...Object.values(argumentDescriptions(tool))].join('\n'))
      .join('\n')
    for (const { was, now } of MOVED) {
      expect(text, `the announcement still carries: ${was}`).not.toContain(was)
      expect(toolText, `no tool carries: ${now}`).toContain(now)
    }
  })

  it('carries the tool-level conventions in the tool description', () => {
    // AC-1: the tool description is resident with the tool definition and is NOT
    // governed by `announceToAgent`, so it is where a call/result convention has
    // to live — see the "announcement off" check below. Since #664 there is one
    // description rather than two, so there is exactly one home for these.
    const harness = assemble()
    const generate = harness.tools.find(tool => tool.name === 'generate_image')!
    const args = argumentDescriptions(generate)

    // Whose sentence is whose: the generator owns the whole send/receive
    // contract. Whole phrases rather than bare words — `file`, `url` and `path`
    // each occur elsewhere in the description, so a one-word check survives
    // deleting the sentence that actually documents them.
    for (const phrase of [
      'synchronous',
      'One call is one generation request',
      'neither queues nor retries',
      'send another only after the user asks for it',
      // The capability boundary is a resident fact of the tool definition
      // (#659 / #661): the announcement can be switched off, this text cannot.
      // #664: the same description has to say what the optional reference list
      // turns the call into — there is no second tool left to say it.
      'With `reference_images` this call edits those images; without it, it generates from the prompt alone',
      'quote those fields when the user asks where an image is',
      '`file` (library file name)',
      '`path` (absolute path on this machine)',
      'a fully qualified http URL',
      '![short description](absolute_url)',
    ]) {
      expect(generate.description, `generate_image is missing ${phrase}`)
        .toContain(phrase)
    }
    // …including the defaults a caller may omit. The values are read from their
    // owner, never typed a second time.
    expect(args.aspect_ratio).toContain('Aspect ratio: 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9')
    expect(args.aspect_ratio).toContain(`Default ${DEFAULT_ASPECT_RATIO}`)
    expect(args.resolution).toContain('Omit to use the default tier the catalog declares for this model')
    // #661: `quality` is not an argument any more, so there is no description to
    // assert — the absence is the fact.
    expect(args).not.toHaveProperty('quality')
    expect(args.n).toContain('Default 1')
    expect(args.n).toContain('confirm with the user before requesting more')
    expect(args.output_format).toContain(`Default ${DEFAULT_OUTPUT_FORMAT}`)
    // ...and the passthrough channel is gone: the schema may not offer a way to
    // send a field the five regular arguments do not name (#659 / #661 / AC-1).
    expect(generate.parameters.properties).not.toHaveProperty('params')
    // The argument set with `reference_images` in it — the only optional one
    // (#664 / AC-2).
    expect(Object.keys(argumentDescriptions(generate)).sort())
      .toEqual(['aspect_ratio', 'model', 'n', 'output_format', 'prompt', 'reference_images', 'resolution'])
    // …the reference list owns passing a previous result back unchanged, and says
    // that omitting it means text-to-image (moved here from the deleted second
    // tool's description).
    expect(args.reference_images).toContain('Optional')
    expect(args.reference_images).toContain('exactly as you received it')
    expect(args.reference_images).toContain('upload')
    expect(args.reference_images).toContain('text-to-image')
    // …and the tool carries no plugin-level facts: those would eat the
    // attention the model spends choosing a tool in the first place.
    for (const pluginFact of ['素材库', '设置 → 插件', 'http://127.0.0.1:8080']) {
      expect(generate.description).not.toContain(pluginFact)
    }
  })

  it('leaves the tool definitions untouched by a settings commit', () => {
    // AC-4: a description is a constant. Configuration-dependent wording here
    // would force the plugin to re-register the tools on every commit, so this
    // asserts both the text and the registered identity across a commit that
    // changes the model list.
    const harness = assemble({
      apiKey: 'sk-x',
      models: [configuredModel()],
      defaultModel: 'gemini-3-1-flash-image',
    })
    harness.attachSettings()
    const before = harness.tools.map(tool => `${tool.name}:${tool.description}`)
    const generateBefore = harness.tools.find(tool => tool.name === 'generate_image')!

    Object.assign(harness.document, {
      models: [configuredModel({ id: 'other-model', label: 'Other Model' })],
      defaultModel: 'other-model',
    })
    harness.commit()

    expect(harness.tools.map(tool => `${tool.name}:${tool.description}`)).toEqual(before)
    expect(harness.tools.find(tool => tool.name === 'generate_image')).toBe(generateBefore)
  })

  it('stays usable with the announcement off: the tool definitions are the whole of it', async () => {
    // AC-2 — the point of the batch. With `announceToAgent=false` there is no
    // announcement at all, so "can the model still recognize and use the
    // plugin?" reduces to what the tool definitions carry: their descriptions
    // *and* their argument descriptions, which is what the model receives.
    const harness = assemble({ announceToAgent: false, apiKey: 'sk-x', models: [configuredModel()] })
    harness.attachSettings()
    expect(harness.sections.filter(section => !section.disposed)).toHaveLength(0)

    const definitions = harness.tools
      .map(tool => [tool.description, ...Object.values(argumentDescriptions(tool))].join('\n'))
      .join('\n')
    for (const point of [
      'One call is one generation request',
      'neither queues nor retries',
      'send another only after the user asks for it',
      // The capability boundary is a *tool-level* fact (#659 / #661): the
      // announcement cannot carry it for this state, because there is no
      // announcement.
      // #664: the edit-vs-generate semantics is a tool-level fact too, so it has
      // to survive here — the announcement is what carried the tool names.
      'With `reference_images` this call edits those images; without it, it generates from the prompt alone',
      'quote those fields when the user asks where an image is',
      'markdown image',
      'Default 1',
    ]) {
      expect(definitions).toContain(point)
    }
    // The identifier still resolves to the registered tool: this is what the
    // model needs in order to name a tool at all. Since #664 it is the only one.
    expect(harness.tools.map(tool => tool.name)).toEqual(['generate_image'])

    // The skill body is the other prose carrier left with the announcement off.
    // It is a fixed document, and since #666 it carries the generation
    // procedure (understand → infer → confirm → generate) rather than the
    // retired capability boundary; since #661 it points nowhere for extra
    // fields.
    const skill = await readFile(new URL('../assets/seework-image-capabilities.md', import.meta.url), 'utf8')
    expect(skill).not.toContain('| `params` |')
    expect(skill).toContain('理解 → 推断 → 确认 → 生成')
    expect(skill).toContain('确认后生成')
    expect(skill).not.toContain('/guide')
    // AC-1: the retired tool name is gone from the skill too.
    expect(skill).not.toContain('edit_image')
    // Nothing about it may claim to be computed at load time.
    expect(skill).not.toContain('动态表')
    expect(skill).not.toContain('每次加载')
  })

  it('grows by identifiers only when more models are saved', () => {
    // AC-1: the announcement is the every-turn cost, so a model the agent never
    // uses must cost one identifier — not five capability items.
    const identifierOf = (index: number): string => `Image Model ${index}[image-model-${index}]`
    const document = (count: number): Config => ({
      apiKey: 'sk-x',
      models: Array.from({ length: count }, (_unused, at) => configuredModel({
        id: `image-model-${at + 1}`,
        label: `Image Model ${at + 1}`,
        // Nonsense values only that model has: if any of them leaks into the
        // announcement, the assertions below see it.
        resolutions: [`tier-${at + 1}`],
        aspectRatios: [`ratio-${at + 1}`],
        maxReferenceImages: at + 1,
        maxImages: at + 1,
      })),
      defaultModel: 'image-model-1',
    })
    const two = guidanceFor(effectiveConfig(document(2)))
    const ten = guidanceFor(effectiveConfig(document(10)))
    const othersOf = (count: number): string =>
      Array.from({ length: count - 1 }, (_unused, at) => identifierOf(at + 2)).join('；')
    // The whole difference between the two announcements is the identifier list.
    expect(ten).toBe(two.replace(othersOf(2), othersOf(10)))
    for (let index = 2; index <= 10; index += 1) {
      const line = capabilityLineFor(configuredModel({
        id: `image-model-${index}`,
        label: `Image Model ${index}`,
        resolutions: [`tier-${index}`],
        aspectRatios: [`ratio-${index}`],
        maxImages: index,
        maxReferenceImages: index,
      }))
      expect(ten).not.toContain(line)
    }
    // The remaining instruction out of the announcement: load the plugin's own
    // procedure before generating (#665).
    expect(ten).not.toContain('引导文档')
    expect(ten).toContain(`先加载技能 \`${SKILL_NAME}\``)
  })

  it('shows one capability line for the default model, with the degraded wording', () => {
    const document = (overrides: Partial<ModelConfig>): Config => ({
      apiKey: 'sk-x',
      models: [configuredModel(overrides)],
      defaultModel: 'gemini-3-1-flash-image',
    })
    // Capability line: tier order, ratios, reference cap and the request
    // builder's own cap (15 images in the catalog still means 10 per request).
    const text = guidanceFor(effectiveConfig(document({ maxImages: 15 })))
    expect(text).toContain('默认模型：Gemini 3.1 Flash Image[gemini-3-1-flash-image]（默认）')
    expect(text).toContain('一次最多 10 张')
    expect(text).toContain('比例 1:1')
    expect(text).toContain('仅文生图')

    // The declared order is the ranking, read verbatim (#663/P2, AC-3): `512`
    // is the lowest tier here, so the line may state the ranking as published.
    const ordered = guidanceFor(effectiveConfig(document({})))
    expect(ordered).toContain('档位 512/1K/2K/4K（低到高）')
    expect(ordered).not.toContain('顺序未知')

    // A model whose contract declared no default tier: the plugin omits the
    // field rather than guessing one, and the line says so (#663/P3).
    const noDefault = guidanceFor(effectiveConfig(document({ resolutionDefault: '' })))
    expect(noDefault).toContain('档位 512/1K/2K/4K（低到高）')
    expect(noDefault).toContain('目录未提供缺省档')

    // A model the catalog never described is announced as unknown, not as an
    // empty capability set (degraded state 4).
    const unknown = guidanceFor(effectiveConfig(document({ capabilitiesKnown: false, resolutions: [] })))
    expect(unknown).toContain('细节未知')
    expect(unknown).not.toContain('档位由上游决定，比例由上游决定')
  })

  it('tells the agent where to configure the plugin when it is not set up yet', () => {
    const text = guidanceFor(effectiveConfig({}))
    expect(text).toContain('SeeWork')
    // The sidebar entry, not a floating button most hosts never show.
    expect(text).toContain('设置 → 插件 → SeeWork')
    expect(text).toContain('侧边栏')
    // The skill order survives in this branch too, so it is already in force by
    // the time the connection is filled in (#665).
    expect(text).toContain(`先加载技能 \`${SKILL_NAME}\``)
  })

  it('keeps the configuration guidance when only the key is missing', () => {
    // Clearing the key leaves the saved selection in the settings document; the
    // announcement must still route the user to the settings (and order the
    // skill load) rather than pretending a model table is usable.
    const text = guidanceFor(effectiveConfig({
      models: [configuredModel()],
      defaultModel: 'gemini-3-1-flash-image',
    }))
    expect(text).toContain('尚未配置完成')
    expect(text).toContain('设置 → 插件 → SeeWork')
    expect(text).toContain(`先加载技能 \`${SKILL_NAME}\``)
  })

  it('orders the skill load in the announcement and in the tool description (#665 / AC-3, AC-4)', () => {
    // Both carriers say the same thing with the same name: the announcement is
    // what the agent sees every turn, the tool description is what survives when
    // the user turns the announcement off. Neither may soften it into "the
    // details are in the skill".
    const harness = assemble({
      apiKey: 'sk-x',
      models: [configuredModel()],
      defaultModel: 'gemini-3-1-flash-image',
    })
    const announcement = harness.sections.find(section => !section.disposed)!.text
    const generate = harness.tools.find(tool => tool.name === 'generate_image')!

    expect(announcement).toContain(`先加载技能 \`${SKILL_NAME}\``)
    expect(announcement).not.toContain('看 SeeWork 技能')
    expect(generate.description).toContain(`load the skill \`${SKILL_NAME}\` first`)
    // AC-4: `SEEWORK_GUIDANCE` is the shared half both branches interpolate, so
    // the order is in the unconfigured branch as well.
    expect(SEEWORK_GUIDANCE).toContain(`先加载技能 \`${SKILL_NAME}\``)
    const unconfigured = guidanceFor(effectiveConfig({}))
    expect(unconfigured).toContain(`先加载技能 \`${SKILL_NAME}\``)
  })

  it('announces the plugin to the agent', () => {
    const harness = assemble({ apiKey: 'sk-x', models: [] })
    const live = harness.sections.filter(section => !section.disposed)
    expect(live).toHaveLength(1)
    expect(live[0]!.name).toBe('plugin:dsh-seework')
    expect(live[0]!.text).toContain('SeeWork')
  })

  it('leaves the announcement out when the user turned it off', () => {
    const harness = assemble({ announceToAgent: false })
    expect(harness.sections.filter(section => !section.disposed)).toHaveLength(0)
  })

  it('takes the retired master switch out of a document that still carries it', () => {
    // The plugin no longer reads `enabled`, so leaving it in the file would keep
    // claiming a switch nothing acts on (#5). A host that validates strictly may
    // already have dropped it, in which case there is nothing to take out.
    const harness = assemble({ enabled: false } as unknown as Config)
    harness.attachSettings()
    expect(harness.mutations).toEqual([{ ops: [{ op: 'unset', path: ['enabled'] }] }])

    const clean = assemble()
    clean.attachSettings()
    expect(clean.mutations).toEqual([])
  })

  it('registers no routes until a settings provider is attached', () => {    // Without the provider there is no namespace to bridge, and the routes
    // would have nothing to read — the settings card could not configure
    // anything either, so this is the honest degradation.
    const harness = assemble()
    expect(harness.routes).toHaveLength(0)
    harness.attachSettings()
    expect(harness.routes.length).toBeGreaterThan(0)
  })

  it('registers the whole route family exactly once when the provider attaches', () => {
    const harness = assemble()
    harness.attachSettings()
    const paths = harness.routes.map(route => route.path)
    for (const expected of [
      '/api/dsh-seework/settings/describe',
      '/api/dsh-seework/settings/mutate',
      '/api/dsh-seework/settings/directory-picker',
      '/api/dsh-seework/settings/pick-directory',
      '/api/dsh-seework/catalog/models',
      '/api/dsh-seework/catalog/refresh',
      '/api/dsh-seework/generate',
      '/api/dsh-seework/tasks/list',
      '/api/dsh-seework/tasks/cancel',
      '/api/dsh-seework/library/list',
      '/api/dsh-seework/library/remove',
      '/api/dsh-seework/library/clear',
      '/api/dsh-seework/library/image',
      '/api/dsh-seework/attachment/image',
      '/api/dsh-seework/canvas/list',
      '/api/dsh-seework/canvas/create',
      '/api/dsh-seework/canvas/read',
      '/api/dsh-seework/canvas/save',
      '/api/dsh-seework/canvas/remove',
      '/api/dsh-seework/canvas/asset',
      '/api/dsh-seework/canvas/asset/remove',
      '/api/dsh-seework/canvas/assets',
      '/api/dsh-seework/canvas/assets/prune',
    ]) {
      expect(paths).toContain(expected)
    }
    // Every other path is registered exactly once; `canvas/asset` is deliberately
    // registered twice — exact for the write, prefix for reading a stored file.
    const duplicated = [...new Set(paths.filter((path, index) => paths.indexOf(path) !== index))]
    expect(duplicated).toEqual(['/api/dsh-seework/canvas/asset'])
    // `asset/remove` is an exact route registered BEFORE the `asset` prefix, so a
    // matcher that walks the table in order reads it as an operation, not a file.
    const removeAt = paths.indexOf('/api/dsh-seework/canvas/asset/remove')
    const prefixAt = harness.routes.findIndex(route => route.kind === 'prefix' && route.path === '/api/dsh-seework/canvas/asset')
    expect(removeAt).toBeGreaterThanOrEqual(0)
    expect(removeAt).toBeLessThan(prefixAt)
    // The image families are prefix routes (a file name / a query); the rest are
    // exact. `canvas/asset` is both: exact for the write, prefix for the read.
    const prefixRoutes = harness.routes.filter(route => route.kind === 'prefix').map(route => route.path)
    expect(prefixRoutes).toEqual([
      '/api/dsh-seework/library/image',
      '/api/dsh-seework/attachment/image',
      '/api/dsh-seework/canvas/asset',
    ])
  })

  it('opens an effect for every surface it owns, with a label for diagnostics', () => {
    const harness = assemble()
    const labels = harness.effects.map(effect => effect.label)
    expect(labels).toContain('dsh-seework: agent image tools')
    expect(labels).toContain('dsh-seework: announcement teardown')
    expect(labels.every(label => label !== undefined)).toBe(true)
    // Route registration only exists once the settings service is attached.
    expect(labels).not.toContain('dsh-seework: routes')
    harness.attachSettings()
    expect(harness.effects.map(effect => effect.label)).toContain('dsh-seework: routes')
    // The automatic catalog detection (#652) follows the settings provider too:
    // it writes adopted capabilities through the same seam.
    expect(harness.effects.map(effect => effect.label)).toContain('dsh-seework: automatic catalog detection')
  })

  it('runs one round at startup and starts the background timer, stopping it on unload (#652)', async () => {
    // AC-1 / AC-9: the wiring itself, not just the refresher object. A stub
    // factory is injected so this can assert *what the plugin calls* without
    // discovery reaching for the network in a unit test.
    const calls: string[] = []
    let stopped = 0
    let seenDeps: CatalogRefresherDeps | undefined
    const stubFactory: RefresherFactory = (deps) => {
      seenDeps = deps
      return {
        refresh: async () => { calls.push('refresh'); return { ran: true } },
        startBackground: () => { calls.push('startBackground'); return () => { stopped += 1 } },
      } satisfies CatalogRefresher
    }
    const harness = assemble({ apiKey: 'sk-x', models: [configuredModel()] }, stubFactory)
    // Nothing runs before the settings provider attaches: the refresher needs
    // that seam, and the plugin must keep mounting without it.
    expect(calls).toEqual([])
    harness.attachSettings()
    // The round is deliberately not awaited during activation, so let it settle.
    await vi.waitFor(() => { expect(calls).toContain('refresh') })
    expect(calls).toEqual(['refresh', 'startBackground'])
    // The deps the plugin handed over read the live settings document.
    expect(seenDeps!.resolveModels().map(model => model.id)).toEqual(['gemini-3-1-flash-image'])
    expect(seenDeps!.sources()).toMatchObject({ apiKey: 'sk-x' })

    harness.unload()
    expect(stopped).toBe(1)
  })
})

describe('settings namespace', () => {
  it('is the hyphenated identifier the shell accepts', () => {
    expect(SEEWORK_SETTINGS_NAMESPACE).toBe('dsh-seework')
  })
})
