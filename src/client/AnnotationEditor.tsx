/**
 * The annotation editor: mark the picture, then save the marks as one composite.
 *
 * Opened from the board's floating command bar. The picture is shown fitted to the
 * panel and the marks are drawn as an SVG overlay with the picture's own coordinate
 * system as its viewBox — so the display scale is the browser's problem, and every
 * object is stored in natural pixels. Saving burns them onto a copy (see
 * `burn-image.ts`) and hands the board a NEW node: the original picture, and the
 * material library, are untouched.
 *
 * Three tools mix in one session (`annotations.ts`): brush strokes, rectangles
 * (drag to draw), and text (click, type, Enter). Undo/redo is object-level —
 * see the reference client's ADR-0016, which this follows.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ANNOTATION_COLORS,
  ANNOTATION_WIDTHS,
  annotationAt,
  annotationsAt,
  arrowHeadPoints,
  hasAnnotations,
  moveAnnotation,
  scaleWidth,
  type Annotation,
  type AnnotationPoint,
  type AnnotationTool,
} from './annotations.ts'
import { burnAnnotations } from './burn-image.ts'
import { Button, TextInput } from './controls.tsx'
import css from './annotation-editor.module.css'

/** What the editor needs to know about the picture it is marking. */
export interface AnnotationEditorProps {
  /** Where the picture is served from. */
  url: string
  /** Its natural size, when known (the editor reads it from the image otherwise). */
  natural?: { width: number; height: number } | undefined
  /** Called with the burned composite when the user saves. */
  onSave: (dataUrl: string) => void | Promise<void>
  /** Leave without saving. */
  onCancel: () => void
}

/** One drag in progress (brush stroke, rectangle, arrow, eraser, or moving an object). */
type Drag =
  | { kind: 'brush'; points: AnnotationPoint[] }
  | { kind: 'rect'; start: AnnotationPoint; current: AnnotationPoint }
  | { kind: 'arrow'; start: AnnotationPoint; current: AnnotationPoint }
  | { kind: 'erase' }
  | { kind: 'move'; index: number; last: AnnotationPoint; moved: boolean }

/**
 * The editor overlay.
 * @param props - the picture and what to do when the user saves or cancels.
 * @returns the editor.
 */
export function AnnotationEditor(props: AnnotationEditorProps): JSX.Element {
  const [tool, setTool] = useState<AnnotationTool>('brush')
  const [color, setColor] = useState(ANNOTATION_COLORS[0]!)
  const [width, setWidth] = useState(ANNOTATION_WIDTHS[1]!)
  const [objects, setObjects] = useState<Annotation[]>([])
  const [selected, setSelected] = useState<number | undefined>(undefined)
  const [draft, setDraft] = useState<Annotation | undefined>(undefined)
  const [text, setText] = useState<{ point: AnnotationPoint; value: string } | undefined>(undefined)
  const [natural, setNatural] = useState(props.natural ?? { width: 1024, height: 1024 })
  const [saving, setSaving] = useState(false)
  // Object-level history: every committed change pushes the previous list.
  const [past, setPast] = useState<Annotation[][]>([])
  const [future, setFuture] = useState<Annotation[][]>([])
  const surfaceRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<Drag | undefined>(undefined)
  /**
   * The in-progress object, kept in a ref as well as in state.
   *
   * The pointer-up handler has to see what the moves produced, and a gesture can
   * deliver down/move/up inside one task (a fast drag, or a scripted one) — a
   * state closure would still hold the pre-gesture value and drop the object.
   */
  const draftRef = useRef<Annotation | undefined>(undefined)
  /**
   * Where the text tool was pressed, waiting for the release.
   *
   * The text box is deliberately created on pointer UP, not on pointer down: the
   * browser moves focus on `mousedown`, which lands right after `pointerdown`. A
   * box created on the press is therefore mounted and then blurred inside the very
   * same click — the input's `autoFocus` never survives and nobody can type. By
   * release time that focus shift is over and the box keeps the caret.
   */
  const textPointRef = useRef<AnnotationPoint | undefined>(undefined)
  /**
   * Whether the press in flight is the one that confirmed an open text box.
   *
   * Confirming and arming happen in two different React listeners — capture, then
   * bubble — and React re-renders in between, so the bubble handler sees a fresh
   * world where no box is open. Without this flag the same press would confirm one
   * label and immediately open the next box.
   */
  const textPressUsedRef = useRef(false)
  const commitDraft = (next: Annotation | undefined): void => {
    draftRef.current = next
    setDraft(next)
  }

  // The picture's real size decides the coordinate system, so read it from the
  // element rather than trusting whatever the caller happened to know.
  useEffect(() => {
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setNatural({ width: image.naturalWidth, height: image.naturalHeight })
      }
    }
    image.src = props.url
  }, [props.url])

  const commit = (next: Annotation[]): void => {
    setPast(history => [...history, objects])
    setFuture([])
    setObjects(next)
    setSelected(undefined)
  }

  const undo = (): void => {
    if (past.length === 0) return
    const previous = past[past.length - 1]!
    setPast(history => history.slice(0, -1))
    setFuture(stack => [objects, ...stack])
    setObjects(previous)
    setSelected(undefined)
  }

  const redo = (): void => {
    if (future.length === 0) return
    const next = future[0]!
    setFuture(stack => stack.slice(1))
    setPast(history => [...history, objects])
    setObjects(next)
    setSelected(undefined)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // While the text box is open it owns the keyboard: Esc there cancels the
      // typing (handled by the input itself), NOT the whole editor. Closing the
      // editor on Esc is exactly the trap this guard exists to avoid. The branch
      // below also covers the box being open but unfocused (the user tabbed away,
      // or the window lost focus), where the input never sees the key at all.
      if (text !== undefined) {
        if (event.key === 'Escape') setText(undefined)
        return
      }
      if (event.key === 'Escape') props.onCancel()
      if (event.key === 'z' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected !== undefined) {
        event.preventDefault()
        commit(objects.filter((_object, index) => index !== selected))
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  })

  /** Pointer position in picture pixels. */
  const toPicture = (event: ReactPointerEvent): AnnotationPoint => {
    const surface = surfaceRef.current
    if (surface === null) return { x: 0, y: 0 }
    const rect = surface.getBoundingClientRect()
    const scaleX = rect.width === 0 ? 1 : natural.width / rect.width
    const scaleY = rect.height === 0 ? 1 : natural.height / rect.height
    return {
      x: Math.min(natural.width, Math.max(0, (event.clientX - rect.left) * scaleX)),
      y: Math.min(natural.height, Math.max(0, (event.clientY - rect.top) * scaleY)),
    }
  }

  /** How much the editor shrinks the picture (for converting stroke widths). */
  const editorScale = (): number => {
    const surface = surfaceRef.current
    if (surface === null) return 1
    const rect = surface.getBoundingClientRect()
    return rect.width === 0 ? 1 : natural.width / rect.width
  }

  const onPointerDown = (event: ReactPointerEvent): void => {
    const point = toPicture(event)
    if (textPressUsedRef.current) {
      // This press only confirmed the previous label; it must not arm another one.
      textPressUsedRef.current = false
      return
    }
    if (text !== undefined) return
    if (tool === 'text') {
      // Only remembered here; the box is opened on release (see textPointRef).
      textPointRef.current = point
      return
    }
    if (tool === 'eraser') {
      // Object eraser: whatever the pointer touches disappears, and undo brings
      // it back. (An object list has no pixels to rub out.)
      dragRef.current = { kind: 'erase' }
      eraseAt(point)
      return
    }
    if (tool === 'brush') {
      dragRef.current = { kind: 'brush', points: [point] }
      commitDraft({ kind: 'brush', color, sizePx: scaleWidth(width, editorScale()), points: [point] })
      return
    }
    if (tool === 'arrow') {
      dragRef.current = { kind: 'arrow', start: point, current: point }
      setSelected(undefined)
      commitDraft({ kind: 'arrow', color, sizePx: scaleWidth(width, editorScale()), from: point, to: point })
      return
    }
    // Rect tool: a drag on an existing object moves it instead of drawing a new
    // one, which is what "click the object and drag it" means to a user.
    const hit = annotationAt(objects, point)
    if (hit !== undefined) {
      dragRef.current = { kind: 'move', index: hit, last: point, moved: false }
      setSelected(hit)
      return
    }
    dragRef.current = { kind: 'rect', start: point, current: point }
    setSelected(undefined)
    commitDraft({ kind: 'rect', color, sizePx: scaleWidth(width, editorScale()), x: point.x, y: point.y, width: 0, height: 0 })
  }

  /** Remove every object under one point, as one undoable step. */
  const eraseAt = (point: AnnotationPoint): void => {
    const hits = annotationsAt(objects, point)
    if (hits.length === 0) return
    commit(objects.filter((_object, index) => !hits.includes(index)))
  }

  const onPointerMove = (event: ReactPointerEvent): void => {
    const drag = dragRef.current
    if (drag === undefined) return
    const point = toPicture(event)
    if (drag.kind === 'erase') {
      eraseAt(point)
      return
    }
    if (drag.kind === 'brush') {
      drag.points.push(point)
      const current = draftRef.current
      if (current?.kind === 'brush') commitDraft({ ...current, points: [...drag.points] })
      return
    }
    if (drag.kind === 'rect') {
      drag.current = point
      commitDraft({
        kind: 'rect',
        color,
        sizePx: scaleWidth(width, editorScale()),
        x: Math.min(drag.start.x, point.x),
        y: Math.min(drag.start.y, point.y),
        width: Math.abs(point.x - drag.start.x),
        height: Math.abs(point.y - drag.start.y),
      })
      return
    }
    if (drag.kind === 'arrow') {
      drag.current = point
      commitDraft({ kind: 'arrow', color, sizePx: scaleWidth(width, editorScale()), from: drag.start, to: point })
      return
    }
    const dx = point.x - drag.last.x
    const dy = point.y - drag.last.y
    if (dx === 0 && dy === 0) return
    drag.last = point
    drag.moved = true
    setObjects(current => current.map((object, index) => index === drag.index ? moveAnnotation(object, dx, dy) : object))
  }

  const onPointerUp = (): void => {
    if (tool === 'text') {
      const point = textPointRef.current
      textPointRef.current = undefined
      if (point !== undefined) setText({ point, value: '' })
      return
    }
    const drag = dragRef.current
    dragRef.current = undefined
    if (drag === undefined) return
    if (drag.kind === 'move') {
      // A move is already applied to the list; only a real move is undoable.
      if (drag.moved) {
        setFuture([])
        setPast(history => [...history, objects])
      }
      return
    }
    const pending = draftRef.current
    commitDraft(undefined)
    if (pending === undefined) return
    // A rectangle or arrow that was never dragged is not a mark.
    if (pending.kind === 'rect' && (pending.width < 4 || pending.height < 4)) return
    if (pending.kind === 'arrow' && Math.hypot(pending.to.x - pending.from.x, pending.to.y - pending.from.y) < 6) return
    commit([...objects, pending])
  }

  const commitText = (): void => {
    const pending = text
    setText(undefined)
    if (pending === undefined || pending.value.trim() === '') return
    commit([...objects, {
      kind: 'text',
      color,
      sizePx: scaleWidth(width, editorScale()),
      x: pending.point.x,
      y: pending.point.y,
      text: pending.value.trim(),
    }])
  }

  const visible = useMemo(() => (draft === undefined ? objects : [...objects, draft]), [draft, objects])

  /**
   * Pressing anywhere outside the text box finishes the label.
   *
   * This replaces an `onBlur` commit, which could not survive a real click: the
   * browser's own `mousedown` focus handling blurred a freshly mounted box and the
   * handler threw the (still empty) typing away. Capture phase, so the press that
   * closes the box cannot also start a new one.
   */
  const onOverlayPointerDown = (event: ReactPointerEvent): void => {
    textPressUsedRef.current = false
    if (text === undefined) return
    const target = event.target
    if (target instanceof Element && target.closest('[data-dsh-seework-annotation-text]') !== null) return
    textPressUsedRef.current = true
    commitText()
  }

  return (
    <div
      className={css.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="标注编辑器"
      onPointerDownCapture={onOverlayPointerDown}
    >
      <div className={css.panel}>
        <header className={css.toolbar} data-dsh-seework-annotation-toolbar="">
          {([
            ['brush', '画笔'],
            ['rect', '矩形'],
            ['arrow', '箭头'],
            ['text', '文字'],
            ['eraser', '橡皮擦'],
          ] as Array<[AnnotationTool, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={css.tool}
              data-active={tool === value ? 'true' : undefined}
              data-tool={value}
              onClick={() => { setTool(value) }}
            >
              {label}
            </button>
          ))}
          <span className={css.gap} />
          {ANNOTATION_COLORS.map(swatch => (
            <button
              key={swatch}
              type="button"
              className={css.swatch}
              style={{ background: swatch }}
              title={`颜色 ${swatch}`}
              aria-label={`颜色 ${swatch}`}
              data-active={color === swatch ? 'true' : undefined}
              onClick={() => { setColor(swatch) }}
            />
          ))}
          <span className={css.gap} />
          {ANNOTATION_WIDTHS.map(size => (
            <button
              key={size}
              type="button"
              className={css.tool}
              data-active={width === size ? 'true' : undefined}
              title={`粗细 ${size}`}
              onClick={() => { setWidth(size) }}
            >
              {size}
            </button>
          ))}
          <span className={css.gap} />
          <Button onClick={undo} disabled={past.length === 0} title="撤销（Ctrl+Z）">撤销</Button>
          <Button onClick={redo} disabled={future.length === 0} title="重做（Ctrl+Shift+Z）">重做</Button>
          <Button onClick={props.onCancel}>取消</Button>
          <Button
            variant="primary"
            disabled={saving || !hasAnnotations(objects)}
            data-dsh-seework-annotation-save=""
            onClick={() => {
              setSaving(true)
              void burnAnnotations(props.url, objects)
                .then(burned => burned === undefined ? undefined : props.onSave(burned.dataUrl))
                .finally(() => { setSaving(false) })
            }}
          >
            {saving ? '保存中…' : '保存为合成图'}
          </Button>
        </header>

        <div className={css.stage}>
          <div className={css.frame}>
            <img className={css.picture} src={props.url} alt="待标注的图片" draggable={false} />
            <svg
              ref={surfaceRef}
              className={css.surface}
              viewBox={`0 0 ${natural.width} ${natural.height}`}
              preserveAspectRatio="none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {visible.map((object, index) => <AnnotationShape key={index} annotation={object} />)}
            </svg>
            {text === undefined
              ? null
              : (
                <div
                  className={css.textEntry}
                  data-dsh-seework-annotation-text=""
                  style={{
                    left: `${(text.point.x / natural.width) * 100}%`,
                    top: `${(text.point.y / natural.height) * 100}%`,
                  }}
                >
                  <TextInput
                    autoFocus
                    value={text.value}
                    placeholder="输入文字，回车确认，Esc 取消"
                    onChange={event => { setText(current => current === undefined ? current : { ...current, value: event.target.value }) }}
                    onKeyDown={event => {
                      if (event.key === 'Enter') commitText()
                      if (event.key === 'Escape') {
                        // Cancel the typing only: the editor stays open, and the
                        // document-level Escape handler is told to stand down.
                        event.stopPropagation()
                        event.preventDefault()
                        setText(undefined)
                      }
                    }}
                  />
                </div>
              )}
          </div>
        </div>
        <p className={css.hint}>
          五种标注可以混用：画笔涂抹、矩形框选、箭头指向、文字说明、橡皮擦按对象擦除（都可撤销）。保存会生成一张合成图作为**新**卡片，原图与素材库都不动。
          文字框里回车确认、Esc 取消输入（不会关掉编辑器）、点框外即确认。
          {selected === undefined ? '' : '　已选中一个标注：拖动可移动，Delete 删除。'}
        </p>
      </div>
    </div>
  )
}

/** One annotation drawn into the SVG overlay. */
function AnnotationShape({ annotation }: { annotation: Annotation }): JSX.Element {
  if (annotation.kind === 'rect') {
    return (
      <rect
        x={annotation.x}
        y={annotation.y}
        width={annotation.width}
        height={annotation.height}
        fill="none"
        stroke={annotation.color}
        strokeWidth={annotation.sizePx}
      />
    )
  }
  if (annotation.kind === 'text') {
    return (
      <text x={annotation.x} y={annotation.y} fill={annotation.color} fontSize={annotation.sizePx} dominantBaseline="hanging">
        {annotation.text}
      </text>
    )
  }
  if (annotation.kind === 'arrow') {
    const [left, right, tip] = arrowHeadPoints(annotation.from, annotation.to, annotation.sizePx)
    return (
      <g>
        <line
          x1={annotation.from.x}
          y1={annotation.from.y}
          x2={annotation.to.x}
          y2={annotation.to.y}
          stroke={annotation.color}
          strokeWidth={annotation.sizePx}
          strokeLinecap="round"
        />
        <polygon
          points={`${left.x},${left.y} ${right.x},${right.y} ${tip.x},${tip.y}`}
          fill={annotation.color}
        />
      </g>
    )
  }
  return (
    <polyline
      points={annotation.points.map(point => `${point.x},${point.y}`).join(' ')}
      fill="none"
      stroke={annotation.color}
      strokeWidth={annotation.sizePx}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}
