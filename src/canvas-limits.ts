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
export const CANVAS_ZOOM_MIN = 0.1
export const CANVAS_ZOOM_MAX = 5

/** Cards allowed on one board. */
export const CANVAS_MAX_CARDS = 500

/** Boards kept before the oldest is dropped (with its file). */
export const CANVAS_MAX_BOARDS = 200

/** Default size of a card placed on a board, in board pixels. */
export const CANVAS_NEW_IMAGE_SIZE = 320
