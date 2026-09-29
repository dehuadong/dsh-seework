/**
 * In-place crop mode for one board node.
 *
 * The crop box is drawn over the node itself (not in a dialog), because cropping
 * is a local framing decision and a modal would break the board context — the
 * reference client's ADR-0016 moved it here for exactly that reason. The box is
 * stored in the picture's own pixels and rendered through `crop-rect`'s mapping,
 * so nothing here depends on the board's zoom.
 *
 * Confirming produces a NEW node (`onConfirm` receives the box); the original card
 * and the material library are untouched.
 */

import { useRef, useState } from 'react'
import {
  CROP_ASPECTS,
  CROP_HANDLES,
  cropRectToNode,
  defaultCropRect,
  moveCropRect,
  resizeCropRect,
  type CropHandle,
  type CropRect,
} from './crop-rect.ts'
import { Button } from './controls.tsx'
import css from './crop-overlay.module.css'

/** What the crop overlay needs to know about the node it sits on. */
export interface CropOverlayProps {
  /** The node's rectangle on the board (board coordinates). */
  node: { x: number; y: number; width: number; height: number }
  /** The picture's natural size, for the three-layer mapping. */
  natural: { width: number; height: number }
  /** Crop the picture with this box (picture pixels). */
  onConfirm: (rect: CropRect) => void
  /** Leave crop mode without producing anything. */
  onCancel: () => void
}

/** Which direction each handle drags, for the cursor only. */
const HANDLE_CURSORS: Record<CropHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

/**
 * The crop box and its toolbar for one node.
 * @param props - the node, the picture size, and what to do on confirm/cancel.
 * @returns the overlay.
 */
export function CropOverlay(props: CropOverlayProps): JSX.Element {
  const [aspect, setAspect] = useState<number | null>(null)
  const [rect, setRect] = useState<CropRect>(() => defaultCropRect(props.natural, null))
  const dragRef = useRef<{ mode: 'move' | CropHandle; startX: number; startY: number; startRect: CropRect } | undefined>(undefined)

  /** Picture pixels per screen pixel at the current board scale. */
  const scale = props.node.width === 0 ? 1 : props.natural.width / props.node.width
  const displayed = cropRectToNode(rect, props.node, props.natural)

  const beginDrag = (event: React.PointerEvent, mode: 'move' | CropHandle): void => {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, startRect: rect }
    const onMove = (moveEvent: PointerEvent): void => {
      const drag = dragRef.current
      if (drag === undefined) return
      const dx = (moveEvent.clientX - drag.startX) * scale
      const dy = (moveEvent.clientY - drag.startY) * scale
      setRect(drag.mode === 'move'
        ? moveCropRect(drag.startRect, dx, dy, props.natural)
        : resizeCropRect(drag.startRect, drag.mode, dx, dy, props.natural, aspect))
    }
    const onUp = (): void => {
      dragRef.current = undefined
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <>
      {/* The box lives over the node: three-thirds guides, a dimmed outside is
          deliberately omitted so the user still sees what they are cutting. */}
      <div
        className={css.box}
        data-dsh-seework-crop=""
        style={{
          left: `${props.node.x + displayed.x}px`,
          top: `${props.node.y + displayed.y}px`,
          width: `${displayed.width}px`,
          height: `${displayed.height}px`,
        }}
        onPointerDown={event => { beginDrag(event, 'move') }}
      >
        <span className={css.thirdV} />
        <span className={css.thirdV} data-second="" />
        <span className={css.thirdH} />
        <span className={css.thirdH} data-second="" />
        {CROP_HANDLES.map(handle => (
          <span
            key={handle}
            className={css.handle}
            data-handle={handle}
            style={{ cursor: HANDLE_CURSORS[handle] }}
            onPointerDown={event => { beginDrag(event, handle) }}
          />
        ))}
      </div>

      <div
        className={css.toolbar}
        data-dsh-seework-crop-toolbar=""
        style={{ left: `${props.node.x}px`, top: `${props.node.y + props.node.height + 12}px` }}
        onPointerDown={event => { event.stopPropagation() }}
      >
        <select
          className={css.select}
          value={String(aspect)}
          title="裁剪比例"
          onChange={event => {
            const value = event.target.value === 'null' ? null : Number(event.target.value)
            setAspect(value)
            setRect(defaultCropRect(props.natural, value))
          }}
        >
          {CROP_ASPECTS.map(option => (
            <option key={option.label} value={String(option.value)}>{option.label}</option>
          ))}
        </select>
        <span className={css.size}>{Math.round(rect.width)}×{Math.round(rect.height)}</span>
        <Button onClick={props.onCancel}>取消</Button>
        <Button variant="primary" data-dsh-seework-crop-confirm="" onClick={() => { props.onConfirm(rect) }}>裁剪</Button>
      </div>
    </>
  )
}
