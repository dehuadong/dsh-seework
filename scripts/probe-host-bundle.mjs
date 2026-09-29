/**
 * One-off verification probe: does a running DSH host serve this plugin's
 * client bundle, and does the browser boot graph reference it?
 *
 *   DSH_PROBE_TOKEN=<token> node scripts/probe-host-bundle.mjs <base-url>
 *
 * The token arrives through the environment because it may begin with `-`,
 * which a command-line argument parser would read as a flag.
 */

const base = process.argv[2]
const token = process.env.DSH_PROBE_TOKEN ?? ''
if (!base || token === '') {
  console.error('用法：DSH_PROBE_TOKEN=<token> node scripts/probe-host-bundle.mjs <base-url>')
  process.exit(1)
}

/** Fetch with both credentials the browser-trust fence accepts. */
const cookies = new Map()
async function get(url) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      ...cookies.size === 0 ? {} : { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') },
    },
    redirect: 'manual',
  })
  // The fence answers a root `?token=` request with a 303 that mints the
  // authority-bound cookie; everything after that carries the cookie instead.
  const setCookie = response.headers.getSetCookie?.() ?? []
  for (const entry of setCookie) {
    const [pair] = entry.split(';')
    const index = pair.indexOf('=')
    if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1))
  }
  return response
}

/** Append the token without disturbing an existing query string. */
function withToken(url) {
  return url.includes('token=') ? url : `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}

// Mint the session cookie first, then reuse it for every later request.
const minted = await get(withToken(`${base}/`))
if (minted.status !== 303 && minted.status !== 200) {
  console.error(`认证失败：gate 返回 ${minted.status}（token 是否正确？）`)
  process.exit(1)
}
await minted.body?.cancel()

const indexResponse = await get(`${base}/`)
const html = await indexResponse.text()
console.log(`index.html: ${indexResponse.status}, ${html.length} 字符`)

// The boot graph lists each client half as { id, url }.
const row = /"id":"dsh-seework","url":"([^"]+)"/.exec(html)
if (row === null) {
  console.error('启动图里没有 dsh-seework 客户端半边')
  process.exit(1)
}
const url = row[1].replaceAll('&amp;', '&')
console.log(`启动图条目: ${url}`)

const bundleUrl = url.startsWith('http') ? url : `${base}${url}`
const bundleResponse = await get(bundleUrl)
const body = await bundleResponse.text()
console.log(`bundle: ${bundleResponse.status}, ${body.length} 字符`)
console.log(`module id 匹配: ${body.includes('__ModuleLoader__.load({ id: "dsh-seework"')}`)

// React must come from the shell's frozen module table. A bundle that inlines
// its own React copy renders into a second instance and crashes at runtime with
// hook errors — the failure mode this check exists to catch.
console.log(`未内联 react（无本地 createElement 实现）: ${!/function createElement\(/.test(body)}`)
console.log(`通过宿主 require 使用 react: ${/require\(["']react["']\)/.test(body)}`)
console.log(`未引用 zustand/immer（客户端包自带快照 store）: ${!/require\(["'](zustand|immer)/.test(body)}`)
console.log(`CSS 以 style 标签注入: ${body.includes('data-plugin-css')}`)

const requires = new Set([...body.matchAll(/(?:\brequire|__require)\((["'])([^"']+)\1\)/g)].map(match => match[2]))
const externals = [...requires]
console.log(`外部依赖: ${externals.length === 0 ? '（无）' : externals.join(', ')}`)

if (bundleResponse.status !== 200 || !body.includes('dsh-seework')) {
  console.error('客户端 bundle 没有正常送达。')
  process.exit(1)
}

// The browser bundle may only require modules the shell's frozen table (and its
// click-to-load rows) actually supply. A `node:` builtin or an unlisted package
// makes the whole client half fail to load, which the user experiences as "the
// plugin's buttons never appear" with no visible error.
const ALLOWED = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'])
const unlisted = externals.filter(name => !ALLOWED.has(name) && !name.startsWith('@deepseek-ai/'))
if (unlisted.length > 0) {
  console.error(`客户端 bundle 依赖了宿主模块表里没有的东西：${unlisted.join(', ')}`)
  console.error('浏览器半边会因此整块加载失败。检查是否有 src/client 下的模块导入到了宿主侧文件。')
  process.exit(1)
}
if (/ReactCurrentDispatcher|__SECRET_INTERNALS/.test(body)) {
  console.error('客户端 bundle 内联了 react：会出现两个 React 实例，组件渲染即报 hook 错误。')
  process.exit(1)
}
if (!/require\(["']react["']\)/.test(body)) {
  console.error('客户端 bundle 没有通过宿主 require 使用 react。')
  process.exit(1)
}

// The launcher dock must not be anchored to the bottom-left: that corner holds
// the shell's own sidebar controls, and covering them is a visible regression
// (it shipped once, hence this check).
const dockRule = /\[data-dsh-seework-dock\]\{[^}]*\}/.exec(body)?.[0]
if (dockRule === undefined) {
  console.error('bundle 里找不到 dock 的定位规则。')
  process.exit(1)
}
console.log(`dock 定位: ${dockRule}`)
if (/left:/.test(dockRule)) {
  console.error('dock 锚在左侧——会盖住宿主自己的左下角按钮。')
  process.exit(1)
}

console.log('bundle 检查通过：只用宿主提供的模块，未内联 react，dock 不在左下角。')
