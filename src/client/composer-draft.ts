/**
 * 「加入到对话框」: put a picture into the conversation's composer as a draft
 * attachment.
 *
 * The composer's attachments are browser-owned drafts: the shell registers the
 * file, hands back a draft id, and the input machine shows it in the rail with
 * its bytes sent along with the prompt (`createDrafts` + `addAttachments` on the
 * conversation service / the session's input actions). So this needs no host
 * route and no library write: the bytes come from the picture's own URL.
 *
 * Where the face comes from: the shell hands `sessionId` and `inputActions` to
 * every session-scope slot component, and our library/canvas tab bodies are
 * exactly that — so they publish the face while they are mounted, and the
 * conversation service is probed once from the plugin root (`ctx.get`, never a
 * declared `inject`: a missing provider must not park the whole plugin).
 *
 * Without a mounted tab there is no session context, so the buttons hide rather
 * than pretend: the home-screen floating panels have no conversation to add to.
 */

/** The slice of the conversation service this module uses. */
export interface ComposerDrafts {
  /**
   * Register browser files as runtime-only draft attachments.
   * @param sessionId - target session.
   * @param files - browser files to register.
   * @returns ordered draft descriptors.
   */
  createDrafts: (sessionId: string, files: readonly File[]) => readonly { id: string }[]
  /** Release drafts that never made it into the composer. */
  releaseDraftAttachments: (attachments: readonly unknown[]) => void
}

/** The slice of the session input actions this module uses. */
export interface ComposerInput {
  /** Append ordered browser-owned attachment ids; a busy composer refuses. */
  addAttachments: (ids: readonly string[]) => boolean
}

/** A session-scope tab body publishes this while it is mounted. */
export interface ComposerFace {
  sessionId: string
  input: ComposerInput
}

let conversationProbe: (() => ComposerDrafts | undefined) | undefined
let face: ComposerFace | undefined

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
export function setComposerProbe(next: (() => ComposerDrafts | undefined) | undefined): () => void {
  const previous = conversationProbe
  conversationProbe = next
  return () => { conversationProbe = previous }
}

/**
 * Publish (or clear) the session-scope face a tab body owns.
 * @param next - the face, or undefined when no tab body is mounted.
 * @returns disposer clearing this exact face.
 */
export function setComposerFace(next: ComposerFace | undefined): () => void {
  const previous = face
  face = next
  return () => {
    if (face === next) face = previous
  }
}

/** Whether 「加入到对话框」 can do anything right now. */
export function composerAvailable(): boolean {
  return conversationProbe?.() !== undefined && face !== undefined
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
export async function sendImageToConversation(image: { url: string; name?: string | undefined }): Promise<boolean> {
  const service = conversationProbe?.()
  const current = face
  if (service === undefined || current === undefined) return false
  const response = await fetch(image.url)
  if (!response.ok) return false
  const blob = await response.blob()
  const name = image.name ?? 'seework-image.png'
  const file = new File([blob], name, { type: blob.type === '' ? 'image/png' : blob.type })
  const drafts = service.createDrafts(current.sessionId, [file])
  const ids = drafts.map(draft => draft.id)
  if (ids.length === 0) return false
  if (!current.input.addAttachments(ids)) {
    // A busy composer refuses the ids; hand the drafts back rather than leaking
    // object URLs the composer will never show.
    service.releaseDraftAttachments(drafts)
    console.warn('[dsh-seework] the composer refused the draft attachment.')
    return false
  }
  return true
}

/**
 * The attachment name for one library file: it keeps the extension the route
 * serves, so the composer's preview and the eventual prompt agree on the type.
 * @param file - the library or asset file name.
 * @returns a browser-safe file name.
 */
export function attachmentNameFor(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? 'seework-image.png'
  return base === '' ? 'seework-image.png' : base
}
