/**
 * The host's folder chooser, as this plugin consumes it (host half).
 *
 * DSH composes `ctx.directoryPicker` — on a local host the `native` backend opens
 * one OS chooser on the host's screen (on Windows the modern `IFileOpenDialog`,
 * i.e. the familiar Explorer-style dialog), while a remote deployment composes
 * `browse` and serves listing primitives to the shell's own in-app browser
 * instead. The seam's documented rule is to **hide the affordance** for a
 * capability we cannot drive, so the settings card asks {@link directoryPickerStatus}
 * first and only then offers a button.
 *
 * Two deliberate choices:
 * - The service is **never declared in `inject`** and never captured at plugin
 *   load: a deployment without a picker must keep working, and the backend may
 *   attach after us. It is probed per request — the same rule as `conversation`.
 * - The service is consumed **structurally**, without importing
 *   `@deepseek-ai/dsh-host-directory-picker`: the contract we use is tiny, and the
 *   plugin's dependency surface stays as it is.
 */

import { isAbsolute } from 'node:path'
import type { DirectoryPickerStatus } from './protocol.ts'

/** What one pick attempt produced. */
export type PickDirectoryOutcome =
  | { kind: 'picked'; path: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: string; message: string }

/** The `native` interaction: one OS chooser, `null` when the operator cancels. */
interface NativeCapability {
  kind: 'native'
  pick(signal: AbortSignal): Promise<string | null>
}

/** The service shape we consume. */
interface DirectoryPickerService {
  capability(): { kind?: string } | null | undefined
}

/** The service behind an unknown value, when it looks like the seam. */
function serviceOf(value: unknown): DirectoryPickerService | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as DirectoryPickerService
  return typeof candidate.capability === 'function' ? candidate : undefined
}

/** The capability object, or undefined when the service refuses to describe itself. */
function capabilityOf(service: DirectoryPickerService): { kind?: string } | undefined {
  try {
    const capability = service.capability()
    return capability !== null && typeof capability === 'object' ? capability : undefined
  } catch {
    return undefined
  }
}

/**
 * How the host can choose a directory, without opening anything.
 * @param value - the `ctx.directoryPicker` service, or anything else.
 * @returns the capability kind plus an operator-facing note when it is not native.
 */
export function directoryPickerStatus(value: unknown): DirectoryPickerStatus {
  const service = serviceOf(value)
  if (service === undefined) {
    return {
      kind: 'none',
      message: '这台宿主没有挂载目录选择器，改不了素材目录（可以在插件设置文档里改 dataDir）。',
    }
  }
  const capability = capabilityOf(service)
  if (capability?.kind === 'native') return { kind: 'native' }
  if (capability?.kind === 'browse') {
    return {
      kind: 'browse',
      message: '这台宿主用的是网页版目录浏览（通常是远程或 SSH 场景），打不开系统窗口；可以在插件设置文档里改 dataDir。',
    }
  }
  return {
    kind: 'none',
    message: '宿主的目录选择器打不开系统窗口，可以在插件设置文档里改 dataDir。',
  }
}

/**
 * Open the host's folder chooser and wait for the operator.
 *
 * @param value - the `ctx.directoryPicker` service.
 * @param signal - caller lifetime; aborting terminates the chooser (so a closed
 *   page never leaves a stray dialog on someone's screen).
 * @returns the chosen absolute path, a cancellation, or why it could not run.
 */
export async function pickDirectory(value: unknown, signal: AbortSignal): Promise<PickDirectoryOutcome> {
  const service = serviceOf(value)
  const status = directoryPickerStatus(value)
  if (service === undefined || status.kind !== 'native') {
    return { kind: 'failed', code: `picker_${status.kind}`, message: status.message ?? '打不开目录选择窗口。' }
  }
  const capability = capabilityOf(service) as NativeCapability | undefined
  if (capability === undefined || typeof capability.pick !== 'function') {
    return { kind: 'failed', code: 'picker_unusable', message: '宿主的目录选择器不可用。' }
  }
  try {
    const chosen = await capability.pick(signal)
    // The seam answers `null` for a cancellation; an empty string is the same thing.
    if (typeof chosen !== 'string' || chosen.trim() === '') return { kind: 'cancelled' }
    const path = chosen.trim()
    if (!isAbsolute(path)) {
      return { kind: 'failed', code: 'picker_relative', message: `宿主返回的路径不是绝对路径：${path}` }
    }
    return { kind: 'picked', path }
  } catch (error) {
    if (signal.aborted) return { kind: 'failed', code: 'picker_aborted', message: '选择目录被中断。' }
    return { kind: 'failed', code: 'picker_failed', message: error instanceof Error ? error.message : '打开目录选择窗口失败。' }
  }
}
