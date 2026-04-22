import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

export function BracketButton({
  active = false,
  disabled = false,
  type = 'button',
  children,
  onClick,
  className,
}: {
  active?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
  children: ReactNode
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  className?: string
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'font-serif transition-colors hover:bg-orange-950/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-950 disabled:opacity-40 cursor-pointer leading-[1em] hover:text-orange-950',
        active && 'bg-orange-950/10',
        className,
      )}
    >
      [{children}]
    </button>
  )
}
