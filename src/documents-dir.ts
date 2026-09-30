/**
 * The user's Documents directory, for the plugin's default material directory.
 *
 * The library belongs somewhere the user can see, back up and sync — the harness
 * puts its own first-use workspace under Documents for the same reason, and a
 * hidden `.dsh` is none of those. The folder cannot simply be spelled out: it is
 * localized on some systems (a Chinese macOS calls it 文稿) and Windows may have
 * relocated it (OneDrive, another drive), so the system is asked. The recipes
 * mirror `dsh-api-workspace-controller`'s `defaultWorkspaceDirectory`.
 *
 * Windows gets a second question, because the first one can be refused: an
 * application-control policy (WDAC/AppLocker) puts PowerShell in
 * ConstrainedLanguage mode, where a .NET call like `GetFolderPath` is rejected
 * outright — verified on the machine this was written on:
 *
 *     Method invocation is supported only on core types in this language mode.
 *
 * The shell keeps the same fact in the registry, and `reg.exe` has no language
 * mode. A deployment can also answer for the whole thing
 * ({@link DOCUMENTS_DIR_ENV}), which is what the test suite does.
 */

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

/** How long the system may take to answer before the fallback is used. */
export const DOCUMENTS_LOOKUP_TIMEOUT_MS = 5_000

/** The environment variable a deployment can answer through. */
export const DOCUMENTS_DIR_ENV = 'DSH_SEEWORK_DOCUMENTS_DIR'

/** The shell's own record of where the account's folders live. */
const SHELL_FOLDERS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'

/** Runs one command and resolves with its stdout. */
type Run = (command: string, args: readonly string[], signal: AbortSignal) => Promise<string>

/** What the lookup needs from the machine; every part is a seam for tests. */
export interface DocumentsDeps {
  /** Platform to answer for (defaults to this process's). */
  platform?: NodeJS.Platform
  /** The account's home directory. */
  home?: string
  /**
   * A deployment's own answer, used instead of asking the system.
   *
   * Needed because the system's answer cannot be redirected by environment alone:
   * Windows reads the account's shell folders, not `%USERPROFILE%`. The suite
   * points this at its throwaway tree, so it never writes into — or moves — the
   * developer's real Documents folder.
   */
  documents?: string
  /** Runs one command and resolves with its stdout. */
  run?: Run
}

/** Run one command with a deadline and hand back its stdout. */
async function runCommand(command: string, args: readonly string[], signal: AbortSignal): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(command, [...args], { signal, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      if (error === null) resolve(stdout)
      else reject(error)
    })
  })
}

/**
 * Ask the system where this account's Documents folder is.
 *
 * Never throws: a machine without the tool, without a shell, or slow enough to hit
 * the deadline answers `undefined`, and the caller falls back to `<home>/Documents`
 * — right on Windows and on most Linux and macOS installs.
 *
 * @param deps - platform, home, override and command-runner seams.
 * @returns the absolute directory, or undefined when this system has no answer.
 */
export async function systemDocumentsDirectory(deps: DocumentsDeps = {}): Promise<string | undefined> {
  const platform = deps.platform ?? process.platform
  const home = deps.home ?? homedir()
  const run = deps.run ?? runCommand
  // The target platform's own rules, not the host's: what macOS answers must not be
  // judged by Windows path semantics.
  const paths = platform === 'win32' ? win32 : posix
  const override = (deps.documents ?? process.env[DOCUMENTS_DIR_ENV])?.trim()
  if (override !== undefined && override !== '') {
    // A deployment said where it is. A bad answer must not silently become the real
    // folder, so it answers nothing rather than falling through to the system.
    return validate(override, paths)
  }
  const signal = AbortSignal.timeout(DOCUMENTS_LOOKUP_TIMEOUT_MS)
  const reported = platform === 'win32'
    ? await askWindows(run, signal, home)
    : platform === 'darwin'
      ? await attempt(() => run('osascript', [
        '-e', 'POSIX path of (path to documents folder from user domain without folder creation)',
      ], signal))
      : platform === 'linux'
        ? await askLinux(run, signal, home, paths)
        : undefined
  if (reported === undefined) return undefined
  return validate(reported.replace(/[\r\n]+$/u, '').trim(), paths)
}

/**
 * Ask Windows, and fall back to the registry when the first answer is refused.
 *
 * `DoNotVerify` keeps the first question a lookup: nothing is created on the way.
 *
 * @param run - the command runner.
 * @param signal - the lookup deadline.
 * @param home - the account's home directory, for `%USERPROFILE%`.
 * @returns the directory as the system spelled it, or undefined.
 */
async function askWindows(run: Run, signal: AbortSignal, home: string): Promise<string | undefined> {
  const fromShell = await attempt(() => run('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '
    + '[Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments, '
    + '[Environment+SpecialFolderOption]::DoNotVerify)',
  ], signal))
  if (fromShell !== undefined && fromShell.trim() !== '') return fromShell
  return await attempt(async () => registryDocuments(await run('reg.exe', [
    'query', SHELL_FOLDERS_KEY, '/v', 'Personal',
  ], signal), home))
}

/**
 * Read the shell's own record of the folder out of `reg.exe` output.
 *
 * The value is `REG_EXPAND_SZ`, so it may still name the account's variables:
 * `%USERPROFILE%\Documents` is the ordinary spelling on a machine that never moved
 * the folder.
 *
 * @param output - `reg.exe query` stdout.
 * @param home - the account's home directory, for `%USERPROFILE%`.
 * @returns the directory, or undefined when the value is not in the output.
 */
function registryDocuments(output: string, home: string): string | undefined {
  const value = output
    .split(/\r?\n/u)
    .map(line => /REG_(?:EXPAND_)?SZ\s+(.+)$/u.exec(line)?.[1]?.trim())
    .find(text => text !== undefined && text !== '')
  if (value === undefined) return undefined
  return value.replace(/%([^%]+)%/gu, (whole, name: string) => {
    if (name.toUpperCase() === 'USERPROFILE') return home
    return process.env[name] ?? whole
  })
}

/**
 * Ask xdg, and refuse the answer that means "this user directory is turned off".
 *
 * @param run - the command runner.
 * @param signal - the lookup deadline.
 * @param home - the account's home directory.
 * @param paths - the platform's path rules.
 * @returns the directory, or undefined.
 */
async function askLinux(
  run: Run,
  signal: AbortSignal,
  home: string,
  paths: typeof posix,
): Promise<string | undefined> {
  const reported = await attempt(() => run('xdg-user-dir', ['DOCUMENTS'], signal))
  if (reported === undefined) return undefined
  // XDG reports the home directory when the user directory is disabled, and that is
  // not a Documents folder.
  if (paths.normalize(reported.trim()) === paths.normalize(home)) return undefined
  return reported
}

/** Run a question and answer undefined when it fails or answers nothing. */
async function attempt(ask: () => Promise<string | undefined>): Promise<string | undefined> {
  try {
    return await ask()
  } catch {
    return undefined
  }
}
/**
 * Keep an answer only when it is a directory this platform could use.
 *
 * @param directory - what the system spelled.
 * @param paths - the platform's path rules.
 * @returns the normalized directory, or undefined for an empty answer, a relative
 *   one, or a bare root.
 */
function validate(directory: string, paths: typeof posix): string | undefined {
  if (directory === '') return undefined
  if (!paths.isAbsolute(directory) || paths.parse(directory).root === directory) return undefined
  return paths.normalize(directory)
}
