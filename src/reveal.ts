/**
 * Showing one of our pictures in the host's file manager.
 *
 * The plugin's pictures live under its own data root, which is outside the
 * session workspace — so the harness's own path-opening route cannot serve them:
 * it authorizes a path by round-tripping it through the session's filesystem
 * mapping and refuses anything that has no verified host path. This half does it
 * itself, on a path it composed from its own store.
 *
 * The platform recipe mirrors `@deepseek-ai/dsh-native-command`'s
 * `revealNativePath`, including the two details that are easy to get wrong:
 * Explorer is handed an encoded file URI as its own argv element (never a command
 * string), and it exits 1 after delegating the reveal to the desktop process that
 * is already running — so that exit code means the shell took the request rather
 * than that it failed.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** How long a file manager may take to acknowledge before the request gives up. */
export const REVEAL_TIMEOUT_MS = 5_000

/** One platform's way of asking its file manager to show a file. */
export interface RevealPlan {
  command: string
  args: readonly string[]
  /** Whether exit code 1 means the request was delegated rather than failed. */
  acceptsExitOne: boolean
}

/** The slice of `spawn` this needs, so a test can stand in for the process. */
export type RevealSpawn = (
  command: string,
  args: readonly string[],
  options: { detached: boolean; stdio: 'ignore' },
) => {
  once: ((event: 'error', listener: (error: Error) => void) => unknown)
    & ((event: 'exit', listener: (code: number | null) => void) => unknown)
  kill: () => unknown
  unref: () => unknown
}

/** What a reveal needs from the machine; both parts are seams for tests. */
export interface RevealDeps {
  platform?: string
  spawn?: RevealSpawn
}

/**
 * Explorer's target for one path.
 *
 * Explorer takes a file URI and splits the argument on `,` and `=` itself, so
 * those two characters are escaped — while a run of escapes that only encodes
 * non-ASCII characters is decoded back to readable text.
 *
 * @param file - the absolute path, in Windows syntax.
 * @returns the encoded target.
 */
export function explorerTarget(file: string): string {
  return pathToFileURL(file, { windows: true }).href
    .replace(/(?:%[89A-F][0-9A-F])+/giu, escaped => decodeURIComponent(escaped))
    .replaceAll(',', '%2C')
    .replaceAll('=', '%3D')
}

/**
 * How one file is revealed on one platform.
 *
 * @param file - absolute path of the file to reveal.
 * @param platform - the platform to plan for (`process.platform`).
 * @returns the plan, or undefined when this platform has no known file manager.
 */
export function revealPlan(file: string, platform: string): RevealPlan | undefined {
  if (platform === 'win32') {
    return { command: 'explorer.exe', args: ['/select,', explorerTarget(file)], acceptsExitOne: true }
  }
  if (platform === 'darwin') return { command: 'open', args: ['-R', file], acceptsExitOne: false }
  if (platform === 'linux') {
    // No Linux file manager can be told to *select* a file from the command line
    // without knowing which one is installed, so its folder is opened instead.
    return { command: 'xdg-open', args: [path.dirname(file)], acceptsExitOne: false }
  }
  return undefined
}

/**
 * Ask the host's file manager to show one file.
 *
 * Detached, because the file manager outlives the request: the plugin is done
 * once the request has been handed over.
 *
 * @param file - absolute path of the file to reveal.
 * @param deps - platform and process seams (tests).
 * @returns after the file manager took the request.
 * @throws when this platform has no file manager, or the command never answered.
 */
export async function revealInFileManager(file: string, deps: RevealDeps = {}): Promise<void> {
  const platform = deps.platform ?? process.platform
  const plan = revealPlan(file, platform)
  if (plan === undefined) throw new Error(`这个平台（${platform}）没有可用的文件管理器`)
  const launch: RevealSpawn = deps.spawn
    ?? ((command, args, options) => spawn(command, [...args], options))
  await new Promise<void>((resolve, reject) => {
    const child = launch(plan.command, plan.args, { detached: true, stdio: 'ignore' })
    // A file manager that never answers must not hold the request open: the user
    // is looking at a menu, not at a progress bar.
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${plan.command} 没有在 ${REVEAL_TIMEOUT_MS}ms 内应答`))
    }, REVEAL_TIMEOUT_MS)
    const settle = (work: () => void): void => { clearTimeout(timer); work() }
    child.once('error', error => { settle(() => { reject(error) }) })
    child.once('exit', code => {
      settle(() => {
        if (code === 0 || (plan.acceptsExitOne && code === 1)) resolve()
        else reject(new Error(`${plan.command} 退出码 ${String(code)}`))
      })
    })
    child.unref()
  })
}
