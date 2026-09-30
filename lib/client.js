window.__ModuleLoader__.load({ id: "dsh-seework", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);
let react = require("react");
react = __toESM(react);
let react_dom_client = require("react-dom/client");
react_dom_client = __toESM(react_dom_client);

//#region src/protocol.ts
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
/** Formats to offer when no saved model declares any. */
const OUTPUT_FORMAT_FALLBACKS = [
	"png",
	"jpeg",
	"webp"
];
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
/**
* Human label for one origin, for the card badge.
* @param origin - the card's origin, when it has one.
* @returns the badge text, or undefined when there is nothing honest to show.
*/
function canvasOriginLabel(origin) {
	if (origin === "chat") return "对话生成";
	if (origin === "panel") return "面板生成";
	if (origin === "annotation") return "标注合成";
	if (origin === "crop") return "裁剪合成";
}
/**
* The URL that serves one image card's picture.
* @param file - the file name (library entry image, or canvas asset).
* @param source - which store it belongs to; absent means the material library.
* @returns the same-origin route URL.
*/
function canvasImageUrl(file, source = "library") {
	return source === "canvas" ? `${CANVAS_API.asset}/${file}` : `${LIBRARY_API.image}/${file}`;
}

//#endregion
//#region src/client/api.ts
/** POST one JSON request and decode the envelope. */
async function postJson(path, body) {
	try {
		const response = await fetch(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body)
		});
		const payload = await response.json();
		if (typeof payload === "object" && payload !== null && "ok" in payload) return payload;
		return {
			ok: false,
			code: "internal",
			message: `接口返回了未知形状（HTTP ${response.status}）`
		};
	} catch {
		return {
			ok: false,
			code: "internal",
			message: "接口不可达"
		};
	}
}
/** The generation and library routes the panel/canvas consume. */
var SeeWorkApi = class {
	/** Discover the deployment's image models (never persists anything). */
	catalog(input = {}) {
		return postJson(CATALOG_API.models, input);
	}
	/**
	* Run one automatic detection round and adopt refreshed capabilities (#652).
	*
	* Called when the card opens. The host throttles it against its own background
	* timer, so reopening the card does not re-request; an unconfigured plugin
	* answers `skipped: 'not-configured'` without touching the network.
	*
	* @returns what the round changed — the catalog answer is included so the card
	*   can stage models the user has not saved yet.
	*/
	catalogRefresh() {
		return postJson(CATALOG_API.refresh, {});
	}
	/** Submit one generation and wait for its task to settle. */
	generate(request) {
		return postJson(GENERATE_API, request);
	}
	/** Every retained task, newest first. */
	tasks() {
		return postJson(TASK_API.list, {});
	}
	/** Cancel a queued or running task. */
	cancel(taskId) {
		return postJson(TASK_API.cancel, { taskId });
	}
	/** The material library, newest first. */
	library() {
		return postJson(LIBRARY_API.list, {});
	}
	/**
	* The library's identity only — what the page polls to notice a generation
	* that finished in the host.
	*/
	libraryHead() {
		return postJson(LIBRARY_API.head, {});
	}
	/** Remove one library entry and its files. */
	removeEntry(id) {
		return postJson(LIBRARY_API.remove, { id });
	}
	/** Remove every library entry. */
	clearLibrary() {
		return postJson(LIBRARY_API.clear, {});
	}
	/** Every stored board, newest-updated first. */
	canvases() {
		return postJson(CANVAS_API.list, {});
	}
	/** Create a fresh board. */
	createCanvas(title) {
		return postJson(CANVAS_API.create, title === void 0 ? {} : { title });
	}
	/** Read one board. */
	readCanvas(id) {
		return postJson(CANVAS_API.read, { id });
	}
	/** Save a board, fenced by the revision it was read at. */
	saveCanvas(canvas, expectedRevision) {
		return postJson(CANVAS_API.save, {
			canvas,
			expectedRevision
		});
	}
	/** Delete a board. */
	removeCanvas(id) {
		return postJson(CANVAS_API.remove, { id });
	}
	/**
	* Ask how the host can choose a folder (opens nothing).
	*
	* `native` means one OS chooser on the host's screen; `browse` means the shell's
	* own in-app browser serves listings instead, and `none` means there is no picker
	* at all — in both latter cases the card offers no button.
	*/
	directoryPicker() {
		return postJson(SETTINGS_API.directoryPicker, {});
	}
	/**
	* Open the host's folder chooser and wait for the operator.
	* @returns the chosen absolute directory, or `cancelled: true`.
	*/
	pickDirectory() {
		return postJson(SETTINGS_API.pickDirectory, {});
	}
	/**
	* Store one canvas-owned picture (a burned annotation or a crop).
	*
	* It never enters the material library: the library records what was generated,
	* and a marked-up copy belongs to the board that produced it.
	*
	* @param dataUrl - the image as a PNG data URL.
	* @returns the stored image's file name and URL, or an error envelope.
	*/
	writeCanvasAsset(dataUrl) {
		return postJson(CANVAS_API.asset, { dataUrl });
	}
	/**
	* Enumerate the board's own pictures and how much of them is unreferenced.
	* @returns each file with its size and whether a card still shows it.
	*/
	canvasAssets() {
		return postJson(CANVAS_API.assets, {});
	}
	/** Delete every board picture no card shows any more. */
	pruneCanvasAssets() {
		return postJson(CANVAS_API.pruneAssets, {});
	}
	/**
	* Delete one board picture.
	*
	* Refused while a card still shows it, so removing a card and dropping its file
	* has to happen in that order (and a second board's copy is never pulled away).
	*
	* @param file - the picture's file name.
	*/
	removeCanvasAsset(file) {
		return postJson(CANVAS_API.removeAsset, { file });
	}
	/**
	* Read the running version, the registry's newest, and how this copy got here.
	*
	* Never fails on a host without a plugin manager or with an unreachable
	* registry: the answer carries an `error` and the card renders it.
	*/
	updateStatus() {
		return postJson(UPDATE_API.status, {});
	}
	/**
	* Start installing the newest published version.
	*
	* Answers as soon as the install has been **started**, not when it finishes:
	* applying it re-composes the profile and unloads this plugin, so there is
	* nothing left to answer a later outcome. The caller polls `updateStatus`
	* until the version changes.
	*/
	applyUpdate() {
		return postJson(UPDATE_API.apply, {});
	}
};

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\controls.module.css.mjs
const css$14 = ".thCGja_button{height:30px;color:inherit;font:inherit;cursor:pointer;background:0 0;border:1px solid #0000;border-radius:999px;align-items:center;gap:6px;padding:0 14px;font-size:12px;transition:background .12s,opacity .12s;display:inline-flex}.thCGja_button:disabled{opacity:.5;cursor:default}.thCGja_buttonPrimary{background:var(--dsw-alias-button-primary-fill,#2b2f36);color:var(--dsw-alias-label-primary-foreground,#fff)}.thCGja_buttonPrimary:not(:disabled):hover{background:var(--dsw-alias-button-primary-hover,#43454a)}.thCGja_buttonOutline{border-color:var(--dsw-alias-border-l2,currentColor)}.thCGja_buttonOutline:not(:disabled):hover,.thCGja_button:not(.thCGja_buttonPrimary):not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover,#7f7f7f24)}.thCGja_input{border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-1,transparent);width:100%;height:32px;color:var(--dsw-alias-label-primary,inherit);font:inherit;border-radius:8px;padding:0 10px;font-size:13px}.thCGja_input::placeholder{color:var(--dsw-alias-label-caption,#7f7f7fe6)}.thCGja_input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:-1px}.thCGja_toggle{cursor:pointer;color:var(--dsw-alias-label-primary,inherit);align-items:center;gap:8px;display:flex}.thCGja_toggle input{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary,#2b2f36);cursor:pointer}.thCGja_pill{color:light-dark(#1a7f37,#56d364);background:#2ea0432e;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500}";
const tagId$14 = "dsh-seework/controls.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$14) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$14;
	tag.textContent = css$14;
	document.head.appendChild(tag);
}
var controls_module_css_default = {
	"input": "thCGja_input",
	"buttonOutline": "thCGja_buttonOutline",
	"toggle": "thCGja_toggle",
	"buttonPrimary": "thCGja_buttonPrimary",
	"pill": "thCGja_pill",
	"button": "thCGja_button"
};

//#endregion
//#region src/client/controls.tsx
/** Render a button.
* @param props.variant - visual family; `primary` is the confirming action.
*/
function Button({ variant = "ghost", className, children,...rest }) {
	const variantClass = variant === "primary" ? controls_module_css_default.buttonPrimary : variant === "outline" ? controls_module_css_default.buttonOutline : "";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		className: [
			controls_module_css_default.button,
			variantClass,
			className
		].filter(Boolean).join(" "),
		...rest,
		children
	});
}
/** Render a text input. */
function TextInput({ className,...rest }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
		className: [controls_module_css_default.input, className].filter(Boolean).join(" "),
		...rest
	});
}
/** Render a toggle switch.
* @param props.label - accessible name, rendered beside the control.
*/
function Toggle({ checked, onChange, label, title, disabled }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
		className: controls_module_css_default.toggle,
		title,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
			type: "checkbox",
			role: "switch",
			checked,
			disabled,
			onChange: (event) => {
				onChange(event.target.checked);
			}
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
	});
}
/** Render a small status pill. */
function Pill({ children }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: controls_module_css_default.pill,
		children
	});
}
/**
* Copy text to the clipboard, preferring the async Clipboard API and falling
* back to a hidden textarea (older browsers and non-secure origins).
* @param text - the text to place on the clipboard.
* @returns settlement after a copy attempt succeeded.
*/
async function copyText(text) {
	if (navigator.clipboard?.writeText !== void 0) {
		await navigator.clipboard.writeText(text);
		return;
	}
	const area = document.createElement("textarea");
	area.value = text;
	area.setAttribute("readonly", "");
	area.style.position = "fixed";
	area.style.opacity = "0";
	document.body.appendChild(area);
	try {
		area.select();
		if (!document.execCommand("copy")) throw new Error("copy refused");
	} finally {
		area.remove();
	}
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\settings-card.module.css.mjs
const css$13 = ".-qAsGW_card{color:var(--dsw-alias-label-primary,inherit);flex-direction:column;gap:20px;padding:4px 0 12px;font-size:13px;line-height:1.55;display:flex}.-qAsGW_section{border:1px solid var(--dsw-alias-border-l1,currentColor);background:var(--dsw-alias-bg-layer-1,transparent);border-radius:12px;flex-direction:column;gap:8px;padding:14px 16px;display:flex}.-qAsGW_sectionTitle{color:var(--dsw-alias-label-primary,inherit);margin:0 0 2px;font-size:13px;font-weight:600}.-qAsGW_field{flex-direction:column;gap:6px;display:flex}.-qAsGW_label{color:var(--dsw-alias-label-primary,inherit);align-items:center;gap:8px;font-weight:500;display:flex}.-qAsGW_hint{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);margin:0;font-size:12px}.-qAsGW_hint code,.-qAsGW_modelId{background:var(--dsw-alias-bg-layer-3,#7f7f7f24);color:var(--dsw-alias-label-secondary,inherit);border-radius:4px;padding:0 4px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px}.-qAsGW_fixedValue{border:1px dashed var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-1,#7f7f7f0f);color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere;user-select:text;border-radius:6px;padding:6px 8px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px}.-qAsGW_dirRow{align-items:center;gap:8px;display:flex}.-qAsGW_dirRow .-qAsGW_fixedValue{flex:1;min-width:0}.-qAsGW_row{flex-wrap:wrap;align-items:center;gap:8px;margin-top:2px;display:flex}.-qAsGW_grid{grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;display:grid}.-qAsGW_select{border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-1,transparent);width:100%;height:32px;color:var(--dsw-alias-label-primary,inherit);font:inherit;border-radius:8px;padding:0 8px}.-qAsGW_modelList{border:1px solid var(--dsw-alias-border-l1,currentColor);border-radius:10px;flex-direction:column;max-height:280px;display:flex;overflow-y:auto}.-qAsGW_modelRow{cursor:pointer;align-items:flex-start;gap:10px;padding:8px 10px;display:flex}.-qAsGW_modelRow+.-qAsGW_modelRow{border-top:1px solid var(--dsw-alias-border-l1,currentColor)}.-qAsGW_modelRow:hover{background:var(--dsw-alias-interactive-bg-hover,#7f7f7f14)}.-qAsGW_modelMain{flex-wrap:wrap;align-items:baseline;gap:6px;display:flex}.-qAsGW_modelName{color:var(--dsw-alias-label-primary,inherit);font-weight:500}.-qAsGW_modelCapability{width:100%;color:var(--dsw-alias-label-tertiary,#7f7f7ff2);font-size:12px}.-qAsGW_switches{flex-direction:column;gap:10px;margin-top:4px;display:flex}.-qAsGW_muted{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);margin:0}.-qAsGW_ok,.-qAsGW_warn,.-qAsGW_error{border-radius:8px;margin:0;padding:8px 12px;font-size:12px}.-qAsGW_ok{color:light-dark(#1a7f37,#56d364);background:#2ea0432e}.-qAsGW_warn{color:light-dark(#8a6100,#e3b341);background:#d2992233}.-qAsGW_error{color:light-dark(#b3261e,#ff7b72);background:#f8514929}";
const tagId$13 = "dsh-seework/settings-card.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$13) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$13;
	tag.textContent = css$13;
	document.head.appendChild(tag);
}
var settings_card_module_css_default = {
	"grid": "-qAsGW_grid",
	"field": "-qAsGW_field",
	"row": "-qAsGW_row",
	"modelId": "-qAsGW_modelId",
	"select": "-qAsGW_select",
	"modelList": "-qAsGW_modelList",
	"modelRow": "-qAsGW_modelRow",
	"modelMain": "-qAsGW_modelMain",
	"modelName": "-qAsGW_modelName",
	"modelCapability": "-qAsGW_modelCapability",
	"card": "-qAsGW_card",
	"switches": "-qAsGW_switches",
	"muted": "-qAsGW_muted",
	"warn": "-qAsGW_warn",
	"label": "-qAsGW_label",
	"hint": "-qAsGW_hint",
	"ok": "-qAsGW_ok",
	"sectionTitle": "-qAsGW_sectionTitle",
	"fixedValue": "-qAsGW_fixedValue",
	"section": "-qAsGW_section",
	"dirRow": "-qAsGW_dirRow",
	"error": "-qAsGW_error"
};

//#endregion
//#region src/client/VersionRow.tsx
/** How often the row asks again while an install is running. */
const POLL_MS = 2e3;
/** How many polls before the row stops waiting and asks for a page refresh. */
const MAX_POLLS = 45;
/** Wait one interval. */
function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
/**
* Render the settings card's version section.
* @param props.api - the plugin route client.
*/
function VersionRow({ api }) {
	const [status, setStatus] = (0, react.useState)(void 0);
	const [phase, setPhase] = (0, react.useState)("checking");
	const [note, setNote] = (0, react.useState)(void 0);
	const check = (0, react.useCallback)(async () => {
		setPhase("checking");
		setNote(void 0);
		const answer = await api.updateStatus();
		if (answer.ok) {
			setStatus(answer.value);
			setNote(answer.value.error);
		} else setNote(answer.message);
		setPhase("idle");
	}, [api]);
	(0, react.useEffect)(() => {
		check();
	}, [check]);
	const apply$1 = (0, react.useCallback)(async () => {
		setPhase("updating");
		setNote(void 0);
		const started = await api.applyUpdate();
		if (!started.ok) {
			setNote(started.message);
			setPhase("idle");
			return;
		}
		const from = status?.current;
		for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
			await sleep(POLL_MS);
			const answer = await api.updateStatus();
			if (!answer.ok) continue;
			if (answer.value.current !== from) {
				setStatus(answer.value);
				setPhase("done");
				return;
			}
		}
		setPhase("done");
	}, [api, status?.current]);
	const local = status?.kind === "local";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: settings_card_module_css_default.field,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: settings_card_module_css_default.label,
				children: "当前版本"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: settings_card_module_css_default.dirRow,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: settings_card_module_css_default.fixedValue,
					"data-dsh-seework-version": "",
					title: status?.current,
					children: status?.current ?? "…"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
					variant: "outline",
					disabled: phase === "checking" || phase === "updating",
					onClick: () => {
						check();
					},
					children: phase === "checking" ? "检查中…" : "检查更新"
				})]
			})]
		}),
		local ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
			className: settings_card_module_css_default.hint,
			"data-dsh-seework-version-kind": "local",
			children: [
				"这是本地目录安装，更新走 ",
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "pnpm build && pnpm sync" }),
				"，这里不提供更新。"
			]
		}) : phase === "updating" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			className: settings_card_module_css_default.hint,
			children: "正在更新：宿主重载插件期间界面可能短暂失联，属正常。"
		}) : phase === "done" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
			className: settings_card_module_css_default.ok,
			"data-dsh-seework-version-state": "done",
			children: [
				"更新已开始。请",
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "重启 DeepSeek Harness" }),
				" 让新版本生效——桌面客户端没有刷新页面的入口。"
			]
		}) : status?.updateAvailable === true && status.latest !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: settings_card_module_css_default.row,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Button, {
				variant: "primary",
				onClick: () => {
					apply$1();
				},
				children: ["更新到 ", status.latest]
			})
		}) : status?.latest !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
			className: settings_card_module_css_default.muted,
			children: [
				"已是最新版本（注册表上是 ",
				status.latest,
				"）。"
			]
		}) : null,
		note !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			className: settings_card_module_css_default.warn,
			children: note
		}) : null
	] });
}

//#endregion
//#region src/client/SettingsCard.tsx
/** Persisted catalog entries, normalized for display. */
function selectedModels(config) {
	return Array.isArray(config?.models) ? config.models : [];
}
/** Re-render on every scope or secret change. */
function useScopeSnapshot(scope) {
	const [tick, setTick] = (0, react.useState)(0);
	(0, react.useEffect)(() => {
		const bump = () => {
			setTick((value) => value + 1);
		};
		const stops = [scope.subscribe(bump), scope.subscribeSecrets(bump)];
		return () => {
			for (const stop of stops) stop();
		};
	}, [scope]);
	const snapshot = scope.getSnapshot();
	return {
		config: snapshot.value,
		status: snapshot.status,
		keySet: scope.getSecretSet("apiKey")
	};
}
/** The settings card. */
function SeeWorkSettingsCard({ scope, api }) {
	const { config, status, keySet } = useScopeSnapshot(scope);
	const [draftApiUrl, setDraftApiUrl] = (0, react.useState)(void 0);
	const [draftServiceUrl, setDraftServiceUrl] = (0, react.useState)(void 0);
	const [draftApiKey, setDraftApiKey] = (0, react.useState)("");
	const [candidates, setCandidates] = (0, react.useState)(void 0);
	/**
	* Whether the staged rows came from the automatic round (#652).
	*
	* The model section seeds its ticks differently for the two sources: a manual
	* detection stages exactly the saved choices, while the automatic round also
	* pre-ticks the models the catalog gained, so adding one is a single
	* 「保存模型」. It is a prop rather than section state because only the parent
	* knows which round produced the rows.
	*/
	const [stagedFromAuto, setStagedFromAuto] = (0, react.useState)(false);
	const [busy, setBusy] = (0, react.useState)(false);
	const [notice, setNotice] = (0, react.useState)(void 0);
	/** The data root the host actually resolved, for the read-only display. */
	const [resolvedRoot, setResolvedRoot] = (0, react.useState)("");
	/** How the host can choose a folder (asking opens nothing). */
	const [picker, setPicker] = (0, react.useState)(void 0);
	const apiUrl = draftApiUrl ?? config?.apiUrl ?? "";
	const serviceUrl = draftServiceUrl ?? config?.serviceUrl ?? "";
	const persisted = selectedModels(config);
	/** Whether the user moved the data root away from the default. */
	const customRoot = (config?.dataDir ?? "").trim() !== "";
	/**
	* Ask the host where the library really lives.
	*
	* The configured value may be empty (the default) or relative to DSH_HOME, and
	* only the host knows — so the card shows the host's answer instead of guessing.
	*/
	const refreshRoot = (0, react.useCallback)(async () => {
		const result = await api.library();
		if (result.ok) setResolvedRoot(result.value.dataRoot);
	}, [api]);
	(0, react.useEffect)(() => {
		let live = true;
		api.library().then((result) => {
			if (live && result.ok) setResolvedRoot(result.value.dataRoot);
		}).catch(() => {});
		api.directoryPicker().then((result) => {
			if (live && result.ok) setPicker(result.value);
		}).catch(() => {});
		return () => {
			live = false;
		};
	}, [api]);
	/** Open the host's folder chooser and store what it returns. */
	const chooseDirectory = (0, react.useCallback)(async () => {
		setBusy(true);
		setNotice(void 0);
		const result = await api.pickDirectory();
		if (!result.ok) {
			setBusy(false);
			setNotice({
				tone: "warn",
				text: result.message
			});
			return;
		}
		if (result.value.path === void 0) {
			setBusy(false);
			return;
		}
		const path = result.value.path;
		await scope.set("dataDir", path);
		await scope.load();
		await refreshRoot();
		setBusy(false);
		setNotice({
			tone: "ok",
			text: `素材目录已改为 ${path}（旧目录里的文件没有被删）。`
		});
	}, [
		api,
		refreshRoot,
		scope
	]);
	/** Go back to the plugin's own default location. */
	const restoreDefaultDirectory = (0, react.useCallback)(async () => {
		setBusy(true);
		setNotice(void 0);
		await scope.unset("dataDir");
		await scope.load();
		await refreshRoot();
		setBusy(false);
		setNotice({
			tone: "ok",
			text: "素材目录已恢复默认（旧目录里的文件没有被删）。"
		});
	}, [refreshRoot, scope]);
	/** Write one scalar field and re-read the section. */
	const write = (0, react.useCallback)((field, value) => {
		scope.set(field, value).then(() => scope.load());
	}, [scope]);
	/** Persist the staged connection fields. */
	const saveConnection = (0, react.useCallback)(async () => {
		setBusy(true);
		const ops = [];
		if (apiUrl.trim() !== (config?.apiUrl ?? "")) ops.push({
			op: "set",
			path: ["apiUrl"],
			value: apiUrl.trim()
		});
		if (serviceUrl.trim() !== (config?.serviceUrl ?? "")) ops.push({
			op: "set",
			path: ["serviceUrl"],
			value: serviceUrl.trim()
		});
		if (draftApiKey.trim() !== "") ops.push({
			op: "set",
			path: ["apiKey"],
			value: draftApiKey.trim()
		});
		if (ops.length === 0) {
			setBusy(false);
			setNotice({
				tone: "warn",
				text: "没有需要保存的改动。"
			});
			return;
		}
		await scope.mutateOps(ops);
		await scope.load();
		setDraftApiUrl(void 0);
		setDraftServiceUrl(void 0);
		setDraftApiKey("");
		setBusy(false);
		setNotice({
			tone: "ok",
			text: "连接设置已保存。"
		});
	}, [
		apiUrl,
		config?.apiUrl,
		config?.serviceUrl,
		draftApiKey,
		scope,
		serviceUrl
	]);
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
	(0, react.useEffect)(() => {
		if (status !== "ready") return;
		let live = true;
		api.catalogRefresh().then((result) => {
			if (!live || !result.ok || !result.value.ran) return;
			const summary = result.value.result;
			const catalog = result.value.catalog;
			if (summary === void 0 || catalog === void 0) return;
			scope.load();
			const parts = [];
			if (summary.added.length > 0) {
				setStagedFromAuto(true);
				setCandidates(catalog.models);
				parts.push(`目录里有 ${summary.added.length} 个还没加入的模型，已勾选，点「保存模型」即可加入`);
			}
			if (summary.missing.length > 0) parts.push(`有 ${summary.missing.length} 个已保存模型在目录里找不到了（快照保留着，是否移除由你决定）`);
			if (summary.adopted.length > 0) parts.push(`已刷新 ${summary.adopted.length} 个已保存模型的能力`);
			if (parts.length > 0) setNotice({
				tone: "warn",
				text: `${parts.join("；")}。`
			});
		}).catch(() => {});
		return () => {
			live = false;
		};
	}, [
		status,
		api,
		scope
	]);
	/** Probe the catalog with the on-screen addresses and key. */
	const detect = (0, react.useCallback)(async () => {
		setBusy(true);
		setNotice(void 0);
		setStagedFromAuto(false);
		const result = await api.catalog({
			apiUrl: apiUrl.trim(),
			serviceUrl: serviceUrl.trim(),
			apiKey: draftApiKey.trim()
		});
		setBusy(false);
		if (!result.ok) {
			setCandidates(void 0);
			setNotice({
				tone: "error",
				text: `检测失败：${result.message}`
			});
			return;
		}
		setCandidates(result.value.models);
		const tried = result.value.attempts.map((attempt) => `${attempt.url}（${attempt.outcome}）`).join("；");
		if (result.value.models.length === 0) {
			setNotice({
				tone: "warn",
				text: `扫到 ${result.value.scanned} 个模型，其中没有图片模型。来源：${tried}`
			});
			return;
		}
		setNotice({
			tone: "ok",
			text: `发现 ${result.value.models.length} 个图片模型（共扫描 ${result.value.scanned} 个），来自 ${result.value.catalogUrl}。勾选后点「保存模型」。`
		});
	}, [
		api,
		apiUrl,
		draftApiKey,
		serviceUrl
	]);
	/** Persist one catalog selection (a whole-array write, secrets untouched). */
	const saveModels = (0, react.useCallback)(async (selection) => {
		setBusy(true);
		const models = selection;
		const ops = [{
			op: "set",
			path: ["models"],
			value: models
		}];
		if (models.length > 0 && (config?.defaultModel ?? "") === "") ops.push({
			op: "set",
			path: ["defaultModel"],
			value: models[0].id
		});
		await scope.mutateOps(ops);
		await scope.load();
		setBusy(false);
		setNotice({
			tone: "ok",
			text: `已保存 ${models.length} 个模型。`
		});
	}, [config?.defaultModel, scope]);
	if (status === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: settings_card_module_css_default.card,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			className: settings_card_module_css_default.muted,
			children: "正在读取设置…"
		})
	});
	if (status === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: settings_card_module_css_default.card,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			className: settings_card_module_css_default.error,
			children: "设置接口不可达。请确认浏览器打开的就是本机 DSH 宿主（该接口只监听本机回环地址）。"
		})
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: settings_card_module_css_default.card,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: settings_card_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: settings_card_module_css_default.sectionTitle,
						children: "SeeAI Hub 连接"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: settings_card_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.label,
							children: "API 地址"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
							value: apiUrl,
							placeholder: "http://127.0.0.1:8080/v1",
							spellCheck: false,
							onChange: (event) => {
								setDraftApiUrl(event.target.value);
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: settings_card_module_css_default.hint,
						children: [
							"生成接口的地址，填到 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "/v1" }),
							" 为止。开发环境默认 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "http://127.0.0.1:8080/v1" }),
							"。"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: settings_card_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.label,
							children: "模型目录地址"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
							value: serviceUrl,
							placeholder: "http://127.0.0.1:8081",
							spellCheck: false,
							onChange: (event) => {
								setDraftServiceUrl(event.target.value);
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: settings_card_module_css_default.hint,
						children: [
							"SeeAI Hub 的「模型目录」在 service 上（默认 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "127.0.0.1:8081" }),
							"），不在生成网关上； 两个地址各管各的。如果你的部署把两者挂在同一个域名下，填同一个域名即可——插件两个地址都会试，并把结果告诉你。"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: settings_card_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: settings_card_module_css_default.label,
							children: ["用户 API Key", keySet ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Pill, { children: "已保存" }) : null]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
							value: draftApiKey,
							type: "password",
							autoComplete: "off",
							spellCheck: false,
							placeholder: keySet ? "留空表示不修改已保存的 Key" : "sk-…",
							onChange: (event) => {
								setDraftApiKey(event.target.value);
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: settings_card_module_css_default.hint,
						children: "在 SeeAI Hub 后台「API Keys」里创建的设备 Key。密钥只写在本机设置文档里，不会存到浏览器。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: settings_card_module_css_default.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
							variant: "outline",
							disabled: busy,
							onClick: () => {
								detect();
							},
							children: busy ? "处理中…" : "检测可用模型"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
							variant: "primary",
							disabled: busy,
							onClick: () => {
								saveConnection();
							},
							children: "保存连接"
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelSection, {
				persisted,
				candidates,
				stagedFromAuto,
				busy,
				onSave: (selection) => {
					saveModels(selection);
				}
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: settings_card_module_css_default.section,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
					className: settings_card_module_css_default.sectionTitle,
					children: "生成默认值"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DefaultsFields, {
					config,
					models: persisted,
					onWrite: write
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: settings_card_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: settings_card_module_css_default.sectionTitle,
						children: "本地与行为"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: settings_card_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.label,
							children: "素材目录"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: settings_card_module_css_default.dirRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: settings_card_module_css_default.fixedValue,
									"data-dsh-seework-datadir": "",
									title: resolvedRoot,
									children: resolvedRoot !== "" ? resolvedRoot : "~/.dsh/dsh-seework（默认）"
								}),
								picker?.kind === "native" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
									disabled: busy,
									"data-dsh-seework-pick-dir": "",
									title: "打开系统的文件夹选择窗口",
									onClick: () => {
										chooseDirectory();
									},
									children: "选择目录…"
								}) : null,
								customRoot ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
									disabled: busy,
									"data-dsh-seework-reset-dir": "",
									title: "回到插件自己的默认位置",
									onClick: () => {
										restoreDefaultDirectory();
									},
									children: "恢复默认"
								}) : null
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: settings_card_module_css_default.hint,
						children: picker === void 0 || picker.kind === "native" ? "对话里生成的图片、画布上的合成图都存在这里；换目录只是换个地方读写，旧目录里的文件不会被删。" : picker.message
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BehaviorSwitches, {
						config,
						onWrite: write
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: settings_card_module_css_default.row,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
							variant: "primary",
							disabled: busy,
							onClick: () => {
								saveConnection();
							},
							children: "保存"
						})
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: settings_card_module_css_default.section,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
					className: settings_card_module_css_default.sectionTitle,
					children: "版本"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VersionRow, { api })]
			}),
			notice !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: notice.tone === "ok" ? settings_card_module_css_default.ok : notice.tone === "warn" ? settings_card_module_css_default.warn : settings_card_module_css_default.error,
				children: notice.text
			}) : null
		]
	});
}
/** The model catalog section: detection results plus the persisted selection. */
function ModelSection({ persisted, candidates, stagedFromAuto, busy, onSave }) {
	const rows = (candidates ?? persisted).map((model) => ({
		...model,
		label: model.label ?? ""
	}));
	const [selected, setSelected] = (0, react.useState)(void 0);
	const persistedIds = persisted.map((model) => model.id).join("\n");
	(0, react.useEffect)(() => {
		if (candidates === void 0) {
			setSelected(void 0);
			return;
		}
		const stored = persistedIds === "" ? [] : persistedIds.split("\n");
		setSelected(stagedFromAuto ? [...new Set([...stored, ...candidates.map((model) => model.id).filter((id) => !stored.includes(id))])] : stored.filter((id) => candidates.some((model) => model.id === id)));
	}, [candidates]);
	const checked = new Set(selected ?? persisted.map((model) => model.id));
	const pending = rows.filter((model) => checked.has(model.id));
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: settings_card_module_css_default.section,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
				className: settings_card_module_css_default.sectionTitle,
				children: "图片模型"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: settings_card_module_css_default.hint,
				children: "只勾选你的网关确实支持生图的模型。没有目录信息的网关按「仅文生图、参数由上游决定」处理。"
			}),
			rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: settings_card_module_css_default.muted,
				children: "还没有模型：先填好地址与 Key，点「检测可用模型」。"
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: settings_card_module_css_default.modelList,
				children: rows.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: settings_card_module_css_default.modelRow,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: checked.has(model.id),
						onChange: (event) => {
							const next = new Set(checked);
							if (event.target.checked) next.add(model.id);
							else next.delete(model.id);
							setSelected(rows.filter((candidate) => next.has(candidate.id)).map((candidate) => candidate.id));
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: settings_card_module_css_default.modelMain,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: settings_card_module_css_default.modelName,
								children: model.label !== "" ? model.label : model.id
							}),
							model.label !== "" && model.label !== model.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
								className: settings_card_module_css_default.modelId,
								children: model.id
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: settings_card_module_css_default.modelCapability,
								children: [
									model.resolutions.length > 0 ? model.resolutions.join(" / ") : "档位由上游决定",
									model.aspectRatios.length > 0 ? `${model.aspectRatios.length} 种比例` : "比例由上游决定",
									model.maxReferenceImages > 0 ? `可带参考图 ≤${model.maxReferenceImages}` : "仅文生图"
								].filter(Boolean).join(" · ")
							})
						]
					})]
				}, model.id))
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: settings_card_module_css_default.row,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
					variant: "primary",
					disabled: busy || rows.length === 0,
					onClick: () => {
						onSave(pending);
					},
					children: "保存模型"
				}), selected !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
					variant: "ghost",
					onClick: () => {
						setSelected([]);
					},
					children: "全不选"
				}) : null]
			})
		]
	});
}
/**
* Output formats to offer: what the saved models declare, or the three we know
* (#658/D-16); the stored value is kept selectable so the control never shows
* something other than what is stored.
*/
function outputFormatOptions(models, current) {
	const seen = [];
	for (const model of models) for (const format of model.outputFormats ?? []) if (!includesIgnoringCase(seen, format)) seen.push(format);
	return withCurrent(seen.length > 0 ? seen : [...OUTPUT_FORMAT_FALLBACKS], current);
}
/** The gateway-wide ratios (#658/D-16), keeping a stored value that is not one. */
function aspectRatioOptions(current) {
	return withCurrent([...UNIFIED_ASPECT_RATIOS], current);
}
/** Keep a stored value selectable even when the list does not offer it (old documents). */
function withCurrent(options, current) {
	const wanted = current.trim();
	if (wanted !== "" && !includesIgnoringCase(options, wanted)) options.push(wanted);
	return options;
}
/** Generation defaults; each control writes its own scalar field immediately. */
function DefaultsFields({ config, models, onWrite }) {
	const ratio = config?.defaultAspectRatio?.trim() || DEFAULT_ASPECT_RATIO;
	const format = config?.outputFormat?.trim() || DEFAULT_OUTPUT_FORMAT;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: settings_card_module_css_default.grid,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: settings_card_module_css_default.field,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: settings_card_module_css_default.label,
					children: "默认模型"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
					className: settings_card_module_css_default.select,
					value: config?.defaultModel ?? "",
					onChange: (event) => {
						onWrite("defaultModel", event.target.value);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: "",
						children: "（目录里的第一个）"
					}), models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: model.id,
						children: model.label !== void 0 && model.label !== "" ? model.label : model.id
					}, model.id))]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: settings_card_module_css_default.field,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: settings_card_module_css_default.label,
					children: "默认比例"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
					className: settings_card_module_css_default.select,
					value: ratio,
					onChange: (event) => {
						onWrite("defaultAspectRatio", event.target.value);
					},
					children: aspectRatioOptions(ratio).map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: option,
						children: option
					}, option))
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: settings_card_module_css_default.field,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: settings_card_module_css_default.label,
					children: "输出格式"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
					className: settings_card_module_css_default.select,
					value: format,
					onChange: (event) => {
						onWrite("outputFormat", event.target.value);
					},
					children: outputFormatOptions(models, format).map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: option,
						children: option
					}, option))
				})]
			})
		]
	});
}
/** Plugin switches. */
function BehaviorSwitches({ config, onWrite }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: settings_card_module_css_default.switches,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Toggle, {
				checked: config?.enabled ?? true,
				label: "启用插件",
				onChange: (next) => {
					onWrite("enabled", next);
				}
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Toggle, {
				checked: config?.allowAgentGeneration ?? true,
				label: "允许 Agent 生图",
				onChange: (next) => {
					onWrite("allowAgentGeneration", next);
				}
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Toggle, {
				checked: config?.announceToAgent ?? true,
				label: "把插件与模型告知 Agent",
				onChange: (next) => {
					onWrite("announceToAgent", next);
				}
			})
		]
	});
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
/** Default size of a card placed on a board, in board pixels. */
const CANVAS_NEW_IMAGE_SIZE = 320;

//#endregion
//#region src/canvas-viewport.ts
/** Zoom applied per wheel notch and per toolbar button press. */
const ZOOM_STEP = 1.25;
/** Padding kept around the content by {@link fitViewport}. */
const FIT_PADDING = 48;
/** Clamp a zoom factor into the supported range. */
function clampZoom(k) {
	if (!Number.isFinite(k)) return 1;
	return Math.round(Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, k)) * 1e3) / 1e3;
}
/** Convert a screen point to board coordinates. */
function screenToBoard(viewport, screenX, screenY) {
	return {
		x: (screenX - viewport.x) / viewport.k,
		y: (screenY - viewport.y) / viewport.k
	};
}
/** Convert a board point to screen coordinates. */
function boardToScreen(viewport, boardX, boardY) {
	return {
		x: boardX * viewport.k + viewport.x,
		y: boardY * viewport.k + viewport.y
	};
}
/**
* Zoom one step around a fixed screen anchor (the cursor, or the viewport
* centre for a button press), so the board point under the anchor stays put.
* @param direction - 1 zooms in, -1 zooms out.
*/
function zoomAt(viewport, direction, anchorX, anchorY) {
	return zoomTo(viewport, clampZoom(direction === 1 ? viewport.k * ZOOM_STEP : viewport.k / ZOOM_STEP), anchorX, anchorY);
}
/** Zoom to an exact factor around a fixed screen anchor. */
function zoomTo(viewport, targetK, anchorX, anchorY) {
	const k = clampZoom(targetK);
	if (k === viewport.k) return viewport;
	const board = screenToBoard(viewport, anchorX, anchorY);
	return {
		x: anchorX - board.x * k,
		y: anchorY - board.y * k,
		k
	};
}
/** Translate the viewport by a screen-space delta (dragging the board). */
function panBy(viewport, deltaX, deltaY) {
	return {
		x: viewport.x + deltaX,
		y: viewport.y + deltaY,
		k: viewport.k
	};
}
/** Bounding box of a set of cards, or undefined for an empty board. */
function cardBounds(cards) {
	if (cards.length === 0) return void 0;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const card of cards) {
		minX = Math.min(minX, card.x);
		minY = Math.min(minY, card.y);
		maxX = Math.max(maxX, card.x + card.width);
		maxY = Math.max(maxY, card.y + card.height);
	}
	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY
	};
}
/**
* Compute the viewport that shows every card with a little padding.
* @param stageWidth - visible area width in screen pixels.
* @param stageHeight - visible area height in screen pixels.
* @returns the fitted viewport; the identity viewport for an empty board or a
*   degenerate stage.
*/
function fitViewport(cards, stageWidth, stageHeight, padding = FIT_PADDING) {
	if (cards.length === 0 || stageWidth <= 0 || stageHeight <= 0) return {
		x: 0,
		y: 0,
		k: 1
	};
	const bounds = cardBounds(cards);
	if (bounds === void 0 || bounds.width <= 0 || bounds.height <= 0) return {
		x: 0,
		y: 0,
		k: 1
	};
	const availableWidth = Math.max(1, stageWidth - 2 * padding);
	const availableHeight = Math.max(1, stageHeight - 2 * padding);
	const k = clampZoom(Math.min(availableWidth / bounds.width, availableHeight / bounds.height));
	return {
		x: Math.round((-bounds.x * k + (stageWidth - bounds.width * k) / 2) * 100) / 100,
		y: Math.round((-bounds.y * k + (stageHeight - bounds.height * k) / 2) * 100) / 100,
		k
	};
}

//#endregion
//#region src/canvas-placement.ts
/**
* Build the card for one picture, centred on the given board point.
* @param image - the picture to place.
* @param centre - board coordinates of the stage centre.
* @param id - the card id to use.
* @returns the card, sized to the picture's own aspect ratio.
*/
function centeredImageCard(image, centre, id) {
	const aspect = image.width !== void 0 && image.height !== void 0 && image.height > 0 ? image.width / image.height : 1;
	const height = Math.round(CANVAS_NEW_IMAGE_SIZE / aspect);
	return {
		id,
		kind: "image",
		x: Math.round(centre.x - CANVAS_NEW_IMAGE_SIZE / 2),
		y: Math.round(centre.y - height / 2),
		width: CANVAS_NEW_IMAGE_SIZE,
		height,
		z: 0,
		file: image.file,
		model: image.model ?? "",
		prompt: image.prompt ?? "",
		...image.origin === void 0 ? {} : { origin: image.origin }
	};
}
/**
* Board coordinates of the visible centre.
* @param viewport - the board's viewport.
* @param stage - visible stage size in screen pixels.
* @returns the board point at the middle of the stage.
*/
function stageCentre(viewport, stage) {
	return screenToBoard(viewport, stage.width / 2, stage.height / 2);
}
/**
* Stage size assumed when nothing measurable is on screen yet.
*
* Halving a real stage puts a picture in the middle of what the user sees;
* halving a ZERO stage puts it exactly on the viewport's top-left corner, which
* is the "why did it land in the corner" bug. Assuming a plausible panel size
* keeps it near the middle even before the canvas has been laid out.
*/
const ASSUMED_STAGE = {
	width: 960,
	height: 640
};
/**
* The stage size to place against, falling back when nothing is measured.
* @param measured - the last measurement (may be zero before layout).
* @returns a usable size.
*/
function usableStage(measured) {
	return measured.width > 0 && measured.height > 0 ? measured : { ...ASSUMED_STAGE };
}

//#endregion
//#region src/client/annotations.ts
/** The palette (three colours keeps the toolbar a row, not a picker). */
const ANNOTATION_COLORS = [
	"#ff3b30",
	"#ffcc00",
	"#0a84ff"
];
/** The three widths, in editor pixels. */
const ANNOTATION_WIDTHS = [
	4,
	8,
	16
];
/** How far from an object's edge still counts as a hit (picture pixels). */
const HIT_TOLERANCE = 6;
/** Font family for text marks; must match what the burn uses. */
const TEXT_FONT_FAMILY = "system-ui, sans-serif";
/** The bounding box of one object. */
function annotationBounds(annotation) {
	if (annotation.kind === "rect") return {
		x: annotation.x,
		y: annotation.y,
		width: annotation.width,
		height: annotation.height
	};
	if (annotation.kind === "text") return {
		x: annotation.x,
		y: annotation.y,
		width: annotation.text.length * annotation.sizePx,
		height: annotation.sizePx * 1.25
	};
	if (annotation.kind === "arrow") {
		const minX$1 = Math.min(annotation.from.x, annotation.to.x);
		const minY$1 = Math.min(annotation.from.y, annotation.to.y);
		const pad = annotation.sizePx * 2;
		return {
			x: minX$1 - pad,
			y: minY$1 - pad,
			width: Math.abs(annotation.to.x - annotation.from.x) + pad * 2,
			height: Math.abs(annotation.to.y - annotation.from.y) + pad * 2
		};
	}
	const xs = annotation.points.map((point) => point.x);
	const ys = annotation.points.map((point) => point.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	return {
		x: minX - annotation.sizePx / 2,
		y: minY - annotation.sizePx / 2,
		width: Math.max(...xs) - minX + annotation.sizePx,
		height: Math.max(...ys) - minY + annotation.sizePx
	};
}
/** Move one object by a picture-pixel delta. */
function moveAnnotation(annotation, dx, dy) {
	if (annotation.kind === "brush") return {
		...annotation,
		points: annotation.points.map((point) => ({
			x: point.x + dx,
			y: point.y + dy
		}))
	};
	if (annotation.kind === "arrow") return {
		...annotation,
		from: {
			x: annotation.from.x + dx,
			y: annotation.from.y + dy
		},
		to: {
			x: annotation.to.x + dx,
			y: annotation.to.y + dy
		}
	};
	return {
		...annotation,
		x: annotation.x + dx,
		y: annotation.y + dy
	};
}
/** Distance from a point to a segment, in picture pixels. */
function distanceToSegment(point, from, to) {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);
	const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
	return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}
/** Whether a point (picture pixels) lands on one object. */
function hitAnnotation(annotation, point) {
	if (annotation.kind === "arrow") return distanceToSegment(point, annotation.from, annotation.to) <= annotation.sizePx * 1.5 + HIT_TOLERANCE;
	const bounds = annotationBounds(annotation);
	return point.x >= bounds.x - HIT_TOLERANCE && point.x <= bounds.x + bounds.width + HIT_TOLERANCE && point.y >= bounds.y - HIT_TOLERANCE && point.y <= bounds.y + bounds.height + HIT_TOLERANCE;
}
/** The topmost object under a point, if any (later objects are on top). */
function annotationAt(annotations, point) {
	for (let index = annotations.length - 1; index >= 0; index -= 1) if (hitAnnotation(annotations[index], point)) return index;
}
/** Every object under a point, topmost first (the eraser takes them all). */
function annotationsAt(annotations, point) {
	const hits = [];
	for (let index = annotations.length - 1; index >= 0; index -= 1) if (hitAnnotation(annotations[index], point)) hits.push(index);
	return hits;
}
/**
* The head of an arrow, as a filled triangle in picture pixels.
*
* Shared by the editor's SVG and the burn so the mark the user sees is the mark
* that gets painted.
*
* @param from - the tail.
* @param to - the tip.
* @param sizePx - the shaft width (the head scales from it).
* @returns the three corners of the head, tip last.
*/
function arrowHeadPoints(from, to, sizePx) {
	const angle = Math.atan2(to.y - from.y, to.x - from.x);
	const length = Math.max(sizePx * 3, 10);
	const half = Math.max(sizePx * 1.6, 6);
	const baseX = to.x - Math.cos(angle) * length;
	const baseY = to.y - Math.sin(angle) * length;
	const normalX = -Math.sin(angle) * half;
	const normalY = Math.cos(angle) * half;
	return [
		{
			x: baseX + normalX,
			y: baseY + normalY
		},
		{
			x: baseX - normalX,
			y: baseY - normalY
		},
		{
			x: to.x,
			y: to.y
		}
	];
}
/**
* Convert the editor's stroke widths into picture pixels.
*
* The user picks a width that LOOKS right on screen, so it has to be scaled by
* how much the editor shrinks the picture; otherwise the same choice produces a
* hairline on a 4K image and a slab on a thumbnail.
*
* @param sizePx - the width chosen in the editor.
* @param scale - picture pixels per editor pixel (natural / displayed).
* @returns the width to store on the object.
*/
function scaleWidth(sizePx, scale) {
	return Math.max(1, sizePx * (Number.isFinite(scale) && scale > 0 ? scale : 1));
}
/** Whether anything was drawn (an empty session must not produce a copy). */
function hasAnnotations(annotations) {
	return annotations.some((annotation) => annotation.kind !== "brush" || annotation.points.length > 0) && annotations.some((annotation) => annotation.kind !== "text" || annotation.text.trim() !== "");
}

//#endregion
//#region src/client/burn-image.ts
/** Load one picture for the canvas to draw. */
async function loadImage(url) {
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => {
			resolve(image);
		};
		image.onerror = () => {
			resolve(void 0);
		};
		image.src = url;
	});
}
/**
* Draw a picture onto an offscreen canvas and export it as a PNG data URL.
*
* @param url - where the picture is served from.
* @param paint - draws on top of the picture (receives the 2D context and size).
* @param source - sub-rectangle to take instead of the whole picture (a crop).
* @returns the burned picture, or undefined when it could not be loaded.
*/
async function burn(url, paint, source) {
	const image = await loadImage(url);
	if (image === void 0) return void 0;
	const naturalWidth = image.naturalWidth === 0 ? image.width : image.naturalWidth;
	const naturalHeight = image.naturalHeight === 0 ? image.height : image.naturalHeight;
	const rect = source ?? {
		x: 0,
		y: 0,
		width: naturalWidth,
		height: naturalHeight
	};
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(rect.width));
	canvas.height = Math.max(1, Math.round(rect.height));
	const context = canvas.getContext("2d");
	if (context === null) return void 0;
	context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
	paint(context, canvas.width, canvas.height);
	return {
		dataUrl: canvas.toDataURL("image/png"),
		width: canvas.width,
		height: canvas.height
	};
}
/**
* Burn every annotation onto a copy of the picture, in list order.
*
* @param url - where the picture is served from.
* @param annotations - the marks, in picture pixels.
* @returns the composite, or undefined when the picture could not be loaded.
*/
async function burnAnnotations(url, annotations) {
	return burn(url, (context, width, height) => {
		for (const annotation of annotations) {
			if (annotation.kind === "rect") {
				const inset = annotation.sizePx / 2;
				context.strokeStyle = annotation.color;
				context.lineWidth = annotation.sizePx;
				context.strokeRect(annotation.x + inset, annotation.y + inset, Math.max(1, annotation.width - annotation.sizePx), Math.max(1, annotation.height - annotation.sizePx));
				continue;
			}
			if (annotation.kind === "brush") {
				if (annotation.points.length === 0) continue;
				context.strokeStyle = annotation.color;
				context.fillStyle = annotation.color;
				context.lineWidth = annotation.sizePx;
				context.lineCap = "round";
				context.lineJoin = "round";
				const [first, ...rest] = annotation.points;
				if (rest.length === 0) {
					context.beginPath();
					context.arc(first.x, first.y, annotation.sizePx / 2, 0, Math.PI * 2);
					context.fill();
					continue;
				}
				context.beginPath();
				context.moveTo(first.x, first.y);
				for (const point of rest) context.lineTo(point.x, point.y);
				context.stroke();
				continue;
			}
			if (annotation.kind === "arrow") {
				const [left, right, tip] = arrowHeadPoints(annotation.from, annotation.to, annotation.sizePx);
				context.strokeStyle = annotation.color;
				context.fillStyle = annotation.color;
				context.lineWidth = annotation.sizePx;
				context.lineCap = "round";
				context.beginPath();
				context.moveTo(annotation.from.x, annotation.from.y);
				context.lineTo(annotation.to.x, annotation.to.y);
				context.stroke();
				context.beginPath();
				context.moveTo(left.x, left.y);
				context.lineTo(right.x, right.y);
				context.lineTo(tip.x, tip.y);
				context.closePath();
				context.fill();
				continue;
			}
			if (annotation.text.trim() === "") continue;
			context.fillStyle = annotation.color;
			context.textBaseline = "top";
			context.font = `${annotation.sizePx}px ${TEXT_FONT_FAMILY}`;
			context.fillText(annotation.text, annotation.x, annotation.y);
		}
	});
}
/**
* Cut a sub-rectangle out of the picture.
*
* @param url - where the picture is served from.
* @param rect - the crop box in picture pixels.
* @returns the cropped picture, or undefined when it could not be loaded.
*/
async function burnCrop(url, rect) {
	return burn(url, () => {}, rect);
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\annotation-editor.module.css.mjs
const css$12 = "._2rIzNq_overlay{z-index:30;background:color-mix(in srgb, var(--dsw-alias-bg-overlay,#000) 45%, transparent);justify-content:center;align-items:center;padding:10px;display:flex;position:absolute;inset:0}._2rIzNq_panel{border:1px solid var(--dsw-alias-border-l1,currentColor);background:var(--dsw-alias-bg-layer-2,Canvas);width:min(100%,1000px);max-height:100%;box-shadow:0 18px 48px var(--dsw-alias-bg-overlay,#00000052);border-radius:12px;flex-direction:column;display:flex;overflow:hidden}._2rIzNq_toolbar{border-bottom:1px solid var(--dsw-alias-border-l1,currentColor);background:var(--dsw-alias-bg-layer-1,#7f7f7f0f);flex-wrap:wrap;align-items:center;gap:6px;padding:10px 12px;display:flex}._2rIzNq_tool{border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-2,#7f7f7f1a);color:var(--dsw-alias-label-primary,inherit);font:inherit;cursor:pointer;border-radius:6px;padding:4px 10px;font-size:12px}._2rIzNq_tool[data-active=true]{border-color:var(--dsw-alias-brand-primary,currentColor);color:var(--dsw-alias-brand-primary,inherit)}._2rIzNq_swatch{border:2px solid var(--dsw-alias-border-l2,currentColor);cursor:pointer;border-radius:50%;width:22px;height:22px}._2rIzNq_swatch[data-active=true]{border-color:var(--dsw-alias-brand-primary,currentColor);outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:1px}._2rIzNq_gap{flex:1}._2rIzNq_stage{flex:1;justify-content:center;align-items:center;min-height:0;padding:16px;display:flex}._2rIzNq_frame{max-width:100%;max-height:100%;line-height:0;position:relative}._2rIzNq_picture{object-fit:contain;border-radius:8px;max-width:100%;max-height:64vh}._2rIzNq_surface{cursor:crosshair;touch-action:none;width:100%;height:100%;position:absolute;inset:0}._2rIzNq_textEntry{min-width:160px;position:absolute;transform:translateY(-2px)}._2rIzNq_hint{color:var(--dsw-alias-label-secondary,inherit);margin:0;padding:0 12px 12px;font-size:12px;line-height:1.6}";
const tagId$12 = "dsh-seework/annotation-editor.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$12) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$12;
	tag.textContent = css$12;
	document.head.appendChild(tag);
}
var annotation_editor_module_css_default = {
	"tool": "_2rIzNq_tool",
	"swatch": "_2rIzNq_swatch",
	"toolbar": "_2rIzNq_toolbar",
	"panel": "_2rIzNq_panel",
	"stage": "_2rIzNq_stage",
	"overlay": "_2rIzNq_overlay",
	"frame": "_2rIzNq_frame",
	"picture": "_2rIzNq_picture",
	"gap": "_2rIzNq_gap",
	"surface": "_2rIzNq_surface",
	"textEntry": "_2rIzNq_textEntry",
	"hint": "_2rIzNq_hint"
};

//#endregion
//#region src/client/AnnotationEditor.tsx
/**
* The editor overlay.
* @param props - the picture and what to do when the user saves or cancels.
* @returns the editor.
*/
function AnnotationEditor(props) {
	const [tool, setTool] = (0, react.useState)("brush");
	const [color, setColor] = (0, react.useState)(ANNOTATION_COLORS[0]);
	const [width, setWidth] = (0, react.useState)(ANNOTATION_WIDTHS[1]);
	const [objects, setObjects] = (0, react.useState)([]);
	const [selected, setSelected] = (0, react.useState)(void 0);
	const [draft, setDraft] = (0, react.useState)(void 0);
	const [text, setText] = (0, react.useState)(void 0);
	const [natural, setNatural] = (0, react.useState)(props.natural ?? {
		width: 1024,
		height: 1024
	});
	const [saving, setSaving] = (0, react.useState)(false);
	const [past, setPast] = (0, react.useState)([]);
	const [future, setFuture] = (0, react.useState)([]);
	const surfaceRef = (0, react.useRef)(null);
	const dragRef = (0, react.useRef)(void 0);
	/**
	* The in-progress object, kept in a ref as well as in state.
	*
	* The pointer-up handler has to see what the moves produced, and a gesture can
	* deliver down/move/up inside one task (a fast drag, or a scripted one) — a
	* state closure would still hold the pre-gesture value and drop the object.
	*/
	const draftRef = (0, react.useRef)(void 0);
	/**
	* Where the text tool was pressed, waiting for the release.
	*
	* The text box is deliberately created on pointer UP, not on pointer down: the
	* browser moves focus on `mousedown`, which lands right after `pointerdown`. A
	* box created on the press is therefore mounted and then blurred inside the very
	* same click — the input's `autoFocus` never survives and nobody can type. By
	* release time that focus shift is over and the box keeps the caret.
	*/
	const textPointRef = (0, react.useRef)(void 0);
	/**
	* Whether the press in flight is the one that confirmed an open text box.
	*
	* Confirming and arming happen in two different React listeners — capture, then
	* bubble — and React re-renders in between, so the bubble handler sees a fresh
	* world where no box is open. Without this flag the same press would confirm one
	* label and immediately open the next box.
	*/
	const textPressUsedRef = (0, react.useRef)(false);
	const commitDraft = (next) => {
		draftRef.current = next;
		setDraft(next);
	};
	(0, react.useEffect)(() => {
		const image = new Image();
		image.onload = () => {
			if (image.naturalWidth > 0 && image.naturalHeight > 0) setNatural({
				width: image.naturalWidth,
				height: image.naturalHeight
			});
		};
		image.src = props.url;
	}, [props.url]);
	const commit = (next) => {
		setPast((history) => [...history, objects]);
		setFuture([]);
		setObjects(next);
		setSelected(void 0);
	};
	const undo = () => {
		if (past.length === 0) return;
		const previous = past[past.length - 1];
		setPast((history) => history.slice(0, -1));
		setFuture((stack) => [objects, ...stack]);
		setObjects(previous);
		setSelected(void 0);
	};
	const redo = () => {
		if (future.length === 0) return;
		const next = future[0];
		setFuture((stack) => stack.slice(1));
		setPast((history) => [...history, objects]);
		setObjects(next);
		setSelected(void 0);
	};
	(0, react.useEffect)(() => {
		const onKey = (event) => {
			if (text !== void 0) {
				if (event.key === "Escape") setText(void 0);
				return;
			}
			if (event.key === "Escape") props.onCancel();
			if (event.key === "z" && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				if (event.shiftKey) redo();
				else undo();
			}
			if ((event.key === "Delete" || event.key === "Backspace") && selected !== void 0) {
				event.preventDefault();
				commit(objects.filter((_object, index) => index !== selected));
			}
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
		};
	});
	/** Pointer position in picture pixels. */
	const toPicture = (event) => {
		const surface = surfaceRef.current;
		if (surface === null) return {
			x: 0,
			y: 0
		};
		const rect = surface.getBoundingClientRect();
		const scaleX = rect.width === 0 ? 1 : natural.width / rect.width;
		const scaleY = rect.height === 0 ? 1 : natural.height / rect.height;
		return {
			x: Math.min(natural.width, Math.max(0, (event.clientX - rect.left) * scaleX)),
			y: Math.min(natural.height, Math.max(0, (event.clientY - rect.top) * scaleY))
		};
	};
	/** How much the editor shrinks the picture (for converting stroke widths). */
	const editorScale = () => {
		const surface = surfaceRef.current;
		if (surface === null) return 1;
		const rect = surface.getBoundingClientRect();
		return rect.width === 0 ? 1 : natural.width / rect.width;
	};
	const onPointerDown = (event) => {
		const point = toPicture(event);
		if (textPressUsedRef.current) {
			textPressUsedRef.current = false;
			return;
		}
		if (text !== void 0) return;
		if (tool === "text") {
			textPointRef.current = point;
			return;
		}
		if (tool === "eraser") {
			dragRef.current = { kind: "erase" };
			eraseAt(point);
			return;
		}
		if (tool === "brush") {
			dragRef.current = {
				kind: "brush",
				points: [point]
			};
			commitDraft({
				kind: "brush",
				color,
				sizePx: scaleWidth(width, editorScale()),
				points: [point]
			});
			return;
		}
		if (tool === "arrow") {
			dragRef.current = {
				kind: "arrow",
				start: point,
				current: point
			};
			setSelected(void 0);
			commitDraft({
				kind: "arrow",
				color,
				sizePx: scaleWidth(width, editorScale()),
				from: point,
				to: point
			});
			return;
		}
		const hit = annotationAt(objects, point);
		if (hit !== void 0) {
			dragRef.current = {
				kind: "move",
				index: hit,
				last: point,
				moved: false
			};
			setSelected(hit);
			return;
		}
		dragRef.current = {
			kind: "rect",
			start: point,
			current: point
		};
		setSelected(void 0);
		commitDraft({
			kind: "rect",
			color,
			sizePx: scaleWidth(width, editorScale()),
			x: point.x,
			y: point.y,
			width: 0,
			height: 0
		});
	};
	/** Remove every object under one point, as one undoable step. */
	const eraseAt = (point) => {
		const hits = annotationsAt(objects, point);
		if (hits.length === 0) return;
		commit(objects.filter((_object, index) => !hits.includes(index)));
	};
	const onPointerMove = (event) => {
		const drag = dragRef.current;
		if (drag === void 0) return;
		const point = toPicture(event);
		if (drag.kind === "erase") {
			eraseAt(point);
			return;
		}
		if (drag.kind === "brush") {
			drag.points.push(point);
			const current = draftRef.current;
			if (current?.kind === "brush") commitDraft({
				...current,
				points: [...drag.points]
			});
			return;
		}
		if (drag.kind === "rect") {
			drag.current = point;
			commitDraft({
				kind: "rect",
				color,
				sizePx: scaleWidth(width, editorScale()),
				x: Math.min(drag.start.x, point.x),
				y: Math.min(drag.start.y, point.y),
				width: Math.abs(point.x - drag.start.x),
				height: Math.abs(point.y - drag.start.y)
			});
			return;
		}
		if (drag.kind === "arrow") {
			drag.current = point;
			commitDraft({
				kind: "arrow",
				color,
				sizePx: scaleWidth(width, editorScale()),
				from: drag.start,
				to: point
			});
			return;
		}
		const dx = point.x - drag.last.x;
		const dy = point.y - drag.last.y;
		if (dx === 0 && dy === 0) return;
		drag.last = point;
		drag.moved = true;
		setObjects((current) => current.map((object, index) => index === drag.index ? moveAnnotation(object, dx, dy) : object));
	};
	const onPointerUp = () => {
		if (tool === "text") {
			const point = textPointRef.current;
			textPointRef.current = void 0;
			if (point !== void 0) setText({
				point,
				value: ""
			});
			return;
		}
		const drag = dragRef.current;
		dragRef.current = void 0;
		if (drag === void 0) return;
		if (drag.kind === "move") {
			if (drag.moved) {
				setFuture([]);
				setPast((history) => [...history, objects]);
			}
			return;
		}
		const pending = draftRef.current;
		commitDraft(void 0);
		if (pending === void 0) return;
		if (pending.kind === "rect" && (pending.width < 4 || pending.height < 4)) return;
		if (pending.kind === "arrow" && Math.hypot(pending.to.x - pending.from.x, pending.to.y - pending.from.y) < 6) return;
		commit([...objects, pending]);
	};
	const commitText = () => {
		const pending = text;
		setText(void 0);
		if (pending === void 0 || pending.value.trim() === "") return;
		commit([...objects, {
			kind: "text",
			color,
			sizePx: scaleWidth(width, editorScale()),
			x: pending.point.x,
			y: pending.point.y,
			text: pending.value.trim()
		}]);
	};
	const visible = (0, react.useMemo)(() => draft === void 0 ? objects : [...objects, draft], [draft, objects]);
	/**
	* Pressing anywhere outside the text box finishes the label.
	*
	* This replaces an `onBlur` commit, which could not survive a real click: the
	* browser's own `mousedown` focus handling blurred a freshly mounted box and the
	* handler threw the (still empty) typing away. Capture phase, so the press that
	* closes the box cannot also start a new one.
	*/
	const onOverlayPointerDown = (event) => {
		textPressUsedRef.current = false;
		if (text === void 0) return;
		const target = event.target;
		if (target instanceof Element && target.closest("[data-dsh-seework-annotation-text]") !== null) return;
		textPressUsedRef.current = true;
		commitText();
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: annotation_editor_module_css_default.overlay,
		role: "dialog",
		"aria-modal": "true",
		"aria-label": "标注编辑器",
		onPointerDownCapture: onOverlayPointerDown,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: annotation_editor_module_css_default.panel,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: annotation_editor_module_css_default.toolbar,
					"data-dsh-seework-annotation-toolbar": "",
					children: [
						[
							["brush", "画笔"],
							["rect", "矩形"],
							["arrow", "箭头"],
							["text", "文字"],
							["eraser", "橡皮擦"]
						].map(([value, label]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: annotation_editor_module_css_default.tool,
							"data-active": tool === value ? "true" : void 0,
							"data-tool": value,
							onClick: () => {
								setTool(value);
							},
							children: label
						}, value)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: annotation_editor_module_css_default.gap }),
						ANNOTATION_COLORS.map((swatch) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: annotation_editor_module_css_default.swatch,
							style: { background: swatch },
							title: `颜色 ${swatch}`,
							"aria-label": `颜色 ${swatch}`,
							"data-active": color === swatch ? "true" : void 0,
							onClick: () => {
								setColor(swatch);
							}
						}, swatch)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: annotation_editor_module_css_default.gap }),
						ANNOTATION_WIDTHS.map((size) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: annotation_editor_module_css_default.tool,
							"data-active": width === size ? "true" : void 0,
							title: `粗细 ${size}`,
							onClick: () => {
								setWidth(size);
							},
							children: size
						}, size)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: annotation_editor_module_css_default.gap }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
							onClick: undo,
							disabled: past.length === 0,
							title: "撤销（Ctrl+Z）",
							children: "撤销"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
							onClick: redo,
							disabled: future.length === 0,
							title: "重做（Ctrl+Shift+Z）",
							children: "重做"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
							onClick: props.onCancel,
							children: "取消"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
							variant: "primary",
							disabled: saving || !hasAnnotations(objects),
							"data-dsh-seework-annotation-save": "",
							onClick: () => {
								setSaving(true);
								burnAnnotations(props.url, objects).then((burned) => burned === void 0 ? void 0 : props.onSave(burned.dataUrl)).finally(() => {
									setSaving(false);
								});
							},
							children: saving ? "保存中…" : "保存为合成图"
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: annotation_editor_module_css_default.stage,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: annotation_editor_module_css_default.frame,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								className: annotation_editor_module_css_default.picture,
								src: props.url,
								alt: "待标注的图片",
								draggable: false
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
								ref: surfaceRef,
								className: annotation_editor_module_css_default.surface,
								viewBox: `0 0 ${natural.width} ${natural.height}`,
								preserveAspectRatio: "none",
								onPointerDown,
								onPointerMove,
								onPointerUp,
								onPointerLeave: onPointerUp,
								children: visible.map((object, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AnnotationShape, { annotation: object }, index))
							}),
							text === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: annotation_editor_module_css_default.textEntry,
								"data-dsh-seework-annotation-text": "",
								style: {
									left: `${text.point.x / natural.width * 100}%`,
									top: `${text.point.y / natural.height * 100}%`
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
									autoFocus: true,
									value: text.value,
									placeholder: "输入文字，回车确认，Esc 取消",
									onChange: (event) => {
										setText((current) => current === void 0 ? current : {
											...current,
											value: event.target.value
										});
									},
									onKeyDown: (event) => {
										if (event.key === "Enter") commitText();
										if (event.key === "Escape") {
											event.stopPropagation();
											event.preventDefault();
											setText(void 0);
										}
									}
								})
							})
						]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: annotation_editor_module_css_default.hint,
					children: ["五种标注可以混用：画笔涂抹、矩形框选、箭头指向、文字说明、橡皮擦按对象擦除（都可撤销）。保存会生成一张合成图作为**新**卡片，原图与素材库都不动。 文字框里回车确认、Esc 取消输入（不会关掉编辑器）、点框外即确认。", selected === void 0 ? "" : "　已选中一个标注：拖动可移动，Delete 删除。"]
				})
			]
		})
	});
}
/** One annotation drawn into the SVG overlay. */
function AnnotationShape({ annotation }) {
	if (annotation.kind === "rect") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
		x: annotation.x,
		y: annotation.y,
		width: annotation.width,
		height: annotation.height,
		fill: "none",
		stroke: annotation.color,
		strokeWidth: annotation.sizePx
	});
	if (annotation.kind === "text") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
		x: annotation.x,
		y: annotation.y,
		fill: annotation.color,
		fontSize: annotation.sizePx,
		dominantBaseline: "hanging",
		children: annotation.text
	});
	if (annotation.kind === "arrow") {
		const [left, right, tip] = arrowHeadPoints(annotation.from, annotation.to, annotation.sizePx);
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
			x1: annotation.from.x,
			y1: annotation.from.y,
			x2: annotation.to.x,
			y2: annotation.to.y,
			stroke: annotation.color,
			strokeWidth: annotation.sizePx,
			strokeLinecap: "round"
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polygon", {
			points: `${left.x},${left.y} ${right.x},${right.y} ${tip.x},${tip.y}`,
			fill: annotation.color
		})] });
	}
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", {
		points: annotation.points.map((point) => `${point.x},${point.y}`).join(" "),
		fill: "none",
		stroke: annotation.color,
		strokeWidth: annotation.sizePx,
		strokeLinecap: "round",
		strokeLinejoin: "round"
	});
}

//#endregion
//#region src/client/crop-rect.ts
/** The ratio menu, mirroring the reference client's list. */
const CROP_ASPECTS = [
	{
		label: "自定义",
		value: null
	},
	{
		label: "1:1",
		value: 1
	},
	{
		label: "4:3",
		value: 4 / 3
	},
	{
		label: "3:4",
		value: 3 / 4
	},
	{
		label: "16:9",
		value: 16 / 9
	},
	{
		label: "9:16",
		value: 9 / 16
	}
];
/** Smallest crop box (picture pixels), so a stray drag cannot produce nothing. */
const MIN_CROP_SIZE = 16;
/** All handles, in outline order. */
const CROP_HANDLES = [
	"nw",
	"n",
	"ne",
	"e",
	"se",
	"s",
	"sw",
	"w"
];
/** Which directions a handle moves. */
const HANDLE_AXES = {
	nw: {
		x: -1,
		y: -1
	},
	n: {
		x: 0,
		y: -1
	},
	ne: {
		x: 1,
		y: -1
	},
	e: {
		x: 1,
		y: 0
	},
	se: {
		x: 1,
		y: 1
	},
	s: {
		x: 0,
		y: 1
	},
	sw: {
		x: -1,
		y: 1
	},
	w: {
		x: -1,
		y: 0
	}
};
/** Keep a box inside the picture. */
function clampRect(rect, natural) {
	const width = Math.min(Math.max(MIN_CROP_SIZE, rect.width), natural.width);
	const height = Math.min(Math.max(MIN_CROP_SIZE, rect.height), natural.height);
	return {
		width,
		height,
		x: Math.min(Math.max(0, rect.x), Math.max(0, natural.width - width)),
		y: Math.min(Math.max(0, rect.y), Math.max(0, natural.height - height))
	};
}
/**
* The box a crop mode starts with: the whole picture, or the largest box of the
* requested ratio that fits in it.
*
* @param natural - the picture's natural size.
* @param aspect - width / height, or null for the whole picture.
* @returns the starting box.
*/
function defaultCropRect(natural, aspect) {
	if (aspect === null) return {
		x: 0,
		y: 0,
		width: natural.width,
		height: natural.height
	};
	const byWidth = {
		width: natural.width,
		height: natural.width / aspect
	};
	const size = byWidth.height <= natural.height ? byWidth : {
		width: natural.height * aspect,
		height: natural.height
	};
	return clampRect({
		x: (natural.width - size.width) / 2,
		y: (natural.height - size.height) / 2,
		width: size.width,
		height: size.height
	}, natural);
}
/**
* Move the box, keeping it inside the picture.
* @param rect - the current box.
* @param dx - pointer delta in picture pixels.
* @param dy - pointer delta in picture pixels.
* @param natural - the picture's natural size.
* @returns the moved box.
*/
function moveCropRect(rect, dx, dy, natural) {
	return clampRect({
		...rect,
		x: rect.x + dx,
		y: rect.y + dy
	}, natural);
}
/**
* Resize the box by one handle.
*
* The anchor (the opposite edge/corner) stays put, which is what makes dragging a
* handle feel like resizing rather than moving; with a fixed ratio the box grows
* along the dominant axis and stays inside the picture.
*
* @param rect - the current box.
* @param handle - which handle is being dragged.
* @param dx - pointer delta in picture pixels.
* @param dy - pointer delta in picture pixels.
* @param natural - the picture's natural size.
* @param aspect - width / height, or null for a free box.
* @returns the resized box.
*/
function resizeCropRect(rect, handle, dx, dy, natural, aspect) {
	const axes = HANDLE_AXES[handle];
	let width = axes.x === 0 ? rect.width : rect.width + dx * axes.x;
	let height = axes.y === 0 ? rect.height : rect.height + dy * axes.y;
	if (aspect !== null) {
		const byWidth = {
			width,
			height: width / aspect
		};
		const byHeight = {
			width: height * aspect,
			height
		};
		const chosen = Math.abs(dx) >= Math.abs(dy) ? byWidth : byHeight;
		width = chosen.width;
		height = chosen.height;
	}
	width = Math.max(MIN_CROP_SIZE, width);
	height = Math.max(MIN_CROP_SIZE, height);
	return clampRect({
		x: axes.x === 0 ? rect.x : axes.x < 0 ? rect.x + rect.width - width : rect.x,
		y: axes.y === 0 ? rect.y : axes.y < 0 ? rect.y + rect.height - height : rect.y,
		width,
		height
	}, natural);
}
/**
* The displayed position of the box inside a node.
*
* @param rect - the box in picture pixels.
* @param node - the node's displayed size on screen.
* @param natural - the picture's natural size.
* @returns screen-space offsets relative to the node's top-left corner.
*/
function cropRectToNode(rect, node, natural) {
	const scaleX = natural.width === 0 ? 1 : node.width / natural.width;
	const scaleY = natural.height === 0 ? 1 : node.height / natural.height;
	return {
		x: rect.x * scaleX,
		y: rect.y * scaleY,
		width: rect.width * scaleX,
		height: rect.height * scaleY
	};
}
/**
* Where a crop's new node goes: to the right of the original, same top edge.
*
* Non-destructive by construction — the crop is a NEW node next to the picture it
* came from, so the user can compare them.
*
* @param source - the original card's board rectangle.
* @param size - the new node's size.
* @returns the new node's top-left corner.
*/
function cropNodePosition(source, size) {
	return {
		x: source.x + source.width + 24,
		y: source.y
	};
}
/**
* The displayed size of a crop's node: the crop's own aspect ratio, at a size
* comparable to the picture it came from.
*
* @param rect - the crop box in picture pixels.
* @param maxWidth - the widest the new node may be on the board.
* @returns the node's board size.
*/
function croppedNodeSize(rect, maxWidth = 320) {
	const aspect = rect.height === 0 ? 1 : rect.width / rect.height;
	const width = Math.max(48, Math.min(maxWidth, rect.width));
	return {
		width: Math.round(width),
		height: Math.round(width / aspect)
	};
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\crop-overlay.module.css.mjs
const css$11 = ".XFdWdq_box{z-index:15;border:1px solid var(--dsw-alias-brand-primary,#fff);cursor:move;touch-action:none;position:absolute;box-shadow:0 0 0 9999px #00000059}.XFdWdq_thirdV,.XFdWdq_thirdH{background:color-mix(in srgb, var(--dsw-alias-brand-primary,#fff) 45%, transparent);pointer-events:none;position:absolute}.XFdWdq_thirdV{width:1px;top:0;bottom:0}.XFdWdq_thirdV:not([data-second]){left:33.333%}.XFdWdq_thirdV[data-second]{left:66.666%}.XFdWdq_thirdH{height:1px;left:0;right:0}.XFdWdq_thirdH:not([data-second]){top:33.333%}.XFdWdq_thirdH[data-second]{top:66.666%}.XFdWdq_handle{border:1px solid var(--dsw-alias-brand-primary,#fff);background:var(--dsw-alias-bg-base,#fff);touch-action:none;border-radius:2px;width:10px;height:10px;margin:-5px 0 0 -5px;position:absolute}.XFdWdq_handle[data-handle=nw]{top:0;left:0}.XFdWdq_handle[data-handle=n]{top:0;left:50%}.XFdWdq_handle[data-handle=ne]{top:0;left:100%}.XFdWdq_handle[data-handle=e]{top:50%;left:100%}.XFdWdq_handle[data-handle=se]{top:100%;left:100%}.XFdWdq_handle[data-handle=s]{top:100%;left:50%}.XFdWdq_handle[data-handle=sw]{top:100%;left:0}.XFdWdq_handle[data-handle=w]{top:50%;left:0}.XFdWdq_toolbar{z-index:16;border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-button-elevated-fill,var(--dsw-alias-bg-layer-2,Canvas));white-space:nowrap;border-radius:8px;align-items:center;gap:8px;padding:6px 8px;display:flex;position:absolute;box-shadow:0 4px 16px #00000038}.XFdWdq_select{border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-1,Canvas);color:var(--dsw-alias-label-primary,inherit);font:inherit;border-radius:6px;padding:3px 6px;font-size:12px}.XFdWdq_size{color:var(--dsw-alias-label-tertiary,inherit);font-variant-numeric:tabular-nums;font-size:11px}";
const tagId$11 = "dsh-seework/crop-overlay.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$11) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$11;
	tag.textContent = css$11;
	document.head.appendChild(tag);
}
var crop_overlay_module_css_default = {
	"size": "XFdWdq_size",
	"box": "XFdWdq_box",
	"thirdH": "XFdWdq_thirdH",
	"handle": "XFdWdq_handle",
	"thirdV": "XFdWdq_thirdV",
	"toolbar": "XFdWdq_toolbar",
	"select": "XFdWdq_select"
};

//#endregion
//#region src/client/CropOverlay.tsx
/** Which direction each handle drags, for the cursor only. */
const HANDLE_CURSORS = {
	nw: "nwse-resize",
	n: "ns-resize",
	ne: "nesw-resize",
	e: "ew-resize",
	se: "nwse-resize",
	s: "ns-resize",
	sw: "nesw-resize",
	w: "ew-resize"
};
/**
* The crop box and its toolbar for one node.
* @param props - the node, the picture size, and what to do on confirm/cancel.
* @returns the overlay.
*/
function CropOverlay(props) {
	const [aspect, setAspect] = (0, react.useState)(null);
	const [rect, setRect] = (0, react.useState)(() => defaultCropRect(props.natural, null));
	const dragRef = (0, react.useRef)(void 0);
	/** Picture pixels per screen pixel at the current board scale. */
	const scale = props.node.width === 0 ? 1 : props.natural.width / props.node.width;
	const displayed = cropRectToNode(rect, props.node, props.natural);
	const beginDrag = (event, mode) => {
		event.preventDefault();
		event.stopPropagation();
		dragRef.current = {
			mode,
			startX: event.clientX,
			startY: event.clientY,
			startRect: rect
		};
		const onMove = (moveEvent) => {
			const drag = dragRef.current;
			if (drag === void 0) return;
			const dx = (moveEvent.clientX - drag.startX) * scale;
			const dy = (moveEvent.clientY - drag.startY) * scale;
			setRect(drag.mode === "move" ? moveCropRect(drag.startRect, dx, dy, props.natural) : resizeCropRect(drag.startRect, drag.mode, dx, dy, props.natural, aspect));
		};
		const onUp = () => {
			dragRef.current = void 0;
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: crop_overlay_module_css_default.box,
		"data-dsh-seework-crop": "",
		style: {
			left: `${props.node.x + displayed.x}px`,
			top: `${props.node.y + displayed.y}px`,
			width: `${displayed.width}px`,
			height: `${displayed.height}px`
		},
		onPointerDown: (event) => {
			beginDrag(event, "move");
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: crop_overlay_module_css_default.thirdV }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: crop_overlay_module_css_default.thirdV,
				"data-second": ""
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: crop_overlay_module_css_default.thirdH }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: crop_overlay_module_css_default.thirdH,
				"data-second": ""
			}),
			CROP_HANDLES.map((handle) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: crop_overlay_module_css_default.handle,
				"data-handle": handle,
				style: { cursor: HANDLE_CURSORS[handle] },
				onPointerDown: (event) => {
					beginDrag(event, handle);
				}
			}, handle))
		]
	}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: crop_overlay_module_css_default.toolbar,
		"data-dsh-seework-crop-toolbar": "",
		style: {
			left: `${props.node.x}px`,
			top: `${props.node.y + props.node.height + 12}px`
		},
		onPointerDown: (event) => {
			event.stopPropagation();
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
				className: crop_overlay_module_css_default.select,
				value: String(aspect),
				title: "裁剪比例",
				onChange: (event) => {
					const value = event.target.value === "null" ? null : Number(event.target.value);
					setAspect(value);
					setRect(defaultCropRect(props.natural, value));
				},
				children: CROP_ASPECTS.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
					value: String(option.value),
					children: option.label
				}, option.label))
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: crop_overlay_module_css_default.size,
				children: [
					Math.round(rect.width),
					"×",
					Math.round(rect.height)
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
				onClick: props.onCancel,
				children: "取消"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
				variant: "primary",
				"data-dsh-seework-crop-confirm": "",
				onClick: () => {
					props.onConfirm(rect);
				},
				children: "裁剪"
			})
		]
	})] });
}

//#endregion
//#region src/client/composer-draft.ts
let conversationProbe;
let face$1;
/**
* Install the probe that resolves the conversation service (plugin root, once).
*
* A probe rather than the service itself: plugins attach in boot order, and this
* one applies before the conversation plugin may have registered — resolving at
* call time costs nothing and cannot go stale.
*
* @param next - the probe, or undefined when the page has no conversation.
* @returns disposer restoring the previous probe.
*/
function setComposerProbe(next) {
	const previous = conversationProbe;
	conversationProbe = next;
	return () => {
		conversationProbe = previous;
	};
}
/**
* Publish (or clear) the session-scope face a tab body owns.
* @param next - the face, or undefined when no tab body is mounted.
* @returns disposer clearing this exact face.
*/
function setComposerFace(next) {
	const previous = face$1;
	face$1 = next;
	return () => {
		if (face$1 === next) face$1 = previous;
	};
}
/** Whether 「加入到对话框」 can do anything right now. */
function composerAvailable() {
	return conversationProbe?.() !== void 0 && face$1 !== void 0;
}
/**
* Send one picture to the composer as a draft attachment.
*
* The picture is fetched from its own URL (a library image or a canvas asset),
* turned into a browser `File`, and registered as a draft; the draft id then
* goes into the session's input rail. A composer that refuses the id (a busy
* submission) leaves nothing behind — the draft is released again.
*
* @param image - the picture's URL and the name its attachment should carry.
* @returns true when the draft reached the composer.
*/
async function sendImageToConversation(image) {
	const service$1 = conversationProbe?.();
	const current = face$1;
	if (service$1 === void 0 || current === void 0) return false;
	const response = await fetch(image.url);
	if (!response.ok) return false;
	const blob = await response.blob();
	const name = image.name ?? "seework-image.png";
	const file = new File([blob], name, { type: blob.type === "" ? "image/png" : blob.type });
	const drafts = service$1.createDrafts(current.sessionId, [file]);
	const ids = drafts.map((draft) => draft.id);
	if (ids.length === 0) return false;
	if (!current.input.addAttachments(ids)) {
		service$1.releaseDraftAttachments(drafts);
		console.warn("[dsh-seework] the composer refused the draft attachment.");
		return false;
	}
	return true;
}
/**
* The attachment name for one library file: it keeps the extension the route
* serves, so the composer's preview and the eventual prompt agree on the type.
* @param file - the library or asset file name.
* @returns a browser-safe file name.
*/
function attachmentNameFor(file) {
	const base = file.split(/[\\/]/).pop() ?? "seework-image.png";
	return base === "" ? "seework-image.png" : base;
}

//#endregion
//#region src/client/floating-bar.ts
/** Vertical gap between the bar and the node it belongs to (screen px). */
const FLOATING_BAR_GAP = 8;
/** Minimum horizontal distance from the stage's edges (screen px). */
const FLOATING_BAR_EDGE_MARGIN = 8;
/**
* Place the bar for one node.
*
* @param node - the node's rectangle in board coordinates.
* @param viewport - the board's viewport.
* @param barSize - the bar's measured size in screen pixels.
* @param stageSize - the visible stage size in screen pixels.
* @returns absolute left/top inside the stage, and which side it landed on.
*/
function floatingBarPosition(node, viewport, barSize, stageSize) {
	const topLeft = boardToScreen(viewport, node.x, node.y);
	const bottomRight = boardToScreen(viewport, node.x + node.width, node.y + node.height);
	const centreX = (topLeft.x + bottomRight.x) / 2;
	const placement = topLeft.y - FLOATING_BAR_GAP - barSize.height < 0 ? "below" : "above";
	const top = placement === "above" ? topLeft.y - FLOATING_BAR_GAP - barSize.height : bottomRight.y + FLOATING_BAR_GAP;
	const minLeft = FLOATING_BAR_EDGE_MARGIN;
	const maxLeft = Math.max(minLeft, stageSize.width - FLOATING_BAR_EDGE_MARGIN - barSize.width);
	return {
		left: Math.min(Math.max(centreX - barSize.width / 2, minLeft), maxLeft),
		top,
		placement
	};
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\node-floating-bar.module.css.mjs
const css$10 = ".f48Z3q_bar{z-index:20;border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-button-elevated-fill,var(--dsw-alias-bg-layer-2,Canvas));border-radius:8px;align-items:center;gap:4px;padding:4px;display:flex;position:absolute;box-shadow:0 4px 16px #00000038}.f48Z3q_button{color:var(--dsw-alias-label-primary,inherit);font:inherit;white-space:nowrap;cursor:pointer;background:0 0;border:0;border-radius:6px;padding:4px 10px;font-size:12px;line-height:1.4}.f48Z3q_button:hover:not(:disabled),.f48Z3q_button:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3,Canvas));color:var(--dsw-alias-brand-primary,inherit)}.f48Z3q_button:disabled{color:var(--dsw-alias-label-tertiary,inherit);cursor:default}";
const tagId$10 = "dsh-seework/node-floating-bar.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$10) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$10;
	tag.textContent = css$10;
	document.head.appendChild(tag);
}
var node_floating_bar_module_css_default = {
	"button": "f48Z3q_button",
	"bar": "f48Z3q_bar"
};

//#endregion
//#region src/client/NodeFloatingBar.tsx
/** One button in the bar. */
function BarButton({ label, title, onClick, disabled = false }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		className: node_floating_bar_module_css_default.button,
		title,
		"aria-label": title,
		disabled,
		onClick: (event) => {
			event.stopPropagation();
			onClick?.();
		},
		children: label
	});
}
/**
* The bar for one selected node.
* @param props - the node, the viewport, the stage size, and the actions.
* @returns the bar, positioned inside the stage.
*/
function NodeFloatingBar(props) {
	const barRef = (0, react.useRef)(null);
	const [size, setSize] = (0, react.useState)({
		width: 0,
		height: 0
	});
	const [outcome, setOutcome] = (0, react.useState)("idle");
	(0, react.useLayoutEffect)(() => {
		const element = barRef.current;
		if (element === null) return;
		const rect = element.getBoundingClientRect();
		setSize((previous) => previous.width === rect.width && previous.height === rect.height ? previous : {
			width: rect.width,
			height: rect.height
		});
	});
	const position = floatingBarPosition(props.node, props.viewport, size, props.stageSize);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		ref: barRef,
		className: node_floating_bar_module_css_default.bar,
		"data-dsh-seework-node-bar": "",
		"data-placement": position.placement,
		style: {
			left: `${position.left}px`,
			top: `${position.top}px`,
			visibility: size.width > 0 ? "visible" : "hidden"
		},
		onPointerDown: (event) => {
			event.stopPropagation();
		},
		onMouseDown: (event) => {
			event.stopPropagation();
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BarButton, {
				label: outcome === "failed" ? "放不进输入框" : "加入到对话框",
				title: outcome === "failed" ? "没能放进输入框：请确认当前会话的输入框可用" : "把这张图放进对话输入框当草稿附件",
				disabled: props.onAddToConversation === void 0,
				onClick: () => {
					const run = props.onAddToConversation;
					if (run === void 0) return;
					Promise.resolve(run()).then((ok) => {
						if (ok !== false) return;
						setOutcome("failed");
						setTimeout(() => {
							setOutcome("idle");
						}, 2500);
					});
				}
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BarButton, {
				label: "标注",
				title: "在图上画矩形 / 涂抹 / 写字，保存成一张新图（原图不变）",
				onClick: props.onAnnotate,
				disabled: props.onAnnotate === void 0
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BarButton, {
				label: "裁剪",
				title: "就地裁剪这张图（生成新卡片，原图保留）",
				onClick: props.onCrop,
				disabled: props.onCrop === void 0
			})
		]
	});
}

//#endregion
//#region src/client/snapshot-store.ts
/**
* A minimal observable snapshot store.
*
* The shell's `dsh-client-store` package is not in the shared module baseline,
* so depending on it would either duplicate the store machinery inside this
* bundle or drag in its zustand/immer tree. The settings bridge needs only
* "read the current value, subscribe, replace or patch it", which is this file.
*/
/** One observable value with React-friendly snapshot semantics. */
var SnapshotStore = class {
	value;
	listeners = /* @__PURE__ */ new Set();
	constructor(initial) {
		this.value = initial;
	}
	/** @returns the current value; the reference changes on every update. */
	getSnapshot() {
		return this.value;
	}
	/** @returns the disposer removing this listener. */
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** Replace the value and notify listeners. */
	set(next) {
		this.value = next;
		this.notify();
	}
	/** Patch the value with a mutator that receives a detached copy. */
	update(mutator) {
		const draft = { ...this.value };
		mutator(draft);
		this.value = draft;
		this.notify();
	}
	notify() {
		for (const listener of [...this.listeners]) listener();
	}
};

//#endregion
//#region src/client/canvas-store.ts
/** How long edits settle before a save is attempted. */
const AUTOSAVE_DELAY_MS = 800;
/** Create a card id (board-local, only needs to be unique within one board). */
function newCardId() {
	const cryptoObj = globalThis.crypto;
	if (cryptoObj?.randomUUID !== void 0) return cryptoObj.randomUUID();
	return `card-${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`;
}
/** The board store. */
var CanvasStore = class {
	store = new SnapshotStore({
		status: "loading",
		boards: [],
		dirty: false,
		save: "idle"
	});
	api;
	saveTimer;
	saveInFlight = false;
	/**
	* Monotonic local-edit counter, and the fence a save response is judged by.
	*
	* The host echoes the document it stored; that echo is a snapshot of what was
	* sent. Any edit made AFTER the request went out is newer than the echo, and
	* comparing this counter is how the response knows not to overwrite it.
	*/
	editSeq = 0;
	disposed = false;
	constructor(api) {
		this.api = api;
	}
	/**
	* The route client this store writes through.
	*
	* Exposed for the board's own picture work (a burned annotation, a crop): those
	* write to the canvas asset store, and threading a second client through every
	* mount point just to upload one image would be worse.
	*/
	get client() {
		return this.api;
	}
	getSnapshot() {
		return this.store.getSnapshot();
	}
	subscribe(listener) {
		return this.store.subscribe(listener);
	}
	/** Stop the autosave timer (the surface is going away). */
	dispose() {
		this.disposed = true;
		if (this.saveTimer !== void 0) clearTimeout(this.saveTimer);
		this.saveTimer = void 0;
	}
	/** Re-read the board list; the open board is left alone. */
	async refreshList() {
		const result = await this.api.canvases();
		if (this.disposed) return;
		if (!result.ok) {
			this.store.update((draft) => {
				draft.status = "error";
				draft.message = result.message;
			});
			return;
		}
		this.store.update((draft) => {
			draft.status = "ready";
			draft.boards = result.value.canvases;
			delete draft.message;
		});
	}
	/**
	* Open a board.
	* @param id - board id, or '' to create a fresh one.
	* @returns the board that is now open, or undefined when it could not be opened.
	*/
	async open(id = "") {
		const result = id === "" ? await this.api.createCanvas() : await this.api.readCanvas(id);
		if (this.disposed) return void 0;
		if (!result.ok) {
			this.store.update((draft) => {
				draft.status = "error";
				draft.message = result.message;
			});
			return;
		}
		const board = result.value.canvas;
		this.store.update((draft) => {
			draft.board = board;
			draft.dirty = false;
			draft.save = "idle";
			delete draft.message;
		});
		this.refreshList();
		return board;
	}
	/** Close the open board, saving first when it has unsaved edits. */
	async close() {
		if (this.store.getSnapshot().dirty) await this.saveNow();
		this.store.update((draft) => {
			delete draft.board;
			draft.dirty = false;
			draft.save = "idle";
			delete draft.message;
		});
	}
	/** Delete a board (closing it first when it is the open one). */
	async deleteBoard(id) {
		if (this.store.getSnapshot().board?.id === id) await this.close();
		const result = await this.api.removeCanvas(id);
		if (this.disposed) return;
		if (!result.ok) {
			this.store.update((draft) => {
				draft.save = "error";
				draft.message = `删除失败：${result.message}`;
			});
			return;
		}
		this.store.update((draft) => {
			draft.boards = result.value.canvases;
		});
	}
	/** Replace the board document as part of an edit. */
	edit(mutate) {
		const current = this.store.getSnapshot().board;
		if (current === void 0) return;
		const next = {
			...current,
			cards: [...current.cards]
		};
		mutate(next);
		this.editSeq += 1;
		this.store.update((draft) => {
			draft.board = next;
			draft.dirty = true;
			if (draft.save !== "conflict") draft.save = "idle";
		});
		this.scheduleSave();
	}
	/** Move, resize or restack one card. */
	updateCard(id, patch) {
		this.edit((board) => {
			board.cards = board.cards.map((card) => card.id === id ? {
				...card,
				...patch
			} : card);
		});
	}
	/** Remove one card. */
	removeCard(id) {
		this.edit((board) => {
			board.cards = board.cards.filter((card) => card.id !== id);
		});
	}
	/** Place new cards on the board, on top of everything already there. */
	addCards(cards) {
		if (cards.length === 0) return;
		this.edit((board) => {
			const top = board.cards.reduce((highest, card) => Math.max(highest, card.z), 0);
			board.cards = [...board.cards, ...cards.map((card, index) => ({
				...card,
				z: top + index + 1
			}))];
		});
	}
	/** Move the viewport (and remember it). */
	setViewport(viewport) {
		this.edit((board) => {
			board.viewport = viewport;
		});
	}
	/** Rename the board. */
	setTitle(title) {
		this.edit((board) => {
			board.title = title;
		});
	}
	/** Save immediately, cancelling the debounce. */
	async saveNow() {
		if (this.saveTimer !== void 0) {
			clearTimeout(this.saveTimer);
			this.saveTimer = void 0;
		}
		await this.save();
	}
	/** Queue a save after the edits settle. */
	scheduleSave() {
		if (this.saveTimer !== void 0) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = void 0;
			this.save();
		}, AUTOSAVE_DELAY_MS);
	}
	/**
	* Write the open board.
	*
	* A save that fails or conflicts must never lose the local edit: the document
	* stays in memory and dirty, and the user is told what happened.
	*/
	async save() {
		const snapshot = this.store.getSnapshot();
		const board = snapshot.board;
		if (board === void 0 || !snapshot.dirty) return;
		if (this.saveInFlight) return;
		this.saveInFlight = true;
		const sentAt = this.editSeq;
		this.store.update((draft) => {
			draft.save = "saving";
		});
		const reading = board.revision;
		const result = await this.api.saveCanvas(board, reading);
		this.saveInFlight = false;
		if (this.disposed) return;
		if (result.ok) {
			const changedSince = this.editSeq !== sentAt;
			this.store.update((draft) => {
				if (draft.board !== void 0) draft.board = {
					...draft.board,
					revision: result.value.canvas.revision
				};
				draft.dirty = changedSince;
				draft.save = changedSince ? "idle" : "saved";
			});
			if (changedSince) this.scheduleSave();
			this.refreshList();
			return;
		}
		if (result.code === "canvas_conflict") {
			const reread = await this.api.readCanvas(board.id);
			if (this.disposed) return;
			const current = this.store.getSnapshot().board;
			this.store.update((draft) => {
				draft.save = "conflict";
				draft.dirty = true;
				draft.message = reread.ok ? "这块画布在别处也被改过：正在把你的版本保存为最新版本。" : "这块画布在别处也被改过，且重新读取失败；改动还在这里，稍后会自动重试。";
				if (reread.ok && current !== void 0) draft.board = {
					...current,
					revision: reread.value.canvas.revision
				};
			});
			if (reread.ok) await this.save();
			return;
		}
		this.store.update((draft) => {
			draft.save = "error";
			draft.message = `保存失败：${result.message}`;
			draft.dirty = true;
		});
	}
};
/** A card id that does not collide with what is already on the board. */
function unusedCardId(board) {
	const existing = new Set((board?.cards ?? []).map((card) => card.id));
	for (let attempt = 0; attempt < 10; attempt++) {
		const id = newCardId();
		if (!existing.has(id)) return id;
	}
	return `card-${Date.now().toString(36)}`;
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\canvas.module.css.mjs
const css$9 = ".ozm_ga_workspace{background:var(--dsw-alias-bg-base,Canvas);min-width:0;color:var(--dsw-alias-label-primary,inherit);flex-direction:column;flex:1;display:flex;position:relative;overflow:hidden}.ozm_ga_toolbar{border-bottom:1px solid var(--dsw-alias-border-l1,currentColor);flex-wrap:wrap;align-items:center;gap:6px;padding:8px 12px;display:flex}.ozm_ga_boardTitle{text-overflow:ellipsis;white-space:nowrap;max-width:220px;color:var(--dsw-alias-label-primary,inherit);font-size:13px;overflow:hidden}.ozm_ga_zoomLabel{min-width:44px;color:var(--dsw-alias-label-tertiary,#7f7f7ff2);font-variant-numeric:tabular-nums;text-align:center;font-size:11px}.ozm_ga_toolbarGap{flex:1}.ozm_ga_saveState{white-space:nowrap;border-radius:999px;padding:2px 10px;font-size:11px}.ozm_ga_saveOk{color:light-dark(#1a7f37,#56d364);background:#2ea0432e}.ozm_ga_saveIdle{background:var(--dsw-alias-interactive-bg-hover,#7f7f7f29);color:var(--dsw-alias-label-secondary,inherit)}.ozm_ga_saveWarn{color:light-dark(#8a6100,#e3b341);background:#d2992238}.ozm_ga_saveError{color:light-dark(#b3261e,#ff7b72);background:#f8514929}.ozm_ga_notice{border-bottom:1px solid var(--dsw-alias-border-l1,currentColor);color:var(--dsw-alias-label-primary,inherit);background:#d2992229;margin:0;padding:6px 12px;font-size:12px}.ozm_ga_surface{background:var(--dsw-alias-bg-base,Canvas);touch-action:none;user-select:none;flex:1;position:relative;overflow:hidden}.ozm_ga_grid{background-image:radial-gradient(circle, var(--dsw-alias-border-l2,#7f7f7f59) 1px, transparent 1px);pointer-events:none;position:absolute;inset:0}.ozm_ga_world{transform-origin:0 0;will-change:transform;position:absolute;top:0;left:0}.ozm_ga_card{border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-2,Canvas);box-shadow:0 6px 20px var(--dsw-alias-bg-overlay,#0000002e);border-radius:10px;flex-direction:column;display:flex;position:absolute;overflow:hidden}.ozm_ga_cardSelected{border-color:var(--dsw-alias-brand-primary,currentColor);box-shadow:0 0 0 2px #3b6cf673, 0 6px 20px var(--dsw-alias-bg-overlay,#0003)}.ozm_ga_cardBar{background:var(--dsw-alias-bg-layer-3,#7f7f7f1f);cursor:grab;justify-content:space-between;align-items:center;height:24px;padding:0 6px 0 8px;display:flex}.ozm_ga_cardKind{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);font-size:10px}.ozm_ga_cardClose{width:18px;height:18px;color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;background:0 0;border:0;border-radius:4px;padding:0;font-size:11px;line-height:1}.ozm_ga_cardClose:hover{color:light-dark(#b3261e,#ff7b72);background:#f851493d}.ozm_ga_cardBody{flex:1;min-height:0;position:relative}.ozm_ga_cardImage{object-fit:contain;background:var(--dsw-alias-bg-layer-3,#7f7f7f1a);pointer-events:none;width:100%;height:100%;display:block}.ozm_ga_cardText{width:100%;height:100%;color:var(--dsw-alias-label-primary,inherit);font:inherit;resize:none;background:0 0;border:0;outline:none;padding:8px 10px}.ozm_ga_resizeHandle{cursor:nwse-resize;background:linear-gradient(135deg, transparent 50%, var(--dsw-alias-border-l3,#7f7f7f99) 50%);width:14px;height:14px;position:absolute;bottom:0;right:0}.ozm_ga_layers{z-index:12;border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-2,Canvas);width:min(220px,60%);max-height:calc(100% - 20px);box-shadow:0 10px 28px var(--dsw-alias-bg-overlay,#00000047);border-radius:10px;flex-direction:column;gap:2px;padding:6px;display:flex;position:absolute;top:10px;right:10px;overflow-y:auto}.ozm_ga_layersHead{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);margin:2px 4px 4px;font-size:10px}.ozm_ga_layerRow{width:100%;color:var(--dsw-alias-label-primary,inherit);font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:6px;padding:4px 6px;font-size:11px;display:flex}.ozm_ga_layerRow:hover{background:var(--dsw-alias-interactive-bg-hover,#7f7f7f24)}.ozm_ga_layerRowActive{background:var(--dsw-alias-interactive-bg-active,#3b6cf62e)}.ozm_ga_layerIndex{min-width:14px;color:var(--dsw-alias-label-tertiary,#7f7f7ff2);font-variant-numeric:tabular-nums;text-align:right}.ozm_ga_layerBadge{color:var(--dsw-alias-label-secondary,inherit);white-space:nowrap;flex:none}.ozm_ga_layerName{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;overflow:hidden}.ozm_ga_pickerBackdrop{z-index:5;background:color-mix(in srgb, var(--dsw-alias-bg-overlay,#000) 40%, transparent);position:absolute;inset:0}.ozm_ga_picker{z-index:6;border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-2,Canvas);width:min(440px,88vw);max-height:60%;box-shadow:0 16px 40px var(--dsw-alias-bg-overlay,#0000004d);border-radius:12px;flex-direction:column;display:flex;position:absolute;top:56px;right:16px;overflow:hidden}.ozm_ga_pickerHeader{border-bottom:1px solid var(--dsw-alias-border-l1,currentColor);color:var(--dsw-alias-label-primary,inherit);justify-content:space-between;align-items:center;padding:10px 12px;font-size:13px;display:flex}.ozm_ga_pickerGrid{grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:6px;padding:10px;display:grid;overflow-y:auto}.ozm_ga_pickerItem{border:1px solid var(--dsw-alias-border-l1,currentColor);aspect-ratio:1;cursor:pointer;background:0 0;border-radius:8px;padding:0;overflow:hidden}.ozm_ga_pickerItem:hover{border-color:var(--dsw-alias-brand-primary,currentColor)}.ozm_ga_pickerItem img{object-fit:cover;width:100%;height:100%;display:block}.ozm_ga_list{border-right:1px solid var(--dsw-alias-border-l1,currentColor);background:var(--dsw-alias-bg-layer-1,#7f7f7f0a);flex-direction:column;width:200px;display:flex}.ozm_ga_listHeader{border-bottom:1px solid var(--dsw-alias-border-l1,currentColor);color:var(--dsw-alias-label-primary,inherit);justify-content:space-between;align-items:center;gap:8px;padding:10px 10px 8px;font-size:12px;display:flex}.ozm_ga_boardList{flex-direction:column;flex:1;gap:2px;margin:0;padding:8px;list-style:none;display:flex;overflow-y:auto}.ozm_ga_boardList li{align-items:center;gap:2px;display:flex}.ozm_ga_boardRow{min-width:0;color:var(--dsw-alias-label-primary,inherit);font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:8px;flex-direction:column;flex:1;gap:2px;padding:6px 8px;display:flex}.ozm_ga_boardRow:hover{background:var(--dsw-alias-interactive-bg-hover,#7f7f7f1f)}.ozm_ga_boardRowActive{background:var(--dsw-alias-interactive-bg-active,#3b6cf62e)}.ozm_ga_boardName{text-overflow:ellipsis;white-space:nowrap;font-size:12px;overflow:hidden}.ozm_ga_boardMeta{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);font-size:10px}.ozm_ga_boardDelete{width:22px;height:22px;color:var(--dsw-alias-label-tertiary,#7f7f7ff2);cursor:pointer;background:0 0;border:0;border-radius:6px;padding:0}.ozm_ga_boardDelete:hover{color:light-dark(#b3261e,#ff7b72);background:#f851493d}.ozm_ga_listFooter{border-top:1px solid var(--dsw-alias-border-l1,currentColor);flex-direction:column;gap:6px;padding:10px;display:flex}.ozm_ga_muted{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);margin:0;padding:8px 10px;font-size:12px}";
const tagId$9 = "dsh-seework/canvas.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$9) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$9;
	tag.textContent = css$9;
	document.head.appendChild(tag);
}
var canvas_module_css_default = {
	"layerBadge": "ozm_ga_layerBadge",
	"saveIdle": "ozm_ga_saveIdle",
	"cardBar": "ozm_ga_cardBar",
	"boardList": "ozm_ga_boardList",
	"cardBody": "ozm_ga_cardBody",
	"card": "ozm_ga_card",
	"layerIndex": "ozm_ga_layerIndex",
	"zoomLabel": "ozm_ga_zoomLabel",
	"workspace": "ozm_ga_workspace",
	"saveError": "ozm_ga_saveError",
	"pickerBackdrop": "ozm_ga_pickerBackdrop",
	"surface": "ozm_ga_surface",
	"pickerGrid": "ozm_ga_pickerGrid",
	"boardMeta": "ozm_ga_boardMeta",
	"notice": "ozm_ga_notice",
	"toolbar": "ozm_ga_toolbar",
	"toolbarGap": "ozm_ga_toolbarGap",
	"boardRowActive": "ozm_ga_boardRowActive",
	"grid": "ozm_ga_grid",
	"picker": "ozm_ga_picker",
	"boardDelete": "ozm_ga_boardDelete",
	"cardImage": "ozm_ga_cardImage",
	"listFooter": "ozm_ga_listFooter",
	"muted": "ozm_ga_muted",
	"cardKind": "ozm_ga_cardKind",
	"resizeHandle": "ozm_ga_resizeHandle",
	"cardText": "ozm_ga_cardText",
	"layerRow": "ozm_ga_layerRow",
	"saveWarn": "ozm_ga_saveWarn",
	"world": "ozm_ga_world",
	"boardTitle": "ozm_ga_boardTitle",
	"pickerItem": "ozm_ga_pickerItem",
	"list": "ozm_ga_list",
	"saveState": "ozm_ga_saveState",
	"cardSelected": "ozm_ga_cardSelected",
	"cardClose": "ozm_ga_cardClose",
	"layerRowActive": "ozm_ga_layerRowActive",
	"saveOk": "ozm_ga_saveOk",
	"boardRow": "ozm_ga_boardRow",
	"layerName": "ozm_ga_layerName",
	"pickerHeader": "ozm_ga_pickerHeader",
	"listHeader": "ozm_ga_listHeader",
	"layers": "ozm_ga_layers",
	"boardName": "ozm_ga_boardName",
	"layersHead": "ozm_ga_layersHead"
};

//#endregion
//#region src/client/CanvasBoard.tsx
/** How far a click must travel before it counts as a drag. */
const DRAG_THRESHOLD_PX = 3;
/** How much of a card must be on screen before the layer list leaves the view alone. */
const LAYER_REVEAL_MARGIN = 24;
/**
* How long a housekeeping notice stays up.
*
* It reports a finished action ("已清理 4 张…"), not a state the user has to keep
* reading — a notice bar that never goes away just eats the board (user report:
* 「一直存在提示条，不消失」).
*/
const NOTICE_MS = 4e3;
/** A byte count for a notice, e.g. `12.4 MB`. */
function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
/**
* What the ✕ on one card promises.
*
* Only the board's own pictures are deleted with the card; a library picture is
* the record of a generation, and saying otherwise would be a lie the user acts on.
*
* @param card - the card about to be removed.
* @returns the tooltip text.
*/
function removeHint(card) {
	if (card.source === "canvas") return "从画布移除（这张合成图的文件也会一起删掉）";
	if (card.kind === "image") return "从画布移除（不会删除素材库里的文件）";
	return "从画布移除";
}
/**
* One line of the layer list.
* @param card - the card.
* @returns a short description (its prompt, its note, or its file name).
*/
function layerName(card) {
	const trimmed = ((card.kind === "text" ? card.text : card.prompt) ?? "").trim();
	if (trimmed !== "") return trimmed;
	return card.kind === "text" ? "（空备注）" : card.file ?? "图片";
}
/**
* Visible stage size per board store, as the board last measured it.
*
* The conversation's 「加到画布」 runs outside any board render, so the size is
* recorded here instead of being asked of the DOM from there.
*/
const stageSizes = /* @__PURE__ */ new WeakMap();
/**
* Record the stage size the board just measured.
* @param store - the board's store.
* @param size - the stage size in screen pixels.
*/
function publishStageSize(store, size) {
	stageSizes.set(store, size);
}
/**
* The last stage size a board measured.
* @param store - the board's store.
* @returns the size, or zeros before the board has rendered.
*/
function stageSizeFor(store) {
	return stageSizes.get(store) ?? {
		width: 0,
		height: 0
	};
}
/** One node's rectangle in stage (screen) coordinates. */
function nodeScreenRect(card, viewport) {
	const topLeft = boardToScreen(viewport, card.x, card.y);
	return {
		x: topLeft.x,
		y: topLeft.y,
		width: card.width * viewport.k,
		height: card.height * viewport.k
	};
}
/** A new node's board size for one burned picture: its own aspect, comparable width. */
function sizeKeepingAspect(referenceWidth, width, height) {
	const aspect = height === 0 ? 1 : width / height;
	const nodeWidth = Math.max(64, Math.min(480, referenceWidth));
	return {
		width: Math.round(nodeWidth),
		height: Math.round(nodeWidth / aspect)
	};
}
/** Read a burned data URL's real pixel size (the new node is sized from it). */
async function loadBurnedSize(dataUrl) {
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => {
			resolve({
				dataUrl,
				width: image.naturalWidth,
				height: image.naturalHeight
			});
		};
		image.onerror = () => {
			resolve({
				dataUrl,
				width: 0,
				height: 0
			});
		};
		image.src = dataUrl;
	});
}
/** The canvas workspace: toolbar + board + library picker. */ function CanvasBoard({ store, library, onNeedLibrary }) {
	const [tick, setTick] = (0, react.useState)(0);
	(0, react.useEffect)(() => store.subscribe(() => {
		setTick((value) => value + 1);
	}), [store]);
	const state = store.getSnapshot();
	const board = state.board;
	const api = store.client;
	const surfaceRef = (0, react.useRef)(null);
	const gestureRef = (0, react.useRef)(null);
	const [gestureTick, setGestureTick] = (0, react.useState)(0);
	const [pickerOpen, setPickerOpen] = (0, react.useState)(false);
	const [selected, setSelected] = (0, react.useState)(void 0);
	/** The card whose marks are being edited (modal), or undefined. */
	const [annotating, setAnnotating] = (0, react.useState)(void 0);
	/** The card in crop mode (in place), or undefined. */
	const [cropping, setCropping] = (0, react.useState)(void 0);
	/** The picture behind the active edit mode, with the size it really is. */
	const [modePicture, setModePicture] = (0, react.useState)(void 0);
	const [busy, setBusy] = (0, react.useState)(false);
	/** What the last housekeeping action did (or why it failed). */
	const [assetNotice, setAssetNotice] = (0, react.useState)(void 0);
	const noticeTimer = (0, react.useRef)(void 0);
	/** Show a housekeeping notice, replacing any previous one (and any pending fade). */
	const showAssetNotice = (0, react.useCallback)((text) => {
		if (noticeTimer.current !== void 0) window.clearTimeout(noticeTimer.current);
		setAssetNotice(text);
		noticeTimer.current = window.setTimeout(() => {
			noticeTimer.current = void 0;
			setAssetNotice(void 0);
		}, NOTICE_MS);
	}, []);
	(0, react.useEffect)(() => () => {
		if (noticeTimer.current !== void 0) window.clearTimeout(noticeTimer.current);
	}, []);
	/** Whether the compact layer list is open. */
	const [layersOpen, setLayersOpen] = (0, react.useState)(false);
	/**
	* Open one edit mode for a card.
	*
	* The picture's natural size decides the coordinate system both modes work in
	* (marks and the crop box are stored in picture pixels), and only the loaded
	* image knows it — a card's board size is whatever the user dragged it to.
	*/
	const openMode = (kind, card) => {
		const file = card.file ?? "";
		if (file === "") return;
		const url = canvasImageUrl(file, card.source);
		const enter = (natural) => {
			setModePicture({
				url,
				natural
			});
			if (kind === "annotate") setAnnotating(card.id);
			else setCropping(card.id);
		};
		const image = new Image();
		image.onload = () => {
			enter({
				width: image.naturalWidth || card.width,
				height: image.naturalHeight || card.height
			});
		};
		image.onerror = () => {
			enter({
				width: card.width,
				height: card.height
			});
		};
		image.src = url;
	};
	/** Leave whichever edit mode is open. */
	const closeMode = () => {
		setAnnotating(void 0);
		setCropping(void 0);
		setModePicture(void 0);
	};
	/**
	* Turn one burned picture into a new card on the board.
	*
	* The composite goes to the canvas asset store — deliberately not the material
	* library — and the card says so (`source: 'canvas'` + its `origin`), so a
	* marked-up copy can never be mistaken for a generation.
	*/
	const addBurnedCard = async (burned, placement, origin) => {
		const current = store.getSnapshot().board;
		if (current === void 0) return;
		const label = canvasOriginLabel(origin) ?? "合成图";
		setBusy(true);
		try {
			const result = await api.writeCanvasAsset(burned.dataUrl);
			if (!result.ok) {
				console.warn("[dsh-seework] storing the marked-up picture failed:", result.message);
				return;
			}
			store.addCards([{
				id: unusedCardId(current),
				kind: "image",
				x: Math.round(placement.x),
				y: Math.round(placement.y),
				width: Math.round(placement.width),
				height: Math.round(placement.height),
				z: 0,
				file: result.value.image.file,
				source: "canvas",
				origin,
				model: label,
				prompt: label
			}]);
			await store.saveNow();
		} finally {
			setBusy(false);
		}
	};
	const viewport = board?.viewport ?? {
		x: 0,
		y: 0,
		k: 1
	};
	const stageRef = (0, react.useRef)({
		width: 0,
		height: 0
	});
	/**
	* The visible stage size, measured NOW.
	*
	* Measuring on demand matters: the recorded value can be a stale zero (this
	* board has not been laid out yet, or a hidden sibling — the floating overlay
	* and the sidebar tab share one store — measured 0×0 and overwrote it). A
	* zero here used to mean "fit" silently reset the view to 100% at the origin,
	* which reads to the user as "my pictures disappeared".
	*/
	const stageSize = (0, react.useCallback)(() => {
		const surface = surfaceRef.current;
		if (surface === null) return stageRef.current;
		const width = surface.offsetWidth;
		const height = surface.offsetHeight;
		return width > 0 && height > 0 ? {
			width,
			height
		} : stageRef.current;
	}, []);
	(0, react.useEffect)(() => {
		const surface = surfaceRef.current;
		if (surface === null) return;
		const measure = () => {
			const size = {
				width: surface.offsetWidth,
				height: surface.offsetHeight
			};
			stageRef.current = size;
			if (size.width > 0 && size.height > 0) publishStageSize(store, size);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(surface);
		return () => {
			observer.disconnect();
		};
	}, [store]);
	/** Zoom one step around the stage centre (a toolbar press, not a cursor). */
	const zoomCentre = (0, react.useCallback)((direction) => {
		if (board === void 0) return;
		const { width, height } = stageSize();
		if (width <= 0 || height <= 0) return;
		store.setViewport(zoomAt(board.viewport, direction, width / 2, height / 2));
	}, [
		board,
		stageSize,
		store
	]);
	/** Zoom to an exact factor around the stage centre. */
	const zoomExact = (0, react.useCallback)((k) => {
		if (board === void 0) return;
		const { width, height } = stageSize();
		if (width <= 0 || height <= 0) return;
		store.setViewport(zoomTo(board.viewport, k, width / 2, height / 2));
	}, [
		board,
		stageSize,
		store
	]);
	/**
	* Show everything on the board.
	*
	* A board with nothing to fit against is left alone rather than reset: the
	* degenerate fit returns the identity viewport, which throws away wherever
	* the user had scrolled to.
	*/
	const fit = (0, react.useCallback)(() => {
		if (board === void 0) return;
		const { width, height } = stageSize();
		if (width <= 0 || height <= 0 || board.cards.length === 0) return;
		store.setViewport(fitViewport(board.cards, width, height));
	}, [
		board,
		stageSize,
		store
	]);
	(0, react.useEffect)(() => {
		const surface = surfaceRef.current;
		if (surface === null) return;
		const onWheel = (event) => {
			if (board === void 0) return;
			event.preventDefault();
			const bounds = surface.getBoundingClientRect();
			const anchorX = event.clientX - bounds.left;
			const anchorY = event.clientY - bounds.top;
			const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
			const current = store.getSnapshot().board?.viewport;
			if (current === void 0) return;
			store.setViewport(zoomTo(current, current.k * factor, anchorX, anchorY));
		};
		surface.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			surface.removeEventListener("wheel", onWheel);
		};
	}, [board, store]);
	(0, react.useEffect)(() => {
		const onMove = (event) => {
			const gesture = gestureRef.current;
			const current = store.getSnapshot().board;
			if (gesture === null || current === void 0) return;
			if (gesture.kind === "pan") {
				store.setViewport(panBy(current.viewport, event.clientX - gesture.lastX, event.clientY - gesture.lastY));
				gesture.lastX = event.clientX;
				gesture.lastY = event.clientY;
				return;
			}
			const dx = (event.clientX - gesture.startX) / current.viewport.k;
			const dy = (event.clientY - gesture.startY) / current.viewport.k;
			if (gesture.kind === "move") {
				if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < DRAG_THRESHOLD_PX) return;
				gesture.moved = true;
				store.updateCard(gesture.cardId, {
					x: Math.round(gesture.cardX + dx),
					y: Math.round(gesture.cardY + dy)
				});
				return;
			}
			gesture.moved = true;
			store.updateCard(gesture.cardId, {
				width: Math.max(24, Math.round(gesture.width + dx)),
				height: Math.max(24, Math.round(gesture.height + dy))
			});
		};
		const onUp = () => {
			const gesture = gestureRef.current;
			gestureRef.current = null;
			setGestureTick((value) => value + 1);
			if (gesture !== null && gesture.kind !== "pan" && gesture.moved) store.saveNow();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
	}, [store]);
	(0, react.useEffect)(() => {
		const onKey = (event) => {
			if (selected === void 0) return;
			const target = event.target;
			if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
			if (event.key === "Delete" || event.key === "Backspace") {
				event.preventDefault();
				store.removeCard(selected);
				setSelected(void 0);
				store.saveNow();
			}
			if (event.key === "Escape") setSelected(void 0);
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
		};
	}, [selected, store]);
	const beginPan = (event) => {
		if (event.button !== 0) return;
		setLayersOpen(false);
		if (event.target.closest("[data-seework-card]") !== null) return;
		setSelected(void 0);
		gestureRef.current = {
			kind: "pan",
			lastX: event.clientX,
			lastY: event.clientY
		};
		setGestureTick((value) => value + 1);
	};
	const beginMove = (event, card) => {
		if (event.button !== 0) return;
		event.stopPropagation();
		setSelected(card.id);
		gestureRef.current = {
			kind: "move",
			cardId: card.id,
			startX: event.clientX,
			startY: event.clientY,
			cardX: card.x,
			cardY: card.y,
			moved: false
		};
		setGestureTick((value) => value + 1);
	};
	const beginResize = (event, card) => {
		if (event.button !== 0) return;
		event.stopPropagation();
		event.preventDefault();
		gestureRef.current = {
			kind: "resize",
			cardId: card.id,
			startX: event.clientX,
			startY: event.clientY,
			width: card.width,
			height: card.height,
			moved: false
		};
		setGestureTick((value) => value + 1);
	};
	/** Place a library picture in the middle of the current view. */
	const placeImage = (0, react.useCallback)((entry, imageIndex = 0) => {
		if (board === void 0) return;
		const image = entry.images[imageIndex];
		if (image === void 0) return;
		const centre = stageCentre(board.viewport, stageSize());
		store.addCards([centeredImageCard({
			file: image.file,
			width: image.width,
			height: image.height,
			model: entry.model,
			prompt: entry.prompt,
			origin: entry.source === "panel" ? "panel" : "chat"
		}, centre, unusedCardId(board))]);
		setSelected(void 0);
		setPickerOpen(false);
	}, [
		board,
		stageSize,
		store
	]);
	/** Add a note in the middle of the current view. */
	const addNote = (0, react.useCallback)(() => {
		if (board === void 0) return;
		const centre = stageCentre(board.viewport, stageSize());
		const id = unusedCardId(board);
		store.addCards([{
			id,
			kind: "text",
			x: Math.round(centre.x - 120),
			y: Math.round(centre.y - 50),
			width: 240,
			height: 100,
			z: 0,
			text: "",
			fontSize: 16
		}]);
		setSelected(id);
	}, [
		board,
		stageSize,
		store
	]);
	const boardCards = (0, react.useMemo)(() => [...board?.cards ?? []].sort((left, right) => left.z - right.z), [board?.cards]);
	/**
	* Selecting a card also lifts it to the front.
	*
	* New cards land on top of everything (`addCards`), so without this a card you
	* click in order to move it can sit under pictures that were added later and be
	* impossible to drag out from underneath them. Only a card that is not already
	* on top is restacked, so clicking around does not rewrite the document.
	*/
	const selectCard = (0, react.useCallback)((card) => {
		setSelected(card.id);
		const top = (store.getSnapshot().board?.cards ?? []).reduce((highest, item) => Math.max(highest, item.z), card.z);
		if (card.z < top) store.updateCard(card.id, { z: top + 1 });
	}, [store]);
	/**
	* Where one card's picture came from, for its badge.
	*
	* Cards written before the `origin` field existed have none, so it is inferred:
	* a board's own picture is a composite (its label says which kind), and a
	* library picture is looked up in the library the panel already holds.
	*/
	const originOf = (0, react.useCallback)((card) => {
		if (card.origin !== void 0) return card.origin;
		if (card.source === "canvas") return card.model === "裁剪" || card.model === "裁剪合成" ? "crop" : "annotation";
		for (const entry of library.entries) if (entry.images.some((image) => image.file === card.file)) return entry.source === "panel" ? "panel" : "chat";
	}, [library.entries]);
	/**
	* Remove one card, and the file behind it when the board owns that file.
	*
	* The order matters: the board has to stop referencing the picture — and say so
	* on disk — before the delete route will agree to drop it, which is also what
	* keeps a second board's copy safe.
	*/
	const removeCard = (0, react.useCallback)((card) => {
		store.removeCard(card.id);
		setSelected(void 0);
		(async () => {
			await store.saveNow();
			if (card.source !== "canvas" || card.file === void 0) return;
			const result = await api.removeCanvasAsset(card.file);
			if (!result.ok) {
				showAssetNotice(`卡片已移除，但它的合成图文件没删掉：${result.message}`);
				return;
			}
			showAssetNotice(result.value.removed === 0 ? "卡片已移除（合成图文件之前就不在了）。" : "卡片和它的合成图文件都已删除。");
		})();
	}, [api, store]);
	/** Drop every board picture no card shows any more. */
	const pruneAssets = (0, react.useCallback)(() => {
		(async () => {
			const result = await api.pruneCanvasAssets();
			if (!result.ok) {
				showAssetNotice(`清理失败：${result.message}`);
				return;
			}
			const { removed, bytes } = result.value;
			showAssetNotice(removed === 0 ? "没有可清理的图片。" : `已清理 ${removed} 张没有用到的图片，释放 ${formatBytes(bytes)}。`);
		})();
	}, [api]);
	/**
	* Pick one card from the layer list: select it, raise it, and bring it into view.
	*
	* A card that is completely covered by others cannot be clicked on the board at
	* all, so the list is the way back to it — and a card that is off-screen would be
	* selected invisibly, so the view follows it there too.
	*/
	const pickFromLayers = (0, react.useCallback)((card) => {
		selectCard(card);
		const stage = stageSize();
		if (stage.width === 0 || stage.height === 0) return;
		const centreX = card.x + card.width / 2;
		const centreY = card.y + card.height / 2;
		const screen = boardToScreen(viewport, centreX, centreY);
		if (screen.x > LAYER_REVEAL_MARGIN && screen.x < stage.width - LAYER_REVEAL_MARGIN && screen.y > LAYER_REVEAL_MARGIN && screen.y < stage.height - LAYER_REVEAL_MARGIN) return;
		store.setViewport({
			...viewport,
			x: Math.round(stage.width / 2 - centreX * viewport.k),
			y: Math.round(stage.height / 2 - centreY * viewport.k)
		});
	}, [
		selectCard,
		stageSize,
		store,
		viewport
	]);
	/**
	* The selected card, when it is a picture the bar can act on. A note card has
	* no picture to send anywhere, so it gets no bar.
	*/
	const selectedImageCard = (0, react.useMemo)(() => {
		if (selected === void 0) return void 0;
		const card = board?.cards.find((candidate) => candidate.id === selected);
		return card === void 0 || card.kind !== "image" || (card.file ?? "") === "" ? void 0 : card;
	}, [board?.cards, selected]);
	/** The cards the two edit modes belong to, if they still exist. */
	const cropCard = board?.cards.find((candidate) => candidate.id === cropping);
	const annotateCard = board?.cards.find((candidate) => candidate.id === annotating);
	if (state.status === "loading" && board === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		className: canvas_module_css_default.muted,
		children: "正在读取画布…"
	});
	if (board === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		className: canvas_module_css_default.muted,
		children: state.message ?? "没有打开的画布。"
	});
	const gridSize = 32 * viewport.k;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: canvas_module_css_default.workspace,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: canvas_module_css_default.toolbar,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
						className: canvas_module_css_default.boardTitle,
						title: "更换画布请用左侧列表",
						children: board.title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
						onClick: () => {
							zoomCentre(-1);
						},
						title: "缩小",
						children: "−"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: canvas_module_css_default.zoomLabel,
						children: [Math.round(viewport.k * 100), "%"]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
						onClick: () => {
							zoomCentre(1);
						},
						title: "放大",
						children: "＋"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
						onClick: () => {
							zoomExact(1);
						},
						title: "回到 100%",
						children: "100%"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
						onClick: fit,
						title: "让全部内容可见",
						children: "适应内容"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: canvas_module_css_default.toolbarGap }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
						onClick: addNote,
						children: "加备注"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
						onClick: () => {
							setLayersOpen((open) => !open);
						},
						title: "按图层从下到上列出板上的卡片；点一行就选中它并提到最上层",
						"data-dsh-seework-layers-toggle": "",
						children: "图层"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
						onClick: pruneAssets,
						title: "删掉板上没有任何卡片引用的画布图片（标注/裁剪合成图）",
						children: "清理无用图片"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
						variant: "primary",
						onClick: () => {
							onNeedLibrary();
							setPickerOpen((open) => !open);
						},
						children: "从素材库添加"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SaveState, {
						save: state.save,
						dirty: state.dirty
					})
				]
			}),
			assetNotice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: canvas_module_css_default.notice,
				children: assetNotice
			}),
			state.message !== void 0 && state.save !== "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: canvas_module_css_default.notice,
				children: state.message
			}) : null,
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: canvas_module_css_default.surface,
				ref: surfaceRef,
				onPointerDown: beginPan,
				style: { cursor: gestureRef.current?.kind === "pan" ? "grabbing" : "default" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: canvas_module_css_default.grid,
						style: {
							backgroundSize: `${gridSize}px ${gridSize}px`,
							backgroundPosition: `${viewport.x}px ${viewport.y}px`
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: canvas_module_css_default.world,
						style: { transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` },
						children: boardCards.map((card) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardView, {
							card,
							selected: selected === card.id,
							onSelect: () => {
								selectCard(card);
							},
							onBeginMove: (event) => {
								beginMove(event, card);
							},
							onBeginResize: (event) => {
								beginResize(event, card);
							},
							onText: (text) => {
								store.updateCard(card.id, { text });
							},
							onRemove: () => {
								removeCard(card);
							},
							badge: canvasOriginLabel(originOf(card)),
							removeHint: removeHint(card)
						}, card.id))
					}),
					layersOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: canvas_module_css_default.layers,
						"data-dsh-seework-layers": "",
						role: "list",
						"aria-label": "图层",
						onPointerDown: (event) => {
							event.stopPropagation();
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: canvas_module_css_default.layersHead,
							children: "图层（上面的是最上层）"
						}), [...boardCards].reverse().map((card, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "listitem",
							className: [canvas_module_css_default.layerRow, selected === card.id ? canvas_module_css_default.layerRowActive : ""].filter(Boolean).join(" "),
							"data-seework-layer-row": card.id,
							"data-seework-layer-active": selected === card.id ? "true" : void 0,
							onPointerDown: (event) => {
								event.stopPropagation();
							},
							onClick: () => {
								pickFromLayers(card);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: canvas_module_css_default.layerIndex,
									children: index + 1
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: canvas_module_css_default.layerBadge,
									children: card.kind === "image" ? canvasOriginLabel(originOf(card)) ?? "图片" : "备注"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: canvas_module_css_default.layerName,
									children: layerName(card)
								})
							]
						}, card.id))]
					}) : null,
					selectedImageCard === void 0 || annotating !== void 0 || cropping !== void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NodeFloatingBar, {
						node: selectedImageCard,
						viewport,
						stageSize: stageSize(),
						onAddToConversation: () => {
							const file = selectedImageCard.file ?? "";
							if (file === "") return false;
							return sendImageToConversation({
								url: canvasImageUrl(file, selectedImageCard.source),
								name: attachmentNameFor(file)
							});
						},
						onAnnotate: () => {
							openMode("annotate", selectedImageCard);
						},
						onCrop: () => {
							openMode("crop", selectedImageCard);
						}
					}),
					cropCard === void 0 || modePicture === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CropOverlay, {
						node: nodeScreenRect(cropCard, viewport),
						natural: modePicture.natural,
						onCancel: closeMode,
						onConfirm: (rect) => {
							(async () => {
								const burned = await burnCrop(modePicture.url, rect);
								if (burned === void 0) return;
								const size = croppedNodeSize(rect);
								await addBurnedCard(burned, {
									...cropNodePosition(cropCard, size),
									...size
								}, "crop");
								closeMode();
							})();
						}
					})
				]
			}),
			annotateCard === void 0 || modePicture === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AnnotationEditor, {
				url: modePicture.url,
				natural: modePicture.natural,
				onCancel: closeMode,
				onSave: async (dataUrl) => {
					const image = await loadBurnedSize(dataUrl);
					await addBurnedCard(image, {
						x: annotateCard.x + annotateCard.width + 24,
						y: annotateCard.y,
						...sizeKeepingAspect(annotateCard.width, image.width, image.height)
					}, "annotation");
					closeMode();
				}
			}),
			busy ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: canvas_module_css_default.notice,
				children: "正在保存这张图…"
			}) : null,
			pickerOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibraryPicker, {
				entries: library.entries,
				onPick: placeImage,
				onClose: () => {
					setPickerOpen(false);
				}
			}) : null
		]
	});
}
/** The save indicator. */
function SaveState({ save, dirty }) {
	const text = save === "saving" ? "保存中…" : save === "conflict" ? "已在别处被改动" : save === "error" ? "保存失败" : dirty ? "待保存" : "已保存";
	const tone = save === "conflict" ? canvas_module_css_default.saveWarn : save === "error" ? canvas_module_css_default.saveError : dirty ? canvas_module_css_default.saveIdle : canvas_module_css_default.saveOk;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: `${canvas_module_css_default.saveState} ${tone}`,
		children: text
	});
}
/** One card on the board. */
function CardView({ card, selected, badge, removeHint: removeHint$1, onSelect, onBeginMove, onBeginResize, onText, onRemove }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		"data-seework-card": card.id,
		className: [canvas_module_css_default.card, selected ? canvas_module_css_default.cardSelected : ""].filter(Boolean).join(" "),
		style: {
			left: card.x,
			top: card.y,
			width: card.width,
			height: card.height,
			zIndex: Math.round(card.z)
		},
		onPointerDown: onSelect,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
				className: canvas_module_css_default.cardBar,
				onPointerDown: onBeginMove,
				title: "拖动移动",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: canvas_module_css_default.cardKind,
					"data-dsh-seework-card-origin": badge ?? "",
					children: card.kind === "image" ? badge ?? "图片" : "备注"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: canvas_module_css_default.cardClose,
					title: removeHint$1,
					onPointerDown: (event) => {
						event.stopPropagation();
					},
					onClick: onRemove,
					children: "✕"
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: canvas_module_css_default.cardBody,
				children: card.kind === "image" && card.file !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					className: canvas_module_css_default.cardImage,
					src: canvasImageUrl(card.file, card.source),
					alt: card.prompt ?? "",
					draggable: false
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
					className: canvas_module_css_default.cardText,
					value: card.text ?? "",
					placeholder: "写点什么…",
					style: { fontSize: card.fontSize ?? 16 },
					onPointerDown: (event) => {
						event.stopPropagation();
					},
					onChange: (event) => {
						onText(event.target.value);
					}
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: canvas_module_css_default.resizeHandle,
				onPointerDown: onBeginResize,
				title: "拖动调整大小"
			})
		]
	});
}
/** The picture picker, shown as a panel over the board. */
function LibraryPicker({ entries, onPick, onClose }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: canvas_module_css_default.pickerBackdrop,
		onClick: onClose
	}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: canvas_module_css_default.picker,
		role: "dialog",
		"aria-label": "从素材库添加",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
			className: canvas_module_css_default.pickerHeader,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "从素材库添加" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
				onClick: onClose,
				children: "关闭"
			})]
		}), entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			className: canvas_module_css_default.muted,
			children: "素材库还是空的：先在对话里让 Agent 画一张。"
		}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: canvas_module_css_default.pickerGrid,
			children: entries.flatMap((entry) => entry.images.map((image, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: canvas_module_css_default.pickerItem,
				title: entry.prompt,
				onClick: () => {
					onPick(entry, index);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: image.url,
					alt: "",
					loading: "lazy"
				})
			}, `${entry.id}-${index}`)))
		})]
	})] });
}
/** Board list + open/create/delete, shown beside the board. */
function CanvasBoardList({ store }) {
	const [tick, setTick] = (0, react.useState)(0);
	(0, react.useEffect)(() => store.subscribe(() => {
		setTick((value) => value + 1);
	}), [store]);
	const state = store.getSnapshot();
	const [renaming, setRenaming] = (0, react.useState)(false);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
		className: canvas_module_css_default.list,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
				className: canvas_module_css_default.listHeader,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "画布" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
					variant: "primary",
					onClick: () => {
						store.open("");
					},
					children: "新建"
				})]
			}),
			state.boards.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: canvas_module_css_default.muted,
				children: "还没有画布。"
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: canvas_module_css_default.boardList,
				children: state.boards.map((summary) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: [canvas_module_css_default.boardRow, state.board?.id === summary.id ? canvas_module_css_default.boardRowActive : ""].filter(Boolean).join(" "),
					onClick: () => {
						store.open(summary.id);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: canvas_module_css_default.boardName,
						children: summary.title
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: canvas_module_css_default.boardMeta,
						children: [summary.cardCount, " 个卡片"]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: canvas_module_css_default.boardDelete,
					title: "删除这块画布",
					onClick: () => {
						store.deleteBoard(summary.id);
					},
					children: "✕"
				})] }, summary.id))
			}),
			state.board === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: canvas_module_css_default.listFooter,
				children: [renaming ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
					defaultValue: state.board.title,
					autoFocus: true,
					onBlur: (event) => {
						store.setTitle(event.target.value.trim() === "" ? state.board.title : event.target.value.trim());
						setRenaming(false);
						store.saveNow();
					},
					onKeyDown: (event) => {
						if (event.key === "Enter") event.target.blur();
					}
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
					onClick: () => {
						setRenaming(true);
					},
					children: "重命名当前画布"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: canvas_module_css_default.muted,
					children: [state.boards.length, " 块画布"]
				})]
			})
		]
	});
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\surfaces.module.css.mjs
const css$8 = ".Ba4yDq_dock,[data-dsh-seework-dock]{z-index:60;flex-direction:row;align-items:center;gap:6px;display:flex;position:fixed;bottom:16px;right:16px}@media (width<=720px){.Ba4yDq_dock,[data-dsh-seework-dock]{flex-direction:column;align-items:flex-end}}.Ba4yDq_launcher{border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-button-elevated-fill,var(--dsw-alias-bg-layer-2,Canvas));color:var(--dsw-alias-label-primary,inherit);font:inherit;white-space:nowrap;cursor:pointer;opacity:.75;border-radius:999px;align-items:center;gap:6px;padding:6px 12px;font-size:12px;line-height:1.4;transition:opacity .12s,background .12s;display:inline-flex}.Ba4yDq_launcher:hover,.Ba4yDq_launcher:focus-visible{opacity:1;background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3,Canvas))}.Ba4yDq_launcherCount{background:var(--dsw-alias-interactive-bg-hover,#7f7f7f2e);color:var(--dsw-alias-label-secondary,inherit);border-radius:999px;padding:0 6px;font-size:11px}";
const tagId$8 = "dsh-seework/surfaces.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$8) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$8;
	tag.textContent = css$8;
	document.head.appendChild(tag);
}
var surfaces_module_css_default = {
	"dock": "Ba4yDq_dock",
	"launcherCount": "Ba4yDq_launcherCount",
	"launcher": "Ba4yDq_launcher"
};

//#endregion
//#region src/client/surfaces.ts
/** Marks the dock element. */
const SURFACE_DOCK_ATTR = "data-dsh-seework-dock";
/**
* The dock element, created on first use.
*
* Reuse is by attribute lookup, so a hot reload that mounts the surfaces again
* does not leave a second dock behind.
* @returns the dock element, or undefined when there is no document.
*/
function surfaceDock() {
	if (typeof document === "undefined") return void 0;
	const existing = document.querySelector(`[${SURFACE_DOCK_ATTR}=""]`);
	if (existing !== null) return existing;
	const dock = document.createElement("div");
	dock.setAttribute(SURFACE_DOCK_ATTR, "");
	dock.className = surfaces_module_css_default.dock;
	document.body.appendChild(dock);
	return dock;
}
/**
* Put one launcher button in the dock.
* @param button - the button element (its classes come from the surface).
* @returns disposer removing the button and the dock once it is empty.
*/
function attachLauncher(button) {
	const dock = surfaceDock();
	if (dock === void 0) return () => {};
	dock.appendChild(button);
	return () => {
		button.remove();
		if (dock.childElementCount === 0) dock.remove();
	};
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\settings-panel.module.css.mjs
const css$7 = ".Q1OXGa_overlay{z-index:61;background:color-mix(in srgb, var(--dsw-alias-bg-overlay,#000) 45%, transparent);justify-content:center;align-items:center;padding:24px;display:flex;position:fixed;inset:0}.Q1OXGa_overlay[hidden]{display:none}.Q1OXGa_panel{border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-2,Canvas);width:min(820px,100%);max-height:min(86vh,900px);color:var(--dsw-alias-label-primary,inherit);box-shadow:0 24px 64px var(--dsw-alias-bg-overlay,#0000004d);border-radius:16px;padding:20px 22px;overflow-y:auto}";
const tagId$7 = "dsh-seework/settings-panel.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$7) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$7;
	tag.textContent = css$7;
	document.head.appendChild(tag);
}
var settings_panel_module_css_default = {
	"panel": "Q1OXGa_panel",
	"overlay": "Q1OXGa_overlay"
};

//#endregion
//#region src/client/settings-panel.tsx
/** Marks the mounted launcher (a stable hook for tests and DOM inspection). */
const SETTINGS_LAUNCHER_ATTR = "data-dsh-seework-settings-launcher";
/** Cross-surface event: detail is the name of the surface that just opened. */
const ACTIVATE_EVENT = "dsh-seework-activate";
/**
* Ask sibling SeeWork surfaces to step aside, and report which one is opening.
* The DOM-mounted surfaces are siblings in `document.body`, so this is how they
* avoid stacking on top of each other without sharing React state.
* @param name - the surface that is opening.
*/
function announceActivation(name) {
	document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: name }));
}
/**
* Ask one SeeWork surface to open, from anywhere.
*
* The header launcher lives in the shell's toolbar rather than in this plugin's
* tree, so it cannot call a component's `setOpen` directly; announcing the
* surface is the same path its own launcher takes, which means one code path
* opens a surface however it was asked for.
* @param surface - the surface to bring up.
*/
function requestSurface(surface) {
	if (typeof document === "undefined") return;
	announceActivation(surface);
}
/** The surface whose activation was announced last, for launcher highlighting. */
let activeSurface;
/**
* Follow the activation stream.
* @param listener - called after each announcement with the surface it names.
* @returns disposer removing the listener.
*/
function onActivation(listener) {
	const handler = (event) => {
		const surface = event.detail;
		activeSurface = surface;
		listener(surface);
	};
	document.addEventListener(ACTIVATE_EVENT, handler);
	return () => {
		document.removeEventListener(ACTIVATE_EVENT, handler);
	};
}
/** Mount the launcher + overlay.
* @param scope - the bound settings scope.
* @param api - the plugin route client.
* @returns disposer unmounting everything this created.
*/
function mountSettingsPanel(scope, api) {
	const launcher = document.createElement("button");
	launcher.type = "button";
	launcher.setAttribute(SETTINGS_LAUNCHER_ATTR, "");
	launcher.className = surfaces_module_css_default.launcher;
	launcher.textContent = "SeeWork 设置";
	launcher.title = "设置 SeeAI Hub 地址、API Key 与图片模型";
	const overlay = document.createElement("div");
	overlay.className = settings_panel_module_css_default.overlay;
	overlay.hidden = true;
	overlay.setAttribute("role", "dialog");
	overlay.setAttribute("aria-modal", "true");
	overlay.setAttribute("aria-label", "SeeWork 设置");
	const panel = document.createElement("div");
	panel.className = settings_panel_module_css_default.panel;
	overlay.appendChild(panel);
	document.body.append(overlay);
	const detachLauncher = attachLauncher(launcher);
	const root = (0, react_dom_client.createRoot)(panel);
	root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SeeWorkSettingsCard, {
		scope,
		api
	}));
	const close = () => {
		overlay.hidden = true;
	};
	const onLauncher = () => {
		const next = overlay.hidden;
		overlay.hidden = !next;
		if (next) announceActivation("settings");
	};
	const onOtherActivate = (event) => {
		if (event.detail === "library") close();
	};
	const onOverlay = (event) => {
		if (event.target === overlay) close();
	};
	const onKey = (event) => {
		if (event.key === "Escape" && !overlay.hidden) close();
	};
	launcher.addEventListener("click", onLauncher);
	overlay.addEventListener("click", onOverlay);
	document.addEventListener("keydown", onKey);
	document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
	return () => {
		launcher.removeEventListener("click", onLauncher);
		overlay.removeEventListener("click", onOverlay);
		document.removeEventListener("keydown", onKey);
		document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
		root.unmount();
		detachLauncher();
		overlay.remove();
	};
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\header-launchers.module.css.mjs
const css$6 = ".Ra8aka_group{align-items:center;gap:4px;display:inline-flex}.Ra8aka_button{border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-button-elevated-fill,var(--dsw-alias-bg-layer-2,Canvas));color:var(--dsw-alias-label-primary,inherit);font:inherit;white-space:nowrap;cursor:pointer;opacity:.8;border-radius:999px;align-items:center;padding:5px 10px;font-size:12px;line-height:1.4;transition:opacity .12s,background .12s;display:inline-flex}.Ra8aka_button:hover,.Ra8aka_button:focus-visible{opacity:1;background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3,Canvas))}.Ra8aka_button[data-active=true]{border-color:var(--dsw-alias-brand-primary,currentColor);color:var(--dsw-alias-brand-primary,inherit);opacity:1}";
const tagId$6 = "dsh-seework/header-launchers.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$6) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$6;
	tag.textContent = css$6;
	document.head.appendChild(tag);
}
var header_launchers_module_css_default = {
	"group": "Ra8aka_group",
	"button": "Ra8aka_button"
};

//#endregion
//#region src/client/header-launchers.tsx
/**
* Who is visibly showing, as reported by the surfaces themselves.
*
* The launcher cannot infer this from the activation event alone: a surface can
* be closed from its own chrome (the drawer's 收起), and only the surface knows
* that happened. Registration is the surface's job; the launcher only asks.
*/
const openProbes = /* @__PURE__ */ new Map();
/**
* Report whether a surface is currently showing.
* @param surface - the surface.
* @param probe - reads the surface's own open state.
* @returns disposer retiring the report.
*/
function reportSurfaceOpen(surface, probe) {
	openProbes.set(surface, probe);
	return () => {
		if (openProbes.get(surface) === probe) openProbes.delete(surface);
	};
}
/**
* Is that surface up right now?
* @param surface - the surface to ask about.
* @returns true when the surface is showing.
*/
function isSurfaceOpen(surface) {
	return openProbes.get(surface)?.() === true;
}
/** The two entries, in display order. */
const LAUNCHER_TARGETS = [{
	surface: "library",
	label: "素材库",
	title: "查看用 SeeWork 生成过的图片"
}, {
	surface: "canvas",
	label: "画布",
	title: "把生成过的图片摆到画布上"
}];
/** The controls in force; the floating-surface fallback until proven otherwise. */
let controls;
/**
* Whether the header buttons are on screen.
*
* The conversation header only exists inside a session, so its buttons come and
* go: on the home screen there are none, which is why the floating dock must
* come back rather than be torn down for good.
*/
let headerPresent = false;
const presenceListeners = /* @__PURE__ */ new Set();
/**
* Report whether the header's SeeWork buttons are mounted (called by the
* component itself, so the answer is what is actually rendered).
* @param present - true while the buttons are on screen.
*/
function reportHeaderPresence(present) {
	if (headerPresent === present) return;
	headerPresent = present;
	for (const listener of [...presenceListeners]) listener(present);
}
/**
* Watch the header buttons' presence.
* @param listener - called now and on every change.
* @returns disposer removing the listener.
*/
function onHeaderPresence(listener) {
	presenceListeners.add(listener);
	listener(headerPresent);
	return () => {
		presenceListeners.delete(listener);
	};
}
/**
* Install the launcher controls.
* @param next - the controls to use.
* @returns disposer restoring the previous set.
*/
function setLauncherControls(next) {
	const previous = controls;
	controls = next;
	return () => {
		controls = previous;
	};
}
/**
* The header buttons.
*
* The open surface is tracked from the shared activation event rather than from
* the surfaces themselves, because those are mounted as siblings in
* `document.body` and share no React state with the header. Pressing the button
* of the surface that is already up puts it away again.
*/
function HeaderLaunchers(_props) {
	const [active, setActive] = (0, react.useState)(void 0);
	(0, react.useEffect)(() => onActivation((surface) => {
		setActive(surface);
	}), []);
	(0, react.useEffect)(() => {
		reportHeaderPresence(true);
		return () => {
			reportHeaderPresence(false);
		};
	}, []);
	const press = (surface) => {
		const current = controls;
		if (current !== void 0) {
			if (current.isOpen(surface)) current.close(surface);
			else current.open(surface);
			return;
		}
		if (isSurfaceOpen(surface)) {
			announceActivation(LAUNCHER_TARGETS.find((target) => target.surface !== surface)?.surface ?? "settings");
			return;
		}
		requestSurface(surface);
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: header_launchers_module_css_default.group,
		"data-dsh-seework-header-launchers": "",
		children: LAUNCHER_TARGETS.map((target) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			className: header_launchers_module_css_default.button,
			"data-surface": target.surface,
			"data-active": active === target.surface ? "true" : void 0,
			title: target.title,
			"aria-expanded": active === target.surface,
			onClick: () => {
				press(target.surface);
			},
			children: target.label
		}, target.surface))
	});
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\canvas-shell.module.css.mjs
const css$5 = ".UxbmzW_overlay{z-index:63;background:var(--dsw-alias-bg-base,Canvas);color:var(--dsw-alias-label-primary,inherit);flex-direction:column;font-size:13px;display:flex;position:fixed;inset:0}.UxbmzW_header{border-bottom:1px solid var(--dsw-alias-border-l1,currentColor);align-items:center;gap:12px;padding:10px 14px;display:flex}.UxbmzW_header strong{color:var(--dsw-alias-label-primary,inherit)}.UxbmzW_headerHint{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);flex:1;font-size:11px}.UxbmzW_close{border:1px solid var(--dsw-alias-border-l2,currentColor);color:var(--dsw-alias-label-primary,inherit);font:inherit;cursor:pointer;background:0 0;border-radius:999px;padding:5px 14px;font-size:12px}.UxbmzW_close:hover{background:var(--dsw-alias-interactive-bg-hover,#7f7f7f1f)}.UxbmzW_body{flex:1;min-height:0;display:flex}.UxbmzW_tabOverlay{flex-direction:column;width:100%;height:100%;min-height:0;display:flex}.UxbmzW_tabHeader{border-bottom:1px solid var(--dsw-alias-border-l1,currentColor);align-items:center;gap:8px;padding:8px 10px;display:flex}.UxbmzW_tabHeader .UxbmzW_headerHint{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;overflow:hidden}.UxbmzW_tabList{border-bottom:1px solid var(--dsw-alias-border-l1,currentColor);max-height:40%;display:flex;overflow:hidden}.UxbmzW_tabList>*{width:100%}";
const tagId$5 = "dsh-seework/canvas-shell.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$5) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$5;
	tag.textContent = css$5;
	document.head.appendChild(tag);
}
var canvas_shell_module_css_default = {
	"tabHeader": "UxbmzW_tabHeader",
	"headerHint": "UxbmzW_headerHint",
	"tabOverlay": "UxbmzW_tabOverlay",
	"tabList": "UxbmzW_tabList",
	"close": "UxbmzW_close",
	"body": "UxbmzW_body",
	"header": "UxbmzW_header",
	"overlay": "UxbmzW_overlay"
};

//#endregion
//#region src/client/canvas-panel.tsx
/** Marks the canvas launcher. */
const CANVAS_LAUNCHER_ATTR = "data-dsh-seework-canvas-launcher";
/** Everything the canvas surface owns, mounted into the dock's host element. */
function CanvasSurface({ library, store, launcher }) {
	const [open, setOpen] = (0, react.useState)(false);
	const openRef = (0, react.useRef)(false);
	/** Open or close, doing whatever the transition needs. */
	const setSurfaceOpen = (0, react.useCallback)((next) => {
		if (openRef.current === next) return;
		openRef.current = next;
		setOpen(next);
		if (!next) {
			store.close();
			return;
		}
		announceActivation("canvas");
		library.refresh();
		if (store.getSnapshot().board !== void 0) {
			store.refreshList();
			return;
		}
		(async () => {
			await store.refreshList();
			const first = store.getSnapshot().boards[0];
			await store.open(first?.id ?? "");
		})();
	}, [library, store]);
	(0, react.useEffect)(() => {
		const render = () => {
			const count = store.getSnapshot().boards.length;
			launcher.textContent = count === 0 ? "画布" : `画布 ${count}`;
			launcher.title = "把生成过的图片摆到画布上";
			launcher.setAttribute("aria-expanded", String(openRef.current));
		};
		render();
		const stop = store.subscribe(render);
		const onClick = () => {
			setSurfaceOpen(!openRef.current);
		};
		launcher.addEventListener("click", onClick);
		return () => {
			stop();
			launcher.removeEventListener("click", onClick);
		};
	}, [
		launcher,
		store,
		setSurfaceOpen
	]);
	(0, react.useEffect)(() => {
		const onOtherActivate = (event) => {
			if (event.detail !== "canvas") setSurfaceOpen(false);
		};
		document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
		return () => {
			document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
		};
	}, [setSurfaceOpen]);
	(0, react.useEffect)(() => onActivation((surface) => {
		if (surface === "canvas") setSurfaceOpen(true);
	}), [setSurfaceOpen]);
	(0, react.useEffect)(() => reportSurfaceOpen("canvas", () => openRef.current), []);
	if (!open) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: canvas_shell_module_css_default.overlay,
		role: "dialog",
		"aria-modal": "true",
		"aria-label": "SeeWork 画布",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
			className: canvas_shell_module_css_default.header,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "SeeWork 画布" }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: canvas_shell_module_css_default.headerHint,
					children: "把素材库里的图片摆到板上：拖标题栏移动、右下角调整大小、滚轮缩放；不做连线。"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: canvas_shell_module_css_default.close,
					onClick: () => {
						setSurfaceOpen(false);
					},
					children: "关闭"
				})
			]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: canvas_shell_module_css_default.body,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasBoardList, { store }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasBoard, {
				store,
				library: { entries: library.getSnapshot().entries },
				onNeedLibrary: () => {
					library.refresh();
				}
			})]
		})]
	});
}
/**
* Mount the canvas launcher and fallback overlay.
* @param api - the plugin route client (unused here; the store is resolved by the caller).
* @param library - the shared material-library store (the picture source).
* @param store - the shared canvas store, also rendered by the right-sidebar tab.
* @returns disposer unmounting everything this created.
*/
function mountCanvasSurfaces(api, library, store) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const launcher = document.createElement("button");
	launcher.type = "button";
	launcher.setAttribute(CANVAS_LAUNCHER_ATTR, "");
	launcher.className = surfaces_module_css_default.launcher;
	const detachLauncher = attachLauncher(launcher);
	const root = (0, react_dom_client.createRoot)(host);
	root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasSurface, {
		library,
		store,
		launcher
	}));
	return () => {
		root.unmount();
		detachLauncher();
		host.remove();
	};
}

//#endregion
//#region src/client/generation-watch.ts
/** How often the page asks the host what the newest entry is. */
const WATCH_INTERVAL_MS = 2e3;
/**
* Start watching for generations that finished in the host.
* @param deps - the api and the shared library store.
* @returns disposer stopping the watch.
*/
function watchGenerations(deps) {
	const setTimer = deps.setTimer ?? ((handler, ms) => setInterval(handler, ms));
	const clearTimer = deps.clearTimer ?? ((handle$1) => {
		clearInterval(handle$1);
	});
	/** Newest id already accounted for. */
	let newestId;
	/** False until the first successful look, which only adopts. */
	let observed = false;
	let stopped = false;
	let polling = false;
	const poll = async () => {
		if (stopped || polling) return;
		if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
		polling = true;
		try {
			const result = await deps.api.libraryHead();
			if (stopped) return;
			if (!result.ok) return;
			const head = result.value;
			if (!observed) {
				observed = true;
				newestId = head.newestId;
				return;
			}
			if (head.newestId === void 0 || head.newestId === newestId) return;
			newestId = head.newestId;
			await deps.library.refresh();
		} finally {
			polling = false;
		}
	};
	const handle = setTimer(() => {
		poll();
	}, deps.intervalMs ?? WATCH_INTERVAL_MS);
	return () => {
		stopped = true;
		clearTimer(handle);
	};
}

//#endregion
//#region src/client/library-store.ts
/** What the sidebar needs from the library. */
var LibraryStore = class {
	store = new SnapshotStore({
		status: "loading",
		entries: [],
		imageCount: 0,
		dataRoot: ""
	});
	inFlight;
	constructor(api) {
		this.api = api;
	}
	getSnapshot() {
		return this.store.getSnapshot();
	}
	subscribe(listener) {
		return this.store.subscribe(listener);
	}
	/** Re-read the library; concurrent calls share one request. */
	refresh() {
		if (this.inFlight !== void 0) return this.inFlight;
		const pending = this.load().finally(() => {
			if (this.inFlight === pending) this.inFlight = void 0;
		});
		this.inFlight = pending;
		return pending;
	}
	/**
	* Delete one entry and its files.
	* @returns true when the host accepted the deletion.
	*/
	async remove(id) {
		const result = await this.api.removeEntry(id);
		if (!result.ok) {
			this.store.update((draft) => {
				draft.status = "error";
				draft.error = result.message;
			});
			return false;
		}
		await this.refresh();
		return true;
	}
	/** Delete every entry. */
	async clear() {
		const result = await this.api.clearLibrary();
		if (!result.ok) {
			this.store.update((draft) => {
				draft.status = "error";
				draft.error = result.message;
			});
			return false;
		}
		await this.refresh();
		return true;
	}
	async load() {
		const result = await this.api.library();
		if (!result.ok) {
			this.store.update((draft) => {
				draft.status = "error";
				draft.error = result.message;
			});
			return;
		}
		const value = result.value;
		this.store.update((draft) => {
			draft.status = "ready";
			draft.entries = value.entries;
			draft.imageCount = value.imageCount;
			draft.dataRoot = value.dataRoot;
			delete draft.error;
		});
	}
};
/** The empty filter (everything). */
const EMPTY_FILTER = {
	query: "",
	model: "",
	source: "all",
	day: ""
};
/** Model ids present in the library, most used first, for the filter menu. */
function libraryModels(entries) {
	const counts = /* @__PURE__ */ new Map();
	for (const entry of entries) counts.set(entry.model, (counts.get(entry.model) ?? 0) + 1);
	return [...counts.entries()].map(([id, count]) => ({
		id,
		count
	})).sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));
}
/** Apply the sidebar filter (case-insensitive substring match on the prompt). */
function filterEntries(entries, filter) {
	const query = filter.query.trim().toLowerCase();
	return entries.filter((entry) => {
		if (filter.model !== "" && entry.model !== filter.model) return false;
		if (filter.source !== "all" && entry.source !== filter.source) return false;
		if (filter.day !== "" && dayOf(entry.createdAt) !== filter.day) return false;
		if (query !== "" && !entry.prompt.toLowerCase().includes(query)) return false;
		return true;
	});
}
/** Local calendar day of a timestamp, as `YYYY-MM-DD`. */
function dayOf(timestamp) {
	const date = new Date(timestamp);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}
/** Group entries into day sections, newest first (input order is preserved). */
function groupByDay(entries, now = Date.now()) {
	const today = dayOf(now);
	const yesterday = dayOf(now - 1440 * 60 * 1e3);
	const groups = /* @__PURE__ */ new Map();
	for (const entry of entries) {
		const day = dayOf(entry.createdAt);
		const bucket = groups.get(day);
		if (bucket === void 0) groups.set(day, [entry]);
		else bucket.push(entry);
	}
	return [...groups.entries()].sort((left, right) => right[0].localeCompare(left[0])).map(([day, bucket]) => ({
		day,
		label: day === today ? "今天" : day === yesterday ? "昨天" : day,
		entries: bucket
	}));
}
/** Prompt text clipped to a preview length. */
function promptPreview(prompt, max = 60) {
	const flat = prompt.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
/** Total bytes the library occupies, when every image reports a size. */
function entryCost(entry) {
	return entry.cost === void 0 ? void 0 : `¥${entry.cost.toFixed(2)}`;
}

//#endregion
//#region src/client/canvas-add.ts
/** How long one measurement step waits, and how many are taken before giving up. */
const STAGE_WAIT_STEP_MS = 50;
const STAGE_WAIT_ATTEMPTS = 30;
/** The face in force, or undefined while the composition root has not set one. */
let face;
/**
* Install the face the surfaces call.
* @param next - the face, or undefined to remove it.
* @returns disposer restoring the previous face.
*/
function setCanvasAddFace(next) {
	const previous = face;
	face = next;
	return () => {
		face = previous;
	};
}
/** Whether 「加到画布」 can do anything right now (surfaces hide the button when not). */
function canvasAddAvailable() {
	return face !== void 0;
}
/**
* Ask for one picture to be placed.
*
* Fire-and-forget by design: a click on a button must not make the caller wait,
* and a failure leaves the picture exactly where it already is — in the library,
* which is where the user would look for it anyway.
*
* @param target - the picture to place.
*/
function addToCanvas(target) {
	const current = face;
	if (current === void 0) return;
	current.add(target).catch(() => {});
}
/**
* Build the face the surfaces use.
* @param deps - both stores, how to reveal the canvas, and the stage measurement.
* @returns the face.
*/
function createCanvasAddFace(deps) {
	const sleep$1 = deps.sleep ?? ((ms) => new Promise((resolve) => {
		setTimeout(resolve, ms);
	}));
	/** An open board, creating one when the user has none yet. */
	const openBoard = async () => {
		if (deps.canvas.getSnapshot().board !== void 0) return;
		await deps.canvas.refreshList();
		const first = deps.canvas.getSnapshot().boards[0];
		await deps.canvas.open(first?.id ?? "");
	};
	/**
	* Wait briefly for the board on screen to report its size.
	*
	* Counted in attempts rather than wall-clock: the step is the same 50 ms either
	* way, and a caller that injects `sleep` (tests) drives it without real time.
	*/
	const waitForStage = async () => {
		for (let attempt = 0; attempt < STAGE_WAIT_ATTEMPTS; attempt += 1) {
			const size = deps.stageSize();
			if (size.width > 0 && size.height > 0) return;
			await sleep$1(STAGE_WAIT_STEP_MS);
		}
	};
	/** Fill in anything the caller did not know, from the library record. */
	const complete = (target) => {
		if (target.width !== void 0 && target.height !== void 0 && target.origin !== void 0) return target;
		const entry = deps.library.getSnapshot().entries.find((candidate) => candidate.images.some((image$1) => image$1.file === target.file));
		if (entry === void 0) return target;
		const image = entry.images.find((candidate) => candidate.file === target.file);
		return {
			...target,
			width: target.width ?? image?.width,
			height: target.height ?? image?.height,
			model: target.model ?? entry.model,
			prompt: target.prompt ?? entry.prompt,
			origin: target.origin ?? (entry.source === "panel" ? "panel" : "chat")
		};
	};
	return { async add(target) {
		await openBoard();
		deps.reveal();
		await waitForStage();
		const board = deps.canvas.getSnapshot().board;
		if (board === void 0) return false;
		const picture = complete(target);
		const centre = stageCentre(board.viewport, usableStage(deps.stageSize()));
		deps.canvas.addCards([centeredImageCard({
			file: picture.file,
			width: picture.width,
			height: picture.height,
			model: picture.model,
			prompt: picture.prompt,
			origin: picture.origin
		}, centre, unusedCardId(board))]);
		await deps.canvas.saveNow();
		return true;
	} };
}
/**
* The library file a plugin image URL serves, when it is one.
* @param src - an image URL (relative or absolute).
* @returns the file name, or undefined for another route.
*/
function libraryFileFromUrl(src) {
	const at = src.indexOf("/api/dsh-seework/library/image/");
	if (at < 0) return void 0;
	const file = src.slice(at + 31).split(/[?#]/)[0] ?? "";
	try {
		return file === "" ? void 0 : decodeURIComponent(file);
	} catch {
		return;
	}
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\library-detail.module.css.mjs
const css$4 = "._3Sls3q_overlay{z-index:64;background:color-mix(in srgb, var(--dsw-alias-bg-overlay,#000) 55%, transparent);justify-content:center;align-items:center;padding:28px;display:flex;position:fixed;inset:0}._3Sls3q_sheet{border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-2,Canvas);width:min(1100px,100%);max-height:min(88vh,900px);box-shadow:0 24px 64px var(--dsw-alias-bg-overlay,#00000059);color:var(--dsw-alias-label-primary,inherit);border-radius:14px;grid-template-columns:minmax(0,1.4fr) minmax(280px,.9fr);font-size:13px;display:grid;overflow:hidden}@media (width<=820px){._3Sls3q_sheet{grid-template-columns:minmax(0,1fr)}}._3Sls3q_stage{background:var(--dsw-alias-bg-layer-3,#7f7f7f0f);justify-content:center;align-items:center;min-height:240px;padding:16px;display:flex;position:relative}._3Sls3q_image{object-fit:contain;border-radius:8px;max-width:100%;max-height:min(74vh,760px)}._3Sls3q_pager{background:var(--dsw-alias-button-elevated-fill,#0000008c);border-radius:999px;align-items:center;gap:6px;padding:4px 8px;display:flex;position:absolute;bottom:12px;left:50%;transform:translate(-50%)}._3Sls3q_pagerText{color:var(--dsw-alias-label-primary,inherit);font-variant-numeric:tabular-nums;font-size:11px}._3Sls3q_side{border-left:1px solid var(--dsw-alias-border-l1,currentColor);flex-direction:column;gap:14px;padding:16px 18px 20px;display:flex;overflow-y:auto}@media (width<=820px){._3Sls3q_side{border-left:0;border-top:1px solid var(--dsw-alias-border-l1,currentColor)}}._3Sls3q_sideHeader{align-items:center;gap:8px;display:flex}._3Sls3q_sideHeader>:last-child{margin-left:auto}._3Sls3q_block{flex-direction:column;gap:8px;display:flex}._3Sls3q_blockTitle{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);margin:0;font-size:11px;font-weight:500}._3Sls3q_blockHead{justify-content:space-between;align-items:center;gap:8px;display:flex}._3Sls3q_copyButton{border-color:var(--dsw-alias-border-l3,currentColor);background:var(--dsw-alias-bg-layer-2,Canvas);padding:4px 12px;font-size:12px;font-weight:500}._3Sls3q_copyButton:hover,._3Sls3q_copyButton:focus-visible{border-color:var(--dsw-alias-brand-primary,currentColor);color:var(--dsw-alias-brand-primary,inherit)}._3Sls3q_stageActions{flex-wrap:wrap;align-items:center;gap:10px;display:flex}._3Sls3q_prompt{border:1px solid var(--dsw-alias-border-l1,currentColor);background:var(--dsw-alias-bg-layer-3,#7f7f7f14);max-height:220px;color:var(--dsw-alias-label-primary,inherit);font:inherit;white-space:pre-wrap;word-break:break-word;border-radius:8px;margin:0;padding:10px 12px;line-height:1.6;overflow-y:auto}._3Sls3q_facts{grid-template-columns:64px minmax(0,1fr);gap:4px 10px;margin:0;display:grid}._3Sls3q_facts dt{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);font-size:11px}._3Sls3q_facts dd{color:var(--dsw-alias-label-primary,inherit);overflow-wrap:anywhere;margin:0}._3Sls3q_files{flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;display:flex}._3Sls3q_files li{flex-wrap:wrap;align-items:baseline;gap:6px;display:flex}._3Sls3q_fileLink{color:var(--dsw-alias-brand-text,inherit);font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px}._3Sls3q_confirm{color:var(--dsw-alias-label-primary,inherit);background:#f8514924;border-radius:8px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}._3Sls3q_confirmActions{gap:8px;display:flex}._3Sls3q_badge{white-space:nowrap;border-radius:999px;padding:1px 7px;font-size:10px;line-height:16px}._3Sls3q_badgeAgent{color:light-dark(#1e4fd8,#9db9ff);background:#3b6cf633}._3Sls3q_badgePanel{color:light-dark(#1a7f37,#56d364);background:#2ea0432e}._3Sls3q_badgeCanvas{color:light-dark(#8a6100,#e3b341);background:#d2992233}._3Sls3q_muted{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);margin:0;font-size:11px}";
const tagId$4 = "dsh-seework/library-detail.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$4) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$4;
	tag.textContent = css$4;
	document.head.appendChild(tag);
}
var library_detail_module_css_default = {
	"block": "_3Sls3q_block",
	"sheet": "_3Sls3q_sheet",
	"prompt": "_3Sls3q_prompt",
	"blockHead": "_3Sls3q_blockHead",
	"confirm": "_3Sls3q_confirm",
	"image": "_3Sls3q_image",
	"blockTitle": "_3Sls3q_blockTitle",
	"files": "_3Sls3q_files",
	"pager": "_3Sls3q_pager",
	"copyButton": "_3Sls3q_copyButton",
	"sideHeader": "_3Sls3q_sideHeader",
	"fileLink": "_3Sls3q_fileLink",
	"pagerText": "_3Sls3q_pagerText",
	"badgeAgent": "_3Sls3q_badgeAgent",
	"badgeCanvas": "_3Sls3q_badgeCanvas",
	"stageActions": "_3Sls3q_stageActions",
	"muted": "_3Sls3q_muted",
	"side": "_3Sls3q_side",
	"stage": "_3Sls3q_stage",
	"confirmActions": "_3Sls3q_confirmActions",
	"overlay": "_3Sls3q_overlay",
	"facts": "_3Sls3q_facts",
	"badge": "_3Sls3q_badge",
	"badgePanel": "_3Sls3q_badgePanel"
};

//#endregion
//#region src/client/library-detail.tsx
/** Human label for where a generation came from. */
function SourceBadge({ source }) {
	const label = source === "agent" ? "对话" : source === "canvas" ? "画布" : "面板";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: `${library_detail_module_css_default.badge} ${source === "agent" ? library_detail_module_css_default.badgeAgent : source === "canvas" ? library_detail_module_css_default.badgeCanvas : library_detail_module_css_default.badgePanel}`,
		children: label
	});
}
/** The detail overlay. */
function LibraryDetail({ store, entryId, onClose }) {
	const [tick, setTick] = (0, react.useState)(0);
	(0, react.useEffect)(() => store.subscribe(() => {
		setTick((value) => value + 1);
	}), [store]);
	const [index, setIndex] = (0, react.useState)(0);
	const [copied, setCopied] = (0, react.useState)(false);
	const [confirming, setConfirming] = (0, react.useState)(false);
	const entry = store.getSnapshot().entries.find((candidate) => candidate.id === entryId);
	/** Whether the plugin can place pictures right now (no canvas face, no action). */
	const addable = canvasAddAvailable();
	/** Whether a session-scope tab is mounted to hand the picture to (see composer-draft). */
	const toComposer = composerAvailable();
	const [composerState, setComposerState] = (0, react.useState)("idle");
	/** Hand the picture on screen to the conversation composer. */
	const sendCurrentToComposer = async () => {
		if (image === void 0) return;
		setComposerState(await sendImageToConversation({
			url: image.url,
			name: attachmentNameFor(image.file)
		}).catch(() => false) ? "sent" : "failed");
		setTimeout(() => {
			setComposerState("idle");
		}, 2500);
	};
	(0, react.useEffect)(() => {
		const onKey = (event) => {
			if (event.key === "Escape") onClose();
			if (entry === void 0) return;
			if (event.key === "ArrowRight") setIndex((current) => Math.min(entry.images.length - 1, current + 1));
			if (event.key === "ArrowLeft") setIndex((current) => Math.max(0, current - 1));
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
		};
	}, [entry, onClose]);
	if (entry === void 0) return null;
	const image = entry.images[Math.min(index, entry.images.length - 1)];
	const copyPrompt = () => {
		copyText(entry.prompt).then(() => {
			setCopied(true);
			setTimeout(() => {
				setCopied(false);
			}, 1500);
		}).catch(() => {
			setCopied(false);
		});
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: library_detail_module_css_default.overlay,
		role: "dialog",
		"aria-modal": "true",
		"aria-label": "素材详情",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: library_detail_module_css_default.sheet,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: library_detail_module_css_default.stage,
				children: [image !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					className: library_detail_module_css_default.image,
					src: image.url,
					alt: entry.prompt.slice(0, 40)
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: library_detail_module_css_default.muted,
					children: "这条记录没有图片。"
				}), entry.images.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: library_detail_module_css_default.pager,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
							onClick: () => {
								setIndex((current) => Math.max(0, current - 1));
							},
							disabled: index === 0,
							title: "上一张",
							children: "←"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: library_detail_module_css_default.pagerText,
							children: [
								Math.min(index, entry.images.length - 1) + 1,
								" / ",
								entry.images.length
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
							onClick: () => {
								setIndex((current) => Math.min(entry.images.length - 1, current + 1));
							},
							disabled: index >= entry.images.length - 1,
							title: "下一张",
							children: "→"
						})
					]
				}) : null]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: library_detail_module_css_default.side,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: library_detail_module_css_default.sideHeader,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceBadge, { source: entry.source }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: library_detail_module_css_default.muted,
								children: new Date(entry.createdAt).toLocaleString("zh-CN")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
								onClick: onClose,
								title: "关闭（Esc）",
								children: "关闭"
							})
						]
					}),
					image !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: library_detail_module_css_default.stageActions,
						children: [
							addable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
								variant: "primary",
								"data-dsh-seework-add-to-canvas": "",
								title: "把当前这张图放到画布上",
								onClick: () => {
									addToCanvas({
										file: image.file,
										width: image.width,
										height: image.height,
										model: entry.model,
										prompt: entry.prompt
									});
								},
								children: "加到画布"
							}) : null,
							toComposer ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
								variant: "outline",
								"data-dsh-seework-add-to-composer": "",
								title: "把当前这张图放进对话输入框当草稿附件",
								onClick: () => {
									sendCurrentToComposer();
								},
								children: "加入到对话框"
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: library_detail_module_css_default.muted,
								children: [
									"当前这张 ",
									image.file,
									composerState === "sent" ? " · 已放进输入框" : "",
									composerState === "failed" ? " · 放入输入框失败" : ""
								]
							})
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: library_detail_module_css_default.block,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: library_detail_module_css_default.blockHead,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: library_detail_module_css_default.blockTitle,
								children: "提示词"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
								variant: "outline",
								className: library_detail_module_css_default.copyButton,
								onClick: copyPrompt,
								title: "复制这段提示词到剪贴板",
								"aria-label": "复制提示词",
								children: copied ? "已复制 ✓" : "复制提示词"
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							className: library_detail_module_css_default.prompt,
							children: entry.prompt
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: library_detail_module_css_default.block,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: library_detail_module_css_default.blockTitle,
							children: "生成参数"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
							className: library_detail_module_css_default.facts,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "模型" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: entry.model }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "档位" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: entry.resolution === "" ? "（未指定）" : entry.resolution }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "比例" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: entry.aspectRatio === "" ? "（未指定）" : entry.aspectRatio }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "尺寸" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: image === void 0 || image.width === void 0 || image.height === void 0 ? "未知" : `${image.width} × ${image.height} 像素` }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "格式" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: entry.outputFormat === "" ? "（网关默认）" : entry.outputFormat }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "张数" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: entry.n }),
								entry.cost === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "扣费" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: entryCost(entry) })] }),
								entry.refNames === void 0 || entry.refNames.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "参考图" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: entry.refNames.join("、") })] })
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: library_detail_module_css_default.block,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: library_detail_module_css_default.blockTitle,
							children: "文件"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: library_detail_module_css_default.files,
							children: entry.images.map((item, position) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								className: library_detail_module_css_default.fileLink,
								href: item.url,
								target: "_blank",
								rel: "noreferrer",
								children: item.file
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: library_detail_module_css_default.muted,
								children: [
									item.width !== void 0 && item.height !== void 0 ? `${item.width}×${item.height}` : "",
									" ",
									item.mime,
									position === Math.min(index, entry.images.length - 1) ? "（当前）" : ""
								]
							})] }, item.file))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
						className: library_detail_module_css_default.block,
						children: confirming ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: library_detail_module_css_default.confirm,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "删除后图片文件也会从磁盘移除，确定吗？" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: library_detail_module_css_default.confirmActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
									onClick: () => {
										store.remove(entry.id).then((ok) => {
											if (ok) onClose();
											else setConfirming(false);
										});
									},
									children: "确定删除"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
									onClick: () => {
										setConfirming(false);
									},
									children: "取消"
								})]
							})]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
							onClick: () => {
								setConfirming(true);
							},
							children: "删除这条记录"
						})
					})
				]
			})]
		})
	});
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\library-panel.module.css.mjs
const css$3 = ".KrCZHW_panel{z-index:62;border-right:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-2,Canvas);width:min(380px,92vw);box-shadow:0 0 48px var(--dsw-alias-bg-overlay,#00000040);color:var(--dsw-alias-label-primary,inherit);flex-direction:column;font-size:13px;display:flex;position:fixed;top:0;bottom:0;left:0}.KrCZHW_tabPanel{z-index:auto;width:100%;height:100%;min-height:0;box-shadow:none;background:0 0;border-right:0;position:static}.KrCZHW_tabPanel .KrCZHW_header{padding:10px 12px}.KrCZHW_header{border-bottom:1px solid var(--dsw-alias-border-l1,currentColor);flex-direction:column;gap:10px;padding:14px 16px 12px;display:flex}.KrCZHW_titleRow{justify-content:space-between;align-items:center;gap:8px;display:flex}.KrCZHW_title{color:var(--dsw-alias-label-primary,inherit);margin:0;font-size:14px;font-weight:600}.KrCZHW_headerActions{gap:6px;display:flex}.KrCZHW_filters{gap:10px;display:flex}.KrCZHW_filter{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.KrCZHW_filterLabel{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);font-size:11px}.KrCZHW_select{border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-1,transparent);width:100%;height:30px;color:var(--dsw-alias-label-primary,inherit);font:inherit;border-radius:8px;padding:0 8px;font-size:12px}.KrCZHW_activeFilters{flex-wrap:wrap;gap:6px;display:flex}.KrCZHW_chip{border:1px solid var(--dsw-alias-border-l2,currentColor);color:var(--dsw-alias-label-secondary,inherit);font:inherit;cursor:pointer;background:0 0;border-radius:999px;padding:2px 8px;font-size:11px}.KrCZHW_chip:hover{background:var(--dsw-alias-interactive-bg-hover,#7f7f7f24)}.KrCZHW_body{flex:1;padding:10px 12px 16px;overflow-y:auto}.KrCZHW_day{margin-bottom:14px}.KrCZHW_dayHeader{width:100%;color:var(--dsw-alias-label-tertiary,#7f7f7ff2);font:inherit;cursor:pointer;background:0 0;border:0;justify-content:space-between;align-items:center;padding:4px 4px 8px;font-size:11px;display:flex}.KrCZHW_dayHeader:hover{color:var(--dsw-alias-label-primary,inherit)}.KrCZHW_dayCount{font-variant-numeric:tabular-nums}.KrCZHW_list{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}.KrCZHW_card{border:1px solid var(--dsw-alias-border-l1,currentColor);background:var(--dsw-alias-bg-layer-1,transparent);border-radius:10px;gap:10px;padding:8px;display:flex}.KrCZHW_card:hover{border-color:var(--dsw-alias-border-l2,currentColor)}.KrCZHW_thumbButton{background:var(--dsw-alias-bg-layer-3,#7f7f7f1f);cursor:zoom-in;border:0;border-radius:8px;flex:none;width:64px;height:64px;padding:0;position:relative;overflow:hidden}.KrCZHW_thumb{object-fit:cover;width:100%;height:100%;display:block}.KrCZHW_imageCount{color:#fff;background:#0000009e;border-radius:999px;padding:0 5px;font-size:10px;line-height:16px;position:absolute;bottom:4px;right:4px}.KrCZHW_cardBody{flex-direction:column;flex:1;gap:6px;min-width:0;display:flex}.KrCZHW_promptButton{color:var(--dsw-alias-label-primary,inherit);font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;padding:0;line-height:1.45}.KrCZHW_promptButton:hover{text-decoration:underline}.KrCZHW_meta{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);flex-wrap:wrap;align-items:center;gap:6px;font-size:11px;display:flex}.KrCZHW_metaText{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.KrCZHW_addButton{border:1px solid var(--dsw-alias-border-l2,currentColor);color:var(--dsw-alias-label-secondary,inherit);font:inherit;cursor:pointer;background:0 0;border-radius:999px;margin-left:auto;padding:2px 8px;font-size:11px;line-height:16px}.KrCZHW_addButton:hover,.KrCZHW_addButton:focus-visible{border-color:var(--dsw-alias-brand-primary,currentColor);color:var(--dsw-alias-brand-primary,inherit)}.KrCZHW_footer{border-top:1px solid var(--dsw-alias-border-l1,currentColor);color:var(--dsw-alias-label-tertiary,#7f7f7ff2);flex-wrap:wrap;align-items:center;gap:8px;padding:10px 16px;font-size:11px;display:flex}.KrCZHW_footerPath{text-overflow:ellipsis;white-space:nowrap;direction:rtl;max-width:100%;overflow:hidden}.KrCZHW_empty{text-align:center;padding:24px 8px}.KrCZHW_emptyTitle{color:var(--dsw-alias-label-primary,inherit);margin:0 0 6px;font-weight:500}.KrCZHW_muted{color:var(--dsw-alias-label-tertiary,#7f7f7ff2);margin:0}.KrCZHW_error{color:light-dark(#b3261e,#ff7b72);background:#f8514929;border-radius:8px;margin:0 0 8px;padding:6px 10px;font-size:12px}.KrCZHW_linkButton{color:inherit;font:inherit;cursor:pointer;background:0 0;border:0;padding:0;text-decoration:underline}";
const tagId$3 = "dsh-seework/library-panel.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$3) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$3;
	tag.textContent = css$3;
	document.head.appendChild(tag);
}
var library_panel_module_css_default = {
	"meta": "KrCZHW_meta",
	"title": "KrCZHW_title",
	"activeFilters": "KrCZHW_activeFilters",
	"metaText": "KrCZHW_metaText",
	"tabPanel": "KrCZHW_tabPanel",
	"muted": "KrCZHW_muted",
	"dayCount": "KrCZHW_dayCount",
	"footer": "KrCZHW_footer",
	"filterLabel": "KrCZHW_filterLabel",
	"footerPath": "KrCZHW_footerPath",
	"header": "KrCZHW_header",
	"chip": "KrCZHW_chip",
	"promptButton": "KrCZHW_promptButton",
	"emptyTitle": "KrCZHW_emptyTitle",
	"dayHeader": "KrCZHW_dayHeader",
	"filters": "KrCZHW_filters",
	"list": "KrCZHW_list",
	"filter": "KrCZHW_filter",
	"panel": "KrCZHW_panel",
	"cardBody": "KrCZHW_cardBody",
	"card": "KrCZHW_card",
	"linkButton": "KrCZHW_linkButton",
	"empty": "KrCZHW_empty",
	"imageCount": "KrCZHW_imageCount",
	"thumbButton": "KrCZHW_thumbButton",
	"addButton": "KrCZHW_addButton",
	"thumb": "KrCZHW_thumb",
	"error": "KrCZHW_error",
	"headerActions": "KrCZHW_headerActions",
	"select": "KrCZHW_select",
	"day": "KrCZHW_day",
	"body": "KrCZHW_body",
	"titleRow": "KrCZHW_titleRow"
};

//#endregion
//#region src/client/LibraryPanel.tsx
/** The library drawer body. */
function LibraryPanel({ store, onClose, onOpen, hideClose = false, tab = false }) {
	const [tick, setTick] = (0, react.useState)(0);
	(0, react.useEffect)(() => store.subscribe(() => {
		setTick((value) => value + 1);
	}), [store]);
	const state = store.getSnapshot();
	const [filter, setFilter] = (0, react.useState)(EMPTY_FILTER);
	const [refreshing, setRefreshing] = (0, react.useState)(false);
	/** Whether the plugin can place pictures right now (no canvas face, no button). */
	const addable = canvasAddAvailable();
	const filtered = (0, react.useMemo)(() => filterEntries(state.entries, filter), [state.entries, filter]);
	const days = (0, react.useMemo)(() => groupByDay(filtered), [filtered]);
	const models = (0, react.useMemo)(() => libraryModels(state.entries), [state.entries]);
	const active = filter.query !== "" || filter.model !== "" || filter.source !== "all" || filter.day !== "";
	const refresh = () => {
		setRefreshing(true);
		store.refresh().finally(() => {
			setRefreshing(false);
		});
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
		className: tab ? `${library_panel_module_css_default.panel} ${library_panel_module_css_default.tabPanel}` : library_panel_module_css_default.panel,
		"aria-label": "SeeWork 素材库",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
				className: library_panel_module_css_default.header,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: library_panel_module_css_default.titleRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: library_panel_module_css_default.title,
							children: "SeeWork 素材库"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: library_panel_module_css_default.headerActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
								onClick: refresh,
								disabled: refreshing,
								title: "重新读取素材库",
								children: refreshing ? "刷新中…" : "刷新"
							}), hideClose ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
								onClick: onClose,
								title: "收起素材库",
								children: "收起"
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
						value: filter.query,
						placeholder: "搜索提示词…",
						spellCheck: false,
						onChange: (event) => {
							setFilter((current) => ({
								...current,
								query: event.target.value
							}));
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: library_panel_module_css_default.filters,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: library_panel_module_css_default.filter,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: library_panel_module_css_default.filterLabel,
								children: "模型"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: library_panel_module_css_default.select,
								value: filter.model,
								onChange: (event) => {
									setFilter((current) => ({
										...current,
										model: event.target.value
									}));
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: "全部"
								}), models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: model.id,
									children: [
										model.id,
										"（",
										model.count,
										"）"
									]
								}, model.id))]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: library_panel_module_css_default.filter,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: library_panel_module_css_default.filterLabel,
								children: "来源"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: library_panel_module_css_default.select,
								value: filter.source,
								onChange: (event) => {
									setFilter((current) => ({
										...current,
										source: event.target.value
									}));
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "all",
										children: "全部"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "agent",
										children: "对话生成"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "panel",
										children: "面板生成"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "canvas",
										children: "画布生成"
									})
								]
							})]
						})]
					}),
					filter.day !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: library_panel_module_css_default.activeFilters,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: library_panel_module_css_default.chip,
							onClick: () => {
								setFilter((current) => ({
									...current,
									day: ""
								}));
							},
							children: [
								"只看 ",
								filter.day,
								" ✕"
							]
						})
					}) : null
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: library_panel_module_css_default.body,
				children: [
					state.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: library_panel_module_css_default.error,
						children: [state.error ?? "素材库读取失败。", state.entries.length > 0 ? "（下面是上次读到的内容）" : ""]
					}) : null,
					state.status === "loading" && state.entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: library_panel_module_css_default.muted,
						children: "正在读取素材库…"
					}) : null,
					state.status !== "loading" && state.entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: library_panel_module_css_default.empty,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: library_panel_module_css_default.emptyTitle,
							children: "还没有生成过图片"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: library_panel_module_css_default.muted,
							children: "在对话里让 Agent 画一张图，成品就会出现在这里。"
						})]
					}) : null,
					state.entries.length > 0 && filtered.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: library_panel_module_css_default.muted,
						children: ["没有符合当前条件的图片。", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: library_panel_module_css_default.linkButton,
							onClick: () => {
								setFilter(EMPTY_FILTER);
							},
							children: "清除筛选"
						})]
					}) : null,
					days.map((day) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: library_panel_module_css_default.day,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: library_panel_module_css_default.dayHeader,
							title: `只看 ${day.day}`,
							onClick: () => {
								setFilter((current) => ({
									...current,
									day: current.day === day.day ? "" : day.day
								}));
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: day.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: library_panel_module_css_default.dayCount,
								children: day.entries.length
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: library_panel_module_css_default.list,
							children: day.entries.map((entry) => {
								const first = entry.images[0];
								return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
									className: library_panel_module_css_default.card,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: library_panel_module_css_default.thumbButton,
										onClick: () => {
											onOpen(entry.id);
										},
										title: "查看大图",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
											className: library_panel_module_css_default.thumb,
											src: first?.url ?? "",
											alt: promptPreview(entry.prompt, 24),
											loading: "lazy"
										}), entry.images.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: library_panel_module_css_default.imageCount,
											children: entry.images.length
										}) : null]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: library_panel_module_css_default.cardBody,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: library_panel_module_css_default.promptButton,
											onClick: () => {
												onOpen(entry.id);
											},
											children: promptPreview(entry.prompt)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: library_panel_module_css_default.meta,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceBadge, { source: entry.source }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: library_panel_module_css_default.metaText,
													children: entry.model
												}),
												entry.cost !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: library_panel_module_css_default.metaText,
													children: entryCost(entry)
												}) : null,
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
													className: library_panel_module_css_default.metaText,
													dateTime: new Date(entry.createdAt).toISOString(),
													children: new Date(entry.createdAt).toLocaleTimeString("zh-CN", {
														hour: "2-digit",
														minute: "2-digit"
													})
												}),
												addable && first !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: library_panel_module_css_default.addButton,
													"data-dsh-seework-add-to-canvas": "",
													title: "把这张图放到画布上",
													onClick: () => {
														addToCanvas({
															file: first.file,
															width: first.width,
															height: first.height,
															model: entry.model,
															prompt: entry.prompt
														});
													},
													children: "加到画布"
												}) : null
											]
										})]
									})]
								}) }, entry.id);
							})
						})]
					}, day.day))
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
				className: library_panel_module_css_default.footer,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: filtered.length === state.entries.length ? `${state.entries.length} 次生成 · ${state.imageCount} 张图` : `筛出 ${filtered.length} / ${state.entries.length} 次生成` }),
					state.dataRoot !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: library_panel_module_css_default.footerPath,
						title: state.dataRoot,
						children: state.dataRoot
					}) : null,
					active ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: library_panel_module_css_default.linkButton,
						onClick: () => {
							setFilter(EMPTY_FILTER);
						},
						children: "清除筛选"
					}) : null
				]
			})
		]
	});
}

//#endregion
//#region src/client/library-panel.tsx
/** Marks the library launcher so other surfaces can find it by selector. */
const LIBRARY_LAUNCHER_ATTR = "data-dsh-seework-library-launcher";
/** The drawer and its detail overlay; the launcher lives in the dock. */
function LibrarySurfaces({ store, api, launcher }) {
	const [open, setOpen] = (0, react.useState)(false);
	const [detailId, setDetailId] = (0, react.useState)(void 0);
	const [tick, setTick] = (0, react.useState)(0);
	(0, react.useEffect)(() => store.subscribe(() => {
		setTick((value) => value + 1);
	}), [store]);
	store.getSnapshot();
	(0, react.useEffect)(() => {
		const render = () => {
			const current = store.getSnapshot();
			launcher.textContent = "";
			launcher.append("素材库");
			if (current.entries.length > 0) {
				const badge = document.createElement("span");
				badge.className = surfaces_module_css_default.launcherCount;
				badge.textContent = String(current.imageCount);
				launcher.append(badge);
			}
			launcher.title = "查看用 SeeWork 生成过的图片";
			launcher.setAttribute("aria-expanded", String(open));
		};
		render();
		const stop = store.subscribe(render);
		return () => {
			stop();
		};
	}, [
		launcher,
		open,
		store
	]);
	(0, react.useEffect)(() => {
		const onClick = () => {
			const next = !open;
			setOpen(next);
			if (next) {
				announceActivation("library");
				store.refresh();
			}
		};
		launcher.addEventListener("click", onClick);
		return () => {
			launcher.removeEventListener("click", onClick);
		};
	}, [
		launcher,
		open,
		store
	]);
	(0, react.useEffect)(() => {
		const onOtherActivate = (event) => {
			if (event.detail !== "library") setOpen(false);
		};
		document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
		return () => {
			document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
		};
	}, []);
	(0, react.useEffect)(() => onActivation((surface) => {
		if (surface !== "library") return;
		setOpen(true);
		store.refresh();
	}), [store]);
	const openRef = (0, react.useRef)(false);
	openRef.current = open;
	(0, react.useEffect)(() => reportSurfaceOpen("library", () => openRef.current), []);
	if (!open) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibraryPanel, {
		store,
		onClose: () => {
			setOpen(false);
			setDetailId(void 0);
		},
		onOpen: (id) => {
			setDetailId(id);
		}
	}), detailId === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibraryDetail, {
		store,
		entryId: detailId,
		onClose: () => {
			setDetailId(void 0);
		}
	})] });
}
/**
* Mount the library launcher, drawer and detail overlay.
* @param api - the plugin route client.
* @param store - the shared library store (also read by the canvas).
* @returns disposer unmounting everything this created.
*/
function mountLibraryPanel(api, store) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const launcher = document.createElement("button");
	launcher.type = "button";
	launcher.setAttribute(LIBRARY_LAUNCHER_ATTR, "");
	launcher.className = surfaces_module_css_default.launcher;
	const detachLauncher = attachLauncher(launcher);
	store.refresh();
	const root = (0, react_dom_client.createRoot)(host);
	root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibrarySurfaces, {
		store,
		api,
		launcher
	}));
	return () => {
		root.unmount();
		detachLauncher();
		host.remove();
	};
}

//#endregion
//#region src/client/settings-scope.ts
/** POST one bridge request and decode its envelope. */
async function post(path, body, fetchFn) {
	try {
		const response = await fetchFn(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body)
		});
		if (!response.ok) return {
			ok: false,
			code: "internal",
			message: `设置接口返回 HTTP ${response.status}`
		};
		return await response.json();
	} catch {
		return {
			ok: false,
			code: "internal",
			message: "设置接口不可达"
		};
	}
}
/** The scope implementation over the bridge. */
var BridgeScope = class {
	store;
	secrets;
	tail = Promise.resolve();
	disposed = false;
	constructor(fetchFn) {
		this.fetchFn = fetchFn;
		this.store = new SnapshotStore({
			status: "loading",
			value: void 0,
			base: void 0,
			user: void 0,
			revision: void 0,
			writable: false
		});
		this.secrets = new SnapshotStore({});
	}
	getSnapshot() {
		return this.store.getSnapshot();
	}
	subscribe(listener) {
		return this.store.subscribe(listener);
	}
	subscribeSecrets(listener) {
		return this.secrets.subscribe(listener);
	}
	getSecretSet(field) {
		return this.secrets.getSnapshot()[field] === true;
	}
	load() {
		return this.enqueue(() => this.read());
	}
	set(field, value) {
		return this.enqueue(() => this.write([{
			op: "set",
			path: [field],
			value
		}]));
	}
	unset(field) {
		return this.enqueue(() => this.write([{
			op: "unset",
			path: [field]
		}]));
	}
	mutateOps(ops) {
		return this.enqueue(() => this.write(ops));
	}
	/** Queue one operation behind every earlier one. */
	enqueue(operation) {
		if (this.disposed) return Promise.resolve();
		const task = this.tail.then(async () => {
			if (this.disposed) return;
			await operation();
		});
		this.tail = task.catch(() => {});
		return task;
	}
	async read() {
		const envelope = await post(SETTINGS_API.describe, {}, this.fetchFn);
		if (this.disposed) return;
		if (!envelope.ok) {
			this.store.update((draft) => {
				draft.status = "unavailable";
			});
			return;
		}
		const { namespaces, writable } = envelope.value;
		const view = namespaces?.[0];
		if (view === void 0) {
			this.store.update((draft) => {
				draft.status = "unavailable";
				draft.writable = writable === true;
			});
			this.secrets.set({});
			return;
		}
		this.accept(view, writable);
	}
	async write(ops) {
		const revision = this.getSnapshot().revision;
		const envelope = await post(SETTINGS_API.mutate, {
			ns: "dsh-seework",
			ops,
			...revision === void 0 ? {} : { expectedRevision: revision }
		}, this.fetchFn);
		if (this.disposed) return;
		if (!envelope.ok) {
			await this.read();
			return;
		}
		this.accept(envelope.value, void 0);
	}
	/** Fold one bridge view into the snapshot and the secret-presence sidecar. */
	accept(view, writable) {
		this.store.update((draft) => {
			draft.revision = view.revision;
			draft.base = view.base;
			draft.user = view.user;
			if (writable !== void 0) draft.writable = writable;
			draft.status = "ready";
			draft.value = view.value;
		});
		const bits = {};
		for (const secret of view.secrets ?? []) bits[secret.path.join(".")] = secret.set;
		this.secrets.set(bits);
	}
};
/**
* Bind the plugin's settings scope and start its initial read.
* @param fetchFn - the fetch implementation (the page's own fetch on loopback).
* @returns the bound scope.
*/
function bindSeeWorkScope(fetchFn = fetch) {
	const scope = new BridgeScope(fetchFn);
	scope.load();
	return scope;
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\chat-images.module.css.mjs
const css$2 = ".J_jP7q_backdrop{z-index:2147483000;background:color-mix(in srgb, var(--dsw-alias-bg-base,#000) 72%, transparent);cursor:zoom-out;justify-content:center;align-items:center;padding:24px;display:flex;position:fixed;inset:0}.J_jP7q_full{cursor:default;border-radius:12px;width:auto;max-width:92vw;height:auto;max-height:92vh;box-shadow:0 12px 40px #00000073}.J_jP7q_actions{gap:8px;display:flex;position:fixed;bottom:28px;left:50%;transform:translate(-50%)}.J_jP7q_action{border:1px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-button-elevated-fill,var(--dsw-alias-bg-layer-2,Canvas));color:var(--dsw-alias-label-primary,inherit);font:inherit;cursor:pointer;border-radius:999px;padding:7px 16px;font-size:13px;line-height:1.4}.J_jP7q_action:hover,.J_jP7q_action:focus-visible{border-color:var(--dsw-alias-brand-primary,currentColor);color:var(--dsw-alias-brand-primary,inherit)}";
const tagId$2 = "dsh-seework/chat-images.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$2;
	tag.textContent = css$2;
	document.head.appendChild(tag);
}
var chat_images_module_css_default = {
	"actions": "J_jP7q_actions",
	"action": "J_jP7q_action",
	"backdrop": "J_jP7q_backdrop",
	"full": "J_jP7q_full"
};

//#endregion
//#region src/client/chat-images.tsx
/** Marker on the card's own thumbnails, which size themselves. */
const CARD_IMAGE_ATTR = "data-dsh-seework-card-image";
/** Attribute marking the lightbox host, so anything can find it. */
const LIGHTBOX_ATTR = "data-dsh-seework-image-zoom";
/**
* Images this module sizes and zooms: images the chat nodes render, whose source
* is one of this plugin's routes. Scoped to the chat, so the material library and
* the canvas keep their own layout.
*/
const CHAT_IMAGE_SELECTOR = `[data-chat-anchor-key] img[src*="/api/dsh-seework/"]:not([${CARD_IMAGE_ATTR}])`;
/** Same scope, but including the card's thumbnails, for the zoom click. */
const ZOOMABLE_SELECTOR = `[data-chat-anchor-key] img[src*="/api/dsh-seework/"]`;
/** Cap on a conversation image's rendered size (the original opens on click). */
const THUMBNAIL_MAX_PX = 320;
/** The style rule that keeps a generated picture from taking the whole window. */
const CHAT_IMAGE_CSS = `${CHAT_IMAGE_SELECTOR} {
  max-width: ${THUMBNAIL_MAX_PX}px;
  max-height: ${THUMBNAIL_MAX_PX}px;
  width: auto;
  height: auto;
  border-radius: 10px;
  cursor: zoom-in;
}
${ZOOMABLE_SELECTOR} {
  cursor: zoom-in;
}
`;
/** Is this element one of the conversation images we own? */
function zoomableImage(target) {
	if (!(target instanceof Element)) return void 0;
	const image = target.closest("img");
	if (image === null || !(image instanceof HTMLImageElement)) return void 0;
	return image.matches(ZOOMABLE_SELECTOR) ? image : void 0;
}
/** Whether this click should open the lightbox rather than the browser's own. */
function isPlainLeftClick(event) {
	return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
/**
* The enlarged view: the picture at up to the viewport, closed by a click
* outside. When the picture is one the plugin can place, it also offers
* 「加到画布」 — the deliberate, one-click way to put it on a board.
*/
function ChatImageLightbox({ src, onClose, onAddToCanvas }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: chat_images_module_css_default.backdrop,
		role: "dialog",
		"aria-modal": "true",
		"aria-label": "查看大图",
		onClick: onClose,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
			className: chat_images_module_css_default.full,
			src,
			alt: "生成的图片（大图）",
			onClick: (event) => {
				event.stopPropagation();
			}
		}), onAddToCanvas === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: chat_images_module_css_default.actions,
			onClick: (event) => {
				event.stopPropagation();
			},
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: chat_images_module_css_default.action,
				"data-dsh-seework-add-to-canvas": "",
				onClick: onAddToCanvas,
				children: "加到画布"
			})
		})]
	});
}
/** One lightbox at a time, mounted on demand. */
let lightbox;
/**
* Show one conversation image enlarged.
* @param src - the image's source (the original, not a thumbnail copy).
* @param doc - the document to mount into (tests pass their jsdom document).
* @param target - the library picture behind it, when the plugin can place it.
*/
function openChatImage(src, doc = document, target) {
	closeChatImage();
	const host = doc.createElement("div");
	host.setAttribute(LIGHTBOX_ATTR, "");
	doc.body.appendChild(host);
	const root = (0, react_dom_client.createRoot)(host);
	lightbox = {
		host,
		root
	};
	const onAdd = target === void 0 || !canvasAddAvailable() ? void 0 : () => {
		closeChatImage();
		addToCanvas(target);
	};
	root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChatImageLightbox, {
		src,
		onClose: () => {
			closeChatImage();
		},
		onAddToCanvas: onAdd
	}));
}
/** Put the enlarged view away, when there is one. */
function closeChatImage() {
	const current = lightbox;
	if (current === void 0) return;
	lightbox = void 0;
	current.root.unmount();
	current.host.remove();
}
/**
* Install the cap and the click-to-enlarge behaviour.
*
* @param doc - the document to watch (tests pass their jsdom document).
* @param resolveTarget - turns an image URL into the library picture behind it,
*   when the plugin can place that picture (see {@link CanvasAddTarget}).
* @returns disposer removing the style, the listeners, and any open lightbox.
*/
function installChatImageZoom(doc = document, resolveTarget) {
	const style = doc.createElement("style");
	style.setAttribute("data-dsh-seework", "chat-image-zoom");
	style.textContent = CHAT_IMAGE_CSS;
	doc.head.appendChild(style);
	const onClick = (event) => {
		const image = zoomableImage(event.target);
		if (image === void 0 || !isPlainLeftClick(event)) return;
		event.preventDefault();
		event.stopPropagation();
		const src = image.currentSrc === "" ? image.src : image.currentSrc;
		openChatImage(src, doc, resolveTarget === void 0 ? void 0 : resolveTarget(src));
	};
	doc.addEventListener("click", onClick, true);
	const onKey = (event) => {
		if (event.key === "Escape") closeChatImage();
	};
	doc.addEventListener("keydown", onKey);
	return () => {
		doc.removeEventListener("click", onClick, true);
		doc.removeEventListener("keydown", onKey);
		style.remove();
		closeChatImage();
	};
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\update-notice.module.css.mjs
const css$1 = "[data-dsh-seework-update-notice]{z-index:60;pointer-events:auto;border:1px solid var(--dsw-alias-border-l1,#80808059);background:var(--dsw-alias-bg-overlay,Canvas);max-width:min(420px,100vw - 32px);color:var(--dsw-alias-label-primary,CanvasText);border-radius:10px;align-items:center;gap:10px;padding:10px 12px;font-size:13px;line-height:1.5;display:flex;position:fixed;bottom:64px;right:16px;box-shadow:0 6px 20px #0000002e}@media (width<=720px){[data-dsh-seework-update-notice]{bottom:116px}}[data-dsh-seework-update-notice] .vNk2OW_text{flex:auto;min-width:0}[data-dsh-seework-update-notice] .vNk2OW_current{color:var(--dsw-alias-label-secondary,currentColor)}[data-dsh-seework-update-notice] .vNk2OW_action{border:1px solid var(--dsw-alias-brand-primary,currentColor);color:var(--dsw-alias-brand-primary,currentColor);font:inherit;cursor:pointer;background:0 0;border-radius:999px;flex:none;padding:3px 12px;font-size:12px}[data-dsh-seework-update-notice] .vNk2OW_action:disabled{opacity:.6;cursor:default}[data-dsh-seework-update-notice] .vNk2OW_dismiss{color:var(--dsw-alias-label-secondary,currentColor);font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:2px 6px;font-size:12px}[data-dsh-seework-update-notice] .vNk2OW_dismiss:hover{color:var(--dsw-alias-label-primary,currentColor)}";
const tagId$1 = "dsh-seework/update-notice.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId$1;
	tag.textContent = css$1;
	document.head.appendChild(tag);
}
var update_notice_module_css_default = {
	"dismiss": "vNk2OW_dismiss",
	"current": "vNk2OW_current",
	"text": "vNk2OW_text",
	"action": "vNk2OW_action"
};

//#endregion
//#region src/client/UpdateNotice.tsx
/**
* Used when the slot does not hand one over.
*
* `shell.overlay` declares no owner props, so whether a registration-time
* `inject` reaches the component depends on the slot's own contract — and a
* notice that renders but cannot call its route is worse than one that builds
* its own client. The class is a stateless wrapper around the plugin's route
* URLs, so a second instance costs nothing.
*/
const ownApi = new SeeWorkApi();
/**
* Delay before the first (and only) check.
*
* Long enough that it never competes with the shell's own boot, short enough
* that the notice appears while the user is still looking at the window.
*/
const FIRST_CHECK_MS = 4e3;
/**
* Render the update notice, or nothing.
* @param props.api - the plugin route client; the slot may or may not supply it.
*/
function UpdateNotice({ api }) {
	const client = api ?? ownApi;
	const [status, setStatus] = (0, react.useState)(void 0);
	const [dismissed, setDismissed] = (0, react.useState)(false);
	const [busy, setBusy] = (0, react.useState)(false);
	(0, react.useEffect)(() => {
		const timer = setTimeout(() => {
			client.updateStatus().then((answer) => {
				if (answer.ok) setStatus(answer.value);
			});
		}, FIRST_CHECK_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [client]);
	const install = (0, react.useCallback)(async () => {
		setBusy(true);
		await client.applyUpdate();
		setBusy(false);
		setDismissed(true);
	}, [client]);
	if (dismissed || status?.updateAvailable !== true || status.latest === void 0) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: update_notice_module_css_default.notice,
		"data-dsh-seework-update-notice": "",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: update_notice_module_css_default.text,
				children: [
					"SeeWork 有新版本 ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: status.latest }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: update_notice_module_css_default.current,
						children: [
							"（当前 ",
							status.current,
							"）"
						]
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: update_notice_module_css_default.action,
				"data-dsh-seework-update-notice-apply": "",
				disabled: busy,
				onClick: () => {
					install();
				},
				children: busy ? "更新中…" : "更新"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: update_notice_module_css_default.dismiss,
				"data-dsh-seework-update-notice-dismiss": "",
				"aria-label": "关闭",
				onClick: () => {
					setDismissed(true);
				},
				children: "✕"
			})
		]
	});
}

//#endregion
//#region \0dsh-css:E:\workspace\dsh-plugin\dsh-seework\src\client\tool-card.module.css.mjs
const css = ".jG4yBG_root{flex-direction:column;gap:6px;margin:4px 0 4px 4px;display:flex}.jG4yBG_header{font-size:var(--dsh-content-font-size-secondary,13px);align-items:baseline;gap:8px;line-height:1.4;display:flex}.jG4yBG_title{color:var(--dsw-alias-label-primary,inherit);font-weight:500}.jG4yBG_status{color:var(--dsw-alias-label-tertiary,inherit)}.jG4yBG_root[data-state=failed] .jG4yBG_status{color:var(--dsw-alias-state-error-primary,inherit)}.jG4yBG_message{color:var(--dsw-alias-label-secondary,inherit);font-size:var(--dsh-content-font-size-secondary,13px);overflow-wrap:anywhere;margin:0;line-height:1.5}.jG4yBG_images{flex-wrap:wrap;gap:8px;display:flex}.jG4yBG_imageLink{border:1px solid var(--dsw-alias-border-l1,currentColor);border-radius:10px;line-height:0;display:block;overflow:hidden}.jG4yBG_thumb{flex-direction:column;align-items:flex-start;gap:4px;display:flex}.jG4yBG_action{border:1px solid var(--dsw-alias-border-l2,currentColor);color:var(--dsw-alias-label-secondary,inherit);font:inherit;cursor:pointer;background:0 0;border-radius:999px;padding:2px 8px;font-size:11px;line-height:16px}.jG4yBG_action:hover,.jG4yBG_action:focus-visible{border-color:var(--dsw-alias-brand-primary,currentColor);color:var(--dsw-alias-brand-primary,inherit)}.jG4yBG_imageLink:hover,.jG4yBG_imageLink:focus-visible{border-color:var(--dsw-alias-brand-primary,currentColor)}.jG4yBG_image{object-fit:contain;background:var(--dsw-alias-bg-layer-2,Canvas);width:auto;max-width:220px;height:auto;max-height:220px;display:block}.jG4yBG_missing{border:1px dashed var(--dsw-alias-border-l2,currentColor);color:var(--dsw-alias-label-tertiary,inherit);font-size:var(--dsh-content-font-size-secondary,13px);border-radius:10px;align-items:center;padding:6px 10px;display:inline-flex}";
const tagId = "dsh-seework/tool-card.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-seework";
	tag.dataset.pluginCss = tagId;
	tag.textContent = css;
	document.head.appendChild(tag);
}
var tool_card_module_css_default = {
	"images": "jG4yBG_images",
	"title": "jG4yBG_title",
	"message": "jG4yBG_message",
	"thumb": "jG4yBG_thumb",
	"image": "jG4yBG_image",
	"imageLink": "jG4yBG_imageLink",
	"status": "jG4yBG_status",
	"header": "jG4yBG_header",
	"action": "jG4yBG_action",
	"root": "jG4yBG_root",
	"missing": "jG4yBG_missing"
};

//#endregion
//#region src/client/tool-card.tsx
/**
* Tool names whose results carry images.
*
* `get_seework_task` is no longer registered by the host half — SeeAI Hub's image
* API is synchronous, so the plugin stopped offering a task handle — but this key
* stays on purpose: results of that name are already persisted in session logs,
* and dropping the key would turn those historical rows back into raw JSON. Same
* reasoning as the board still reading cards written before `origin` existed.
*
* `edit_image` deliberately does **not** get that treatment (#664): the tool was
* merged into `generate_image` while this plugin is still in development, and a
* historical edit row is allowed to fall back to the shell's generic row. Its
* images are still in the material library, so nothing is lost by not having a
* bespoke card for it.
*/
const TOOL_CARD_KEYS = ["generate_image", "get_seework_task"];
/**
* Priority of these registrations inside the keyed slot.
*
* Two plugins can (and on a real machine do) claim the same wire tool name — the
* reference image plugin registers its own view for `generate_image`. The slot
* registry refuses a second registration at the SAME priority and fails the
* whole plugin that lost the race (observed live: the other plugin's loader
* entry failed with "already has an entry for key generate_image at priority 0 …
* register at a different priority to shadow it"), so claiming a distinct, lower
* priority is not a nicety — it is how both plugins stay loadable, and "lowest
* renders" makes this card the one shown.
*
* That is the right winner here: this view reads the images from the result's
* persisted `meta`, which both plugins emit under the same field names, while a
* view that reads them out of the result content has nothing to show (tool
* results are not model-visible content).
*/
const TOOL_CARD_PRIORITY = -10;
/** Human-readable state for the result JSON's `status`. */
function statusLabel(status) {
	if (status === "running" || status === "queued") return "生成中";
	if (status === "failed") return "生成失败";
	if (status === "cancelled") return "已取消";
	return "已生成";
}
/**
* Card titles. The shell prints the wire tool name above the row, which is not
* something a user should have to read, so the card says what it did instead.
* @param toolName - the wire tool name.
* @returns the display title.
*/
function cardTitle(toolName) {
	if (toolName === "get_seework_task") return "SeeWork 生图任务";
	return "SeeWork 生图";
}
/** Whether the node is a settled result rather than a running call. */
function isSettled(block) {
	return block !== void 0 && typeof block.kind === "string";
}
/** The result's own JSON text, if the row carries exactly what we wrote. */
function resultText(block) {
	if (block === void 0 || !Array.isArray(block.content)) return "";
	return block.content.flatMap((part) => {
		if (typeof part !== "object" || part === null) return [];
		const { type, text } = part;
		return type === "text" && typeof text === "string" ? [text] : [];
	}).join("\n");
}
/** `status` / `message` from that JSON, degrading to the raw text. */
function resultInfo(block) {
	if (!isSettled(block)) return {
		status: "running",
		message: "正在生成图片…"
	};
	const text = resultText(block);
	try {
		const parsed = JSON.parse(text);
		return {
			status: typeof parsed.status === "string" ? parsed.status : block?.isError === true ? "failed" : "completed",
			message: typeof parsed.message === "string" ? parsed.message : ""
		};
	} catch {
		return {
			status: block?.isError === true ? "failed" : "completed",
			message: text
		};
	}
}
/**
* Narrow the persisted metadata's `images` into references we can request.
*
* All-or-nothing per record: a half-valid reference would make the route answer
* 400 for a picture the row claims to have, so it is dropped instead.
*
* @param meta - the result's persisted presentation metadata, of unknown shape.
* @returns the valid image records, in result order.
*/
function imagesOf(meta) {
	if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return [];
	const images = meta.images;
	if (!Array.isArray(images)) return [];
	const out = [];
	for (const value of images) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const { attachment_id: attachmentId, media_type: mediaType, bytes, width, height, name, file } = value;
		if (typeof attachmentId !== "string" || attachmentId === "") continue;
		if (typeof mediaType !== "string" || !isImageMedia(mediaType)) continue;
		if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 1) continue;
		if (typeof width !== "number" || !Number.isSafeInteger(width) || width < 1) continue;
		if (typeof height !== "number" || !Number.isSafeInteger(height) || height < 1) continue;
		out.push({
			attachment_id: attachmentId,
			media_type: mediaType,
			bytes,
			width,
			height,
			...typeof name === "string" && name !== "" ? { name } : {},
			...typeof file === "string" && file !== "" ? { file } : {}
		});
	}
	return out;
}
/**
* Library file names carried by the result's own JSON text.
*
* A row recorded before `presentationMeta` included `file` still has the name in
* its model-facing JSON, and those older rows keep their button this way.
*
* @param block - the settled result node.
* @returns the file names in result order (empty strings where absent).
*/
function filesFromResultText(block) {
	try {
		const parsed = JSON.parse(resultText(block));
		if (!Array.isArray(parsed.images)) return [];
		return parsed.images.map((image) => {
			const file = typeof image === "object" && image !== null ? image.file : void 0;
			return typeof file === "string" ? file : "";
		});
	} catch {
		return [];
	}
}
/**
* The URL that serves one such record back.
* @param image - one validated image record.
* @returns the same-origin route URL with the complete reference.
*/
function imageUrl(image) {
	const query = new URLSearchParams({
		attachment_id: image.attachment_id,
		media_type: image.media_type,
		bytes: String(image.bytes),
		width: String(image.width),
		height: String(image.height)
	});
	return `${ATTACHMENT_API.image}?${query.toString()}`;
}
/**
* The conversation card for one SeeWork image-generating tool call.
* @param props - the shell's owner payload for this call.
* @returns the card row.
*/
function ToolCard(props) {
	const block = props.block;
	const { status, message } = resultInfo(block);
	const images = (0, react.useMemo)(() => imagesOf(block?.meta), [block?.meta]);
	const fallbackFiles = (0, react.useMemo)(() => filesFromResultText(block), [block]);
	const [broken, setBroken] = (0, react.useState)(/* @__PURE__ */ new Set());
	const name = props.toolName ?? "generate_image";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: tool_card_module_css_default.root,
		"data-state": status,
		"data-tool": name,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
				className: tool_card_module_css_default.header,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
					className: tool_card_module_css_default.title,
					children: cardTitle(name)
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: tool_card_module_css_default.status,
					children: statusLabel(status)
				})]
			}),
			message === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: tool_card_module_css_default.message,
				children: message
			}),
			images.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: tool_card_module_css_default.images,
				children: images.map((image, index) => {
					const url = imageUrl(image);
					if (broken.has(image.attachment_id)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: tool_card_module_css_default.missing,
						children: "图片已不可读"
					}, image.attachment_id);
					const file = image.file ?? fallbackFiles[index] ?? "";
					const addable = file !== "" && canvasAddAvailable();
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: tool_card_module_css_default.thumb,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
							className: tool_card_module_css_default.imageLink,
							href: url,
							target: "_blank",
							rel: "noreferrer",
							title: image.name ?? "打开原图",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								className: tool_card_module_css_default.image,
								src: url,
								alt: image.name ?? "生成的图片",
								width: image.width,
								height: image.height,
								loading: "lazy",
								"data-dsh-seework-card-image": "",
								onError: () => {
									setBroken((previous) => new Set(previous).add(image.attachment_id));
								}
							})
						}), addable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: tool_card_module_css_default.action,
							"data-dsh-seework-add-to-canvas": "",
							title: "把这张图放到画布上",
							onClick: () => {
								addToCanvas({
									file,
									width: image.width,
									height: image.height
								});
							},
							children: "加到画布"
						}) : null]
					}, image.attachment_id);
				})
			})
		]
	});
}
/**
* Register the card for every image-bearing tool name.
*
* The registration is deferred through `slots.inject` because the slot exists
* only while the shell's tool-presentation package is mounted; a shell that
* never declares it simply never calls back, leaving the generic row. A refused
* registration (an occupied key, say) is logged and must not fail the fiber.
*
* @param ctx - client root context (services: slots).
* @returns disposer unregistering the views.
*/
function registerToolCards(ctx) {
	const slots = ctx.slots;
	if (slots === void 0 || typeof slots.inject !== "function" || typeof slots.register !== "function") return () => {};
	const disposers = [];
	const stop = slots.inject.call(slots, "tool.call.toolview", () => {
		for (const key of TOOL_CARD_KEYS) try {
			disposers.push(slots.register.call(slots, {
				name: "tool.call.toolview",
				key,
				priority: TOOL_CARD_PRIORITY
			}, ToolCard));
		} catch (error) {
			console.warn(`[dsh-seework] tool card rejected for ${key}:`, error);
		}
	});
	return () => {
		stop();
		for (const dispose of disposers.splice(0)) dispose();
	};
}

//#endregion
//#region src/client/LibraryTab.tsx
/**
* Build the tab body for one store.
*
* The shell renders tab bodies without plugin-provided props, so the store is
* bound here and the component receives only the seat's own props.
* @param store - the shared library store.
* @returns a component the tab seat can render.
*/
function libraryTabBody(store) {
	return function LibraryTabBody(props) {
		const [detailId, setDetailId] = (0, react.useState)(void 0);
		(0, react.useEffect)(() => {
			store.refresh();
		}, [store]);
		const sessionId = props.sessionId;
		const inputActions = props.inputActions;
		(0, react.useEffect)(() => {
			if (sessionId === void 0 || inputActions === void 0) return;
			return setComposerFace({
				sessionId,
				input: inputActions
			});
		}, [inputActions, sessionId]);
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibraryPanel, {
			store,
			tab: true,
			hideClose: true,
			onClose: () => {
				setDetailId(void 0);
			},
			onOpen: (id) => {
				setDetailId(id);
			}
		}), detailId === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibraryDetail, {
			store,
			entryId: detailId,
			onClose: () => {
				setDetailId(void 0);
			}
		})] });
	};
}

//#endregion
//#region src/client/CanvasTab.tsx
/**
* Build the canvas tab body for one store.
* @param deps - the canvas store and the shared library face.
* @returns a component the tab seat can render.
*/
function canvasTabBody(deps) {
	return function CanvasTabBody(props) {
		const [listOpen, setListOpen] = (0, react.useState)(false);
		const store = deps.store;
		const sessionId = props.sessionId;
		const inputActions = props.inputActions;
		(0, react.useEffect)(() => {
			if (sessionId === void 0 || inputActions === void 0) return;
			return setComposerFace({
				sessionId,
				input: inputActions
			});
		}, [inputActions, sessionId]);
		(0, react.useEffect)(() => {
			if (store.getSnapshot().board !== void 0) {
				store.refreshList();
				return;
			}
			(async () => {
				await store.refreshList();
				if (store.getSnapshot().board !== void 0) return;
				const first = store.getSnapshot().boards[0];
				await store.open(first?.id ?? "");
			})();
		}, [store]);
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: canvas_shell_module_css_default.tabOverlay,
			"data-dsh-seework-canvas-tab": "",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: canvas_shell_module_css_default.tabHeader,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Button, {
						onClick: () => {
							setListOpen((open) => !open);
						},
						title: "切换画布列表",
						children: listOpen ? "收起列表" : "画布列表"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: canvas_shell_module_css_default.headerHint,
						children: "拖标题栏移动、右下角调整大小、滚轮缩放"
					})]
				}),
				listOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: canvas_shell_module_css_default.tabList,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasBoardList, { store })
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasBoard, {
					store,
					library: deps.library,
					onNeedLibrary: deps.onNeedLibrary
				})
			]
		});
	};
}

//#endregion
//#region src/client/sidebar-tabs.ts
/** Tab type ids, also the keys the bodies and titles register under. */
const LIBRARY_TAB_ID = "dsh-seework/library";
const CANVAS_TAB_ID = "dsh-seework/canvas";
/** Tab kinds: what `openTab` names. */
const LIBRARY_TAB_KIND = "seework-library";
const CANVAS_TAB_KIND = "seework-canvas";
/** Both tab types in strip order. */
const TAB_TARGETS = [{
	id: LIBRARY_TAB_ID,
	kind: LIBRARY_TAB_KIND,
	title: "素材库",
	guide: {
		id: "library",
		order: 40,
		description: "查看用 SeeWork 生成过的图片"
	}
}, {
	id: CANVAS_TAB_ID,
	kind: CANVAS_TAB_KIND,
	title: "画布",
	guide: {
		id: "canvas",
		order: 50,
		description: "把生成过的图片摆到画布上"
	}
}];
/** Look up one optional service without tripping the client guard. */
function service(ctx, name) {
	try {
		const value = ctx.get?.(name);
		return value === null || value === void 0 ? void 0 : value;
	} catch (error) {
		console.warn(`[dsh-seework] service "${name}" is unavailable:`, error);
		return;
	}
}
/**
* Is the right column part of this page at all?
* @param ctx - client root context.
* @returns true when both sidebar services are present.
*/
function sidebarAvailable(ctx) {
	return service(ctx, "sidebarRightTabs") !== void 0 && service(ctx, "sidebarRight") !== void 0;
}
/**
* Register both tab types and their bodies.
* @param ctx - client root context carrying `slots`, `sidebarRightTabs` and `sidebarRight`.
* @param stores - the shared stores the bodies render from.
* @returns the disposer plus whether the tabs actually landed (a shell without
*   the column keeps its floating launchers).
*/
function registerSidebarTabs(ctx, stores) {
	const tabs = service(ctx, "sidebarRightTabs");
	const slots = service(ctx, "slots");
	const disposers = [];
	let registered = 0;
	const guard = (work) => {
		try {
			const dispose = work();
			if (dispose !== void 0) disposers.push(dispose);
		} catch (error) {
			console.warn("[dsh-seework] right sidebar rejected a tab:", error);
		}
	};
	for (const target of TAB_TARGETS) {
		guard(() => {
			const dispose = tabs?.register({
				id: target.id,
				kind: target.kind,
				title: () => target.title,
				guide: [{
					id: target.guide.id,
					order: target.guide.order,
					title: () => target.title,
					description: () => target.guide.description
				}]
			});
			if (dispose !== void 0) registered += 1;
			return dispose;
		});
		const body = target.kind === LIBRARY_TAB_KIND ? libraryTabBody(stores.library) : canvasTabBody({
			store: stores.canvas,
			get library() {
				return { entries: stores.entries() };
			},
			onNeedLibrary: stores.onNeedLibrary
		});
		guard(() => slots?.inject("sidebar.right.pane.tab", () => {
			try {
				return slots.register({
					name: "sidebar.right.pane.tab",
					key: target.id
				}, body);
			} catch (error) {
				console.warn("[dsh-seework] right sidebar rejected the tab body:", error);
				return;
			}
		}));
		guard(() => slots?.inject("sidebar.right.pane.tab.title", () => {
			try {
				return slots.register({
					name: "sidebar.right.pane.tab.title",
					key: target.id
				}, () => target.title);
			} catch (error) {
				console.warn("[dsh-seework] right sidebar rejected the tab title:", error);
				return;
			}
		}));
	}
	return {
		dispose: () => {
			for (const dispose of disposers.reverse()) dispose();
		},
		tabsAvailable: registered === TAB_TARGETS.length
	};
}
/**
* Show one tab, expanding the column when it was collapsed.
* @param ctx - client root context carrying `sidebarRight`.
* @param kind - the tab kind to reveal.
* @returns true when the request was accepted.
*/
function openSeeWorkTab(ctx, kind) {
	const controller = service(ctx, "sidebarRight");
	if (controller === void 0) return false;
	try {
		controller.openTab(kind, { revealIfOpened: true });
		return true;
	} catch (error) {
		console.warn("[dsh-seework] could not open the sidebar tab:", error);
		return false;
	}
}
/**
* Is that tab the one the column is showing right now?
* @param ctx - client root context carrying `sidebarRight`.
* @param kind - the tab kind to test.
* @returns true when it is the active tab.
*/
function isSeeWorkTabActive(ctx, kind) {
	const controller = service(ctx, "sidebarRight");
	try {
		return controller?.active()?.kind === kind;
	} catch {
		return false;
	}
}
/**
* Put one tab away.
* @param ctx - client root context carrying `sidebarRight`.
* @param kind - the tab kind to close, when it is the active one.
* @returns true when a tab was closed.
*/
function closeSeeWorkTab(ctx, kind) {
	const controller = service(ctx, "sidebarRight");
	try {
		const active = controller?.active();
		if (active === void 0 || active.kind !== kind) return false;
		controller?.close(active.id);
		return true;
	} catch (error) {
		console.warn("[dsh-seework] could not close the sidebar tab:", error);
		return false;
	}
}

//#endregion
//#region src/client/index.ts
/**
* The plugin's client half declares only `slots` as a required service.
*
* The right-sidebar services are optional for this plugin: declaring them would
* park the WHOLE plugin (settings, library and canvas included) whenever the
* boot graph orders the column's own plugin differently, which is a worse
* failure than not having tabs. They are probed through `ctx.get` instead.
*/
const inject = ["slots"];
/** Settings namespace this plugin owns. */
const NS = "dsh-seework";
/**
* Position of the SeeWork page among the settings dialog's nav entries.
* The shipped sections use 10 (models), 15 (plugins) and 20 (agent presets), so
* a larger number lands after them — the end of the list, where a third-party
* plugin belongs.
*/
const SETTINGS_SECTION_ORDER = 40;
/**
* Mount the plugin's browser surfaces.
* @param ctx - client root context (services: slots).
*/
function apply(ctx) {
	const scope = bindSeeWorkScope();
	const api = new SeeWorkApi();
	const disposeFloatingSettings = mountFallback(scope, api);
	let floatingSettingsRetired = false;
	const retireFloatingSettings = () => {
		if (floatingSettingsRetired) return;
		floatingSettingsRetired = true;
		disposeFloatingSettings?.();
	};
	let sectionLanded = false;
	let disposeSlot;
	const disposeSection = registerSettingsSection(ctx, scope, api, () => {
		sectionLanded = true;
		retireFloatingSettings();
		disposeSlot?.();
		disposeSlot = void 0;
	});
	if (!sectionLanded) disposeSlot = registerSettingsSlot(ctx, scope, api, retireFloatingSettings, () => sectionLanded);
	const canvas = new CanvasStore(api);
	const library = new LibraryStore(api);
	const disposeLibrary = mountLibrary(api, library);
	const disposeCanvas = mountCanvas(api, library, canvas);
	const stopPresence = onHeaderPresence((present) => {
		setFloatingLaunchersHidden(present);
	});
	const attachTabs = registerSidebarTabsWhenReady(ctx, {
		library,
		canvas,
		entries: () => library.getSnapshot().entries,
		onNeedLibrary: () => {
			library.refresh();
		}
	});
	const launchers = registerHeaderLaunchers(ctx);
	const disposeToolCards = registerToolCards(ctx);
	const disposeUpdateNotice = registerUpdateNotice(ctx, api);
	const disposeChatImageZoom = installChatImageZoom(document, (src) => {
		const file = libraryFileFromUrl(src);
		return file === void 0 ? void 0 : { file };
	});
	const restoreCanvasAdd = setCanvasAddFace(createCanvasAddFace({
		library,
		canvas,
		reveal: () => {
			if (openSeeWorkTab(ctx, CANVAS_TAB_KIND)) return;
			requestSurface("canvas");
		},
		stageSize: () => stageSizeFor(canvas)
	}));
	const restoreComposer = setComposerProbe(() => probeService(ctx, "conversation"));
	const restoreControls = setLauncherControls(launchers.controls);
	const stopWatching = watchGenerations({
		api,
		library
	});
	ctx.effect(() => () => {
		stopWatching();
		stopPresence();
		restoreControls();
		launchers.dispose();
		disposeToolCards();
		disposeUpdateNotice();
		disposeChatImageZoom();
		restoreCanvasAdd();
		restoreComposer();
		attachTabs.dispose();
		disposeSection?.();
		disposeSlot?.();
		disposeFloatingSettings?.();
		disposeLibrary?.();
		disposeCanvas?.();
	}, "dsh-seework: settings, library and canvas surfaces");
}
/**
* Probe one optional service without tripping the client guard.
*
* Services come through `ctx.get(name)`, never `ctx.<name>` (the guard refuses
* an undeclared property read), and never through `inject` (a package ordered
* differently would park the whole plugin — settings, library and canvas with it).
*
* @param ctx - client root context.
* @param name - the service name.
* @returns the service, or undefined when this page has none.
*/
function probeService(ctx, name) {
	try {
		const value = ctx.get?.(name);
		return value === null || value === void 0 ? void 0 : value;
	} catch (error) {
		console.warn(`[dsh-seework] service "${name}" is unavailable:`, error);
		return;
	}
}
/**
* Show or hide the floating library/canvas launchers.
*
* Hidden rather than removed: they are the home screen's only way into the two
* surfaces (the conversation header, and with it the header buttons, exists
* only inside a session), so they have to be able to come back. The settings
* button is left alone — its slot is the one a shell is most likely to lack.
*
* @param hidden - true while the conversation header's own buttons are on screen.
*/
function setFloatingLaunchersHidden(hidden) {
	if (typeof document === "undefined") return;
	for (const attr of ["data-dsh-seework-library-launcher", "data-dsh-seework-canvas-launcher"]) document.querySelectorAll(`[${attr}]`).forEach((button) => {
		button.style.display = hidden ? "none" : "";
	});
}
/**
* Register the right-sidebar tabs as soon as the column's services exist.
*
* The services are optional (see the `inject` note), so this probes for them on
* an interval — cheap, bounded, and it never throws when they never appear. The
* tabs only matter once the user opens something, so a short delay costs
* nothing, while parking the whole plugin on the dependency would take the
* settings, library and canvas surfaces down with it.
*
* @param ctx - client root context.
* @param stores - the shared stores the tab bodies render from.
* @param onAvailable - called once the tabs actually registered.
* @returns disposer cancelling the watch and unregistering what landed.
*/
function registerSidebarTabsWhenReady(ctx, stores) {
	let tabs;
	let cancelled = false;
	let attempts = 0;
	const MAX_ATTEMPTS = 40;
	const attempt = () => {
		if (cancelled || tabs !== void 0) return;
		attempts += 1;
		if (sidebarAvailable(ctx)) {
			const registered = registerSidebarTabs(ctx, stores);
			if (registered.tabsAvailable) {
				tabs = registered;
				return;
			}
			registered.dispose();
			cancelled = true;
			return;
		}
		if (attempts < MAX_ATTEMPTS) setTimeout(attempt, 250);
	};
	setTimeout(attempt, 0);
	return { dispose: () => {
		cancelled = true;
		tabs?.dispose();
		tabs = void 0;
	} };
}
/**
* Contribute the SeeWork entry buttons to the conversation header's utilities,
* and teach them to work the right-sidebar tabs.
*
* Same degradation contract as the settings slot: a shell without the utilities
* slot simply never calls the injection callback, leaving the floating dock as
* the way in. A shell with the header but without the right column keeps the
* buttons working through the floating surfaces.
*
* @param ctx - client root context (services: slots).
* @returns the disposer and the launcher controller face.
*/
function registerHeaderLaunchers(ctx) {
	const controls$1 = {
		isOpen: (surface) => isSeeWorkTabActive(ctx, surface === "library" ? LIBRARY_TAB_KIND : CANVAS_TAB_KIND),
		open: (surface) => {
			if (openSeeWorkTab(ctx, surface === "library" ? LIBRARY_TAB_KIND : CANVAS_TAB_KIND)) return true;
			requestSurface(surface);
			return false;
		},
		close: (surface) => {
			if (closeSeeWorkTab(ctx, surface === "library" ? LIBRARY_TAB_KIND : CANVAS_TAB_KIND)) return true;
			requestSurface(surface === "library" ? "canvas" : "library");
			return false;
		}
	};
	try {
		const slots = ctx.slots;
		if (slots === void 0 || typeof slots.inject !== "function" || typeof slots.register !== "function") return {
			dispose: () => {},
			controls: controls$1
		};
		let dispose;
		const stop = slots.inject.call(slots, "conversation.session.header.utilities", () => {
			try {
				dispose = slots.register.call(slots, {
					name: "conversation.session.header.utilities",
					id: NS,
					order: -20
				}, HeaderLaunchers);
			} catch (error) {
				console.warn("[dsh-seework] header utilities slot rejected the launchers:", error);
			}
		});
		return {
			dispose: () => {
				dispose?.();
				stop();
			},
			controls: controls$1
		};
	} catch (error) {
		console.warn("[dsh-seework] header utilities slot unavailable:", error);
		return {
			dispose: () => {},
			controls: controls$1
		};
	}
}
/**
* Contribute the update notice to the shell's frame-wide overlay.
*
* Same degradation contract as the other optional slots here: a shell that does
* not declare `shell.overlay` never runs the callback, and the plugin keeps
* working with one surface fewer — the version card in settings still reports
* the update, which is where it lived before this existed.
*
* @param ctx - client root context (services: slots).
* @param api - the plugin route client.
* @returns the disposer.
*/
function registerUpdateNotice(ctx, api) {
	try {
		const slots = ctx.slots;
		if (slots === void 0 || typeof slots.inject !== "function" || typeof slots.register !== "function") return () => {};
		let dispose;
		const stop = slots.inject.call(slots, "shell.overlay", () => {
			try {
				dispose = slots.register.call(slots, {
					name: "shell.overlay",
					id: NS,
					order: 20,
					inject: () => ({ api })
				}, UpdateNotice);
			} catch (error) {
				console.warn("[dsh-seework] overlay slot rejected the update notice:", error);
			}
		});
		return () => {
			dispose?.();
			stop();
		};
	} catch (error) {
		console.warn("[dsh-seework] overlay slot unavailable:", error);
		return () => {};
	}
}
/**
* Contribute the SeeWork page to the settings dialog's own navigation.
*
* `settings.plugin.item` is a tab INSIDE the Plugins section, which is easy to
* miss; `settings.section` is a first-class page in the nav list beside
* 通用设置 / 模型 / 插件 / Agent 预设, which is where a user looks for a plugin
* they just installed. The shipped sections order themselves 10 / 15 / 20, so
* this one sits after them.
*
* While this section is accepted, {@link registerSettingsSlot} is not kept: the
* same card in two places is clutter. A shell without the nav slot still gets
* the Plugins tab, and one without either keeps the floating panel.
*
* @param ctx - client root context (services: slots).
* @param scope - the bound settings scope the card reads and writes.
* @param api - the plugin route client.
* @param onAccepted - called once the nav actually took the section.
* @returns the disposer when the slot exists, undefined when it does not.
*/
function registerSettingsSection(ctx, scope, api, onAccepted) {
	try {
		const slots = ctx.slots;
		if (slots === void 0 || typeof slots.inject !== "function" || typeof slots.register !== "function") return void 0;
		const face$2 = {
			scope,
			api
		};
		let dispose;
		const stop = slots.inject.call(slots, "settings.section", () => {
			try {
				dispose = slots.register.call(slots, {
					name: "settings.section",
					id: NS,
					order: SETTINGS_SECTION_ORDER,
					label: () => "SeeWork",
					inject: () => face$2
				}, SeeWorkSettingsCard);
				onAccepted();
			} catch (error) {
				console.warn("[dsh-seework] settings navigation rejected the section:", error);
			}
		});
		return () => {
			dispose?.();
			stop();
		};
	} catch (error) {
		console.warn("[dsh-seework] settings navigation slot unavailable:", error);
		return;
	}
}
/**
* Contribute the settings card to the shell's plugin-configuration slot.
*
* Both the registration AND the deferred `inject` callback are guarded. A shell
* that never declares the slot simply never runs the callback — that is the
* `slots.inject` contract, not an error — so the fallback panel stays until
* `onAccepted` says a card actually landed. A callback that throws (the
* registry refuses a slot it considers occupied, say) is logged and leaves the
* fallback in place; it must not fail the plugin's fiber, because the shell
* reports a failed fiber to the user as a boot problem.
*
* @param onAccepted - called once the slot has actually accepted the card, so
*   the caller can retire its fallback surface.
* @returns the disposer when the slot exists, undefined when it does not.
*/
function registerSettingsSlot(ctx, scope, api, onAccepted, skipWhen) {
	try {
		const slots = ctx.slots;
		if (slots === void 0 || typeof slots.inject !== "function" || typeof slots.register !== "function") return void 0;
		const face$2 = {
			scope,
			api
		};
		let dispose;
		const stop = slots.inject.call(slots, "settings.plugin.item", () => {
			if (skipWhen?.() === true) return;
			try {
				dispose = slots.register.call(slots, {
					name: "settings.plugin.item",
					key: NS,
					inject: () => face$2
				}, SeeWorkSettingsCard);
				onAccepted();
			} catch (error) {
				console.warn("[dsh-seework] settings slot rejected the card:", error);
			}
		});
		return () => {
			dispose?.();
			stop();
		};
	} catch (error) {
		console.warn("[dsh-seework] settings slot unavailable:", error);
		return;
	}
}
/** DOM-mounted settings launcher (the no-slot path). */
function mountFallback(scope, api) {
	try {
		return mountSettingsPanel(scope, api);
	} catch (error) {
		console.warn("[dsh-seework] settings panel mount failed:", error);
		return;
	}
}
/**
* Mount the material-library launcher and drawer. A DOM mount failure degrades
* the library only — the plugin never takes the GUI down with it.
*/
function mountLibrary(api, store) {
	try {
		return mountLibraryPanel(api, store);
	} catch (error) {
		console.warn("[dsh-seework] library panel mount failed:", error);
		return;
	}
}
/**
* Mount the canvas launcher and overlay. Sharing the library store means the
* picture picker shows what the drawer shows.
*/
function mountCanvas(api, store, canvas) {
	try {
		return mountCanvasSurfaces(api, store, canvas);
	} catch (error) {
		console.warn("[dsh-seework] canvas mount failed:", error);
		return;
	}
}

//#endregion
exports.apply = apply;
exports.inject = inject;
return module.exports; } });
//# sourceMappingURL=client.js.map