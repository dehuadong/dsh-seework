/**
 * Sync the built plugin into an installed DSH profile.
 *
 * Why this exists: `dsh plugin --profile web add file:E:/workspace/seeaihub/dsh-seework`
 * results in a **copy** in the profile's `node_modules`, not a symlink (pnpm's
 * `file:` install semantics). Rebuilding `lib/` therefore does not reach the
 * running host, and the symptom is nasty — the GUI keeps loading the old bundle
 * with no error at all.
 *
 *   node scripts/sync-to-profile.mjs                 # default profile: web
 *   node scripts/sync-to-profile.mjs --profile add   # a different profile
 *   node scripts/sync-to-profile.mjs --dry-run       # report, change nothing
 *
 * Exits non-zero when the profile is missing or a copy fails.
 */

import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageName = 'dsh-seework'

/** What the DSH host reads: the two bundles, the composition patch, and the packaged skill body. */
const ARTIFACTS = ['lib', 'cordis.patch.yml', 'package.json', 'README.md', 'docs', 'assets']

/** Parse `--profile <name>` / `--dry-run`. */
function parseArgs(argv) {
  let profile = 'web'
  let dryRun = false
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--profile') {
      profile = argv[index + 1] ?? ''
      index++
      continue
    }
    if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length)
      continue
    }
    if (arg === '--dry-run') dryRun = true
  }
  return { profile, dryRun }
}

const { profile, dryRun } = parseArgs(process.argv.slice(2))
if (profile === '') {
  console.error('用法：node scripts/sync-to-profile.mjs [--profile <name>] [--dry-run]')
  process.exit(1)
}

const dshHome = process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh')
const target = path.join(dshHome, 'profiles', profile, 'node_modules', packageName)

/** Fail with a message that says what to do, not just what went wrong. */
async function requireInstalled() {
  try {
    await stat(path.join(target, 'package.json'))
  } catch {
    console.error(`没有在 ${target} 找到 ${packageName}。`)
    console.error(`先安装：dsh plugin --profile ${profile} add file:${projectRoot.replaceAll('\\', '/')}`)
    process.exit(1)
  }
}

/** Newest mtime under a directory (used to report which side is newer). */
async function newestMtime(entry) {
  let newest = 0
  const info = await stat(entry)
  if (info.isFile()) return info.mtimeMs
  const { readdir } = await import('node:fs/promises')
  for (const name of await readdir(entry)) {
    newest = Math.max(newest, await newestMtime(path.join(entry, name)).catch(() => 0))
  }
  return Math.max(newest, info.mtimeMs)
}

await requireInstalled()

// Compare the host half: it is rebuilt on every `pnpm build`, so its mtime is
// the honest signal for "the profile is running old code".
const builtAt = await newestMtime(path.join(projectRoot, 'lib'))
const installedAt = await newestMtime(path.join(target, 'lib'))
console.log(`${packageName} → ${target}`)
console.log(`  构建产物 ${new Date(builtAt).toLocaleString()} / 已安装 ${new Date(installedAt).toLocaleString()}`)

if (dryRun) {
  console.log(builtAt > installedAt ? '  需要同步（构建比安装新）' : '  已是最新')
  process.exit(0)
}

for (const artifact of ARTIFACTS) {
  const from = path.join(projectRoot, artifact)
  const to = path.join(target, artifact)
  try {
    await stat(from)
  } catch {
    continue
  }
  await mkdir(path.dirname(to), { recursive: true })
  await cp(from, to, { recursive: true, force: true })
  console.log(`  已同步 ${artifact}`)
}

// Confirm the bundle really is the one just built, so a silent copy failure
// cannot masquerade as a successful sync.
const built = await readFile(path.join(projectRoot, 'lib', 'client.js'), 'utf8')
const installed = await readFile(path.join(target, 'lib', 'client.js'), 'utf8')
if (built !== installed) {
  console.error('同步后文件不一致：请检查 profile 目录是否被其它进程占用。')
  process.exit(1)
}
console.log('同步完成：重启 dsh web 后生效。')
