/**
 * The bundled capability skill (#650, fourth batch; static since #659; body
 * rewritten to the understand → infer → confirm → generate procedure in #666).
 *
 * The load-bearing properties are:
 *
 *  - the body is the **packaged process file verbatim** (so the shipped asset,
 *    not a string in the bundle, is what an agent reads) — a **fixed**
 *    document since #659: nothing is computed from the live settings;
 *  - the catalog entry — name, **description**, invocation, resourceBase and
 *    **locator** — is constant, because the host caches collected summaries and
 *    only invalidates them when a provider registers or unregisters;
 *  - the body holds **no per-model data** and promises none: it carries the
 *    procedure and sends the model to the **tool schema** and to **that model's
 *    schema** for every parameter value (#666);
 *  - the retired sections — the capability boundary ("sends only five regular
 *    parameters"), the tier-order rules and the configuration guide — are gone
 *    rather than restated (#666 / AC-1, AC-4).
 *
 * The last section uses the host's **real** `SkillRegistry`: the "body is read
 * from the packaged file, catalog is cached" split is an assumption about a
 * dependency, so it is pinned by an integration test rather than by our own
 * stub.
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry, type SkillCandidate } from '@deepseek-ai/dsh-skill'
import {
  createCapabilitiesSkillProvider,
  registerCapabilitiesSkill,
  SKILL_NAME,
  SKILL_PROVIDER,
} from './capabilities-skill.ts'

/** The packaged process file, read the same way the provider reads it. */
const ASSET_URL = new URL('../assets/seework-image-capabilities.md', import.meta.url)

/**
 * Vendor words that must never appear in **our own prose**, written the way the
 * guard compares them: letters and digits only.
 */
const VENDOR_WORDS = ['gptimage', 'seedream', 'gemini', 'doubao', 'dalle', 'flux', 'openai', 'google']

/**
 * Normalise a text for the vendor guard.
 *
 * Everything that is not a letter or a digit is dropped and case is folded, so
 * `gpt-image`, `gpt_image`, `gpt.image`, `GptImage` and `GPT IMAGE` are one
 * word, and `dall-e` / `dall·e` / `DALL E` collapse to `dalle`. Matching only
 * the hyphen spelling is exactly how an underscored product-profile reference
 * survived a "no vendor words" check once; folding only `_`/`-` still let
 * `gpt.image` and `GptImage` through.
 */
function normalised(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Whether a text is free of the vendor words our own prose must never carry. */
function freeOfVendorWords(text: string): boolean {
  const folded = normalised(text)
  return VENDOR_WORDS.every(word => !folded.includes(word))
}

/** Load the one candidate the provider publishes. */
async function candidatesOf(): Promise<readonly SkillCandidate[]> {
  const provider = createCapabilitiesSkillProvider()
  const listed = await provider.list({})
  return 'candidates' in listed ? listed.candidates : listed
}

/** The body a fresh provider serves. */
async function bodyOf(): Promise<string> {
  const provider = createCapabilitiesSkillProvider()
  const candidates = await candidatesOf()
  const definition = await provider.get(candidates[0]!, {})
  expect(definition).toBeDefined()
  return definition!.content
}

/** One `##` section of the body, up to the next `##` heading. */
function sectionOf(body: string, heading: string): string {
  const start = body.indexOf(heading)
  expect(start, `section ${heading} not found`).toBeGreaterThanOrEqual(0)
  const rest = body.slice(start + heading.length)
  const end = rest.indexOf('\n## ')
  return end < 0 ? rest : rest.slice(0, end)
}

describe('the bundled capability skill', () => {
  it('offers exactly one model-invocable skill under its own provider', async () => {
    const provider = createCapabilitiesSkillProvider()
    const candidates = await candidatesOf()
    expect(provider.name).toBe(SKILL_PROVIDER)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.name).toBe(SKILL_NAME)
    expect(candidates[0]!.invocation.modelInvocable).toBe(true)
    expect(candidates[0]!.invocation.userInvocable).toBe(true)
  })

  it('serves the packaged process file verbatim, with nothing appended', async () => {
    const asset = await readFile(ASSET_URL, 'utf8')
    const body = await bodyOf()
    // The shipped file — not a string compiled into the bundle — is the whole
    // body; if the asset stops shipping this fails here rather than at
    // load-in-conversation time.
    expect(body).toBe(asset)
    // ...and there is no second half any more (#659): no separator, no table.
    expect(body).not.toContain('\n---\n\n')
  })

  it('is a fixed body with no settings input at all (#659)', async () => {
    // The whole point of the de-dynamisation: the provider takes nothing, so
    // there is no way for a saved model (or the resolved catalog address) to
    // reach the body. Two independently built providers serve the same bytes,
    // and the asset itself carries no per-deployment value.
    const asset = await readFile(ASSET_URL, 'utf8')
    expect(await bodyOf()).toBe(asset)
    expect(await bodyOf()).toBe(asset)
    for (const perDeployment of ['image-model-a', 'image-model-b', 'hub.example.com', '127.0.0.1:8081/api']) {
      expect(asset).not.toContain(perDeployment)
    }
  })

  it('teaches the procedure without naming models', async () => {
    const asset = normalised(await readFile(ASSET_URL, 'utf8'))
    for (const word of VENDOR_WORDS) expect(asset).not.toContain(word)
    // The routing description is model-facing prose too, so it gets the same
    // guard.
    const candidates = await candidatesOf()
    const description = candidates[0]!.description
    expect(freeOfVendorWords(description)).toBe(true)
    expect(description).not.toContain('image-model')
    // #665: the catalog description is what the model reads while deciding
    // whether to load the skill, so it leads with the order to load it before
    // generating — the same instruction the announcement and the tool
    // description give — and demotes the old "when to load" triggers.
    expect(description).toContain('Load this before generating or editing')
    expect(description.indexOf('Load this before')).toBeLessThan(description.indexOf('secondary triggers'))
    // #666: the description must describe the body it actually fronts — it no
    // longer promises the retired sections (the "parameters they do NOT expose"
    // boundary or how the plugin is configured).
    expect(description).not.toContain('NOT expose')
    expect(description).not.toContain('configured')
    expect(description).toContain('confirming the parsed task before the first call')
  })

  it('catches every spelling of a vendor word, not just the hyphen one', () => {
    // The guard is only worth having if it bites the spellings that actually
    // slip through: separators other than `-`, camel case and case folding.
    // An underscored vendor reference reached the asset once; `gpt.image` and
    // `GptImage` slipped past the first version of this check.
    for (const spelling of ['gpt-image', 'gpt_image', 'gpt.image', 'GptImage', 'GPT IMAGE']) {
      expect(normalised(`${spelling}.sizes`)).toContain('gptimage')
      expect(freeOfVendorWords(`族档案 ${spelling}.sizes`)).toBe(false)
    }
    for (const spelling of ['dall-e', 'dall·e', 'DALL E', 'dalle']) {
      expect(freeOfVendorWords(`模型 ${spelling} 的档案`)).toBe(false)
    }
    expect(freeOfVendorWords('Open AI 的模型')).toBe(false)
    expect(freeOfVendorWords('openai')).toBe(false)
    // ...and it must not fire on a neutral sentence, or it would be noise.
    expect(freeOfVendorWords('一个中性的尺寸表描述')).toBe(true)
    expect(freeOfVendorWords('档位 1K/2K，比例 16:9')).toBe(true)
  })

  it('is organised around the new sections (#666 / AC-1)', async () => {
    const body = await bodyOf()
    for (const heading of [
      '## 核心行为',
      '## 参考图像',
      '## 提示词准备',
      '### 编辑',
      '## 参数',
      '### `n`',
      '### `resolution`',
      '### `aspect_ratio`',
      '## 确认',
      '## 迭代',
      '## 工具使用',
    ]) {
      expect(body, `section ${heading} not found`).toContain(heading)
    }
    // The retired sections must be gone, not re-titled.
    for (const retired of [
      '已看到什么',
      '参数与默认值以工具 schema 为准',
      '档位与组合',
      '还看不到什么',
      '什么时候来查',
      '怎么配置',
      '去哪儿查',
    ]) {
      expect(body, `retired section is back: ${retired}`).not.toContain(retired)
    }
  })

  it('drops the retired capability-boundary prose (#666 / AC-1, AC-4)', async () => {
    const body = await bodyOf()
    // The old body's reason to exist was stating the plugin's own boundary
    // ("sends only five regular parameters", "a model-specific field is never
    // sent"). #666 removed that class of statement outright — the tool schema
    // already lists what can be sent.
    for (const retired of [
      '本插件只发这五个常规参数',
      '本插件**一律不发**',
      '模型特有',
      '网关的答复是最终权威',
      '不要自动降级',
      '没有像素尺寸',
    ]) {
      expect(body, `the retired capability-boundary prose is back: ${retired}`).not.toContain(retired)
    }
    // #661 still holds: the body points nowhere for extra fields — this plugin
    // cannot send them, so a pointer would suggest a route that does not exist.
    expect(body).not.toContain('/guide')
    expect(body).not.toContain('web_fetch')
    expect(body).not.toContain('该模型的人读说明')
    // No channel of its own, and nothing that pretends the body is computed.
    expect(body).not.toContain('| `params` |')
    expect(body).not.toContain('动态表')
    expect(body).not.toContain('每次加载')
    // The retired family endpoint stays dead in our prose.
    expect(body).not.toContain('/catalog/semantics')
    expect(body).not.toContain('{该模型的 semantics}')
    expect(body).not.toContain('resolution_tiers')
  })

  it('takes every parameter value from the model schema (#666 / AC-2, AC-3)', async () => {
    const body = await bodyOf()
    // `resolution`: the value list is an example only, and the model's own
    // schema is the authority — including for the unspecified case, which this
    // document deliberately does NOT pin to a tier.
    const resolution = sectionOf(body, '### `resolution`')
    expect(resolution).toContain('示例')
    expect(resolution).toContain('实际按该模型支持的值')
    expect(resolution).toContain('该模型 schema 里的 `default`')
    for (const pinned of ['未指定时 2K', '缺省 2K', '默认 2K', '未指定=2K']) {
      expect(body, `a hard-coded default tier is back: ${pinned}`).not.toContain(pinned)
    }
    // `aspect_ratio`: concise — original ratio for edits, purpose for new
    // images, the schema for the values. The deleted example chain and the
    // four-step priority chain must not come back.
    const aspect = sectionOf(body, '### `aspect_ratio`')
    expect(aspect).toContain('优先沿用原图比例')
    expect(aspect).toContain('新图按预期用途或构图判断比例')
    expect(aspect).toContain('取值以该模型 schema 为准')
    for (const deleted of ['方形', '头像', '桌面', '手机', '优先级']) {
      expect(aspect, `the deleted aspect-ratio guidance is back: ${deleted}`).not.toContain(deleted)
    }
  })

  it('points at the tool schema instead of restating its parameters (#666 / AC-2)', async () => {
    // The second section used to carry a full second copy of the tool's
    // parameter table — argument, values, and what happens when it is omitted —
    // which is exactly what the tool schema (and the description beside it)
    // already says, every turn. One home only, so the two cannot drift.
    const body = await bodyOf()
    for (const restated of [
      '| 参数 | 作用 | 取值 | 不传时 |',
      '| `prompt` | 画面内容 |',
      '| `model` | 用哪个已保存模型 |',
      '| `n` | 这一次出几张 |',
      '| `resolution` | 档位（清晰度 / 尺寸档） |',
      '| `aspect_ratio` | 画面比例 |',
      '| `output_format` | 输出格式 |',
      '| `reference_images` | 可选：基于哪张图改',
      '不传时',
      '设置里的默认比例（出厂 `3:4`）',
      '设置里的「输出格式」（出厂 `png`）',
    ]) {
      expect(body, `the restated parameter table is back: ${restated}`).not.toContain(restated)
    }
    // What the body does say about parameters is the procedure: infer them,
    // take the values from the actual schema, confirm before calling.
    expect(body).toContain('从用户请求中推断生成参数')
    expect(body).toContain('以实际的 `generate_image` schema 为事实来源')
    expect(body).toContain('不要发明不受支持的参数或枚举值')
    // The process writing deleted in #661 must not come back with the table.
    for (const deleted of [
      '判档位高低的固定做法',
      '只是常见例子',
      '服务端取并集后会排序',
      '按数组位置判断',
      '为什么这样设计',
      '更高清',
      '最高清',
    ]) {
      expect(body, `deleted passage is back: ${deleted}`).not.toContain(deleted)
    }
    expect(body).not.toContain('| `quality` |')
    expect(body).not.toContain('由上游模型决定（等价 `auto`）')
    // #664: one tool now, and `reference_images` is its optional argument — the
    // retired tool name must be gone from the skill (AC-1).
    expect(body).not.toContain('edit_image')
  })

  it('keeps the confirmation flow and both examples (#666 / AC-5)', async () => {
    const body = await bodyOf()
    const confirm = sectionOf(body, '## 确认')
    // Both worked examples survive: one generation, one edit.
    expect(confirm).toContain('示例（生成）')
    expect(confirm).toContain('示例（编辑）')
    expect(confirm).toContain('可调整为 1K/4K 或其他支持的比例，确认后生成')
    expect(confirm).toContain('优先按原图比例适配，确认后生成')
    // ...and so do the authorization words and the one way past the gate.
    for (const word of ['`确认`', '`可以`', '`生成`', '`开始`', '`就这样`', '`按这个来`']) {
      expect(confirm, `authorization word ${word} is missing`).toContain(word)
    }
    expect(body).toContain('除非用户明确要求立即执行')
    expect(body).toContain('跳过确认时，直接执行')
    // References are reused, not re-requested.
    expect(body).toContain('不要再要求用户指认一遍')
    // Iteration reuses the context instead of asking for a full repeat.
    const iterate = sectionOf(body, '## 迭代')
    expect(iterate).toContain('不要要求用户重复完整的请求')
    for (const followUp of ['再亮一点', '背景简单一些', '改成晚上', '人物小一点', '再生成两个版本']) {
      expect(iterate).toContain(followUp)
    }
  })

  it('never touches the network while being served', async () => {
    // Discipline 3: the body reads the packaged file only. If it ever grew a
    // request, this is where it would show.
    const fetchMock = (() => { throw new Error('the skill must not touch the network') }) as unknown as typeof fetch
    const original = globalThis.fetch
    globalThis.fetch = fetchMock
    try {
      const body = await bodyOf()
      expect(body).toContain('以实际的 `generate_image` schema 为事实来源')
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('the real skill registry', () => {
  /** Register the bundled provider on a live registry. */
  function registered(): { registry: SkillRegistry; dispose: () => void } {
    const ctx = new Context()
    const registry = new SkillRegistry(ctx)
    const dispose = registerCapabilitiesSkill(ctx)
    return { registry, dispose }
  }

  it('reads the body from the packaged file on every load, while the catalog entry stays put', async () => {
    const { registry, dispose } = registered()
    try {
      const asset = await readFile(ASSET_URL, 'utf8')
      const first = await registry.get(SKILL_NAME)
      expect(first?.content).toBe(asset)
      // The host's collected catalog (name + description + locator) before the
      // second load; it is cached and only invalidated on register/unregister.
      const listedBefore = await registry.list()

      // A second load through the *same* registration: the host calls
      // `provider.get()` each time, so the body is re-read from the file.
      const second = await registry.get(SKILL_NAME)
      expect(second?.content).toBe(first?.content)
      expect(second?.content).toBe(asset)

      // The catalog half — including description and locator — is cached by the
      // host and must therefore be identical across loads.
      const listedAfter = await registry.list()
      expect(listedAfter).toEqual(listedBefore)
      expect(listedAfter[0]!.description).toBe(first?.description)
      // ...and it must not carry data: a description with the model count or a
      // model name would freeze here.
      expect(listedAfter[0]!.description).not.toContain('image-model')

      // The provider's own candidates (which carry the opaque locator the host
      // caches) are constants, so two independent providers agree exactly.
      const provider = createCapabilitiesSkillProvider()
      const fromProvider = await provider.list({})
      const candidates = 'candidates' in fromProvider ? fromProvider.candidates : fromProvider
      const other = await candidatesOf()
      expect(candidates).toEqual(other)
      expect(candidates[0]!.locator).toBe(other[0]!.locator)
      expect(candidates[0]!.description).toBe(other[0]!.description)
    } finally {
      dispose()
    }
  })

  it('disappears from the catalog when its registration is disposed', async () => {
    // What the plugin relies on for teardown: the disposer the registry hands back
    // removes the skill from the model-facing catalog.
    const { registry, dispose } = registered()
    expect(await registry.list()).toHaveLength(1)
    dispose()
    expect(await registry.list()).toHaveLength(0)
    expect(await registry.get(SKILL_NAME)).toBeUndefined()
  })
})
