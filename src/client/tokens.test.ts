/**
 * @vitest-environment jsdom
 *
 * Design-token guard.
 *
 * The first shipped version referenced tokens that do not exist in the shell
 * (`--dsw-alias-text-primary`, `--dsw-alias-bg-elevated`, …). A CSS custom
 * property with no definition is not an error — it just falls back — so every
 * control silently painted a hardcoded dark colour and the light theme came out
 * dark-on-dark. That is invisible to type-checking and to rendering tests, so
 * this test reads the shell's own theme bundle and asserts that every token this
 * plugin references is one the shell actually defines.
 *
 * When the theme bundle cannot be found (a different installation layout), the
 * check is skipped rather than failing: the plugin must still build and test on
 * a machine without a DSH profile.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Locate the shell theme bundle that defines the `--dsw-*` tokens. */
function themeBundle(): string | undefined {
  const dshHome = process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh')
  const roots = [
    path.join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'),
    path.join(dshHome, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'),
  ]
  for (const candidate of roots) {
    try {
      readFileSync(candidate)
      return candidate
    } catch {
      // try the next location
    }
  }
  return undefined
}

/** Every `--dsw-*` token name these stylesheets reference. */
function referencedTokens(): Map<string, string> {
  const dir = path.join(process.cwd(), 'src', 'client')
  const tokens = new Map<string, string>()
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.css')) continue
    const css = readFileSync(path.join(dir, name), 'utf8')
    // Skip comments: this file's own prose mentions the bad names on purpose.
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of body.matchAll(/(--dsw-[a-z0-9-]+)\s*[,)]/g)) {
      if (!tokens.has(match[1])) tokens.set(match[1], name)
    }
  }
  return tokens
}

const bundle = themeBundle()

describe('design tokens', () => {
  it('references at least the tokens the panels need', () => {
    const tokens = referencedTokens()
    expect(tokens.size).toBeGreaterThan(4)
    expect([...tokens.keys()]).toContain('--dsw-alias-label-primary')
  })

  it.skipIf(bundle === undefined)('only uses tokens the shell theme defines', () => {
    const theme = readFileSync(bundle!, 'utf8')
    const defined = new Set([...theme.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map(match => match[1]))
    const unknown = [...referencedTokens()].filter(([token]) => !defined.has(token))
    expect(unknown, `未定义的令牌（会静默回退成硬编码颜色）：${unknown.map(([t, f]) => `${t} (${f})`).join(', ')}`)
      .toEqual([])
  })

  it('every referenced token carries a fallback value', () => {
    // A missing variable plus a missing fallback yields an invalid declaration
    // (transparent background, or the previous colour) — always give one.
    const dir = path.join(process.cwd(), 'src', 'client')
    const offenders: string[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.css')) continue
      const body = readFileSync(path.join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      for (const match of body.matchAll(/var\((--dsw-[a-z0-9-]+)\s*\)/g)) {
        offenders.push(`${match[1]} (${name})`)
      }
    }
    expect(offenders, `这些 var() 缺少回退值：${offenders.join(', ')}`).toEqual([])
  })
})
