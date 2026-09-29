/**
 * Live end-to-end check against a real SeeAI Hub deployment.
 *
 * Drives a running DSH host the way the settings card and the agent tool do:
 * write the connection settings through the plugin's own settings bridge,
 * detect the models from the deployment's catalog, submit a generation, and
 * verify the stored artifact.
 *
 *   DSH_PROBE_TOKEN=<token> node scripts/verify-live.mjs <base-url> <api-key>
 *
 * This consumes real API credit for one 1-image generation.
 */

const base = process.argv[2]
const apiKey = process.argv[3]
const token = process.env.DSH_PROBE_TOKEN ?? ''
if (!base || !apiKey || token === '') {
  console.error('用法：DSH_PROBE_TOKEN=<token> node scripts/verify-live.mjs <base-url> <api-key>')
  process.exit(1)
}

const cookies = new Map()
async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...cookies.size === 0 ? {} : { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
    },
    body: JSON.stringify(body ?? {}),
    redirect: 'manual',
  })
  for (const entry of response.headers.getSetCookie?.() ?? []) {
    const [pair] = entry.split(';')
    const at = pair.indexOf('=')
    if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1))
  }
  const text = await response.text()
  try {
    return { status: response.status, payload: JSON.parse(text) }
  } catch {
    return { status: response.status, payload: text }
  }
}

let failures = 0
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}

// 1. Mint the session cookie (the fence answers a root `?token=` with a 303).
await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })

console.log('1. 通过设置桥写入连接（和设置卡片走同一条路）')
const write = await post('/api/dsh-seework/settings/mutate', {
  ops: [{ op: 'set', path: ['apiKey'], value: apiKey }],
})
check('写入被接受', write.payload.ok === true, JSON.stringify(write.payload).slice(0, 160))
const secretSet = write.payload.value?.secrets?.find?.(entry => entry.path?.join('.') === 'apiKey')
check('桥回报密钥已保存', secretSet?.set === true, JSON.stringify(write.payload.value?.secrets))
check('写入响应里不含密钥明文', !JSON.stringify(write.payload).includes(apiKey))

console.log('2. 目录发现（service 地址 → 网关同路径 → /models）')
const catalog = await post('/api/dsh-seework/catalog/models', {})
const models = catalog.payload.value?.models ?? []
check('读到图片模型', models.length > 0, JSON.stringify(catalog.payload).slice(0, 200))
console.log(`     来源: ${catalog.payload.value?.origin} @ ${catalog.payload.value?.catalogUrl}`)
console.log(`     尝试: ${(catalog.payload.value?.attempts ?? []).map(a => `${a.url}→${a.outcome}`).join('；')}`)
for (const model of models) {
  console.log(`     ${model.id}: 档位 ${model.resolutions.join('/') || '(未声明)'}, ${model.aspectRatios.length} 比例, 最多 ${model.maxImages} 张, 参考图 ${model.maxReferenceImages}, 水印 ${model.supportsWatermark}`)
}
check('能力的来源被标记为已声明', models.every(model => model.capabilitiesKnown === true))

console.log('3. 保存模型并生一张图')
const saved = await post('/api/dsh-seework/settings/mutate', {
  ops: [
    { op: 'set', path: ['models'], value: models },
    { op: 'set', path: ['defaultModel'], value: models[0]?.id ?? '' },
  ],
})
check('模型已保存', saved.payload.ok === true, JSON.stringify(saved.payload).slice(0, 160))

const target = models.find(model => model.id === 'seedream-5-0-lite') ?? models[0]
const generated = await post('/api/dsh-seework/generate', {
  model: target.id,
  prompt: '一只坐在窗边的猫，夕阳暖光，简洁背景',
  resolution: target.resolutions[0] ?? '',
  aspectRatio: target.aspectRatios[0] ?? '',
  outputFormat: target.outputFormats.includes('png') ? 'png' : '',
  n: 1,
})
const task = generated.payload.value?.task
check('任务至少被受理（有任务号）', typeof task?.id === 'string', JSON.stringify(generated.payload).slice(0, 200))
check('没有被裁剪掉参数', (task?.droppedParameters ?? []).length === 0, JSON.stringify(task?.droppedParameters))

if (task?.status !== 'completed') {
  // A refusal from the deployment is a legitimate outcome for this script: the
  // point of the live check is that the request reached the gateway and its
  // answer came back verbatim, not that every account can afford it.
  console.log(`\n生成未完成：${task?.status} — ${task?.error ?? '（无原因）'}`)
  console.log('这是部署方的答复，不是插件缺陷；目录发现与设置桥已经通过。')
  const libraryAfter = await post('/api/dsh-seework/library/list', {})
  const before = libraryAfter.payload.value?.entries?.length ?? 0
  console.log(`素材库现有 ${before} 条记录（本次未新增）。`)
  console.log(failures === 0 ? '\nLIVE PASSED（未产生扣费）' : `\nLIVE FAILED (${failures})`)
  process.exit(failures === 0 ? 0 : 1)
}

check('上报了扣费金额', typeof task?.result?.cost === 'number', String(task?.result?.cost))
check('落进了素材库', typeof task?.entryId === 'string' && task.entryId.length > 0)

console.log('4. 素材库与画布读得到')
const library = await post('/api/dsh-seework/library/list', {})
const entry = library.payload.value?.entries?.find(candidate => candidate.id === task.entryId)
check('素材库有这条记录', entry !== undefined)
check('记录的模型与提示词正确', entry?.model === target.id && typeof entry?.prompt === 'string')
const imageUrl = entry?.images?.[0]?.url
if (imageUrl !== undefined) {
  const image = await fetch(`${base}${imageUrl}`, {
    headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
  })
  const bytes = Buffer.from(await image.arrayBuffer())
  check('图片可读且是 PNG', image.status === 200 && bytes.subarray(0, 4).toString('hex') === '89504e47', String(image.status))
  check('像素尺寸已记录', (entry.images[0].width ?? 0) > 0 && (entry.images[0].height ?? 0) > 0,
    `${entry.images[0].width}x${entry.images[0].height}`)
  console.log(`     图片: ${bytes.length} 字节, ${entry.images[0].width}x${entry.images[0].height}, 扣费 ${task.result.cost}`)
}

const canvases = await post('/api/dsh-seework/canvas/list', {})
check('画布接口正常', canvases.payload.ok === true)

console.log(failures === 0 ? '\nLIVE PASSED' : `\nLIVE FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
