/**
 * Local form controls for the SeeWork settings card.
 *
 * The shell's `dsh-client-ui-primitives` package cannot be a runtime dependency
 * of this plugin: it is not in the shared module baseline, and bundling it drags
 * its whole syntax-highlighting dependency tree into this bundle. These four
 * controls carry the same interaction contract and are styled with the shell's
 * `--dsw-*` design tokens, so they follow the active theme.
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import css from './controls.module.css'

/** Render a button.
 * @param props.variant - visual family; `primary` is the confirming action.
 */
export function Button({ variant = 'ghost', className, children, ...rest }: {
  variant?: 'primary' | 'ghost' | 'outline'
  className?: string | undefined
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const variantClass = variant === 'primary' ? css.buttonPrimary : variant === 'outline' ? css.buttonOutline : ''
  return (
    <button
      type="button"
      className={[css.button, variantClass, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}

/** Render a text input. */
export function TextInput({ className, ...rest }: { className?: string | undefined } & InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input className={[css.input, className].filter(Boolean).join(' ')} {...rest} />
}

/** Render a toggle switch.
 * @param props.label - accessible name, rendered beside the control.
 */
export function Toggle({ checked, onChange, label, title, disabled }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  title?: string | undefined
  disabled?: boolean
}): JSX.Element {
  return (
    <label className={css.toggle} title={title}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={event => { onChange(event.target.checked) }}
      />
      <span>{label}</span>
    </label>
  )
}

/** Render a small status pill. */
export function Pill({ children }: { children: ReactNode }): JSX.Element {
  return <span className={css.pill}>{children}</span>
}

/**
 * Copy text to the clipboard, preferring the async Clipboard API and falling
 * back to a hidden textarea (older browsers and non-secure origins).
 * @param text - the text to place on the clipboard.
 * @returns settlement after a copy attempt succeeded.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  try {
    area.select()
    if (!document.execCommand('copy')) throw new Error('copy refused')
  } finally {
    area.remove()
  }
}
