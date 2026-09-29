/**
 * Annotation objects (the board's own marking layer).
 *
 * Three kinds share one session — brush strokes, rectangles, text — and the user
 * may mix them freely, which is why they are one list of objects rather than one
 * active tool's output (ADR-0016 in the reference client made the same call).
 * Everything is stored in the **picture's own pixel coordinates**, so burning is
 * a straight 1:1 replay onto a canvas of the natural size and a different display
 * scale can never move a mark.
 *
 * Geometry here is pure data + arithmetic (no DOM), so it is unit-tested; the
 * actual painting lives in `burn-image.ts`.
 */

/** Which tool is drawing right now. */
export type AnnotationTool = 'brush' | 'rect' | 'arrow' | 'text' | 'eraser'

/** One point, in the picture's own pixels. */
export interface AnnotationPoint {
  x: number
  y: number
}

/** A freehand stroke. */
export interface BrushAnnotation {
  kind: 'brush'
  color: string
  /** Stroke width in picture pixels. */
  sizePx: number
  points: AnnotationPoint[]
}

/** A rectangle outline: the "circle this for the model" mark. */
export interface RectAnnotation {
  kind: 'rect'
  color: string
  /** Outline width in picture pixels. */
  sizePx: number
  x: number
  y: number
  width: number
  height: number
}

/** A straight arrow: "this one, in this direction". */
export interface ArrowAnnotation {
  kind: 'arrow'
  color: string
  /** Shaft width in picture pixels (the head is sized from it). */
  sizePx: number
  from: AnnotationPoint
  to: AnnotationPoint
}

/** A text label anchored at its top-left corner. */
export interface TextAnnotation {
  kind: 'text'
  color: string
  /** Font size in picture pixels. */
  sizePx: number
  x: number
  y: number
  text: string
}

/** One annotation object. */
export type Annotation = BrushAnnotation | RectAnnotation | ArrowAnnotation | TextAnnotation

/** The palette (three colours keeps the toolbar a row, not a picker). */
export const ANNOTATION_COLORS: readonly string[] = ['#ff3b30', '#ffcc00', '#0a84ff']

/** The three widths, in editor pixels. */
export const ANNOTATION_WIDTHS: readonly number[] = [4, 8, 16]

/** Smallest rectangle the user can draw (picture pixels). */
export const MIN_RECT_SIZE = 4

/** How far from an object's edge still counts as a hit (picture pixels). */
export const HIT_TOLERANCE = 6

/** Font family for text marks; must match what the burn uses. */
export const TEXT_FONT_FAMILY = 'system-ui, sans-serif'

/** The bounding box of one object. */
export function annotationBounds(annotation: Annotation): { x: number; y: number; width: number; height: number } {
  if (annotation.kind === 'rect') return { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height }
  if (annotation.kind === 'text') {
    // Height follows the font; width is left generous because the burn measures
    // the real text and the editor only needs the box for hit-testing.
    return { x: annotation.x, y: annotation.y, width: annotation.text.length * annotation.sizePx, height: annotation.sizePx * 1.25 }
  }
  if (annotation.kind === 'arrow') {
    const minX = Math.min(annotation.from.x, annotation.to.x)
    const minY = Math.min(annotation.from.y, annotation.to.y)
    const pad = annotation.sizePx * 2
    return {
      x: minX - pad,
      y: minY - pad,
      width: Math.abs(annotation.to.x - annotation.from.x) + pad * 2,
      height: Math.abs(annotation.to.y - annotation.from.y) + pad * 2,
    }
  }
  const xs = annotation.points.map(point => point.x)
  const ys = annotation.points.map(point => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return {
    x: minX - annotation.sizePx / 2,
    y: minY - annotation.sizePx / 2,
    width: Math.max(...xs) - minX + annotation.sizePx,
    height: Math.max(...ys) - minY + annotation.sizePx,
  }
}

/** Move one object by a picture-pixel delta. */
export function moveAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  if (annotation.kind === 'brush') {
    return { ...annotation, points: annotation.points.map(point => ({ x: point.x + dx, y: point.y + dy })) }
  }
  if (annotation.kind === 'arrow') {
    return {
      ...annotation,
      from: { x: annotation.from.x + dx, y: annotation.from.y + dy },
      to: { x: annotation.to.x + dx, y: annotation.to.y + dy },
    }
  }
  return { ...annotation, x: annotation.x + dx, y: annotation.y + dy }
}

/** Distance from a point to a segment, in picture pixels. */
export function distanceToSegment(point: AnnotationPoint, from: AnnotationPoint, to: AnnotationPoint): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y)
  // Projection of the point onto the segment, clamped to its ends.
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy))
}

/** Whether a point (picture pixels) lands on one object. */
export function hitAnnotation(annotation: Annotation, point: AnnotationPoint): boolean {
  if (annotation.kind === 'arrow') {
    // An arrow is mostly empty space: hit the shaft, not its bounding box.
    return distanceToSegment(point, annotation.from, annotation.to) <= annotation.sizePx * 1.5 + HIT_TOLERANCE
  }
  const bounds = annotationBounds(annotation)
  return point.x >= bounds.x - HIT_TOLERANCE
    && point.x <= bounds.x + bounds.width + HIT_TOLERANCE
    && point.y >= bounds.y - HIT_TOLERANCE
    && point.y <= bounds.y + bounds.height + HIT_TOLERANCE
}

/** The topmost object under a point, if any (later objects are on top). */
export function annotationAt(annotations: readonly Annotation[], point: AnnotationPoint): number | undefined {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    if (hitAnnotation(annotations[index]!, point)) return index
  }
  return undefined
}

/** Every object under a point, topmost first (the eraser takes them all). */
export function annotationsAt(annotations: readonly Annotation[], point: AnnotationPoint): number[] {
  const hits: number[] = []
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    if (hitAnnotation(annotations[index]!, point)) hits.push(index)
  }
  return hits
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
export function arrowHeadPoints(from: AnnotationPoint, to: AnnotationPoint, sizePx: number): [AnnotationPoint, AnnotationPoint, AnnotationPoint] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const length = Math.max(sizePx * 3, 10)
  const half = Math.max(sizePx * 1.6, 6)
  const baseX = to.x - Math.cos(angle) * length
  const baseY = to.y - Math.sin(angle) * length
  const normalX = -Math.sin(angle) * half
  const normalY = Math.cos(angle) * half
  return [
    { x: baseX + normalX, y: baseY + normalY },
    { x: baseX - normalX, y: baseY - normalY },
    { x: to.x, y: to.y },
  ]
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
export function scaleWidth(sizePx: number, scale: number): number {
  return Math.max(1, sizePx * (Number.isFinite(scale) && scale > 0 ? scale : 1))
}

/** Whether anything was drawn (an empty session must not produce a copy). */
export function hasAnnotations(annotations: readonly Annotation[]): boolean {
  return annotations.some(annotation => annotation.kind !== 'brush' || annotation.points.length > 0)
    && annotations.some(annotation => annotation.kind !== 'text' || annotation.text.trim() !== '')
}