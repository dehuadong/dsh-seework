import { SettingsConflictError } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { promises, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path, { isAbsolute } from "node:path";
import { isVolatile } from "@deepseek-ai/cosmokit";
import z from "@deepseek-ai/schemastery";

//#region src/capabilities-skill.ts
/**
* Precedence rank for a packaged skill provider.
*
* Mirrors `BUNDLED_SKILL_RANK` (600) from `@deepseek-ai/dsh-skill`, and the
* import above stays **type-only** on purpose: a value import would turn the
* host's skill package into a load-time dependency, so a deployment without a
* skill subsystem would fail while *loading this plugin* — the optional
* injection below cannot save it, because the module never gets that far. Rank
* only orders skills that share a name, this plugin's name is unique, and a
* drift in the constant is therefore harmless; an unresolvable import is not.
*/
const BUNDLED_SKILL_RANK = 600;
/** Provider name this plugin registers in the host's skill registry. */
const SKILL_PROVIDER = "seework";
/** Skill name an agent or a user invokes. */
const SKILL_NAME = "seework-image-capabilities";
/** Packaged skill body; resolved beside the built bundle. */
const BODY_URL = new URL("../assets/seework-image-capabilities.md", import.meta.url);
/**
* Routing description — **a constant, and deliberately free of data**.
*
* It has no model count and no model name: the host caches summaries and only
* invalidates them when a provider registers or unregisters (see the module
* comment), so anything data-dependent here would stay frozen at that moment.
* What it does carry is the **order to load it before generating** (#665) —
* the same instruction the announcement and `generate_image`'s description
* give, so the model does not have to infer the skill's timing from a list of
* "when to load" triggers — followed by the secondary triggers, because with
* the announcement switched off (`announceToAgent=false`) this description is
* the only pointer the model has to the capability surface at all.
*/
const CANDIDATE = {
	name: SKILL_NAME,
	description: "**Load this before generating or editing any image with the SeeWork plugin** (its tool is `generate_image`). SeeWork image-generation manual: how to turn a user request into a confirmed generation or edit — understanding the visual intent, using the optional `reference_images`, choosing `n` / `resolution` / `aspect_ratio` from the model schema, confirming the parsed task before the first call, and iterating on the result. Its secondary triggers: a different model was chosen, or the user asks why the plugin is not usable. Its body is a fixed procedure, not a data table.",
	invocation: {
		modelInvocable: true,
		userInvocable: true
	},
	provider: SKILL_PROVIDER,
	source: "bundled",
	resourceBase: {
		kind: "directory",
		path: fileURLToPath(new URL("../assets/", import.meta.url))
	},
	rank: BUNDLED_SKILL_RANK,
	locator: BODY_URL
};
/**
* Build the provider for the packaged skill.
*
* Takes nothing: since #659 the body is a fixed file and the catalog entry is a
* constant, so there is no settings input to thread in. The host still calls
* `get()` on every load, which is what re-reads the file.
*
* @returns a provider whose catalog entry and body are both constant.
*/
function createCapabilitiesSkillProvider() {
	return {
		name: SKILL_PROVIDER,
		list: () => Promise.resolve([CANDIDATE]),
		async get() {
			const body = await readFile(BODY_URL, "utf8");
			return {
				name: CANDIDATE.name,
				description: CANDIDATE.description,
				invocation: CANDIDATE.invocation,
				provider: CANDIDATE.provider,
				source: CANDIDATE.source,
				resourceBase: CANDIDATE.resourceBase,
				content: body
			};
		}
	};
}
/**
* Register the bundled provider on the host's skill registry.
*
* @param ctx - a context whose `skills` service is attached.
* @returns the disposer that removes this exact registration (the caller owns
*   the `enabled` switch: flipping the plugin off unregisters the skill).
*/
function registerCapabilitiesSkill(ctx) {
	return ctx.skills.registerProvider(() => createCapabilitiesSkillProvider());
}

//#endregion
//#region src/protocol.ts
/**
* Wire contract shared by the host and browser halves of dsh-seework: the
* settings namespace, the route paths, the SeeAI Hub gateway request/response
* shapes, and the local material-library record shape.
*
* Pure types + constants — safe for the client bundle to inline.
*/
/** Settings namespace this plugin owns (host settings seam + bridge). */
const SEEWORK_SETTINGS_NAMESPACE = "dsh-seework";
/**
* Aspect ratios the gateway serves uniformly (#658/D-16).
*
* One list for every model, in the order a user should see them — the catalog's
* own arrays are lexicographically sorted sets, so they are not a usable order
* for a picker.
*/
const UNIFIED_ASPECT_RATIOS = [
	"1:1",
	"4:3",
	"3:4",
	"16:9",
	"9:16",
	"3:2",
	"2:3",
	"21:9"
];
/** Factory default for the ratio setting (#658/D-13/D-16). */
const DEFAULT_ASPECT_RATIO = "3:4";
/** Factory default for the output-format setting (#658/D-13). */
const DEFAULT_OUTPUT_FORMAT = "png";
/**
* Whether a list contains a value, ignoring case (#658).
*
* The one membership rule both halves need: the request layer asks whether the
* saved model can take the configured output format, and the settings card asks
* whether the stored value is already among the offered options.
*/
function includesIgnoringCase(list, wanted) {
	return list.some((value) => value.toLowerCase() === wanted.toLowerCase());
}
/**
* Default SeeAI Hub Gateway base URL — the OpenAI-compatible root, i.e. the
* part that `/images/generations` is appended to. Local development gateway is
* the default so a fresh install talks to the working stack; point it at a
* deployment domain in the settings card.
*/
const DEFAULT_API_URL = "http://127.0.0.1:8080/v1";
/**
* Default SeeAI Hub **service** base URL, used only for the model catalog.
*
* `docs/api/README.md` is explicit that the two surfaces are separate and that
* neither answers the other's paths: generation is the Gateway (`/v1/*`), while
* `GET /api/v1/catalog/models` is the service. Deriving one from the other
* works only behind a reverse proxy that mounts both under one host, which is
* why the catalog address is its own setting.
*/
const DEFAULT_SERVICE_URL = "http://127.0.0.1:8081";
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
const MAX_IMAGES_PER_REQUEST = 10;
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
function imageCountCeiling(modelCap) {
	const declared = typeof modelCap === "number" && Number.isFinite(modelCap) ? Math.trunc(modelCap) : MAX_IMAGES_PER_REQUEST;
	return Math.min(MAX_IMAGES_PER_REQUEST, Math.max(1, declared));
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
function effectiveImageCount(requested, modelCap) {
	const asked = Number.isFinite(requested) ? Math.trunc(requested) : 1;
	return Math.min(imageCountCeiling(modelCap), Math.max(1, asked));
}
/** Same-origin, loopback-only settings bridge for this plugin's namespace. */
const SETTINGS_API = {
	describe: "/api/dsh-seework/settings/describe",
	mutate: "/api/dsh-seework/settings/mutate",
	directoryPicker: "/api/dsh-seework/settings/directory-picker",
	pickDirectory: "/api/dsh-seework/settings/pick-directory"
};
/** SeeAI Hub model-catalog discovery (host-mediated, keeps no secrets). */
const CATALOG_API = {
	models: "/api/dsh-seework/catalog/models",
	refresh: "/api/dsh-seework/catalog/refresh"
};
/** The image-generation proxy route: the browser submits, the host calls upstream. */
const GENERATE_API = "/api/dsh-seework/generate";
/** Host-resident generation queue (browser side of the shared runtime). */
const TASK_API = {
	list: "/api/dsh-seework/tasks/list",
	cancel: "/api/dsh-seework/tasks/cancel"
};
/** Update discovery for a published install, and the install it triggers. */
const UPDATE_API = {
	status: "/api/dsh-seework/update/status",
	apply: "/api/dsh-seework/update/apply"
};
/**
* The local material library — every image this plugin generates is written
* under the data root and indexed, which is what the sidebar library and the
* canvas read back.
*/
const LIBRARY_API = {
	list: "/api/dsh-seework/library/list",
	head: "/api/dsh-seework/library/head",
	remove: "/api/dsh-seework/library/remove",
	clear: "/api/dsh-seework/library/clear",
	image: "/api/dsh-seework/library/image"
};
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
const ATTACHMENT_API = { image: "/api/dsh-seework/attachment/image" };
/** Image media types the attachment store accepts, as a runtime list. */
const IMAGE_MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif"
];
/**
* Whether a wire value is an image media type this plugin may read and serve.
* @param value - the candidate media type.
* @returns true when it is one of the accepted image types.
*/
function isImageMedia(value) {
	return IMAGE_MEDIA_TYPES.includes(value);
}
/** Data root the library lives under (overridable in settings). */
const DEFAULT_DATA_DIR_NAME = "dsh-seework";
/**
* Canvas documents live under `<data root>/canvas/`. The board is spatial, not
* a node graph: every card is just a placed rectangle, and the only structure
* is what the user sees (see `docs/architecture.md`).
*/
const CANVAS_API = {
	list: "/api/dsh-seework/canvas/list",
	create: "/api/dsh-seework/canvas/create",
	read: "/api/dsh-seework/canvas/read",
	save: "/api/dsh-seework/canvas/save",
	remove: "/api/dsh-seework/canvas/remove",
	asset: "/api/dsh-seework/canvas/asset",
	assets: "/api/dsh-seework/canvas/assets",
	pruneAssets: "/api/dsh-seework/canvas/assets/prune",
	removeAsset: "/api/dsh-seework/canvas/asset/remove"
};

//#endregion
//#region src/engine.ts
/** A generation failure with a stable machine code and a user-facing message. */
var SeeWorkError = class extends Error {
	constructor(message, code, detail) {
		super(message);
		this.code = code;
		this.detail = detail;
		this.name = "SeeWorkError";
	}
};
/** Cap on one downloaded/stored image, guarding against a runaway upstream. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
/** Per-request timeout: image generation is synchronous and can be slow. */
const REQUEST_TIMEOUT_MS = 3e5;
/** Join the configured base URL with the gateway path (tolerates a trailing slash). */
function gatewayUrl(apiUrl, path$1) {
	return `${apiUrl.trim().replace(/\/+$/, "")}/${path$1.replace(/^\/+/, "")}`;
}
/**
* Derive a catalog URL from a configured base.
* `http://host:8081` -> `http://host:8081/api/v1/catalog/models`.
* A base that already ends in `/v1` (a gateway base) drops that suffix, so a
* reverse proxy that mounts both surfaces under one host still resolves.
*/
function catalogUrl(baseUrl) {
	const trimmed = baseUrl.trim().replace(/\/+$/, "");
	return `${/\/v1$/.test(trimmed) ? trimmed.slice(0, -3) : trimmed}/api/v1/catalog/models`;
}
/** The `image_urls` field name (the documented alias `image` is equivalent). */
const IMAGE_URLS_FIELD = "image_urls";
/** Build the gateway request body for one normalized request. */
function buildGenerationBody(request) {
	const model = request.model.trim();
	if (model === "") throw new SeeWorkError("未选择模型：请先在「设置 → 插件 → SeeWork」检测并勾选模型。", "model-missing");
	const prompt = request.prompt.trim();
	if (prompt === "") throw new SeeWorkError("提示词不能为空。", "prompt-missing");
	const body = {
		model,
		prompt,
		n: effectiveImageCount(request.n)
	};
	const resolution = request.resolution.trim();
	if (resolution !== "" && resolution.toLowerCase() !== "auto") body.resolution = resolution;
	const aspectRatio = request.aspectRatio.trim();
	if (aspectRatio !== "" && aspectRatio.toLowerCase() !== "auto") body.aspect_ratio = aspectRatio;
	const outputFormat = request.outputFormat.trim();
	if (outputFormat !== "" && outputFormat.toLowerCase() !== "auto") body.output_format = outputFormat;
	const references = request.imageUrls.filter((url) => typeof url === "string" && url.trim() !== "");
	if (references.length > 0) body[IMAGE_URLS_FIELD] = references;
	return body;
}
/** Parse the `{error, message}` failure envelope the gateway documents. */
function gatewayFailure(status, payload) {
	const record = typeof payload === "object" && payload !== null ? payload : void 0;
	const code = typeof record?.error === "string" && record.error !== "" ? record.error : `http_${status}`;
	return new SeeWorkError(friendlyGatewayMessage(status, code, typeof record?.message === "string" && record.message !== "" ? record.message : ""), code);
}
/** Turn a gateway error into something a human can act on. */
function friendlyGatewayMessage(status, code, detail) {
	const suffix = detail === "" ? "" : `：${detail}`;
	const needsPermission = "请如实告知用户，得到许可后再发";
	switch (code) {
		case "unknown_field":
		case "invalid_parameter":
		case "unsupported_parameter":
		case "constraint_conflict":
		case "no_compatible_image_offering":
		case "invalid_resource":
		case "invalid_value": return `该模型不接受这次请求的参数组合（${code}）${suffix}`;
		case "invalid_json_body": return `请求体被网关判为非法 JSON（${code}）${suffix}`;
		case "model_protocol_mismatch": return `端点和模型协议不匹配（${code}）${suffix}`;
		case "model_not_found": return `模型不存在或未发布${suffix}`;
		case "image_task_in_progress": return `该模型已有任务在跑：本次没有发起生成，也没有扣费。${needsPermission}${suffix}`;
		default: break;
	}
	if (status === 401) return `API Key 无效或缺失，请在「设置 → 插件 → SeeWork」重新填写${suffix}`;
	if (status === 402) return `余额不足，请先充值${suffix}`;
	if (status === 403) return `账户已停用${suffix}`;
	if (status === 429) return `触发限流：本次没有发起生成。${needsPermission}${suffix}`;
	if (status === 502) return `上游不可达：本次没有交付。${needsPermission}${suffix}`;
	if (status === 504) return `上游超时：本次没有交付。${needsPermission}${suffix}`;
	if (status === 503) return `当前没有可用的供给：本次没有交付。${needsPermission}${suffix}`;
	return `生图失败（HTTP ${status}${code === `http_${status}` ? "" : ` / ${code}`}）${suffix}`;
}
/** One JSON POST to the gateway, with the documented error mapping. */
async function postJson(upstream, body, signal) {
	if (upstream.apiUrl.trim() === "") throw new SeeWorkError("尚未配置 API 地址：请在「设置 → 插件 → SeeWork」填写 SeeAI Hub 网关地址。", "api-url-missing");
	if (upstream.apiKey.trim() === "") throw new SeeWorkError("尚未配置 API Key：请在「设置 → 插件 → SeeWork」填写 SeeAI Hub 用户 API Key。", "api-key-missing");
	const url = gatewayUrl(upstream.apiUrl, "/images/generations");
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const composed = signal === void 0 ? timeout : AbortSignal.any([signal, timeout]);
	let response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${upstream.apiKey.trim()}`
			},
			body: JSON.stringify(body),
			signal: composed
		});
	} catch (error) {
		if (signal?.aborted === true) throw new SeeWorkError("生图已取消。", "cancelled");
		if (error instanceof SeeWorkError) throw error;
		const reason = error instanceof Error ? error.message : String(error);
		const timedOut = timeout.aborted;
		throw new SeeWorkError(timedOut ? `生图超时（超过 ${REQUEST_TIMEOUT_MS / 1e3} 秒）` : `连接网关失败：${reason}`, timedOut ? "timeout" : "network");
	}
	const text = await response.text();
	let payload;
	try {
		payload = text === "" ? void 0 : JSON.parse(text);
	} catch {
		payload = void 0;
	}
	if (response.ok) {
		if (typeof payload !== "object" || payload === null) throw new SeeWorkError("网关返回了非 JSON 的成功响应。", "bad_response");
		return payload;
	}
	throw gatewayFailure(response.status, payload);
}
/** Sniff a data URL's media type, falling back to a declared/assumed one. */
function mediaTypeOf(bytes, declared) {
	if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
	if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
	if (bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return "image/webp";
	if (bytes.length >= 6 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return "image/gif";
	if (declared !== void 0 && declared.startsWith("image/")) return declared.split(";")[0].trim();
	return "image/png";
}
/** Read an image from `data[]`: a remote URL to download, or inline base64. */
async function readImageItem(item, signal) {
	const revisedPrompt = typeof item.revised_prompt === "string" ? item.revised_prompt : typeof item.revisedPrompt === "string" ? item.revisedPrompt : void 0;
	const b64 = typeof item.b64_json === "string" && item.b64_json !== "" ? item.b64_json : void 0;
	if (b64 !== void 0) {
		if (Math.floor(b64.length * 3 / 4) > MAX_IMAGE_BYTES) throw new SeeWorkError(`生成结果超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB，已放弃保存。`, "image_too_large");
		const bytes = Buffer.from(b64, "base64");
		if (bytes.byteLength === 0) return void 0;
		return {
			b64,
			mime: mediaTypeOf(bytes, void 0),
			...revisedPrompt === void 0 ? {} : { revisedPrompt }
		};
	}
	const url = typeof item.url === "string" && item.url !== "" ? item.url : void 0;
	if (url === void 0) return void 0;
	const response = await fetch(url, signal === void 0 ? {} : { signal });
	if (!response.ok) throw new SeeWorkError(`下载生成结果失败（HTTP ${response.status}）。`, "download_failed");
	const declared = Number(response.headers.get("content-length") ?? "");
	if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new SeeWorkError(`生成结果超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB，已放弃下载。`, "image_too_large");
	const buffer = await readBounded(response, MAX_IMAGE_BYTES);
	if (buffer === void 0) throw new SeeWorkError(`生成结果超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB，已放弃下载。`, "image_too_large");
	if (buffer.byteLength === 0) throw new SeeWorkError("下载到的图片为空。", "download_failed");
	return {
		b64: buffer.toString("base64"),
		mime: mediaTypeOf(buffer, response.headers.get("content-type") ?? void 0),
		...revisedPrompt === void 0 ? {} : { revisedPrompt }
	};
}
/**
* Read a response body, giving up as soon as it exceeds `limit`.
*
* A server that lies about (or omits) `content-length` must not be able to make
* the host allocate an unbounded buffer.
*
* @returns the bytes, or undefined when the body exceeded the limit.
*/
async function readBounded(response, limit) {
	if (response.body === null) {
		const buffer = Buffer.from(await response.arrayBuffer());
		return buffer.byteLength > limit ? void 0 : buffer;
	}
	const chunks = [];
	let total = 0;
	const reader = response.body.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done === true) break;
			if (value === void 0) continue;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel().catch(() => {});
				return;
			}
			chunks.push(Buffer.from(value));
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks);
}
/**
* Run one generation against the gateway.
* @param upstream - resolved credentials.
* @param request - the normalized request.
* @param options - cancellation signal.
* @returns the generated images plus the charged amount when reported.
*/
async function generateImage(upstream, request, options = {}) {
	const payload = await postJson(upstream, buildGenerationBody(request), options.signal);
	const data = Array.isArray(payload.data) ? payload.data : [];
	if (data.length === 0) throw new SeeWorkError("网关没有返回任何图片数据。", "empty_result");
	const images = [];
	for (const item of data) {
		if (typeof item !== "object" || item === null) continue;
		const image = await readImageItem(item, options.signal);
		if (image !== void 0) images.push(image);
	}
	if (images.length === 0) throw new SeeWorkError("网关返回的 data[] 里没有可用的图片地址或数据。", "empty_result");
	const rawCost = payload.cost;
	const cost = typeof rawCost === "number" && Number.isFinite(rawCost) ? rawCost : void 0;
	return {
		images,
		...cost === void 0 ? {} : { cost }
	};
}

//#endregion
//#region src/library.ts
/** Default data root: `<DSH_HOME|~/.dsh>/dsh-seework`. */
function defaultDataRoot() {
	const home = process.env.DSH_HOME?.trim();
	return path.join(home !== void 0 && home !== "" ? home : path.join(homedir(), ".dsh"), DEFAULT_DATA_DIR_NAME);
}
let dataRoot = defaultDataRoot();
/** The directory every library image and its index live under. */
function libraryDataRoot() {
	return dataRoot;
}
/**
* Point the library at another root (settings `dataDir`; empty restores the
* default). The host half calls this on every settings resolution, so an
* unchanged value is a no-op and never disturbs in-flight writes.
*/
function setLibraryDataRoot(value) {
	const trimmed = value?.trim();
	const next = trimmed === void 0 || trimmed === "" ? defaultDataRoot() : path.resolve(trimmed);
	if (next !== dataRoot) dataRoot = next;
}
function indexPath() {
	return path.join(dataRoot, "index.json");
}
function imagesDir() {
	return path.join(dataRoot, "images");
}
/** Entries kept in the index (oldest generations are trimmed, files removed). */
const LIBRARY_MAX_ENTRIES = 2e3;
/**
* Library mutations read and replace one shared index; serialize them so two
* concurrent generations cannot each read an old index and drop the other's row.
*/
let pendingMutation = Promise.resolve();
function mutateLibrary(operation) {
	const next = pendingMutation.then(operation, operation);
	pendingMutation = next.then(() => void 0, () => void 0);
	return next;
}
/** File extension for a media type. */
function extensionOf(mime) {
	switch (mime.split(";")[0].trim().toLowerCase()) {
		case "image/jpeg": return "jpg";
		case "image/webp": return "webp";
		case "image/gif": return "gif";
		default: return "png";
	}
}
/** Media type for a stored file name. */
function mimeOfFile(file) {
	switch (path.extname(file).toLowerCase()) {
		case ".jpg":
		case ".jpeg": return "image/jpeg";
		case ".webp": return "image/webp";
		case ".gif": return "image/gif";
		default: return "image/png";
	}
}
/**
* Intrinsic pixel size read straight from the container header — no image
* library needed, and a malformed header just yields undefined.
*/
function imageSize(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.byteLength >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return {
		width: view.getUint32(16),
		height: view.getUint32(20)
	};
	if (bytes.byteLength >= 10 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return {
		width: view.getUint16(6, true),
		height: view.getUint16(8, true)
	};
	if (bytes.byteLength >= 30 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) {
		const fourCC = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
		if (fourCC.startsWith("VP8X")) return {
			width: 1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16),
			height: 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16)
		};
		if (fourCC.startsWith("VP8L") && bytes.byteLength >= 25) {
			const bits = bytes[21] | bytes[22] << 8 | bytes[23] << 16 | bytes[24] << 24;
			return {
				width: (bits & 16383) + 1,
				height: (bits >> 14 & 16383) + 1
			};
		}
		if (fourCC.startsWith("VP8 ") && bytes.byteLength >= 30) return {
			width: view.getUint16(26, true) & 16383,
			height: view.getUint16(28, true) & 16383
		};
	}
	if (bytes.byteLength >= 4 && bytes[0] === 255 && bytes[1] === 216) {
		let offset = 2;
		while (offset + 9 < bytes.byteLength) {
			if (bytes[offset] !== 255) {
				offset++;
				continue;
			}
			const marker = bytes[offset + 1];
			if (marker === 216 || marker === 1 || marker >= 208 && marker <= 215) {
				offset += 2;
				continue;
			}
			const length = view.getUint16(offset + 2);
			if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204) return {
				height: view.getUint16(offset + 5),
				width: view.getUint16(offset + 7)
			};
			offset += 2 + length;
		}
	}
}
/** Structural guard for one persisted entry. */
function isStoredEntry(value) {
	if (value === null || typeof value !== "object") return false;
	const entry = value;
	return typeof entry.id === "string" && typeof entry.createdAt === "number" && (entry.mode === "text" || entry.mode === "edit") && typeof entry.model === "string" && typeof entry.prompt === "string" && Array.isArray(entry.images) && entry.images.every((image) => {
		if (image === null || typeof image !== "object") return false;
		const record = image;
		return typeof record.file === "string" && typeof record.mime === "string";
	});
}
/** Read the index, tolerating a missing or corrupt file. */
async function readIndex() {
	try {
		const raw = await promises.readFile(indexPath(), "utf8");
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object") return [];
		const entries = parsed.entries;
		if (!Array.isArray(entries)) return [];
		return entries.filter(isStoredEntry);
	} catch {
		return [];
	}
}
/** Persist the index atomically (temp file + rename). */
async function writeIndex(entries) {
	await promises.mkdir(imagesDir(), { recursive: true });
	const payload = {
		version: 1,
		entries
	};
	const tmp = `${indexPath()}.tmp-${process.pid}`;
	await promises.writeFile(tmp, JSON.stringify(payload), "utf8");
	await promises.rename(tmp, indexPath());
}
/** Project a stored entry onto the wire shape (served image URLs). */
function toWire(entry) {
	return {
		id: entry.id,
		createdAt: entry.createdAt,
		mode: entry.mode,
		model: entry.model,
		prompt: entry.prompt,
		resolution: entry.resolution,
		aspectRatio: entry.aspectRatio,
		quality: entry.quality,
		outputFormat: entry.outputFormat,
		n: entry.n,
		images: entry.images.map(toWireImage),
		...entry.cost === void 0 ? {} : { cost: entry.cost },
		...entry.refNames === void 0 ? {} : { refNames: entry.refNames },
		source: entry.source,
		...entry.sessionId === void 0 ? {} : { sessionId: entry.sessionId },
		...entry.tags === void 0 ? {} : { tags: entry.tags }
	};
}
function toWireImage(image) {
	return {
		url: `${LIBRARY_API.image}/${image.file}`,
		file: image.file,
		mime: image.mime,
		...image.width === void 0 ? {} : { width: image.width },
		...image.height === void 0 ? {} : { height: image.height },
		...image.revisedPrompt === void 0 ? {} : { revisedPrompt: image.revisedPrompt }
	};
}
/** Everything the library list route reports. */
async function listLibrary() {
	const entries = await readIndex();
	let imageCount = 0;
	for (const entry of entries) imageCount += entry.images.length;
	return {
		entries: entries.map(toWire),
		total: entries.length,
		imageCount,
		dataRoot
	};
}
/**
* The library's identity, cheap enough for a poll.
*
* The browser has no push channel from the host, so "did a generation just
* finish?" is answered by watching the newest entry id. This deliberately does
* NOT return the list: the caller polls it every couple of seconds, and the
* full list carries every entry's metadata.
*
* @returns the newest entry's id and the total, or just the total when empty.
*/
async function readLibraryHead() {
	const entries = await readIndex();
	let newest;
	for (const entry of entries) if (newest === void 0 || entry.createdAt > newest.createdAt) newest = entry;
	return {
		total: entries.length,
		...newest === void 0 ? {} : {
			newestId: newest.id,
			newestAt: newest.createdAt
		}
	};
}
/** Remove one entry's image files (best effort). */
async function removeEntryFiles(entry) {
	for (const image of entry.images) try {
		await promises.rm(path.join(imagesDir(), image.file), { force: true });
	} catch {}
}
/** File name of one stored image: `<entry id>-<index>.<ext>`. */
function imageFileName(entryId, index, mime) {
	return `${entryId}-${index}.${extensionOf(mime)}`;
}
/**
* Where one generated image lives, in the three forms a caller may need.
*
* The naming rule is shared with the writer below rather than repeated, so the
* file/URL/path an Agent tool reports can never drift from what actually landed
* on disk. That matters because the model cannot see the picture: these strings
* are the only way it can say where the image is.
*
* @param entryId - the library entry the generation was stored as.
* @param index - 0-based image position inside that entry.
* @param mime - the image's media type (decides the extension).
* @returns the file name, its same-origin URL, and its absolute path.
*/
function libraryImageLocation(entryId, index, mime) {
	const file = imageFileName(entryId, index, mime);
	return {
		file,
		url: `${LIBRARY_API.image}/${file}`,
		path: path.join(imagesDir(), file)
	};
}
/**
* Write one generation's images to disk and prepend its index entry.
* @returns the stored wire entry.
* @throws when an image cannot be written (no partial entry is left behind).
*/
async function appendLibraryEntry(input) {
	return mutateLibrary(async () => {
		await promises.mkdir(imagesDir(), { recursive: true });
		const id = randomUUID();
		const stored = [];
		try {
			for (let index = 0; index < input.images.length; index++) {
				const image = input.images[index];
				const bytes = Buffer.from(image.b64, "base64");
				const file = imageFileName(id, index, image.mime);
				await promises.writeFile(path.join(imagesDir(), file), bytes);
				const size = imageSize(bytes);
				stored.push({
					file,
					mime: image.mime,
					...size === void 0 ? {} : size,
					...image.revisedPrompt === void 0 ? {} : { revisedPrompt: image.revisedPrompt }
				});
			}
		} catch (error) {
			await removeEntryFiles({ images: stored });
			throw error;
		}
		const entry = {
			id,
			createdAt: Date.now(),
			mode: input.request.mode,
			model: input.request.model,
			prompt: input.request.prompt,
			resolution: input.request.resolution,
			aspectRatio: input.request.aspectRatio,
			quality: "",
			outputFormat: input.request.outputFormat,
			n: input.request.n,
			images: stored,
			...input.cost === void 0 ? {} : { cost: input.cost },
			...input.request.refNames === void 0 ? {} : { refNames: input.request.refNames },
			source: input.source,
			...input.sessionId === void 0 ? {} : { sessionId: input.sessionId }
		};
		const previous = await readIndex();
		const merged = [entry, ...previous].slice(0, LIBRARY_MAX_ENTRIES);
		await writeIndex(merged);
		const keptIds = new Set(merged.map((candidate) => candidate.id));
		for (const candidate of previous) if (!keptIds.has(candidate.id)) await removeEntryFiles(candidate);
		return toWire(entry);
	});
}
/** Remove one entry (and its image files); returns the remaining entries. */
async function removeLibraryEntry(id) {
	return mutateLibrary(async () => {
		const entries = await readIndex();
		const target = entries.find((entry) => entry.id === id);
		if (target !== void 0) await removeEntryFiles(target);
		const kept = entries.filter((entry) => entry.id !== id);
		await writeIndex(kept);
		return kept.map(toWire);
	});
}
/** Remove every entry and image file. */
async function clearLibrary() {
	return mutateLibrary(async () => {
		const entries = await readIndex();
		for (const entry of entries) await removeEntryFiles(entry);
		await writeIndex([]);
		return [];
	});
}
/** Read one stored image file by its (validated) file name. */
async function readLibraryImage(file) {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*-[0-9]+\.(png|jpg|jpeg|webp|gif)$/.test(file)) return void 0;
	try {
		return {
			data: await promises.readFile(path.join(imagesDir(), file)),
			mime: mimeOfFile(file)
		};
	} catch {
		return;
	}
}

//#endregion
//#region src/capability.ts
/**
* The stored shape of one model (also the settings card's field contract).
*
* Declared once and reused by the settings schema: a field the document stores is
* exactly a field this module knows how to read, merge and compare.
*/
const modelSchema = z.object({
	id: z.string(),
	label: z.string().default(""),
	resolutions: z.array(z.string()).default([]),
	resolutionDefault: z.string().default(""),
	aspectRatios: z.array(z.string()).default([]),
	outputFormats: z.array(z.string()).default([]),
	maxImages: z.number().default(1),
	maxReferenceImages: z.number().default(0),
	capabilitiesKnown: z.boolean().default(false),
	discoveredAt: z.number()
});
/**
* Normalize a raw model entry (schema-adjacent guard for hand-built values).
*/
function normalizeModel(value) {
	if (value === null || typeof value !== "object") return void 0;
	const raw = value;
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	if (id === "") return void 0;
	const list = (input) => Array.isArray(input) ? input.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
	const positive = (input, fallback) => typeof input === "number" && Number.isFinite(input) && input >= 0 ? Math.trunc(input) : fallback;
	return {
		id,
		label: typeof raw.label === "string" ? raw.label.trim() : "",
		resolutions: list(raw.resolutions),
		resolutionDefault: typeof raw.resolutionDefault === "string" ? raw.resolutionDefault.trim() : "",
		aspectRatios: list(raw.aspectRatios),
		outputFormats: list(raw.outputFormats),
		maxImages: positive(raw.maxImages, 1),
		maxReferenceImages: positive(raw.maxReferenceImages, 0),
		capabilitiesKnown: raw.capabilitiesKnown === true,
		...typeof raw.discoveredAt === "number" && Number.isFinite(raw.discoveredAt) && raw.discoveredAt > 0 ? { discoveredAt: Math.trunc(raw.discoveredAt) } : {}
	};
}
/** Union of two string lists, first occurrence order, no duplicates. */
function unionList(left, right) {
	const out = [...left];
	for (const item of right) if (!out.includes(item)) out.push(item);
	return out;
}
/**
* Keep the newer of two discovery stamps, or nothing when neither knows.
*
* Spread-friendly so the caller does not have to spell the "absent means
* unknown" rule again: an unstamped copy stays unstamped instead of acquiring a
* `0` that other code would then have to special-case.
*
* @param left - one copy's stamp.
* @param right - the other copy's stamp.
* @returns `{ discoveredAt }` when at least one is known, otherwise `{}`.
*/
function newestStamp(left, right) {
	const known = [left, right].filter((stamp) => stamp !== void 0);
	return known.length === 0 ? {} : { discoveredAt: Math.max(...known) };
}
/**
* Fold a duplicate catalog entry into the one already collected.
*
* The capability arrays are unioned rather than first-wins: a repeated id can
* only mean the same model was described twice, and keeping the union makes the
* request builder *more* permissive, never less. The declared default tier is
* the one thing a union cannot reconstruct, so a copy that carries one keeps it
* (there is exactly one default per model).
*/
function mergeModel(into, extra) {
	return {
		id: into.id,
		label: into.label !== void 0 && into.label !== "" ? into.label : extra.label,
		resolutions: unionList(into.resolutions, extra.resolutions),
		resolutionDefault: into.resolutionDefault !== void 0 && into.resolutionDefault !== "" ? into.resolutionDefault : extra.resolutionDefault ?? "",
		aspectRatios: unionList(into.aspectRatios, extra.aspectRatios),
		outputFormats: unionList(into.outputFormats, extra.outputFormats),
		maxImages: Math.max(into.maxImages, extra.maxImages),
		maxReferenceImages: Math.max(into.maxReferenceImages, extra.maxReferenceImages),
		capabilitiesKnown: into.capabilitiesKnown === true || extra.capabilitiesKnown === true,
		...newestStamp(into.discoveredAt, extra.discoveredAt)
	};
}
/**
* Read a whole raw `models` list: normalize every entry, drop the unusable ones,
* and merge entries that repeat an id.
*
* @param value - the raw document value (anything; only an array is read).
* @returns the normalized models, in first-occurrence order.
*/
function normalizeModels(value) {
	const models = [];
	const byId = /* @__PURE__ */ new Map();
	for (const candidate of Array.isArray(value) ? value : []) {
		const model = normalizeModel(candidate);
		if (model === void 0) continue;
		const existing = byId.get(model.id);
		if (existing === void 0) {
			byId.set(model.id, models.length);
			models.push(model);
			continue;
		}
		models[existing] = mergeModel(models[existing], model);
	}
	return models;
}
/** Substrings that mark a non-image model even when no type field is present. */
const NON_IMAGE_HINTS = [
	"embedding",
	"embed",
	"rerank",
	"moderation",
	"whisper",
	"tts",
	"audio",
	"realtime",
	"transcribe",
	"speech",
	"ocr",
	"chat",
	"instruct",
	"vision"
];
/** Substrings that mark an image model when no type field is present. */
const IMAGE_HINTS = [
	"image",
	"dall-e",
	"dalle",
	"flux",
	"seedream",
	"seededit",
	"imagen",
	"kolors",
	"qwen-image",
	"wanx",
	"grok-imagine",
	"stable-diffusion",
	"sdxl"
];
/** Read a string array from an unknown value, dropping blanks and duplicates. */
function stringList(value) {
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const item of value) {
		const text = typeof item === "string" ? item.trim() : typeof item === "number" ? String(item) : "";
		if (text !== "" && !out.includes(text)) out.push(text);
	}
	return out;
}
/**
* One descriptor from the entry's `supported_parameters` map.
*
* Catalog v2 describes **every field this deployment can send** with one
* self-describing descriptor (`enum` / `range` / `boolean` / `array`). The key
* existing is the permission: a key that is absent is a field this contract did
* not publish — which is **not** a claim that upstream would refuse it.
*
* @param parameters - the entry's `supported_parameters`, when it carried one.
* @param field - the Canonical field name (`resolution`, `n`, `image_urls`…).
* @returns the descriptor, or undefined when the entry declared none.
*/
function descriptor(parameters, field) {
	const value = parameters?.[field];
	return value !== null && typeof value === "object" ? value : void 0;
}
/**
* The `values` of one `enum` descriptor, in the order it declares.
*
* **That order is the contract's order** — lowest to highest / display order —
* so the returned list is used verbatim as the model's tier ranking. A
* descriptor of any other shape declares no enum, and an entry without the key
* declares the field not sendable at all.
*/
function enumValues(parameters, field) {
	const meta = descriptor(parameters, field);
	return meta?.type === "enum" ? stringList(meta.values) : [];
}
/**
* The `max` of one `range` or `array` descriptor — a field's own ceiling.
*
* The ceiling rides on the field it belongs to since v2 (`n.max` = images per
* request, `image_urls.max` = reference images), replacing the old side keys.
* `array`'s `max` counts elements; `range`'s is the numeric upper bound.
*
* @returns the ceiling, or undefined when the field declares none.
*/
function descriptorMax(parameters, field) {
	const meta = descriptor(parameters, field);
	if (meta === void 0 || meta.type !== "range" && meta.type !== "array") return void 0;
	const max = meta.max;
	return typeof max === "number" && Number.isFinite(max) && max >= 0 ? Math.trunc(max) : void 0;
}
/**
* The `default` one descriptor declares, when it declares a string one.
*
* Read **verbatim**: the plugin never derives a default from the value list
* (`values[0]` is not a substitute for a declared default), and the catalog's
* own guarantee is that `resolution.default` is always published.
*
* @returns the declared default, or '' when there is none to read.
*/
function descriptorDefault(parameters, field) {
	const meta = descriptor(parameters, field);
	return meta !== void 0 && typeof meta.default === "string" ? meta.default.trim() : "";
}
/** Whether a model id / type pair reads as an image model. */
function looksLikeImageModel(id, type) {
	if (typeof type === "string" && type.trim() !== "") return type.trim().toLowerCase() === "image";
	const lower = id.toLowerCase();
	const firstAt = (hints) => hints.reduce((best, hint) => {
		const at = lower.indexOf(hint);
		return at >= 0 && (best < 0 || at < best) ? at : best;
	}, -1);
	const imageAt = firstAt(IMAGE_HINTS);
	if (imageAt < 0) return false;
	const otherAt = firstAt(NON_IMAGE_HINTS);
	return otherAt < 0 || imageAt < otherAt;
}
/**
* Map one SeeAI Hub catalog entry onto the model shape.
*
* Catalog v2 (`docs/api/catalog.md`) describes the sendable field surface with
* `supported_parameters` descriptors; there is **one** reading path and no v1
* fallback (#663/D-2). An entry that carries no `supported_parameters` at all
* (a pre-v2 snapshot, or an older deployment) becomes **capabilities unknown**:
* discovery still reports the model, and the request builder stops trimming
* rather than reading "absent" as "refused" (#663/D-1).
*
* The result **is** the shape the settings document stores (#669): discovery used
* to answer with a second, nearly identical type that every consumer projected by
* hand. `discoveredAt` is stamped on the whole round by discovery, not here.
*
* @returns the model, or undefined when the entry is not an image model.
*/
function catalogEntryToModel(value) {
	if (value === null || typeof value !== "object") return void 0;
	const entry = value;
	const id = typeof entry.name === "string" ? entry.name.trim() : "";
	if (id === "" || !looksLikeImageModel(id, entry.type)) return void 0;
	const declared = entry.supported_parameters;
	const parameters = declared !== null && typeof declared === "object" ? declared : void 0;
	const displayName = typeof entry.display_name === "string" && entry.display_name.trim() !== "" ? entry.display_name.trim() : id;
	const maxReferenceImages = descriptorMax(parameters, "image_urls") ?? 0;
	return {
		id,
		label: displayName,
		resolutions: enumValues(parameters, "resolution"),
		resolutionDefault: descriptorDefault(parameters, "resolution"),
		aspectRatios: enumValues(parameters, "aspect_ratio"),
		outputFormats: enumValues(parameters, "output_format"),
		maxImages: Math.max(1, descriptorMax(parameters, "n") ?? 1),
		maxReferenceImages,
		capabilitiesKnown: parameters !== void 0
	};
}
/** Map an OpenAI-compatible `/models` list onto the model shape. */
function openAiEntryToModel(value) {
	if (value === null || typeof value !== "object") return void 0;
	const entry = value;
	const id = typeof entry.id === "string" ? entry.id.trim() : "";
	if (id === "" || !looksLikeImageModel(id, entry.type ?? entry.model_type)) return void 0;
	return {
		id,
		label: id,
		resolutions: [],
		resolutionDefault: "",
		aspectRatios: [],
		outputFormats: [],
		maxImages: 1,
		maxReferenceImages: 0,
		capabilitiesKnown: false
	};
}
/** Whether two string lists are equal, order included. */
function sameList(left, right) {
	const from = left ?? [];
	return from.length === right.length && from.every((item, index) => item === right[index]);
}
/**
* Keys the settings schema no longer stores (#659 / #661 / #663).
*
* A document written before those batches carries them on every model. There is
* no migration pass: an adopted entry is rebuilt field by field, so the residue
* rides out with the next whole-`models` write. What these helpers add is the
* **trigger** — see {@link CatalogRefresherDeps.hasRetiredKeys}.
*
* `qualities` joined the list in #661, when `quality` stopped being a plugin
* parameter altogether. `orderedResolutions` / `resolutionOrderReliable` joined
* it in #663, when catalog v2 made the enum descriptor's `values` order the one
* declared order: both keys would be a second copy of `resolutions` itself.
*/
const RETIRED_MODEL_KEYS = [
	"parameters",
	"parameterDocs",
	"parameterRules",
	"guidePath",
	"qualities",
	"orderedResolutions",
	"resolutionOrderReliable"
];
/**
* Whether one saved entry still carries keys this plugin no longer stores.
*
* Takes `unknown` on purpose: the caller usually holds the **raw** document
* entry. The normalized view ({@link normalizeModels}) has already dropped these
* keys, so asking it would always answer "clean" — which is exactly why the
* cleanup signal has to be read from the document.
*/
function carriesRetiredKeys(entry) {
	if (entry === null || typeof entry !== "object") return false;
	const record = entry;
	return RETIRED_MODEL_KEYS.some((key) => key in record);
}
/** Whether any entry of a raw `models` list still carries those keys. */
function hasRetiredModelKeys(models) {
	return Array.isArray(models) && models.some((entry) => carriesRetiredKeys(entry));
}
/**
* Whether one saved model's catalog description differs from the advertisement.
*
* Compared field by field rather than by serializing both objects: a
* `discoveredAt` stamp or a key order would otherwise read as "changed" on every
* round and write the document for nothing.
*
* @param saved - the saved model.
* @param fresh - what the catalog says now.
* @returns true when at least one advertised capability moved.
*/
function capabilityChanged(saved, fresh) {
	return saved.label !== fresh.label || !sameList(saved.resolutions, fresh.resolutions) || (saved.resolutionDefault ?? "") !== fresh.resolutionDefault || !sameList(saved.aspectRatios, fresh.aspectRatios) || !sameList(saved.outputFormats, fresh.outputFormats) || saved.maxImages !== fresh.maxImages || saved.maxReferenceImages !== fresh.maxReferenceImages || saved.capabilitiesKnown !== fresh.capabilitiesKnown || saved.discoveredAt === void 0;
}
/**
* The saved entry for a model the catalog just described.
*
* Field by field rather than a spread (#669 kept it that way on purpose): the
* discovery answer and the stored entry are now the same type, so the only thing
* this adds over `{ ...saved, ...fresh }` is the id and any unadvertised field
* surviving, plus the stamp rule below. It stays explicit because the settings
* schema is the authority on what may travel into the document.
*
* @param saved - the saved entry, whose id and any unadvertised field survive.
* @param fresh - the catalog's current description.
* @returns the entry to persist.
*/
function withRefreshedCapabilities(saved, fresh) {
	return {
		id: saved.id,
		label: fresh.label,
		resolutions: fresh.resolutions,
		resolutionDefault: fresh.resolutionDefault,
		aspectRatios: fresh.aspectRatios,
		outputFormats: fresh.outputFormats,
		maxImages: fresh.maxImages,
		maxReferenceImages: fresh.maxReferenceImages,
		capabilitiesKnown: fresh.capabilitiesKnown,
		...fresh.discoveredAt === void 0 ? saved.discoveredAt === void 0 ? {} : { discoveredAt: saved.discoveredAt } : { discoveredAt: fresh.discoveredAt }
	};
}
/**
* Apply one catalog round to the saved models.
*
* Pure on purpose: this is the whole of the "what may change automatically"
* decision, so it is exercised directly rather than through a fake catalog.
*
* @param saved - the saved models, in their current order.
* @param catalog - the models the catalog just reported.
* @returns the list to persist (identical to `saved` when nothing changed) and
*   the ids that were adopted, added, or vanished.
*/
function adoptRefreshedCapabilities(saved, catalog) {
	const byId = new Map(catalog.map((model) => [model.id, model]));
	const savedIds = new Set(saved.map((model) => model.id));
	/** Saved models the catalog still describes and that actually moved. */
	const refreshed = /* @__PURE__ */ new Set();
	saved.forEach((model, index) => {
		const fresh = byId.get(model.id);
		if (fresh !== void 0 && capabilityChanged(model, fresh)) refreshed.add(index);
	});
	return {
		models: refreshed.size === 0 ? saved : saved.map((model) => {
			const fresh = byId.get(model.id);
			return fresh === void 0 ? model : withRefreshedCapabilities(model, fresh);
		}),
		adopted: [...refreshed].map((index) => saved[index].id),
		added: catalog.filter((model) => !savedIds.has(model.id)).map((model) => model.id),
		missing: saved.filter((model) => !byId.has(model.id)).map((model) => model.id)
	};
}
/** Keep a value only when the model accepts it. */
function accepted(field, value, allowed, dropped, capabilitiesKnown) {
	const trimmed = value.trim();
	if (trimmed === "" || trimmed.toLowerCase() === "auto") return "";
	if (allowed.length === 0 && !capabilitiesKnown) return trimmed;
	const match = allowed.find((candidate) => candidate.toLowerCase() === trimmed.toLowerCase());
	if (match !== void 0) return match;
	dropped.push({
		field,
		value: trimmed,
		allowed,
		reason: "invalid_value"
	});
	return "";
}
/**
* The tier a request uses when the caller names none.
*
* It is **exactly what the catalog declared** (`resolution.default`), never the
* first entry of the tier list: a model may declare a default that is not its
* lowest tier, so `resolutions[0]` is not a substitute (#663/D-3). An empty
* answer means the contract declared none — a breach of the "always published"
* invariant — and the caller then omits the field rather than guessing one
* (#663/P3). The missing default is reported in the announcement instead.
*/
function defaultResolutionFor(model) {
	return model.resolutionDefault?.trim() ?? "";
}
/**
* A configured default the model actually declares, or `''` to omit the field.
*
* The plugin's own defaults are not values the caller named: a model that does
* not declare one — or whose capabilities are unknown, so the plugin has no
* evidence either way — gets the field omitted, and nothing is ever reported as
* a dropped parameter. `accepted()` is the caller-facing half of the same rule.
*
* Spelling: a value the caller named is echoed back in the **model's** spelling
* (`accepted()`); the plugin's configured default travels **verbatim** or not at
* all, because there is no model spelling to prefer for a value the plugin chose.
*
* @param model - the selected model's catalog entry.
* @param configured - the value from the plugin settings.
* @param allowed - the values this model declares for that field.
*/
function configuredWhenAccepted(model, configured, allowed) {
	const wanted = configured.trim();
	if (wanted === "" || model.capabilitiesKnown !== true) return "";
	return includesIgnoringCase(allowed, wanted) ? wanted : "";
}
/**
* The configured output format, when this model can actually take it (#658/D-13).
*
* A format the model does not declare (or a model whose capabilities are unknown)
* yields '' so the field is simply omitted — the plugin must not gamble a field
* on a model it knows nothing about.
*/
function defaultOutputFormatFor(model, configured) {
	return configuredWhenAccepted(model, configured, model.outputFormats);
}
/**
* The configured aspect ratio, when this model can actually take it (#668).
*
* Same rule as {@link defaultOutputFormatFor}, and for the same reason: the
* contract publishes **no** default for `aspect_ratio` (`docs/api/images.md`), so
* the plugin's own setting is the only candidate — and a model that does not
* declare it (or whose capabilities are unknown) simply gets the field omitted.
* The configured value is not the caller's, so it is never reported as a dropped
* parameter.
*/
function defaultAspectRatioFor(model, configured) {
	return configuredWhenAccepted(model, configured, model.aspectRatios);
}
/**
* Resolve a request against the selected model's capability table.
*
* SeeAI Hub validates every parameter against the model: a value outside the
* model's enum is a 400, and so is a parameter the model does not take at all.
* What an empty list means depends on where the model came from — see
* {@link ModelConfig.capabilitiesKnown}.
*
* Two kinds of value meet here, and they are treated differently on purpose:
* a value the **caller** named goes through `accepted()` (kept in the model's own
* spelling, or reported as dropped), while a value the **plugin** configured goes
* through {@link configuredWhenAccepted} (sent verbatim, or silently omitted and
* never reported as the caller's mistake).
*
* @param request - the caller's request, already resolved to a configured model.
* @param model - that model's catalog entry.
* @param defaults - the configured defaults, used when the caller names neither.
* @returns the request to send, plus what was left out.
*/
function resolveRequest(request, model, defaults = {}) {
	const dropped = [];
	const known = model.capabilitiesKnown === true;
	const count = effectiveImageCount(request.n, model.maxImages);
	const wantsReferences = request.imageUrls.length > 0;
	const referencesAllowed = model.maxReferenceImages > 0 || !known;
	if (wantsReferences && !referencesAllowed) dropped.push({
		field: "image_urls",
		value: `${request.imageUrls.length} 张参考图`,
		allowed: [],
		reason: "unsupported_field"
	});
	const requestedResolution = request.resolution.trim();
	return {
		request: {
			...request,
			n: count,
			resolution: requestedResolution !== "" ? accepted("resolution", requestedResolution, model.resolutions, dropped, known) : defaultResolutionFor(model),
			aspectRatio: request.aspectRatio.trim() !== "" ? accepted("aspect_ratio", request.aspectRatio, model.aspectRatios, dropped, known) : defaultAspectRatioFor(model, defaults.aspectRatio ?? ""),
			outputFormat: accepted("output_format", request.outputFormat.trim() || defaultOutputFormatFor(model, defaults.outputFormat ?? ""), model.outputFormats, dropped, known),
			imageUrls: wantsReferences && referencesAllowed ? request.imageUrls : [],
			...wantsReferences && !referencesAllowed ? { refNames: void 0 } : {},
			mode: wantsReferences && referencesAllowed ? "edit" : "text"
		},
		dropped
	};
}

//#endregion
//#region src/settings.ts
/** The branded settings namespace of this plugin. */
const SeeWorkSettingsNamespace = SEEWORK_SETTINGS_NAMESPACE;
/**
* The plugin's field contract, without the live-reference marker.
*
* This is what tests and tooling validate a raw document against; the loader
* validates the entry with {@link Config} below, which is the same shape wrapped
* once more.
*
* The assertion is load-bearing, not decoration: this fork's `object()` helper
* leaves each field's mode generic in its output type (`SetRequired<Mode, true>`
* rather than the resolved `'defined'`), so an inferred schema no longer
* satisfies `z<Config>` even though it resolves to exactly that shape at
* runtime — the same schema this plugin shipped before the fork.
*/
const ConfigShape = z.object({
	enabled: z.boolean().default(true),
	allowAgentGeneration: z.boolean().default(true),
	announceToAgent: z.boolean().default(true),
	apiUrl: z.string().default(DEFAULT_API_URL),
	serviceUrl: z.string().default(DEFAULT_SERVICE_URL),
	apiKey: z.string().role("secret").default(""),
	models: z.array(modelSchema).default([]),
	defaultModel: z.string().default(""),
	defaultAspectRatio: z.string().default(DEFAULT_ASPECT_RATIO),
	outputFormat: z.string().default(DEFAULT_OUTPUT_FORMAT),
	dataDir: z.string().default("")
});
/**
* The plugin config schema the loader validates the profile entry with (also the
* settings card's field contract).
*
* The trailing `.volatile()` is what makes these fields editable at all from
* DSH 0.2 onwards: that host projects a settings form **out of this schema** and
* admits only fields under a volatile node, so a schema without one yields an
* empty form and every write is refused with "has no volatile fields". The same
* marker is also how the plugin receives its values — the loader swaps one live
* reference in place instead of re-applying the plugin, which is what
* {@link installSettingsSection} unwraps.
*
* On 0.1.x the marker is inert (that host has no schema-projected forms and the
* section registration below owns the values), so the same schema serves both.
*/
const Config$1 = ConfigShape.volatile();
/**
* Read the current value out of whatever the host handed over.
*
* DSH 0.2 and later resolve a volatile schema to one live reference and swap the
* value in place, so the reference itself is the freshest answer on every call.
* Older hosts and bare compositions pass a plain object.
*
* @param value - the resolved config, possibly wrapped in a volatile reference.
* @returns the plain config.
*/
function readConfig(value) {
	return isVolatile(value) ? value.get() : value;
}
/**
* Bind the plugin to its settings section.
*
* Two host generations, one read seam:
*
*  - A host exposing `installSection` (DSH 0.1.x) keeps the section as the
*    authoritative source and re-notifies the caller on every commit.
*  - A host without it (DSH 0.2 onwards, where forms are projected from the
*    profile entry's own Config) has nothing to register: the value arrives as
*    a live reference, and there is no change notification to subscribe to
*    because the reference never goes stale.
*
* Either way the returned thunk answers a plain `Config`, so callers below are
* independent of which generation is in force. The namespace registration is an
* effect on the calling fiber, so unloading the plugin removes both the section
* and its observers.
*
* @param ctx - host plugin context.
* @param entry - the composition entry used as the base layer and fallback.
* @param hooks - notified whenever the authoritative source or its value changes.
* @returns a thunk reading the currently authoritative raw value.
*/
function installSettingsSection(ctx, entry, hooks) {
	let current = () => readConfig(entry);
	ctx.inject(["settings"], (sctx) => {
		const provider = sctx.get("settings");
		if (provider === void 0 || typeof provider.installSection !== "function") return;
		provider.installSection(ctx, SeeWorkSettingsNamespace, Config$1, entry, {
			setSource: (source) => {
				current = () => readConfig(source());
				hooks.onChange();
			},
			onChange: hooks.onChange
		});
	});
	return () => current();
}
/**
* Apply schema defaults and normalize a raw config into the runtime view.
*
* Keys an older plugin version wrote and this one no longer stores are
* **deliberately not read** (#653 / #659 / #661 / #663): `defaultQuality` is not
* read (the plugin never decides a picture's quality), a per-model `qualities`
* list is not read either, and `orderedResolutions` / `resolutionOrderReliable`
* are gone with catalog v1 (the declared order now *is* the `resolutions` array,
* so keeping either would be a second truth). An old document keeps working with
* those keys simply ignored; the per-model residue rides out with the next
* whole-`models` write: `catalog-refresh.ts` triggers it when
* `capability.ts::hasRetiredModelKeys` reports a raw document that still carries
* them (the dep it is handed is `hasRetiredKeys`).
*
* The per-model shape itself is `capability.ts`'s business (#669): this module
* owns the document — the connection, the generation defaults, the data root —
* and hands the model list to {@link normalizeModels}.
*/
function effectiveConfig(value) {
	const source = value ?? {};
	const models = normalizeModels(source.models);
	const requestedDefault = typeof source.defaultModel === "string" ? source.defaultModel.trim() : "";
	return {
		enabled: source.enabled ?? true,
		allowAgentGeneration: source.allowAgentGeneration ?? true,
		announceToAgent: source.announceToAgent ?? true,
		apiUrl: typeof source.apiUrl === "string" && source.apiUrl.trim() !== "" ? source.apiUrl.trim() : DEFAULT_API_URL,
		serviceUrl: typeof source.serviceUrl === "string" && source.serviceUrl.trim() !== "" ? source.serviceUrl.trim() : DEFAULT_SERVICE_URL,
		apiKey: typeof source.apiKey === "string" ? source.apiKey.trim() : "",
		models,
		defaultModel: models.some((model) => model.id === requestedDefault) ? requestedDefault : models[0]?.id ?? "",
		defaultAspectRatio: typeof source.defaultAspectRatio === "string" && source.defaultAspectRatio.trim() !== "" ? source.defaultAspectRatio.trim() : DEFAULT_ASPECT_RATIO,
		outputFormat: typeof source.outputFormat === "string" && source.outputFormat.trim() !== "" ? source.outputFormat.trim() : DEFAULT_OUTPUT_FORMAT,
		dataDir: typeof source.dataDir === "string" ? source.dataDir.trim() : ""
	};
}
/** The model entry a request should use, or undefined when nothing matches. */
function resolveModel(config, requested) {
	const wanted = requested?.trim() ?? "";
	if (wanted !== "") {
		const exact = config.models.find((model) => model.id === wanted);
		if (exact !== void 0) return exact;
		const byLabel = config.models.find((model) => model.label === wanted);
		if (byLabel !== void 0) return byLabel;
	}
	if (config.defaultModel !== "") return config.models.find((model) => model.id === config.defaultModel);
	return config.models[0];
}
/** Human-readable model name (label when set, else the id). */
function modelName(model) {
	return model.label !== void 0 && model.label !== "" ? model.label : model.id;
}

//#endregion
//#region src/agent-tools.ts
/** How long one agent tool call may stay pending before it gives up waiting. */
const AGENT_WAIT_MS = 3e5;
/**
* Shape of one image reference on the tool boundary. The trailing fields are
* filled in on the way out (where the image lives in the material library) and
* merely tolerated on the way in: the model is told to hand a previous result
* back unchanged, so an object that still carries them must keep validating.
* `restoreRef` reads only the attachment fields and ignores the rest.
*/
const imageRefSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		attachment_id: {
			type: "string",
			required: true
		},
		media_type: {
			type: "string",
			required: true
		},
		bytes: {
			type: "integer",
			required: true
		},
		width: {
			type: "integer",
			required: true
		},
		height: {
			type: "integer",
			required: true
		},
		name: { type: "string" },
		file: { type: "string" },
		url: { type: "string" },
		path: { type: "string" },
		absolute_url: { type: "string" }
	}
};
const generationResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: {
			type: "string",
			required: true
		},
		message: {
			type: "string",
			required: true
		},
		error: { type: "string" },
		images: {
			type: "array",
			required: true,
			items: imageRefSchema
		},
		library_entry_id: { type: "string" }
	}
};
/**
* Wording for the tool's regular arguments (#658/D-10).
*
* One short sentence per argument: what it does and its default. Nothing about
* where a value comes from, what its cap is, or where to look it up — every
* earlier attempt to explain that grew into wording models misread as an
* instruction to manage queues and retries themselves.
*
* The defaults are interpolated from their owner in `src/settings.ts` rather
* than typed again.
*/
const SHARED_ARG_DESCRIPTION = {
	model: "Which saved model to use. Defaults to the default model.",
	n: "How many images this request returns. Default 1 — confirm with the user before requesting more.",
	resolution: "Resolution tier, e.g. 1K or 2K. Omit to use the default tier the catalog declares for this model.",
	aspect_ratio: `Aspect ratio: ${UNIFIED_ASPECT_RATIOS.join(", ")}. Default ${DEFAULT_ASPECT_RATIO}.`,
	output_format: `png, jpeg or webp. Default ${DEFAULT_OUTPUT_FORMAT}.`
};
/**
* The one tool's description: a single, self-contained statement (#664).
*
* It used to be a paragraph two tools shared word for word, with each tool
* adding its own first sentence (#658/D-9). Merging them into one tool removed
* that structure: editing is no longer a second tool, it is this tool **with**
* `reference_images`, so the sentence that says so lives here in the same
* paragraph rather than in a second description.
*
* The capability boundary is stated here as well as in the announcement (#659):
* this text is resident with the tool definition and is **not** governed by
* `announceToAgent`, so it is the only place the honest "these five arguments
* (plus the optional reference image list) and nothing else" survives once the
* user switches the announcement off.
*
* The **order to load the bundled skill** lives in the sentence before this
* block (#665): a skill is loaded on demand, so merely mentioning that the
* details are over there reads as an option the model may never take. The same
* order is in the announcement, with the same name — the requirement is stated
* once per carrier, and the tool's copy is the one that survives with the
* announcement off.
*/
const SHARED_TOOL_DESCRIPTION = "**One call is one generation request and returns synchronously** — there is no task id to poll. **Only one request per model runs at a time, and the plugin neither queues nor retries**: if this call fails, report it to the user and send another only after the user asks for it. **With `reference_images` this call edits those images; without it, it generates from the prompt alone** — the request carries no mode field of its own, so an absent or empty reference list simply means text-to-image. The result carries the image references plus the material-library entry id, and for each image where it lives: `file` (library file name), `url` (same-origin address), `path` (absolute path on this machine) and, when the GUI address is known, `absolute_url` (a fully qualified http URL). The model cannot see the picture itself — quote those fields when the user asks where an image is, and **show the finished picture in your own reply** with a markdown image (`![short description](absolute_url)`), because the images beside the tool call sit in the folded tool-call row while your reply does not.";
/**
* Wording for the optional `reference_images` argument (#664).
*
* This one argument is what makes the single tool both a generator and an
* editor: SeeAI Hub decides the mode from whether the reference list is
* non-empty (`docs/api/images.md`), so the wording has to carry both halves —
* omit it for text-to-image, hand a picture back unchanged to edit it. It is
* the wording the second tool used to carry, now on this argument.
*/
const REFERENCE_IMAGES_DESCRIPTION = "Optional. Reference image(s) for this call — a picture already available in this conversation (a user-uploaded attachment, or an image from an earlier SeeWork result). They may be the image being edited, or a reference for subject, style or composition. Omit it (or pass an empty list) and the call is plain text-to-image from `prompt`; pass one or more and the model works from them. Pass each attachment object exactly as you received it — do not reconstruct it.";
const NOT_CONFIGURED = "还没有配置 SeeAI Hub：请打开「设置 → 插件 → SeeWork」（侧边栏），填写 API 地址与用户 API Key，检测并保存图片模型。";
/** Throw the actionable failure for a not-yet-usable configuration. */
function ensureConfigured(config, options = {}) {
	if (!config.enabled) throw new SeeWorkError("SeeWork 插件已停用，请先在设置里启用。", "plugin-disabled");
	if (options.useAgent === true && !config.allowAgentGeneration) throw new SeeWorkError("Agent 生图已在设置里关闭。", "agent-generation-disabled");
	if (config.apiUrl.trim() === "" || config.apiKey.trim() === "") throw new SeeWorkError(NOT_CONFIGURED, "not-configured");
	if (config.models.length === 0) throw new SeeWorkError(`还没有可用的图片模型。${NOT_CONFIGURED}`, "no-models-configured");
}
/** Build the normalized request from the tool arguments. */
function toRequest(config, args, referenceUrls, refNames) {
	const model = resolveModel(config, args.model);
	if (model === void 0) throw new SeeWorkError(`没有可用的图片模型。可用模型：${config.models.map((entry) => `"${modelName(entry)}"`).join("、")}。`, "no-models-configured");
	const n = effectiveImageCount(args.n ?? 1, model.maxImages);
	return {
		mode: referenceUrls.length > 0 ? "edit" : "text",
		model: model.id,
		prompt: args.prompt.trim(),
		resolution: args.resolution?.trim() ?? "",
		aspectRatio: args.aspect_ratio?.trim() ?? "",
		outputFormat: args.output_format?.trim() ?? "",
		n,
		imageUrls: referenceUrls,
		...refNames.length === 0 ? {} : { refNames }
	};
}
/** Media types the attachment store accepts. */
function isImageMediaType(value) {
	return isImageMedia(value);
}
/** Restore a durable reference from the model-supplied argument. */
function restoreRef(value) {
	if (!isImageMediaType(value.media_type)) throw new SeeWorkError("reference_images[].media_type 不是受支持的图片类型。", "bad-reference-image");
	if (!Number.isInteger(value.bytes) || value.bytes < 1 || !Number.isInteger(value.width) || value.width < 1 || !Number.isInteger(value.height) || value.height < 1) throw new SeeWorkError("reference_images[] 的元数据不合法。", "bad-reference-image");
	return {
		attachmentId: value.attachment_id,
		mediaType: value.media_type,
		bytes: value.bytes,
		width: value.width,
		height: value.height,
		...value.name === void 0 ? {} : { name: value.name }
	};
}
/** Project a durable reference onto the tool-boundary shape. */
function projectRef(ref) {
	return {
		attachment_id: String(ref.attachmentId),
		media_type: ref.mediaType,
		bytes: ref.bytes,
		width: ref.width,
		height: ref.height,
		...ref.name === void 0 ? {} : { name: ref.name }
	};
}
/**
* Tell the model which arguments never reached the gateway.
*
* Silent dropping is the failure worth spending words on: the caller asked for
* something, a picture came back, and nothing said the request differed from
* what was asked for. The five regular parameters are the whole vocabulary now,
* so the only drop left is a value this model does not accept.
*/
function droppedNotice(dropped) {
	if (dropped === void 0 || dropped.length === 0) return "";
	return ` 有参数没有发给网关：${dropped.map((entry) => `${entry.field}（${entry.reason}）`).join("；")}。`;
}
/** The model-facing render: a compact textual status plus the JSON value. */
function renderResult(value) {
	return [{
		type: "text",
		text: JSON.stringify(value)
	}];
}
/**
* The GUI's own origin, used to hand the model a fully qualified image URL.
*
* The web server binds before this plugin's tools are ever called, so the port
* is the live one (including an OS-assigned port). A host that reports none
* leaves the absolute URL out rather than inventing an address — a wrong URL in
* a reply is worse than a relative one.
*
* @param ctx - the host context (its `webServer` service owns the port).
* @returns `http://127.0.0.1:<port>`, or undefined when no usable port is known.
*/
function guiOrigin(ctx) {
	const port = ctx.webServer?.port;
	return typeof port === "number" && Number.isSafeInteger(port) && port > 0 ? `http://127.0.0.1:${port}` : void 0;
}
/**
* Attach the library location to one result image.
*
* The model never receives the pixels, so these strings are the only way it can
* tell the user where a generated image actually is — and `absolute_url` is the
* one it can put into its own markdown reply. The paths come from
* `libraryImageLocation` — the same rule the library writer uses to place the
* file — so the reported location cannot drift from what landed on disk.
*
* @param entryId - the library entry this generation was stored as, if it was.
* @param image - the projected attachment reference.
* @param index - 0-based image position inside that entry.
* @param origin - the GUI origin, when known (see {@link guiOrigin}).
* @returns the image carrying the location fields, or unchanged without an entry.
*/
function withLibraryLocation(entryId, image, index, origin) {
	if (entryId === void 0) return image;
	const location = libraryImageLocation(entryId, index, image.media_type);
	return {
		...image,
		...location,
		...origin === void 0 ? {} : { absolute_url: `${origin}${location.url}` }
	};
}
/**
* The UI-only projection that keeps images beside the tool call. Returned as
* plain JSON records (the presentation contract forbids unknown class
* instances and React nodes).
*/
function presentationMeta(value) {
	return { images: value.images.map((image, index) => {
		const record = {
			attachment_id: image.attachment_id,
			media_type: image.media_type,
			bytes: image.bytes,
			width: image.width,
			height: image.height
		};
		if (image.name !== void 0) record.name = image.name;
		if (value.library_entry_id !== void 0) record.file = libraryImageLocation(value.library_entry_id, index, image.media_type).file;
		return record;
	}) };
}
/** Rehydrate image attachments for the host-computed tool result view. */
function presentResult(_args, result) {
	if (result.isError) return void 0;
	const meta = result.meta;
	if (typeof meta !== "object" || meta === null) return void 0;
	const images = meta.images;
	if (!Array.isArray(images)) return void 0;
	const content = [];
	for (const item of images) {
		if (typeof item !== "object" || item === null) continue;
		const raw = item;
		if (typeof raw.attachment_id !== "string" || typeof raw.media_type !== "string") continue;
		if (typeof raw.bytes !== "number" || typeof raw.width !== "number" || typeof raw.height !== "number") continue;
		try {
			content.push({
				type: "image",
				attachment: restoreRef({
					attachment_id: raw.attachment_id,
					media_type: raw.media_type,
					bytes: raw.bytes,
					width: raw.width,
					height: raw.height,
					...typeof raw.name === "string" ? { name: raw.name } : {}
				})
			});
		} catch {}
	}
	return content.length === 0 ? void 0 : {
		card: "generic",
		content
	};
}
/**
* Register the plugin's agent tool.
* @param ctx - host context providing `tools` and `attachments`.
* @param runtime - the shared generation queue.
* @param resolveConfig - reads the live settings per call.
* @returns disposer unregistering the tool.
*/
function registerAgentImageTools(ctx, runtime, resolveConfig) {
	/** Persist a task's images as durable attachments (memoized per task). */
	const attachmentCache = /* @__PURE__ */ new Map();
	/** Bound the cache: the runtime only retains a fixed number of tasks. */
	const ATTACHMENT_CACHE_MAX = 64;
	const materialize = (task) => {
		if (task.status !== "completed") return Promise.resolve([]);
		const cached = attachmentCache.get(task.id);
		if (cached !== void 0) return cached;
		const images = task.result?.images ?? [];
		const pending = ctx.attachments.saveImages(images.map((image, index) => ({
			data: Buffer.from(image.b64, "base64"),
			mediaType: isImageMediaType(image.mime) ? image.mime : "image/png",
			name: `seework-${task.id}-${index + 1}.${image.mime === "image/jpeg" ? "jpg" : image.mime.slice(6)}`
		}))).then((refs) => refs.map(projectRef));
		attachmentCache.set(task.id, pending);
		while (attachmentCache.size > ATTACHMENT_CACHE_MAX) {
			const oldest = attachmentCache.keys().next();
			if (oldest.done === true || oldest.value === task.id) break;
			attachmentCache.delete(oldest.value);
		}
		pending.catch(() => {
			if (attachmentCache.get(task.id) === pending) attachmentCache.delete(task.id);
		});
		return pending;
	};
	const toResult = async (task) => {
		const origin = guiOrigin(ctx);
		const images = (await materialize(task)).map((image, index) => withLibraryLocation(task.entryId, image, index, origin));
		const summary = task.status === "completed" ? origin === void 0 ? "生成完成：图片已存入素材库。这台宿主没有报出 GUI 端口，所以结果里没有 absolute_url——不要编一个地址，图片就在素材库里。" : "生成完成：图片已存入素材库，absolute_url 可直接放进回复正文。" : task.status === "failed" ? "生成失败。" : task.status === "cancelled" ? "生成已取消。" : "生成仍在进行中：这次调用等待超时了，但请求本身没有失败——图片生成完成后会自己进入素材库，在「素材库」里就能看到，不需要再查任务。";
		return {
			status: task.status,
			message: `${summary}${droppedNotice(task.droppedParameters)}`,
			...task.error === void 0 ? {} : { error: task.error },
			images,
			...task.entryId === void 0 ? {} : { library_entry_id: task.entryId }
		};
	};
	const waitFor = (id, signal) => {
		const timeout = AbortSignal.timeout(AGENT_WAIT_MS);
		return runtime.waitFor(id, AbortSignal.any([signal, timeout])).catch((error) => {
			if (timeout.aborted) {
				const task = runtime.get(id);
				if (task !== void 0) return task;
			}
			throw error;
		});
	};
	/** Turn durable references into the data URLs the gateway accepts. */
	const referenceUrls = async (refs, signal) => {
		const urls = [];
		const names = [];
		for (const ref of refs ?? []) {
			const stored = await ctx.attachments.readImage(restoreRef(ref), signal);
			urls.push(`data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString("base64")}`);
			names.push(stored.ref.name ?? `参考图 ${names.length + 1}`);
		}
		return {
			urls,
			names
		};
	};
	const disposers = [ctx.tools.register(defineTool({
		name: "generate_image",
		description: `Generate images with SeeAI Hub (SeeWork plugin). **Before generating or editing with this plugin, load the skill \`${SKILL_NAME}\` first.** ${SHARED_TOOL_DESCRIPTION}`,
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "Detailed image prompt: the picture to generate, or — with `reference_images` — what to change in them."
			},
			model: {
				type: "string",
				description: SHARED_ARG_DESCRIPTION.model
			},
			n: {
				type: "integer",
				description: SHARED_ARG_DESCRIPTION.n
			},
			resolution: {
				type: "string",
				description: SHARED_ARG_DESCRIPTION.resolution
			},
			aspect_ratio: {
				type: "string",
				description: SHARED_ARG_DESCRIPTION.aspect_ratio
			},
			output_format: {
				type: "string",
				description: SHARED_ARG_DESCRIPTION.output_format
			},
			reference_images: {
				type: "array",
				items: imageRefSchema,
				description: REFERENCE_IMAGES_DESCRIPTION
			}
		},
		output: {
			schema: generationResultSchema,
			render: (_args, value) => renderResult(value),
			presentationMeta: (_args, value) => presentationMeta(value)
		},
		presentResult,
		async execute(args, exec) {
			const config = resolveConfig();
			ensureConfigured(config, { useAgent: true });
			const input = args;
			const references = await referenceUrls(input.reference_images, exec.signal);
			return toResult(await waitFor(runtime.submit(toRequest(config, input, references.urls, references.names), "agent", exec.agent === void 0 ? void 0 : String(exec.agent.id)).id, exec.signal));
		}
	}))];
	return () => {
		for (const dispose of disposers) dispose();
	};
}

//#endregion
//#region src/catalog.ts
/** Timeout for one discovery round trip. */
const DISCOVERY_TIMEOUT_MS = 2e4;
/**
* Perform one JSON GET.
* @param timeoutMs - how long this request may take.
*/
async function getJson(url, apiKey, timeoutMs = DISCOVERY_TIMEOUT_MS) {
	const headers = { accept: "application/json" };
	if (apiKey.trim() !== "") headers.authorization = `Bearer ${apiKey.trim()}`;
	try {
		const response = await fetch(url, {
			headers,
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!response.ok) return {
			kind: "http",
			status: response.status
		};
		return {
			kind: "ok",
			payload: await response.json()
		};
	} catch {
		return {
			kind: "http",
			status: 0
		};
	}
}
/** Deduplicate models by id, keeping the first occurrence. */
function uniqueModels(models) {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const model of models) {
		if (seen.has(model.id)) continue;
		seen.add(model.id);
		out.push(model);
	}
	return out;
}
/** Read a catalog payload's `models` array, when it looks like one. */
function catalogEntries(payload) {
	if (typeof payload !== "object" || payload === null) return void 0;
	const list = payload.models;
	return Array.isArray(list) ? list : void 0;
}
/** Read an OpenAI `/models` payload's `data` array, when it looks like one. */
function modelEntries(payload) {
	if (typeof payload !== "object" || payload === null) return void 0;
	const list = payload.data;
	return Array.isArray(list) ? list : void 0;
}
/**
* Stamp a successful discovery with the time it happened.
*
* The stamp is what lets a dated surface say how fresh the saved snapshot is, and
* it is written **here** rather than when the user saves the selection: "when we
* last read the catalog" is the fact that matters, and a selection saved an hour
* after the probe must not look an hour fresher. A failed discovery throws
* before this runs, so the previous data keeps its old stamp — which is exactly
* the honest "this may be stale" signal.
*/
function stampDiscovery(models) {
	const discoveredAt = Date.now();
	return models.map((model) => ({
		...model,
		discoveredAt
	}));
}
/**
* Discover the image models a deployment offers.
* @param sources - the candidate addresses, most specific first.
* @returns the image models, which source answered, and every attempt made.
* @throws {SeeWorkError} when no source answered with a usable list at all.
*/
async function discoverModels(sources) {
	const attempts = [];
	const catalogHosts = [];
	if (sources.serviceUrl.trim() !== "") catalogHosts.push(catalogUrl(sources.serviceUrl));
	const fromGateway = catalogUrl(sources.apiUrl);
	if (!catalogHosts.includes(fromGateway)) catalogHosts.push(fromGateway);
	for (const url of catalogHosts) {
		const outcome = await getJson(url, sources.apiKey);
		if (outcome.kind === "http") {
			attempts.push({
				url,
				outcome: outcome.status === 0 ? "unreachable" : `http ${outcome.status}`,
				models: 0
			});
			continue;
		}
		const entries = catalogEntries(outcome.payload);
		if (entries === void 0) {
			attempts.push({
				url,
				outcome: "unusable",
				models: 0
			});
			continue;
		}
		const models = uniqueModels(entries.map((entry) => catalogEntryToModel(entry)).filter((model) => model !== void 0));
		attempts.push({
			url,
			outcome: "ok",
			models: models.length
		});
		if (models.length > 0 || entries.length > 0) return {
			models: stampDiscovery(models),
			origin: "catalog",
			catalogUrl: url,
			scanned: entries.length,
			attempts
		};
	}
	const modelsUrl = gatewayUrl(sources.apiUrl, "/models");
	const fallback = await getJson(modelsUrl, sources.apiKey);
	if (fallback.kind === "ok") {
		const entries = modelEntries(fallback.payload);
		if (entries !== void 0) {
			const models = uniqueModels(entries.map((entry) => openAiEntryToModel(entry)).filter((model) => model !== void 0));
			attempts.push({
				url: modelsUrl,
				outcome: "ok",
				models: models.length
			});
			return {
				models: stampDiscovery(models),
				origin: "models",
				catalogUrl: modelsUrl,
				scanned: entries.length,
				attempts
			};
		}
		attempts.push({
			url: modelsUrl,
			outcome: "unusable",
			models: 0
		});
	} else attempts.push({
		url: modelsUrl,
		outcome: fallback.status === 0 ? "unreachable" : `http ${fallback.status}`,
		models: 0
	});
	const detailed = attempts.map((attempt) => `${attempt.url} → ${attempt.outcome}`).join("；");
	const unreachable = attempts.every((attempt) => attempt.outcome === "unreachable");
	throw new SeeWorkError(unreachable ? `连接不上你填的地址。已尝试：${detailed}。请确认网关地址与目录（service）地址是否可达。` : `没有读到可用的模型清单。已尝试：${detailed}。`, unreachable ? "catalog_unreachable" : "catalog_failed", attempts);
}

//#endregion
//#region src/catalog-refresh.ts
/**
* How often the background refresh runs.
*
* A constant rather than a setting: the value only decides how stale a snapshot
* may get while nobody looks, and a knob for it would cost more (a field, a
* validation rule, a card control) than it explains. Six hours matches how often
* a deployment realistically changes its model catalog.
*/
const DEFAULT_REFRESH_INTERVAL_MS = 360 * 60 * 1e3;
/**
* How long two automatic rounds must be apart.
*
* Shared by the card-opening trigger and the background timer, so the two can
* never stack into duplicate requests (AC-2 / AC-9). The user's own
* 「检测可用模型」 is deliberately **not** throttled: it probes exactly what is on
* screen, and a silent no-op there would be a bug, not a saving.
*/
const AUTO_REFRESH_THROTTLE_MS = 60 * 1e3;
/** Build one refresher bound to a live settings view. */
function createCatalogRefresher(deps) {
	const now = deps.now ?? (() => Date.now());
	const discover = deps.discover ?? discoverModels;
	const setTimer = deps.setTimer ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
	const clearTimer = deps.clearTimer ?? ((handle) => {
		clearInterval(handle);
	});
	/** The last round that reached the network: what throttling compares against. */
	let lastAttemptAt;
	/** The last successful round's summary, returned to a throttled trigger. */
	let lastResult;
	let lastCatalog;
	/** The in-flight round, so a second trigger joins it instead of duplicating. */
	let inFlight;
	let backgroundStop;
	const skipped = (why) => ({
		ran: false,
		skipped: why,
		...lastResult === void 0 ? {} : { result: lastResult },
		...lastCatalog === void 0 ? {} : { catalog: lastCatalog }
	});
	const run = async () => {
		lastAttemptAt = now();
		try {
			const catalog = await discover(deps.sources());
			lastCatalog = catalog;
			const saved = deps.resolveModels();
			if (saved.length === 0) return skipped("not-configured");
			const next = adoptRefreshedCapabilities(saved, catalog.models);
			const cleanup = deps.hasRetiredKeys?.() === true;
			if (next.adopted.length > 0 || cleanup) await deps.mutate(next.models);
			lastResult = {
				refreshedAt: now(),
				adopted: next.adopted,
				added: next.added,
				missing: next.missing
			};
			return {
				ran: true,
				result: lastResult,
				catalog
			};
		} catch {
			return skipped("failed");
		}
	};
	const refresh = async (options = {}) => {
		if (deps.sources().apiKey.trim() === "" || deps.resolveModels().length === 0) return skipped("not-configured");
		const withinWindow = lastAttemptAt !== void 0 && now() - lastAttemptAt < AUTO_REFRESH_THROTTLE_MS;
		if (options.automatic !== false && withinWindow) return skipped("throttled");
		if (inFlight !== void 0) return inFlight;
		const pending = run();
		inFlight = pending;
		try {
			return await pending;
		} finally {
			if (inFlight === pending) inFlight = void 0;
		}
	};
	return {
		refresh,
		startBackground(intervalMs = DEFAULT_REFRESH_INTERVAL_MS) {
			backgroundStop?.();
			const handle = setTimer(() => {
				refresh({ automatic: true });
			}, intervalMs);
			const stop = () => {
				clearTimer(handle);
				if (backgroundStop === stop) backgroundStop = void 0;
			};
			backgroundStop = stop;
			return stop;
		}
	};
}

//#endregion
//#region src/model-summary.ts
/**
* The wording for a model whose entry declared no default tier.
*
* The contract always publishes `resolution.default`, so this state is a breach
* of that invariant rather than a normal kind of model: the plugin omits the
* field instead of guessing a tier (#663/P3), and the agent should ask the user
* to name one of the listed tiers. Kept as a constant because it is a *claim
* about the data*, not decoration.
*/
const RESOLUTION_DEFAULT_MISSING = "目录未提供缺省档，不指定时不发这一项";
/**
* The wording for a model the catalog never described (a bare `/models` entry,
* or a settings document written by hand).
*/
const DETAILS_UNKNOWN = "细节未知：这个模型不是从 SeeAI Hub 目录读到的（可能只来自裸 `/models` 列表），插件不知道它收哪些字段。只用工具 schema 里的常用参数，并按设置里的默认值来；不要猜扩展字段。";
/**
* Images one request may ask for.
*
* Both halves of the limit are shared rather than restated: the per-model cap is
* the catalog's `maxImages`, and the composition with the wire ceiling lives in
* `protocol.ts` — the same one the request side clamps `n` with (#668).
*/
function maxImagesPerRequest(model) {
	return imageCountCeiling(model.maxImages);
}
/**
* The tier clause of a capability line.
*
* The list is already in declared order, so the clause states it as a ranking
* and only adds a caveat when the model's contract declared no default tier (in
* which case a request that names no tier sends none at all).
*
* @param model - the configured model.
* @returns the clause; it never claims a ranking the list does not carry,
*   because a list that carries none is empty.
*/
function tierLine(model) {
	const tiers = model.resolutions;
	if (tiers.length === 0) return "档位由上游决定";
	const line = `档位 ${tiers.join("/")}（低到高）`;
	return defaultResolutionFor(model) === "" ? `${line}（${RESOLUTION_DEFAULT_MISSING}）` : line;
}
/**
* The one line the announcement shows for a model.
*
* @param model - the configured model.
* @returns tier order, ratios, reference-image cap and per-request image cap.
*/
function capabilityLineFor(model) {
	if (model.capabilitiesKnown !== true) return DETAILS_UNKNOWN;
	return [
		tierLine(model),
		model.aspectRatios.length > 0 ? `比例 ${model.aspectRatios.join("/")}` : "比例由上游决定",
		model.maxReferenceImages > 0 ? `可带参考图 ≤${model.maxReferenceImages}` : "仅文生图",
		`一次最多 ${maxImagesPerRequest(model)} 张`
	].join("，");
}
/** The model's identifier as the agent must spell it: `label[id]`, or the id. */
function modelIdentifier(model) {
	const name$1 = modelName(model);
	return name$1 === model.id ? model.id : `${name$1}[${model.id}]`;
}
/**
* Reduce one saved model to its identifier and capability line.
*
* @param model - the configured model.
* @returns the summary the model-facing surface renders.
*/
function summarizeModel(model) {
	return {
		id: model.id,
		identifier: modelIdentifier(model),
		known: model.capabilitiesKnown === true,
		capabilityLine: capabilityLineFor(model)
	};
}
/**
* Split the saved models the way the announcement needs them.
*
* The default model is the one a request falls back to ({@link EffectiveConfig}
* already resolved that), so "other models" means "every saved model except
* it".
*
* @param config - the live settings view.
* @returns the default summary, its position, and the others.
*/
function summarizeSavedModels(config) {
	const all = config.models.map((model) => summarizeModel(model));
	const found = all.findIndex((summary) => summary.id === config.defaultModel);
	const defaultIndex = found >= 0 ? found : all.length > 0 ? 0 : -1;
	return {
		defaultModel: defaultIndex >= 0 ? all[defaultIndex] : void 0,
		defaultIndex,
		others: all.filter((_summary, index) => index !== defaultIndex)
	};
}

//#endregion
//#region src/generation-runtime.ts
/** Task states that will not change again. */
function isFinalStatus(status) {
	return status === "completed" || status === "failed" || status === "cancelled";
}
/** The tail every per-model refusal shares, so the two wordings cannot drift. */
const BUSY_REFUSAL = "：本次没有发起生成，也没有扣费。请如实告知用户，得到许可后再发。";
/** Tasks kept in memory for status queries. */
const MAX_RETAINED_TASKS = 200;
/**
* The shared generation store: submit, watch, cancel.
*
* `submit` starts the task immediately or **refuses** (no queue, #658); callers
* that want the finished task await `waitFor`.
*/
var GenerationRuntime = class {
	records = /* @__PURE__ */ new Map();
	order = [];
	/** Models with a task in flight (see MAX_CONCURRENT_PER_MODEL). */
	runningModels = /* @__PURE__ */ new Set();
	constructor(resolveConfig) {
		this.resolveConfig = resolveConfig;
	}
	/** A snapshot of every retained task, newest first. */
	list() {
		return [...this.order].reverse().map((id) => this.records.get(id).task);
	}
	/** One task by id. */
	get(id) {
		return this.records.get(id)?.task;
	}
	/**
	* Start one generation.
	* @param request - the normalized request; its model must exist in the catalog.
	* @param source - who asked (library records carry this).
	* @param sessionId - owning agent session, when applicable.
	* @returns the task that just started.
	*/
	submit(request, source, sessionId) {
		const config = this.resolveConfig();
		const requested = request.model.trim();
		const model = resolveModel(config, requested);
		if (model === void 0 || requested !== "" && model.id !== requested) {
			const available = config.models.map((entry) => entry.id).join("、");
			throw new SeeWorkRuntimeError(requested === "" ? "还没有可用的模型：请在「设置 → 插件 → SeeWork」点击「检测可用模型」并保存。" : `模型「${requested}」不在已配置的清单里。可用模型：${available === "" ? "（没有）" : available}。`, requested === "" ? "no-models-configured" : "model-not-configured");
		}
		const { request: normalized, dropped } = resolveRequest({
			...request,
			model: model.id,
			prompt: request.prompt.trim()
		}, model, {
			outputFormat: config.outputFormat,
			aspectRatio: config.defaultAspectRatio
		});
		if (this.runningModels.has(model.id)) throw new SeeWorkRuntimeError(`模型「${model.id}」已有生成请求在跑${BUSY_REFUSAL}`, "model-busy");
		const id = randomUUID();
		const task = {
			id,
			request: normalized,
			status: "running",
			createdAt: Date.now(),
			startedAt: Date.now(),
			source,
			...sessionId === void 0 ? {} : { sessionId },
			...dropped.length === 0 ? {} : { droppedParameters: dropped }
		};
		const record = {
			task,
			controller: new AbortController(),
			waiters: /* @__PURE__ */ new Set()
		};
		this.records.set(id, record);
		this.order.push(id);
		this.trim();
		this.runningModels.add(model.id);
		this.run(record, model.id);
		return task;
	}
	/** Cancel a running task. */
	cancel(id) {
		const record = this.records.get(id);
		if (record === void 0) return void 0;
		if (isFinalStatus(record.task.status)) return record.task;
		record.controller.abort(/* @__PURE__ */ new Error("cancelled"));
		this.settle(record, {
			status: "cancelled",
			error: "生图已取消。"
		});
		return record.task;
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
	waitFor(id, signal) {
		const record = this.records.get(id);
		if (record === void 0) return Promise.reject(new SeeWorkRuntimeError(`找不到生图任务 ${id}。`, "task-not-found"));
		if (isFinalStatus(record.task.status)) return Promise.resolve(record.task);
		return new Promise((resolve, reject) => {
			let done = false;
			const finish = (task) => {
				if (done) return;
				done = true;
				signal?.removeEventListener("abort", onAbort);
				resolve(task);
			};
			const onAbort = () => {
				if (done) return;
				done = true;
				record.waiters.delete(finish);
				reject(new SeeWorkRuntimeError("等待生图结果已中断（任务仍在继续）。", "wait-aborted"));
			};
			record.waiters.add(finish);
			if (signal?.aborted === true) {
				onAbort();
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}
	/** Execute one task end to end and settle it. */
	async run(record, model) {
		const config = this.resolveConfig();
		try {
			const result = await generateImage({
				apiUrl: config.apiUrl,
				apiKey: config.apiKey
			}, record.task.request, { signal: record.controller.signal });
			const entry = await appendLibraryEntry({
				request: record.task.request,
				images: result.images,
				...result.cost === void 0 ? {} : { cost: result.cost },
				source: record.task.source,
				...record.task.sessionId === void 0 ? {} : { sessionId: record.task.sessionId }
			});
			const settled = result;
			this.settle(record, {
				status: "completed",
				result: settled,
				entryId: entry.id
			});
		} catch (error) {
			if (record.controller.signal.aborted) {
				this.settle(record, {
					status: "cancelled",
					error: "生图已取消。"
				});
				return;
			}
			this.settle(record, {
				status: "failed",
				error: error instanceof Error ? error.message : String(error)
			});
		} finally {
			this.runningModels.delete(model);
		}
	}
	/** Move a task to its final state and wake everyone waiting on it. */
	settle(record, outcome) {
		record.task = {
			...record.task,
			status: outcome.status,
			finishedAt: Date.now(),
			...outcome.result === void 0 ? {} : { result: outcome.result },
			...outcome.entryId === void 0 ? {} : { entryId: outcome.entryId },
			...outcome.error === void 0 ? {} : { error: outcome.error }
		};
		this.records.set(record.task.id, record);
		for (const waiter of [...record.waiters]) {
			record.waiters.delete(waiter);
			waiter(record.task);
		}
	}
	/** Drop the oldest settled tasks once the retention cap is exceeded. */
	trim() {
		while (this.order.length > MAX_RETAINED_TASKS) {
			const id = this.order[0];
			const record = this.records.get(id);
			if (record !== void 0 && !isFinalStatus(record.task.status)) break;
			this.order.shift();
			this.records.delete(id);
		}
	}
};
/** A runtime failure with a stable machine code. */
var SeeWorkRuntimeError = class extends Error {
	constructor(message, code) {
		super(message);
		this.code = code;
		this.name = "SeeWorkRuntimeError";
	}
};

//#endregion
//#region src/canvas-assets.ts
/** Ceiling on one uploaded asset (a burned annotation of a 4K picture fits). */
const MAX_CANVAS_ASSET_BYTES = 32 * 1024 * 1024;
/** The file-name shape both stores share (also the board's validation rule). */
const CANVAS_FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*-[0-9]+\.(png|jpg|jpeg|webp|gif)$/;
/** Where canvas-owned assets live: `<data root>/canvas/assets`. */
function canvasAssetsDir() {
	return path.join(libraryDataRoot(), "canvas", "assets");
}
/** One asset's file name, matching the board's validation shape. */
function assetFileName(id, index, mime) {
	return `${id}-${index}.${extensionOf(mime)}`;
}
/** Media type of one stored asset, from its extension. */
function mimeOfAsset(file) {
	if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
	if (file.endsWith(".webp")) return "image/webp";
	if (file.endsWith(".gif")) return "image/gif";
	return "image/png";
}
/** Parse a `data:image/...;base64,...` URL. */
function parseImageDataUrl(value) {
	const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/u.exec(value.trim());
	if (match === null || match[1] === void 0 || match[2] === void 0) return void 0;
	const data = Buffer.from(match[2], "base64");
	if (data.byteLength === 0 || data.byteLength > MAX_CANVAS_ASSET_BYTES) return void 0;
	return {
		mime: match[1],
		data
	};
}
/**
* Write one canvas asset and report where it landed.
*
* @param input - the image as a data URL.
* @returns the file name and its served URL, or undefined when the payload is
*   not an acceptable image (the route answers 400 then, never a partial write).
*/
async function writeCanvasAsset(input) {
	const parsed = parseImageDataUrl(input.dataUrl);
	if (parsed === void 0) return void 0;
	await promises.mkdir(canvasAssetsDir(), { recursive: true });
	const file = assetFileName(randomUUID(), 0, parsed.mime);
	await promises.writeFile(path.join(canvasAssetsDir(), file), parsed.data);
	const size = imageSize(parsed.data);
	return {
		file,
		url: `${CANVAS_API.asset}/${file}`,
		mime: parsed.mime,
		...size === void 0 ? {} : {
			width: size.width,
			height: size.height
		}
	};
}
/**
* Read one canvas asset back.
*
* The name shape is re-checked here as well as in the card validator: this is the
* only place a name becomes a filesystem path, so it is the place that has to be
* sure the name cannot escape the directory.
*
* @param file - the asset's file name.
* @returns the bytes and their media type, or undefined when it is not there.
*/
async function readCanvasAsset(file) {
	if (!CANVAS_FILE_PATTERN.test(file)) return void 0;
	try {
		return {
			mime: mimeOfAsset(file),
			data: await promises.readFile(path.join(canvasAssetsDir(), file))
		};
	} catch {
		return;
	}
}
/**
* Every canvas-owned picture on disk, whatever references it.
*
* Names that do not match the shape are skipped rather than reported: the store
* only ever writes that shape, so anything else was not put there by the plugin
* and is none of its business to delete.
*
* @returns the files, sorted by name.
*/
async function listCanvasAssetFiles() {
	let names = [];
	try {
		names = await promises.readdir(canvasAssetsDir());
	} catch {
		return [];
	}
	const files = [];
	for (const name$1 of names) {
		if (!CANVAS_FILE_PATTERN.test(name$1)) continue;
		try {
			const stat = await promises.stat(path.join(canvasAssetsDir(), name$1));
			if (stat.isFile()) files.push({
				file: name$1,
				bytes: stat.size
			});
		} catch {}
	}
	files.sort((left, right) => left.file.localeCompare(right.file));
	return files;
}
/**
* Delete canvas-owned pictures by name.
*
* Unsafe or unknown names are ignored instead of throwing: this runs after the
* board stopped referencing them, and a file that is already gone is the outcome
* the caller wanted.
*
* @param files - the file names to delete.
* @returns how many files went away and how many bytes that freed.
*/
async function deleteCanvasAssets(files) {
	let removed = 0;
	let bytes = 0;
	for (const file of files) {
		if (!CANVAS_FILE_PATTERN.test(file)) continue;
		const target = path.join(canvasAssetsDir(), file);
		try {
			const stat = await promises.stat(target);
			if (!stat.isFile()) continue;
			await promises.rm(target);
			removed += 1;
			bytes += stat.size;
		} catch {}
	}
	return {
		removed,
		bytes
	};
}

//#endregion
//#region src/directory-picker.ts
/** The service behind an unknown value, when it looks like the seam. */
function serviceOf(value) {
	if (value === null || typeof value !== "object") return void 0;
	const candidate = value;
	return typeof candidate.capability === "function" ? candidate : void 0;
}
/** The capability object, or undefined when the service refuses to describe itself. */
function capabilityOf(service) {
	try {
		const capability = service.capability();
		return capability !== null && typeof capability === "object" ? capability : void 0;
	} catch {
		return;
	}
}
/**
* How the host can choose a directory, without opening anything.
* @param value - the `ctx.directoryPicker` service, or anything else.
* @returns the capability kind plus an operator-facing note when it is not native.
*/
function directoryPickerStatus(value) {
	const service = serviceOf(value);
	if (service === void 0) return {
		kind: "none",
		message: "这台宿主没有挂载目录选择器，改不了素材目录（可以在插件设置文档里改 dataDir）。"
	};
	const capability = capabilityOf(service);
	if (capability?.kind === "native") return { kind: "native" };
	if (capability?.kind === "browse") return {
		kind: "browse",
		message: "这台宿主用的是网页版目录浏览（通常是远程或 SSH 场景），打不开系统窗口；可以在插件设置文档里改 dataDir。"
	};
	return {
		kind: "none",
		message: "宿主的目录选择器打不开系统窗口，可以在插件设置文档里改 dataDir。"
	};
}
/**
* Open the host's folder chooser and wait for the operator.
*
* @param value - the `ctx.directoryPicker` service.
* @param signal - caller lifetime; aborting terminates the chooser (so a closed
*   page never leaves a stray dialog on someone's screen).
* @returns the chosen absolute path, a cancellation, or why it could not run.
*/
async function pickDirectory(value, signal) {
	const service = serviceOf(value);
	const status = directoryPickerStatus(value);
	if (service === void 0 || status.kind !== "native") return {
		kind: "failed",
		code: `picker_${status.kind}`,
		message: status.message ?? "打不开目录选择窗口。"
	};
	const capability = capabilityOf(service);
	if (capability === void 0 || typeof capability.pick !== "function") return {
		kind: "failed",
		code: "picker_unusable",
		message: "宿主的目录选择器不可用。"
	};
	try {
		const chosen = await capability.pick(signal);
		if (typeof chosen !== "string" || chosen.trim() === "") return { kind: "cancelled" };
		const path$1 = chosen.trim();
		if (!isAbsolute(path$1)) return {
			kind: "failed",
			code: "picker_relative",
			message: `宿主返回的路径不是绝对路径：${path$1}`
		};
		return {
			kind: "picked",
			path: path$1
		};
	} catch (error) {
		if (signal.aborted) return {
			kind: "failed",
			code: "picker_aborted",
			message: "选择目录被中断。"
		};
		return {
			kind: "failed",
			code: "picker_failed",
			message: error instanceof Error ? error.message : "打开目录选择窗口失败。"
		};
	}
}

//#endregion
//#region src/canvas-limits.ts
/**
* Canvas limits shared by both halves.
*
* These live in their own module — with no imports at all — because the client
* bundle and the host store must agree on them, while the host store is full of
* Node built-ins. Importing a constant from `canvas-store.ts` into browser code
* drags `node:crypto` and friends into the bundle, where the module loader
* cannot resolve them and the whole client half fails to load. Keeping the
* constants dependency-free is what makes the shared use safe.
*/
/** Zoom range for a board. */
const CANVAS_ZOOM_MIN = .1;
const CANVAS_ZOOM_MAX = 5;
/** Cards allowed on one board. */
const CANVAS_MAX_CARDS = 500;
/** Boards kept before the oldest is dropped (with its file). */
const CANVAS_MAX_BOARDS = 200;

//#endregion
//#region src/canvas-store.ts
/** Board coordinate range accepted from a client (keeps NaN/Infinity out). */
const CANVAS_COORD_LIMIT = 1e6;
/** Card size range in board pixels. */
const CANVAS_CARD_MIN = 24;
const CANVAS_CARD_MAX = 1e4;
/** A save refused because the board moved since the caller read it. */
var CanvasConflictError = class extends Error {
	constructor(expected, actual) {
		super(`画布已被其它窗口修改（期望版本 ${expected}，当前 ${actual}）。`);
		this.expected = expected;
		this.actual = actual;
		this.name = "CanvasConflictError";
	}
};
/** A save or read refused because the input is unusable. */
var CanvasInputError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "CanvasInputError";
	}
};
/** The directory boards live in (resolved per call, so a settings change applies). */
function canvasDir() {
	return path.join(libraryDataRoot(), "canvas");
}
/** File name of one board, from its id. */
function boardPath(id) {
	return path.join(canvasDir(), `${id}.json`);
}
/** Whether an id names a board the store could have written. */
function isCanvasId(id) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}
/** Clamp a number into a range, rejecting non-finite input. */
function finite(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
/** Clamp a viewport into the supported zoom range and coordinate space. */
function normalizeViewport(value) {
	const raw = typeof value === "object" && value !== null ? value : {};
	const k = Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, finite(raw.k, 1)));
	return {
		x: Math.min(CANVAS_COORD_LIMIT, Math.max(-CANVAS_COORD_LIMIT, finite(raw.x, 0))),
		y: Math.min(CANVAS_COORD_LIMIT, Math.max(-CANVAS_COORD_LIMIT, finite(raw.y, 0))),
		k: Math.round(k * 1e3) / 1e3
	};
}
/**
* Normalize one card, or drop it when it is unusable.
*
* A dropped card is the right failure mode for a board: a malformed card should
* cost the user one card, not the whole document.
*/
function normalizeCard(value) {
	if (value === null || typeof value !== "object") return void 0;
	const raw = value;
	const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : void 0;
	if (id === void 0) return void 0;
	const kind = raw.kind === "text" ? "text" : raw.kind === "image" ? "image" : void 0;
	if (kind === void 0) return void 0;
	const size = (input, fallback) => Math.min(CANVAS_CARD_MAX, Math.max(CANVAS_CARD_MIN, finite(input, fallback)));
	const card = {
		id,
		kind,
		x: Math.min(CANVAS_COORD_LIMIT, Math.max(-CANVAS_COORD_LIMIT, finite(raw.x, 0))),
		y: Math.min(CANVAS_COORD_LIMIT, Math.max(-CANVAS_COORD_LIMIT, finite(raw.y, 0))),
		width: size(raw.width, kind === "image" ? 320 : 240),
		height: size(raw.height, kind === "image" ? 320 : 120),
		z: finite(raw.z, 0)
	};
	if (kind === "image") {
		if (typeof raw.file !== "string" || raw.file === "") return void 0;
		if (!CANVAS_FILE_PATTERN.test(raw.file)) throw new CanvasInputError(`画布引用了非法的图片文件名：${raw.file}`);
		card.file = raw.file;
		card.source = raw.source === "canvas" ? "canvas" : "library";
		card.origin = raw.origin === "chat" || raw.origin === "panel" || raw.origin === "annotation" || raw.origin === "crop" ? raw.origin : void 0;
		if (typeof raw.model === "string") card.model = raw.model.slice(0, 200);
		if (typeof raw.prompt === "string") card.prompt = raw.prompt.slice(0, 4e3);
	} else {
		card.text = typeof raw.text === "string" ? raw.text.slice(0, 8e3) : "";
		card.fontSize = Math.min(96, Math.max(8, finite(raw.fontSize, 16)));
	}
	return card;
}
/** Build a document from untrusted input (a client save). */
function normalizeDocument(value, previous) {
	if (value === null || typeof value !== "object") throw new CanvasInputError("画布数据不是对象。");
	const raw = value;
	const rawCards = Array.isArray(raw.cards) ? raw.cards : [];
	if (rawCards.length > CANVAS_MAX_CARDS) throw new CanvasInputError(`画布最多支持 ${CANVAS_MAX_CARDS} 个卡片。`);
	const cards = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of rawCards) {
		const card = normalizeCard(entry);
		if (card === void 0 || seen.has(card.id)) continue;
		seen.add(card.id);
		cards.push(card);
	}
	const title = typeof raw.title === "string" && raw.title.trim() !== "" ? raw.title.trim().slice(0, 120) : previous.title;
	return {
		id: previous.id,
		title,
		revision: previous.revision,
		viewport: normalizeViewport(raw.viewport),
		cards,
		createdAt: previous.createdAt,
		updatedAt: previous.updatedAt
	};
}
/** Project a document onto the list shape. */
function toSummary(document) {
	return {
		id: document.id,
		title: document.title,
		revision: document.revision,
		cardCount: document.cards.length,
		createdAt: document.createdAt,
		updatedAt: document.updatedAt
	};
}
/** Structural check for a document read back from disk. */
function isDocument(value) {
	if (value === null || typeof value !== "object") return false;
	const raw = value;
	return typeof raw.id === "string" && typeof raw.title === "string" && typeof raw.revision === "number" && Array.isArray(raw.cards) && typeof raw.createdAt === "number" && typeof raw.updatedAt === "number";
}
/** Read one board file, tolerating a missing or corrupt document. */
async function readDocument(id) {
	if (!isCanvasId(id)) return void 0;
	try {
		const parsed = JSON.parse(await promises.readFile(boardPath(id), "utf8"));
		if (!isDocument(parsed)) return void 0;
		return {
			...normalizeDocument(parsed, parsed),
			id: parsed.id,
			revision: parsed.revision,
			createdAt: parsed.createdAt,
			updatedAt: parsed.updatedAt
		};
	} catch {
		return;
	}
}
/** Write one document atomically. */
async function writeDocument(document) {
	await promises.mkdir(canvasDir(), { recursive: true });
	const target = boardPath(document.id);
	const tmp = `${target}.tmp-${process.pid}`;
	await promises.writeFile(tmp, JSON.stringify(document, null, 2), "utf8");
	await promises.rename(tmp, target);
}
/**
* Every canvas-owned picture that some board still shows.
*
* Used by the housekeeping routes: a picture is only deletable once no board
* references it, so deleting a card and pruning the file behind it can never pull
* a picture out from under a second board.
*
* @returns the set of referenced file names.
*/
async function referencedCanvasFiles() {
	const files = /* @__PURE__ */ new Set();
	let names = [];
	try {
		names = await promises.readdir(canvasDir());
	} catch {
		return files;
	}
	for (const name$1 of names) {
		if (!name$1.endsWith(".json")) continue;
		const document = await readDocument(name$1.slice(0, -5));
		if (document === void 0) continue;
		for (const card of document.cards) if (card.source === "canvas" && card.file !== void 0) files.add(card.file);
	}
	return files;
}
/** Every board on disk, newest first. */
async function listCanvases() {
	let names = [];
	try {
		names = await promises.readdir(canvasDir());
	} catch {
		names = [];
	}
	const summaries = [];
	for (const name$1 of names) {
		if (!name$1.endsWith(".json")) continue;
		const document = await readDocument(name$1.slice(0, -5));
		if (document !== void 0) summaries.push(toSummary(document));
	}
	summaries.sort((left, right) => right.updatedAt - left.updatedAt);
	return {
		canvases: summaries.slice(0, CANVAS_MAX_BOARDS),
		dataRoot: libraryDataRoot()
	};
}
/** Create an empty board. */
async function createCanvas(title) {
	const now = Date.now();
	const document = {
		id: randomUUID(),
		title: title !== void 0 && title.trim() !== "" ? title.trim().slice(0, 120) : "未命名画布",
		revision: 1,
		viewport: {
			x: 0,
			y: 0,
			k: 1
		},
		cards: [],
		createdAt: now,
		updatedAt: now
	};
	await writeDocument(document);
	await trimBoards();
	return document;
}
/** Read one board. */
async function readCanvas(id) {
	return readDocument(id);
}
/**
* Save a board.
* @param incoming - the client's document (its `revision` is ignored).
* @param expectedRevision - the revision the client read; a mismatch refuses.
* @returns the stored document (with the next revision).
* @throws {CanvasConflictError} when the board moved on since the client read it.
*/
async function saveCanvas(incoming, expectedRevision) {
	const raw = incoming !== null && typeof incoming === "object" ? incoming : {};
	const id = typeof raw.id === "string" ? raw.id : "";
	if (!isCanvasId(id)) throw new CanvasInputError("画布 id 不合法。");
	const previous = await readDocument(id);
	if (previous === void 0) throw new CanvasInputError("画布不存在。");
	if (previous.revision !== expectedRevision) throw new CanvasConflictError(expectedRevision, previous.revision);
	const stored = {
		...normalizeDocument(raw, previous),
		revision: previous.revision + 1,
		updatedAt: Date.now()
	};
	await writeDocument(stored);
	return stored;
}
/** Delete one board. */
async function removeCanvas(id) {
	if (!isCanvasId(id)) throw new CanvasInputError("画布 id 不合法。");
	try {
		await promises.rm(boardPath(id), { force: true });
	} catch {}
	return listCanvases();
}
/** Drop the oldest boards past the retention cap. */
async function trimBoards() {
	const { canvases } = await listCanvases();
	if (canvases.length <= CANVAS_MAX_BOARDS) return;
	for (const stale of canvases.slice(CANVAS_MAX_BOARDS)) try {
		await promises.rm(boardPath(stale.id), { force: true });
	} catch {}
}

//#endregion
//#region src/version.ts
/**
* Parse `major.minor.patch[-prerelease][+build]`.
* @param value - the version text.
* @returns the parts, or undefined when the text is not that shape.
*/
function parseVersion(value) {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
	if (match === null) return void 0;
	const prerelease = match[4];
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: prerelease === void 0 || prerelease === "" ? [] : prerelease.split(".")
	};
}
/** Compare two prerelease identifier lists by semver's precedence rules. */
function comparePrerelease(left, right) {
	if (left.length === 0 || right.length === 0) return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const a = left[index];
		const b = right[index];
		if (a === void 0) return -1;
		if (b === void 0) return 1;
		const numericA = /^\d+$/.test(a);
		const numericB = /^\d+$/.test(b);
		if (numericA && numericB) {
			const delta = Number(a) - Number(b);
			if (delta !== 0) return delta < 0 ? -1 : 1;
			continue;
		}
		if (numericA !== numericB) return numericA ? -1 : 1;
		if (a !== b) return a < b ? -1 : 1;
	}
	return 0;
}
/**
* Compare two version strings.
*
* @param left - the version on the left.
* @param right - the version on the right.
* @returns negative when `left` precedes `right`, 0 when equal, positive when it follows.
* @throws when either side is not a version. A registry answer nobody can parse
*   must not read as "up to date", which is what a silent 0 would report.
*/
function compareVersions(left, right) {
	const a = parseVersion(left);
	const b = parseVersion(right);
	if (a === void 0 || b === void 0) throw new TypeError(`not a version: ${a === void 0 ? left : right}`);
	if (a.major !== b.major) return a.major < b.major ? -1 : 1;
	if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
	if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
	return comparePrerelease(a.prerelease, b.prerelease);
}
/**
* Whether `candidate` is strictly newer than `current`.
* @param candidate - the version offered.
* @param current - the version in hand.
* @returns true when an update is worth offering.
*/
function isNewer(candidate, current) {
	return compareVersions(candidate, current) > 0;
}

//#endregion
//#region src/update.ts
/** The package name this plugin is published under. */
const PACKAGE_NAME = "dsh-seework";
/** Where to ask when the host names no registry. */
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
/** The spec an update installs. */
const UPDATE_SPEC = `${PACKAGE_NAME}@latest`;
/**
* Read this plugin's own version from the manifest shipped beside the bundle.
* @param manifestUrl - the manifest location; defaults to the packaged one.
* @returns the version string.
* @throws when the manifest cannot be read or carries no version.
*/
function readOwnVersion(manifestUrl = new URL("../package.json", import.meta.url).href) {
	const version = JSON.parse(readFileSync(fileURLToPath(manifestUrl), "utf8")).version;
	if (typeof version !== "string" || version === "") throw new Error("dsh-seework: the packaged manifest carries no version");
	return version;
}
/**
* The profile directory this copy was installed into.
*
* Derived from this module's own location rather than read from a service: the
* bundle always sits at `<profile>/node_modules/dsh-seework/lib/`, so three
* levels up is the profile. A host that installs the plugin some other way
* yields a directory whose manifest does not name this package, which
* {@link readInstallKind} reports as `unknown` — no worse than not knowing.
*
* @param bundleUrl - this module's URL; defaults to its real one.
* @returns the profile directory path.
*/
function profileDirectory(bundleUrl = import.meta.url) {
	return fileURLToPath(new URL("../../../", bundleUrl));
}
/**
* How this copy reached the profile, read from the profile's own manifest.
*
* The distinction is load-bearing, not cosmetic: `pnpm sync` overwrites the
* installed copy in place, and the next pnpm operation restores it from the
* declared source. A `file:` install therefore belongs to the build-and-sync
* loop, and offering it a registry update would silently move the user off that
* loop.
*
* @param profileDir - the profile directory.
* @param packageName - the dependency name to look up.
* @returns the install kind, or `unknown` when the manifest cannot answer.
*/
function readInstallKind(profileDir, packageName = PACKAGE_NAME) {
	try {
		const spec = JSON.parse(readFileSync(`${profileDir}/package.json`, "utf8")).dependencies?.[packageName];
		if (typeof spec !== "string") return "unknown";
		return spec.startsWith("file:") ? "local" : "registry";
	} catch {
		return "unknown";
	}
}
/**
* The registry to ask, out of the host's configuration.
*
* `resolved` is what pnpm itself reads now; `registry` is the configured one,
* and `null` there means "pnpm's own configuration decides" — in which case the
* public registry is the honest guess rather than an error.
*
* @param registries - the host's answer.
* @returns a registry base URL.
*/
function registryOf(registries) {
	return registries.resolved ?? registries.registry ?? DEFAULT_REGISTRY;
}
/**
* Add one exact version to the profile's release-age exemptions.
*
* pnpm 11 refuses to install a version published less than `minimumReleaseAge`
* ago — 1440 minutes by default — and records the versions it *has* accepted in
* `minimumReleaseAgeExclude`. That is why an installed version can be
* reinstalled while the next one cannot be installed at all.
*
* Writing the version the user just asked for into that same list is the
* narrowest exemption available: one package, one version, chosen by the person
* who pressed the button. Nothing else in the profile is relaxed, and the next
* release has to earn its own exemption.
*
* @param profileDir - the profile directory holding `pnpm-workspace.yaml`.
* @param packageName - the package to exempt.
* @param version - the exact version to exempt.
* @returns whether the file was changed.
*/
async function exemptVersion(profileDir, packageName, version) {
	const file = `${profileDir}/pnpm-workspace.yaml`;
	let text;
	try {
		text = await readFile(file, "utf8");
	} catch {
		return false;
	}
	const bullet = `  - ${`${packageName}@${version}`}`;
	if (text.split("\n").some((line) => line.trimEnd() === bullet)) return false;
	const header = "minimumReleaseAgeExclude:";
	await writeFile(file, text.includes(header) ? text.replace(header, `${header}\n${bullet}`) : `${text.replace(/\s*$/, "")}\n\n${header}\n${bullet}\n`, "utf8");
	return true;
}
/**
* Read the newest published version out of a registry's `latest` document.
*
* `/<name>/latest` is the one endpoint that answers "what is the newest
* release" without pulling the whole packument, and it is what `npm view
* <name> version` reads.
*
* @param query - the registry, the package, and an optional fetch stub.
* @returns the version string.
* @throws when the registry refuses, answers with a non-JSON body, or carries no
*   version — each of which must surface as an error rather than as "up to date".
*/
async function latestVersionFrom(query) {
	const base = query.registry.replace(/\/+$/, "");
	const path$1 = query.packageName.replace("/", "%2F");
	const response = await (query.fetchFn ?? fetch)(`${base}/${path$1}/latest`, { headers: { accept: "application/json" } });
	if (!response.ok) throw new Error(`注册表返回 HTTP ${response.status}`);
	const version = (await response.json()).version;
	if (typeof version !== "string" || version === "") throw new Error("注册表返回的文档里没有版本号");
	return version;
}
/**
* Ask the registry what the newest version is, and compare it with ours.
*
* Never throws: the settings card has to keep rendering when the registry is
* unreachable, when the host has no plugin manager, and when this is a local
* install that has no update to offer.
*
* @param deps - the host seam, the running version, how it was installed, and an
*   optional fetch stub.
* @returns the status the card renders.
*/
async function checkForUpdate(deps) {
	const base = {
		current: deps.current,
		kind: deps.kind,
		updateAvailable: false
	};
	if (deps.kind === "local") return base;
	if (deps.host === void 0) return {
		...base,
		error: "宿主没有提供插件管理服务。"
	};
	try {
		const latest = await latestVersionFrom({
			registry: registryOf(await deps.host.registries()),
			packageName: PACKAGE_NAME,
			...deps.fetchFn === void 0 ? {} : { fetchFn: deps.fetchFn }
		});
		return {
			...base,
			latest,
			updateAvailable: isNewer(latest, deps.current)
		};
	} catch (error) {
		return {
			...base,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

//#endregion
//#region src/routes.ts
/** Cap on JSON request bodies (edit requests carry data-URL reference images). */
const MAX_JSON_BODY_BYTES = 48 * 1024 * 1024;
/** How long a synchronous generate call waits before handing back a task id. */
const SYNC_WAIT_MS = 3e5;
/** Loopback literal check plus browser same-origin markers. */
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
/** One JSON response. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
		"cache-control": "no-store"
	});
	res.end(payload);
}
/** One success envelope. */
function ok(res, value) {
	writeJson(res, 200, {
		ok: true,
		value
	});
}
/** One failure envelope (stable `code` + human `message`). */
function fail(res, status, code, message) {
	writeJson(res, status, {
		ok: false,
		code,
		message
	});
}
/** Read a bounded JSON request body. */
async function readJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.byteLength;
		if (total > maxBytes) return void 0;
		chunks.push(buffer);
	}
	if (total === 0) return {};
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
	} catch {
		return;
	}
}
/** Serialize one descriptor into the bridge wire shape (secrets redacted). */
function toView(descriptor$1) {
	return {
		ns: descriptor$1.ns,
		schema: descriptor$1.schema,
		value: descriptor$1.value,
		revision: descriptor$1.revision,
		...descriptor$1.base === void 0 ? {} : { base: descriptor$1.base },
		...descriptor$1.user === void 0 ? {} : { user: descriptor$1.user },
		secrets: (descriptor$1.secrets ?? []).map((secret) => ({
			path: [...secret.path],
			set: secret.set
		}))
	};
}
/** Turn a thrown value into the bridge failure envelope. */
function failureOf(error) {
	if (error instanceof SettingsConflictError) return {
		status: 409,
		code: "conflict",
		message: `设置已被其它位置修改（期望版本 ${error.expected}，当前 ${error.actual}），请重试。`
	};
	if (error instanceof CanvasConflictError) return {
		status: 409,
		code: "canvas_conflict",
		message: error.message
	};
	if (error instanceof CanvasInputError) return {
		status: 400,
		code: "canvas_invalid",
		message: error.message
	};
	if (error instanceof SeeWorkError || error instanceof SeeWorkRuntimeError) return {
		status: 400,
		code: error.code,
		message: error.message
	};
	return {
		status: 500,
		code: "internal",
		message: error instanceof Error ? error.message : String(error)
	};
}
/** Validate and normalize a generate request body. */
function parseGenerateRequest(body) {
	const prompt = typeof body.prompt === "string" ? body.prompt : "";
	const model = typeof body.model === "string" ? body.model : "";
	if (prompt.trim() === "" || model.trim() === "") return void 0;
	const mode = body.mode === "edit" ? "edit" : "text";
	const text = (value) => typeof value === "string" ? value.trim() : "";
	const imageUrls = [];
	if (Array.isArray(body.imageUrls)) {
		for (const item of body.imageUrls) if (typeof item === "string" && item.trim() !== "") imageUrls.push(item.trim());
	}
	const refNames = Array.isArray(body.refNames) ? body.refNames.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : void 0;
	return {
		mode: mode === "edit" && imageUrls.length > 0 ? "edit" : "text",
		model: model.trim(),
		prompt,
		resolution: text(body.resolution),
		aspectRatio: text(body.aspectRatio),
		outputFormat: text(body.outputFormat),
		n: typeof body.n === "number" && Number.isFinite(body.n) ? Math.trunc(body.n) : 1,
		imageUrls: mode === "edit" ? imageUrls : [],
		...refNames === void 0 || refNames.length === 0 ? {} : { refNames }
	};
}
/** Serve one library image file (prefix route). */
async function serveLibraryImage(res, file) {
	const image = await readLibraryImage(file);
	if (image === void 0) {
		fail(res, 404, "image_not_found", "图片不存在或文件名非法。");
		return;
	}
	res.writeHead(200, {
		"content-type": image.mime,
		"content-length": image.data.byteLength,
		"cache-control": "private, max-age=31536000, immutable"
	});
	res.end(image.data);
}
/**
* Rebuild one durable attachment reference from a tool-result image request.
*
* Every field is re-validated here rather than trusted: the values arrive in a
* URL a page composed, and the route reads a store shared with every other
* attachment in the harness. An incomplete or malformed reference is refused
* outright — a partial one must never reach the store.
*
* @param rawUrl - the request URL (query carries the reference).
* @returns the reference, or undefined when it is not complete and well-formed.
*/
function attachmentRefFrom(rawUrl) {
	if (rawUrl === void 0) return void 0;
	let url;
	try {
		url = new URL(rawUrl, "http://localhost");
	} catch {
		return;
	}
	if (url.pathname !== ATTACHMENT_API.image) return void 0;
	const attachmentId = url.searchParams.get("attachment_id") ?? "";
	const mediaType = url.searchParams.get("media_type") ?? "";
	const bytes = Number(url.searchParams.get("bytes"));
	const width = Number(url.searchParams.get("width"));
	const height = Number(url.searchParams.get("height"));
	if (attachmentId === "" || !isImageMedia(mediaType)) return void 0;
	if (!Number.isSafeInteger(bytes) || bytes < 1) return void 0;
	if (!Number.isSafeInteger(width) || width < 1) return void 0;
	if (!Number.isSafeInteger(height) || height < 1) return void 0;
	return {
		attachmentId,
		mediaType,
		bytes,
		width,
		height
	};
}
/** Serve one durable attachment a tool result references (prefix route). */
async function serveAttachmentImage(attachments, res, ref) {
	if (attachments === void 0) {
		fail(res, 503, "attachments_unavailable", "宿主没有挂载附件存储，无法读取这张图片。");
		return;
	}
	try {
		const stored = await attachments.readImage(ref);
		res.writeHead(200, {
			"content-type": stored.ref.mediaType,
			"content-length": stored.data.byteLength,
			"cache-control": "private, max-age=31536000, immutable"
		});
		res.end(Buffer.from(stored.data));
	} catch {
		fail(res, 404, "image_not_found", "这张图片已不在宿主的附件存储里。");
	}
}
/** Build the plugin's routes. */
function makeRoutes(deps) {
	const loopback = (req, res) => {
		if (isLoopbackRequest(req)) return true;
		fail(res, 403, "loopback_only", "该接口只允许本机访问。");
		return false;
	};
	const route = (kind, path$1, handler) => ({
		kind,
		path: path$1,
		handler
	});
	return [
		route("exact", SETTINGS_API.describe, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			try {
				const writable = deps.settings.writable !== false;
				const view = deps.settings.describe({ redactSecrets: true }).find((descriptor$1) => descriptor$1.ns === SEEWORK_SETTINGS_NAMESPACE);
				ok(res, {
					namespaces: view === void 0 ? [] : [toView(view)],
					writable
				});
			} catch (error) {
				const failure = failureOf(error);
				fail(res, failure.status, failure.code, failure.message);
			}
		}),
		route("exact", SETTINGS_API.mutate, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const body = await readJsonBody(req);
			if (body === void 0) return fail(res, 400, "invalid_body", "请求体不是合法 JSON 对象。");
			const ops = Array.isArray(body.ops) ? body.ops : void 0;
			if (ops === void 0) return fail(res, 400, "invalid_body", "缺少设置操作 ops。");
			const expectedRevision = typeof body.expectedRevision === "number" ? body.expectedRevision : void 0;
			try {
				await deps.settings.mutate(SEEWORK_SETTINGS_NAMESPACE, ops, expectedRevision);
				const view = deps.settings.describe({ redactSecrets: true }).find((descriptor$1) => descriptor$1.ns === SEEWORK_SETTINGS_NAMESPACE);
				ok(res, view === void 0 ? {
					ns: SEEWORK_SETTINGS_NAMESPACE,
					revision: 0,
					value: {},
					secrets: []
				} : toView(view));
			} catch (error) {
				const failure = failureOf(error);
				fail(res, failure.status, failure.code, failure.message);
			}
		}),
		route("exact", SETTINGS_API.directoryPicker, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			ok(res, directoryPickerStatus(deps.directoryPicker?.()));
		}),
		route("exact", SETTINGS_API.pickDirectory, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const controller = new AbortController();
			req.on("close", () => {
				controller.abort();
			});
			const outcome = await pickDirectory(deps.directoryPicker?.(), controller.signal);
			if (res.writableEnded || res.destroyed) return;
			if (outcome.kind === "cancelled") return ok(res, { cancelled: true });
			if (outcome.kind === "failed") return fail(res, 503, outcome.code, outcome.message);
			ok(res, { path: outcome.path });
		}),
		route("exact", CATALOG_API.models, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const body = await readJsonBody(req) ?? {};
			const config = effectiveConfig(deps.resolve());
			const apiUrl = typeof body.apiUrl === "string" && body.apiUrl.trim() !== "" ? body.apiUrl.trim() : config.apiUrl;
			const serviceUrl = typeof body.serviceUrl === "string" && body.serviceUrl.trim() !== "" ? body.serviceUrl.trim() : config.serviceUrl;
			const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() !== "" ? body.apiKey.trim() : config.apiKey;
			try {
				ok(res, await discoverModels({
					serviceUrl,
					apiUrl,
					apiKey
				}));
			} catch (error) {
				const failure = failureOf(error);
				fail(res, failure.status, failure.code, failure.message);
			}
		}),
		route("exact", CATALOG_API.refresh, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const refresher = deps.catalogRefresh?.();
			if (refresher === void 0) return fail(res, 503, "unavailable", "这台宿主没有可用的设置服务，无法自动检测。");
			try {
				ok(res, await refresher.refresh({ automatic: true }));
			} catch (error) {
				const failure = failureOf(error);
				fail(res, failure.status, failure.code, failure.message);
			}
		}),
		route("exact", GENERATE_API, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const body = await readJsonBody(req);
			if (body === void 0) return fail(res, 400, "invalid_body", "请求体不是合法 JSON 对象，或超过了体积上限。");
			const request = parseGenerateRequest(body);
			if (request === void 0) return fail(res, 400, "invalid_request", "缺少必填的 model 或 prompt。");
			if (!effectiveConfig(deps.resolve()).enabled) return fail(res, 400, "plugin-disabled", "插件已停用，请先在设置里启用。");
			let task;
			try {
				task = deps.runtime.submit(request, "panel");
			} catch (error) {
				const failure = failureOf(error);
				return fail(res, failure.status, failure.code, failure.message);
			}
			if (body.waitForCompletion === false) return ok(res, { task });
			try {
				ok(res, { task: await deps.runtime.waitFor(task.id, AbortSignal.timeout(SYNC_WAIT_MS)) });
			} catch (error) {
				ok(res, { task: deps.runtime.get(task.id) ?? task });
			}
		}),
		route("exact", TASK_API.list, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			ok(res, { tasks: deps.runtime.list() });
		}),
		route("exact", TASK_API.cancel, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const body = await readJsonBody(req);
			const taskId = typeof body?.taskId === "string" ? body.taskId : "";
			if (taskId === "") return fail(res, 400, "invalid_body", "缺少 taskId。");
			const task = deps.runtime.cancel(taskId);
			if (task === void 0) return fail(res, 404, "task_not_found", "找不到该生图任务。");
			ok(res, { task });
		}),
		route("exact", UPDATE_API.status, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			const current = readOwnVersion();
			const kind = readInstallKind(profileDirectory());
			ok(res, await checkForUpdate({
				host: deps.updateHost?.(),
				current,
				kind
			}));
		}),
		route("exact", UPDATE_API.apply, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			const host = deps.updateHost?.();
			if (host === void 0) return fail(res, 503, "unavailable", "宿主没有提供插件管理服务。");
			if (readInstallKind(profileDirectory()) === "local") return fail(res, 409, "local_install", "这是本地目录安装，更新请用 pnpm build && pnpm sync。");
			let target;
			try {
				target = await latestVersionFrom({
					registry: registryOf(await host.registries()),
					packageName: PACKAGE_NAME
				});
				await exemptVersion(profileDirectory(), PACKAGE_NAME, target);
			} catch (error) {
				console.warn("[dsh-seework] could not resolve or exempt the target version:", error);
			}
			ok(res, {
				started: true,
				...target === void 0 ? {} : { to: target }
			});
			setTimeout(() => {
				host.installBundle(target === void 0 ? UPDATE_SPEC : `${PACKAGE_NAME}@${target}`).catch((error) => {
					console.warn("[dsh-seework] self-update failed:", error);
				});
			}, 0);
		}),
		route("exact", LIBRARY_API.list, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			ok(res, await listLibrary());
		}),
		route("exact", LIBRARY_API.head, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			ok(res, await readLibraryHead());
		}),
		route("exact", LIBRARY_API.remove, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const body = await readJsonBody(req);
			const id = typeof body?.id === "string" ? body.id : "";
			if (id === "") return fail(res, 400, "invalid_body", "缺少素材 id。");
			ok(res, { entries: await removeLibraryEntry(id) });
		}),
		route("exact", LIBRARY_API.clear, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			ok(res, { entries: await clearLibrary() });
		}),
		route("prefix", LIBRARY_API.image, async (req, res) => {
			if (req.method !== "GET") return fail(res, 405, "method_not_allowed", "请使用 GET。");
			if (!loopback(req, res)) return;
			const path$1 = (req.url ?? "").split("?")[0] ?? "";
			let file = "";
			try {
				file = decodeURIComponent(path$1.slice(LIBRARY_API.image.length + 1));
			} catch {
				return fail(res, 400, "invalid_body", "图片文件名编码不合法。");
			}
			if (file === "") return fail(res, 400, "invalid_body", "缺少图片文件名。");
			await serveLibraryImage(res, file);
		}),
		route("prefix", ATTACHMENT_API.image, async (req, res) => {
			if (req.method !== "GET") return fail(res, 405, "method_not_allowed", "请使用 GET。");
			if (!loopback(req, res)) return;
			const ref = attachmentRefFrom(req.url);
			if (ref === void 0) return fail(res, 400, "invalid_body", "图片引用不完整或不合法。");
			await serveAttachmentImage(deps.attachments, res, ref);
		}),
		route("exact", CANVAS_API.asset, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const body = await readJsonBody(req);
			if (body === void 0) return fail(res, 400, "invalid_body", "请求体不是合法 JSON 对象。");
			if (typeof body.dataUrl !== "string") return fail(res, 400, "invalid_body", "缺少图片数据。");
			try {
				const image = await writeCanvasAsset({ dataUrl: body.dataUrl });
				if (image === void 0) return fail(res, 400, "invalid_body", "图片数据不合法（只接受 PNG/JPEG/WebP/GIF 的 data URL）。");
				ok(res, { image });
			} catch (error) {
				const failure = failureOf(error);
				fail(res, failure.status, failure.code, failure.message);
			}
		}),
		route("exact", CANVAS_API.assets, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			try {
				const referenced = await referencedCanvasFiles();
				const files = (await listCanvasAssetFiles()).map((file) => ({
					...file,
					referenced: referenced.has(file.file)
				}));
				const orphans = files.filter((file) => !file.referenced);
				ok(res, {
					files,
					orphans: orphans.length,
					orphanBytes: orphans.reduce((sum, file) => sum + file.bytes, 0)
				});
			} catch (error) {
				const failure = failureOf(error);
				fail(res, failure.status, failure.code, failure.message);
			}
		}),
		route("exact", CANVAS_API.pruneAssets, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			try {
				const referenced = await referencedCanvasFiles();
				ok(res, await deleteCanvasAssets((await listCanvasAssetFiles()).filter((file) => !referenced.has(file.file)).map((file) => file.file)));
			} catch (error) {
				const failure = failureOf(error);
				fail(res, failure.status, failure.code, failure.message);
			}
		}),
		route("exact", CANVAS_API.removeAsset, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const body = await readJsonBody(req);
			if (body === void 0) return fail(res, 400, "invalid_body", "请求体不是合法 JSON 对象。");
			if (typeof body.file !== "string" || body.file === "") return fail(res, 400, "invalid_body", "缺少图片文件名。");
			try {
				if ((await referencedCanvasFiles()).has(body.file)) return fail(res, 409, "asset_in_use", "这张图还在画布上，先移除卡片再删它。");
				ok(res, await deleteCanvasAssets([body.file]));
			} catch (error) {
				const failure = failureOf(error);
				fail(res, failure.status, failure.code, failure.message);
			}
		}),
		route("prefix", CANVAS_API.asset, async (req, res) => {
			if (req.method !== "GET") return fail(res, 405, "method_not_allowed", "请使用 GET。");
			if (!loopback(req, res)) return;
			const path$1 = (req.url ?? "").split("?")[0] ?? "";
			let file = "";
			try {
				file = decodeURIComponent(path$1.slice(CANVAS_API.asset.length + 1));
			} catch {
				return fail(res, 400, "invalid_body", "图片文件名编码不合法。");
			}
			if (file === "") return fail(res, 400, "invalid_body", "缺少图片文件名。");
			const image = await readCanvasAsset(file);
			if (image === void 0) return fail(res, 404, "image_not_found", "图片不存在或文件名非法。");
			res.writeHead(200, {
				"content-type": image.mime,
				"content-length": image.data.byteLength,
				"cache-control": "private, max-age=31536000, immutable"
			});
			res.end(image.data);
		}),
		route("exact", CANVAS_API.list, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			try {
				ok(res, await listCanvases());
			} catch (error) {
				const failure = failureOf(error);
				fail(res, failure.status, failure.code, failure.message);
			}
		}),
		route("exact", CANVAS_API.create, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const body = await readJsonBody(req) ?? {};
			try {
				ok(res, { canvas: await createCanvas(typeof body.title === "string" ? body.title : void 0) });
			} catch (error) {
				const failure = failureOf(error);
				fail(res, failure.status, failure.code, failure.message);
			}
		}),
		route("exact", CANVAS_API.read, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const body = await readJsonBody(req);
			const id = typeof body?.id === "string" ? body.id : "";
			if (id === "") return fail(res, 400, "invalid_body", "缺少画布 id。");
			const canvas = await readCanvas(id);
			if (canvas === void 0) return fail(res, 404, "canvas_not_found", "画布不存在。");
			ok(res, { canvas });
		}),
		route("exact", CANVAS_API.save, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const body = await readJsonBody(req);
			if (body === void 0) return fail(res, 400, "invalid_body", "请求体不是合法 JSON 对象。");
			const expectedRevision = typeof body.expectedRevision === "number" ? body.expectedRevision : void 0;
			if (expectedRevision === void 0) return fail(res, 400, "invalid_body", "缺少 expectedRevision。");
			try {
				ok(res, { canvas: await saveCanvas(body.canvas, expectedRevision) });
			} catch (error) {
				const failure = failureOf(error);
				fail(res, failure.status, failure.code, failure.message);
			}
		}),
		route("exact", CANVAS_API.remove, async (req, res) => {
			if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "请使用 POST。");
			if (!loopback(req, res)) return;
			const body = await readJsonBody(req);
			const id = typeof body?.id === "string" ? body.id : "";
			if (id === "") return fail(res, 400, "invalid_body", "缺少画布 id。");
			try {
				ok(res, await removeCanvas(id));
			} catch (error) {
				const failure = failureOf(error);
				fail(res, failure.status, failure.code, failure.message);
			}
		})
	];
}

//#endregion
//#region src/index.ts
/** Stable cordis plugin name. */
const name = "seework";
/** Services required before the host surfaces can mount. */
const inject = [
	"webServer",
	"systemPrompt",
	"tools",
	"attachments"
];
/**
* The schemastery config schema. The loader validates the composition entry
* with the same-named export of this module.
*/
const Config = Config$1;
/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 150;
/**
* Model-facing announcement: **plugin-level facts only**.
*
* What belongs here, and what deliberately does not, is design discipline 13 of
* `docs/design/2026-09-15-agent-visible-surface.md`: the announcement carries
* identity, the one tool, the live addresses, the default model's one
* capability line, the other saved models' identifiers, where the library and
* canvas live, how to configure the plugin, the plugin-level limits (one
* generation per model at a time, the cost and quality disclaimers), and the
* **order to load the skill** before generating (#665).
*
* The **tool-level call and result conventions** (confirm the prompt first,
* never invent parameters, where defaults come from, what the result fields
* mean, showing the picture in the reply body, serialize per model, passing
* `reference_images` back unchanged) live in the tool description in
* `src/agent-tools.ts`. That is not a cosmetic split: a tool description stays
* resident with the tool definition and is **not** governed by
* `announceToAgent`, so those sentences only survive with the announcement
* switched off if they live there. One fact, one home — a fact stated twice
* drifts (#651).
*
* What stays here and must not move: the **per-model generation limit** and the
* cost/quality disclaimer (plugin-level facts), while the "do not retry" rule
* itself is stated once, in `generate_image`'s description.
*
* The **capability boundary** is a plugin-level fact and is stated here once:
* this plugin sends the five regular parameters (plus the optional
* `reference_images` on the same tool) and nothing else — a model's own extra
* gateway fields are not something the plugin can send, and since #661 the
* announcement no longer points anywhere for them (there is no route from this
* plugin to an extra field, so a pointer would only suggest one). Since #664
* there is **one** tool rather than a generator plus an editor: the same call
* is an edit when it carries reference images.
*/
/**
* The order to load the bundled skill before using the tool (#665).
*
* A skill is loaded on demand, so "the details are in the skill" is advice the
* model may never take: the announcement has to **order** the load, with the
* name spelled out. `generate_image`'s description carries the same order, so
* it survives with the announcement switched off.
*
* Its own constant rather than inlined twice: `SEEWORK_GUIDANCE` is
* interpolated into both announcement branches, and one shared string cannot
* drift between them.
*/
const LOAD_SKILL_INSTRUCTION = `用这个工具生图 / 改图之前，先加载技能 \`${SKILL_NAME}\`。`;
const SEEWORK_GUIDANCE = "本机已安装 SeeWork 插件（dsh-seework）：让 Agent 用用户自己的 SeeAI Hub 额度在对话里直接生图与改图。一个工具 `generate_image`：不带参考图就是文生图，带上可选的 `reference_images` 就是改图。" + LOAD_SKILL_INSTRUCTION + "图片生成是同步的：一次调用就拿到结果，没有任务号可以查询或取消。每张成图自动存进本地素材库（会话右上角的「素材库」入口，没有会话时在右下角浮动按钮；画布同理），不需要另外保存。API 地址与用户 API Key 在「设置 → 插件 → SeeWork」（侧边栏）配置，密钥仅存于本机设置文档，生图请求由本地宿主代理转发，浏览器拿不到密钥。限制：生图消耗 SeeAI Hub 账户额度，余额不足时网关会直接拒绝（响应里的 cost 即本次扣费）；一次调用就是一次生成请求，同一模型同时只允许 1 个；插件不排队、不自动重试，失败要如实告知用户并经其许可后再发；`n` 的上限按模型（有的模型一次只能出 1 张）；图片内容由上游模型生成，可能不符合预期。插件只发五个常规参数（`model` / `n` / `resolution` / `aspect_ratio` / `output_format`）外加可选的 `reference_images`，模型特有的额外字段插件不发；目录条目列出的是本插件可发参数的字段面，缺键不等于上游一定拒绝。用户提到「生图 / 画图 / 生成图片 / 文生图 / 图生图 / 改图 / 素材库 / 画布」时即指本插件。";
/**
* Model-facing announcement: plugin presence, the live endpoints, the default
* model with **one** capability line, the other saved models' identifiers, where
* the library and canvas live, and how to configure the plugin.
*
* Everything else lives in the on-demand skill (a fixed procedure) or in the
* tool description: per-model capabilities, the model-specific extra
* gateway fields and pixel `size` are deliberately absent, so the
* announcement's length is essentially independent of how many models the user
* saved (one more model costs one more identifier). The capability line itself
* is rendered from `src/model-summary.ts`, never recomputed here.
* **Tool-level call and result conventions are not here either**: they live in
* the tool description, which `announceToAgent` does not govern (see design
* discipline 13).
*
* Both branches build on `SEEWORK_GUIDANCE`, so the order to load the skill
* (#665) reaches the agent whether or not the connection is configured yet.
* The branches add state-specific sentences only — repeating the order here
* would be the second home that drifts (#651).
*
* Which fields a given model accepts is **not** something this plugin carries
* any more (#659), and since #661 the announcement does not point at a model's
* own guide document either: the plugin states its own boundary — five regular
* parameters, nothing else — and adds that a field missing from the catalog
* entry is not a promise that upstream would refuse it (#663).
*
* @param config - the live settings view.
* @returns the announcement text for the system prompt.
*/
function guidanceFor(config) {
	if (config.apiKey.trim() === "" || config.models.length === 0) return `${SEEWORK_GUIDANCE} 当前尚未配置完成：请在 GUI 里打开「设置 → 插件 → SeeWork」（侧边栏），填写 API 地址（默认 ${DEFAULT_API_URL}）与用户 API Key，点「检测可用模型」并保存。`;
	const { defaultModel, others } = summarizeSavedModels(config);
	const catalog = catalogUrl(config.serviceUrl);
	return [
		SEEWORK_GUIDANCE,
		`当前网关 ${gatewayUrl(config.apiUrl, "/images/generations")}，模型目录 ${catalog}。`,
		defaultModel === void 0 ? "" : `默认模型：${defaultModel.identifier}（默认）（${defaultModel.capabilityLine}）。`,
		others.length === 0 ? "" : `其他已保存模型：${others.map((summary) => summary.identifier).join("；")}。`,
		"用户指定模型时用它的名字；未指定时用默认模型，不要自行挑选别的模型。"
	].filter((part) => part !== "").join("");
}
/**
* Mount the settings section, routes, agent tools, and announcement.
* @param ctx - host plugin context carrying webServer/systemPrompt/tools.
* @param config - the composition entry (schema defaults + fallback source).
* @param makeRefresher - test seam for the automatic-detection refresher.
*/
function apply(ctx, config, makeRefresher = createCatalogRefresher) {
	const read = installSettingsSection(ctx, config ?? {}, { onChange: () => {
		syncAnnouncement();
		syncSkill();
	} });
	/** Resolved view of the current settings. */
	const resolve = () => {
		const value = effectiveConfig(read());
		setLibraryDataRoot(value.dataDir);
		return value;
	};
	/** The shared generation queue, created lazily so settings exist first. */
	let runtime;
	const runtimeOf = () => {
		runtime ??= new GenerationRuntime(() => resolve());
		return runtime;
	};
	let refresher;
	const refresherOf = () => refresher;
	/**
	* Adopt refreshed capabilities into the saved models.
	*
	* Read-modify-write rather than a whole-document write: only `models` travels,
	* so the key, the defaults and `defaultModel` cannot be touched by a background
	* round. A concurrent write (the user saving the card while a round lands) is
	* retried once against the fresh document — adoption always re-applies to
	* whatever is saved at that moment, so re-reading is the correct recovery, not
	* a workaround.
	*/
	const adoptRefreshedModels = async (seam, models) => {
		const op = {
			op: "set",
			path: ["models"],
			value: models
		};
		try {
			await seam.mutate(SEEWORK_SETTINGS_NAMESPACE, [op]);
		} catch (error) {
			if (!(error instanceof SettingsConflictError)) throw error;
			await seam.mutate(SEEWORK_SETTINGS_NAMESPACE, [op]);
		}
	};
	let disposeSection;
	const syncAnnouncement = () => {
		if (disposeSection !== void 0) {
			disposeSection();
			disposeSection = void 0;
		}
		const value = resolve();
		if (!value.enabled || !value.announceToAgent) return;
		disposeSection = ctx.systemPrompt.section({
			name: "plugin:dsh-seework",
			order: SECTION_ORDER,
			text: guidanceFor(value)
		});
	};
	ctx.inject(["settings"], (sctx) => {
		const presentation = sctx.get("settings");
		if (typeof presentation?.configure === "function") sctx.effect(() => presentation.configure({ auto: false }, ctx.fiber), "dsh-seework: settings presentation");
		sctx.effect(() => mountRoutes(sctx, read, runtimeOf, refresherOf, () => probeUpdateHost(sctx)), "dsh-seework: routes");
		const seam = sctx.get("settings");
		if (seam !== void 0) refresher = makeRefresher({
			resolveModels: () => resolve().models,
			sources: () => {
				const value = resolve();
				return {
					serviceUrl: value.serviceUrl,
					apiUrl: value.apiUrl,
					apiKey: value.apiKey
				};
			},
			mutate: (models) => adoptRefreshedModels(seam, models),
			hasRetiredKeys: () => hasRetiredModelKeys(read().models)
		});
		sctx.effect(() => {
			refresher?.refresh({ automatic: true });
			const stop = refresher?.startBackground();
			return () => {
				stop?.();
			};
		}, "dsh-seework: automatic catalog detection");
	});
	let skillContext;
	let disposeSkill;
	/** Register or unregister the skill so it follows the current `enabled`. */
	const syncSkill = () => {
		if (skillContext === void 0) return;
		if (!resolve().enabled) {
			disposeSkill?.();
			disposeSkill = void 0;
			return;
		}
		disposeSkill ??= registerCapabilitiesSkill(skillContext);
	};
	ctx.inject(["skills"], (sctx) => {
		skillContext = sctx;
		sctx.effect(() => () => {
			disposeSkill?.();
			disposeSkill = void 0;
			skillContext = void 0;
		}, "dsh-seework: capability skill");
		syncSkill();
	});
	ctx.effect(() => registerAgentImageTools(ctx, runtimeOf(), () => resolve()), "dsh-seework: agent image tools");
	syncAnnouncement();
	ctx.effect(() => () => {
		disposeSection?.();
		disposeSection = void 0;
	}, "dsh-seework: announcement teardown");
}
/**
* The host's plugin manager, when this host composes one.
*
* Probed rather than injected, and structurally rather than by type: the service
* is optional, its shape differs between host generations, and an install that
* cannot update itself must still load. A missing service costs the two update
* routes only — they answer "unavailable" and the card hides the button.
*
* @param ctx - the context whose `pluginManager` may be attached.
* @returns the seam, or undefined when this host has none.
*/
function probeUpdateHost(ctx) {
	const service = ctx.get("pluginManager");
	if (service === null || service === void 0) return void 0;
	const candidate = service;
	if (typeof candidate.registries !== "function" || typeof candidate.installBundle !== "function") return void 0;
	return candidate;
}
/**
* Register the route family with the host web server.
*
* @param ctx - the context whose `settings` and `webServer` are attached.
* @param read - reads the live settings entry.
* @param runtimeOf - the shared generation queue (created on first use).
* @param updateHostOf - the host's plugin manager, when it composes one (the
*   two self-update routes answer "unavailable" otherwise).
* @param catalogRefreshOf - the automatic detection refresher, when the host has
*   a settings provider (the two catalog routes answer "unavailable" otherwise).
* @returns disposer removing every route.
*/
function mountRoutes(ctx, read, runtimeOf, catalogRefreshOf, updateHostOf) {
	const seam = ctx.get("settings");
	if (seam === void 0) return () => {};
	const disposers = makeRoutes({
		settings: seam,
		resolve: read,
		runtime: runtimeOf(),
		...ctx.attachments === void 0 ? {} : { attachments: ctx.attachments },
		directoryPicker: () => ctx.get("directoryPicker"),
		...catalogRefreshOf === void 0 ? {} : { catalogRefresh: catalogRefreshOf },
		...updateHostOf === void 0 ? {} : { updateHost: updateHostOf }
	}).map((route) => ctx.webServer.register(route));
	return () => {
		for (const dispose of disposers) dispose();
	};
}

//#endregion
export { Config, GenerationRuntime, SEEWORK_GUIDANCE, SEEWORK_SETTINGS_NAMESPACE, SKILL_NAME, SeeWorkError, SeeWorkRuntimeError, appendLibraryEntry, apply, buildGenerationBody, capabilityLineFor, catalogEntryToModel, catalogUrl, clearLibrary, createCapabilitiesSkillProvider, createCatalogRefresher, discoverModels, effectiveConfig, ensureConfigured, gatewayUrl, generateImage, guidanceFor, hasRetiredModelKeys, imageSize, inject, isFinalStatus, libraryDataRoot, listLibrary, looksLikeImageModel, makeRoutes, modelName, mountRoutes, name, openAiEntryToModel, readLibraryImage, registerAgentImageTools, registerCapabilitiesSkill, removeLibraryEntry, resolveModel, setLibraryDataRoot, summarizeSavedModels };