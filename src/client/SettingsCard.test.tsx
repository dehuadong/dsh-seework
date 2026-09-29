/**
 * @vitest-environment jsdom
 *
 * The settings card's "don't make me type that" rule, from a user report: the
 * material directory is the plugin's own business (no path entry field). The
 * card also stores only the model facts the plugin actually uses (#659).
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogRefreshOutcome, CatalogResult, DirectoryPickerStatus, ModelConfig } from '../protocol.ts'
import type { SeeWorkApi } from './api.ts'
import type { ScopeSnapshot, SettingsOp, SeeWorkConfig, SeeWorkScope } from './settings-scope.ts'
import { SeeWorkSettingsCard } from './SettingsCard.tsx'

/** The envelope shape the API answers with (kept local: the module keeps it private). */
type Envelope<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

/** A settings scope that keeps its document in memory. */
function fakeScope(initial: SeeWorkConfig): {
  scope: SeeWorkScope
  ops: SettingsOp[]
  reloads: () => number
  writes: () => string[]
  unsets: () => string[]
  /** Every `set(field, value)` the card made, in order. */
  sets: () => Array<[string, unknown]>
} {
  let value: SeeWorkConfig = { ...initial }
  const listeners = new Set<() => void>()
  const ops: SettingsOp[] = []
  const writes: string[] = []
  const removed: string[] = []
  const assigned: Array<[string, unknown]> = []
  let reloads = 0
  const snapshot = (): ScopeSnapshot<SeeWorkConfig> => ({
    status: 'ready',
    value,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
  })
  const bump = (): void => { for (const listener of listeners) listener() }
  return {
    ops,
    reloads: () => reloads,
    writes: () => writes,
    unsets: () => removed,
    sets: () => assigned,
    scope: {
      getSnapshot: snapshot,
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
      subscribeSecrets: () => () => {},
      getSecretSet: () => false,
      load: async () => { reloads += 1 },
      set: async (field, next) => {
        writes.push(field)
        assigned.push([field, next])
        value = { ...value, [field]: next }
        bump()
      },
      unset: async field => {
        removed.push(field)
        const next: SeeWorkConfig = { ...value }
        delete next[field as keyof SeeWorkConfig]
        value = next
        bump()
      },
      mutateOps: async next => {
        ops.push(...next)
        for (const op of next) {
          if (op.op === 'set' && op.path[0] !== undefined) value = { ...value, [op.path[0]]: op.value }
        }
        bump()
      },
    },
  }
}

/** The API face the card uses: the library lookup, the folder picker, the catalog. */
function fakeApi(options: {
  dataRoot?: string
  picker?: DirectoryPickerStatus
  pick?: { path?: string } | { cancelled: true }
  /** `throw` makes the library lookup fail, for the "host unreachable" case. */
  library?: 'throw'
  /** The discovery answer; the default is the "could not reach the catalog" case. */
  catalog?: Envelope<CatalogResult>
  /**
   * The automatic round's answer (#652). The default is the realistic "nothing
   * configured yet" one, which keeps every other test in this file quiet.
   */
  refresh?: Envelope<CatalogRefreshOutcome>
} = {}): SeeWorkApi & { picks: () => number; discoveries: () => number; refreshes: () => number } {
  const state = { picks: 0, discoveries: 0, refreshes: 0 }
  const api = {
    library: async (): Promise<Envelope<{ dataRoot: string }>> => {
      if (options.library === 'throw') throw new Error('unreachable')
      return { ok: true, value: { dataRoot: options.dataRoot ?? '/home/u/.dsh/dsh-seework' } }
    },
    catalog: async (): Promise<Envelope<CatalogResult>> => {
      state.discoveries += 1
      return options.catalog ?? { ok: false, code: 'catalog_unreachable', message: '连接不上你填的地址。' }
    },
    catalogRefresh: async (): Promise<Envelope<CatalogRefreshOutcome>> => {
      state.refreshes += 1
      return options.refresh ?? { ok: true, value: { ran: false, skipped: 'not-configured' } }
    },
    directoryPicker: async (): Promise<Envelope<DirectoryPickerStatus>> => ({
      ok: true,
      value: options.picker ?? { kind: 'native' },
    }),
    pickDirectory: async (): Promise<Envelope<{ path?: string; cancelled?: boolean }>> => {
      state.picks += 1
      return { ok: true, value: options.pick ?? { path: '/data/seeaihub' } }
    },
  }
  return Object.assign(api as unknown as SeeWorkApi, {
    picks: () => state.picks,
    discoveries: () => state.discoveries,
    refreshes: () => state.refreshes,
  })
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.restoreAllMocks()
})

/** Render the card and let the library/picker lookups settle. */
async function render(
  config: SeeWorkConfig = { apiUrl: 'http://127.0.0.1:8080/v1' },
  api: SeeWorkApi = fakeApi(),
): Promise<ReturnType<typeof fakeScope>> {
  const fake = fakeScope(config)
  await act(async () => {
    root.render(<SeeWorkSettingsCard scope={fake.scope} api={api} />)
    await Promise.resolve()
  })
  return fake
}

describe('SeeWorkSettingsCard', () => {
  it('shows the material directory the host reported, with a button to change it', async () => {
    await render()
    const shown = container.querySelector<HTMLElement>('[data-dsh-seework-datadir]')
    expect(shown).not.toBeNull()
    // The host's resolved root is what the user sees — no path to type.
    expect(shown!.textContent).toBe('/home/u/.dsh/dsh-seework')
    expect(shown!.tagName).not.toBe('INPUT')
    for (const input of container.querySelectorAll<HTMLInputElement>('input')) {
      expect(input.value).not.toContain('dsh-seework')
    }
    // The directory is chosen with the OS dialog, never typed.
    expect(container.querySelector('[data-dsh-seework-pick-dir]')).not.toBeNull()
  })

  it('falls back to the documented default until the host answers', () => {
    const fake = fakeScope({})
    act(() => {
      root.render(<SeeWorkSettingsCard scope={fake.scope} api={fakeApi({ dataRoot: undefined, library: 'throw' })} />)
    })
    expect(container.querySelector<HTMLElement>('[data-dsh-seework-datadir]')!.textContent).toBe('~/.dsh/dsh-seework（默认）')
  })

  it('stores what the chooser returns, and says nothing when it is cancelled', async () => {
    const api = fakeApi({ pick: { path: 'D:\\SeeAI\\images' } })
    const fake = await render({}, api)
    const pick = container.querySelector<HTMLButtonElement>('[data-dsh-seework-pick-dir]')!
    await act(async () => { pick.click(); await Promise.resolve() })
    expect(api.picks()).toBe(1)
    expect(fake.sets()).toEqual([['dataDir', 'D:\\SeeAI\\images']])
    expect(container.textContent).toContain('素材目录已改为 D:\\SeeAI\\images')

    // Cancelling the dialog changes nothing and needs no message.
    const cancelledApi = fakeApi({ pick: { cancelled: true } })
    const quiet = await render({}, cancelledApi)
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-dsh-seework-pick-dir]')!.click(); await Promise.resolve() })
    expect(quiet.sets()).toEqual([])
    expect(container.textContent).not.toContain('素材目录已改为')
  })

  it('offers no button when the host has no native chooser, and explains why', async () => {
    await render({}, fakeApi({ picker: { kind: 'browse', message: '这台宿主用的是网页版目录浏览，打不开系统窗口。' } }))
    expect(container.querySelector('[data-dsh-seework-pick-dir]')).toBeNull()
    expect(container.textContent).toContain('打不开系统窗口')
  })

  it('offers 恢复默认 only after the directory was moved, and then unsets it', async () => {
    const moved = await render({ dataDir: '/custom/root' })
    const reset = container.querySelector<HTMLButtonElement>('[data-dsh-seework-reset-dir]')!
    expect(reset).not.toBeNull()
    await act(async () => { reset.click(); await Promise.resolve() })
    expect(moved.unsets()).toEqual(['dataDir'])
    expect(container.textContent).toContain('素材目录已恢复默认')

    // At the default location there is nothing to restore.
    await render({})
    expect(container.querySelector('[data-dsh-seework-reset-dir]')).toBeNull()
  })

  it('keeps the three behaviour switches and offers no watermark one', async () => {
    await render()
    const labels = [...container.querySelectorAll('label')].map(label => label.textContent ?? '')
    expect(labels.some(text => text.includes('启用插件'))).toBe(true)
    expect(labels.some(text => text.includes('允许 Agent 生图'))).toBe(true)
    expect(labels.some(text => text.includes('把插件与模型告知 Agent'))).toBe(true)
    expect(container.textContent).not.toContain('水印')
  })

  it('offers no default-quality or images-per-request field (#653 / #658)', async () => {
    // The plugin never decides a picture's quality, and `n` is a per-call
    // argument whose default is 1 in code (#658/D-15) — neither belongs here.
    await render({ defaultQuality: 'high', defaultResolution: '2K', imagesPerRequest: 4 } as unknown as SeeWorkConfig)
    expect(container.textContent).not.toContain('默认画质')
    expect(container.textContent).not.toContain('每次张数')
    expect(container.textContent).not.toContain('默认档位')
    // The remaining defaults are still there, so the removal is targeted.
    const labels = [...container.querySelectorAll('label')].map(label => label.textContent ?? '')
    expect(labels.some(text => text.includes('默认比例'))).toBe(true)
    expect(labels.some(text => text.includes('输出格式'))).toBe(true)
  })

  it('ignores a per-model `qualities` key an older document still carries (#661)', async () => {
    // The schema no longer declares it, and the card renders the resolved value,
    // so the residue neither reaches the form nor blows it up.
    await render({
      models: [{
        id: 'image-model-a',
        label: 'Image Model A',
        resolutions: ['2K'],
        aspectRatios: ['1:1'],
        outputFormats: ['png'],
        maxImages: 2,
        maxReferenceImages: 0,
        qualities: ['low', 'high'],
      }],
    } as unknown as SeeWorkConfig)
    const row = [...container.querySelectorAll('label')]
      .find(label => label.textContent?.includes('Image Model A'))
    expect(row).toBeDefined()
    expect(row!.textContent).not.toContain('low')
    expect(row!.textContent).not.toContain('high')
  })

  it('offers the ratio and output format as pickers, with a value selected (#658/D-16)', async () => {
    await render()
    const selects = [...container.querySelectorAll('select')]
    const options = selects.map(select => [...select.options].map(option => option.value))
    // 默认比例 = the gateway's eight unified ratios.
    expect(options).toContainEqual(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'])
    const selected = selects.map(select => select.value)
    expect(selected).toContain('3:4')
    expect(selected).toContain('png')
  })

  it('keeps a stored value selectable even when the picker would not offer it', async () => {
    // An old document can hold a ratio or format this build no longer lists; the
    // select must then show what is stored instead of silently displaying the first
    // option while writing something else on the next click (#658/D-16).
    await render({ defaultAspectRatio: '16:10', outputFormat: '' })
    const selects = [...container.querySelectorAll('select')]
    const ratios = selects.find(select => select.value === '16:10')
    expect(ratios).toBeDefined()
    const options = [...ratios!.options].map(option => option.value)
    expect(options[options.length - 1]).toBe('16:10')
    // `output_format` has a factory default now, so an emptied legacy field shows it.
    expect(selects.map(select => select.value)).toContain('png')
  })

  it('saves the connection without inventing a data-directory write', async () => {
    const fake = await render({ dataDir: '/custom/root' })
    const save = [...container.querySelectorAll('button')].find(button => button.textContent === '保存')!
    await act(async () => { save.click(); await Promise.resolve() })
    // Nothing to write (the addresses are unchanged), and definitely not dataDir.
    expect(fake.ops).toEqual([])
    expect(container.textContent).toContain('没有需要保存的改动')
  })

  it('still writes a switch through the scope', async () => {
    const fake = await render()
    const toggle = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]!
    await act(async () => { toggle.click(); await Promise.resolve() })
    expect(fake.writes()).toContain('enabled')
  })

  /** One catalog candidate as discovery reports it. */
  function candidate(overrides: Partial<ModelConfig> = {}): ModelConfig {
    return {
      id: 'image-model-a',
      label: 'Image Model A',
      resolutions: ['1K', '2K'],
      resolutionDefault: '1K',
      aspectRatios: ['1:1'],
      outputFormats: ['png'],
      maxImages: 2,
      maxReferenceImages: 3,
      capabilitiesKnown: true,
      discoveredAt: 1_760_000_000_000,
      ...overrides,
    }
  }

  /** Click a button by its exact label. */
  async function clickButton(label: string): Promise<void> {
    const button = [...container.querySelectorAll('button')].find(candidateButton => candidateButton.textContent === label)
    expect(button, `button ${label} not found`).toBeDefined()
    await act(async () => { button!.click(); await Promise.resolve() })
  }

  it('saves the discovery time with the selected model', async () => {
    const api = fakeApi({
      catalog: {
        ok: true,
        value: {
          models: [candidate()],
          origin: 'catalog',
          catalogUrl: 'http://127.0.0.1:8081/api/v1/catalog/models',
          scanned: 1,
          attempts: [],
        },
      },
    })
    const fake = await render({ apiUrl: 'http://127.0.0.1:8080/v1' }, api)
    await clickButton('检测可用模型')
    expect(api.discoveries()).toBe(1)
    // Select the model, then save it.
    const row = [...container.querySelectorAll('label')].find(label => label.textContent?.includes('Image Model A'))!
    const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => { box.click(); await Promise.resolve() })
    await clickButton('保存模型')
    const writes = fake.ops.filter(
      (op): op is Extract<SettingsOp, { op: 'set' }> => op.op === 'set' && op.path[0] === 'models',
    )
    const written = writes[0]!.value as ModelConfig[]
    // The stamp travels into the saved settings, and a later failed refresh
    // leaves it (and its "may be stale" reading) in place.
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ id: 'image-model-a', discoveredAt: 1_760_000_000_000 })
    // Saving writes the whole `models` array from the facts the plugin uses, so
    // a document that still carried the retired #659 / #661 keys has them
    // cleaned off here (AC-3 / D-3).
    expect(Object.keys(written[0]!).sort()).toEqual([
      'aspectRatios', 'capabilitiesKnown', 'discoveredAt', 'id', 'label', 'maxImages',
      'maxReferenceImages', 'outputFormats', 'resolutionDefault', 'resolutions',
    ])
  })

  it('keeps the saved models when a re-detection fails', async () => {
    // Degraded state 2: a refresh that fails must not clear what the user has,
    // and must not fabricate a fresh timestamp either.
    const fake = await render({
      apiUrl: 'http://127.0.0.1:8080/v1',
      models: [candidate({ discoveredAt: 1_700_000_000_000 })],
    }, fakeApi())
    await clickButton('检测可用模型')
    expect(container.textContent).toContain('连接不上你填的地址')
    expect(fake.ops).toEqual([])
    expect(fake.writes()).toEqual([])
  })

  it('runs one automatic round when the card opens, silently when nothing changed', async () => {
    // AC-2: opening the card asks the host for a round. The host throttles it
    // against its own background timer, so the card asks exactly once per mount.
    const api = fakeApi({
      refresh: {
        ok: true,
        value: { ran: true, result: { refreshedAt: 1_760_000_000_000, adopted: [], added: [], missing: [] } },
      },
    })
    const fake = await render({ apiUrl: 'http://127.0.0.1:8080/v1' }, api)
    expect(api.refreshes()).toBe(1)
    // Nothing changed: no notice, no staged rows, no settings write.
    expect(fake.ops).toEqual([])
    expect(container.textContent).not.toContain('还没加入')
    expect(container.textContent).not.toContain('已刷新')
  })

  it('stages the models a new catalog gained, pre-ticked, without adopting them', async () => {
    // AC-4: a model the user has not saved is only *reported*. It arrives as a
    // ticked row next to the saved ones, so adding it is one 「保存模型」 — but
    // nothing is written until the user presses that.
    const saved = candidate({ id: 'image-model-saved', label: 'Saved Model' })
    const fresh = candidate({ id: 'image-model-new', label: 'Brand New Model' })
    const api = fakeApi({
      refresh: {
        ok: true,
        value: {
          ran: true,
          result: { refreshedAt: 1_760_000_000_000, adopted: ['image-model-saved'], added: ['image-model-new'], missing: [] },
          catalog: {
            models: [saved, fresh],
            origin: 'catalog',
            catalogUrl: 'http://127.0.0.1:8081/api/v1/catalog/models',
            scanned: 2,
            attempts: [],
          },
        },
      },
    })
    const fake = await render({
      apiUrl: 'http://127.0.0.1:8080/v1',
      models: [saved],
      defaultModel: 'image-model-saved',
    }, api)
    // The automatic round is a promise chain of its own (host round → settings
    // reload → re-render), so let it drain before asserting on what it staged.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(container.textContent).toContain('1 个还没加入的模型')
    expect(container.textContent).toContain('已刷新 1 个已保存模型的能力')
    // Both rows are ticked: the saved one (its selection is preserved) and the
    // new one (stageable in one press).
    const rows = [...container.querySelectorAll('label')].filter(label => label.querySelector('input[type="checkbox"]') !== null)
    const ticked = rows.filter(row => row.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked)
      .map(row => row.textContent ?? '')
    expect(ticked.some(text => text.includes('Saved Model'))).toBe(true)
    expect(ticked.some(text => text.includes('Brand New Model'))).toBe(true)
    // Still nothing persisted: adoption is the host's job, and adding is the user's.
    expect(fake.ops).toEqual([])

    await clickButton('保存模型')
    const models = fake.ops.filter(
      (op): op is Extract<SettingsOp, { op: 'set' }> => op.op === 'set' && op.path[0] === 'models',
    )[0]!.value as ModelConfig[]
    expect(models.map(model => model.id)).toEqual(['image-model-saved', 'image-model-new'])
  })

  it('says nothing when the automatic round fails or is throttled', async () => {
    // AC-1 / AC-10: failure is silent. The card must not turn a background
    // problem into a message the user has to deal with.
    for (const value of [
      { ran: false as const, skipped: 'failed' as const },
      { ran: false as const, skipped: 'throttled' as const },
      { ran: false as const, skipped: 'not-configured' as const },
    ]) {
      const api = fakeApi({ refresh: { ok: true, value } })
      await render({ apiUrl: 'http://127.0.0.1:8080/v1', models: [candidate()] }, api)
      expect(api.refreshes()).toBe(1)
      expect(container.textContent).not.toContain('自动')
      expect(container.textContent).not.toContain('刷新')
    }
  })
})
