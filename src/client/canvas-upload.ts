/**
 * Taking a picture off the user's own machine.
 *
 * Every other picture on a board arrives as a name the board can point at: a
 * material-library entry, or a composite the board itself wrote. A file the user
 * picked is bytes with no home yet, so it is read here and handed to the canvas
 * asset store — the same place annotations and crops go. A local picture is
 * board material, not a generation, so it never enters the material library.
 *
 * PNG and JPEG only. The picker's `accept` is what the user sees; the check here
 * is what decides, because a picker can be bypassed (a renamed file, a drop, a
 * test harness) and a board should not end up holding a format nothing shows.
 */

/** The media types this board accepts from a local file. */
export const UPLOAD_MEDIA_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/jpg']

/** Extension fallback for a file the browser reports no media type for. */
const UPLOAD_NAME = /\.(png|jpe?g)$/iu

/**
 * Whether one picked file is a picture this board takes.
 * @param file - the file's media type and name, as the picker reports them.
 * @returns true when it is a PNG or a JPEG.
 */
export function isUploadableImage(file: { type: string; name: string }): boolean {
  if (UPLOAD_MEDIA_TYPES.includes(file.type)) return true
  // Some systems hand the browser no media type at all; the extension is then
  // the only signal, and it still has to be one of the two.
  return file.type === '' && UPLOAD_NAME.test(file.name)
}

/**
 * Read one picked file as a data URL.
 *
 * `image/jpg` is not a registered media type but systems do report it, and the
 * host reads the type out of the data URL itself — so it is normalized to the
 * type the host knows rather than sent as something it would refuse.
 *
 * @param file - the file to read.
 * @returns the data URL, or undefined when the file could not be read.
 */
export function readImageDataUrl(file: File): Promise<string | undefined> {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === 'string'
        ? reader.result.replace(/^data:image\/jpg;/u, 'data:image/jpeg;')
        : undefined)
    }
    reader.onerror = () => { resolve(undefined) }
    reader.readAsDataURL(file)
  })
}
