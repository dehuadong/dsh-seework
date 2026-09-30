/**
 * The SeeWork settings card (Settings → Plugins → SeeWork).
 *
 * Edits the SeeAI Hub connection (API address + user API key), the image-model
 * catalog, and generation defaults. The local data root is shown but **not
 * editable**: it is the plugin's own storage location, and nobody should have to
 * type a filesystem path into a form (user report: 「素材目录不应该手动填写地址」).
 * Changing it stays possible through the plugin's settings document.
 *
 * The address and key are staged rather than written on every keystroke:
 * "检测可用模型" probes exactly what is on screen, and "保存连接" persists it.
 * That matters because the API key is a `role('secret')` field — the wire never
 * returns the stored value, so an accidental overwrite could not be undone.
 */

import { DEFAULT_ASPECT_RATIO, DEFAULT_OUTPUT_FORMAT, OUTPUT_FORMAT_FALLBACKS, UNIFIED_ASPECT_RATIOS, includesIgnoringCase, type DirectoryPickerStatus, type ModelConfig } from '../protocol.ts'
import { Button, Pill, TextInput, Toggle } from './controls.tsx'
import { VersionRow } from './VersionRow.tsx'
import { useCallback, useEffect, useState } from 'react'
import { SeeWorkApi } from './api.ts'
import type { SeeWorkConfig, SeeWorkScope } from './settings-scope.ts'
import css from './settings-card.module.css'

/** What the card controller hands its component. */
export interface SettingsCardFace {
  scope: SeeWorkScope
  api: SeeWorkApi
}

/** Persisted catalog entries, normalized for display. */
function selectedModels(config: SeeWorkConfig | undefined): ModelConfig[] {
  return Array.isArray(config?.models) ? config.models : []
}

/** Re-render on every scope or secret change. */
function useScopeSnapshot(scope: SeeWorkScope): { config: SeeWorkConfig | undefined; status: string; keySet: boolean } {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = (): void => { setTick(value => value + 1) }
    const stops = [scope.subscribe(bump), scope.subscribeSecrets(bump)]
    return () => { for (const stop of stops) stop() }
  }, [scope])
  void tick
  const snapshot = scope.getSnapshot()
  return { config: snapshot.value, status: snapshot.status, keySet: scope.getSecretSet('apiKey') }
}

/** The settings card. */
export function SeeWorkSettingsCard({ scope, api }: SettingsCardFace): JSX.Element {
  const { config, status, keySet } = useScopeSnapshot(scope)
  const [draftApiUrl, setDraftApiUrl] = useState<string | undefined>(undefined)
  const [draftServiceUrl, setDraftServiceUrl] = useState<string | undefined>(undefined)
  const [draftApiKey, setDraftApiKey] = useState('')
  const [candidates, setCandidates] = useState<ModelConfig[] | undefined>(undefined)
  /**
   * Whether the staged rows came from the automatic round (#652).
   *
   * The model section seeds its ticks differently for the two sources: a manual
   * detection stages exactly the saved choices, while the automatic round also
   * pre-ticks the models the catalog gained, so adding one is a single
   * 「保存模型」. It is a prop rather than section state because only the parent
   * knows which round produced the rows.
   */
  const [stagedFromAuto, setStagedFromAuto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | undefined>(undefined)
  /** The data root the host actually resolved, for the read-only display. */
  const [resolvedRoot, setResolvedRoot] = useState('')
  /** How the host can choose a folder (asking opens nothing). */
  const [picker, setPicker] = useState<DirectoryPickerStatus | undefined>(undefined)

  const apiUrl = draftApiUrl ?? config?.apiUrl ?? ''
  const serviceUrl = draftServiceUrl ?? config?.serviceUrl ?? ''
  const persisted = selectedModels(config)
  /** Whether the user moved the data root away from the default. */
  const customRoot = (config?.dataDir ?? '').trim() !== ''

  /**
   * Ask the host where the library really lives.
   *
   * The configured value may be empty (the default) or relative to DSH_HOME, and
   * only the host knows — so the card shows the host's answer instead of guessing.
   */
  const refreshRoot = useCallback(async (): Promise<void> => {
    const result = await api.library()
    if (result.ok) setResolvedRoot(result.value.dataRoot)
  }, [api])

  useEffect(() => {
    let live = true
    // Where the data lives, and whether this host can open a folder chooser.
    void api.library().then(result => {
      if (live && result.ok) setResolvedRoot(result.value.dataRoot)
    }).catch(() => {})
    void api.directoryPicker().then(result => {
      if (live && result.ok) setPicker(result.value)
    }).catch(() => {})
    return () => { live = false }
  }, [api])

  /** Open the host's folder chooser and store what it returns. */
  const chooseDirectory = useCallback(async (): Promise<void> => {
    setBusy(true)
    setNotice(undefined)
    const result = await api.pickDirectory()
    if (!result.ok) {
      setBusy(false)
      setNotice({ tone: 'warn', text: result.message })
      return
    }
    // Cancelling the dialog is not an error and needs no message.
    if (result.value.path === undefined) {
      setBusy(false)
      return
    }
    const path = result.value.path
    await scope.set('dataDir', path)
    await scope.load()
    await refreshRoot()
    setBusy(false)
    setNotice({ tone: 'ok', text: `素材目录已改为 ${path}（旧目录里的文件没有被删）。` })
  }, [api, refreshRoot, scope])

  /** Go back to the plugin's own default location. */
  const restoreDefaultDirectory = useCallback(async (): Promise<void> => {
    setBusy(true)
    setNotice(undefined)
    await scope.unset('dataDir')
    await scope.load()
    await refreshRoot()
    setBusy(false)
    setNotice({ tone: 'ok', text: '素材目录已恢复默认（旧目录里的文件没有被删）。' })
  }, [refreshRoot, scope])

  /** Write one scalar field and re-read the section. */
  const write = useCallback((field: string, value: unknown): void => {
    void scope.set(field, value).then(() => scope.load())
  }, [scope])

  /** Persist the staged connection fields. */
  const saveConnection = useCallback(async (): Promise<void> => {
    setBusy(true)
    const ops: Parameters<SeeWorkScope['mutateOps']>[0] = []
    if (apiUrl.trim() !== (config?.apiUrl ?? '')) ops.push({ op: 'set', path: ['apiUrl'], value: apiUrl.trim() })
    if (serviceUrl.trim() !== (config?.serviceUrl ?? '')) ops.push({ op: 'set', path: ['serviceUrl'], value: serviceUrl.trim() })
    if (draftApiKey.trim() !== '') ops.push({ op: 'set', path: ['apiKey'], value: draftApiKey.trim() })
    if (ops.length === 0) {
      setBusy(false)
      setNotice({ tone: 'warn', text: '没有需要保存的改动。' })
      return
    }
    await scope.mutateOps(ops)
    await scope.load()
    setDraftApiUrl(undefined)
    setDraftServiceUrl(undefined)
    setDraftApiKey('')
    setBusy(false)
    setNotice({ tone: 'ok', text: '连接设置已保存。' })
  }, [apiUrl, config?.apiUrl, config?.serviceUrl, draftApiKey, scope, serviceUrl])

  /**
   * The automatic detection round that runs when the card opens (#652).
   *
   * It keeps the saved snapshot fresh without the user doing anything: the host
   * adopts refreshed capabilities itself (that never changes the selection), and
   * this only surfaces what it *found* — models the user has not saved are staged
   * as ticked rows, so adding them is one 「保存模型」 rather than a re-detect.
   *
   * Deliberately silent on everything else: no configuration yet, a throttled
   * round, an unreachable service, or a plugin with nothing saved all resolve to
   * "do nothing here". The card's own 「检测可用模型」 remains the explicit path
   * that reports failures.
   */
  useEffect(() => {
    if (status !== 'ready') return
    let live = true
    void api.catalogRefresh().then(result => {
      if (!live || !result.ok || !result.value.ran) return
      const summary = result.value.result
      const catalog = result.value.catalog
      if (summary === undefined || catalog === undefined) return
      void scope.load()
      const parts: string[] = []
      if (summary.added.length > 0) {
        setStagedFromAuto(true)
        setCandidates(catalog.models)
        parts.push(`目录里有 ${summary.added.length} 个还没加入的模型，已勾选，点「保存模型」即可加入`)
      }
      if (summary.missing.length > 0) {
        parts.push(`有 ${summary.missing.length} 个已保存模型在目录里找不到了（快照保留着，是否移除由你决定）`)
      }
      if (summary.adopted.length > 0) parts.push(`已刷新 ${summary.adopted.length} 个已保存模型的能力`)
      if (parts.length > 0) setNotice({ tone: 'warn', text: `${parts.join('；')}。` })
    }).catch(() => {})
    return () => { live = false }
    // `status` gates the first run; `scope` and `api` are stable for the card's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, api, scope])

  /** Probe the catalog with the on-screen addresses and key. */
  const detect = useCallback(async (): Promise<void> => {
    setBusy(true)
    setNotice(undefined)
    setStagedFromAuto(false)
    const result = await api.catalog({ apiUrl: apiUrl.trim(), serviceUrl: serviceUrl.trim(), apiKey: draftApiKey.trim() })
    setBusy(false)
    if (!result.ok) {
      setCandidates(undefined)
      // The host reports every address it tried; show them so a wrong address
      // is a five-second fix rather than a mystery.
      setNotice({ tone: 'error', text: `检测失败：${result.message}` })
      return
    }
    setCandidates(result.value.models)
    const tried = result.value.attempts
      .map(attempt => `${attempt.url}（${attempt.outcome}）`)
      .join('；')
    if (result.value.models.length === 0) {
      setNotice({
        tone: 'warn',
        text: `扫到 ${result.value.scanned} 个模型，其中没有图片模型。来源：${tried}`,
      })
      return
    }
    setNotice({
      tone: 'ok',
      text: `发现 ${result.value.models.length} 个图片模型（共扫描 ${result.value.scanned} 个），来自 ${result.value.catalogUrl}。勾选后点「保存模型」。`,
    })
  }, [api, apiUrl, draftApiKey, serviceUrl])

  /** Persist one catalog selection (a whole-array write, secrets untouched). */
  const saveModels = useCallback(async (selection: ModelConfig[]): Promise<void> => {
    setBusy(true)
    // Discovery already answers with the stored shape (#669), so the selection is
    // written as it stands: the field list and the rules that make a degenerate
    // value safe live in `capability.ts` (the schema, the read-back and the
    // ceiling), not here. The discovery time travels with it too — a dated surface
    // reports it, and a failed re-detection leaves the old value (and its honest
    // "may be stale" reading) in place.
    const models: ModelConfig[] = selection
    // One atomic write: `models` and `defaultModel` must not be able to land
    // apart (a revision conflict between two writes would leave them disagreeing).
    const ops: Parameters<SeeWorkScope['mutateOps']>[0] = [{ op: 'set', path: ['models'], value: models }]
    if (models.length > 0 && (config?.defaultModel ?? '') === '') {
      ops.push({ op: 'set', path: ['defaultModel'], value: models[0]!.id })
    }
    await scope.mutateOps(ops)
    await scope.load()
    setBusy(false)
    setNotice({ tone: 'ok', text: `已保存 ${models.length} 个模型。` })
  }, [config?.defaultModel, scope])

  if (status === 'loading') {
    return <div className={css.card}><p className={css.muted}>正在读取设置…</p></div>
  }
  if (status === 'unavailable') {
    return (
      <div className={css.card}>
        <p className={css.error}>
          设置接口不可达。请确认浏览器打开的就是本机 DSH 宿主（该接口只监听本机回环地址）。
        </p>
      </div>
    )
  }

  return (
    <div className={css.card}>
      <section className={css.section}>
        <h3 className={css.sectionTitle}>SeeAI Hub 连接</h3>
        <label className={css.field}>
          <span className={css.label}>API 地址</span>
          <TextInput
            value={apiUrl}
            placeholder="http://127.0.0.1:8080/v1"
            spellCheck={false}
            onChange={event => { setDraftApiUrl(event.target.value) }}
          />
        </label>
        <p className={css.hint}>
          生成接口的地址，填到 <code>/v1</code> 为止。开发环境默认 <code>http://127.0.0.1:8080/v1</code>。
        </p>
        <label className={css.field}>
          <span className={css.label}>模型目录地址</span>
          <TextInput
            value={serviceUrl}
            placeholder="http://127.0.0.1:8081"
            spellCheck={false}
            onChange={event => { setDraftServiceUrl(event.target.value) }}
          />
        </label>
        <p className={css.hint}>
          SeeAI Hub 的「模型目录」在 service 上（默认 <code>127.0.0.1:8081</code>），不在生成网关上；
          两个地址各管各的。如果你的部署把两者挂在同一个域名下，填同一个域名即可——插件两个地址都会试，并把结果告诉你。
        </p>
        <label className={css.field}>
          <span className={css.label}>
            用户 API Key
            {keySet ? <Pill>已保存</Pill> : null}
          </span>
          <TextInput
            value={draftApiKey}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={keySet ? '留空表示不修改已保存的 Key' : 'sk-…'}
            onChange={event => { setDraftApiKey(event.target.value) }}
          />
        </label>
        <p className={css.hint}>
          在 SeeAI Hub 后台「API Keys」里创建的设备 Key。密钥只写在本机设置文档里，不会存到浏览器。
        </p>
        <div className={css.row}>
          <Button variant="outline" disabled={busy} onClick={() => { void detect() }}>
            {busy ? '处理中…' : '检测可用模型'}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => { void saveConnection() }}>
            保存连接
          </Button>
        </div>
      </section>

      <ModelSection
        persisted={persisted}
        candidates={candidates}
        stagedFromAuto={stagedFromAuto}
        busy={busy}
        onSave={selection => { void saveModels(selection) }}
      />

      <section className={css.section}>
        <h3 className={css.sectionTitle}>生成默认值</h3>
        <DefaultsFields config={config} models={persisted} onWrite={write} />
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>本地与行为</h3>
        <div className={css.field}>
          <span className={css.label}>素材目录</span>
          <div className={css.dirRow}>
            <span className={css.fixedValue} data-dsh-seework-datadir="" title={resolvedRoot}>
              {resolvedRoot !== '' ? resolvedRoot : '~/.dsh/dsh-seework（默认）'}
            </span>
            {picker?.kind === 'native'
              ? (
                <Button
                  disabled={busy}
                  data-dsh-seework-pick-dir=""
                  title="打开系统的文件夹选择窗口"
                  onClick={() => { void chooseDirectory() }}
                >
                  选择目录…
                </Button>
              )
              : null}
            {customRoot
              ? (
                <Button
                  disabled={busy}
                  data-dsh-seework-reset-dir=""
                  title="回到插件自己的默认位置"
                  onClick={() => { void restoreDefaultDirectory() }}
                >
                  恢复默认
                </Button>
              )
              : null}
          </div>
        </div>
        <p className={css.hint}>
          {picker === undefined || picker.kind === 'native'
            ? '对话里生成的图片、画布上的合成图都存在这里；换目录只是换个地方读写，旧目录里的文件不会被删。'
            : picker.message}
        </p>
        <BehaviorSwitches config={config} onWrite={write} />
        <div className={css.row}>
          <Button variant="primary" disabled={busy} onClick={() => { void saveConnection() }}>
            保存
          </Button>
        </div>
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>版本</h3>
        <VersionRow api={api} />
      </section>

      {notice !== undefined
        ? <p className={notice.tone === 'ok' ? css.ok : notice.tone === 'warn' ? css.warn : css.error}>{notice.text}</p>
        : null}
    </div>
  )
}

/** The model catalog section: detection results plus the persisted selection. */
function ModelSection({
  persisted,
  candidates,
  stagedFromAuto,
  busy,
  onSave,
}: {
  persisted: ModelConfig[]
  candidates: ModelConfig[] | undefined
  /**
   * True when `candidates` came from the automatic round, whose rows pre-tick the
   * models the catalog gained; a manual detection stages the saved choices as-is.
   */
  stagedFromAuto: boolean
  busy: boolean
  onSave: (selection: ModelConfig[]) => void
}): JSX.Element {
  // Until a detection runs, the table shows what is already saved; afterwards a
  // detection result the user has not accepted yet is what they see. Discovery
  // answers with the stored shape since #669, so a row is a model — only the
  // display label needs filling in.
  const rows = (candidates ?? persisted).map(model => ({ ...model, label: model.label ?? '' }))

  const [selected, setSelected] = useState<string[] | undefined>(undefined)
  // The staged selection is seeded when a detection result arrives, and only
  // then: re-seeding on every settings write would throw away boxes the user just
  // ticked (they type a default, the section re-reads, the ticks vanish).
  const persistedIds = persisted.map(model => model.id).join('\n')
  useEffect(() => {
    if (candidates === undefined) {
      setSelected(undefined)
      return
    }
    const stored = persistedIds === '' ? [] : persistedIds.split('\n')
    // A manual detection stages the saved choices as they are; the automatic
    // round additionally pre-ticks what the catalog gained (#652), so adding a
    // model is one 「保存模型」 per new row rather than a hunt for it.
    setSelected(stagedFromAuto
      ? [...new Set([...stored, ...candidates.map(model => model.id).filter(id => !stored.includes(id))])]
      : stored.filter(id => candidates.some(model => model.id === id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persistedIds and the source flag are read, not triggers
  }, [candidates])

  const checked = new Set(selected ?? persisted.map(model => model.id))
  const pending = rows.filter(model => checked.has(model.id))

  return (
    <section className={css.section}>
      <h3 className={css.sectionTitle}>图片模型</h3>
      <p className={css.hint}>
        只勾选你的网关确实支持生图的模型。没有目录信息的网关按「仅文生图、参数由上游决定」处理。
      </p>
      {rows.length === 0
        ? <p className={css.muted}>还没有模型：先填好地址与 Key，点「检测可用模型」。</p>
        : (
          <div className={css.modelList}>
            {rows.map(model => (
              <label key={model.id} className={css.modelRow}>
                <input
                  type="checkbox"
                  checked={checked.has(model.id)}
                  onChange={event => {
                    const next = new Set(checked)
                    if (event.target.checked) next.add(model.id)
                    else next.delete(model.id)
                    setSelected(rows.filter(candidate => next.has(candidate.id)).map(candidate => candidate.id))
                  }}
                />
                <span className={css.modelMain}>
                  <span className={css.modelName}>{model.label !== '' ? model.label : model.id}</span>
                  {model.label !== '' && model.label !== model.id ? <code className={css.modelId}>{model.id}</code> : null}
                  <span className={css.modelCapability}>
                    {[
                      model.resolutions.length > 0 ? model.resolutions.join(' / ') : '档位由上游决定',
                      model.aspectRatios.length > 0 ? `${model.aspectRatios.length} 种比例` : '比例由上游决定',
                      model.maxReferenceImages > 0 ? `可带参考图 ≤${model.maxReferenceImages}` : '仅文生图',
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      <div className={css.row}>
        <Button
          variant="primary"
         
          disabled={busy || rows.length === 0}
          onClick={() => { onSave(pending) }}
        >
          保存模型
        </Button>
        {selected !== undefined
          ? <Button variant="ghost" onClick={() => { setSelected([]) }}>全不选</Button>
          : null}
      </div>
    </section>
  )
}

/**
 * Output formats to offer: what the saved models declare, or the three we know
 * (#658/D-16); the stored value is kept selectable so the control never shows
 * something other than what is stored.
 */
function outputFormatOptions(models: ModelConfig[], current: string): string[] {
  const seen: string[] = []
  for (const model of models) {
    for (const format of model.outputFormats ?? []) {
      if (!includesIgnoringCase(seen, format)) seen.push(format)
    }
  }
  return withCurrent(seen.length > 0 ? seen : [...OUTPUT_FORMAT_FALLBACKS], current)
}

/** The gateway-wide ratios (#658/D-16), keeping a stored value that is not one. */
function aspectRatioOptions(current: string): string[] {
  return withCurrent([...UNIFIED_ASPECT_RATIOS], current)
}

/** Keep a stored value selectable even when the list does not offer it (old documents). */
function withCurrent(options: string[], current: string): string[] {
  const wanted = current.trim()
  if (wanted !== '' && !includesIgnoringCase(options, wanted)) options.push(wanted)
  return options
}

/** Generation defaults; each control writes its own scalar field immediately. */
function DefaultsFields({
  config,
  models,
  onWrite,
}: {
  config: SeeWorkConfig | undefined
  models: ModelConfig[]
  onWrite: (field: string, value: unknown) => void
}): JSX.Element {
  // The two defaulted values a user may override here. Resolution is deliberately
  // absent: it is derived per model (#658/D-17), and "images per request" is gone
  // too (#658/D-15) — `n` defaults to 1 in code.
  const ratio = config?.defaultAspectRatio?.trim() || DEFAULT_ASPECT_RATIO
  const format = config?.outputFormat?.trim() || DEFAULT_OUTPUT_FORMAT
  return (
    <div className={css.grid}>
      <label className={css.field}>
        <span className={css.label}>默认模型</span>
        <select
          className={css.select}
          value={config?.defaultModel ?? ''}
          onChange={event => { onWrite('defaultModel', event.target.value) }}
        >
          <option value="">（目录里的第一个）</option>
          {models.map(model => (
            <option key={model.id} value={model.id}>{model.label !== undefined && model.label !== '' ? model.label : model.id}</option>
          ))}
        </select>
      </label>
      <label className={css.field}>
        <span className={css.label}>默认比例</span>
        <select
          className={css.select}
          value={ratio}
          onChange={event => { onWrite('defaultAspectRatio', event.target.value) }}
        >
          {aspectRatioOptions(ratio).map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label className={css.field}>
        <span className={css.label}>输出格式</span>
        <select
          className={css.select}
          value={format}
          onChange={event => { onWrite('outputFormat', event.target.value) }}
        >
          {outputFormatOptions(models, format).map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    </div>
  )
}

/** Plugin switches. */
function BehaviorSwitches({
  config,
  onWrite,
}: {
  config: SeeWorkConfig | undefined
  onWrite: (field: string, value: unknown) => void
}): JSX.Element {
  return (
    <div className={css.switches}>
      <Toggle
        checked={config?.enabled ?? true}
        label="启用插件"
        onChange={next => { onWrite('enabled', next) }}
      />
      <Toggle
        checked={config?.allowAgentGeneration ?? true}
        label="允许 Agent 生图"
        onChange={next => { onWrite('allowAgentGeneration', next) }}
      />
      <Toggle
        checked={config?.announceToAgent ?? true}
        label="把插件与模型告知 Agent"
        onChange={next => { onWrite('announceToAgent', next) }}
      />
    </div>
  )
}
