/**
 * Standalone tsdown build for dsh-seework.
 *
 * Replicates the DSH client-bundle contract so the package builds without the
 * harness monorepo:
 *
 *  - Host half   -> lib/index.js  (ESM; host-shared packages stay bare so the
 *                   running harness keeps module identity for its services)
 *  - Client half -> lib/client.js (CJS browser bundle registering itself via
 *                   `window.__ModuleLoader__.load({ id, factory })`, resolving
 *                   platform modules through the injected require and inlining
 *                   everything else; CSS Modules are compiled by lightningcss
 *                   and injected as <style> tags)
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** Plugin id (package name) stamped into the __ModuleLoader__.load handoff. */
const ID = 'dsh-seework'

/**
 * The module specifiers the web shell shares into the frozen module table
 * (mirror of @deepseek-ai/dsh-client-web PLATFORM_MODULES) plus the packages
 * this plugin declares in `dsh.client.inject`, whose bundles the boot graph
 * supplies as dynamic rows. Anything else is inlined by the bundle.
 */
const CLIENT_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
]

/**
 * Host-shared packages that must keep their identity at runtime.
 *
 * This is `external`, not `deps.neverBundle`: tsdown 0.15 has no `deps` option
 * and silently ignores it, which bundled a second React into the client half —
 * a duplicate React instance throws hook errors the moment a component renders.
 * `scripts/probe-host-bundle.mjs` checks a served bundle for exactly that.
 */
const HOST_EXTERNALS: readonly string[] = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  'schemastery',
]

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Host half: plain ESM library, host-shared packages stay bare. */
const nodeConfig: UserConfig = {
  name: ID,
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: [...HOST_EXTERNALS],
}

/** Browser half: the __ModuleLoader__ registration bundle. */
const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(`${ID}/${basename(fileId)}`)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${process.platform === 'win32' ? '\\' : '/'}lib${process.platform === 'win32' ? '\\' : '/'}types${process.platform === 'win32' ? '\\' : '/'}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

export default [nodeConfig, clientConfig]
