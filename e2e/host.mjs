/**
 * Boot an isolated DSH web instance with this plugin loaded — the Playwright
 * `webServer` entry.
 *
 * Why this exists: the plugin's browser half only comes into being inside a real
 * GUI, and the failures that matter (a client bundle that never loads, a
 * settings page that never lands in the nav, a dock covering the shell's own
 * controls) are invisible to the jsdom unit tests. Playwright starts this
 * script, waits for `http://127.0.0.1:<port>/` — the browser-trust fence answers
 * 401 there, which Playwright counts as ready — and kills it when the run ends.
 *
 * Isolation, in three parts, because getting any of them wrong means the spec
 * silently grades the wrong thing:
 *
 *  1. **A throwaway `DSH_HOME`** under `.tmp-e2e/` (gitignored): its own profile,
 *     its own material library and canvas boards. The developer's real `~/.dsh`
 *     is never opened.
 *  2. **A fresh copy into the profile, never a directory link.** A link to the
 *     working tree also links its `node_modules`, and the host routes a bare
 *     import to the installation's copy only when the importing package declares
 *     it as a *peer*: `@deepseek-ai/dsh-settings` and `@deepseek-ai/dsh-tools`
 *     are devDependencies here, so a link would quietly grade this repo's
 *     0.1.5-rc.1 copies while the installation runs 0.2.0-rc.2 — a stack no user
 *     ever gets. The copy carries no `node_modules`, exactly like the `file:`
 *     install the plugin ships with, so every host import resolves to the
 *     installation. It is re-copied on every run, so it cannot go stale — the
 *     trap `scripts/sync-to-profile.mjs` exists for.
 *  3. **The profile manifest is written by DSH itself** (`--profile web
 *     --dump-config`, which initializes a missing profile from the shipped
 *     template and exits), then amended with this plugin. Hardcoding the web
 *     template's bundle list here would rot silently the day DSH changes it.
 *
 * Environment:
 *   DSH_E2E_PORT        listen port; the Playwright config passes it.
 *   DSH_E2E_APP         the desktop client executable to run as Node.
 *   DSH_E2E_SKIP_BUILD  `1` never rebuilds, whatever `src/` says.
 */

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageName = 'dsh-seework'

/** What the host actually reads out of the package. `node_modules` is never among them. */
const ARTIFACTS = ['lib', 'cordis.patch.yml', 'package.json', 'assets']

const port = Number(process.env.DSH_E2E_PORT ?? '3311')
if (!Number.isInteger(port) || port <= 0) {
  console.error(`DSH_E2E_PORT 不是合法端口：${JSON.stringify(process.env.DSH_E2E_PORT)}`)
  process.exit(1)
}

const tempRoot = path.join(projectRoot, '.tmp-e2e')
const home = path.join(tempRoot, 'home')
const runtimeFile = path.join(tempRoot, 'runtime.json')
const profileDir = path.join(home, 'profiles', 'web')
const profileManifest = path.join(profileDir, 'package.json')
const appExe = process.env.DSH_E2E_APP ?? 'C:\\Users\\MyPC\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe'
// The desktop client ships dsh inside its asar; there is no separate dsh.cmd.
const appEntry = path.join(
  path.dirname(appExe), 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js',
)

/** How long the host may take to print its authenticated URL before this gives up. */
const READY_TIMEOUT_MS = 120_000

/** The fence mints a session cookie from this URL; the token rotates on every start. */
const PRINTED_URL = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/u

/** Child environment for anything that must see our own profile tree. */
function dshEnv() {
  return { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' }
}

/** Say what to do about it, not just what went wrong. */
function fail(message, output = '') {
  console.error(`[e2e-host] ${message}`)
  if (output.trim() !== '') console.error(output.trim().split('\n').slice(-25).join('\n'))
  process.exit(1)
}

/** Newest modification time under a path (the staleness signal sync-to-profile.mjs also uses). */
function newestMtime(entry) {
  const info = statSync(entry)
  if (info.isFile()) return info.mtimeMs
  let newest = info.mtimeMs
  for (const name of readdirSync(entry)) newest = Math.max(newest, newestMtime(path.join(entry, name)))
  return newest
}

/**
 * Rebuild the plugin when `lib/` is older than the sources it is built from.
 *
 * `lib/` is committed and is what the host loads, so it must be current or the
 * specs grade a bundle nobody built from this tree. It is deliberately *not*
 * rebuilt on every run: this build is not byte-reproducible (the CSS-module key
 * order in the client bundle comes out different each time), so an unconditional
 * rebuild would leave `lib/client.js` modified after every test run for no gain.
 *
 * @returns the reason to rebuild, or undefined when `lib/` is current.
 */
function staleness() {
  if (process.env.DSH_E2E_SKIP_BUILD === '1') return undefined
  const artifacts = ['lib/index.js', 'lib/client.js'].map(name => path.join(projectRoot, name))
  const missing = artifacts.filter(artifact => !existsSync(artifact))
  if (missing.length > 0) return `${missing.map(name => path.relative(projectRoot, name)).join('、')} 不存在`
  const built = Math.min(...artifacts.map(artifact => statSync(artifact).mtimeMs))
  const sources = Math.max(
    newestMtime(path.join(projectRoot, 'src')),
    statSync(path.join(projectRoot, 'tsdown.config.ts')).mtimeMs,
  )
  return built < sources ? 'src/ 比 lib/ 新' : undefined
}

/** Build the plugin: `lib/` is the artifact this whole suite grades. */
function build() {
  const reason = staleness()
  if (reason === undefined) {
    console.log('[e2e-host] lib/ 已是最新，跳过构建')
    return
  }
  console.log(`[e2e-host] 构建插件（node --run build）：${reason}`)
  // `node --run` puts node_modules/.bin on PATH, so this needs no pnpm on PATH.
  const built = spawnSync(process.execPath, ['--run', 'build'], { cwd: projectRoot, encoding: 'utf8' })
  if (built.status !== 0) fail('构建失败，先修好 `pnpm build` 再看 E2E。', `${built.stdout ?? ''}${built.stderr ?? ''}`)
}

/**
 * Make sure `<DSH_HOME>/profiles/web` exists, declare this plugin in it, and put
 * a fresh copy of the package where the host will find it.
 *
 * The first write is DSH's own: it initializes a profile missing its manifest
 * from the shipped template. Everything after that is one dependency line, one
 * bundle line, and the copy.
 */
function prepareProfile() {
  if (!existsSync(profileManifest)) {
    console.log('[e2e-host] 初始化临时 profile（dsh --profile web --dump-config）')
    const initialized = spawnSync(appExe, [appEntry, '--profile', 'web', '--dump-config'], {
      cwd: projectRoot, env: dshEnv(), encoding: 'utf8',
    })
    if (!existsSync(profileManifest)) {
      fail('DSH 没能初始化 web profile，检查 DSH_E2E_APP 是否指向桌面客户端。',
        `${initialized.stdout ?? ''}${initialized.stderr ?? ''}`)
    }
  }

  const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
  manifest.dependencies ??= {}
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  const bundles = manifest.dsh.profile.bundles ?? (manifest.dsh.profile.bundles = [])
  // An absolute `file:` spec rather than a relative one: DSH only rewrites
  // relative path specs, and this way the manifest says where the tree is.
  const spec = `file:${projectRoot.replaceAll('\\', '/')}`
  const changed = manifest.dependencies[packageName] !== spec || !bundles.includes(packageName)
  manifest.dependencies[packageName] = spec
  if (!bundles.includes(packageName)) bundles.push(packageName)
  if (changed) {
    writeFileSync(profileManifest, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`[e2e-host] profile 已声明 ${packageName}：${spec}`)
  }

  // Rebuilt from scratch every run: a copy that merely lags is the failure mode
  // this whole harness exists to avoid. A leftover link (from a checkout that
  // used one) is unlinked rather than removed recursively — recursive removal
  // must never be handed a path that points back at the working tree.
  const target = path.join(profileDir, 'node_modules', packageName)
  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink()) unlinkSync(target)
    else rmSync(target, { recursive: true, force: true })
  }
  mkdirSync(target, { recursive: true })
  for (const artifact of ARTIFACTS) {
    const from = path.join(projectRoot, artifact)
    if (existsSync(from)) cpSync(from, path.join(target, artifact), { recursive: true, force: true })
  }
  console.log(`[e2e-host] 已把构建产物复制进 profile：${target}`)
}

/** Start the host, and hold this process open for as long as Playwright wants it. */
function startHost() {
  console.log(`[e2e-host] 启动临时实例：http://127.0.0.1:${port}/（DSH_HOME=${home}）`)
  const child = spawn(appExe, [appEntry, 'web', '--port', String(port), '--no-open'], {
    cwd: projectRoot, env: dshEnv(), stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  let ready = false
  let stopping = false
  let deadline
  const shutdown = (code) => {
    if (stopping) return
    stopping = true
    clearTimeout(deadline)
    if (child.exitCode === null && child.signalCode === null) child.kill()
    process.exit(code)
  }
  deadline = setTimeout(() => {
    fail(`实例 ${READY_TIMEOUT_MS / 1000} 秒内没有报出带 token 的地址。`, output)
  }, READY_TIMEOUT_MS)

  const watch = (chunk, sink) => {
    const text = chunk.toString()
    output += text
    sink.write(text)
    if (ready) return
    const found = PRINTED_URL.exec(output)
    if (found === null) return
    ready = true
    clearTimeout(deadline)
    const url = found[1]
    // The specs read the token from this file: it is the only channel that
    // survives into the worker processes, since the token is minted per start
    // and exists nowhere but this process's stdout.
    writeFileSync(runtimeFile, `${JSON.stringify({ url, baseUrl: `http://127.0.0.1:${port}`, token: new URL(url).searchParams.get('token'), home }, null, 2)}\n`)
    console.log(`[e2e-host] 就绪：${url}`)
  }
  child.stdout.on('data', chunk => watch(chunk, process.stdout))
  child.stderr.on('data', chunk => watch(chunk, process.stderr))

  child.on('error', error => fail(`起不来：${error.message}`))
  child.on('exit', (code, signal) => {
    clearTimeout(deadline)
    if (!ready) fail(`实例在报出地址之前退出（code=${code} signal=${signal}）。`, output)
    console.log(`[e2e-host] 实例已退出（code=${code} signal=${signal}）`)
    shutdown(code ?? 1)
  })

  // Playwright kills the webServer command when the run ends; the host must not
  // outlive it, or the next run finds the port taken.
  process.on('SIGTERM', () => shutdown(0))
  process.on('SIGINT', () => shutdown(0))
  process.on('exit', () => { if (child.exitCode === null && child.signalCode === null) child.kill() })
}

if (!existsSync(appExe)) {
  fail(`找不到桌面客户端：${appExe}\n用 DSH_E2E_APP 指向 DeepSeek Harness.exe。`)
}
// A stale record would hand the specs the previous run's token.
rmSync(runtimeFile, { force: true })
mkdirSync(tempRoot, { recursive: true })
build()
prepareProfile()
startHost()
