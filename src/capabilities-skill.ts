/**
 * The plugin's bundled capability skill.
 *
 * Why a skill rather than a longer system prompt: the prompt announces *this
 * deployment* (which models exist right now, with which values), while the
 * skill carries the *procedure* — how to turn a request into a confirmed
 * generation or edit (understand, infer, confirm, generate): reading intent,
 * using `reference_images`, taking `n` / `resolution` / `aspect_ratio` from the
 * model schema, confirming before the first call, and iterating on a result.
 * The procedure is the same for every deployment, so it belongs in a skill the
 * agent loads on demand rather than in every request's prefix.
 *
 * The body is the packaged static document
 * (`assets/seework-image-capabilities.md`), read from disk on every load so the
 * shipped file — not a string baked into the bundle — is what an agent reads.
 * It carries **no** per-model data: what a given model accepts lives in the
 * tool schema and the catalog, and the body points there instead of caching a
 * copy (#666).
 *
 * The host's `SkillRegistry.get()` calls `provider.get()` on every load, while
 * the collected *catalog* (name + description and the candidate locator) is
 * cached and only invalidated when a provider registers or unregisters. That is
 * why `CANDIDATE` — including its `description` and `locator` — must be a
 * module-level constant: a description that carried the model count would stay
 * frozen at the moment of registration.
 *
 * Registration goes through the **optional** `skills` seam, never through the
 * host-half `inject` array: a host without a skill registry must keep mounting
 * the tools, routes, library and canvas (the same discipline `settings` and
 * `directoryPicker` follow).
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@deepseek-ai/dsh-skill'

/**
 * Precedence rank for a packaged skill provider.
 *
 * Mirrors `BUNDLED_SKILL_RANK` (600) from `@deepseek-ai/dsh-skill`, and the
 * import above stays **type-only** on purpose: a value import would turn the
 * host's skill package into a load-time dependency, so a deployment without a
 * skill subsystem would fail while *loading this plugin* — the optional
 * injection below cannot save it, because the module never gets that far. Rank
 * only orders skills that share a name, this plugin's name is unique, and a
 * drift in the constant is therefore harmless; an unresolvable import is not.
 */
const BUNDLED_SKILL_RANK = 600

/** Provider name this plugin registers in the host's skill registry. */
export const SKILL_PROVIDER = 'seework'

/** Skill name an agent or a user invokes. */
export const SKILL_NAME = 'seework-image-capabilities'

/** Packaged skill body; resolved beside the built bundle. */
const BODY_URL = new URL('../assets/seework-image-capabilities.md', import.meta.url)

/** Relative resources inside the skill resolve against the packaged assets. */
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const

/**
 * Routing description — **a constant, and deliberately free of data**.
 *
 * It has no model count and no model name: the host caches summaries and only
 * invalidates them when a provider registers or unregisters (see the module
 * comment), so anything data-dependent here would stay frozen at that moment.
 * What it does carry is the **order to load it before generating** (#665) —
 * the same instruction the announcement and `generate_image`'s description
 * give, so the model does not have to infer the skill's timing from a list of
 * "when to load" triggers — followed by the secondary triggers, because with
 * the announcement switched off (`announceToAgent=false`) this description is
 * the only pointer the model has to the capability surface at all.
 */
const CANDIDATE: SkillCandidate = {
  name: SKILL_NAME,
  description:
    '**Load this before generating or editing any image with the SeeWork plugin** (its tool is '
    + '`generate_image`). SeeWork image-generation manual: how to turn a user request into a '
    + 'confirmed generation or edit — understanding the visual intent, using the optional '
    + '`reference_images`, choosing `n` / `resolution` / `aspect_ratio` from the model schema, '
    + 'confirming the parsed task before the first call, and iterating on the result. Its '
    + 'secondary triggers: a different model was chosen, or the user asks why the plugin is not '
    + 'usable. Its body is a fixed procedure, not a data table.',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: SKILL_PROVIDER,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: BODY_URL,
}

/**
 * Build the provider for the packaged skill.
 *
 * Takes nothing: since #659 the body is a fixed file and the catalog entry is a
 * constant, so there is no settings input to thread in. The host still calls
 * `get()` on every load, which is what re-reads the file.
 *
 * @returns a provider whose catalog entry and body are both constant.
 */
export function createCapabilitiesSkillProvider(): SkillProvider {
  return {
    name: SKILL_PROVIDER,
    list: () => Promise.resolve([CANDIDATE]),
    async get(): Promise<SkillDefinition> {
      const body = await readFile(BODY_URL, 'utf8')
      // The contract fields are re-listed rather than spread from CANDIDATE:
      // `rank` and `locator` are discovery-time data, not part of a definition.
      return {
        name: CANDIDATE.name,
        description: CANDIDATE.description,
        invocation: CANDIDATE.invocation,
        provider: CANDIDATE.provider,
        source: CANDIDATE.source,
        resourceBase: CANDIDATE.resourceBase,
        content: body,
      }
    },
  }
}

/**
 * Register the bundled provider on the host's skill registry.
 *
 * @param ctx - a context whose `skills` service is attached.
 * @returns the disposer that removes this exact registration (the caller owns
 *   the `enabled` switch: flipping the plugin off unregisters the skill).
 */
export function registerCapabilitiesSkill(ctx: Context): () => void {
  return ctx.skills.registerProvider(() => createCapabilitiesSkillProvider())
}
