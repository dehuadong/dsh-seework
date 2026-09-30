/**
 * The comparator decides whether the card says "已是最新" or offers an update,
 * so its edges are the whole point: a prerelease must rank below its release,
 * and an answer nobody can parse must not read as "equal".
 */

import { describe, expect, it } from 'vitest'
import { compareVersions, isNewer, parseVersion } from './version.ts'

describe('parseVersion', () => {
  it('reads the three numbers and an optional prerelease', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseVersion('0.2.0-rc.1')).toEqual({ major: 0, minor: 2, patch: 0, prerelease: ['rc', '1'] })
  })

  it('ignores build metadata', () => {
    expect(parseVersion('1.0.0+build.5')?.prerelease).toEqual([])
  })

  it('tolerates surrounding space', () => {
    expect(parseVersion('  1.0.0  ')?.major).toBe(1)
  })

  it('rejects shapes that are not versions', () => {
    for (const value of ['', 'v1.0.0', '1.0', '1.0.0.0', 'latest', '^1.0.0']) {
      expect(parseVersion(value)).toBeUndefined()
    }
  })
})

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.3', '1.2.2')).toBeGreaterThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('ranks a prerelease below its release', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
  })

  it('orders prerelease identifiers by the semver rules', () => {
    // Numeric identifiers compare numerically, not as text.
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0)
    // Numeric identifiers rank below alphanumeric ones.
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)
    // A shorter list of equal identifiers precedes the longer one.
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0)
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBeLessThan(0)
  })

  it('throws rather than reporting "equal" for an unparseable version', () => {
    expect(() => compareVersions('latest', '1.0.0')).toThrow(TypeError)
    expect(() => compareVersions('1.0.0', 'not-a-version')).toThrow(TypeError)
  })
})

describe('isNewer', () => {
  it('is strictly greater', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.1.0', '0.2.0')).toBe(false)
  })

  it('does not treat a prerelease of the running version as an update', () => {
    expect(isNewer('1.0.0-rc.1', '1.0.0')).toBe(false)
  })
})
