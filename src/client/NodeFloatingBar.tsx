/**
 * The floating command bar that appears when a board node is selected.
 *
 * Clicking an image on the canvas is the moment a user wants to act on THAT
 * picture, so the actions live right next to it instead of in a distant toolbar.
 * The bar is HTML over the board (not part of the scaled world layer), measured
 * after every render, and positioned by {@link floatingBarPosition} — the same
 * interaction the reference client uses.
 *
 * Batch 1 carries the one action that exists so far, 「加入到对话框」 (put the
 * picture back into the composer as a draft attachment); the 标注 / 裁剪 tools
 * join the same bar in the next batch.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { CanvasViewport } from '../protocol.ts'
import { floatingBarPosition, type FloatingBarNode } from './floating-bar.ts'
import css from './node-floating-bar.module.css'

/** What the bar offers for the node it belongs to. */
export interface NodeFloatingBarProps {
  /** The selected node, in board coordinates. */
  node: FloatingBarNode
  /** The board's viewport. */
  viewport: CanvasViewport
  /** The visible stage size, measured live by the board. */
  stageSize: { width: number; height: number }
  /** Put this picture into the conversation's composer. */
  onAddToConversation?: (() => boolean | Promise<boolean>) | undefined
  /** Mark up this picture (开门标注编辑器). */
  onAnnotate?: (() => void) | undefined
  /** Crop this picture in place (produces a new node). */
  onCrop?: (() => void) | undefined
}

/** One button in the bar. */
function BarButton({ label, title, onClick, disabled = false }: {
  label: string
  title: string
  onClick?: (() => void) | undefined
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      className={css.button}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={event => {
        event.stopPropagation()
        onClick?.()
      }}
    >
      {label}
    </button>
  )
}

/**
 * The bar for one selected node.
 * @param props - the node, the viewport, the stage size, and the actions.
 * @returns the bar, positioned inside the stage.
 */
export function NodeFloatingBar(props: NodeFloatingBarProps): JSX.Element {
  const barRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [outcome, setOutcome] = useState<'idle' | 'failed'>('idle')

  // Measure after every render: the labels are localized text, so the width is
  // not knowable up front, and a wrong width would clamp against the wrong edge.
  useLayoutEffect(() => {
    const element = barRef.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    setSize(previous => previous.width === rect.width && previous.height === rect.height
      ? previous
      : { width: rect.width, height: rect.height })
  })

  const position = floatingBarPosition(props.node, props.viewport, size, props.stageSize)
  return (
    <div
      ref={barRef}
      className={css.bar}
      data-dsh-seework-node-bar=""
      data-placement={position.placement}
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        // Hidden until measured: an unmeasured bar would flash at the corner.
        visibility: size.width > 0 ? 'visible' : 'hidden',
      }}
      onPointerDown={event => { event.stopPropagation() }}
      onMouseDown={event => { event.stopPropagation() }}
    >
      <BarButton
        label={outcome === 'failed' ? '放不进输入框' : '加入到对话框'}
        title={outcome === 'failed'
          ? '没能放进输入框：请确认当前会话的输入框可用'
          : '把这张图放进对话输入框当草稿附件'}
        disabled={props.onAddToConversation === undefined}
        onClick={() => {
          const run = props.onAddToConversation
          if (run === undefined) return
          void Promise.resolve(run()).then(ok => {
            // The bar is the only feedback here: the composer may be off screen.
            if (ok !== false) return
            setOutcome('failed')
            setTimeout(() => { setOutcome('idle') }, 2500)
          })
        }}
      />
      <BarButton
        label="标注"
        title="在图上画矩形 / 涂抹 / 写字，保存成一张新图（原图不变）"
        onClick={props.onAnnotate}
        disabled={props.onAnnotate === undefined}
      />
      <BarButton
        label="裁剪"
        title="就地裁剪这张图（生成新卡片，原图保留）"
        onClick={props.onCrop}
        disabled={props.onCrop === undefined}
      />
    </div>
  )
}
