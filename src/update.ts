/**
 * Update discovery for the published plugin, and the install that follows it.
 *
 * The check reads the registry's own `latest` document instead of going through
 * the host's `pluginManager.inspect`. That method answers "what does this spec
 * point at **before installing it**", so for a package that is already installed
 * it refuses with `already-installed` and never reports a version — which is
 * exactly the question an update check asks. The registry *address* still comes
 * from the host (`registries()`), so a configured mirror, proxy or private
 * registry is honoured; only the query itself is ours.
 */

import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { InstallKind, UpdateStatus } from './protocol.ts'
import { isNewer } from './version.ts'

/** The package name this plugin is published under. */
export const PACKAGE_NAME = 'dsh-seework'

/** Where to ask when the host names no registry. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

/** The spec an update installs. */
export const UPDATE_SPEC = `${PACKAGE_NAME}@latest`

export type { InstallKind, UpdateStatus }

/** The slice of the host's plugin manager this module uses. */
export interface UpdateHost {
  /** The registries this profile asks, in the order pnpm would. */
  registries(): Promise<{
    registry: string | null
    fallbackRegistries: readonly string[]
    resolved: string | null
  }>
  installBundle(spec: string): Promise<unknown>
}

/** One registry query. */
export interface RegistryQuery {
  /** Registry base URL, with or without a trailing slash. */
  registry: string
  /** Package name; a scope separator is escaped for the URL. */
  packageName: string
  /** Fetch implementation; the runtime's own by default, a stub in tests. */
  fetchFn?: typeof fetch
}

/**
 * Read this plugin's own version from the manifest shipped beside the bundle.
 * @param manifestUrl - the manifest location; defaults to the packaged one.
 * @returns the version string.
 * @throws when the manifest cannot be read or carries no version.
 */
export function readOwnVersion(manifestUrl: string = new URL('../package.json', import.meta.url).href): string {
  const manifest: unknown = JSON.parse(readFileSync(fileURLToPath(manifestUrl), 'utf8'))
  const version = (manifest as { version?: unknown }).version
  if (typeof version !== 'string' || version === '') {
    throw new Error('dsh-seework: the packaged manifest carries no version')
  }
  return version
}

/**
 * The profile directory this copy was installed into.
 *
 * Derived from this module's own location rather than read from a service: the
 * bundle always sits at `<profile>/node_modules/dsh-seework/lib/`, so three
 * levels up is the profile. A host that installs the plugin some other way
 * yields a directory whose manifest does not name this package, which
 * {@link readInstallKind} reports as `unknown` — no worse than not knowing.
 *
 * @param bundleUrl - this module's URL; defaults to its real one.
 * @returns the profile directory path.
 */
export function profileDirectory(bundleUrl: string = import.meta.url): string {
  return fileURLToPath(new URL('../../../', bundleUrl))
}

/**
 * How this copy reached the profile, read from the profile's own manifest.
 *
 * The distinction is load-bearing, not cosmetic: `pnpm sync` overwrites the
 * installed copy in place, and the next pnpm operation restores it from the
 * declared source. A `file:` install therefore belongs to the build-and-sync
 * loop, and offering it a registry update would silently move the user off that
 * loop.
 *
 * @param profileDir - the profile directory.
 * @param packageName - the dependency name to look up.
 * @returns the install kind, or `unknown` when the manifest cannot answer.
 */
export function readInstallKind(profileDir: string, packageName: string = PACKAGE_NAME): InstallKind {
  try {
    const manifest: unknown = JSON.parse(readFileSync(`${profileDir}/package.json`, 'utf8'))
    const spec = (manifest as { dependencies?: Record<string, unknown> }).dependencies?.[packageName]
    if (typeof spec !== 'string') return 'unknown'
    return spec.startsWith('file:') ? 'local' : 'registry'
  } catch {
    return 'unknown'
  }
}

/**
 * The registry to ask, out of the host's configuration.
 *
 * `resolved` is what pnpm itself reads now; `registry` is the configured one,
 * and `null` there means "pnpm's own configuration decides" — in which case the
 * public registry is the honest guess rather than an error.
 *
 * @param registries - the host's answer.
 * @returns a registry base URL.
 */
export function registryOf(registries: { registry: string | null; resolved: string | null }): string {
  return registries.resolved ?? registries.registry ?? DEFAULT_REGISTRY
}

/**
 * Add one exact version to the profile's release-age exemptions.
 *
 * pnpm 11 refuses to install a version published less than `minimumReleaseAge`
 * ago — 1440 minutes by default — and records the versions it *has* accepted in
 * `minimumReleaseAgeExclude`. That is why an installed version can be
 * reinstalled while the next one cannot be installed at all.
 *
 * Writing the version the user just asked for into that same list is the
 * narrowest exemption available: one package, one version, chosen by the person
 * who pressed the button. Nothing else in the profile is relaxed, and the next
 * release has to earn its own exemption.
 *
 * @param profileDir - the profile directory holding `pnpm-workspace.yaml`.
 * @param packageName - the package to exempt.
 * @param version - the exact version to exempt.
 * @returns whether the file was changed.
 */
export async function exemptVersion(profileDir: string, packageName: string, version: string): Promise<boolean> {
  const file = `${profileDir}/pnpm-workspace.yaml`
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    // No workspace file: this profile installs without one, so there is no gate
    // to open and nothing to edit.
    return false
  }
  const entry = `${packageName}@${version}`
  const bullet = `  - ${entry}`
  // Exact bullet, not substring: `dsh-seework@0.1` must not match `@0.1.0`.
  if (text.split('\n').some(line => line.trimEnd() === bullet)) return false
  const header = 'minimumReleaseAgeExclude:'
  const next = text.includes(header)
    ? text.replace(header, `${header}\n${bullet}`)
    : `${text.replace(/\s*$/, '')}\n\n${header}\n${bullet}\n`
  await writeFile(file, next, 'utf8')
  return true
}

/**
 * Read the newest published version out of a registry's `latest` document.
 *
 * `/<name>/latest` is the one endpoint that answers "what is the newest
 * release" without pulling the whole packument, and it is what `npm view
 * <name> version` reads.
 *
 * @param query - the registry, the package, and an optional fetch stub.
 * @returns the version string.
 * @throws when the registry refuses, answers with a non-JSON body, or carries no
 *   version — each of which must surface as an error rather than as "up to date".
 */
export async function latestVersionFrom(query: RegistryQuery): Promise<string> {
  const base = query.registry.replace(/\/+$/, '')
  const path = query.packageName.replace('/', '%2F')
  const response = await (query.fetchFn ?? fetch)(`${base}/${path}/latest`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`注册表返回 HTTP ${response.status}`)
  const manifest: unknown = await response.json()
  const version = (manifest as { version?: unknown }).version
  if (typeof version !== 'string' || version === '') throw new Error('注册表返回的文档里没有版本号')
  return version
}

/**
 * Ask the registry what the newest version is, and compare it with ours.
 *
 * Never throws: the settings card has to keep rendering when the registry is
 * unreachable, when the host has no plugin manager, and when this is a local
 * install that has no update to offer.
 *
 * @param deps - the host seam, the running version, how it was installed, and an
 *   optional fetch stub.
 * @returns the status the card renders.
 */
export async function checkForUpdate(deps: {
  host: UpdateHost | undefined
  current: string
  kind: InstallKind
  fetchFn?: typeof fetch
}): Promise<UpdateStatus> {
  const base = { current: deps.current, kind: deps.kind, updateAvailable: false }
  // A local install is not a failure state: the card says so and stops.
  if (deps.kind === 'local') return base
  if (deps.host === undefined) return { ...base, error: '宿主没有提供插件管理服务。' }
  try {
    const registry = registryOf(await deps.host.registries())
    const latest = await latestVersionFrom({
      registry,
      packageName: PACKAGE_NAME,
      ...deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn },
    })
    return { ...base, latest, updateAvailable: isNewer(latest, deps.current) }
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }
}
