/**
 * Agent-tool boundary tests: whatever the model is told about a generation is
 * all it can ever know — it never receives the pixels. So the result has to name
 * the library entry *and* the exact file, URL and path the image was stored as.
 *
 * @vitest-environment node
 */

import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { guiOrigin, registerAgentImageTools, withLibraryLocation } from './agent-tools.ts'
import { SKILL_NAME } from './capabilities-skill.ts'
import { GenerationRuntime } from './generation-runtime.ts'
import { appendLibraryEntry, setLibraryDataRoot } from './library.ts'
import { fixtureRequest, pngBuffer } from './fixtures.ts'
import type { GenerationTask, GenerateRequest } from './protocol.ts'
import { effectiveConfig, type Config } from './settings.ts'

/** One registered tool as the stub host records it. */
interface RegisteredTool {
  name: string
  /** What the model is told about this tool; resident with the tool definition. */
  description: string
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown>
  /** The tool's declared output: its UI projection is persisted with the result. */
  output?: { presentationMeta?: (args: unknown, value: unknown) => unknown }
  /** The argument schema the model sees. */
  parameters?: Record<string, unknown>
}

/** A settings document that is configured just enough to pass the gate. */
function document(): Config {
  return {
    apiUrl: 'http://127.0.0.1:8080/v1',
    serviceUrl: 'http://127.0.0.1:8081',
    apiKey: 'sk-x',
    models: [{
      id: 'seedream-5-0-lite',
      label: 'Seedream 5.0 Lite',
      resolutions: ['2K'],
      aspectRatios: ['16:9'],
      outputFormats: ['png'],
      maxImages: 4,
      maxReferenceImages: 2,
      capabilitiesKnown: true,
    }],
    defaultModel: 'seedream-5-0-lite',
  }
}

describe('withLibraryLocation', () => {
  const image = { attachment_id: 'attachment-0', media_type: 'image/png', bytes: 10, width: 4, height: 4 }

  it('adds the file, URL and absolute path of the stored image', () => {
    const enriched = withLibraryLocation('entry-1', image, 0)
    expect(enriched.file).toBe('entry-1-0.png')
    expect(enriched.url).toBe('/api/dsh-seework/library/image/entry-1-0.png')
    expect(enriched.path?.endsWith(path.join('images', 'entry-1-0.png'))).toBe(true)
    // The attachment identity has to survive: that is what a later edit call
    // (`generate_image` with `reference_images`) gets back.
    expect(enriched.attachment_id).toBe('attachment-0')
    // Without a known GUI origin there is no link the model could put in a reply.
    expect(enriched).not.toHaveProperty('absolute_url')
  })

  it('adds a fully qualified URL the model can put in its own reply', () => {
    const enriched = withLibraryLocation('entry-1', image, 1, 'http://127.0.0.1:3080')
    expect(enriched.absolute_url).toBe('http://127.0.0.1:3080/api/dsh-seework/library/image/entry-1-1.png')
    expect(enriched.url).toBe('/api/dsh-seework/library/image/entry-1-1.png')
  })

  it('leaves an image without a library entry untouched', () => {
    expect(withLibraryLocation(undefined, image, 0, 'http://127.0.0.1:3080')).toEqual(image)
  })
})

describe('guiOrigin', () => {
  it('reads the live port the web server is bound to', () => {
    expect(guiOrigin({ webServer: { port: 3080 } })).toBe('http://127.0.0.1:3080')
  })

  it('invents nothing when the host cannot say', () => {
    // A wrong address in a reply is worse than no address at all.
    expect(guiOrigin({})).toBeUndefined()
    expect(guiOrigin({ webServer: {} })).toBeUndefined()
    expect(guiOrigin({ webServer: { port: 0 } })).toBeUndefined()
    expect(guiOrigin({ webServer: { port: '3080' } })).toBeUndefined()
  })
})

describe('the agent tool result', () => {
  let root = ''
  let previous = ''
  const disposers: Array<() => void> = []

  beforeEach(() => {
    previous = process.env.DSH_HOME ?? ''
    root = path.join(tmpdir(), `dsh-seework-tools-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    setLibraryDataRoot(root)
  })

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) dispose()
    setLibraryDataRoot(previous === '' ? undefined : previous)
    await fs.rm(root, { recursive: true, force: true })
  })

  /**
   * Register the real tools against a stub host holding one finished task.
   * @param task - the finished task `generate_image` answers with.
   * @param port - the stub web server's port, when the test wants absolute URLs.
   * @param settings - the settings document the tools resolve (defaults to the
   *   configured one); a test uses this to hand over a legacy document.
   * @param submitted - when given, receives every request the tools submit.
   * @returns the tools that got registered.
   */
  function harness(
    task: GenerationTask,
    port?: number,
    settings: Config = document(),
    submitted?: GenerateRequest[],
    realRuntime?: GenerationRuntime,
  ): RegisteredTool[] {
    const tools: RegisteredTool[] = []
    const ctx = {
      ...port === undefined ? {} : { webServer: { port } },
      tools: {
        register: (tool: RegisteredTool) => {
          tools.push(tool)
          return () => {}
        },
      },
      attachments: {
        saveImages: async (images: unknown[]) => images.map((_image, index) => ({
          attachmentId: `attachment-${index}`,
          mediaType: 'image/png',
          bytes: 10,
          width: 4,
          height: 4,
          name: `seework-${task.id}-${index + 1}.png`,
        })),
        readImage: async (ref: Record<string, unknown>) => ({
          ref: { ...ref, mediaType: 'image/png' },
          data: new Uint8Array([1, 2, 3, 4]),
        }),
      },
    } as unknown as Context
    const runtime = realRuntime ?? ({
      // The tools under test read a finished task, so the queue answers from the
      // fixture: a real submit would need a live gateway and must never happen
      // from a unit test.
      submit: (request: GenerateRequest) => { submitted?.push(request); return task },
      waitFor: async () => task,
    } as unknown as GenerationRuntime)
    disposers.push(registerAgentImageTools(ctx, runtime, () => effectiveConfig(settings)))
    return tools
  }

  it('answers with the library entry and the exact file on disk', async () => {
    const entry = await appendLibraryEntry({
      request: fixtureRequest(),
      images: [{ b64: pngBuffer(4, 4).toString('base64'), mime: 'image/png' }],
      source: 'agent',
    })
    const task: GenerationTask = {
      id: 'task-1',
      request: fixtureRequest(),
      status: 'completed',
      createdAt: Date.now(),
      source: 'agent',
      entryId: entry.id,
      result: { images: [{ b64: pngBuffer(4, 4).toString('base64'), mime: 'image/png' }] },
    }

    const tool = harness(task).find(candidate => candidate.name === 'generate_image')!
    const result = await tool.execute({ prompt: '一只柯基在冲浪' }, { signal: new AbortController().signal }) as {
      message: string
      library_entry_id?: string
      images: Array<Record<string, unknown>>
    }

    expect(result.library_entry_id).toBe(entry.id)
    expect(result.images).toHaveLength(1)
    const image = result.images[0]!
    // The three location fields have to match what the library really wrote…
    expect(image.file).toBe(entry.images[0]!.file)
    expect(image.url).toBe(entry.images[0]!.url)
    await expect(fs.stat(String(image.path))).resolves.toBeTruthy()
    // …and the standing explanation of those fields lives in the tool
    // description, which is what keeps it available with the announcement off.
    // Whole phrases, not the bare words: `file`, `url` and `path` each occur
    // elsewhere in the description, so a one-word check would stay green even if
    // this one sentence were deleted.
    expect(tool.description).toContain('quote those fields when the user asks where an image is')
    expect(tool.description).toContain('`file` (library file name)')
    expect(tool.description).toContain('`path` (absolute path on this machine)')
    expect(tool.description).toContain('`absolute_url`')
    // The capability boundary is stated in the same description (#659 / #661):
    // this tool sends only its five regular arguments, and a model-specific
    // gateway field cannot be sent through it — a resident fact, unlike the
    // announcement.
    // The per-call message only reports what happened.
    expect(result.message).toContain('素材库')
  })

  it('orders the skill load, and confirms extra images, in the tool-facing text (#665 / AC-1..AC-3)', async () => {
    // The description and the argument descriptions are resident with the tool
    // definition and are not governed by `announceToAgent`, so this is the copy
    // that survives with the announcement switched off.
    const task: GenerationTask = {
      id: 'task-wording',
      request: fixtureRequest(),
      status: 'completed',
      createdAt: Date.now(),
      source: 'agent',
    }
    const tool = harness(task).find(candidate => candidate.name === 'generate_image')!
    const properties = (tool.parameters as { properties?: Record<string, { description?: string }> }).properties ?? {}

    // AC-3: an order to load the skill, by name, before anything is generated.
    expect(tool.description).toContain(`load the skill \`${SKILL_NAME}\` first`)
    // AC-2: more than one image is *confirmed* with the user, not merely asked
    // about — the softer verb is the wording that was rejected.
    expect(properties.n?.description).toContain('confirm with the user before requesting more')
    expect(properties.n?.description).not.toContain('ask the user before requesting more')
    // AC-1: the "do not make the user upload it again" sentence is gone; handing
    // the reference object back unchanged is what the remaining text says.
    expect(properties.reference_images?.description).not.toContain('never ask the user to upload')
    expect(properties.reference_images?.description).toContain('exactly as you received it')
  })

  it('declares only the five regular arguments plus an optional `reference_images` (#661 / #664)', async () => {
    // #661 shrank the plugin's parameter surface to five; #664 merged the former
    // `edit_image` tool into this one as an optional argument. The schema below
    // is what the model sees; a `quality` the caller still passes is not a
    // declared argument, and it is not mapped into the request either — the
    // request has no such field at all. A legacy `defaultQuality` is not read
    // either (#653).
    const task: GenerationTask = {
      id: 'task-quality',
      request: fixtureRequest(),
      status: 'completed',
      createdAt: Date.now(),
      source: 'agent',
    }
    const submitted: GenerateRequest[] = []
    const legacy = { ...document(), defaultQuality: 'high' } as unknown as Config
    const tools = harness(task, undefined, legacy, submitted)
    const shared = ['aspect_ratio', 'model', 'n', 'output_format', 'prompt', 'resolution']
    // `defineTool` materializes the argument spec into JSON Schema, so the
    // declarations live under `properties`.
    const parametersOf = (name: string): Record<string, unknown> =>
      (tools.find(candidate => candidate.name === name)!.parameters as
        { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
    // Exactly one tool: the generator and the editor are no longer two rows.
    expect(tools.map(candidate => candidate.name)).toEqual(['generate_image'])
    expect(Object.keys(parametersOf('generate_image')).sort()).toEqual([...shared, 'reference_images'].sort())
    // …and `reference_images` is optional: omitting it is text-to-image, so it
    // must not land in `required` (which holds only `prompt`).
    const required = (tools[0]!.parameters as { required?: string[] } | undefined)?.required ?? []
    expect(required).toContain('prompt')
    expect(required).not.toContain('reference_images')

    const asked = tools.find(candidate => candidate.name === 'generate_image')!
    await asked.execute({ prompt: '猫', quality: 'low' }, { signal: new AbortController().signal })
    expect(submitted).toHaveLength(1)
    expect('quality' in submitted[0]!).toBe(false)
  })

  it('maps reference images onto `image_urls`, and their absence onto text-to-image (#664 / AC-3)', async () => {
    // The mode is the gateway's own reading of `image_urls` — the tool adds no
    // mode argument, and the same call is an edit purely because it carries
    // reference images.
    const task: GenerationTask = {
      id: 'task-mode',
      request: fixtureRequest(),
      status: 'completed',
      createdAt: Date.now(),
      source: 'agent',
    }
    const submitted: GenerateRequest[] = []
    const tool = harness(task, undefined, document(), submitted).find(candidate => candidate.name === 'generate_image')!

    await tool.execute({ prompt: '一只柯基在冲浪' }, { signal: new AbortController().signal })
    expect(submitted[0]!.mode).toBe('text')
    expect(submitted[0]!.imageUrls).toEqual([])

    await tool.execute({
      prompt: '把背景改成夜晚',
      reference_images: [{ attachment_id: 'attachment-0', media_type: 'image/png', bytes: 10, width: 4, height: 4 }],
    }, { signal: new AbortController().signal })
    expect(submitted[1]!.mode).toBe('edit')
    expect(submitted[1]!.imageUrls).toHaveLength(1)
    expect(submitted[1]!.imageUrls[0]!.startsWith('data:image/png;base64,')).toBe(true)
    expect(submitted[1]!.refNames).toEqual(['参考图 1'])
  })

  it('says an absolute URL is unavailable instead of letting the model invent one', async () => {
    // A host that reports no GUI port leaves `absolute_url` off every image. The
    // tool description cannot branch on that (it is a constant), so the per-call
    // message must say it — otherwise the model is told to write
    // `![…](absolute_url)` for a field that is not there.
    const entry = await appendLibraryEntry({
      request: fixtureRequest(),
      images: [{ b64: pngBuffer(4, 4).toString('base64'), mime: 'image/png' }],
      source: 'agent',
    })
    const task: GenerationTask = {
      id: 'task-no-origin',
      request: fixtureRequest(),
      status: 'completed',
      createdAt: Date.now(),
      source: 'agent',
      entryId: entry.id,
      result: { images: [{ b64: pngBuffer(4, 4).toString('base64'), mime: 'image/png' }] },
    }

    const tool = harness(task).find(candidate => candidate.name === 'generate_image')!
    const result = await tool.execute({ prompt: '一只柯基在冲浪' }, { signal: new AbortController().signal }) as {
      message: string
      images: Array<Record<string, unknown>>
    }

    expect(result.images[0]).not.toHaveProperty('absolute_url')
    expect(result.message).toContain('没有 absolute_url')
    expect(result.message).toContain('不要编一个地址')
  })

  it('hands the model an absolute URL, and the tool description asks it to show the picture in the reply', async () => {    // The card lives in the tool-call row, which the transcript folds away by
    // default; the assistant's own reply does not fold, so an instruction to
    // write a markdown image is the only way the user sees the picture without
    // expanding anything. That instruction is a tool-level convention, so it
    // lives in the tool description (#651) — and the per-call message says the
    // URL is there to be used.
    const entry = await appendLibraryEntry({
      request: fixtureRequest(),
      images: [{ b64: pngBuffer(4, 4).toString('base64'), mime: 'image/png' }],
      source: 'agent',
    })
    const task: GenerationTask = {
      id: 'task-2',
      request: fixtureRequest(),
      status: 'completed',
      createdAt: Date.now(),
      source: 'agent',
      entryId: entry.id,
      result: { images: [{ b64: pngBuffer(4, 4).toString('base64'), mime: 'image/png' }] },
    }

    const tool = harness(task, 3080).find(candidate => candidate.name === 'generate_image')!
    const result = await tool.execute({ prompt: '一只柯基在冲浪' }, { signal: new AbortController().signal }) as {
      message: string
      images: Array<Record<string, unknown>>
    }

    expect(result.images[0]!.absolute_url)
      .toBe(`http://127.0.0.1:3080/api/dsh-seework/library/image/${entry.images[0]!.file}`)
    // The standing instruction to put that URL in a markdown image is in the
    // tool description, which survives `announceToAgent=false`…
    expect(tool.description).toContain('markdown image')
    expect(tool.description).toContain('![short description](absolute_url)')
    // …while this message only points at the field for this call.
    expect(result.message).toContain('absolute_url')
    expect(result.message).not.toContain('Markdown')
  })

  it('tells the model which arguments never reached the gateway', async () => {
    // Only the five regular parameters can be dropped now (#659 / #661): the
    // passthrough channel is gone, so the report is about a value this model
    // does not accept rather than about an unknown field.
    const task: GenerationTask = {
      id: 'task-dropped',
      request: fixtureRequest(),
      status: 'completed',
      createdAt: Date.now(),
      source: 'agent',
      droppedParameters: [
        { field: 'resolution', value: '8K', allowed: ['2K', '4K'], reason: 'invalid_value' },
        { field: 'output_format', value: 'gif', allowed: ['png', 'jpeg'], reason: 'invalid_value' },
      ],
    }
    const tool = harness(task).find(candidate => candidate.name === 'generate_image')!
    const result = await tool.execute({ prompt: '猫' }, { signal: new AbortController().signal }) as { message: string }

    // A dropped argument is invisible otherwise: a picture comes back and
    // nothing says the request differed from what was asked for.
    expect(result.message).toContain('有参数没有发给网关')
    expect(result.message).toContain('resolution（invalid_value）')
    expect(result.message).toContain('output_format（invalid_value）')
  })

  it('hands the card the library file name, so 「加到画布」 needs no prose parsing', async () => {
    const entry = await appendLibraryEntry({
      request: fixtureRequest(),
      images: [{ b64: pngBuffer(4, 4).toString('base64'), mime: 'image/png' }],
      source: 'agent',
    })
    const task: GenerationTask = {
      id: 'task-3',
      request: fixtureRequest(),
      status: 'completed',
      createdAt: Date.now(),
      source: 'agent',
      entryId: entry.id,
      result: { images: [{ b64: pngBuffer(4, 4).toString('base64'), mime: 'image/png' }] },
    }

    const tool = harness(task).find(candidate => candidate.name === 'generate_image')!
    const result = await tool.execute({ prompt: '一只柯基在冲浪' }, { signal: new AbortController().signal })
    const meta = tool.output!.presentationMeta!({}, result) as { images: Array<Record<string, unknown>> }

    expect(meta.images[0]!.file).toBe(entry.images[0]!.file)
    // The attachment reference stays: a later edit call gets the whole object back.
    expect(meta.images[0]!.attachment_id).toBe('attachment-0')
  })

  it('hands the normalizer what the caller said, and no generation default of its own (#668)', async () => {
    const task: GenerationTask = {
      id: 'task-defaults',
      request: fixtureRequest(),
      status: 'completed',
      createdAt: Date.now(),
      source: 'agent',
    }
    const submitted: GenerateRequest[] = []
    // The configured ratio is deliberately not the model's (the fixture declares
    // 16:9 only): pre-filling it here is exactly the bug — the plugin's own
    // default then arrives as "a value the caller sent that the model refuses".
    const configured: Config = { ...document(), defaultAspectRatio: '3:4' }
    const tool = harness(task, undefined, configured, submitted).find(candidate => candidate.name === 'generate_image')!

    await tool.execute({ prompt: '一只柯基在冲浪' }, { signal: new AbortController().signal })
    await tool.execute({ prompt: '一只柯基在冲浪', aspect_ratio: '16:9' }, { signal: new AbortController().signal })

    // An argument the model did not name stays empty, so the one place that fills
    // (and silently omits) a default is the normalizer…
    expect(submitted[0]!.aspectRatio).toBe('')
    // …while a value the caller did name still travels untouched.
    expect(submitted[1]!.aspectRatio).toBe('16:9')
  })

  it('drives the tool all the way to the outgoing body (#669, closing the #668 review gap)', async () => {
    // Every other tool test stubs `submit`, so nothing used to drive the tool
    // into the real normalizer and on to the wire. This one does: a real
    // `GenerationRuntime`, a real library write, and a stub gateway that records
    // what it was asked for.
    const bodies: Array<Record<string, unknown>> = []
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk as Buffer))
      req.on('end', () => {
        bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ created: 1, data: [{ b64_json: pngBuffer(8, 8).toString('base64') }], cost: 0.1 }))
      })
    })
    const base = await new Promise<string>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve(`http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`)
      })
    })

    try {
      // The configured default is deliberately one the model does not declare:
      // pre-filling it (the #668 bug) makes `accepted()` drop the value, and the
      // model is then told its own configured default was "a value the caller
      // sent that this model refuses".
      const settings: Config = {
        ...document(),
        apiUrl: `${base}/v1`,
        defaultAspectRatio: '3:4',
        models: [{ ...document().models![0]!, aspectRatios: ['16:9', '1:1'] }],
      }
      const finished: GenerationTask = {
        id: 'task-wire',
        request: fixtureRequest(),
        status: 'completed',
        createdAt: Date.now(),
        source: 'agent',
      }
      const tool = harness(finished, undefined, settings, undefined, new GenerationRuntime(() => effectiveConfig(settings)))
        .find(candidate => candidate.name === 'generate_image')!

      const first = await tool.execute({ prompt: '一只柯基在冲浪' }, { signal: new AbortController().signal }) as { message: string }
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).not.toHaveProperty('aspect_ratio')
      // The wire body alone cannot tell the two apart — `accepted()` omits the
      // refused value either way. The report can: a pre-filled default shows up
      // as a dropped parameter, which is exactly the failure #668 removed.
      expect(first.message).not.toContain('有参数没有发给网关')

      // A ratio the caller names still travels, in the model's own spelling.
      const second = await tool.execute({ prompt: '再来一张', aspect_ratio: '16:9' }, { signal: new AbortController().signal }) as { message: string }
      expect(bodies[1]!.aspect_ratio).toBe('16:9')
      expect(second.message).not.toContain('有参数没有发给网关')
    } finally {
      await new Promise<void>(resolve => { server.close(() => resolve()) })
    }
  })
})
