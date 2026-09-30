/**
 * Revealing one of the plugin's pictures in the host's file manager.
 *
 * The platform argv is the part that is easy to get subtly wrong — Explorer's
 * encoded URI, its delegated exit code, Finder's `-R` — and it is pure, so it is
 * pinned here instead of by opening a window on whatever machine runs the suite.
 * The route that uses it composes the path from the store's own name rule; that
 * half lives in `routes.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import { explorerTarget, revealInFileManager, revealPlan, type RevealSpawn } from './reveal.ts'

/** A spawn stand-in: records the argv it was given and reports one outcome. */
function fakeSpawn(outcome: { type: 'exit'; code: number | null } | { type: 'error'; error: Error }): {
  spawn: RevealSpawn
  calls: Array<{ command: string; args: readonly string[] }>
} {
  const calls: Array<{ command: string; args: readonly string[] }> = []
  const spawn = ((command: string, args: readonly string[]) => {
    calls.push({ command, args })
    return {
      once: (event: string, listener: (value: unknown) => void) => {
        if (event !== outcome.type) return undefined
        const value = outcome.type === 'exit' ? outcome.code : outcome.error
        queueMicrotask(() => { listener(value) })
        return undefined
      },
      kill: () => undefined,
      unref: () => undefined,
    }
  }) as unknown as RevealSpawn
  return { spawn, calls }
}

describe('revealPlan', () => {
  it('hands Explorer the target as its own argv element', () => {
    const plan = revealPlan('C:\\pics\\shot one.png', 'win32')
    expect(plan?.command).toBe('explorer.exe')
    expect(plan?.args).toEqual(['/select,', 'file:///C:/pics/shot%20one.png'])
    // Explorer exits 1 after delegating the reveal to the running desktop process.
    expect(plan?.acceptsExitOne).toBe(true)
  })

  it('escapes what Explorer would split the argument on, and keeps text readable', () => {
    // Explorer splits its argument on `,` and `=`, so those two must be encoded…
    expect(explorerTarget('C:\\pics\\a,b=c.png')).toContain('a%2Cb%3Dc.png')
    // …while a name that is only percent-encoded because it is not ASCII stays legible.
    expect(explorerTarget('C:\\pics\\中文.png')).toContain('中文.png')
  })

  it('asks Finder on macOS, and opens the folder on Linux', () => {
    expect(revealPlan('/tmp/shot.png', 'darwin')).toEqual({
      command: 'open', args: ['-R', '/tmp/shot.png'], acceptsExitOne: false,
    })
    // No Linux file manager can be told to select a file without knowing which
    // one is installed, so its folder is what gets opened.
    expect(revealPlan('/tmp/shot.png', 'linux')).toEqual({
      command: 'xdg-open', args: ['/tmp'], acceptsExitOne: false,
    })
  })

  it('has no plan where there is no file manager to ask', () => {
    expect(revealPlan('/tmp/shot.png', 'aix')).toBeUndefined()
  })
})

describe('revealInFileManager', () => {
  it('resolves once the file manager took the request', async () => {
    const fake = fakeSpawn({ type: 'exit', code: 0 })
    await revealInFileManager('C:\\pics\\shot.png', { platform: 'win32', spawn: fake.spawn })
    expect(fake.calls).toEqual([{ command: 'explorer.exe', args: ['/select,', 'file:///C:/pics/shot.png'] }])
  })

  it('accepts Explorer handing the reveal to the desktop process that is already running', async () => {
    await expect(revealInFileManager('C:\\pics\\shot.png', {
      platform: 'win32', spawn: fakeSpawn({ type: 'exit', code: 1 }).spawn,
    })).resolves.toBeUndefined()
  })

  it('rejects anything else, including that exit code on another platform', async () => {
    await expect(revealInFileManager('/tmp/shot.png', {
      platform: 'darwin', spawn: fakeSpawn({ type: 'exit', code: 1 }).spawn,
    })).rejects.toThrow(/退出码 1/u)
    await expect(revealInFileManager('/tmp/shot.png', {
      platform: 'darwin', spawn: fakeSpawn({ type: 'error', error: new Error('spawn ENOENT') }).spawn,
    })).rejects.toThrow('spawn ENOENT')
  })

  it('refuses a platform it has no file manager for', async () => {
    await expect(revealInFileManager('/tmp/shot.png', { platform: 'aix' }))
      .rejects.toThrow(/没有可用的文件管理器/u)
  })
})
