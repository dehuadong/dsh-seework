/**
 * The update check has to answer the card even when nothing can be checked, so
 * the degraded paths carry as much weight here as the happy one — a registry
 * that is down must read as a note, never as a broken settings page.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_REGISTRY,
  PACKAGE_NAME,
  UPDATE_SPEC,
  checkForUpdate,
  exemptVersion,
  latestVersionFrom,
  readInstallKind,
  registryOf,
} from './update.ts'

/** A profile directory whose manifest declares `spec` for this package. */
function profileDeclaring(spec: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), 'seework-profile-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-test',
    dependencies: spec === undefined ? {} : { [PACKAGE_NAME]: spec },
  }))
  return dir
}

/** A host seam: the registry answer plus the install call. */
function hostWith(registries: { registry?: string | null; resolved?: string | null } = {}) {
  return {
    registries: vi.fn(async () => ({
      registry: registries.registry === undefined ? 'https://registry.npmjs.org' : registries.registry,
      resolved: registries.resolved === undefined ? null : registries.resolved,
      fallbackRegistries: [],
    })),
    installBundle: vi.fn(async () => ({})),
  }
}

/** A fetch stub answering one `latest` document. */
function fetchAnswering(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch
}

describe('readInstallKind', () => {
  it('reads a file: spec as a local install', () => {
    expect(readInstallKind(profileDeclaring('file:E:/workspace/dsh-plugin/dsh-seework'))).toBe('local')
  })

  it('reads a version range as a registry install', () => {
    expect(readInstallKind(profileDeclaring('^0.2.0'))).toBe('registry')
    expect(readInstallKind(profileDeclaring('0.2.0'))).toBe('registry')
  })

  it('answers unknown for a profile that does not name the package', () => {
    expect(readInstallKind(profileDeclaring(undefined))).toBe('unknown')
  })

  it('answers unknown rather than throwing on an unreadable profile', () => {
    expect(readInstallKind(join(tmpdir(), 'seework-profile-does-not-exist'))).toBe('unknown')
  })
})

describe('registryOf', () => {
  it('prefers what pnpm itself resolved', () => {
    expect(registryOf({ registry: 'https://configured.example', resolved: 'https://resolved.example' }))
      .toBe('https://resolved.example')
  })

  it('falls back to the configured registry', () => {
    expect(registryOf({ registry: 'https://configured.example', resolved: null })).toBe('https://configured.example')
  })

  it('falls back to the public registry when the host names none', () => {
    expect(registryOf({ registry: null, resolved: null })).toBe(DEFAULT_REGISTRY)
  })
})

describe('latestVersionFrom', () => {
  it('reads the version out of the latest document', async () => {
    const version = await latestVersionFrom({
      registry: 'https://registry.npmjs.org',
      packageName: 'dsh-seework',
      fetchFn: fetchAnswering({ version: '0.2.0' }),
    })
    expect(version).toBe('0.2.0')
  })

  it('tolerates a trailing slash on the registry', async () => {
    const fetchFn = fetchAnswering({ version: '0.2.0' })
    await latestVersionFrom({ registry: 'https://r.example/', packageName: 'dsh-seework', fetchFn })
    expect(fetchFn).toHaveBeenCalledWith('https://r.example/dsh-seework/latest', expect.anything())
  })

  it('escapes a scope separator for the URL', async () => {
    const fetchFn = fetchAnswering({ version: '0.2.0' })
    await latestVersionFrom({ registry: 'https://r.example', packageName: '@scope/pkg', fetchFn })
    expect(fetchFn).toHaveBeenCalledWith('https://r.example/@scope%2Fpkg/latest', expect.anything())
  })

  it('throws on a non-2xx answer', async () => {
    await expect(latestVersionFrom({
      registry: 'https://r.example',
      packageName: 'dsh-seework',
      fetchFn: fetchAnswering({}, 404),
    })).rejects.toThrow('404')
  })

  it('throws when the document carries no version', async () => {
    await expect(latestVersionFrom({
      registry: 'https://r.example',
      packageName: 'dsh-seework',
      fetchFn: fetchAnswering({}),
    })).rejects.toThrow()
  })
})

describe('checkForUpdate', () => {
  it('offers an update when the registry is ahead', async () => {
    const status = await checkForUpdate({
      host: hostWith(),
      current: '0.1.0',
      kind: 'registry',
      fetchFn: fetchAnswering({ version: '0.2.0' }),
    })
    expect(status).toMatchObject({ current: '0.1.0', latest: '0.2.0', kind: 'registry', updateAvailable: true })
    expect(status.error).toBeUndefined()
  })

  it('reports up to date when the registry matches', async () => {
    const status = await checkForUpdate({
      host: hostWith(),
      current: '0.1.0',
      kind: 'registry',
      fetchFn: fetchAnswering({ version: '0.1.0' }),
    })
    expect(status.updateAvailable).toBe(false)
    expect(status.latest).toBe('0.1.0')
  })

  it('does not offer a prerelease of the running version', async () => {
    const status = await checkForUpdate({
      host: hostWith(),
      current: '1.0.0',
      kind: 'registry',
      fetchFn: fetchAnswering({ version: '1.0.0-rc.1' }),
    })
    expect(status.updateAvailable).toBe(false)
  })

  it('asks the registry the host named, not a hard-coded one', async () => {
    const fetchFn = fetchAnswering({ version: '0.2.0' })
    await checkForUpdate({
      host: hostWith({ registry: 'https://mirror.example', resolved: null }),
      current: '0.1.0',
      kind: 'registry',
      fetchFn,
    })
    expect(fetchFn).toHaveBeenCalledWith('https://mirror.example/dsh-seework/latest', expect.anything())
  })

  it('stops at a local install without asking anyone', async () => {
    const host = hostWith()
    const status = await checkForUpdate({
      host,
      current: '0.1.0',
      kind: 'local',
      fetchFn: fetchAnswering({ version: '9.9.9' }),
    })
    expect(host.registries).not.toHaveBeenCalled()
    expect(status).toMatchObject({ kind: 'local', updateAvailable: false })
    // A local install is a normal state, not a failure: the card says so and stops.
    expect(status.error).toBeUndefined()
  })

  it('reports a missing plugin manager instead of throwing', async () => {
    const status = await checkForUpdate({ host: undefined, current: '0.1.0', kind: 'registry' })
    expect(status.error).toBeDefined()
    expect(status.updateAvailable).toBe(false)
  })

  it('reports an unreachable registry instead of failing the card', async () => {
    const status = await checkForUpdate({
      host: hostWith(),
      current: '0.1.0',
      kind: 'registry',
      fetchFn: (async () => { throw new Error('registry unreachable') }) as unknown as typeof fetch,
    })
    expect(status.error).toBe('registry unreachable')
    expect(status.updateAvailable).toBe(false)
  })

  it('reports an unparseable answer as an error, not as up to date', async () => {
    const status = await checkForUpdate({
      host: hostWith(),
      current: '0.1.0',
      kind: 'registry',
      fetchFn: fetchAnswering({ version: 'latest' }),
    })
    expect(status.error).toBeDefined()
    expect(status.updateAvailable).toBe(false)
  })
})

describe('UPDATE_SPEC', () => {
  it('names the package with @latest', () => {
    // The manager locates the dependency it just changed, and falls back to
    // `spec.startsWith('包名@')` when the declaration did not change. A bare
    // package name misses that fallback and the install is refused as ambiguous.
    expect(UPDATE_SPEC).toBe(`${PACKAGE_NAME}@latest`)
  })
})

/** A profile directory holding the given `pnpm-workspace.yaml`, when any. */
function profileWithWorkspace(text: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), 'seework-workspace-'))
  if (text !== undefined) writeFileSync(join(dir, 'pnpm-workspace.yaml'), text)
  return dir
}

/** The profile's workspace file, read back. */
function workspaceOf(dir: string): string {
  return readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')
}

describe('exemptVersion', () => {
  // pnpm 11 refuses to install a version published less than `minimumReleaseAge`
  // ago (24h by default) and records what it *has* accepted in
  // `minimumReleaseAgeExclude`. An update always targets a version newer than
  // that, so without this the update path can never install anything on release
  // day — which is exactly what happened before it existed.

  it('adds the block when the profile has none', async () => {
    const dir = profileWithWorkspace('packages:\n  - .\n\nnodeLinker: hoisted\n')
    const changed = await exemptVersion(dir, PACKAGE_NAME, '0.2.0')
    expect(changed).toBe(true)
    const text = workspaceOf(dir)
    expect(text).toContain('minimumReleaseAgeExclude:')
    expect(text).toContain(`  - ${PACKAGE_NAME}@0.2.0`)
    // Everything the profile already said is still there.
    expect(text).toContain('nodeLinker: hoisted')
  })

  it('appends to the block pnpm itself wrote', async () => {
    const dir = profileWithWorkspace(
      'packages:\n  - .\n\nminimumReleaseAgeExclude:\n  - dsh-seework@0.1.0\n',
    )
    await exemptVersion(dir, PACKAGE_NAME, '0.2.0')
    const text = workspaceOf(dir)
    expect(text).toContain('  - dsh-seework@0.1.0')
    expect(text).toContain('  - dsh-seework@0.2.0')
    // One block, not two.
    expect(text.match(/minimumReleaseAgeExclude:/g)).toHaveLength(1)
  })

  it('changes nothing when that exact version is already exempt', async () => {
    const dir = profileWithWorkspace(
      'packages:\n  - .\n\nminimumReleaseAgeExclude:\n  - dsh-seework@0.2.0\n',
    )
    const changed = await exemptVersion(dir, PACKAGE_NAME, '0.2.0')
    expect(changed).toBe(false)
  })

  it('does not mistake a shorter version for the one asked about', async () => {
    // `dsh-seework@0.2` is a different entry from `dsh-seework@0.2.0`; a
    // substring check would treat the second as already exempt and leave the
    // real version gated.
    const dir = profileWithWorkspace(
      'packages:\n  - .\n\nminimumReleaseAgeExclude:\n  - dsh-seework@0.2\n',
    )
    const changed = await exemptVersion(dir, PACKAGE_NAME, '0.2.0')
    expect(changed).toBe(true)
    expect(workspaceOf(dir)).toContain('  - dsh-seework@0.2.0')
  })

  it('is a no-op on a profile without a workspace file', async () => {
    const dir = profileWithWorkspace(undefined)
    await expect(exemptVersion(dir, PACKAGE_NAME, '0.2.0')).resolves.toBe(false)
  })
})
