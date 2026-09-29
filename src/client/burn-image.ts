/**
 * Burning annotations and crops into a new picture (browser half).
 *
 * Both operations are the same shape: load the picture, replay something onto an
 * offscreen canvas of its natural size, hand back a PNG data URL. That URL is
 * what the host stores as a canvas asset — the original file is never touched and
 * nothing here goes near the material library.
 *
 * This is the one part of the feature that cannot be unit-tested in jsdom (no 2D
 * context), so it stays deliberately thin and arithmetic-free: all coordinates
 * arrive already in picture pixels from `annotations.ts` / `crop-rect.ts`.
 */

import { TEXT_FONT_FAMILY, arrowHeadPoints, type Annotation } from './annotations.ts'
import type { CropRect } from './crop-rect.ts'

/** One burned picture: the PNG and the size it was burned at. */
export interface BurnedImage {
  dataUrl: string
  width: number
  height: number
}

/** Load one picture for the canvas to draw. */
async function loadImage(url: string): Promise<HTMLImageElement | undefined> {
  return new Promise(resolve => {
    const image = new Image()
    image.onload = () => { resolve(image) }
    image.onerror = () => { resolve(undefined) }
    image.src = url
  })
}

/**
 * Draw a picture onto an offscreen canvas and export it as a PNG data URL.
 *
 * @param url - where the picture is served from.
 * @param paint - draws on top of the picture (receives the 2D context and size).
 * @param source - sub-rectangle to take instead of the whole picture (a crop).
 * @returns the burned picture, or undefined when it could not be loaded.
 */
async function burn(
  url: string,
  paint: (context: CanvasRenderingContext2D, width: number, height: number) => void,
  source?: CropRect,
): Promise<BurnedImage | undefined> {
  const image = await loadImage(url)
  if (image === undefined) return undefined
  const naturalWidth = image.naturalWidth === 0 ? image.width : image.naturalWidth
  const naturalHeight = image.naturalHeight === 0 ? image.height : image.naturalHeight
  const rect = source ?? { x: 0, y: 0, width: naturalWidth, height: naturalHeight }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.width))
  canvas.height = Math.max(1, Math.round(rect.height))
  const context = canvas.getContext('2d')
  if (context === null) return undefined
  context.drawImage(
    image,
    rect.x, rect.y, rect.width, rect.height,
    0, 0, canvas.width, canvas.height,
  )
  paint(context, canvas.width, canvas.height)
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
}

/**
 * Burn every annotation onto a copy of the picture, in list order.
 *
 * @param url - where the picture is served from.
 * @param annotations - the marks, in picture pixels.
 * @returns the composite, or undefined when the picture could not be loaded.
 */
export async function burnAnnotations(url: string, annotations: readonly Annotation[]): Promise<BurnedImage | undefined> {
  return burn(url, (context, width, height) => {
    for (const annotation of annotations) {
      if (annotation.kind === 'rect') {
        // Inset by half the line so the outline lands fully inside the picture.
        const inset = annotation.sizePx / 2
        context.strokeStyle = annotation.color
        context.lineWidth = annotation.sizePx
        context.strokeRect(
          annotation.x + inset,
          annotation.y + inset,
          Math.max(1, annotation.width - annotation.sizePx),
          Math.max(1, annotation.height - annotation.sizePx),
        )
        continue
      }
      if (annotation.kind === 'brush') {
        if (annotation.points.length === 0) continue
        context.strokeStyle = annotation.color
        context.fillStyle = annotation.color
        context.lineWidth = annotation.sizePx
        context.lineCap = 'round'
        context.lineJoin = 'round'
        const [first, ...rest] = annotation.points
        if (rest.length === 0) {
          // A tap with no drag is a dot, not an invisible stroke.
          context.beginPath()
          context.arc(first!.x, first!.y, annotation.sizePx / 2, 0, Math.PI * 2)
          context.fill()
          continue
        }
        context.beginPath()
        context.moveTo(first!.x, first!.y)
        for (const point of rest) context.lineTo(point.x, point.y)
        context.stroke()
        continue
      }
      if (annotation.kind === 'arrow') {
        // Shaft plus a filled head, from the same helper the editor draws with.
        const [left, right, tip] = arrowHeadPoints(annotation.from, annotation.to, annotation.sizePx)
        context.strokeStyle = annotation.color
        context.fillStyle = annotation.color
        context.lineWidth = annotation.sizePx
        context.lineCap = 'round'
        context.beginPath()
        context.moveTo(annotation.from.x, annotation.from.y)
        context.lineTo(annotation.to.x, annotation.to.y)
        context.stroke()
        context.beginPath()
        context.moveTo(left.x, left.y)
        context.lineTo(right.x, right.y)
        context.lineTo(tip.x, tip.y)
        context.closePath()
        context.fill()
        continue
      }
      if (annotation.text.trim() === '') continue
      context.fillStyle = annotation.color
      // `top` baseline matches the editor's top-left anchored label, so what the
      // user placed is where it lands.
      context.textBaseline = 'top'
      context.font = `${annotation.sizePx}px ${TEXT_FONT_FAMILY}`
      context.fillText(annotation.text, annotation.x, annotation.y)
    }
    void width
    void height
  })
}

/**
 * Cut a sub-rectangle out of the picture.
 *
 * @param url - where the picture is served from.
 * @param rect - the crop box in picture pixels.
 * @returns the cropped picture, or undefined when it could not be loaded.
 */
export async function burnCrop(url: string, rect: CropRect): Promise<BurnedImage | undefined> {
  return burn(url, () => {}, rect)
}
