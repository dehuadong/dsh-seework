/**
 * Wire contract shared by the host and browser halves of dsh-seework: the
 * settings namespace, the route paths, the SeeAI Hub gateway request/response
 * shapes, and the local material-library record shape.
 *
 * Pure types + constants — safe for the client bundle to inline.
 */

/** Settings namespace this plugin owns (host settings seam + bridge). */
export const SEEWORK_SETTINGS_NAMESPACE = 'dsh-seework'

/**
 * Aspect ratios the gateway serves uniformly (#658/D-16).
 *
 * One list for every model, in the order a user should see them — the catalog's
 * own arrays are lexicographically sorted sets, so they are not a usable order
 * for a picker.
 */
export const UNIFIED_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'] as const

/** Factory default for the ratio setting (#658/D-13/D-16). */
export const DEFAULT_ASPECT_RATIO = '3:4'

/** Factory default for the output-format setting (#658/D-13). */
export const DEFAULT_OUTPUT_FORMAT = 'png'

/** Formats to offer when no saved model declares any. */
export const OUTPUT_FORMAT_FALLBACKS = ['png', 'jpeg', 'webp'] as const

/**
 * Whether a list contains a value, ignoring case (#658).
 *
 * The one membership rule both halves need: the request layer asks whether the
 * saved model can take the configured output format, and the settings card asks
 * whether the stored value is already among the offered options.
 */
export function includesIgnoringCase(list: readonly string[], wanted: string): boolean {
  return list.some(value => value.toLowerCase() === wanted.toLowerCase())
}

/**
 * Default SeeAI Hub Gateway base URL — the OpenAI-compatible root, i.e. the
 * part that `/images/generations` is appended to. Local development gateway is
 * the default so a fresh install talks to the working stack; point it at a
 * deployment domain in the settings card.
 */
export const DEFAULT_API_URL = 'http://127.0.0.1:8080/v1'

/**
 * Default SeeAI Hub **service** base URL, used only for the model catalog.
 *
 * `docs/api/README.md` is explicit that the two surfaces are separate and that
 * neither answers the other's paths: generation is the Gateway (`/v1/*`), while
 * `GET /api/v1/catalog/models` is the service. Deriving one from the other
 * works only behind a reverse proxy that mounts both under one host, which is
 * why the catalog address is its own setting.
 */
export const DEFAULT_SERVICE_URL = 'http://127.0.0.1:8081'

/**
 * Most images this plugin asks for in one request.
 *
 * **This is the plugin's own ceiling, not a contract value.**
 * `docs/api/images.md` documents `n` as a positive integer whose ceiling is the
 * *model's* own maximum — published since catalog v2 as the `n` descriptor's
 * `max` — so the per-model limit comes from the catalog, while this constant is
 * the plugin's own guard against a runaway `n` turning into a runaway bill.
 *
 * It is stated once because several places have to agree and each used to spell
 * `10` itself. Every consumer now goes through the two compositions below rather
 * than clamping on its own: the normalizer (`settings.ts`), the outgoing body
 * (`engine.ts`), the tool argument (`agent-tools.ts`) and the promise the
 * announcement makes (`model-summary.ts`), which must never exceed what is
 * actually sent.
 *
 * The two compositions of it live here too ({@link imageCountCeiling} and
 * {@link effectiveImageCount}), because spelling `min(10, max(1, …))` at each
 * call site is how the task record and the outgoing body drifted apart (#668).
 */
export const MAX_IMAGES_PER_REQUEST = 10

/**
 * The most images one request may ask for, given a model's declared ceiling.
 *
 * A **declared** ceiling below one is read as one image — {@link ModelConfig.maxImages}
 * is "1 when unknown" — while a declared ceiling above the wire ceiling is cut
 * back to it. Omitting `modelCap` means "no model is known at this call site"
 * (the send-time guard), so only the wire ceiling applies.
 *
 * @param modelCap - the model's declared ceiling, when the catalog declared one.
 * @returns the ceiling this model's requests are held to.
 */
export function imageCountCeiling(modelCap?: number): number {
  const declared = typeof modelCap === 'number' && Number.isFinite(modelCap)
    ? Math.trunc(modelCap)
    : MAX_IMAGES_PER_REQUEST
  return Math.min(MAX_IMAGES_PER_REQUEST, Math.max(1, declared))
}

/**
 * The image count a request actually carries: what was asked for, clamped into
 * the model's own ceiling.
 *
 * Every caller that records or sends a count uses this, so the task, the library
 * entry and the outgoing body cannot disagree.
 *
 * @param requested - the caller's `n`.
 * @param modelCap - the model's declared ceiling, when the catalog declared one.
 * @returns the count that goes on the wire.
 */
export function effectiveImageCount(requested: number, modelCap?: number): number {
  const asked = Number.isFinite(requested) ? Math.trunc(requested) : 1
  return Math.min(imageCountCeiling(modelCap), Math.max(1, asked))
}

/** Same-origin, loopback-only settings bridge for this plugin's namespace. */
export const SETTINGS_API = {
  describe: '/api/dsh-seework/settings/describe',
  mutate: '/api/dsh-seework/settings/mutate',
  /**
   * Folder choosing for the material directory, over the host's
   * `ctx.directoryPicker` seam: `directoryPicker` reports how the host can choose
   * (opening nothing), `pickDirectory` opens one chooser and waits.
   */
  directoryPicker: '/api/dsh-seework/settings/directory-picker',
  pickDirectory: '/api/dsh-seework/settings/pick-directory',
} as const

/**
 * How the host can choose a directory, mirroring the DSH seam's capabilities.
 *
 * `native` opens one OS chooser on the host's screen; `browse` only serves listing
 * primitives for the shell's own in-app browser (a remote client cannot reach the
 * host's display); `none` means no picker is composed at all.
 */
export type DirectoryPickerKind = 'native' | 'browse' | 'none'

/** What the host reports about choosing a directory. */
export interface DirectoryPickerStatus {
  kind: DirectoryPickerKind
  /** Operator-facing note for anything other than `native`. */
  message?: string
}

/** What one pick attempt produced, as the route reports it. */
export interface PickDirectoryResult {
  /** The chosen absolute directory; absent when the operator cancelled. */
  path?: string
  cancelled?: boolean
}

/** SeeAI Hub model-catalog discovery (host-mediated, keeps no secrets). */
export const CATALOG_API = {
  models: '/api/dsh-seework/catalog/models',
  /**
   * Run one automatic detection round and report what changed (#652).
   *
   * The card calls this when it opens; the host throttles it against the
   * low-frequency background timer, so opening the card twice does not re-request.
   */
  refresh: '/api/dsh-seework/catalog/refresh',
} as const

/** The image-generation proxy route: the browser submits, the host calls upstream. */
export const GENERATE_API = '/api/dsh-seework/generate' as const

/** Host-resident generation queue (browser side of the shared runtime). */
export const TASK_API = {
  list: '/api/dsh-seework/tasks/list',
  cancel: '/api/dsh-seework/tasks/cancel',
} as const

/** Update discovery for a published install, and the install it triggers. */
export const UPDATE_API = {
  /** Read the running version, the registry's newest, and how this copy got here. */
  status: '/api/dsh-seework/update/status',
  /**
   * Start installing the newest published version.
   *
   * Answers as soon as the install has been *started*, not when it finishes: the
   * install re-composes the profile and tears this plugin's routes down, so a
   * handler that waited for it could not deliver its own response.
   */
  apply: '/api/dsh-seework/update/apply',
} as const

/** How this copy of the plugin reached the profile. */
export type InstallKind = 'registry' | 'local' | 'unknown'

/** What the settings card renders in its version row. */
export interface UpdateStatus {
  /** The version running right now. */
  current: string
  /** The newest version the registry offers, when the check could read one. */
  latest?: string
  /** How this copy was installed; only `registry` is offered an update button. */
  kind: InstallKind
  /** Whether `latest` is strictly newer than `current`. */
  updateAvailable: boolean
  /** Why no answer was available, when there was none. */
  error?: string
}

/** What the update route reports once it has started an install. */
export interface UpdateStart {
  /** Whether an install was actually started. */
  started: boolean
  /** The version being installed. */
  to?: string
  /** Why nothing was started. */
  error?: string
}

/**
 * The local material library — every image this plugin generates is written
 * under the data root and indexed, which is what the sidebar library and the
 * canvas read back.
 */
export const LIBRARY_API = {
  list: '/api/dsh-seework/library/list',
  /** Cheap identity poll: the newest entry id and the total. */
  head: '/api/dsh-seework/library/head',
  remove: '/api/dsh-seework/library/remove',
  clear: '/api/dsh-seework/library/clear',
  /** Prefix route: `/api/dsh-seework/library/image/<file>`. */
  image: '/api/dsh-seework/library/image',
} as const

/**
 * The library's identity without its contents: what a browser polls to notice a
 * generation that finished in the host (agent tools write entries the page is
 * never told about).
 */
export interface LibraryHead {
  total: number
  /** Newest entry id, absent while the library is empty. */
  newestId?: string
  /** Newest entry's creation time, absent while the library is empty. */
  newestAt?: number
}

/**
 * One durable image an Agent tool result points at.
 *
 * A tool result is not model-visible content, so the shell's own image loader
 * refuses to resolve it (`session.readAttachment` proves reachability from the
 * session log). The conversation card therefore asks this route with the
 * complete reference the host persisted in the tool result's presentation
 * metadata, and the host re-validates every field before reading the store.
 *
 * Prefix route: `/api/dsh-seework/attachment/image?attachment_id=…&media_type=…`.
 */
export const ATTACHMENT_API = {
  image: '/api/dsh-seework/attachment/image',
} as const

/** Image media types the attachment store accepts, as a runtime list. */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** One of {@link IMAGE_MEDIA_TYPES}. */
export type ImageMedia = (typeof IMAGE_MEDIA_TYPES)[number]

/**
 * Whether a wire value is an image media type this plugin may read and serve.
 * @param value - the candidate media type.
 * @returns true when it is one of the accepted image types.
 */
export function isImageMedia(value: string): value is ImageMedia {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
}

/** Data root the library lives under (overridable in settings). */
export const DEFAULT_DATA_DIR_NAME = 'dsh-seework'

/**
 * Canvas documents live under `<data root>/canvas/`. The board is spatial, not
 * a node graph: every card is just a placed rectangle, and the only structure
 * is what the user sees (see `docs/architecture.md`).
 */
export const CANVAS_API = {
  list: '/api/dsh-seework/canvas/list',
  create: '/api/dsh-seework/canvas/create',
  read: '/api/dsh-seework/canvas/read',
  save: '/api/dsh-seework/canvas/save',
  remove: '/api/dsh-seework/canvas/remove',
  /**
   * Canvas-owned pictures (a burned annotation, a crop): the board writes one
   * with POST here, and reads it back from `<asset>/<file>`.
   *
   * They deliberately never enter the material library — the library records what
   * was generated, and a marked-up copy is the board's own material.
   */
  asset: '/api/dsh-seework/canvas/asset',
  /**
   * Housekeeping for those pictures: `assets` enumerates them (and says how much
   * of them no card shows any more), `pruneAssets` deletes exactly those, and
   * `removeAsset` deletes one — refused while a card still shows it.
   *
   * `assets` reads naturally as a *collection* path, but it is registered
   * separately from the `asset` prefix route, which matches `asset/<file>` only.
   */
  assets: '/api/dsh-seework/canvas/assets',
  pruneAssets: '/api/dsh-seework/canvas/assets/prune',
  removeAsset: '/api/dsh-seework/canvas/asset/remove',
} as const

/** One canvas-owned picture on disk. */
export interface CanvasAssetSummary {
  file: string
  bytes: number
  /** Whether a card on some board still shows it. */
  referenced: boolean
}

/**
 * The one operation both image stores share: showing a picture's file in the
 * host's file manager.
 *
 * It sits under neither store's prefix because the request names the store it
 * means, and the same action has to work for a generated picture and for a
 * canvas-owned one (an upload, an annotation, a crop).
 */
export const IMAGE_API = {
  reveal: '/api/dsh-seework/image/reveal',
} as const

/** What the reveal route takes: which picture, and which store holds it. */
export interface ImageRevealRequest {
  /** The picture's file name, in the shape its own store writes. */
  file: string
  /** Which store the name belongs to. */
  source: CanvasCardSource
}

/** What the canvas housekeeping route reports. */
export interface CanvasAssetListing {
  files: CanvasAssetSummary[]
  /** Pictures no card references — the ones 「清理无用图片」 deletes. */
  orphans: number
  orphanBytes: number
}

/** One canvas-owned image, as the write route answers. */
export interface CanvasImageRef {
  file: string
  url: string
  mime: string
  width?: number
  height?: number
}

/** Where an image card's file lives: the material library, or the board's own assets. */
export type CanvasCardSource = 'library' | 'canvas'

/**
 * Where an image card's picture came from.
 *
 * `chat` and `panel` mirror the material library's own `source` (the library
 * records whether a generation was asked for in a conversation or from the
 * panel); `annotation` and `crop` are composites this board made itself, and
 * `upload` is a file the user brought from their own machine. Cards written
 * before this field existed have none, and the viewer infers one.
 */
export type CanvasCardOrigin = 'chat' | 'panel' | 'annotation' | 'crop' | 'upload'

/** Every origin a card may carry, so validators cannot drift from the type. */
export const CANVAS_CARD_ORIGINS: readonly CanvasCardOrigin[] = ['chat', 'panel', 'annotation', 'crop', 'upload']

/**
 * Whether a stored value is an origin this build knows.
 * @param value - the value read off a stored document.
 * @returns true when it is one of them.
 */
export function isCanvasCardOrigin(value: unknown): value is CanvasCardOrigin {
  return typeof value === 'string' && (CANVAS_CARD_ORIGINS as readonly string[]).includes(value)
}

/**
 * Human label for one origin, for the card badge.
 * @param origin - the card's origin, when it has one.
 * @returns the badge text, or undefined when there is nothing honest to show.
 */
export function canvasOriginLabel(origin: CanvasCardOrigin | undefined): string | undefined {
  if (origin === 'chat') return '对话生成'
  if (origin === 'panel') return '面板生成'
  if (origin === 'annotation') return '标注合成'
  if (origin === 'crop') return '裁剪合成'
  if (origin === 'upload') return '上传素材'
  return undefined
}

/**
 * The URL that serves one image card's picture.
 * @param file - the file name (library entry image, or canvas asset).
 * @param source - which store it belongs to; absent means the material library.
 * @returns the same-origin route URL.
 */
export function canvasImageUrl(file: string, source: CanvasCardSource = 'library'): string {
  return source === 'canvas'
    ? `${CANVAS_API.asset}/${file}`
    : `${LIBRARY_API.image}/${file}`
}

/** Canvas viewport: translation in board units plus the zoom factor. */
export interface CanvasViewport {
  x: number
  y: number
  /** Zoom factor, clamped to [CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX]. */
  k: number
}

/** The kinds of card a board can hold. */
export type CanvasCardKind = 'image' | 'text'

/** One card placed on a board. */
export interface CanvasCard {
  id: string
  kind: CanvasCardKind
  /** Board coordinates of the card's top-left corner. */
  x: number
  y: number
  /** Board size in pixels. */
  width: number
  height: number
  /** Paint order; higher is on top. */
  z: number
  /** Image cards: the material-library file name (`library/image/<file>`). */
  file?: string
  /**
   * Image cards: which store `file` belongs to. Absent means the material library,
   * so every board written before canvas assets existed keeps working.
   */
  source?: CanvasCardSource
  /**
   * Image cards: where the picture came from (conversation generation, panel
   * generation, or this board's own annotation/crop). Shown as the card badge, and
   * what makes a board's own pictures distinguishable from library material.
   */
  origin?: CanvasCardOrigin
  /** Image cards: a snapshot of what it came from, for the card caption. */
  model?: string
  prompt?: string
  /** Text cards: the note body. */
  text?: string
  /** Text cards: font size in board pixels. */
  fontSize?: number
}

/** One board document. */
export interface CanvasDocument {
  id: string
  title: string
  /** Increments on every accepted save; the save route fences on it. */
  revision: number
  viewport: CanvasViewport
  cards: CanvasCard[]
  createdAt: number
  updatedAt: number
}

/** One board in the canvas list. */
export interface CanvasSummary {
  id: string
  title: string
  revision: number
  cardCount: number
  createdAt: number
  updatedAt: number
}

/** Canvas list payload. */
export interface CanvasListResult {
  canvases: CanvasSummary[]
  dataRoot: string
}

/** Generation modes: text-to-image, or image-to-image with reference images. */
export type GenerateMode = 'text' | 'edit'

/** One model in the local catalog (what the user selected from the gateway). */
export interface ModelConfig {
  /** Model name sent as `model` to the gateway. */
  id: string
  /** Optional display name; empty means "same as id". */
  label?: string
  /**
   * Accepted `resolution` tiers, e.g. ['1K', '2K']. Empty means the model has
   * no tier vocabulary and requests omit `resolution` entirely.
   *
   * The array is **ordered, lowest first**: since catalog v2 an enum
   * descriptor's `values` order *is* the family's declared order, so this list
   * doubles as the ranking the announcement and the agent read.
   */
  resolutions: string[]
  /**
   * The tier a request uses when the caller names none: the model's own
   * declared default (`supported_parameters.resolution.default`).
   *
   * Deliberately **not** the same thing as `resolutions[0]`: a model may
   * declare a default that is not its lowest tier. Empty means the contract
   * declared none — a breach of the "`resolution.default` is always published"
   * invariant — and the plugin then omits `resolution` rather than guessing a
   * tier (it reports the missing default in the announcement instead).
   */
  resolutionDefault?: string
  /** Accepted `aspect_ratio` values, e.g. ['16:9', '1:1'] (declared order). */
  aspectRatios: string[]
  /** Accepted `output_format` values. */
  outputFormats: string[]
  /** Maximum images per request (1 when unknown). */
  maxImages: number
  /** Maximum reference images per request (0 = text-to-image only). */
  maxReferenceImages: number
  /**
   * Whether these capabilities came from the SeeAI Hub catalog at all.
   *
   * This decides what an *empty* list means. `true` = "the catalog described
   * this model and listed nothing for that field, so the model does not take it
   * — omit it". `false` = "we know nothing — the entry carried no
   * `supported_parameters` at all (a bare OpenAI-compatible `/models` list, or
   * a catalog snapshot published before v2) — pass the user's value through".
   * Getting this backwards either breaks bare gateways or turns defaults into
   * 400s.
   */
  capabilitiesKnown?: boolean
  /**
   * When this model's capabilities were last read from the catalog (epoch ms).
   *
   * Written on a **successful** discovery and kept in the saved settings, so a
   * surface that dates its data can say how fresh it is: a failed refresh leaves
   * the previous models (and this stamp) untouched, so an old value is the honest
   * signal that the snapshot may be stale. **Absent means unknown** — a settings
   * document written before this field existed — and there is deliberately no
   * sentinel value for that state.
   */
  discoveredAt?: number
}

/**
 * A generation request from the browser or an agent tool. The host resolves
 * the credentials, maps this onto the SeeAI Hub field vocabulary, and persists
 * the result into the library.
 */
export interface GenerateRequest {
  mode: GenerateMode
  /** Model id from the configured catalog. */
  model: string
  /** The prompt; SeeAI Hub validates length per model. */
  prompt: string
  /** Resolution tier (e.g. '2K'), 'auto', or '' to omit. */
  resolution: string
  /** Aspect ratio (e.g. '16:9'), 'auto', or '' to omit. */
  aspectRatio: string
  /** Output format: 'png' | 'jpeg' | 'webp', or '' to omit (gateway default). */
  outputFormat: string
  /**
   * Number of images; a positive integer. `docs/api/images.md` leaves the
   * ceiling to the model's catalog entry, and this plugin caps it at
   * {@link MAX_IMAGES_PER_REQUEST} on the way out.
   */
  n: number
  /** Reference images as data URLs (edit mode only). */
  imageUrls: string[]
  /** Original reference-image names, kept for the library record. */
  refNames?: string[]
}

/** Why one parameter never reached the gateway. */
export type DropReason =
  /** The catalog did not list the field for this model (or listed no fields at all). */
  | 'unsupported_field'
  /** The field is accepted by this model, but not with that value. */
  | 'invalid_value'

/** One parameter left out of a request, with the reason it was left out. */
export interface DroppedParameter {
  field: string
  value: string
  /** The values the model does accept (empty = "the model declares none"). */
  allowed: string[]
  /** Machine-readable reason, so callers need not parse the message. */
  reason: DropReason
}

/** One generated image, normalized host-side to base64. */
export interface GeneratedImage {
  /** Raw base64 payload (no data: prefix). */
  b64: string
  /** MIME type of the payload, e.g. image/png. */
  mime: string
  /** Upstream revised prompt, when the provider returns one. */
  revisedPrompt?: string
}

/** Successful generation outcome. */
export interface GenerateResult {
  images: GeneratedImage[]
  /** Amount charged by the gateway for this request (CNY), when reported. */
  cost?: number
}

/** One image reference inside a library entry (a served URL, never base64). */
export interface LibraryImageRef {
  /** Same-origin URL: `${LIBRARY_API.image}/<file>`. */
  url: string
  /** Stored file name (what `remove` and the canvas address). */
  file: string
  mime: string
  /** Intrinsic size, when known. */
  width?: number
  height?: number
  revisedPrompt?: string
}

/** One library entry: a single generation and everything it produced. */
export interface LibraryEntry {
  id: string
  createdAt: number
  mode: GenerateMode
  model: string
  prompt: string
  resolution: string
  aspectRatio: string
  /**
   * Quality is **no longer a plugin parameter** (#661): every generation writes
   * an empty string here. The field stays because entries written before that
   * change carry a real value and the library must still read them back.
   */
  quality: string
  outputFormat: string
  n: number
  images: LibraryImageRef[]
  /** Amount charged by the gateway (CNY), when reported. */
  cost?: number
  /** Reference-image names (edit mode), for display only. */
  refNames?: string[]
  /** Where the generation came from. */
  source: 'agent' | 'panel' | 'canvas'
  /** Session the agent call belonged to, when applicable. */
  sessionId?: string
  /** Free-form user labels (phase 2 filtering). */
  tags?: string[]
}

/** Library list payload. */
export interface LibraryListResult {
  entries: LibraryEntry[]
  total: number
  /** On-disk image count across all entries (storage usage, sidebar footer). */
  imageCount: number
  /** Absolute data root the library is written to. */
  dataRoot: string
  /**
   * What the last move to another data root did, while it is worth reporting.
   *
   * Changing the material directory moves the library, and that takes as long as
   * the files are big — so the settings card watches this to say what happened
   * rather than claiming the change already took effect. Absent when nothing moved.
   */
  dataRootMove?: LibraryDataRootMove
}

/** One data-root move, as the browser sees it. */
export interface LibraryDataRootMove {
  /** Increases per move: a reader can tell a new report from one it already saw. */
  id: number
  /** The directory the library is being moved into. */
  to: string
  /** How many pictures came along. */
  moved: number
  /** Pictures left behind because the new directory already had that name. */
  kept: number
  /** Whether the move is still running. */
  pending: boolean
  /** Why the move could not finish; absent when it did. */
  error?: string
}

/** Generation task states. */
export type GenerationTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

/** One host-resident generation task (shared by the panel and agent tools). */
export interface GenerationTask {
  id: string
  request: GenerateRequest
  status: GenerationTaskStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  result?: GenerateResult
  /** The library entry written for this task, once it completed. */
  entryId?: string
  error?: string
  /** What asked for this task. */
  source: 'agent' | 'panel' | 'canvas'
  /** Owning agent session, when an agent asked for it. */
  sessionId?: string
  /**
   * Parameters left out because the selected model does not declare them.
   * Reported rather than hidden: a silently downgraded request should be
   * visible to whoever asked for it.
   */
  droppedParameters?: DroppedParameter[]
}

/**
 * One source the catalog discovery tried, with what it answered.
 */
export interface CatalogAttempt {
  url: string
  /** `ok` / `http <status>` / `unreachable` / `unusable`. */
  outcome: string
  /** Image models this source yielded (0 when it did not answer usefully). */
  models: number
}

/**
 * Catalog discovery result shown by the settings card.
 *
 * `models` is the **same shape the settings document stores** (#669): discovery
 * used to answer with a second, nearly identical type (`CatalogModel`) that every
 * consumer projected by hand, which is how one field addition became four
 * coordinated edits.
 */
export interface CatalogResult {
  models: ModelConfig[]
  /** Which kind of source answered: the SeeAI Hub catalog, or `/models`. */
  origin: 'catalog' | 'models'
  /** The URL that produced the returned list. */
  catalogUrl: string
  /** Total models the upstream reported before image filtering. */
  scanned: number
  /** Every source that was tried, in order — the "why is it empty" evidence. */
  attempts: CatalogAttempt[]
}

/**
 * What one automatic detection round changed (#652).
 *
 * The three id lists are the whole of the product decision this feature makes:
 * capabilities of a saved model are adopted (`adopted`), while a model the user
 * has not saved (`added`) and one the catalog stopped describing (`missing`) are
 * only reported and left for the user to decide.
 */
export interface CatalogRefreshSummary {
  /** When the catalog was successfully read (epoch ms). */
  refreshedAt: number
  /** Saved models whose catalog description changed and was adopted. */
  adopted: string[]
  /** Catalog models the user has not saved — reported, never adopted. */
  added: string[]
  /** Saved models the catalog no longer describes — reported, never removed. */
  missing: string[]
}

/** The result of asking for an automatic round (`catalog/refresh`). */
export interface CatalogRefreshOutcome {
  /** False when a throttle, a missing configuration, or a failure stopped it. */
  ran: boolean
  /** Why it did not run: `throttled` | `not-configured` | `failed`. */
  skipped?: 'throttled' | 'not-configured' | 'failed'
  /** Present once a round succeeded (also on the last success after a failure). */
  result?: CatalogRefreshSummary
  /** The catalog answer, so the card can stage models the user has not saved. */
  catalog?: CatalogResult
}
