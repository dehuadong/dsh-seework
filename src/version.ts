/**
 * Version comparison for the update check.
 *
 * Hand-rolled rather than imported. Every dependency this plugin adds lands in
 * the profile's `node_modules`, and a package sitting there can shadow the
 * host's own built-in copy — the failure that kept the client from booting once
 * already (see the Agent Note on the 0.2 settings rework). A comparator is
 * thirty lines; a shadowed host package is a desktop app that refuses to start.
 */

/** One parsed version: the three numbers plus any prerelease identifiers. */
export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

/**
 * Parse `major.minor.patch[-prerelease][+build]`.
 * @param value - the version text.
 * @returns the parts, or undefined when the text is not that shape.
 */
export function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (match === null) return undefined
  const prerelease = match[4]
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: prerelease === undefined || prerelease === '' ? [] : prerelease.split('.'),
  }
}

/** Compare two prerelease identifier lists by semver's precedence rules. */
function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  // A version without a prerelease outranks the same numbers with one.
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1
  }
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    const numericA = /^\d+$/.test(a)
    const numericB = /^\d+$/.test(b)
    if (numericA && numericB) {
      const delta = Number(a) - Number(b)
      if (delta !== 0) return delta < 0 ? -1 : 1
      continue
    }
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (numericA !== numericB) return numericA ? -1 : 1
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

/**
 * Compare two version strings.
 *
 * @param left - the version on the left.
 * @param right - the version on the right.
 * @returns negative when `left` precedes `right`, 0 when equal, positive when it follows.
 * @throws when either side is not a version. A registry answer nobody can parse
 *   must not read as "up to date", which is what a silent 0 would report.
 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) {
    throw new TypeError(`not a version: ${a === undefined ? left : right}`)
  }
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePrerelease(a.prerelease, b.prerelease)
}

/**
 * Whether `candidate` is strictly newer than `current`.
 * @param candidate - the version offered.
 * @param current - the version in hand.
 * @returns true when an update is worth offering.
 */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}
