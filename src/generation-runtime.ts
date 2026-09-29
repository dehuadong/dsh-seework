/**
 * The host-resident generation runtime: one task store shared by the browser
 * panel, the agent tools, and (later) the canvas, so persistence, cancellation,
 * and retry semantics are identical no matter where a request originated.
 *
 * Every completed task is written into the local material library before it is
 * reported as done, which is what makes the sidebar library a faithful record
 * of what the conversation produced.
 */

import { randomUUID } from 'node:crypto'
import { generateImage } from './engine.ts'
import { appendLibraryEntry } from './library.ts'
import { resolveRequest, type DroppedParameter } from './capability.ts'
import { effectiveConfig, resolveModel, type EffectiveConfig } from './settings.ts'
import type { GenerateRequest, GenerateResult, GenerationTask, GenerationTaskStatus } from './protocol.ts'

/** Task states that will not change again. */
export function isFinalStatus(status: GenerationTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

/**
 * How many generations may run at once **per model**.
 *
 * SeeAI Hub serializes one image generation per user and model — a second
 * in-flight request for the same model is refused with 409. The plugin used to
 * queue such a second request; it no longer does (#658): **one task is one
 * request**, so a submission that cannot start immediately is refused outright
 * and the user decides whether to send it again. Different models are
 * independent: one model running does not hold another back.
 */
const MAX_CONCURRENT_PER_MODEL = 1

/** The tail every per-model refusal shares, so the two wordings cannot drift. */
const BUSY_REFUSAL = '：本次没有发起生成，也没有扣费。请如实告知用户，得到许可后再发。'

/** Tasks kept in memory for status queries. */
const MAX_RETAINED_TASKS = 200

/** Internal record: the wire task plus its abort handle and waiters. */
interface TaskRecord {
  task: GenerationTask
  controller: AbortController
  waiters: Set<(task: GenerationTask) => void>
}

/**
 * The shared generation store: submit, watch, cancel.
 *
 * `submit` starts the task immediately or **refuses** (no queue, #658); callers
 * that want the finished task await `waitFor`.
 */
export class GenerationRuntime {
  private readonly records = new Map<string, TaskRecord>()
  private readonly order: string[] = []
  /** Models with a task in flight (see MAX_CONCURRENT_PER_MODEL). */
  private readonly runningModels = new Set<string>()

  constructor(private readonly resolveConfig: () => EffectiveConfig) {}

  /** A snapshot of every retained task, newest first. */
  list(): GenerationTask[] {
    return [...this.order].reverse().map(id => this.records.get(id)!.task)
  }

  /** One task by id. */
  get(id: string): GenerationTask | undefined {
    return this.records.get(id)?.task
  }

  /**
   * Start one generation.
   * @param request - the normalized request; its model must exist in the catalog.
   * @param source - who asked (library records carry this).
   * @param sessionId - owning agent session, when applicable.
   * @returns the task that just started.
   */
  submit(request: GenerateRequest, source: GenerationTask['source'], sessionId?: string): GenerationTask {
    const config = this.resolveConfig()
    const requested = request.model.trim()
    const model = resolveModel(config, requested)
    // An explicit name must match a configured model: falling back to the
    // default would silently generate with a model the caller did not ask for.
    if (model === undefined || (requested !== '' && model.id !== requested)) {
      const available = config.models.map(entry => entry.id).join('、')
      throw new SeeWorkRuntimeError(
        requested === ''
          ? '还没有可用的模型：请在「设置 → 插件 → SeeWork」点击「检测可用模型」并保存。'
          : `模型「${requested}」不在已配置的清单里。可用模型：${available === '' ? '（没有）' : available}。`,
        requested === '' ? 'no-models-configured' : 'model-not-configured',
      )
    }
    // Normalize against the model's declared capabilities: SeeAI Hub refuses a
    // value outside a model's enum, and refuses parameters the model does not
    // take at all, so an unaccepted default must become "omit", not a 400.
    const { request: normalized, dropped } = resolveRequest(
      { ...request, model: model.id, prompt: request.prompt.trim() },
      model,
      { outputFormat: config.outputFormat, aspectRatio: config.defaultAspectRatio },
    )
    // One task is one request (#658): a model that is already running refuses a
    // second submission instead of queueing it — the user decides whether to
    // send it again once the first one ends.
    if (this.runningModels.has(model.id)) {
      throw new SeeWorkRuntimeError(
        `模型「${model.id}」已有生成请求在跑${BUSY_REFUSAL}`,
        'model-busy',
      )
    }
    const id = randomUUID()
    const task: GenerationTask = {
      id,
      request: normalized,
      status: 'running',
      createdAt: Date.now(),
      startedAt: Date.now(),
      source,
      ...sessionId === undefined ? {} : { sessionId },
      ...dropped.length === 0 ? {} : { droppedParameters: dropped },
    }
    const record: TaskRecord = { task, controller: new AbortController(), waiters: new Set() }
    this.records.set(id, record)
    this.order.push(id)
    this.trim()
    this.runningModels.add(model.id)
    void this.run(record, model.id)
    return task
  }

  /** Cancel a running task. */
  cancel(id: string): GenerationTask | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    if (isFinalStatus(record.task.status)) return record.task
    record.controller.abort(new Error('cancelled'))
    this.settle(record, { status: 'cancelled', error: '生图已取消。' })
    return record.task
  }

  /**
   * Wait for one task to reach a final state.
   *
   * The caller's `signal` is deliberately decoupled from the task's lifetime:
   * aborting the wait rejects the caller, but the generation keeps running
   * (a caller that really wants it dead calls {@link cancel}). Only cancelling
   * or finishing the task moves it to a final state.
   *
   * @param id - task id from {@link submit}.
   * @param signal - caller-side cancellation of this wait.
   */
  waitFor(id: string, signal?: AbortSignal): Promise<GenerationTask> {
    const record = this.records.get(id)
    if (record === undefined) {
      return Promise.reject(new SeeWorkRuntimeError(`找不到生图任务 ${id}。`, 'task-not-found'))
    }
    if (isFinalStatus(record.task.status)) return Promise.resolve(record.task)
    return new Promise<GenerationTask>((resolve, reject) => {
      let done = false
      const finish = (task: GenerationTask): void => {
        if (done) return
        done = true
        signal?.removeEventListener('abort', onAbort)
        resolve(task)
      }
      const onAbort = (): void => {
        if (done) return
        done = true
        record.waiters.delete(finish)
        reject(new SeeWorkRuntimeError('等待生图结果已中断（任务仍在继续）。', 'wait-aborted'))
      }
      record.waiters.add(finish)
      if (signal?.aborted === true) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Execute one task end to end and settle it. */
  private async run(record: TaskRecord, model: string): Promise<void> {
    const config = this.resolveConfig()
    try {
      const result = await generateImage(
        { apiUrl: config.apiUrl, apiKey: config.apiKey },
        record.task.request,
        { signal: record.controller.signal },
      )
      const entry = await appendLibraryEntry({
        request: record.task.request,
        images: result.images,
        ...result.cost === undefined ? {} : { cost: result.cost },
        source: record.task.source,
        ...record.task.sessionId === undefined ? {} : { sessionId: record.task.sessionId },
      })
      const settled: GenerateResult = result
      this.settle(record, { status: 'completed', result: settled, entryId: entry.id })
    } catch (error) {
      if (record.controller.signal.aborted) {
        this.settle(record, { status: 'cancelled', error: '生图已取消。' })
        return
      }
      this.settle(record, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      // Release this model (#658): nothing is queued behind it, so a finished
      // task simply makes the model available again.
      this.runningModels.delete(model)
    }
  }

  /** Move a task to its final state and wake everyone waiting on it. */
  private settle(
    record: TaskRecord,
    outcome: { status: GenerationTaskStatus; result?: GenerateResult; entryId?: string; error?: string },
  ): void {
    record.task = {
      ...record.task,
      status: outcome.status,
      finishedAt: Date.now(),
      ...outcome.result === undefined ? {} : { result: outcome.result },
      ...outcome.entryId === undefined ? {} : { entryId: outcome.entryId },
      ...outcome.error === undefined ? {} : { error: outcome.error },
    }
    this.records.set(record.task.id, record)
    for (const waiter of [...record.waiters]) {
      record.waiters.delete(waiter)
      waiter(record.task)
    }
  }

  /** Drop the oldest settled tasks once the retention cap is exceeded. */
  private trim(): void {
    while (this.order.length > MAX_RETAINED_TASKS) {
      const id = this.order[0]!
      const record = this.records.get(id)
      if (record !== undefined && !isFinalStatus(record.task.status)) break
      this.order.shift()
      this.records.delete(id)
    }
  }
}

/** A runtime failure with a stable machine code. */
export class SeeWorkRuntimeError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'SeeWorkRuntimeError'
  }
}
